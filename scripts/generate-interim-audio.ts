/**
 * 预合成过渡音频生成脚本
 *
 * 使用 DashScope CosyVoice 为每个分类域预合成女声过渡音频。
 * 生成后的音频文件存放在 client/public/audio/interim/ 目录下。
 *
 * 用法：
 *   cd SmartAgent4 && npx tsx scripts/generate-interim-audio.ts
 *
 * 环境变量：
 *   DASHSCOPE_API_KEY - 百炼 API Key（必需）
 *   TTS_VOICE - 音色（默认 longxiaochun）
 */

import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";
const DASHSCOPE_TTS_WS = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const TTS_VOICE = process.env.TTS_VOICE || "longanling_v3";
const TTS_MODEL = "cosyvoice-v3-flash";
const OUTPUT_DIR = path.resolve(__dirname, "..", "client", "public", "audio", "interim");

// 分类域 → 过渡话术映射
const INTERIM_PHRASES: Record<string, string[]> = {
  navigation: [
    "好的，让我查查地图",
    "正在为您规划路线",
    "稍等，我看看怎么走",
  ],
  multimedia: [
    "好的，帮您搜搜歌",
    "让我找找看",
    "稍等，正在搜索",
  ],
  file_system: [
    "好的，让我看看文件",
    "正在分析磁盘信息",
    "稍等，我查一下",
  ],
  office: [
    "好的，我来处理",
    "正在帮您操作飞书",
    "稍等，马上就好",
  ],
  service: [
    "好的，帮您找找",
    "正在搜索附近的选择",
    "稍等，让我看看",
  ],
  general: [
    "好的，让我想想",
    "稍等，我来回答",
    "好的，我来帮您",
  ],
  cross_domain: [
    "好的，这个需要多步操作",
    "稍等，让我规划一下",
    "好的，我来处理",
  ],
};

async function synthesizeOne(text: string, outputPath: string): Promise<void> {
  if (!DASHSCOPE_API_KEY) {
    throw new Error("DASHSCOPE_API_KEY is required");
  }

  return new Promise((resolve, reject) => {
    const audioChunks: Buffer[] = [];
    let finished = false;
    const taskId = crypto.randomUUID();

    const ws = new WebSocket(DASHSCOPE_TTS_WS, {
      headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        ws.close();
        reject(new Error(`Timeout synthesizing: ${text}`));
      }
    }, 30000);

    ws.on("open", () => {
      const runTask = {
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: {
          task_group: "audio",
          task: "tts",
          function: "SpeechSynthesizer",
          model: TTS_MODEL,
          parameters: {
            text_type: "PlainText",
            voice: TTS_VOICE,
            format: "wav",
            sample_rate: 22050,
            volume: 50,
            rate: 1,
            pitch: 1,
          },
          input: {},
        },
      };
      ws.send(JSON.stringify(runTask));
    });

    ws.on("message", (data: unknown, isBinary: boolean) => {
      if (finished) return;
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        audioChunks.push(buf);
      } else {
        const msg = JSON.parse(String(data));
        const action = msg.header?.event || msg.header?.action;
        if (action === "task-started") {
          ws.send(JSON.stringify({
            header: { action: "continue-task", task_id: msg.header.task_id, streaming: "duplex" },
            payload: { input: { text } },
          }));
          ws.send(JSON.stringify({
            header: { action: "finish-task", task_id: msg.header.task_id, streaming: "duplex" },
            payload: { input: {} },
          }));
        } else if (action === "result-generated" || action === "task-finished") {
          if (action === "task-finished") {
            finished = true;
            clearTimeout(timer);
            ws.close();
            if (audioChunks.length === 0) {
              reject(new Error(`No audio data for: ${text}`));
              return;
            }
            const combined = Buffer.concat(audioChunks);
            fs.writeFileSync(outputPath, combined);
            console.log(`  ✓ ${path.basename(outputPath)} (${combined.length} bytes)`);
            resolve();
          }
        } else if (action === "task-failed") {
          finished = true;
          clearTimeout(timer);
          ws.close();
          reject(new Error(`TTS failed for "${text}": ${JSON.stringify(msg)}`));
        }
      }
    });

    ws.on("error", (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    ws.on("close", () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (audioChunks.length > 0) {
          const combined = Buffer.concat(audioChunks);
          fs.writeFileSync(outputPath, combined);
          console.log(`  ✓ ${path.basename(outputPath)} (${combined.length} bytes, on close)`);
          resolve();
        } else {
          reject(new Error(`WebSocket closed without audio for: ${text}`));
        }
      }
    });
  });
}

async function main() {
  console.log(`\n🎙️  预合成过渡音频生成器`);
  console.log(`   音色: ${TTS_VOICE}`);
  console.log(`   输出: ${OUTPUT_DIR}\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const [domain, phrases] of Object.entries(INTERIM_PHRASES)) {
    console.log(`\n📂 ${domain}:`);
    for (let i = 0; i < phrases.length; i++) {
      const phrase = phrases[i];
      const filename = `${domain}_${i + 1}.wav`;
      const outputPath = path.join(OUTPUT_DIR, filename);
      try {
        await synthesizeOne(phrase, outputPath);
      } catch (err) {
        console.error(`  ✗ ${filename}: ${(err as Error).message}`);
      }
      // 避免并发过高，每次合成间隔 500ms
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // 生成映射 JSON 文件
  const manifest: Record<string, { phrases: string[]; files: string[] }> = {};
  for (const [domain, phrases] of Object.entries(INTERIM_PHRASES)) {
    manifest[domain] = {
      phrases,
      files: phrases.map((_, i) => `/audio/interim/${domain}_${i + 1}.wav`),
    };
  }
  const manifestPath = path.join(OUTPUT_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✅ manifest.json 已生成`);
  console.log(`\n🎉 完成！共生成 ${Object.values(INTERIM_PHRASES).flat().length} 个音频文件\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
