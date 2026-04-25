/**
 * Omni Token Router — DashScope Omni 模式临时 Token 端点
 *
 * 提供 GET /api/omni/token 端点，返回 DashScope API Key
 * 供前端 WebSocket 直连 DashScope Omni 端到端语音服务。
 *
 * 安全措施：
 * - API Key 从环境变量读取，不硬编码
 * - 返回的 token 附带过期时间（expireAt）
 * - 未配置 API Key 时返回 501 状态码
 */
import { Router } from "express";

/** Token 有效期（毫秒），默认 30 分钟 */
const TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * 创建 Omni Token 路由
 */
export function createOmniTokenRouter(): Router {
  const router = Router();

  router.get("/api/omni/token", (_req, res) => {
    const apiKey = process.env.DASHSCOPE_API_KEY;

    if (!apiKey) {
      res.status(501).json({
        success: false,
        error: "Omni 模式未配置：DASHSCOPE_API_KEY 环境变量未设置",
      });
      return;
    }

    const now = Date.now();
    res.json({
      success: true,
      token: apiKey,
      expireAt: new Date(now + TOKEN_TTL_MS).toISOString(),
    });
  });

  return router;
}
