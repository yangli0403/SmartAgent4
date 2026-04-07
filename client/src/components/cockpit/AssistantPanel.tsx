/**
 * AssistantPanel — 助手反馈面板组件
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
import type { ChatUiMessage } from "@shared/chatTts";
import { TtsPlayback } from "@/components/TtsPlayback";

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
        className="flex items-center gap-1 text-xs text-gray-600 bg-white/80 border border-gray-200 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-white transition-colors focus:outline-none focus:ring-1 focus:ring-gray-300"
      >
        <span>{current.emoji}</span>
        <span>{current.label}</span>
        <svg className={`w-3 h-3 ml-0.5 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg py-1 min-w-[120px] z-50">
          {CHARACTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onChange(opt.id);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-50 transition-colors ${
                opt.id === characterId ? "bg-blue-50 text-blue-600 font-medium" : "text-gray-600"
              }`}
            >
              <span className="text-sm">{opt.emoji}</span>
              <span>{opt.label}</span>
              {opt.id === characterId && (
                <svg className="w-3 h-3 ml-auto text-blue-500" fill="currentColor" viewBox="0 0 20 20">
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
      className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium bg-white/80 border border-gray-200 shadow-sm"
      title={`${tag.type}: ${tag.value}`}
    >
      <span className="text-sm">{tag.emoji}</span>
      <span className="text-gray-600">{tag.label}</span>
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
          <span className="text-sm font-medium text-gray-700">
            {parsed.primaryEmotion.label}
          </span>
          {parsed.actionCount > 0 && (
            <span className="text-xs text-gray-400 ml-1">
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
  tts?: ChatUiMessage["tts"];
  lazyTts?: boolean;
  onSynthesize?: () => void;
  isSynthesizing?: boolean;
}) {
  const parsed = parseEmotionTags(content);
  const bgClass = getEmotionBgClass(parsed.primaryEmotion?.label || null);

  return (
    <div className={`rounded-xl p-3 border ${bgClass} transition-colors`}>
      {/* 文本内容 */}
      <div className="text-sm text-gray-800 leading-relaxed">
        <Streamdown className="prose prose-sm max-w-none break-words [&>p]:my-1">
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
    <div className="rounded-xl p-3 bg-white border border-gray-200">
      <div className="flex gap-1 items-center">
        <span className="text-xs text-gray-400 mr-2">正在生成回复…</span>
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
    <div className="flex flex-col h-full bg-white/60 backdrop-blur-md rounded-2xl border border-white/50 shadow-sm overflow-hidden">
      {/* 面板标题 */}
      <div className="px-4 py-2.5 border-b border-white/30 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-medium text-gray-700">智能助手</span>
          {/* 人格切换下拉框（自定义实现，避免原生 select 事件兼容性问题） */}
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
              <p className="text-sm text-gray-400">欢迎乘车，我是您的智能助手。</p>
              <p className="text-xs text-gray-300 mt-1">
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
