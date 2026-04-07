/**
 * FileAgent — 文件系统专员 (SmartAgent4)
 *
 * 负责处理文件搜索、打开、创建、复制等文件系统操作。
 * SmartAgent4 新增：文件整理大师功能（目录分析、同名/重复文件检测、安全删除、批量移动）。
 * 绑定本地 MCP Server 的文件系统工具和文件整理工具。
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
  description:
    "文件系统专员，负责文件搜索、打开、创建、复制，以及文件整理（目录分析、同名/重复文件检测、清理）等操作",
  systemPrompt: `你是文件系统操作专家，同时也是一位"文件整理大师"。你可以帮助用户搜索文件、查看文件信息、打开文件、
创建文件和文件夹、复制文件，以及进行高级的文件整理和清理操作。

【磁盘与 C 盘（最高优先级）】
当用户询问 **C 盘、系统盘、磁盘空间、硬盘使用情况、分析磁盘、磁盘健康、系统垃圾/临时文件占多少** 时：
- **必须先调用工具**：至少调用 **get_disk_health**（默认盘符 C）；若用户还关心垃圾/临时目录体量，再调用 **scan_system_junk**。
- **禁止**在未调用上述工具的情况下，声称「无法直接访问磁盘」或只给出「右键属性、磁盘清理」等纯手动教程作为主要答案；可在工具结果之后补充简要操作提示。
- 深度清理需求用 **execute_advanced_cleanup**（仅预览建议命令，不执行）。

基础操作原则：
1. 搜索文件时，优先使用 search_files 工具，根据用户描述推断搜索条件
2. 时间描述转换：如"昨天"转为具体日期，"最近"转为近7天
3. 打开文件前先确认文件存在
4. 批量操作时使用 copy_files 工具
5. 创建文件夹使用 create_folder，创建文件使用 create_file（需带扩展名）

文件整理大师操作原则：
6. 当用户要求"整理文件"、"清理下载目录"、"找重复文件"等，使用文件整理工具
7. 使用 analyze_directory 了解目录整体情况（类型分布、大文件、旧文件）
8. 使用 find_duplicates 检测同名文件和完全重复的文件
9. 使用 move_files 将文件归档到其他目录

【最重要的安全规则】：
10. 在调用 delete_files 之前，你必须：
    a. 先向用户清晰展示要删除的文件列表（文件名、大小、路径）
    b. 明确告知用户将释放多少空间
    c. 等待用户明确确认（如"确认删除"、"好的"、"可以"）
    d. 只有在用户确认后才能调用 delete_files
    e. 未经用户确认直接删除文件是严格禁止的！

文件整理工作流建议：
- 第一步：使用 analyze_directory 扫描目录，向用户展示概况
- 第二步：使用 find_duplicates 找出同名和重复文件
- 第三步：向用户展示可清理的文件列表和预计释放空间
- 第四步：等待用户确认后，使用 delete_files 或 move_files 执行操作

磁盘与系统垃圾（只读/建议，不擅自执行系统命令）：
11. 用户询问「C 盘空间」「磁盘健康」时，使用 get_disk_health 查看已用/剩余与提示
12. 用户希望「看看能清多少垃圾」「临时文件占多少」时，使用 scan_system_junk 做白名单路径体量估算（可设 includeBrowserCaches 包含 Chrome 缓存，可能较慢）
13. 用户要求「深度清理」「DISM」「组件存储」时，仅使用 execute_advanced_cleanup 给出**建议命令与警告**，绝不自动执行 cleanmgr/DISM；提醒用户自行在管理员终端评估后运行`,
  toolNames: [
    // 基础文件系统工具
    "search_files",
    "get_file_info",
    "open_file",
    "list_directory",
    "create_folder",
    "create_file",
    "copy_files",
    // 应用浏览器工具
    "launch_app",
    "browser_control",
    "list_running_apps",
    "close_app",
    // 文件整理大师工具（SmartAgent4 新增）
    "analyze_directory",
    "find_duplicates",
    "delete_files",
    "move_files",
    "get_disk_health",
    "scan_system_junk",
    "execute_advanced_cleanup",
  ],
  maxIterations: 8, // 文件整理可能需要更多轮次
  temperature: 0.3,
  maxTokens: 3000,
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
  protected parseStructuredData(
    output: string
  ): AgentStructuredData | undefined {
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
