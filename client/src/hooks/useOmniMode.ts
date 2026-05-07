/**
 * useOmniMode — Omni 端到端语音模式 Hook
 *
 * 管理 Omni 模式的开关状态和 OmniRealtimeClient + OmniAudioManager 的生命周期。
 * 当开启 Omni 模式时，前端直接通过 WebSocket 与 DashScope 通信，
 * 绕过现有的 ASR → LLM → TTS 文本链路。
 *
 * 使用方式：
 * ```tsx
 * const {
 *   isOmniMode,
 *   toggleOmniMode,
 *   omniState,
 *   transcript,
 *   replyText,
 *   audioManager,
 *   error,
 * } = useOmniMode();
 * ```
 *
 * 回调注册方式（使用 ref 避免 hooks 顺序问题）：
 * ```tsx
 * const callbacksRef = useRef<UseOmniModeOptions>({ ... });
 * // 在所有依赖定义完成后填充 callbacksRef.current
 * const { audioManager } = useOmniMode(undefined, callbacksRef.current);
 * ```
 */
import { useState, useCallback, useRef, useEffect } from "react";
import {
  OmniRealtimeClient,
  type OmniConnectionState,
  type OmniClientConfig,
} from "../lib/omniRealtimeClient";
import { OmniAudioManager } from "../lib/omniAudioManager";

// ==================== 类型定义 ====================

export interface UseOmniModeOptions {
  /** 最终转写完成回调（用户说完一句话） */
  onFinalTranscript?: (text: string) => void;
  /** AI 回复文本回调 */
  onReplyText?: (text: string, isFinal: boolean) => void;
  /** AI 语音输出回调 */
  onAudioOutput?: (audioData: ArrayBuffer) => void;
  /** 状态变化回调 */
  onStateChange?: (state: OmniConnectionState) => void;
}

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
  /** 错误信息 */
  error: string | null;
  /** 音频管理器（用于播放 TTS 音频） */
  audioManager: OmniAudioManager | null;
}

// ==================== Hook 实现 ====================

export function useOmniMode(
  config?: OmniClientConfig,
  options?: UseOmniModeOptions
): UseOmniModeReturn {
  const [isOmniMode, setIsOmniMode] = useState(false);
  const [omniState, setOmniState] = useState<OmniConnectionState>("disconnected");
  const [transcript, setTranscript] = useState("");
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<OmniRealtimeClient | null>(null);
  const audioManagerRef = useRef<OmniAudioManager | null>(null);
  // 使用 ref 存储回调，使回调可在组件生命周期内动态更新
  const optionsRef = useRef<UseOmniModeOptions | undefined>(options);

  // 组件内更新 optionsRef（支持父组件在所有状态定义完成后注入真实回调）
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // 创建 OmniRealtimeClient 实例
  const getOrCreateClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new OmniRealtimeClient(
        {
          onTranscript: (text) => {
            setTranscript(text);
          },
          onReplyText: (text, isFinal) => {
            // 过滤 DashScope Omni 嵌入的段落分隔标记（如 ~1 ~2），仅影响文本显示，不影响音频
            const cleaned = text.replace(/~[\d]+/g, "").trim();
            setReplyText(cleaned);
            optionsRef.current?.onReplyText?.(cleaned, isFinal);
          },
          onAudioOutput: async (audioData) => {
            if (audioManagerRef.current) {
              await audioManagerRef.current.playAudio(audioData);
            }
            optionsRef.current?.onAudioOutput?.(audioData);
          },
          onStateChange: (state) => {
            setOmniState(state);
            optionsRef.current?.onStateChange?.(state);
            if (state === "disconnected" && isOmniMode) {
              setIsOmniMode(false);
              setTranscript("");
              setReplyText("");
              if (audioManagerRef.current) {
                void audioManagerRef.current.cleanup();
              }
            }
          },
          onError: (err) => {
            setError(err.message);
            console.error("[useOmniMode] Error:", err.message);
          },
          onFinalTranscript: (text) => {
            console.log(`[useOmniMode] Final transcript: "${text}"`);
            optionsRef.current?.onFinalTranscript?.(text);
          },
        },
        config
      );
    }
    return clientRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // 创建 OmniAudioManager 实例
  const getOrCreateAudioManager = useCallback(() => {
    if (!audioManagerRef.current) {
      audioManagerRef.current = new OmniAudioManager();
    }
    return audioManagerRef.current;
  }, []);

  // 开启 Omni 模式
  const enableOmniMode = useCallback(async () => {
    try {
      setError(null);
      setTranscript("");
      setReplyText("");

      const client = getOrCreateClient();
      await client.connect();

      const audioManager = getOrCreateAudioManager();
      const clientForAudio = client;

      await audioManager.startRecording((audioData) => {
        if (clientForAudio) {
          clientForAudio.sendAudio(audioData);
        }
      });

      setOmniState("connected");
      setIsOmniMode(true);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Omni 模式启动失败";
      setError(errorMessage);
      setIsOmniMode(false);
      setOmniState("error");

      if (audioManagerRef.current) {
        await audioManagerRef.current.cleanup();
      }
    }
  }, [getOrCreateClient, getOrCreateAudioManager]);

  // 关闭 Omni 模式
  const disableOmniMode = useCallback(() => {
    if (audioManagerRef.current) {
      void audioManagerRef.current.cleanup();
    }

    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    setIsOmniMode(false);
    setOmniState("disconnected");
    setTranscript("");
    setReplyText("");
  }, []);

  // 切换 Omni 模式
  const toggleOmniMode = useCallback(async () => {
    if (isOmniMode) {
      disableOmniMode();
    } else {
      await enableOmniMode();
    }
  }, [isOmniMode, enableOmniMode, disableOmniMode]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (audioManagerRef.current) {
        void audioManagerRef.current.cleanup();
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
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
    error,
    audioManager: audioManagerRef.current,
  };
}
