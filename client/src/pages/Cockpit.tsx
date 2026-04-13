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

export default function Cockpit() {
  const { user, isAuthenticated } = useAuth();
  const skipOAuth = import.meta.env.VITE_SKIP_OAUTH === "true";

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isMicActive, setIsMicActive] = useState(false);
  const asrSessionRef = useRef<RealtimeAsrSession | null>(null);
  const asrCommittedRef = useRef("");
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

  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
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
      utils.chat.listSessions.invalidate();
      void utils.memory.list.invalidate();
      if (data.persisted === false) {
        toast.warning("对话未保存到服务器，刷新后可能丢失。");
      }
    },
    onError: (error) => {
      toast.error("发送消息失败: " + error.message);
      notifyIdle();
    },
  });

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
    if (!message.trim() || sendMessageMutation.isPending) return;
    const userMessage = message.trim();
    setMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    // 通知舞台进入 thinking 状态
    notifyThinking();
    sendMessageMutation.mutate({
      message: userMessage,
      sessionId: currentSessionId ?? undefined,
      characterId,
    });
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
        background: "linear-gradient(180deg, #f5f5f5 0%, #ebebeb 40%, #e0e0e0 70%, #d8d8d8 100%)",
      }}
    >
      {/* ==================== 车辆背景图（融入背景） ==================== */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: "url(/car-model.png)",
          backgroundSize: "70% auto",
          backgroundPosition: "center 55%",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* ==================== AIRI 角色舞台（居中偏左显示，融入车辆背景） ==================== */}
      <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto"
          style={{
            width: '420px',
            height: '560px',
            marginRight: '280px',
            marginTop: '40px',
          }}
        >
          <AiriStageContainer
            enabled={true}
            className="w-full h-full"
          />
        </div>
      </div>

      {/* ==================== 顶栏 ==================== */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between px-8 pt-5">
        {/* 左上：品牌 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-wider">
            元驰奕境
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">我的 Supermate</p>
        </div>

        {/* 中上：语音按钮组 + ASR 输入框（模拟车机语音识别显示区） */}
        <div className="flex flex-col items-center gap-2.5 pt-0.5">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2.5 px-6 py-2.5 rounded-full text-sm font-medium transition-all ${
                isMicActive
                  ? "bg-gray-800 text-white shadow-lg"
                  : "bg-white/70 backdrop-blur-md text-gray-700 border border-gray-200/60 hover:bg-white/90"
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <span>{isMicActive ? "正在听..." : "主驾语音"}</span>
            </button>

            <button
              className="flex items-center gap-2.5 px-6 py-2.5 rounded-full text-sm font-medium bg-white/70 backdrop-blur-md text-gray-700 border border-gray-200/60 hover:bg-white/90 transition-all"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              <span>副驾语音</span>
            </button>
          </div>

          {/* ASR 输入框：模拟车机语音识别文字显示区，替代原欢迎气泡 */}
          <div className="flex items-center gap-2 bg-white/70 backdrop-blur-md rounded-2xl border border-white/50 shadow-sm px-3 py-1.5 w-[380px]">
            <Input
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入消息..."
              disabled={sendMessageMutation.isPending}
              className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm h-8 px-1 placeholder:text-gray-400"
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sendMessageMutation.isPending}
              size="icon"
              className="h-8 w-8 rounded-full bg-gray-800 hover:bg-gray-700 shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* 右上：用户 + 设置 */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/70 backdrop-blur-md flex items-center justify-center border border-gray-200/60">
            <User className="h-4 w-4 text-gray-600" />
          </div>
          <Link href="/settings">
            <button className="w-9 h-9 rounded-full bg-white/70 backdrop-blur-md flex items-center justify-center border border-gray-200/60 hover:bg-white/90 transition-colors">
              <Settings className="h-4 w-4 text-gray-500" />
            </button>
          </Link>
        </div>
      </header>

      {/* ==================== 左侧图标栏 ==================== */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3">
        {[
          { icon: "⊞", title: "应用" },
          { icon: "🔗", title: "连接" },
          { icon: "📊", title: "数据" },
          { icon: "💾", title: "存储" },
        ].map((item, i) => (
          <button
            key={i}
            title={item.title}
            className="w-10 h-10 rounded-xl bg-white/50 backdrop-blur-md border border-white/40 flex items-center justify-center text-sm text-gray-500 hover:bg-white/70 transition-all"
          >
            {item.icon}
          </button>
        ))}
      </div>

      {/* ==================== 右侧：助手反馈面板（仅消息列表，无输入框） ==================== */}
      <div className="absolute top-20 right-5 bottom-[200px] w-[380px] z-30">
        <AssistantPanel
          messages={messages}
          isPending={sendMessageMutation.isPending}
          characterId={characterId}
          onCharacterChange={setCharacterId}
          onSynthesizeAssistantTts={handleSynthesizeAssistantTts}
          synthesizingMessageIndex={
            synthesizeTtsMutation.isPending ? synthTargetIdx : null
          }
        />
      </div>

      {/* ==================== 底部：等宽等高固定小卡片 ==================== */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-stretch gap-4">
        {/* 会话管理卡片 */}
        <div className="w-72 h-44 bg-white/70 backdrop-blur-md rounded-2xl border border-white/50 shadow-sm p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-gray-800" />
            <span className="text-sm font-medium text-gray-700">会话管理</span>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex flex-col items-center gap-1">
              <div className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center">
                <User className="h-5 w-5 text-gray-500" />
              </div>
              <span className="text-[11px] text-gray-500">主驾</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center">
                <User className="h-5 w-5 text-gray-400" />
              </div>
              <span className="text-[11px] text-gray-500">副驾</span>
            </div>
          </div>
          <div className="mt-auto flex gap-1.5 flex-wrap">
            <button
              onClick={handleNewSession}
              className="text-[11px] text-gray-700 bg-gray-800 text-white px-3 py-1.5 rounded-full transition-colors hover:bg-gray-700"
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
                    ? "bg-gray-800 text-white"
                    : "bg-white/80 text-gray-600 hover:bg-white"
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
