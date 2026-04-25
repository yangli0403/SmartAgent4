/**
 * useOmniMode — Omni 端到端语音模式 Hook
 *
 * 管理 Omni 模式的开关状态和 OmniRealtimeClient 的生命周期。
 * 当开启 Omni 模式时，前端直接通过 WebSocket 与 DashScope 通信，
 * 绕过现有的 ASR → LLM → TTS 文本链路。
 *
 * 使用方式：
 * ```tsx
 * const { isOmniMode, toggleOmniMode, omniState, transcript, replyText } = useOmniMode();
 * ```
 */
import { useState, useCallback, useRef, useEffect } from "react";
import {
  OmniRealtimeClient,
  type OmniConnectionState,
  type OmniClientConfig,
} from "../lib/omniRealtimeClient";

// ==================== 类型定义 ====================

export interface UseOmniModeReturn {
  /** 是否处于 Omni 模式 */
  isOmniMode: boolean;
  /** 切换 Omni 模式 */
  toggleOmniMode: () => Promise<void>;
  /** 开启 Omni 模式 */
  enableOmniMode: () => Promise<void>;
  /** 关闭 Omni 模式 */
  disableOmniMode: () => void;
  /** Omni 连接状态 */
  omniState: OmniConnectionState;
  /** 用户语音转写文本 */
  transcript: string;
  /** AI 回复文本 */
  replyText: string;
  /** 发送音频数据 */
  sendAudio: (audioData: ArrayBuffer) => void;
  /** 错误信息 */
  error: string | null;
}

// ==================== Hook 实现 ====================

export function useOmniMode(config?: OmniClientConfig): UseOmniModeReturn {
  const [isOmniMode, setIsOmniMode] = useState(false);
  const [omniState, setOmniState] = useState<OmniConnectionState>("disconnected");
  const [transcript, setTranscript] = useState("");
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<OmniRealtimeClient | null>(null);

  // 创建客户端实例
  const getOrCreateClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new OmniRealtimeClient(
        {
          onTranscript: (text, isFinal) => {
            if (isFinal) {
              setTranscript(text);
            } else {
              setTranscript((prev) => prev + text);
            }
          },
          onReplyText: (text, isFinal) => {
            if (isFinal) {
              setReplyText(text);
            } else {
              setReplyText((prev) => prev + text);
            }
          },
          onAudioOutput: (_audioData) => {
            // TODO: 播放音频（通过 AudioContext）
          },
          onStateChange: (state) => {
            setOmniState(state);
          },
          onError: (err) => {
            setError(err.message);
            console.error("[useOmniMode] Error:", err.message);
          },
        },
        config
      );
    }
    return clientRef.current;
  }, [config]);

  // 开启 Omni 模式
  const enableOmniMode = useCallback(async () => {
    try {
      setError(null);
      setTranscript("");
      setReplyText("");

      const client = getOrCreateClient();
      await client.connect();
      setIsOmniMode(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Omni 模式启动失败"
      );
      setIsOmniMode(false);
    }
  }, [getOrCreateClient]);

  // 关闭 Omni 模式
  const disableOmniMode = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setIsOmniMode(false);
    setOmniState("disconnected");
  }, []);

  // 切换 Omni 模式
  const toggleOmniMode = useCallback(async () => {
    if (isOmniMode) {
      disableOmniMode();
    } else {
      await enableOmniMode();
    }
  }, [isOmniMode, enableOmniMode, disableOmniMode]);

  // 发送音频
  const sendAudio = useCallback((audioData: ArrayBuffer) => {
    clientRef.current?.sendAudio(audioData);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  return {
    isOmniMode,
    toggleOmniMode,
    enableOmniMode,
    disableOmniMode,
    omniState,
    transcript,
    replyText,
    sendAudio,
    error,
  };
}
