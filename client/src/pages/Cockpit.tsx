/**
 * Cockpit — 车机中控屏主界面
 *
 * 布局参考截图（面壁智能/元驰奕境车机界面）：
 *   - 整体背景：浅灰渐变，车辆融入背景
 *   - 左上角：品牌名 "元驰奕境" + 副标题
 *   - 顶部中央：主驾/副驾语音按钮 + ASR 输入框（模拟车机语音识别显示区）
 *   - 右上角：用户头像 + 设置
 *   - 中间主体：车辆模型（作为背景图融入）
 *   - 右侧：助手反馈面板（仅含对话列表，无输入框）
 *   - 底部：等宽等高固定小卡片（会话管理 + 用户记忆）
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useState, useRef, useEffect } from "react";
import { useSupervisorStream } from "@/hooks/useSupervisorStream";
import { Link } from "wouter";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";
import { Send, Settings, Mic, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import AssistantPanel from "@/components/cockpit/AssistantPanel";
import type { ChatUiMessage } from "@shared/chatTts";
import MemoryCards from "@/components/cockpit/MemoryCards";
import { RealtimeAsrSession } from "@/lib/realtimeAsrStream";
import { AiriStageContainer } from "@/components/airi-stage/AiriStageContainer";
import { AiriStatusOverlay } from "@/components/airi-stage/AiriStatusOverlay";
import {
  dispatchAssistantStageReply,
  notifyThinking,
  notifyToolRunning,
  notifySuccess,
  notifyError,
  notifyIdle,
  notifyListening,
  notifyTtsStart,
  notifyTtsStop,
} from "@/lib/airi-stage";
import { useOmniMode, type UseOmniModeOptions } from "@/hooks/useOmniMode";

// ==================== 文本噪声清理（Omni TTS 专用）====================

/**
 * 清理 Omni 回复文本中的噪声字符，防止被 TTS 错误播报。
 * 过滤：Windows路径(~1)、URL、邮箱、Markdown表格头、特殊符号等。
 */
function cleanTextForTts(text: string): string {
  return text
    // 移除 Windows 临时路径 ~1、~2 等
    .replace(/~[\d]+\b/g, "")
    // 移除 URL
    .replace(/https?:\/\/[^\s，、。！？;；]+/g, "")
    // 移除邮箱
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "")
    // 移除 Markdown 表格头行 |---|---|
    .replace(/^\|[-| :]+\|[\s\S]*?$/gm, "")
    // 移除 Markdown 图片语法 ![alt](url)
    .replace(/!\[.*?\]\(.*?\)/g, "")
    // 移除 Markdown 链接语法 [text](url)
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
    // 移除 Markdown 代码块标记
    .replace(/```[\s\S]*?```/g, "")
    // 移除行内代码
    .replace(/`[^`]+`/g, "")
    // 移除 Markdown 标题符号（保留文字）
    .replace(/^#{1,6}\s+/gm, "")
    // 移除 Markdown 加粗/斜体标记
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    // 移除连续的 | 分隔符行
    .replace(/^\|[\s|*\-:]+\|$/gm, "")
    // 移除多行连续空行
    .replace(/\n{3,}/g, "\n\n")
    // 移除行首行尾多余空白
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n")
    .trim();
}

/**
 * 从 LLM 回复中提取摘要并调用本地 TTS 合成播放。
 * 优先使用本地 Piper TTS（local-voice-service），失败则尝试 Emotions-System。
 * 摘要策略：取第一个完整句子（句号/问号/感叹号结尾），最多 150 字。
 */
/**
 * 从 LLM 回复中智能提取 TTS 播报内容。
 * 策略：短对话完整播报，行程/表格提取关键信息，天气数据提取数字+结论，其他取第一句。
 */
async function extractSummary(text: string): Promise<string> {
  if (!text) return "";

  let cleanText = text
    // 移除思考过程，避免把内部推理内容送入 TTS。
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    // 移除代码块、Markdown 表格与表格分隔线。
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$/gm, "")
    // Markdown 链接仅保留可读文本，不播报 URL。
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (!cleanText) return "执行完毕，请查看详细结果。";

  // 策略 A：如果回复中已经给出明确总结，只合成总结引导句，避免播报全文。
  const summaryMatch = cleanText.match(/(总而言之|简单来说|综上所述|总结一下|整体来看|概括来说)[：:，,\s]*(.*?)(?=\n|$)/);
  if (summaryMatch) {
    const summary = `${summaryMatch[1]}，${summaryMatch[2] || ""}`.trim();
    if (summary.length <= 100) return summary;
    const truncated = summary.substring(0, 100);
    const lastPunc = Math.max(
      truncated.lastIndexOf("。"),
      truncated.lastIndexOf("！"),
      truncated.lastIndexOf("？"),
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?")
    );
    return lastPunc > 50 ? truncated.substring(0, lastPunc + 1) : `${truncated}……`;
  }

  // 策略 B：短对话保留完整播报，但跳过标题、表格、列表等结构化内容。
  const isPlainShortReply =
    cleanText.length <= 80 &&
    !/^#{1,6}\s/m.test(cleanText) &&
    !/^\s*(?:[-*+]|\d+[.)]|[一二三四五六七八九十]+[、.])\s+/m.test(cleanText);
  if (isPlainShortReply) return cleanText;

  // 策略 C：取第一段有实质内容的自然语言；过滤标题、列表项、引用、表格残留等结构化文本。
  const paragraphs = cleanText
    .split(/\n+/)
    .map((p) => p.replace(/^#{1,6}\s*/, "").trim())
    .filter((p) => {
      if (!p) return false;
      if (/^\s*(?:[-*+]|\d+[.)]|[一二三四五六七八九十]+[、.])\s+/.test(p)) return false;
      if (/^>\s*/.test(p)) return false;
      if (/^\|.*\|$/.test(p)) return false;
      if (/^[-=]{3,}$/.test(p)) return false;
      return /[\u4e00-\u9fa5A-Za-z0-9]/.test(p);
    });

  if (paragraphs.length === 0) {
    return "执行完毕，请查看详细结果。";
  }

  let summary = paragraphs[0];

  // 如果第一段只是“好的”“已完成”等极短承接语，则拼接下一段核心内容。
  if (summary.length < 10 && paragraphs.length > 1) {
    summary = `${summary}，${paragraphs[1]}`;
  }

  // 严格控制合成长度，优先在 100 字内完整断句，防止长列表/长分析进入 TTS。
  if (summary.length > 100) {
    const truncated = summary.substring(0, 100);
    const lastPunc = Math.max(
      truncated.lastIndexOf("。"),
      truncated.lastIndexOf("！"),
      truncated.lastIndexOf("？"),
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?")
    );
    summary = lastPunc > 50 ? truncated.substring(0, lastPunc + 1) : `${truncated}……`;
  }

  return summary;
}
let _localTtsCache: Map<string, string> = new Map();

async function playLocalTtsSummary(fullResponse: string): Promise<void> {
  if (!fullResponse.trim()) return;

  const cleaned = cleanTextForTts(fullResponse);
  const summary = await extractSummary(cleaned);
  if (!summary) return;

  // 缓存：相同摘要不重复合成
  const cached = _localTtsCache.get(summary);
  if (cached) {
    console.log(`[LocalTTS] 使用缓存摘要: "${summary}"`);
    try {
      await playBase64Audio(cached);
      return;
    } catch (e) {
      console.warn("[LocalTTS] 缓存音频播放失败:", e);
    }
  }
  // 尝试本地 TTS（local-voice-service Piper）
  try {
    const res = await fetch("http://127.0.0.1:8001/api/local-tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summary }),
    });
    if (res.ok) {
      const data = await res.json() as { audioBase64?: string };
      if (data.audioBase64) {
        _localTtsCache.set(summary, data.audioBase64);
        console.log(`[LocalTTS] 本地 TTS 合成成功: "${summary}"`);
        await playBase64Audio(data.audioBase64);
        return;
      }
    }
    console.warn("[LocalTTS] 本地 TTS 返回为空，尝试 Emotions-System");
  } catch {
    console.warn("[LocalTTS] 本地 TTS 服务不可用，尝试 Emotions-System");
  }

  // Fallback：调用 Emotions-System TTS
  try {
    const res = await fetch("/api/tts/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summary }),
    });
    if (res.ok) {
      const data = await res.json() as { audio_base64?: string; audioBase64?: string };
      const b64 = data.audio_base64 || data.audioBase64 || "";
      if (b64) {
        _localTtsCache.set(summary, b64);
        console.log(`[LocalTTS] Emotions TTS 合成成功: "${summary}"`);
        await playBase64Audio(b64);
      }
    }
  } catch (e) {
    console.warn("[LocalTTS] Emotions TTS 也失败了:", e);
  }
}

async function playBase64Audio(base64Data: string): Promise<void> {
  try {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const isWav = bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
    const ctx = new AudioContext();
    await ctx.resume();

    if (isWav) {
      // WAV 文件自带采样率头信息，必须交给浏览器解码，避免把 22050Hz 误当作 16000Hz 播放导致变慢、降调。
      const wavBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const audioBuffer = await ctx.decodeAudioData(wavBuffer.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      notifyTtsStart(Math.max(0, audioBuffer.duration * 1000));
      try {
        await new Promise<void>((resolve, reject) => {
          src.onended = () => resolve();
          try {
            src.start();
          } catch (error) {
            reject(error);
          }
        });
      } finally {
        notifyTtsStop();
        void ctx.close().catch(() => {});
      }
      return;
    }

    // 非 WAV 兜底按 CosyVoice 默认 PCM 采样率播放；在线 TTS 通常返回 WAV，会走上面的解码分支。
    const fallbackSampleRate = 22050;
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, fallbackSampleRate);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    notifyTtsStart(Math.max(0, buf.duration * 1000));
    try {
      await new Promise<void>((resolve, reject) => {
        src.onended = () => resolve();
        try {
          src.start();
        } catch (error) {
          reject(error);
        }
      });
    } finally {
      notifyTtsStop();
      void ctx.close().catch(() => {});
    }
  } catch (e) {
    console.warn("[LocalTTS] 播放失败:", e);
  }
}

/** Ark LLM 代理地址（轻量级直连模式） */
const ARK_PROXY_URL = import.meta.env.VITE_ARK_PROXY_URL || "";

/** 直接调用 Ark LLM 代理 */
async function callArkProxy(message: string, sessionId?: string): Promise<{ response: string; persisted: boolean }> {
  const proxyBase = ARK_PROXY_URL || `${window.location.protocol}//${window.location.hostname}:3001`;
  const res = await fetch(`${proxyBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId: sessionId || "default" }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ark Proxy error: ${res.status} - ${errText}`);
  }
  return res.json();
}

export default function Cockpit() {
  const { user, isAuthenticated } = useAuth();
  const skipOAuth = import.meta.env.VITE_SKIP_OAUTH === "true";

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  // v0.5：当前活动的 thinking 请求 ID（用于 SSE 订阅）
  const [activeRequestId, setActiveRequestId] = useState<string | undefined>(undefined);
  const supervisorStream = useSupervisorStream(activeRequestId);

  // v0.5：将流式中的 details 同步到对应 thinking 消息
  useEffect(() => {
    if (!activeRequestId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "thinking" && m.requestId === activeRequestId
          ? { ...m, details: supervisorStream.details }
          : m
      )
    );
    if (supervisorStream.details.length > 0) notifyToolRunning();
  }, [activeRequestId, supervisorStream.details]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isMicActive, setIsMicActive] = useState(false);
  const asrSessionRef = useRef<RealtimeAsrSession | null>(null);
  const asrCommittedRef = useRef("");

  // ==================== Ark 直连模式状态 ====================
  const [arkDirectMode, setArkDirectMode] = useState(Boolean(ARK_PROXY_URL));
  const [arkSending, setArkSending] = useState(false);

  const utils = trpc.useUtils();

  // ==================== Omni 音频播放状态 ====================
  const [omniAiSpeaking, setOmniAiSpeaking] = useState(false);

  // Omni 模式回调容器（使用 ref 避免 hooks 顺序问题）
  const omniCallbacksRef = useRef<UseOmniModeOptions>({
    onFinalTranscript: () => {},
    onReplyText: () => {},
    onAudioOutput: () => {},
  });

  // 人格切换状态（需在 useOmniMode 之前声明，因 Omni 回调中引用了 characterId）
  const [characterId, setCharacterId] = useState<string>("xiaozhi");

  // Omni 端到端语音模式（callback ref 在下面赋值）
  const { isOmniMode, toggleOmniMode, omniState, transcript, replyText, error: omniError, audioManager } =
    useOmniMode(undefined, omniCallbacksRef.current);

  // ==================== 后端 Mutations ====================

  const [synthTargetIdx, setSynthTargetIdx] = useState<number | null>(null);

  const synthesizeTtsMutation = trpc.chat.synthesizeAssistantTts.useMutation({
    onError: (error) => {
      toast.error("语音合成失败: " + error.message);
      setSynthTargetIdx(null);
    },
  });

  const handleSynthesizeAssistantTts = (idx: number, content: string) => {
    setSynthTargetIdx(idx);
    synthesizeTtsMutation.mutate(
      { text: content, sessionId: currentSessionId ?? undefined },
      {
        onSuccess: (data) => {
          setMessages((prev) =>
            prev.map((m, i) => (i === idx ? { ...m, tts: data.tts } : m))
          );
        },
        onSettled: () => setSynthTargetIdx(null),
      }
    );
  };

  const synthesizeOmniSummaryMutation = trpc.chat.synthesizeOmniSummary.useMutation({
    onError: (error) => {
      toast.error("Omni 摘要语音合成失败: " + error.message);
    },
  });

  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => {
        const reqId = (data as { requestId?: string }).requestId;
        const next = prev.map((m) =>
          m.role === "thinking" && reqId && m.requestId === reqId
            ? { ...m, status: "completed" as const, headline: "已完成思考", endedAt: Date.now() }
            : m
        );
        return [...next, { role: "assistant" as const, content: data.response }];
      });
      setActiveRequestId(undefined);
      dispatchAssistantStageReply(data.response);
      notifySuccess();
      utils.chat.listSessions.invalidate();
      void utils.memory.list.invalidate();
      if (data.persisted === false) {
        toast.warning("对话未保存到服务器，刷新后可能丢失。");
      }
      // Omni 模式：对话完成后自动合成摘要 TTS 并播报
      if (isOmniMode && audioManager) {
        void synthesizeOmniSummary(data.response, audioManager);
      } else if (!isOmniMode) {
        // 非 Omni 模式（传统 ASR）：自动合成摘要 TTS 并播报
        void playLocalTtsSummary(data.response);
      }
    },
    onError: (error) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "thinking" && m.status === "running"
            ? { ...m, status: "error" as const, headline: "思考失败", endedAt: Date.now() }
            : m
        )
      );
      setActiveRequestId(undefined);
      console.warn("[Cockpit] tRPC 失败，切换到 Ark 直连模式:", error.message);
      setArkDirectMode(true);
      toast.info("已切换到 Ark LLM 直连模式");
      notifyError();
    },
  });

  /** Ark 直连模式发送消息 */
  const sendViaArkProxy = async (userMessage: string) => {
    setArkSending(true);
    notifyThinking();
    try {
      const data = await callArkProxy(userMessage, String(currentSessionId ?? "default"));
      const cleaned = cleanTextForTts(data.response);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: cleaned },
      ]);
      dispatchAssistantStageReply(cleaned);
      notifySuccess();
      if (isOmniMode && audioManager) {
        void synthesizeOmniSummary(cleaned, audioManager);
      } else {
        void playLocalTtsSummary(cleaned);
      }
    } catch (err: any) {
      toast.error("Ark LLM 调用失败: " + err.message);
      notifyError();
    } finally {
      setArkSending(false);
    }
  };

  /**
   * Omni 模式：调用后端提取摘要并合成 TTS，然后播放
   */
  const synthesizeOmniSummary = async (
    fullResponse: string,
    audioMgr: NonNullable<ReturnType<typeof useOmniMode>["audioManager"]>
  ) => {
    if (!fullResponse.trim()) return;
    try {
      // 先清理噪声字符再合成
      const cleaned = cleanTextForTts(fullResponse);
      notifyToolRunning();
      const result = await synthesizeOmniSummaryMutation.mutateAsync({
        fullResponse: cleaned,
        sessionId: currentSessionId ?? undefined,
      });
      if (result.tts?.segments?.[0]?.audioBase64) {
        const base64 = result.tts.segments[0].audioBase64;
        console.log(`[Cockpit] Omni TTS 摘要: "${result.summary}" → 播放音频`);
        notifyTtsStart();
        try {
          await audioMgr.playBase64Audio(base64);
        } finally {
          notifyTtsStop();
        }
      } else {
        console.warn("[Cockpit] Omni TTS 返回为空，跳过播放");
      }
    } catch (err) {
      console.error("[Cockpit] Omni TTS 合成失败:", err);
      notifyError();
    }
  };

  // 填充 Omni 回调（在所有依赖定义完成后）
  omniCallbacksRef.current = {
    onFinalTranscript: async (text) => {
      if (!text.trim()) return;
      const userMessage = text.trim();
      console.log(`[Cockpit] Omni final transcript: "${userMessage}"`);
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
      setMessage("");
      notifyThinking();
      if (arkDirectMode) {
        await sendViaArkProxy(userMessage);
      } else {
        const requestId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setActiveRequestId(requestId);
        setMessages((prev) => [
          ...prev,
          {
            role: "thinking" as const,
            content: "",
            requestId,
            status: "running" as const,
            headline: "Omni 思考中...",
            details: [],
            startedAt: Date.now(),
          },
        ]);
        sendMessageMutation.mutate({
          message: userMessage,
          sessionId: currentSessionId ?? undefined,
          characterId,
          requestId,
        });
      }
    },
    onReplyText: (text, isFinal) => {
      if (isFinal) {
        setOmniAiSpeaking(false);
        console.log(`[Cockpit] Omni LLM 回复完成: "${text.slice(0, 100)}..."`);
      }
    },
    onAudioOutput: () => {
      setOmniAiSpeaking(true);
    },
  };

  // AI 正在说话状态（检测 replyText 变化）
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const replyTextRef = useRef("");
  const aiSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 检测 AI 回复文本变化，表示 AI 正在生成/播放语音
  useEffect(() => {
    if (replyText && replyText !== replyTextRef.current) {
      replyTextRef.current = replyText;
      setAiSpeaking(true);

      // 停止说话后 2 秒重置状态
      if (aiSpeakingTimerRef.current) {
        clearTimeout(aiSpeakingTimerRef.current);
      }
      aiSpeakingTimerRef.current = setTimeout(() => {
        setAiSpeaking(false);
      }, 2000);
    }
    return () => {
      if (aiSpeakingTimerRef.current) {
        clearTimeout(aiSpeakingTimerRef.current);
      }
    };
  }, [replyText]);

  // 语音模式（独立控制：ASR 识别 和 TTS 合成）
  const [asrMode, setAsrModeState] = useState<"cloud" | "local">("cloud");
  const [ttsMode, setTtsModeState] = useState<"cloud" | "local">(
    (window as any).__ENV__?.VITE_DEFAULT_TTS === "local" ? "local" : "cloud"
  );
  const [syncingVoiceMode, setSyncingVoiceMode] = useState(false);

  // 初始化语音模式状态（从后端同步 ttsMode，前端控制 asrMode）
  useEffect(() => {
    void fetch("/api/voice-mode")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.ttsMode === "cloud" || data?.ttsMode === "local") {
          setTtsModeState(data.ttsMode);
        }
        // 从后端同步 ASR 模式
        if (data?.mode === "cloud" || data?.mode === "local") {
          setAsrModeState(data.mode);
        }
      })
      .catch(() => {});
  }, []);

  /** 更新 TTS 模式（写入后端 + 前端状态） */
  const updateTtsMode = async (next: "cloud" | "local") => {
    setSyncingVoiceMode(true);
    try {
      if (next === "local") {
        try {
          const healthRes = await fetch("http://127.0.0.1:8001/health", {
            method: "GET",
            signal: AbortSignal.timeout(3000),
          });
          if (!healthRes.ok) throw new Error("Service unavailable");
        } catch {
          alert("本地语音服务未启动，请先运行：\n\ncd D:\\DEMO\\SmartAgent4_demo\\local-voice-service\npython main.py");
          setSyncingVoiceMode(false);
          return;
        }
      }
      const res = await fetch("/api/voice-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttsMode: next }),
      });
      if (!res.ok) throw new Error("voice mode update failed");
      setTtsModeState(next);
    } catch {
      // ignore
    } finally {
      setSyncingVoiceMode(false);
    }
  };

  /** ASR 模式切换（前端独立管理） */
  const updateAsrMode = async (next: "cloud" | "local") => {
    setSyncingVoiceMode(true);
    try {
      if (next === "local") {
        // 切换到本地前，先检查本地语音服务是否在运行
        try {
          const healthRes = await fetch("http://127.0.0.1:8001/health", {
            method: "GET",
            signal: AbortSignal.timeout(3000),
          });
          if (!healthRes.ok) throw new Error("Service unavailable");
        } catch {
          alert(
            "本地语音服务未启动，请先运行：\n\ncd D:\\DEMO\\SmartAgent4_demo\\local-voice-service\npython main.py\n\n或者双击运行 start-local-voice.bat"
          );
          setSyncingVoiceMode(false);
          return;
        }
      }
      const res = await fetch("/api/voice-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asrMode: next }),
      });
      if (!res.ok) throw new Error("voice mode update failed");
      setAsrModeState(next);
    } catch {
      // keep old mode on failure
    } finally {
      setSyncingVoiceMode(false);
    }
  };

  const createSessionMutation = trpc.chat.createSession.useMutation({
    onSuccess: (session) => {
      if (session) {
        setCurrentSessionId(session.id);
        setMessages([]);
        hasInitialHistorySynced.current = false;
        utils.chat.listSessions.invalidate();
      }
    },
  });

  // ==================== 历史记录 ====================

  const { data: sessions = [] } = trpc.chat.listSessions.useQuery(undefined, {
    enabled: isAuthenticated || skipOAuth,
  });

  const { data: history } = trpc.chat.getHistory.useQuery(
    { limit: 50, sessionId: currentSessionId },
    { enabled: isAuthenticated || skipOAuth }
  );

  const hasInitialHistorySynced = useRef(false);

  useEffect(() => {
    if (!skipOAuth && !isAuthenticated) {
      const loginUrl = getLoginUrl();
      if (loginUrl) window.location.href = loginUrl;
    }
  }, [isAuthenticated, skipOAuth]);

  useEffect(() => {
    if (!history) return;
    if (!hasInitialHistorySynced.current) {
      hasInitialHistorySynced.current = true;
      if (history.length > 0) {
        setMessages(
          history.map((conv) => ({
            role: conv.role as "user" | "assistant",
            content: conv.content,
          }))
        );
      } else {
        setMessages([]);
      }
    }
  }, [history]);

  useEffect(() => {
    hasInitialHistorySynced.current = false;
  }, [currentSessionId]);

  useEffect(() => {
    return () => {
      void asrSessionRef.current?.stop();
      asrSessionRef.current = null;
    };
  }, []);

  // ==================== 事件处理 ====================

  /** 纯发送函数：传入已知文本，不依赖 React state，避免 setState 异步时序问题 */
  const doSend = (userMessage: string) => {
    if (!userMessage.trim()) return;
    const isPending = arkDirectMode ? arkSending : sendMessageMutation.isPending;
    if (isPending) return;
    setMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    if (arkDirectMode) {
      sendViaArkProxy(userMessage);
    } else {
      notifyThinking();
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setActiveRequestId(requestId);
      setMessages((prev) => [
        ...prev,
        {
          role: "thinking" as const,
          content: "",
          requestId,
          status: "running" as const,
          headline: "Metris Agent 思考中...",
          details: [],
          startedAt: Date.now(),
        },
      ]);
      sendMessageMutation.mutate({
        message: userMessage,
        sessionId: currentSessionId ?? undefined,
        characterId,
        requestId,
      });
    }
  };

  const handleSend = () => {
    doSend(message.trim());
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 自动调整输入框高度
  const adjustTextareaHeight = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`; // 最大高度 150px
  };

  const handleNewSession = () => {
    createSessionMutation.mutate({});
    setMessages([]);
  };

  const toggleMic = async () => {
    if (isMicActive) {
      // ASR 结束后，收集最终文本并自动发送
      const finalText = (asrCommittedRef.current + message).trim();
      try {
        await asrSessionRef.current?.stop();
      } finally {
        asrSessionRef.current = null;
        setIsMicActive(false);
        asrCommittedRef.current = "";
      }
      // ASR 结束 → 直接调用 doSend，不依赖 React state 异步更新
      if (finalText) {
        doSend(finalText);
      }
      return;
    }

    asrCommittedRef.current = message;
    const session = new RealtimeAsrSession({
      onPartial: (text, sentenceEnd) => {
        if (sentenceEnd) {
          asrCommittedRef.current = (asrCommittedRef.current + text).trimEnd();
          setMessage(asrCommittedRef.current);
        } else {
          setMessage(asrCommittedRef.current + text);
        }
      },
      onError: err => {
        toast.error(err);
        void asrSessionRef.current?.stop();
        asrSessionRef.current = null;
        setIsMicActive(false);
        notifyError();
      },
      onDone: () => {
        asrSessionRef.current = null;
        setIsMicActive(false);
        notifyIdle();
      },
    });
    asrSessionRef.current = session;
    setIsMicActive(true);
    notifyListening();
    try {
      await session.start();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "无法启动语音识别";
      toast.error(msg);
      asrSessionRef.current = null;
      setIsMicActive(false);
      notifyError();
    }
  };

  const displayName = user?.name || (skipOAuth ? "测试用户" : "");

  if (!skipOAuth && !isAuthenticated) return null;

  return (
    <div className="h-screen w-screen overflow-hidden relative"
      style={{
        background: "linear-gradient(135deg, #0f1923 0%, #1a2a3a 30%, #1e3045 60%, #162638 100%)",
      }}
    >
      {/* ==================== 暗色背景装饰光晕 ==================== */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background: "radial-gradient(ellipse 60% 50% at 30% 50%, rgba(100,140,200,0.12) 0%, transparent 70%), radial-gradient(ellipse 40% 40% at 70% 30%, rgba(80,120,180,0.08) 0%, transparent 60%)",
        }}
      />

      {/* ==================== AIRI 角色舞台（紧贴对话框左侧，尽量显示全身） ==================== */}
      <div className="absolute inset-0 z-[5] pointer-events-none">
        <div
          className="pointer-events-auto absolute overflow-hidden"
          style={{
            width: '380px',
            height: '84%',
            right: '430px',
            top: '14%',
          }}
        >
          <AiriStageContainer
            enabled={true}
            className="w-full h-full"
            viewMode="fullBody"
          />
          <AiriStatusOverlay />
        </div>
      </div>

      {/* ==================== 顶栏（仅品牌 + 用户设置） ==================== */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-8 pt-5">
        {/* 左上：品牌 */}
        <div>
          <h1 className="text-2xl font-bold text-white/90 tracking-wider">
            元驰奕境
          </h1>
          <p className="text-xs text-white/40 mt-0.5">我的 Supermate</p>
        </div>

        {/* 右上：用户 + 设置 */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
            <User className="h-4 w-4 text-white/60" />
          </div>
          <Link href="/settings">
            <button className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 hover:bg-white/20 transition-colors">
              <Settings className="h-4 w-4 text-white/50" />
            </button>
          </Link>
        </div>
      </header>

      {/* ==================== 右侧：助手反馈面板（从顶部开始，更干净） ==================== */}
      <div className="absolute top-5 right-5 bottom-5 w-[420px] z-30">
        <AssistantPanel
          messages={messages}
          isPending={arkDirectMode ? arkSending : sendMessageMutation.isPending}
          characterId={characterId}
          onCharacterChange={setCharacterId}
          onSynthesizeAssistantTts={handleSynthesizeAssistantTts}
          synthesizingMessageIndex={
            synthesizeTtsMutation.isPending ? synthTargetIdx : null
          }
        />
      </div>

      {/* ==================== 左下角：语音按钮 + 输入框 + 会话管理 + 用户记忆 ==================== */}
      <div className="absolute bottom-5 left-5 z-20 flex flex-col gap-3 w-64">
        {/* 语音按钮组 */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMic}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all ${
              isMicActive
                ? "bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                : "bg-white/10 backdrop-blur-md text-white/80 border border-white/20 hover:bg-white/20"
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span>{isMicActive ? "正在听..." : "主驾语音"}</span>
          </button>

          <button
            className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium bg-white/10 backdrop-blur-md text-white/80 border border-white/20 hover:bg-white/20 transition-all"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span>副馾语音</span>
          </button>
        </div>

        {/* TTS 合成模式切换 */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-white/60">TTS</span>
          <Switch
            checked={ttsMode === "local"}
            disabled={syncingVoiceMode}
            onCheckedChange={checked =>
              void updateTtsMode(checked ? "local" : "cloud")
            }
            className="scale-90"
          />
          <span className="text-xs text-white/60">
            {ttsMode === "local" ? "离线" : "在线"}
          </span>
        </div>

        {/* ASR 识别模式切换 */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-white/60">ASR</span>
          <Switch
            checked={asrMode === "local"}
            disabled={syncingVoiceMode}
            onCheckedChange={checked =>
              void updateAsrMode(checked ? "local" : "cloud")
            }
            className="scale-90"
            title="ASR 离线模式（Whisper）切换"
          />
          <span className="text-xs text-white/60">
            {asrMode === "local" ? "离线" : "在线"}
          </span>
        </div>

        {/* Omni 端到端语音模式 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void toggleOmniMode()}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all ${
              isOmniMode
                ? "bg-purple-500 text-white shadow-lg shadow-purple-500/30"
                : "bg-white/10 backdrop-blur-md text-white/80 border border-white/20 hover:bg-white/20"
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8" />
              <path d="M12 8v8" />
            </svg>
            <span>
              {isOmniMode
                ? omniState === "connected"
                  ? "Omni 录音中..."
                  : omniState === "connecting"
                    ? "连接中..."
                    : "Omni 连接失败"
                : "Omni 模式"}
            </span>
          </button>

          {/* AI 播放动画（Omni 模式用 omniAiSpeaking，文本模式用 aiSpeaking） */}
          {isOmniMode && (omniAiSpeaking || aiSpeaking) && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-500/30 border border-purple-400/40">
              <div className="flex items-end gap-0.5 h-3">
                <div className="w-0.5 bg-purple-400 rounded-full animate-[bar_0.6s_ease-in-out_infinite]" style={{ height: "40%" }} />
                <div className="w-0.5 bg-purple-400 rounded-full animate-[bar_0.6s_ease-in-out_0.1s_infinite]" style={{ height: "80%" }} />
                <div className="w-0.5 bg-purple-400 rounded-full animate-[bar_0.6s_ease-in-out_0.2s_infinite]" style={{ height: "100%" }} />
                <div className="w-0.5 bg-purple-400 rounded-full animate-[bar_0.6s_ease-in-out_0.3s_infinite]" style={{ height: "60%" }} />
                <div className="w-0.5 bg-purple-400 rounded-full animate-[bar_0.6s_ease-in-out_0.4s_infinite]" style={{ height: "90%" }} />
              </div>
              <span className="text-[10px] text-purple-300">AI 播放中</span>
            </div>
          )}

          {isOmniMode && omniState === "connected" && !aiSpeaking && (
            <span className="text-[10px] text-green-400 animate-pulse">● 已连接</span>
          )}
          {isOmniMode && omniState === "connecting" && (
            <span className="text-[10px] text-yellow-400 animate-pulse">● 正在连接...</span>
          )}
          {isOmniMode && omniState === "error" && (
            <span className="text-[10px] text-red-400">● {omniError || "连接失败"}</span>
          )}
        </div>

        {/* Omni 实时转写/回复显示 */}
        {isOmniMode && (transcript || replyText) && (
          <div className="bg-white/10 backdrop-blur-md rounded-xl border border-white/15 px-3 py-2 text-xs text-white/80 max-h-24 overflow-y-auto">
            {transcript && <p className="text-white/60"><span className="text-blue-300">我:</span> {transcript}</p>}
            {replyText && <p className="mt-1"><span className="text-purple-300">AI:</span> {replyText}</p>}
          </div>
        )}

        {/* 输入框 */}
        <div className="flex items-end gap-2 bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 px-3 py-2">
          <Textarea
            ref={inputRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              adjustTextareaHeight(e);
            }}
            onKeyDown={handleKeyPress}
            placeholder="输入消息..."
            disabled={sendMessageMutation.isPending}
            rows={1}
            className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm px-1 text-white placeholder:text-white/40 resize-none min-h-[32px] max-h-[150px] overflow-y-auto"
            style={{ height: "auto" }}
          />
          <Button
            onClick={handleSend}
            disabled={!message.trim() || sendMessageMutation.isPending}
            size="icon"
            className="h-8 w-8 rounded-full bg-blue-500 hover:bg-blue-400 shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* 会话管理卡片 */}
        <div className="bg-white/8 backdrop-blur-md rounded-2xl border border-white/10 p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-sm font-medium text-white/80">会话管理</span>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex flex-col items-center gap-1">
              <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center">
                <User className="h-5 w-5 text-white/50" />
              </div>
              <span className="text-[11px] text-white/50">主驾</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center">
                <User className="h-5 w-5 text-white/40" />
              </div>
              <span className="text-[11px] text-white/50">副驾</span>
            </div>
          </div>
          <div className="mt-auto flex gap-1.5 flex-wrap">
            <button
              onClick={handleNewSession}
              className="text-[11px] bg-blue-500 text-white px-3 py-1.5 rounded-full transition-colors hover:bg-blue-400"
            >
              + 新建会话
            </button>
            {sessions.slice(0, 2).map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setCurrentSessionId(s.id);
                  hasInitialHistorySynced.current = false;
                }}
                className={`text-[11px] px-2.5 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                  currentSessionId === s.id
                    ? "bg-blue-500 text-white"
                    : "bg-white/10 text-white/60 hover:bg-white/20"
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        {/* 用户记忆卡片 */}
        <MemoryCards />
      </div>
    </div>
  );
}
