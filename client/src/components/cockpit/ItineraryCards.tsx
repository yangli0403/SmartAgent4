/**
 * ItineraryCards — 行程卡片式展示组件
 *
 * 以卡片网格的形式展示行程规划结果，比时间轴更紧凑美观。
 * 每个站点显示为一个卡片，包含时间、地点、活动、交通方式等信息。
 */
import React from "react";
import { MapPin, Clock, Car, FileText, ChevronRight } from "lucide-react";

// ==================== 类型定义 ====================

export interface ItineraryStop {
  /** 时间，如 "09:00" */
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

export interface ItineraryCardsProps {
  /** 行程数据 */
  itinerary: ItineraryData;
  /** 当前进行到的站点索引（-1 表示未开始） */
  currentStopIndex?: number;
  /** 点击站点回调 */
  onStopClick?: (stop: ItineraryStop, index: number) => void;
  /** 自定义类名 */
  className?: string;
}

// ==================== 站点卡片组件 ====================

function StopCard({
  stop,
  index,
  status,
  isLast,
  onClick,
}: {
  stop: ItineraryStop;
  index: number;
  status: "completed" | "current" | "upcoming";
  isLast: boolean;
  onClick?: () => void;
}) {
  const statusStyles = {
    completed: {
      card: "bg-emerald-500/10 border-emerald-500/30",
      icon: "bg-emerald-500 text-white",
      text: "text-amber-300",
      dot: "bg-emerald-400",
    },
    current: {
      card: "bg-blue-500/15 border-blue-500/40 shadow-lg shadow-blue-500/20",
      icon: "bg-blue-500 text-white animate-pulse",
      text: "text-amber-300",
      dot: "bg-blue-400 animate-pulse",
    },
    upcoming: {
      card: "bg-white/5 border-white/10",
      icon: "bg-slate-600 text-slate-300",
      text: "text-amber-200",
      dot: "bg-slate-500",
    },
  };

  const style = statusStyles[status];

  return (
    <div className="relative flex gap-3">
      {/* 左侧时间线 */}
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${style.icon}`}>
          {status === "completed" ? "✓" : index + 1}
        </div>
        {!isLast && (
          <div className={`w-0.5 flex-1 min-h-[24px] ${status === "completed" ? "bg-orange-500/30" : "bg-orange-500/10"}`} />
        )}
      </div>

      {/* 卡片内容 */}
      <button
        type="button"
        onClick={onClick}
        className={`mb-4 flex-1 rounded-xl border p-3 text-left transition-all hover:scale-[1.01] cursor-pointer ${style.card}`}
      >
        {/* 头部：时间和地点 */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${style.text}`}>
              <Clock className="w-3 h-3 shrink-0" />
              <span>{stop.time}</span>
              <span className="text-white/40">·</span>
              <span className="text-white/60">{stop.duration}</span>
            </div>
            <h4 className="text-sm font-semibold text-amber-100 mt-1 truncate">
              {stop.location}
            </h4>
          </div>
          {onClick && (
            <ChevronRight className="w-4 h-4 text-white/30 shrink-0" />
          )}
        </div>

        {/* 活动描述 */}
        <p className="text-xs text-amber-200/80 leading-relaxed line-clamp-2 mb-2">
          {stop.activity}
        </p>

        {/* 底部信息 */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-orange-300">
          {stop.transport && (
            <span className="inline-flex items-center gap-1 bg-orange-500/20 rounded-full px-2 py-0.5 border border-orange-500/30">
              <Car className="w-3 h-3" />
              {stop.transport}
            </span>
          )}
          {stop.note && (
            <span className="inline-flex items-center gap-1 bg-orange-500/20 rounded-full px-2 py-0.5 border border-orange-500/30">
              <FileText className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{stop.note}</span>
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

// ==================== 主组件 ====================

export const ItineraryCards: React.FC<ItineraryCardsProps> = ({
  itinerary,
  currentStopIndex = -1,
  onStopClick,
  className = "",
}) => {
  const getStopStatus = (index: number): "completed" | "current" | "upcoming" => {
    if (currentStopIndex < 0) return "upcoming";
    if (index < currentStopIndex) return "completed";
    if (index === currentStopIndex) return "current";
    return "upcoming";
  };

  // 偏好标签的颜色
  const preferenceColors = [
    "bg-purple-500/20 text-purple-300 border border-purple-500/30",
    "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    "bg-pink-500/20 text-pink-300 border border-pink-500/30",
    "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
    "bg-green-500/20 text-green-300 border border-green-500/30",
  ];

  return (
    <div
      className={`rounded-xl bg-orange-950/50 border border-orange-500/20 p-4 ${className}`}
      data-testid="itinerary-cards"
    >
      {/* 头部信息 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center border border-orange-500/30">
              <MapPin className="w-4 h-4 text-orange-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-amber-100">
                {itinerary.destination}
              </h3>
              <p className="text-xs text-orange-300">{itinerary.date}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-orange-300/70">总时长</div>
            <div className="text-sm font-medium text-orange-400">{itinerary.totalDuration}</div>
          </div>
        </div>

        {/* 偏好标签 */}
        {itinerary.preferences && itinerary.preferences.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {itinerary.preferences.map((pref, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${preferenceColors[i % preferenceColors.length]}`}
              >
                {pref}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 站点卡片列表 */}
      <div className="space-y-0">
        {itinerary.stops.map((stop, index) => (
          <StopCard
            key={index}
            stop={stop}
            index={index}
            status={getStopStatus(index)}
            isLast={index === itinerary.stops.length - 1}
            onClick={onStopClick ? () => onStopClick(stop, index) : undefined}
          />
        ))}
      </div>

      {/* 底部统计 */}
      <div className="mt-4 pt-3 border-t border-orange-500/20 flex items-center justify-between text-xs text-orange-300/70">
        <span>{itinerary.stops.length} 个站点</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" /> 已完成 {Math.max(0, currentStopIndex)} 项
        </span>
      </div>
    </div>
  );
};

export default ItineraryCards;
