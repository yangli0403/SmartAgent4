"""生成本地 ASR/TTS 双模式方案迭代文档（Word）。"""

from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn


def set_run_font(run, name: str = "Microsoft YaHei", size_pt: int = 11):
    run.font.name = name
    run.font.size = Pt(size_pt)
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    rFonts.set(qn("w:eastAsia"), name)


def add_heading(doc: Document, text: str, level: int = 1):
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        set_run_font(run, size_pt=14 if level == 0 else 12)


def add_paragraph(doc: Document, text: str):
    p = doc.add_paragraph(text)
    for run in p.runs:
        set_run_font(run)


def add_bullets(doc: Document, items: list[str]):
    for item in items:
        p = doc.add_paragraph(item, style="List Bullet")
        for run in p.runs:
            set_run_font(run)


doc = Document()
add_heading(doc, "SmartAgent4 本地语音（ASR/TTS）双模式方案 — 迭代版", 0)
add_paragraph(doc, "文档版本：v0.3（新增交互一致性与 TTS 长文本优化）")
add_paragraph(
    doc,
    "目标：在 LLM 仍走云端的前提下，为 Faster-Whisper（ASR）与 Piper（TTS）增加可落地的「在线/本地」切换；明确实时性边界、分阶段交付与风险对策。",
)

add_heading(doc, "一、架构原则（保持不变）", 1)
add_bullets(
    doc,
    [
        "语音推理放在独立 Python 进程（FastAPI），Node 仅 HTTP/WebSocket 转发，避免在 Node 内嵌 ML。",
        "默认「在线」与现有 DashScope ASR、Emotions-System TTS 完全兼容；「本地」为可选路径。",
        "本地服务仅监听 127.0.0.1，避免局域网误暴露。",
    ],
)

add_heading(doc, "二、实时性与产品形态（本次迭代重点）", 1)
add_paragraph(
    doc,
    "2.1 ASR：Faster-Whisper 擅长「整段/分块转写」，与云端「流式逐字」不是同一机制。",
)
add_bullets(
    doc,
    [
        "MVP（推荐先做）：浏览器侧按固定间隔或 VAD 停顿提交音频块 → HTTP 转写 → 返回整段或 partial 文本；延迟由「块长」决定，通常可达「说完短句即出字」的体验。",
        "进阶：若要对齐 DashScope 的极低延迟流式，需单独设计 partial 结果协议与更细的分块/VAD，工程量显著增加，不宜与 MVP 混为一谈。",
    ],
)
add_paragraph(doc, "2.2 TTS：Piper 多为「整句合成 WAV」。首包延迟主要来自合成时长与编解码；句子不宜过长，可按标点切句。")
add_paragraph(
    doc,
    "结论：本地模式可实现「可感知的实时」，但若以「同传级」为标准，需单独立项做流式 ASR/TTS 协议。",
)

add_heading(doc, "三、关键交互决策（本次新增）", 1)
add_paragraph(doc, "3.1 在线与离线 ASR 的触发方式统一")
add_bullets(
    doc,
    [
        "在线 ASR：点击开始录音，再次点击结束录音（现状保持）。",
        "离线 ASR：采用完全一致的交互，不新增第二套手势与状态机。",
        "统一好处：用户学习成本最低；前端仅分「处理链路」，不分「触发交互」。",
        "后续增强（可选）：静音自动停止（VAD），但不纳入 MVP。"
    ],
)
add_paragraph(doc, "3.2 TTS 长文本优化策略（在线/离线共用）")
add_bullets(
    doc,
    [
        "第 1 层：文本清洗（去 markdown/代码块/链接/冗余空白，统一停顿符号）。",
        "第 2 层：按句分段合成（推荐每段 40~80 字，段间停顿 150~300ms）。",
        "第 3 层：超长摘要播报（超过阈值默认播摘要，提供“播放全文”）。",
        "统一阈值建议：<=120 直接播；120~280 分段播；>280 默认播摘要。"
    ],
)

add_heading(doc, "四、硬件与模型建议（i7-13700H / 16GB / 无独显）", 1)
add_bullets(
    doc,
    [
        "Faster-Whisper：device=cpu，compute_type=int8，模型优先 base 或 small；避免 large。",
        "模型进程单例常驻，避免多 Worker 重复加载占满内存。",
        "并发：单机单用户场景足够；多会话需排队或限流，否则延迟抖动。",
        "Piper：可选用 zh 系 medium 模型，CPU 推理通常可接受；注意与磁盘 IO（临时 WAV）的平衡。",
    ],
)

add_heading(doc, "五、VOICE_MODE 状态管理（相对初版的修正）", 1)
add_paragraph(doc, "初版「全局内存变量」在单机开发可用，迭代建议如下：")
add_bullets(
    doc,
    [
        "单机演示：内存 + POST /api/voice-mode 即可；进程重启后恢复默认「在线」。",
        "体验：前端用 localStorage 记住用户选择，初始化时先读本地再与后端对齐，避免刷新后状态闪烁。",
        "若未来多实例/多用户：改为无状态（请求头 X-Voice-Mode）或 Redis；不在此版强制实现。",
    ],
)

add_heading(doc, "六、接口与数据路径（迭代细化）", 1)
add_paragraph(doc, "5.1 本地 ASR HTTP 接口")
add_bullets(
    doc,
    [
        "建议同时支持：完整文件上传（multipart）与「单块 PCM/WAV」二进制体，便于调试。",
        "浏览器常见 WebM/Opus：服务端或 Node 侧需 ffmpeg（或等价）转为 16kHz mono PCM 再送 Whisper；否则识别失败或质量差。",
        "WebSocket → HTTP 桥接时，不必强行模拟 DashScope 二进制协议；可为「本地模式」定义简化事件（如 asr:partial / asr:final），前端分支更清晰。",
    ],
)
add_paragraph(doc, "5.2 本地 TTS")
add_bullets(
    doc,
    [
        "返回 WAV 二进制或 Base64，与现有 MultimodalSegment / TtsPlayback 播放链路对齐。",
        "若云端 TTS 支持流式而 Piper 仅整段，产品文案上可说明「本地模式为整句播放」。",
    ],
)

add_heading(doc, "七、分阶段交付（建议）", 1)
add_paragraph(doc, "阶段 A — 可演示闭环（1～2 周量级，视环境而定）")
add_bullets(
    doc,
    [
        "local-voice-service：FastAPI + Faster-Whisper（int8）+ Piper；固定端口如 8001。",
        "仅实现「分块/停顿时 ASR」+「整句 TTS」；前端侧边栏切换 + 后端转发。",
        "验收：本地模式下完成一次语音输入转文字 + 助手回复后本地 TTS 可听。",
    ],
)
add_paragraph(doc, "阶段 B — 体验优化")
add_bullets(
    doc,
    [
        "VAD、动态块长、请求合并与去抖，降低无效 HTTP 调用。",
        "TTS 按标点切句、缓存常用短句（可选）。",
        "监控：单次 ASR/TTS 耗时日志，便于调参。",
    ],
)
add_paragraph(doc, "阶段 C — 强实时（可选）")
add_bullets(
    doc,
    [
        "partial 转写、更细粒度流式协议；评估成本后再做。",
    ],
)

add_heading(doc, "八、风险与对策摘要", 1)
add_bullets(
    doc,
    [
        "内存：16GB 同时开 Node + 浏览器 + Whisper，需控制模型个数与并发。",
        "格式：WebM→PCM 链路未打通会导致「本地 ASR 全失败」，应尽早用样本音频打通。",
        "协议：硬模拟 DashScope 易踩坑；本地模式独立事件更稳。",
        "全局模式：多用户时内存状态不可靠，预留无状态或存储扩展点。",
    ],
)

add_heading(doc, "九、开发计划（按本次迭代落地）", 1)
add_paragraph(doc, "Sprint 1（MVP 可用，3~5 天）")
add_bullets(
    doc,
    [
        "任务 1：前端语音按钮触发统一（在线/离线均“点按开始-点按结束”）。",
        "任务 2：后端 VOICE_MODE 切换接口与状态同步（含 localStorage 回填）。",
        "任务 3：本地 ASR FastAPI 接口可收音频并返回文本（先完整段）。",
        "任务 4：本地 TTS FastAPI 接口可收文本并返回 WAV/Base64。",
        "任务 5：在线/离线路径打通，完成一次完整对话回路验证。"
    ],
)
add_paragraph(doc, "Sprint 2（体验优化，2~4 天）")
add_bullets(
    doc,
    [
        "任务 1：实现 TTS 文本清洗 + 分段合成 + 超长摘要播报策略。",
        "任务 2：加入可配置阈值（TTS_MAX_CHARS、TTS_SEGMENT_SIZE、TTS_MODE）。",
        "任务 3：补充前后端日志与性能统计（ASR/TTS 单次耗时）。",
        "任务 4：回归测试：在线模式不回归、离线模式可稳定切换。"
    ],
)
add_paragraph(doc, "验收标准（新增）")
add_bullets(
    doc,
    [
        "ASR：在线与离线触发行为一致，且离线识别可稳定返回结果。",
        "TTS：长回复不再整段生硬播报，首包等待时间显著下降。",
        "模式切换：刷新页面后模式状态正确恢复，且不会影响 LLM 云端路径。"
    ],
)

add_heading(doc, "十、与初版 Prompt 的对照", 1)
add_paragraph(
    doc,
    "初版任务清单仍然有效；本迭代版补充了：实时性边界、分阶段交付、VOICE_MODE 持久化建议、音视频转码必要性、以及「不强行模拟云端协议」的实现策略。实施时可先按阶段 A 落地，再决定是否进入阶段 B/C。",
)

out = "D:/DEMO/SmartAgent4_demo/docs/local_voice_dual_mode_plan_v0.3.docx"
doc.save(out)
print(out)
