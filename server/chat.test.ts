import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId: number = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `test${userId}@example.com`,
    name: `Test User ${userId}`,
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("chat router", () => {
  it("should send message and get response", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.chat.sendMessage({
      message: "你好",
    });

    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
    expect(typeof result.response).toBe("string");
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.personality).toBeDefined();
  }, 30000); // 30 second timeout for LLM call

  it("should reject empty message", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    await expect(caller.chat.sendMessage({ message: "" })).rejects.toThrow();
  });

  it("should get conversation history", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const history = await caller.chat.getHistory({ limit: 10 });

    expect(Array.isArray(history)).toBe(true);
  });
});

describe("preferences router", () => {
  it("should get user preferences", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const prefs = await caller.preferences.get();

    expect(prefs).toBeDefined();
    if (prefs) {
      expect(prefs.personality).toBeDefined();
      expect(prefs.responseStyle).toBeDefined();
      expect(prefs.proactiveService).toBeDefined();
    }
  });

  it("should update preferences", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.preferences.update({
      personality: "humorous",
      responseStyle: "concise",
    });

    expect(result.success).toBe(true);
  });

  it("should get available personalities", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const personalities = await caller.preferences.getPersonalities();

    expect(Array.isArray(personalities)).toBe(true);
    expect(personalities.length).toBeGreaterThan(0);
    expect(personalities[0]).toHaveProperty("id");
    expect(personalities[0]).toHaveProperty("name");
    expect(personalities[0]).toHaveProperty("traits");
  });
});

describe("memory router", () => {
  it("should list memories", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const memories = await caller.memory.list({ limit: 10 });

    expect(Array.isArray(memories)).toBe(true);
  });

  it("should create memory", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    const memory = await caller.memory.create({
      type: "preference",
      content: "测试记忆：用户喜欢简洁的回答",
      importance: 0.7,
      confidence: 0.9,
    });

    expect(memory).toBeDefined();
    if (memory) {
      expect(memory.content).toBe("测试记忆：用户喜欢简洁的回答");
      expect(memory.type).toBe("preference");
    }
  });

  it("should delete memory", async () => {
    const ctx = createAuthContext(1);
    const caller = appRouter.createCaller(ctx);

    // First create a memory
    const memory = await caller.memory.create({
      type: "fact",
      content: "临时测试记忆",
      importance: 0.5,
    });

    expect(memory).toBeDefined();

    if (memory) {
      // Then delete it
      const result = await caller.memory.delete({ id: memory.id });
      expect(result.success).toBe(true);
    }
  });
});
