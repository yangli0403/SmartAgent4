import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const provider = getQueryParam(req, "provider") || "github"; // Default to GitHub

    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }

    try {
      let userInfo: {
        openId: string;
        name: string | null;
        email: string | null;
        loginMethod: string;
      };

      if (provider === "github") {
        // GitHub OAuth flow
        const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/callback?provider=github`;
        const tokenResponse = await sdk.exchangeGitHubCodeForToken(code, redirectUri);
        userInfo = await sdk.getGitHubUserInfo(tokenResponse.accessToken);
      } else {
        // Manus OAuth flow (backward compatibility)
        if (!state) {
          res.status(400).json({ error: "state is required for Manus OAuth" });
          return;
        }
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
        const manusUserInfo = await sdk.getUserInfo(tokenResponse.accessToken);
        userInfo = {
          openId: manusUserInfo.openId,
          name: manusUserInfo.name || null,
          email: manusUserInfo.email ?? null,
          loginMethod: manusUserInfo.loginMethod ?? manusUserInfo.platform ?? "unknown",
        };
      }

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      
      // Provide more helpful error messages
      let errorMessage = "OAuth callback failed";
      let statusCode = 500;
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Network errors
        if (error.message.includes("timeout") || error.message.includes("ECONNRESET") || error.message.includes("UND_ERR_CONNECT_TIMEOUT")) {
          statusCode = 503; // Service Unavailable
          errorMessage = "无法连接到 GitHub。请检查网络连接、防火墙设置或代理配置。";
        }
        // Configuration errors
        else if (error.message.includes("not configured")) {
          statusCode = 500;
          errorMessage = "GitHub OAuth 配置错误。请检查环境变量。";
        }
        // GitHub API errors
        else if (error.message.includes("GitHub")) {
          statusCode = 502; // Bad Gateway
        }
      }
      
      res.status(statusCode).json({ 
        error: "OAuth callback failed",
        message: errorMessage,
        details: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.stack : String(error)) : undefined
      });
    }
  });
}
