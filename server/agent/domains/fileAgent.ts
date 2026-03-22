/**
 * FileAgent — 文件系统专员
 *
 * 负责处理文件搜索、打开、创建、复制等文件系统操作。
 * 绑定本地 MCP Server 的文件系统工具（7个）和应用浏览器工具（4个）。
 * 保留原有 SmartAgent 的文件处理能力。
 * 内部运行 LangGraph ReACT 循环（继承 BaseAgent）。
 */

import { BaseAgent } from "./baseAgent";
import type {
  DomainAgentConfig,
  AgentStructuredData,
  FileData,
} from "./types";
import type { MCPManager } from "../../mcp/mcpManager";

/** FileAgent 默认配置 */
export const FILE_AGENT_CONFIG: DomainAgentConfig = {
  name: "fileAgent",
  description: "文件系统专员，负责文件搜索、打开、创建、复制等操作",
  systemPrompt: `你是文件系统操作专家。你可以帮助用户搜索文件、查看文件信息、打开文件、
创建文件和文件夹、复制文件等。

操作原则：
1. 搜索文件时，优先使用 search_files 工具，根据用户描述推断搜索条件
2. 时间描述转换：如"昨天"转为具体日期，"最近"转为近7天
3. 打开文件前先确认文件存在
4. 批量操作时使用 copy_files 工具
5. 创建文件夹使用 create_folder，创建文件使用 create_file（需带扩展名）`,
  toolNames: [
    "search_files",
    "get_file_info",
    "open_file",
    "list_directory",
    "create_folder",
    "create_file",
    "copy_files",
    "launch_app",
    "browser_control",
    "list_running_apps",
    "close_app",
  ],
  maxIterations: 5,
  temperature: 0.3,
  maxTokens: 2000,
};

/**
 * FileAgent 实现
 */
export class FileAgent extends BaseAgent {
  readonly name = FILE_AGENT_CONFIG.name;
  readonly description = FILE_AGENT_CONFIG.description;
  readonly availableTools: string[];

  constructor(mcpManager: MCPManager, config?: Partial<DomainAgentConfig>) {
    const mergedConfig = { ...FILE_AGENT_CONFIG, ...config };
    super(mergedConfig, mcpManager);
    this.availableTools = mergedConfig.toolNames;
  }

  /**
   * 获取系统提示词（注入平台信息）
   */
  getSystemPrompt(context?: Record<string, unknown>): string {
    let prompt = this.config.systemPrompt;

    if (context?.platform) {
      prompt += `\n\n当前操作系统: ${context.platform}`;
    }

    if (context?.currentTime) {
      prompt += `\n当前时间: ${context.currentTime}`;
    }

    return prompt;
  }

  /**
   * 解析文件类结构化数据
   */
  protected parseStructuredData(output: string): AgentStructuredData | undefined {
    try {
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        if (data.files || data.targetFile) {
          return {
            type: "file",
            files: data.files,
            targetFile: data.targetFile,
          } as FileData;
        }
      }
    } catch {
      // 解析失败
    }

    return undefined;
  }
}
