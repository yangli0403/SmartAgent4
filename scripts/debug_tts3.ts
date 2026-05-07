import WebSocket from "ws";
import * as crypto from "crypto";

const DASHSCOPE_API_KEY = "sk-a2e4c4f89f9f4fccb8b2a3309339b923";
const DASHSCOPE_TTS_WS = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

// 尝试 v3 版本的音色名称：longanling_v3 (思维灵动女)
const voices = ["longanling_v3", "longanhuan", "longxiaoxia_v2", "longxiaochun_v2"];

async function testVoice(voice: string): Promise<void> {
  return new Promise((resolve) => {
    const taskId = crypto.randomUUID().replace(/-/g, "");
    let audioBytes = 0;
    let finished = false;

    const ws = new WebSocket(DASHSCOPE_TTS_WS, {
      headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        console.log(`  [${voice}] TIMEOUT`);
        ws.close();
        resolve();
      }
    }, 10000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: {
          task_group: "audio", task: "tts", function: "SpeechSynthesizer",
          model: "cosyvoice-v3-flash",
          parameters: { text_type: "PlainText", voice, format: "wav", sample_rate: 22050, volume: 50, rate: 1, pitch: 1 },
          input: {},
        },
      }));
    });

    ws.on("message", (data: unknown, isBinary: boolean) => {
      if (finished) return;
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        audioBytes += buf.length;
      } else {
        const msg = JSON.parse(String(data));
        const event = msg.header?.event;
        if (event === "task-started") {
          ws.send(JSON.stringify({
            header: { action: "continue-task", task_id: msg.header.task_id, streaming: "duplex" },
            payload: { input: { text: "好的" } },
          }));
          setTimeout(() => {
            ws.send(JSON.stringify({
              header: { action: "finish-task", task_id: msg.header.task_id, streaming: "duplex" },
              payload: { input: {} },
            }));
          }, 100);
        } else if (event === "task-finished") {
          finished = true;
          clearTimeout(timer);
          console.log(`  [${voice}] OK - ${audioBytes} bytes`);
          ws.close();
          resolve();
        } else if (event === "task-failed") {
          finished = true;
          clearTimeout(timer);
          console.log(`  [${voice}] FAILED: ${msg.header.error_message}`);
          ws.close();
          resolve();
        }
      }
    });

    ws.on("error", () => {
      if (!finished) { finished = true; clearTimeout(timer); console.log(`  [${voice}] ERROR`); resolve(); }
    });
    ws.on("close", () => {
      if (!finished) { finished = true; clearTimeout(timer); console.log(`  [${voice}] CLOSED (no result)`); resolve(); }
    });
  });
}

async function main() {
  console.log("Testing CosyVoice v3-flash voices...");
  for (const v of voices) {
    await testVoice(v);
    await new Promise(r => setTimeout(r, 500));
  }
  process.exit(0);
}
main();
