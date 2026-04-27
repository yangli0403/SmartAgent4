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
import { Input } from "@/components/ui/input";
import AssistantPanel from "@/components/cockpit/AssistantPanel";
import type { ChatUiMessage } from "@shared/chatTts";
import MemoryCards from "@/components/cockpit/MemoryCards";
import { RealtimeAsrSession } from "@/lib/realtimeAsrStream";
import { AiriStageContainer } from "@/components/airi-stage/AiriStageContainer";
import { dispatchStageEventsFromTags, notifyThinking, notifyIdle } from "@/lib/airi-stage/stageEventBus";
import { parseEmotionTags } from "@/lib/emotionParser";
import { useOmniMode } from "@/hooks/useOmniMode";

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
  }, [activeRequestId, supervisorStream.details]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isMicActive, setIsMicActive] = useState(false);
  const asrSessionRef = useRef<RealtimeAsrSession | null>(null);
  const asrCommittedRef = useRef("");

  // Omni 端到端语音模式
  const { isOmniMode, toggleOmniMode, omniState, transcript, replyText } = useOmniMode();

  // 人格切换状态
  const [characterId, setCharacterId] = useState<string>("xiaozhi");

  const utils = trpc.useUtils();

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

  // Ark 直连模式状态：如果配置了 VITE_ARK_PROXY_URL，直接进入直连模式
  const [arkDirectMode, setArkDirectMode] = useState(Boolean(ARK_PROXY_URL));
  const [arkSending, setArkSending] = useState(false);

  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => {
        const reqId = (data as { requestId?: string }).requestId;
        // 将对应 requestId 的 thinking 消息标记为 completed
        const next = prev.map((m) =>
          m.role === "thinking" && reqId && m.requestId === reqId
            ? { ...m, status: "completed" as const, headline: "Metris Agent 已完成思考", endedAt: Date.now() }
            : m
        );
        return [...next, { role: "assistant" as const, content: data.response }];
      });
      setActiveRequestId(undefined);
      // 解析情感标签并分发到舞台事件总线
      const parsed = parseEmotionTags(data.response);
      if (parsed.tags.length > 0) {
        dispatchStageEventsFromTags(parsed.tags);
      }
      notifyIdle();
      utils.chat.listSessions.invalidate();
      void utils.memory.list.invalidate();
      if (data.persisted === false) {
        toast.warning("对话未保存到服务器，刷新后可能丢失。");
      }
    },
    onError: (error) => {
      // 将 thinking 消息标记为 failed
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "thinking" && m.status === "running"
            ? { ...m, status: "error" as const, headline: "Metris Agent 思考失败", endedAt: Date.now() }
            : m
        )
      );
      setActiveRequestId(undefined);
      // tRPC 后端不可用时自动切换到 Ark 直连模式
      console.warn("[Cockpit] tRPC 失败，切换到 Ark 直连模式:", error.message);
      setArkDirectMode(true);
      toast.info("已切换到 Ark LLM 直连模式");
      notifyIdle();
    },
  });

  /** Ark 直连模式发送消息 */
  const sendViaArkProxy = async (userMessage: string) => {
    setArkSending(true);
    notifyThinking();
    try {
      const data = await callArkProxy(userMessage, String(currentSessionId ?? "default"));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response },
      ]);
      // 解析情感标签并分发到舞台事件总线
      const parsed = parseEmotionTags(data.response);
      if (parsed.tags.length > 0) {
        dispatchStageEventsFromTags(parsed.tags);
      }
      notifyIdle();
    } catch (err: any) {
      toast.error("Ark LLM 调用失败: " + err.message);
      notifyIdle();
    } finally {
      setArkSending(false);
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

  const handleSend = () => {
    const isPending = arkDirectMode ? arkSending : sendMessageMutation.isPending;
    if (!message.trim() || isPending) return;
    const userMessage = message.trim();
    setMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    if (arkDirectMode) {
      // Ark 直连模式
      sendViaArkProxy(userMessage);
    } else {
      // 通知舞台进入 thinking 状态
      notifyThinking();
      // v0.5：生成 requestId，插入一条 thinking 占位消息，同时启动 SSE 订阅
      const requestId =
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewSession = () => {
    createSessionMutation.mutate({});
    setMessages([]);
  };

  const toggleMic = async () => {
    if (isMicActive) {
      try {
        await asrSessionRef.current?.stop();
      } finally {
        asrSessionRef.current = null;
        setIsMicActive(false);
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
      },
      onDone: () => {
        asrSessionRef.current = null;
        setIsMicActive(false);
      },
    });
    asrSessionRef.current = session;
    setIsMicActive(true);
    try {
      await session.start();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "无法启动语音识别";
      toast.error(msg);
      asrSessionRef.current = null;
      setIsMicActive(false);
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

        {/* Omni 端到端语音模式 */}
        <div className="flex items-center gap-2">
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
                ? omniState === "connected" ? "Omni 对话中" : "Omni 连接中..."
                : "Omni 模式"}
            </span>
          </button>
          {isOmniMode && omniState === "connected" && (
            <span className="text-[10px] text-green-400 animate-pulse">● 已连接</span>
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
        <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 px-3 py-1.5">
          <Input
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="输入消息..."
            disabled={sendMessageMutation.isPending}
            className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm h-8 px-1 text-white placeholder:text-white/40"
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
