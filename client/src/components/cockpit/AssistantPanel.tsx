/**
 * AssistantPanel — 助手反馈面板组件（暗色车机风格）
 *
 * 车机中控屏右侧面板，展示 AI 回复内容及情感标签可视化。
 * 输入框已移至顶部 ASR 区域，本组件仅负责消息列表展示。
 */

import { useRef, useEffect, useState } from "react";
import {
  parseEmotionTags,
  getEmotionBgClass,
  groupTagsByType,
  type ParsedMessage,
  type EmotionTag,
} from "@/lib/emotionParser";
import { Streamdown } from "streamdown";
import type { ChatUiAssistantMessage, ChatUiMessage, ChatUiThinkingMessage } from "@shared/chatTts";
import { ThinkingBubble } from "./ThinkingBubble";
import { TtsPlayback } from "@/components/TtsPlayback";
import { ItineraryCards } from "./ItineraryCards";

// ==================== Markdown 表格解析 ====================

interface ParsedTableRow {
  time: string;
  type: string;
  location: string;
  activity: string;
  transport: string;
}

interface ParsedItinerary {
  header: string;  // "作息：07:30 起床，23:00 就寝"
  dayTitle: string;  // "## 第1天（2026-05-07）"
  rows: ParsedTableRow[];
  footer?: string;  // 表格后的内容
}

/**
 * 解析 markdown 表格，提取行程数据
 */
function parseItineraryTable(content: string): ParsedItinerary | null {
  // 匹配作息信息
  const headerMatch = content.match(/作[息息]：(\d{2}:\d{2})[^，,]*[，起床]*,[^，,]*(\d{2}:\d{2})/);
  
  // 匹配 ## 第X天 标题
  const dayTitleMatch = content.match(/(##\s*第\d+天[（(][^）)]*[）)]?)/);
  
  // 匹配表格行
  const tableMatch = content.match(/\|[^|]+\|([^|]+\|)+/g);
  if (!tableMatch || tableMatch.length < 2) return null;

  const rows: ParsedTableRow[] = [];
  
  // 跳过表头和分隔符行，从第三行开始解析
  for (let i = 2; i < tableMatch.length; i++) {
    const row = tableMatch[i].split('|').filter(cell => cell.trim());
    if (row.length >= 4) {
      rows.push({
        time: (row[0] || "").trim(),
        type: (row[1] || "").trim(),
        location: (row[2] || "").trim(),
        activity: (row[3] || "").trim(),
        transport: (row[4] || "").trim() || "-",
      });
    }
  }

  if (rows.length === 0) return null;

  // 提取作息信息
  const wakeMatch = content.match(/作[息息]：(\d{2}:\d{2})/);
  const sleepMatch = content.match(/(\d{2}:\d{2})\s*就[寝卧]/);
  
  // 提取表格后的内容
  const lastTableIndex = content.lastIndexOf(tableMatch[tableMatch.length - 1]);
  const footer = content.slice(lastTableIndex + tableMatch[tableMatch.length - 1].length).trim();

  return {
    header: headerMatch ? `作息：${headerMatch[1]} 起床，${headerMatch[2]} 就寝` : "",
    dayTitle: dayTitleMatch ? dayTitleMatch[1].replace(/^##\s*/, '') : "",
    rows,
    footer: footer.startsWith('---') ? footer.slice(footer.indexOf('---') + 3).trim() : footer,
  };
}

/**
 * 将行程表格渲染为卡片
 */
function ItineraryTableRenderer({ content }: { content: string }) {
  const parsed = parseItineraryTable(content);
  
  if (!parsed) {
    // 如果解析失败，回退到原始 markdown
    return (
      <Streamdown className="prose prose-sm prose-invert max-w-none break-words [&>p]:my-1 [&>table]:w-full [&>table]:text-xs">
        {content}
      </Streamdown>
    );
  }

  // 转换数据格式
  const stops = parsed.rows.map((row) => ({
    time: row.time.split('-')[0] || row.time,
    location: row.location,
    activity: row.activity,
    duration: "",
    transport: row.transport !== "-" ? row.transport : undefined,
  }));

  // 提取目的地（从标题中）
  const destMatch = content.match(/#\s*([^#\n]+?)\s*\d+日/);
  const destination = destMatch ? destMatch[1].trim() : "行程";

  // 提取日期
  const dateMatch = content.match(/（(\d{4}-\d{2}-\d{2})）/);
  const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

  const itineraryData = {
    destination,
    date,
    stops,
    totalDuration: parsed.rows.length > 0 ? `${parsed.rows.length}个站点` : "",
  };

  return (
    <div className="space-y-3">
      {/* 作息信息 */}
      {parsed.header && (
        <div className="text-xs text-white/50 flex items-center gap-2">
          <span className="bg-white/10 rounded-full px-2 py-0.5">⏰ {parsed.header}</span>
        </div>
      )}
      
      {/* 卡片 */}
      <ItineraryCards itinerary={itineraryData} />
      
      {/* 表格后的说明文字 */}
      {parsed.footer && !parsed.footer.startsWith('*') && (
        <div className="text-xs text-white/60 px-1">
          <Streamdown className="prose prose-sm prose-invert max-w-none break-words [&>p]:my-1">
            {parsed.footer.replace(/\*+$/, '').trim()}
          </Streamdown>
        </div>
      )}
    </div>
  );
}

// ==================== 类型 ====================

interface AssistantPanelProps {
  messages: ChatUiMessage[];
  isPending: boolean;
  characterId?: string;
  onCharacterChange?: (id: string) => void;
  /** 传入后助手消息显示「生成语音」，点击再调 TTS（不阻塞文字） */
  onSynthesizeAssistantTts?: (messageIndex: number, content: string) => void;
  synthesizingMessageIndex?: number | null;
}

// 人格选项配置
const CHARACTER_OPTIONS = [
  { id: "xiaozhi", label: "小智", emoji: "🤖" },
  { id: "jarvis",  label: "Jarvis", emoji: "🔵" },
  { id: "alfred", label: "Alfred", emoji: "🎩" },
];

// ==================== 人格切换下拉框组件 ====================

function CharacterSelector({
  characterId,
  onChange,
}: {
  characterId: string;
  onChange: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = CHARACTER_OPTIONS.find((o) => o.id === characterId) || CHARACTER_OPTIONS[0];

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="ml-auto relative" ref={dropdownRef}>
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-white/70 bg-white/10 border border-white/15 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-white/20 transition-colors focus:outline-none focus:ring-1 focus:ring-white/30"
      >
        <span>{current.emoji}</span>
        <span>{current.label}</span>
        <svg className={`w-3 h-3 ml-0.5 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 bg-[#1e2d3d] rounded-lg border border-white/15 shadow-lg py-1 min-w-[120px] z-50">
          {CHARACTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onChange(opt.id);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-white/10 transition-colors ${
                opt.id === characterId ? "bg-blue-500/20 text-blue-300 font-medium" : "text-white/70"
              }`}
            >
              <span className="text-sm">{opt.emoji}</span>
              <span>{opt.label}</span>
              {opt.id === characterId && (
                <svg className="w-3 h-3 ml-auto text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== 情感标签展示组件 ====================

function EmotionBadge({ tag }: { tag: EmotionTag }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium bg-white/10 border border-white/15 shadow-sm"
      title={`${tag.type}: ${tag.value}`}
    >
      <span className="text-sm">{tag.emoji}</span>
      <span className="text-white/60">{tag.label}</span>
    </span>
  );
}

function EmotionDisplay({ parsed }: { parsed: ParsedMessage }) {
  if (parsed.tags.length === 0) return null;

  const groups = groupTagsByType(parsed.tags);

  return (
    <div className="mt-2 space-y-1.5">
      {/* 主情感行 */}
      {parsed.primaryEmotion && (
        <div className="flex items-center gap-2">
          <span className="text-lg">{parsed.primaryEmotion.emoji}</span>
          <span className="text-sm font-medium text-white/80">
            {parsed.primaryEmotion.label}
          </span>
          {parsed.actionCount > 0 && (
            <span className="text-xs text-white/40 ml-1">
              {parsed.actionCount} 个动作~
            </span>
          )}
        </div>
      )}

      {/* 动作标签列表 */}
      <div className="flex flex-wrap gap-1">
        {Object.entries(groups).map(([groupName, tags]) =>
          tags.map((tag, i) => (
            <EmotionBadge key={`${groupName}-${i}`} tag={tag} />
          ))
        )}
      </div>
    </div>
  );
}

// ==================== 单条消息组件 ====================

function AssistantMessage({
  content,
  tts,
  lazyTts,
  onSynthesize,
  isSynthesizing,
}: {
  content: string;
  tts?: ChatUiAssistantMessage["tts"];
  lazyTts?: boolean;
  onSynthesize?: () => void;
  isSynthesizing?: boolean;
}) {
  const parsed = parseEmotionTags(content);

  // 检测行程 JSON
  const itineraryMatch = content.match(/```json\s*(\{[\s\S]*?"itinerary"[\s\S]*?\})\s*```/);
  const inlineItineraryMatch = content.match(/"itinerary"\s*:\s*\{[\s\S]*?"destination"[\s\S]*?"days"\s*:\s*\[[\s\S]*?\]\}/);
  
  if (itineraryMatch || inlineItineraryMatch) {
    const jsonStr = itineraryMatch?.[1] || inlineItineraryMatch?.[0];
    if (jsonStr) {
      try {
        // 提取 formattedText 部分作为主要内容
        const fullMatch = content.match(/(\{[\s\S]*\})/);
        if (fullMatch) {
          const parsed2 = JSON.parse(fullMatch[1]);
          const itData = parsed2.itinerary || parsed2;
          
          // 如果有 structuredItinerary 字段
          if (itData.days && Array.isArray(itData.days)) {
            // 将 days 结构转换为 ItineraryCards 需要的格式
            const allStops = itData.days.flatMap((day: any) =>
              (day.stops || []).map((stop: any) => ({
                time: stop.timeStart || stop.time || "",
                location: stop.location || "",
                activity: stop.activity || "",
                duration: stop.durationMin ? `${stop.durationMin}分钟` : (stop.duration || ""),
                transport: stop.transitInfo,
                note: stop.address,
              }))
            );
            
            const itineraryData = {
              destination: itData.destination || "行程",
              date: itData.days?.[0]?.date || new Date().toISOString().split("T")[0],
              stops: allStops,
              totalDuration: itData.totalDays ? `${itData.totalDays}天` : (itData.summary || ""),
              preferences: itData.preferences,
            };
            
            return (
              <div className="rounded-xl p-3 bg-white/8 border border-white/10 backdrop-blur-sm">
                <ItineraryCards itinerary={itineraryData} />
                {/* 显示摘要 */}
                {itData.summary && (
                  <p className="mt-2 text-xs text-white/50 italic">{itData.summary}</p>
                )}
                {/* 显示 formattedText 中的其他内容 */}
                {parsed2.formattedText && (
                  <div className="mt-2 text-sm text-white/70">
                    <Streamdown className="prose prose-sm prose-invert max-w-none break-words [&>p]:my-1">
                      {parsed2.formattedText.replace(/```json\s*\{[\s\S]*?```/m, "").trim()}
                    </Streamdown>
                  </div>
                )}
              </div>
            );
          }
        }
      } catch (e) {
        // JSON 解析失败，回退到纯文本渲染
        console.warn("[AssistantMessage] Failed to parse itinerary JSON:", e);
      }
    }
  }

  // 检测行程表格（markdown 格式）
  const hasMarkdownTable = /\| ?时间 ?\|/.test(content);
  
  if (hasMarkdownTable) {
    return (
      <div className="rounded-xl p-3 bg-white/8 border border-white/10 backdrop-blur-sm transition-colors">
        <ItineraryTableRenderer content={content} />
        {/* 情感标签 */}
        <EmotionDisplay parsed={parsed} />
        {(lazyTts || tts) && (
          <TtsPlayback
            tts={tts}
            lazy={Boolean(lazyTts && !tts)}
            onSynthesize={onSynthesize}
            isSynthesizing={isSynthesizing}
          />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl p-3 bg-white/8 border border-white/10 backdrop-blur-sm transition-colors">
      {/* 文本内容 */}
      <div className="text-sm text-white/85 leading-relaxed">
        <Streamdown className="prose prose-sm prose-invert max-w-none break-words [&>p]:my-1">
          {parsed.cleanText}
        </Streamdown>
      </div>

      {/* 情感标签可视化 */}
      <EmotionDisplay parsed={parsed} />

      {(lazyTts || tts) && (
        <TtsPlayback
          tts={tts}
          lazy={Boolean(lazyTts && !tts)}
          onSynthesize={onSynthesize}
          isSynthesizing={isSynthesizing}
        />
      )}
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="rounded-xl p-3 bg-blue-500 text-white">
      <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
    </div>
  );
}

// ==================== 加载动画 ====================

function LoadingDots() {
  return (
    <div className="rounded-xl p-3 bg-white/8 border border-white/10">
      <div className="flex gap-1 items-center">
        <span className="text-xs text-white/40 mr-2">正在生成回复…</span>
        {[0, 150, 300].map((d) => (
          <div
            key={d}
            className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ==================== 主组件 ====================

export default function AssistantPanel({
  messages,
  isPending,
  characterId = "xiaozhi",
  onCharacterChange,
  onSynthesizeAssistantTts,
  synthesizingMessageIndex = null,
}: AssistantPanelProps) {
  // 只取最近的消息用于展示
  const recentMessages = messages.slice(-20);

  // 自动滚动到底部
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPending]);

  return (
    <div className="flex flex-col h-full bg-[#1a2a3a]/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
      {/* 面板标题 */}
      <div className="px-4 py-2.5 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-medium text-white/80">智能助手</span>
          {/* 人格切换下拉框 */}
          {onCharacterChange && (
            <CharacterSelector
              characterId={characterId}
              onChange={onCharacterChange}
            />
          )}
        </div>
      </div>

      {/* 消息列表（可滚动区域，占满全部剩余高度） */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-3">
          {recentMessages.length === 0 && !isPending && (
            <div className="text-center py-8">
              <div className="text-3xl mb-2">🚗</div>
              <p className="text-sm text-white/40">欢迎乘车，我是您的智能助手。</p>
              <p className="text-xs text-white/25 mt-1">
                请在顶部输入消息开始对话
              </p>
            </div>
          )}

          {recentMessages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[95%] ${msg.role === "user" ? "max-w-[80%]" : ""}`}>
                {msg.role === "assistant" ? (
                  <AssistantMessage
                    content={msg.content}
                    tts={msg.tts}
                    lazyTts={Boolean(onSynthesizeAssistantTts)}
                    onSynthesize={
                      onSynthesizeAssistantTts
                        ? () => onSynthesizeAssistantTts(idx, msg.content)
                        : undefined
                    }
                    isSynthesizing={synthesizingMessageIndex === idx}
                  />
                ) : msg.role === "thinking" ? (
                  <ThinkingBubble message={msg as ChatUiThinkingMessage} />
                ) : (
                  <UserMessage content={msg.content} />
                )}
              </div>
            </div>
          ))}

          {isPending && (
            <div className="flex justify-start">
              <LoadingDots />
            </div>
          )}

          {/* 滚动锚点 */}
          <div ref={scrollEndRef} />
        </div>
      </div>
    </div>
  );
}
