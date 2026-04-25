/**
 * ItineraryTimeline — 行程时间轴 UI 组件
 *
 * 以垂直时间轴的形式展示行程规划结果，每个 stop 显示为一个时间节点。
 * 支持展开/收起详情、当前进度高亮等交互。
 *
 * Props:
 * - itinerary: 行程数据（来自 generate_itinerary 工具返回）
 * - currentStopIndex: 当前进行到的站点索引（可选，用于高亮）
 * - onStopClick: 点击站点的回调（可选）
 */
import React, { useState, useCallback } from "react";

// ==================== 类型定义 ====================

export interface ItineraryStop {
  /** 时间，如 "2026-04-26 09:00" */
  time: string;
  /** 地点名称 */
  location: string;
  /** 活动描述 */
  activity: string;
  /** 预计时长，如 "2小时" */
  duration: string;
  /** 交通方式（可选） */
  transport?: string;
  /** 备注（可选） */
  note?: string;
}

export interface ItineraryData {
  /** 目的地 */
  destination: string;
  /** 日期 */
  date: string;
  /** 站点列表 */
  stops: ItineraryStop[];
  /** 总时长 */
  totalDuration: string;
  /** 偏好标签（可选） */
  preferences?: string[];
}

export interface ItineraryTimelineProps {
  /** 行程数据 */
  itinerary: ItineraryData;
  /** 当前进行到的站点索引（-1 表示未开始） */
  currentStopIndex?: number;
  /** 点击站点回调 */
  onStopClick?: (stop: ItineraryStop, index: number) => void;
  /** 自定义类名 */
  className?: string;
}

// ==================== 组件实现 ====================

export const ItineraryTimeline: React.FC<ItineraryTimelineProps> = ({
  itinerary,
  currentStopIndex = -1,
  onStopClick,
  className = "",
}) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const toggleExpand = useCallback(
    (index: number) => {
      setExpandedIndex((prev) => (prev === index ? null : index));
    },
    []
  );

  const getStopStatus = (index: number): "completed" | "current" | "upcoming" => {
    if (currentStopIndex < 0) return "upcoming";
    if (index < currentStopIndex) return "completed";
    if (index === currentStopIndex) return "current";
    return "upcoming";
  };

  const getStatusColor = (status: "completed" | "current" | "upcoming") => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "current":
        return "bg-blue-500 animate-pulse";
      case "upcoming":
        return "bg-gray-300 dark:bg-gray-600";
    }
  };

  const getStatusLineColor = (status: "completed" | "current" | "upcoming") => {
    switch (status) {
      case "completed":
        return "bg-green-300";
      case "current":
        return "bg-blue-300";
      case "upcoming":
        return "bg-gray-200 dark:bg-gray-700";
    }
  };

  return (
    <div
      className={`itinerary-timeline rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 ${className}`}
      data-testid="itinerary-timeline"
    >
      {/* 头部信息 */}
      <div className="mb-4 border-b border-gray-100 dark:border-gray-700 pb-3">
        <h3
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          data-testid="itinerary-title"
        >
          {itinerary.destination} 行程
        </h3>
        <div className="mt-1 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <span data-testid="itinerary-date">
            📅 {itinerary.date}
          </span>
          <span data-testid="itinerary-duration">
            ⏱️ 总时长 {itinerary.totalDuration}
          </span>
          <span data-testid="itinerary-stops-count">
            📍 {itinerary.stops.length} 个站点
          </span>
        </div>
        {itinerary.preferences && itinerary.preferences.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {itinerary.preferences.map((pref, i) => (
              <span
                key={i}
                className="inline-block rounded-full bg-blue-100 dark:bg-blue-900 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
              >
                {pref}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 时间轴 */}
      <div className="relative" data-testid="timeline-container">
        {itinerary.stops.map((stop, index) => {
          const status = getStopStatus(index);
          const isExpanded = expandedIndex === index;
          const isLast = index === itinerary.stops.length - 1;

          return (
            <div
              key={index}
              className="relative flex gap-3"
              data-testid={`timeline-stop-${index}`}
            >
              {/* 时间轴线和节点 */}
              <div className="flex flex-col items-center">
                {/* 节点圆点 */}
                <button
                  className={`z-10 h-3 w-3 rounded-full ${getStatusColor(status)} shrink-0 cursor-pointer transition-transform hover:scale-125`}
                  onClick={() => {
                    toggleExpand(index);
                    onStopClick?.(stop, index);
                  }}
                  aria-label={`站点 ${index + 1}: ${stop.location}`}
                  data-testid={`timeline-node-${index}`}
                />
                {/* 连接线 */}
                {!isLast && (
                  <div
                    className={`w-0.5 flex-1 ${getStatusLineColor(status)} min-h-[40px]`}
                  />
                )}
              </div>

              {/* 站点内容 */}
              <div
                className={`mb-4 flex-1 rounded-md border px-3 py-2 transition-all ${
                  status === "current"
                    ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20"
                    : "border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
                }`}
              >
                {/* 基本信息 */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                      {stop.time}
                    </span>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {stop.location}
                    </h4>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                    {stop.duration}
                  </span>
                </div>

                {/* 活动描述 */}
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {stop.activity}
                </p>

                {/* 展开详情 */}
                {isExpanded && (stop.transport || stop.note) && (
                  <div
                    className="mt-2 border-t border-gray-100 dark:border-gray-700 pt-2 text-xs text-gray-500 dark:text-gray-400"
                    data-testid={`timeline-detail-${index}`}
                  >
                    {stop.transport && (
                      <p>🚗 交通方式: {stop.transport}</p>
                    )}
                    {stop.note && <p>📝 备注: {stop.note}</p>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ItineraryTimeline;
