import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  // 测试模式：如果跳过 OAuth，允许继续（即使 user 为 null，context 会创建测试用户）
  const SKIP_AUTH = process.env.SKIP_AUTH === "true" || process.env.VITE_SKIP_OAUTH === "true";
  
  if (!ctx.user && !SKIP_AUTH) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // 如果跳过认证但 user 为 null，尝试获取测试用户
  let user = ctx.user;
  if (!user && SKIP_AUTH) {
    // 这里应该已经在 context 中创建了，但如果还是 null，允许继续（会在 router 中处理）
    console.warn("[Auth] Test mode: user is null, proceeding anyway");
  }

  return next({
    ctx: {
      ...ctx,
      user: user || ctx.user, // 使用现有 user 或保持 null（router 会处理）
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
