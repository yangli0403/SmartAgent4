/**
 * Omni Audio Manager — Omni 模式音频录制和播放管理
 *
 * 负责：
 * 1. 麦克风录音 → 转换为 PCM → 发送给 OmniRealtimeClient
 * 2. 接收 PCM 音频 → 播放
 *
 * 使用 Web Audio API 进行音频处理。
 */

export class OmniAudioManager {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onAudioData: ((data: ArrayBuffer) => void) | null = null;
  private isRecording = false;
  private audioBufferQueue: ArrayBuffer[] = [];
  private audioBufferSource: AudioBufferSourceNode | null = null;
  private nextPlayTime = 0;

  /**
   * 获取麦克风权限并启动录音
   */
  async startRecording(onAudioData: (data: ArrayBuffer) => void): Promise<void> {
    if (this.isRecording) {
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: 24000 });
      await this.audioContext.resume();

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 使用 AudioWorkletNode 替代 ScriptProcessorNode（已废弃但兼容性好）
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.onAudioData = onAudioData;

      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording || !this.onAudioData) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = this.float32To16BitPCM(inputData);
        this.onAudioData(pcmData.buffer as ArrayBuffer);
      };

      this.isRecording = true;
      console.log("[OmniAudio] Recording started");
    } catch (error) {
      console.error("[OmniAudio] Failed to start recording:", error);
      throw new Error("无法访问麦克风，请检查权限设置");
    }
  }

  /**
   * 停止录音
   */
  async stopRecording(): Promise<void> {
    if (!this.isRecording) return;

    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.onAudioData = null;
    console.log("[OmniAudio] Recording stopped");
  }

  /**
   * 播放 PCM 音频数据
   * @param audioData PCM 数据（AudioContext 会自动处理采样率）
   */
  async playAudio(audioData: ArrayBuffer): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    try {
      const sampleRate = this.audioContext.sampleRate;
      // 解码 PCM 数据
      const uint8Array = new Uint8Array(audioData);
      const int16Array = new Int16Array(
        uint8Array.buffer,
        uint8Array.byteOffset,
        uint8Array.byteLength / 2
      );
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768;
      }

      // 创建 AudioBuffer 并播放
      const audioBuffer = this.audioContext.createBuffer(
        1,
        float32Array.length,
        sampleRate
      );
      audioBuffer.copyToChannel(float32Array, 0);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      source.start();
    } catch (error) {
      console.error("[OmniAudio] Failed to play audio:", error);
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.stopRecording();

    if (this.audioBufferSource) {
      try {
        this.audioBufferSource.stop();
      } catch {
        // ignore
      }
      this.audioBufferSource = null;
    }

    this.audioBufferQueue = [];
  }

  /**
   * 将 Float32Array 转换为 16-bit PCM
   */
  private float32To16BitPCM(float32: Float32Array): Uint8Array {
    const buffer = new ArrayBuffer(float32.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buffer);
  }

  /**
   * 检查是否正在录音
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * 获取当前音频上下文采样率（用于 TTS 音频转换）
   */
  getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 24000;
  }

  /**
   * 播放 Base64 编码的音频（用于 Emotions TTS 返回的音频）
   * 支持 wav/pcm 格式自动检测。
   */
  async playBase64Audio(base64Data: string): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // 检测是否为 WAV 格式（RIFF...WAVE）
      const isWav = bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && // RIFF
        bytes[2] === 0x46 && bytes[3] === 0x46 && // FF
        bytes[8] === 0x57 && bytes[9] === 0x41 && // WA
        bytes[10] === 0x56 && bytes[11] === 0x45; // VE

      if (isWav) {
        // WAV 文件包含真实采样率（CosyVoice 默认 22050Hz）。不要剥离 header 后按 AudioContext 采样率当 PCM 播放，
        // 否则会出现语速变慢/变快和音调异常。decodeAudioData 会按 WAV 头正确解码并由浏览器重采样到输出设备。
        const wavBuffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        const audioBuffer = await this.audioContext.decodeAudioData(wavBuffer.slice(0));
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        source.start();
        return;
      } else {
        // 直接当作 PCM
        return this.playAudio(bytes.buffer as ArrayBuffer);
      }
    } catch (error) {
      console.error("[OmniAudio] Failed to play base64 audio:", error);
    }
  }
}
