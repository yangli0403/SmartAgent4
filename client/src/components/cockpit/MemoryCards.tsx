/**
 * MemoryCards — 用户记忆卡片组件
 *
 * 与会话管理卡片等宽等高（w-72 h-44），样式统一。
 * 白色半透明毛玻璃卡片，圆角，分类标签 + 记忆文本。
 * 支持：实时刷新（每 3 秒轮询）、超出内容可上下滚动、手动触发记忆后台任务。
 */

import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

// ==================== 类型标签配置 ====================

const TYPE_BADGE: Record<
  string,
  { label: string; bgClass: string; textClass: string }
> = {
  fact: { label: "事实", bgClass: "bg-blue-500", textClass: "text-white" },
  behavior: { label: "行为", bgClass: "bg-green-500", textClass: "text-white" },
  preference: { label: "偏好", bgClass: "bg-pink-500", textClass: "text-white" },
  emotion: { label: "情绪", bgClass: "bg-purple-500", textClass: "text-white" },
};

const KIND_BADGE: Record<
  string,
  { label: string; bgClass: string; textClass: string }
> = {
  episodic: { label: "情景", bgClass: "bg-orange-500", textClass: "text-white" },
  semantic: { label: "语义", bgClass: "bg-blue-500", textClass: "text-white" },
  persona: { label: "人格", bgClass: "bg-purple-500", textClass: "text-white" },
};

// ==================== 单条记忆行 ====================

function MemoryRow({
  type,
  content,
}: {
  type: string;
  content: string;
}) {
  const badge = TYPE_BADGE[type] || KIND_BADGE[type] || {
    label: type,
    bgClass: "bg-gray-500",
    textClass: "text-white",
  };

  return (
    <div className="flex items-start gap-2">
      <span
        className={`flex-shrink-0 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.bgClass} ${badge.textClass}`}
      >
        {badge.label}
      </span>
      <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">
        {content}
      </p>
    </div>
  );
}

// ==================== 主组件 ====================

export default function MemoryCards() {
  const { isAuthenticated } = useAuth();
  const skipOAuth = import.meta.env.VITE_SKIP_OAUTH === "true";
  const memoryEnabled = isAuthenticated || skipOAuth;

  const utils = trpc.useUtils();

  const runMaintenance = trpc.memory.runMaintenance.useMutation({
    onSuccess: (r) => {
      toast.success(
        [
          `巩固约 ${r.consolidationCount} 条，遗忘处理 ${r.forgettingCount} 条。`,
          `预取缓存清理过期 ${r.prefetchCacheExpiredRemoved} 条。`,
          r.prediction.message,
        ].join(" ")
      );
      void utils.memory.list.invalidate();
    },
    onError: (e) => toast.error("后台任务失败：" + e.message),
  });

  // 每 3 秒自动刷新，确保新记忆实时呈现
  const queryOptions = {
    enabled: memoryEnabled,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  };

  const { data: episodic = [] } = trpc.memory.list.useQuery(
    { kind: "episodic", limit: 20 },
    queryOptions
  );
  const { data: semantic = [] } = trpc.memory.list.useQuery(
    { kind: "semantic", limit: 20 },
    queryOptions
  );
  const { data: persona = [] } = trpc.memory.list.useQuery(
    { kind: "persona", limit: 20 },
    queryOptions
  );

  // 合并所有记忆，按 updatedAt 降序排列（最新在前）
  const allMemories = [
    ...episodic.map((m: any) => ({ ...m, kind: "episodic" })),
    ...semantic.map((m: any) => ({ ...m, kind: "semantic" })),
    ...persona.map((m: any) => ({ ...m, kind: "persona" })),
  ].sort((a: any, b: any) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });

  return (
    <div className="w-72 h-44 bg-white/70 backdrop-blur-md rounded-2xl border border-white/50 shadow-sm p-4 flex flex-col">
      {/* 标题行 */}
      <div className="flex items-center gap-2 mb-2 shrink-0 w-full min-w-0">
        <div className="w-2 h-2 rounded-full bg-gray-800 shrink-0" />
        <span className="text-sm font-medium text-gray-700 shrink-0">用户记忆</span>
        <span className="flex-1 min-w-0" />
        {allMemories.length > 0 && (
          <span className="text-[10px] text-gray-400 shrink-0">
            {allMemories.length} 条
          </span>
        )}
        {memoryEnabled && (
          <button
            type="button"
            title="立即执行：记忆巩固、遗忘衰减、意图预测+预取、预取缓存过期清理（对应后台定时任务，便于调试）"
            disabled={runMaintenance.isPending}
            onClick={() => runMaintenance.mutate({ all: true })}
            className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-gray-300/80 bg-white/90 px-2 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50 hover:text-gray-800 disabled:opacity-50"
          >
            {runMaintenance.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : null}
            立即处理
          </button>
        )}
      </div>

      {/* 记忆列表（可滚动区域） */}
      <div className="flex-1 overflow-y-auto pr-0.5">
        {allMemories.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-400">
              暂无记忆，对话后自动积累
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {allMemories.map((mem: any, idx: number) => (
              <MemoryRow
                key={mem.id || idx}
                type={mem.type || mem.kind}
                content={mem.content}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
