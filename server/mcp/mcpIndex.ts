/**
 * MCP 模块入口（更新版）
 *
 * 导出 MCP Manager、Tool Registry 和配置相关接口。
 * 保留对原有 fileSystemTools 和 appBrowserTools 的兼容。
 */

// MCP Manager
export {
  MCPManager,
  type IMCPManager,
  type MCPServerConfig,
  type MCPServerStatus,
  type MCPTransport,
  type MCPConnectionStatus,
} from "./mcpManager";

// Tool Registry
export {
  ToolRegistry,
  type IToolRegistry,
  type RegisteredTool,
  type ToolCategory,
  type LangGraphToolDefinition,
} from "./toolRegistry";

// 配置
export {
  loadMCPConfig,
  generateDefaultConfig,
  DEFAULT_MCP_CONFIGS,
} from "./mcpConfig";
