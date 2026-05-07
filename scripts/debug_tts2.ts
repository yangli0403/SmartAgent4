import WebSocket from "ws";
import * as crypto from "crypto";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "sk-a2e4c4f89f9f4fccb8b2a3309339b923";
const DASHSCOPE_TTS_WS = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

const ws = new WebSocket(DASHSCOPE_TTS_WS, {
  headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
});

const taskId = crypto.randomUUID().replace(/-/g, "");
let audioBytes = 0;

ws.on("open", () => {
  console.log("[OPEN] Connected");
  const runTask = {
    header: { action: "run-task", task_id: taskId, streaming: "duplex" },
    payload: {
      task_group: "audio",
      task: "tts",
      function: "SpeechSynthesizer",
      model: "cosyvoice-v3-flash",
      parameters: {
        text_type: "PlainText",
        voice: "longxiaochun",
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
  if (isBinary) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    audioBytes += buf.length;
    console.log(`[BINARY] ${buf.length} bytes (total: ${audioBytes})`);
  } else {
    const text = String(data);
    console.log("[MSG]", text.substring(0, 200));
    const msg = JSON.parse(text);
    const event = msg.header?.event;
    if (event === "task-started") {
      // 注意：DashScope TTS 用 event 字段，不是 action
      console.log("[SEND] continue-task with text");
      ws.send(JSON.stringify({
        header: { action: "continue-task", task_id: msg.header.task_id, streaming: "duplex" },
        payload: { input: { text: "好的，让我查查地图" } },
      }));
      setTimeout(() => {
        console.log("[SEND] finish-task");
        ws.send(JSON.stringify({
          header: { action: "finish-task", task_id: msg.header.task_id, streaming: "duplex" },
          payload: { input: {} },
        }));
      }, 100);
    } else if (event === "task-finished") {
      console.log(`[DONE] Total audio: ${audioBytes} bytes`);
      ws.close();
    } else if (event === "task-failed") {
      console.error("[FAILED]", text);
      ws.close();
    }
  }
});

ws.on("error", (err) => {
  console.error("[ERROR]", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`[CLOSE] code=${code} reason=${reason}`);
  process.exit(0);
});

setTimeout(() => {
  console.log("[TIMEOUT] Exiting after 20s");
  process.exit(1);
}, 20000);
