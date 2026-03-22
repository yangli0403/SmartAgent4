/**
 * MemoryCards — 智能记忆卡片组件
 *
 * 与会话管理卡片等宽等高（w-72 h-44），样式统一。
 * 白色半透明毛玻璃卡片，圆角，分类标签 + 记忆文本。
 * 支持：实时刷新（每 3 秒轮询）、超出内容可上下滚动。
 */

import { trpc } from "@/lib/trpc";

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
  const skipOAuth = import.meta.env.VITE_SKIP_OAUTH === "true";

  // 每 3 秒自动刷新，确保新记忆实时呈现
  const queryOptions = {
    enabled: skipOAuth,
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
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <div className="w-2 h-2 rounded-full bg-gray-800" />
        <span className="text-sm font-medium text-gray-700">智能记忆</span>
        {allMemories.length > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">
            {allMemories.length} 条
          </span>
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
