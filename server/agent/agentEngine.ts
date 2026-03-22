/**
 * Agent Engine - Implements ReACT (Reason, Act, Observe) reasoning loop
 * Simplified implementation inspired by LangGraph concepts
 * 
 * v0.2 更新：集成文件系统和浏览器控制MCP工具
 */

import { callLLM, type Message } from "../llm/bytedance";
import {
  searchMemories,
  extractMemoriesFromConversation,
} from "../memory/memorySystem";
import {
  buildSystemPrompt,
  type PersonalityType,
} from "../personality/personalitySystem";

// 导入MCP工具定义
import { allTools, toolsMap } from "../mcp";
// 任务模块：复杂条件约束搜索、跨域任务；Plan-Execute 图
import { detectTaskType } from "./tasks";
import { createPlanExecuteGraph } from "./planExecute/planExecuteGraph";

export interface AgentState {
  userId: number;
  personality: PersonalityType;
  conversationHistory: Message[];
  currentQuery: string;
  memories: string[];
  thoughts: string[];
  actions: AgentAction[];
  finalResponse?: string;
}

export interface AgentAction {
  tool: string;
  input: any;
  output?: any;
  error?: string;
}

export interface AgentConfig {
  userId: number;
  personality: PersonalityType;
  userName?: string;
  maxIterations?: number;
  mcpServerUrl?: string; // 本地MCP Server地址
}

/**
 * 核心工具定义（内置工具）
 */
const CORE_TOOLS = [
  {
    name: "search_memory",
    description: "搜索用户的记忆库，查找相关信息",
    parameters: {
      query: "string - 搜索查询（尽量用简短关键词，如“咖啡”）",
      type: "optional - 记忆类型 (fact, behavior, preference, emotion)",
      kind: 'optional - 记忆大类 (episodic, semantic, persona)，例如用户画像多为 persona',
      versionGroup:
        'optional - 同类信息分组键，例如 "user_name"、"favorite_drink"。若提供，将按该组取最新一条记忆。',
    },
  },
  {
    name: "get_current_time",
    description: "获取当前日期和时间",
    parameters: {},
  },
  {
    name: "final_answer",
    description: "向用户提供最终答案",
    parameters: {
      answer: "string - 最终回复内容",
    },
  },
];

/**
 * MCP工具定义（需要本地MCP Server支持）
 */
const MCP_TOOLS = [
  // 文件系统工具
  {
    name: "search_files",
    description: "在指定目录中搜索文件。支持按文件名、扩展名、修改时间等条件搜索。场景示例：找昨天下载的PPT文件",
    parameters: {
      directory: "string - 搜索目录路径，例如：~/Downloads 或 C:\\Users\\Username\\Downloads",
      pattern: "optional string - 文件名匹配模式，支持通配符，例如：*.ppt、report*",
      extension: "optional string - 文件扩展名，例如：ppt、pptx、pdf",
      modifiedAfter: "optional string - 修改时间在此之后，ISO格式，例如：2026-01-16T00:00:00",
      modifiedBefore: "optional string - 修改时间在此之前，ISO格式",
      sortBy: "optional string - 排序方式：name、modified、size、created，默认modified",
      sortOrder: "optional string - 排序顺序：asc、desc，默认desc",
      limit: "optional number - 返回结果数量限制，默认20",
    },
  },
  {
    name: "get_file_info",
    description: "获取指定文件的详细信息，包括大小、创建时间、修改时间、类型等",
    parameters: {
      filePath: "string - 文件的完整路径",
    },
  },
  {
    name: "open_file",
    description: "使用系统默认程序或指定程序打开文件。场景示例：打开最新的PPT文件",
    parameters: {
      filePath: "string - 要打开的文件的完整路径",
      application: "optional string - 指定打开文件的应用程序路径",
    },
  },
  {
    name: "list_directory",
    description: "列出指定目录下的所有文件和子目录",
    parameters: {
      directory: "string - 目录路径",
      includeHidden: "optional boolean - 是否包含隐藏文件，默认false",
      recursive: "optional boolean - 是否递归列出子目录，默认false",
    },
  },
  {
    name: "create_folder",
    description: "创建文件夹（目录）。用于用户要求「新建文件夹」「建一个目录」等。",
    parameters: {
      dirPath: "string - 文件夹完整路径，例如：C:\\Users\\Username\\Downloads\\记忆文件备份 或 ~/Documents/备份",
    },
  },
  {
    name: "create_file",
    description: "在指定路径创建新文件（路径必须带扩展名，如 .txt、.docx）。可写入初始文本内容。若要创建文件夹请使用 create_folder。",
    parameters: {
      filePath: "string - 新文件完整路径，必须带扩展名，例如：~/Documents/报告.docx",
      content: "optional string - 写入的初始文本内容；不传则创建空文件",
    },
  },
  {
    name: "copy_files",
    description: "将一个或多个文件拷贝到指定目标文件夹。支持批量拷贝。",
    parameters: {
      sourcePaths: "array of string - 要拷贝的源文件完整路径列表",
      destinationDir: "string - 目标文件夹路径，例如：~/Documents/备份",
    },
  },
  // 应用和浏览器工具
  {
    name: "launch_app",
    description: "启动指定的应用程序，支持传递命令行参数",
    parameters: {
      appName: "string - 应用程序名称或路径，例如：chrome、notepad、PowerPoint",
      args: "optional array - 命令行参数数组",
      workingDirectory: "optional string - 工作目录",
    },
  },
  {
    name: "browser_control",
    description: "控制浏览器执行操作，如打开新窗口、新标签页、导航到URL等。场景示例：打开无痕模式Chrome并打开多个窗口",
    parameters: {
      browser: "string - 浏览器类型：chrome、edge、firefox、safari，默认chrome",
      action: "string - 操作类型：open、open_incognito、new_window、new_tab、navigate、close",
      url: "optional string - 要打开的URL",
      urls: "optional array - 要打开的多个URL（用于批量打开）",
      windowCount: "optional number - 要打开的窗口数量，默认1",
      incognito: "optional boolean - 是否使用无痕/隐私模式，默认false",
    },
  },
  {
    name: "list_running_apps",
    description: "获取当前运行中的应用程序列表",
    parameters: {
      filter: "optional string - 按名称过滤应用",
    },
  },
  {
    name: "close_app",
    description: "关闭指定的应用程序",
    parameters: {
      appName: "optional string - 应用程序名称",
      processId: "optional number - 进程ID",
      force: "optional boolean - 是否强制关闭，默认false",
    },
  },
  {
    name: "window_control",
    description: "控制应用程序窗口，如最小化、最大化、移动、调整大小等",
    parameters: {
      windowTitle: "optional string - 窗口标题（支持部分匹配）",
      processName: "optional string - 进程名称",
      action: "string - 操作类型：minimize、maximize、restore、close、focus、move、resize",
    },
  },
];

/**
 * 所有可用工具
 */
const AVAILABLE_TOOLS = [...CORE_TOOLS, ...MCP_TOOLS];

/**
 * MCP工具名称列表（需要通过本地MCP Server执行）
 */
const MCP_TOOL_NAMES = MCP_TOOLS.map(t => t.name);

/**
 * Main Agent reasoning function
 */
export async function runAgent(
  config: AgentConfig,
  userMessage: string,
  conversationHistory: Message[] = []
): Promise<AgentState> {
  const { 
    userId, 
    personality, 
    userName, 
    maxIterations = 5,
    mcpServerUrl = "http://localhost:3100",
  } = config;

  // Initialize agent state
  const state: AgentState = {
    userId,
    personality,
    conversationHistory: [...conversationHistory],
    currentQuery: userMessage,
    memories: [],
    thoughts: [],
    actions: [],
  };

  // Step 1: Retrieve relevant memories (semantic/episodic) and persona memories
  const [relevantMemories, personaMemories] = await Promise.all([
    searchMemories({ userId, query: userMessage, limit: 5 }),
    searchMemories({ userId, kind: "persona", limit: 10 }),
  ]);
  // 人格记忆放前面，确保称呼/画像被 LLM 优先看到
  state.memories = [
    ...personaMemories.map(m => m.content),
    ...relevantMemories.map(m => m.content),
  ];

  // Step 2: Build system prompt with personality, context, and tools
  const systemPrompt = buildSystemPromptWithTools(personality, {
    name: userName,
    recentMemories: state.memories,
  });

  // Step 3: 若为复杂条件约束搜索或跨域任务，走任务模块执行
  const taskType = detectTaskType(userMessage);
  console.log("[Agent] 链路-任务类型:", taskType);
  if (taskType !== "simple") {
    console.log("[Agent] 链路-走任务模块执行:", taskType);
    const executor = {
      executeTool: async (toolName: string, params: Record<string, unknown>) => {
        if (MCP_TOOL_NAMES.includes(toolName)) {
          return executeMCPTool(mcpServerUrl, toolName, params);
        }
        return executeTool(toolName, params, state);
      },
    };
    try {
      const graph = createPlanExecuteGraph(executor);
      const finalState = await graph.invoke({
        taskType,
        userInput: userMessage,
        options: { defaultSearchDirectory: "~/Downloads" },
      });
      const result = {
        success: finalState.success,
        steps: finalState.plan ?? [],
        outputs: finalState.outputs ?? [],
        summary: finalState.summary,
        error: finalState.error,
        ...(taskType === "cross_domain" && { stepsByDomain: finalState.stepsByDomain ?? {} }),
      };
      const taskResult = { type: taskType, result } as
        | { type: "complex_conditional"; result: { success: boolean; steps: any[]; outputs: unknown[]; summary?: string; error?: string } }
        | { type: "cross_domain"; result: { success: boolean; stepsByDomain?: Record<string, any[]>; steps: any[]; outputs: unknown[]; summary?: string; error?: string } };
      if (taskResult.type === "complex_conditional" && taskResult.result.success) {
        state.finalResponse = taskResult.result.summary ?? "已按条件完成搜索与打开。";
      } else if (taskResult.type === "complex_conditional" && !taskResult.result.success) {
        state.finalResponse = taskResult.result.error ?? "未能完成条件搜索，请检查输入或 MCP 服务。";
      } else if (taskResult.type === "cross_domain" && taskResult.result.success) {
        state.finalResponse = taskResult.result.summary ?? "跨域任务已执行完成。";
      } else if (taskResult.type === "cross_domain" && !taskResult.result.success) {
        state.finalResponse = taskResult.result.error ?? "跨域任务执行失败，请检查输入或 MCP 服务。";
      } else {
        state.finalResponse = "任务已处理。";
      }
      state.conversationHistory.push(
        { role: "user", content: userMessage },
        { role: "assistant", content: state.finalResponse ?? "" }
      );
      extractMemoriesFromConversation({
        userId,
        conversationHistory: [
          { role: "user", content: userMessage },
          { role: "assistant", content: state.finalResponse ?? "" },
        ],
      }).catch(err => console.error("[Agent] Error forming memories:", err));
      return state;
    } catch (err: any) {
      state.finalResponse = err?.message ?? "任务模块执行出错，请稍后再试。";
      state.conversationHistory.push(
        { role: "user", content: userMessage },
        { role: "assistant", content: state.finalResponse ?? "" }
      );
      return state;
    }
  }

  // Step 4: Prepare messages for LLM（simple 或 任务模块未命中时）
  console.log("[Agent] 链路-走 LLM 工具调用路径");
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...state.conversationHistory,
    { role: "user", content: userMessage },
  ];

  // Step 5: Get LLM response with tool calling
  try {
    const response = await callLLM(messages, {
      temperature: 0.7,
      maxTokens: 2000,
    });

    // Check if response contains tool calls（仅第一轮回复中的 ```tool``` 会被执行）
    const toolCalls = parseToolCalls(response.content);
    if (toolCalls.length > 0) {
      console.log(
        "[Agent] 解析到",
        toolCalls.length,
        "个工具调用:",
        toolCalls.map(t => t.name).join(", ")
      );
    }
    if (toolCalls.length > 0) {
      // Execute tool calls
      for (const toolCall of toolCalls) {
        let params = { ...toolCall.parameters };
        // copy_files：若 LLM 未填 sourcePaths 或填了空数组，用上一步 search_files 的结果自动填充
        if (toolCall.name === "copy_files") {
          const needSources = !Array.isArray(params.sourcePaths) || params.sourcePaths.length === 0;
          if (needSources) {
            const lastSearch = [...state.actions].reverse().find(a => a.tool === "search_files");
            const out = lastSearch?.output;
            const list = Array.isArray(out) ? out : (out && typeof out === "object" ? (out as any).files : null);
            const paths = Array.isArray(list) ? list.map((f: any) => f?.path ?? f?.filePath ?? (typeof f === "string" ? f : null)).filter(Boolean) : [];
            if (paths.length > 0) {
              params.sourcePaths = paths;
              console.log("[Agent] copy_files 自动填充 sourcePaths 从上一步 search_files:", paths.length, "个文件");
            }
          }
        }
        const action: AgentAction = {
          tool: toolCall.name,
          input: params,
        };
        console.log("[Agent] 执行工具:", toolCall.name, JSON.stringify(params));
        try {
          if (MCP_TOOL_NAMES.includes(toolCall.name)) {
            // Execute via MCP Server
            action.output = await executeMCPTool(mcpServerUrl, toolCall.name, params);
            console.log("[Agent] 工具结果:", toolCall.name, action.output?.success === true ? "成功" : "失败或异常", action.error ? String(action.error) : "");
          } else {
            // Execute built-in tool
            action.output = await executeTool(toolCall.name, params, state);
          }
        } catch (error: any) {
          action.error = error.message;
        }
        
        state.actions.push(action);
      }
      
      // Generate final response based on tool results
      const toolResultsPrompt = formatToolResults(state.actions);
      const followUpMessages: Message[] = [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: `工具执行结果：\n${toolResultsPrompt}\n\n请根据以上结果，用自然语言回复用户。` },
      ];
      
      const finalResponse = await callLLM(followUpMessages, {
        temperature: 0.7,
      maxTokens: 1500,
    });

      state.finalResponse = finalResponse.content;
    } else {
    state.finalResponse = response.content;
    }

    // Step 6: Update conversation history
    state.conversationHistory.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: state.finalResponse }
    );

    // Step 7: Form new memories from this conversation (async, don't wait)
    extractMemoriesFromConversation({
      userId,
      conversationHistory: [
        { role: "user", content: userMessage },
        { role: "assistant", content: state.finalResponse },
      ],
    }).catch(err => {
      console.error("[Agent] Error forming memories:", err);
    });
  } catch (error) {
    console.error("[Agent] Error in reasoning:", error);
    state.finalResponse = "抱歉，我遇到了一些问题。请稍后再试。";
  }

  return state;
}

/**
 * Build system prompt with tools
 */
function buildSystemPromptWithTools(
  personality: PersonalityType,
  context: { name?: string; recentMemories?: string[] }
): string {
  const basePrompt = buildSystemPrompt(personality, context);
  const toolsDescription = formatToolsForLLM();
  
  return `${basePrompt}

## 可用工具

你可以使用以下工具来帮助用户完成任务。当需要使用工具时，请使用以下格式：

\`\`\`tool
{"name": "工具名称", "parameters": {"参数名": "参数值"}}
\`\`\`

重要：若任务需多步（如先建文件夹、再搜索、再复制），请在**本条回复**中按顺序写出多个 \`\`\`tool\`\`\` 块，我们会依次执行。下一轮回复中的 \`\`\`tool\`\`\` 不会被执行。

${toolsDescription}

## 工具使用指南

1. **文件操作场景**：
   - 当用户要求查找文件时，使用 search_files 工具
   - 当用户要求打开文件时，先用 search_files 找到文件，再用 open_file 打开
   - 当用户要求拷贝/复制文件到某文件夹时：必须按顺序在同一条回复中写出多个 \`\`\`tool\`\`\` 块：① create_folder（先建目标文件夹）② search_files（找要拷贝的文件）③ copy_files（destinationDir 用①的路径，sourcePaths 用②的 path 列表）。只有同一条回复里的 \`\`\`tool\`\`\` 会被执行，后续自然语言回复中的 \`\`\`tool\`\`\` 不会执行。
   - 创建新文件夹：使用 create_folder，传入 dirPath（如 C:\\\\Users\\\\...\\\\Downloads\\\\记忆文件备份）
   - 创建新 Word/文本文件：使用 create_file，传入 filePath（必须带扩展名）和可选的 content
   - "昨天"指的是当前日期减1天

2. **浏览器操作场景**：
   - 当用户要求打开浏览器时，使用 browser_control 工具
   - 无痕模式：设置 action 为 "open_incognito" 或 incognito 为 true
   - 打开多个窗口：设置 windowCount 和 urls 参数

3. **应用操作场景**：
   - 启动应用：使用 launch_app 工具
   - 关闭应用：使用 close_app 工具

注意：MCP工具（文件系统、浏览器、应用控制）需要用户本地运行MCP Server才能执行。如果工具执行失败，请告知用户需要启动本地MCP Server。
`;
}

/**
 * Parse tool calls from LLM response
 */
function parseToolCalls(content: string): Array<{ name: string; parameters: any }> {
  const toolCalls: Array<{ name: string; parameters: any }> = [];
  
  // Match ```tool ... ``` blocks
  const toolBlockRegex = /```tool\s*([\s\S]*?)```/g;
  let match;
  
  while ((match = toolBlockRegex.exec(content)) !== null) {
    try {
      const toolJson = JSON.parse(match[1].trim());
      if (toolJson.name) {
        toolCalls.push({
          name: toolJson.name,
          parameters: toolJson.parameters || {},
        });
      }
    } catch (e) {
      console.error("[Agent] Failed to parse tool call:", e);
    }
  }
  
  return toolCalls;
}

/**
 * Format tool results for follow-up prompt
 */
function formatToolResults(actions: AgentAction[]): string {
  return actions.map((action, index) => {
    if (action.error) {
      return `${index + 1}. ${action.tool}: 错误 - ${action.error}`;
    }
    return `${index + 1}. ${action.tool}: ${JSON.stringify(action.output, null, 2)}`;
  }).join("\n\n");
}

/**
 * Execute MCP tool via local MCP Server
 */
async function executeMCPTool(
  serverUrl: string,
  toolName: string,
  params: any
): Promise<any> {
  try {
    const response = await fetch(`${serverUrl}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: toolName,
        params,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`MCP Server returned ${response.status}`);
    }
    
    return await response.json();
  } catch (error: any) {
    // Check if it's a connection error
    if (error.code === "ECONNREFUSED" || error.message.includes("fetch")) {
      throw new Error(
        "无法连接到本地MCP Server。请确保已启动MCP Server（运行 node smartagent-mcp-server.js）"
      );
    }
    throw error;
  }
}

/**
 * Execute a built-in tool
 */
async function executeTool(
  toolName: string,
  input: any,
  state: AgentState
): Promise<any> {
  switch (toolName) {
    case "search_memory":
      const memories = await searchMemories({
        userId: state.userId,
        query: input.query,
        type: input.type,
        kind: input.kind,
        versionGroup: input.versionGroup,
        limit: input.limit ?? 5,
      });
      return memories.map(m => m.content);

    case "get_current_time":
      return new Date().toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
      });

    case "final_answer":
      return input.answer;

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Format tool descriptions for LLM
 */
function formatToolsForLLM(): string {
  return AVAILABLE_TOOLS.map(tool => {
    const params = Object.entries(tool.parameters)
      .map(([key, value]) => `  - ${key}: ${value}`)
      .join("\n");
    return `### ${tool.name}\n${tool.description}\n参数:\n${params || "  无"}`;
  }).join("\n\n");
}

/**
 * Get list of available tools
 */
export function getAvailableTools() {
  return AVAILABLE_TOOLS;
}

/**
 * Get MCP tool names
 */
export function getMCPToolNames() {
  return MCP_TOOL_NAMES;
}
