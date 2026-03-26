/**
 * AIRI Bridge Config — 配置管理
 *
 * 从环境变量和配置文件加载 AIRI Bridge 配置。
 * 优先级：环境变量 > 配置文件 > 默认值
 */

import type { AiriBridgeConfig } from "./types";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: AiriBridgeConfig = {
  airiServerUrl: "ws://localhost:6121/ws",
  airiToken: undefined,
  autoConnect: true,
  autoReconnect: true,
  maxReconnectAttempts: -1,
  enableEmotionRendering: true,
  enableTTS: true,
  defaultCharacterId: "xiaozhi",
};

// ==================== 配置文件路径 ====================

const CONFIG_FILE_PATHS = [
  resolve(process.cwd(), "config/airi-bridge.json"),
  resolve(process.cwd(), "airi-bridge.json"),
];

// ==================== 配置加载 ====================

/**
 * 从配置文件加载配置
 */
function loadConfigFile(): Partial<AiriBridgeConfig> {
  for (const filePath of CONFIG_FILE_PATHS) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);
        console.log(`[AiriBridge:Config] Loaded config from ${filePath}`);
        return parsed;
      } catch (error) {
        console.warn(
          `[AiriBridge:Config] Failed to parse ${filePath}: ${(error as Error).message}`
        );
      }
    }
  }
  return {};
}

/**
 * 从环境变量加载配置
 */
function loadEnvConfig(): Partial<AiriBridgeConfig> {
  const config: Partial<AiriBridgeConfig> = {};

  if (process.env.AIRI_SERVER_URL) {
    config.airiServerUrl = process.env.AIRI_SERVER_URL;
  }
  if (process.env.AIRI_TOKEN) {
    config.airiToken = process.env.AIRI_TOKEN;
  }
  if (process.env.AIRI_AUTO_CONNECT !== undefined) {
    config.autoConnect = process.env.AIRI_AUTO_CONNECT !== "false";
  }
  if (process.env.AIRI_AUTO_RECONNECT !== undefined) {
    config.autoReconnect = process.env.AIRI_AUTO_RECONNECT !== "false";
  }
  if (process.env.AIRI_MAX_RECONNECT_ATTEMPTS !== undefined) {
    config.maxReconnectAttempts = parseInt(
      process.env.AIRI_MAX_RECONNECT_ATTEMPTS,
      10
    );
  }
  if (process.env.AIRI_ENABLE_EMOTION !== undefined) {
    config.enableEmotionRendering = process.env.AIRI_ENABLE_EMOTION !== "false";
  }
  if (process.env.AIRI_ENABLE_TTS !== undefined) {
    config.enableTTS = process.env.AIRI_ENABLE_TTS !== "false";
  }
  if (process.env.AIRI_DEFAULT_CHARACTER) {
    config.defaultCharacterId = process.env.AIRI_DEFAULT_CHARACTER;
  }

  return config;
}

/**
 * 加载完整的 AIRI Bridge 配置
 *
 * 合并顺序：默认值 → 配置文件 → 环境变量
 */
export function loadAiriBridgeConfig(
  overrides?: Partial<AiriBridgeConfig>
): AiriBridgeConfig {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvConfig();

  const config: AiriBridgeConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...overrides,
  };

  console.log(
    `[AiriBridge:Config] Final config: url=${config.airiServerUrl}, ` +
      `autoConnect=${config.autoConnect}, emotion=${config.enableEmotionRendering}, ` +
      `tts=${config.enableTTS}, character=${config.defaultCharacterId}`
  );

  return config;
}

/**
 * 获取默认配置（用于 tRPC 查询）
 */
export function getDefaultConfig(): AiriBridgeConfig {
  return { ...DEFAULT_CONFIG };
}
