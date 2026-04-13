/**
 * AIRI Bridge 状态面板 — BridgeStatusPanel
 *
 * 显示后端 AIRI Bridge 的连接状态，提供手动连接/断开控制。
 * 使用现有的 airi.* tRPC 路由获取状态。
 *
 * 关联用户测试用例：UTC-016, UTC-017
 */

import React, { useState } from "react";

/** 组件 Props */
interface BridgeStatusPanelProps {
  /** 是否默认展开 */
  defaultExpanded?: boolean;
  /** 容器 CSS 类名 */
  className?: string;
}

/** Bridge 连接状态类型 */
type BridgeStatus = "connected" | "disconnected" | "connecting" | "error";

/** 状态颜色映射 */
const STATUS_COLORS: Record<BridgeStatus, string> = {
  connected: "bg-green-500",
  disconnected: "bg-gray-400",
  connecting: "bg-yellow-500",
  error: "bg-red-500",
};

/** 状态文字映射 */
const STATUS_LABELS: Record<BridgeStatus, string> = {
  connected: "已连接",
  disconnected: "未连接",
  connecting: "连接中...",
  error: "连接错误",
};

/**
 * AIRI Bridge 状态面板
 */
export function BridgeStatusPanel({
  defaultExpanded = false,
  className = "",
}: BridgeStatusPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [status, setStatus] = useState<BridgeStatus>("disconnected");
  const [isLoading, setIsLoading] = useState(false);

  /**
   * 手动连接 AIRI Bridge
   * 注意：实际实现将使用 tRPC 调用 airi.connect
   */
  const handleConnect = async () => {
    setIsLoading(true);
    setStatus("connecting");
    try {
      // TODO: 接入 tRPC airi.connect
      // await trpc.airi.connect.mutate();
      setStatus("connected");
    } catch {
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 手动断开 AIRI Bridge
   */
  const handleDisconnect = async () => {
    setIsLoading(true);
    try {
      // TODO: 接入 tRPC airi.disconnect
      // await trpc.airi.disconnect.mutate();
      setStatus("disconnected");
    } catch {
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${className}`}>
      {/* 标题栏（始终可见） */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
          <span className="text-sm font-medium">AIRI Bridge</span>
          <span className="text-xs text-gray-500">{STATUS_LABELS[status]}</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-3 py-2 border-t bg-white">
          <div className="space-y-2">
            {/* 状态详情 */}
            <div className="text-xs text-gray-500">
              <div className="flex justify-between">
                <span>连接状态</span>
                <span className="font-mono">{status}</span>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2">
              {status === "disconnected" || status === "error" ? (
                <button
                  onClick={handleConnect}
                  disabled={isLoading}
                  className="flex-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {isLoading ? "连接中..." : "连接"}
                </button>
              ) : status === "connected" ? (
                <button
                  onClick={handleDisconnect}
                  disabled={isLoading}
                  className="flex-1 px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                >
                  {isLoading ? "断开中..." : "断开"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
