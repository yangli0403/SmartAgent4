/**
 * Domain Agents 模块入口
 *
 * 导出所有领域专员 Agent 和相关类型。
 */

// 基类
export { BaseAgent } from "./baseAgent";

// 统一接口
export {
  type DomainAgentInterface,
  type DomainAgentConfig,
  type AgentExecutionInput,
  type AgentExecutionOutput,
  type AgentStructuredData,
  type NavigationData,
  type POIItem,
  type RouteInfo,
  type MusicData,
  type SongItem,
  type PlaylistInfo,
  type FileData,
  type FileItem,
  type GeneralData,
} from "./types";

// 具体 Agent
export { FileAgent, FILE_AGENT_CONFIG } from "./fileAgent";
export { NavigationAgent, NAVIGATION_AGENT_CONFIG } from "./navigationAgent";
export { MultimediaAgent, MULTIMEDIA_AGENT_CONFIG } from "./multimediaAgent";
export { GeneralAgent, GENERAL_AGENT_CONFIG } from "./generalAgent";
