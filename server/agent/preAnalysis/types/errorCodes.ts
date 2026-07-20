/**
 * server/agent/preAnalysis/types/errorCodes.ts
 *
 * 14 个错误码字典 + source enum 完整导出
 * 对齐 03-接口文档.md §6
 */

export {
  Source,
  SourceSchema,
  type Source as SourceType,
  CURRENT_SCHEMA_VERSION,
} from "./preAnalyzerOutput";

// ============================================================
// 错误码字典
// ============================================================

export type ErrorSeverity = "info" | "warning" | "critical";

export interface ErrorCodeEntry {
  code: string;
  httpStatus: number;
  message: string;
  retryable: boolean;
  severity: ErrorSeverity;
}

export const ERROR_CODES = {
  // 预取缓存相关
  INVALID_VERSION_SCHEMA: {
    code: "INVALID_VERSION_SCHEMA",
    httpStatus: 200,                              // 降级而非失败
    message: "预取缓存 schemaVersion 不匹配，已降级",
    retryable: false,
    severity: "warning",
  },
  CACHE_LOOKUP_TIMEOUT: {
    code: "CACHE_LOOKUP_TIMEOUT",
    httpStatus: 200,
    message: "缓存查询超时，使用规则兜底",
    retryable: true,
    severity: "warning",
  },
  CACHE_WRITE_FAILED: {
    code: "CACHE_WRITE_FAILED",
    httpStatus: 200,
    message: "缓存写入失败，不影响主流程",
    retryable: false,
    severity: "info",
  },

  // 规则层相关
  RULE_TIMEOUT: {
    code: "RULE_TIMEOUT",
    httpStatus: 200,
    message: "规则求值超时，跳过 LLM",
    retryable: true,
    severity: "warning",
  },
  RULE_LAYER_MISSING: {
    code: "RULE_LAYER_MISSING",
    httpStatus: 500,
    message: "规则层未注册",
    retryable: false,
    severity: "critical",
  },

  // LLM 相关
  LLM_TIMEOUT_SOFT: {
    code: "LLM_TIMEOUT_SOFT",
    httpStatus: 200,
    message: "LLM 软超时（3-8s），使用部分结果",
    retryable: true,
    severity: "warning",
  },
  LLM_TIMEOUT_HARD: {
    code: "LLM_TIMEOUT_HARD",
    httpStatus: 200,
    message: "LLM 硬超时（>8s），已降级到规则",
    retryable: false,
    severity: "warning",
  },
  LLM_RATE_LIMITED: {
    code: "LLM_RATE_LIMITED",
    httpStatus: 429,
    message: "LLM 调用被限流",
    retryable: true,
    severity: "warning",
  },
  LLM_RESPONSE_INVALID: {
    code: "LLM_RESPONSE_INVALID",
    httpStatus: 502,
    message: "LLM 返回无法解析",
    retryable: false,
    severity: "critical",
  },
  LLM_API_KEY_MISSING: {
    code: "LLM_API_KEY_MISSING",
    httpStatus: 500,
    message: "LLM API Key 未配置",
    retryable: false,
    severity: "critical",
  },

  // Scene 激活相关
  SCENE_DB_TIMEOUT: {
    code: "SCENE_DB_TIMEOUT",
    httpStatus: 200,
    message: "场景查询 DB 超时，使用缓存或跳过",
    retryable: true,
    severity: "warning",
  },
  SCENE_INVALID_OUTPUT: {
    code: "SCENE_INVALID_OUTPUT",
    httpStatus: 200,
    message: "场景激活输出含非法字段 memoryRelevant",
    retryable: false,
    severity: "warning",
  },

  // 配置相关
  INVALID_CONFIG: {
    code: "INVALID_CONFIG",
    httpStatus: 500,
    message: "preAnalysis 配置非法",
    retryable: false,
    severity: "critical",
  },

  // 通用
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    httpStatus: 500,
    message: "预分析节点内部错误",
    retryable: false,
    severity: "critical",
  },
} as const satisfies Record<string, ErrorCodeEntry>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function getErrorCode(code: ErrorCode): ErrorCodeEntry {
  return ERROR_CODES[code];
}

/** 检查错误是否可重试 */
export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODES[code].retryable;
}