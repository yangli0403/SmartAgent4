/**
 * AIRI Bridge Module — 模块导出
 *
 * 将 AIRI Bridge 的所有公共接口统一导出。
 */

// 核心服务
export { AiriBridgeService } from "./airiBridgeService";

// 情感映射
export { EmotionMapper } from "./emotionMapper";

// 音频转换
export { AudioConverter } from "./audioConverter";

// 配置
export { loadAiriBridgeConfig, getDefaultConfig } from "./config";

// 类型
export type {
  AiriBridgeConfig,
  AiriBridgeStatus,
  AiriBridgeStatusInfo,
  AiriBridgeInput,
  AiriBridgeInputCallback,
  AiriExpressionCommand,
  AiriMotionCommand,
  AiriOutputMessage,
  AiriMessageContentPart,
  EmotionMappingRule,
  EmotionMappingConfig,
  AudioPacket,
} from "./types";
