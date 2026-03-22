/**
 * BaseAgent — Domain Agent 基类
 *
 * 封装 LangGraph ReACT 循环的通用逻辑，
 * 所有 Domain Agent 继承此基类，只需定义配置和系统提示词。
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createToolCallingLLM } from "../../llm/langchainAdapter";
import type { MCPManager } from "../../mcp/mcpManager";
import type {
  DomainAgentInterface,
  DomainAgentConfig,
  AgentExecutionInput,
  AgentExecutionOutput,
  AgentStructuredData,
} from "./types";
import type { ToolCallRecord } from "../supervisor/state";

// ==================== Agent 内部状态 ====================

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),
});

// ==================== 基类实现 ====================

export abstract class BaseAgent implements DomainAgentInterface {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly availableTools: string[];

  protected config: DomainAgentConfig;
  protected mcpManager: MCPManager;

  constructor(config: DomainAgentConfig, mcpManager: MCPManager) {
    this.config = config;
    this.mcpManager = mcpManager;
  }

  /**
   * 获取系统提示词（子类可覆盖以注入上下文）
   */
  abstract getSystemPrompt(context?: Record<string, unknown>): string;

  /**
   * 解析结构化数据（子类可覆盖以提取领域特定数据）
   */
  protected parseStructuredData(
    _output: string
  ): AgentStructuredData | undefined {
    return undefined;
  }

  /**
   * 执行任务步骤
   *
   * 构建 ReACT Agent 图，运行循环直到 LLM 不再请求工具调用或达到最大迭代次数。
   */
  async execute(input: AgentExecutionInput): Promise<AgentExecutionOutput> {
    const startTime = Date.now();
    const toolCallRecords: ToolCallRecord[] = [];

    try {
      // 1. 构建 MCP 工具为 LangChain DynamicStructuredTool
      const tools = this.buildLangChainTools(toolCallRecords);

      // 2. 创建 LLM 并绑定工具
      const llm = createToolCallingLLM({
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
      });

      const llmWithTools =
        tools.length > 0 ? llm.bindTools(tools) : llm;

      // 3. 构建 ReACT 图
      const graph = this.buildReactGraph(llmWithTools, tools);

      // 4. 构建初始消息
      const systemPrompt = this.getSystemPrompt(
        input.context as Record<string, unknown> | undefined
      );

      const taskMessage = this.buildTaskMessage(input);

      const initialMessages: BaseMessage[] = [
        new SystemMessage(systemPrompt),
        new HumanMessage(taskMessage),
      ];

      // 5. 运行图
      const result = await graph.invoke({
        messages: initialMessages,
      });

      // 6. 提取最终输出
      const messages = result.messages as BaseMessage[];
      const lastMessage = messages[messages.length - 1];
      const output =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      const durationMs = Date.now() - startTime;

      console.log(
        `[${this.name}] Execution completed in ${durationMs}ms, ${toolCallRecords.length} tool calls`
      );

      return {
        success: true,
        output,
        toolCalls: toolCallRecords,
        durationMs,
        structuredData: this.parseStructuredData(output),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = (error as Error).message;

      console.error(`[${this.name}] Execution failed: ${errorMsg}`);

      return {
        success: false,
        output: "",
        error: errorMsg,
        toolCalls: toolCallRecords,
        durationMs,
      };
    }
  }

  /**
   * 构建 LangChain 工具
   *
   * 将 MCP 工具转换为 LangChain DynamicStructuredTool，
   * 工具调用时通过 MCPManager.callTool 执行。
   */
  private buildLangChainTools(
    toolCallRecords: ToolCallRecord[]
  ): DynamicStructuredTool[] {
    const registry = this.mcpManager.getToolRegistry();
    const tools: DynamicStructuredTool[] = [];

    for (const toolName of this.availableTools) {
      const registeredTool = registry.get(toolName);
      if (!registeredTool) {
        console.warn(
          `[${this.name}] Tool not found in registry: ${toolName}`
        );
        continue;
      }

      // 将 JSON Schema 转换为 Zod Schema
      const zodSchema = this.jsonSchemaToZod(registeredTool.inputSchema);

      const tool = new DynamicStructuredTool({
        name: registeredTool.name,
        description: registeredTool.description,
        schema: zodSchema,
        func: async (args: Record<string, unknown>) => {
          const callStart = Date.now();
          try {
            const result = await this.mcpManager.callTool(toolName, args);
            const callDuration = Date.now() - callStart;

            // 记录工具调用
            toolCallRecords.push({
              toolName,
              serverId: registeredTool.serverId,
              input: args,
              output: result,
              status: "success",
              durationMs: callDuration,
            });

            return typeof result === "string"
              ? result
              : JSON.stringify(result);
          } catch (error) {
            const callDuration = Date.now() - callStart;

            toolCallRecords.push({
              toolName,
              serverId: registeredTool.serverId,
              input: args,
              output: (error as Error).message,
              status: "error",
              durationMs: callDuration,
            });

            return `Error calling ${toolName}: ${(error as Error).message}`;
          }
        },
      });

      tools.push(tool);
    }

    console.log(
      `[${this.name}] Built ${tools.length} LangChain tools from ${this.availableTools.length} configured`
    );

    return tools;
  }

  /**
   * 构建 ReACT 图
   */
  private buildReactGraph(
    llmWithTools: any,
    tools: DynamicStructuredTool[]
  ) {
    const maxIterations = this.config.maxIterations;
    let iterationCount = 0;

    // Agent 节点：调用 LLM
    async function agentNode(state: typeof AgentState.State) {
      iterationCount++;
      if (iterationCount > maxIterations) {
        return {
          messages: [
            new AIMessage(
              `已达到最大迭代次数 (${maxIterations})，基于当前信息生成回复。`
            ),
          ],
        };
      }

      const response = await llmWithTools.invoke(state.messages);
      return { messages: [response] };
    }

    // 路由函数：判断是否继续工具调用
    function shouldContinue(state: typeof AgentState.State): "tools" | "end" {
      const lastMessage = state.messages[state.messages.length - 1];

      if (iterationCount > maxIterations) {
        return "end";
      }

      // 检查是否有 tool_calls
      if (
        lastMessage &&
        "tool_calls" in lastMessage &&
        Array.isArray((lastMessage as AIMessage).tool_calls) &&
        (lastMessage as AIMessage).tool_calls!.length > 0
      ) {
        return "tools";
      }

      return "end";
    }

    // 构建图
    const toolNode = new ToolNode(tools);

    const graph = new StateGraph(AgentState)
      .addNode("agent", agentNode)
      .addNode("tools", toolNode)
      .addEdge(START, "agent")
      .addConditionalEdges("agent", shouldContinue, {
        tools: "tools",
        end: END,
      })
      .addEdge("tools", "agent");

    return graph.compile();
  }

  /**
   * 构建任务消息
   *
   * 将 AgentExecutionInput 转换为自然语言任务描述。
   */
  private buildTaskMessage(input: AgentExecutionInput): string {
    let message = input.step.description;

    // 附加解析后的输入参数
    if (
      input.resolvedInputs &&
      Object.keys(input.resolvedInputs).length > 0
    ) {
      message += `\n\n前置步骤提供的信息：\n${JSON.stringify(input.resolvedInputs, null, 2)}`;
    }

    // 附加用户原始消息
    if (input.userMessage) {
      message += `\n\n用户原始请求：${input.userMessage}`;
    }

    return message;
  }

  /**
   * 将 JSON Schema 转换为 Zod Schema
   *
   * 简化版转换，支持基本类型。
   */
  private jsonSchemaToZod(
    schema: Record<string, unknown>
  ): z.ZodObject<any> {
    const properties = (schema.properties || {}) as Record<
      string,
      Record<string, unknown>
    >;
    const required = (schema.required || []) as string[];

    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(properties)) {
      let zodType: z.ZodTypeAny;

      switch (prop.type) {
        case "string":
          zodType = z.string().describe((prop.description as string) || key);
          break;
        case "number":
        case "integer":
          zodType = z.number().describe((prop.description as string) || key);
          break;
        case "boolean":
          zodType = z.boolean().describe((prop.description as string) || key);
          break;
        case "array":
          zodType = z.array(z.any()).describe((prop.description as string) || key);
          break;
        case "object":
          zodType = z.record(z.string(), z.any()).describe((prop.description as string) || key);
          break;
        default:
          zodType = z.any().describe((prop.description as string) || key);
      }

      if (!required.includes(key)) {
        zodType = zodType.optional();
      }

      shape[key] = zodType;
    }

    return z.object(shape);
  }
}
