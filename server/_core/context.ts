import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { ENV } from "./env";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

// 测试模式：跳过 OAuth 时创建测试用户
const SKIP_AUTH = process.env.SKIP_AUTH === "true" || process.env.VITE_SKIP_OAUTH === "true";

async function getTestUser(): Promise<User | null> {
  if (!SKIP_AUTH) return null;
  
  try {
    const testOpenId = "test_user_skip_auth";
    let user = await db.getUserByOpenId(testOpenId);
    
    if (!user) {
      // 创建测试用户
      console.log("[Auth] Creating test user for development mode...");
      await db.upsertUser({
        openId: testOpenId,
        name: "测试用户",
        email: "test@example.com",
        loginMethod: "test",
      });
      user = await db.getUserByOpenId(testOpenId);
      if (user) {
        console.log("[Auth] Test user created successfully:", user.id);
      }
    } else {
      console.log("[Auth] Using existing test user:", user.id);
    }
    
    return user ?? null;
  } catch (error) {
    console.error("[Auth] Failed to create test user:", error);
    // 即使创建失败，也返回 null，让后续代码处理
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // 如果跳过 OAuth，直接使用测试用户
  if (SKIP_AUTH) {
    user = await getTestUser();
    if (!user) {
      console.warn("[Auth] Test mode: Failed to get test user, but continuing anyway");
    }
  } else {
    // 正常认证流程
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      // 在测试模式下，即使认证失败也允许继续
      if (SKIP_AUTH) {
        console.warn("[Auth] Test mode: Authentication failed, but continuing");
        user = await getTestUser();
      } else {
      user = null;
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
