"""Generate AIRI integration plan Word document (v0.x)."""

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


def add_table(
    doc: Document,
    headers: list[str],
    rows: list[list[str]],
):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Table Grid"
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = h
        for p in hdr[i].paragraphs:
            for r in p.runs:
                set_run_font(r)
    for ri, row in enumerate(rows):
        cells = table.rows[ri + 1].cells
        for ci, cell_text in enumerate(row):
            cells[ci].text = cell_text
            for p in cells[ci].paragraphs:
                for r in p.runs:
                    set_run_font(r, size_pt=10)
    doc.add_paragraph()


def build_document() -> Document:
    doc = Document()
    add_heading(doc, "SmartAgent4 × AIRI 对话-形象联动实施方案", 0)
    add_paragraph(doc, "文档版本：v0.1")
    add_paragraph(doc, "变更说明：在 v1.0 草案基础上，增补「短期/长期展现差异」全文与 10 条典型话术对照表。")
    add_paragraph(doc, "目标：将「对话输出」稳定映射为虚拟形象的表情、动作、口型，实现可观测、可回退、可扩展的联动链路。")

    add_heading(doc, "一、当前现状与问题定义", 1)
    add_paragraph(doc, "当前前端已可展示 AIRI 形象并具备鼠标跟随/闲置动画能力，但对话输出与形象表现尚未打通。")
    add_paragraph(doc, "核心差异：鼠标跟随属于本地交互层；对话驱动属于语义层，需要通过「语义解析 → 指令映射 → 渲染执行」的链路实现。")

    add_heading(doc, "二、短期方案与长期方案：展现形式上的区别（含场景）", 1)
    add_paragraph(doc, "一句话区别：短期方案侧重「快速看起来会动」；长期方案侧重「像真人在表达」的一致性、可控性与可扩展性。")

    add_heading(doc, "2.1 表情触发方式", 2)
    add_paragraph(doc, "差异：短期基于关键词/情绪标签直接映射（如开心→smile）；长期基于结构化指令（情绪+强度+语气+上下文）综合决策。")
    add_paragraph(doc, "场景示例：用户说「终于搞定了，太好了！」——短期：固定 smile，表现较单一；长期：smile + 轻点头 + 强度约 0.8，且与上文衔接时有自然过渡。")

    add_heading(doc, "2.2 动作编排", 2)
    add_paragraph(doc, "差异：短期多为「一条回复一个主动作」；长期支持动作队列、优先级、打断与恢复（聊天动作 > 鼠标跟随 > idle）。")
    add_paragraph(doc, "场景示例：用户连续说「这个报错很烦…不过刚刚修好了。」——短期：可能先 sad 后瞬间切 happy，观感跳变；长期：先短暂低落，再平滑过渡到轻松表情与庆祝类动作。")

    add_heading(doc, "2.3 口型与语音一致性", 2)
    add_paragraph(doc, "差异：短期常按文本长度估算嘴型时长；长期按真实语音流/音素驱动口型。")
    add_paragraph(doc, "场景示例：助手回复一段约 20 秒的长解释——短期：嘴型可能机械开合，与停顿不完全对齐；长期：停顿、重音、语速变化能反映在口型节奏上。")

    add_heading(doc, "2.4 稳定性与冲突处理", 2)
    add_paragraph(doc, "差异：短期以「能跑」为主，可能出现鼠标跟随与对话动作抢戏；长期有冲突仲裁与降级（失败不影响主对话）。")
    add_paragraph(doc, "场景示例：用户一边大幅移动鼠标一边触发高情绪回复——短期：可能出现「头跟鼠标、脸做另一套动作」的冲突；长期：短时锁定对话动作优先级，结束后再恢复鼠标跟随。")

    add_heading(doc, "2.5 多端与后续扩展", 2)
    add_paragraph(doc, "差异：短期多绑定当前前端与当前模型，换端需重调；长期走统一 StageDirective，可复用到 AIRI Bridge、桌面端等。")
    add_paragraph(doc, "场景示例：后续要接「语音直播形象」——短期：往往要另做一套适配；长期：复用同一套情绪与动作协议，仅增加适配层。")

    add_heading(doc, "2.6 调试与运营可观测性", 2)
    add_paragraph(doc, "差异：短期主要靠日志人工排查；长期有事件追踪、失败率与延迟指标。")
    add_paragraph(doc, "场景示例：运营反馈「今天角色偶尔不笑了」——短期：依赖复现与猜原因；长期：可区分是 LLM 未输出情绪、映射表缺失还是前端驱动失败。")

    add_heading(doc, "三、10 条典型话术：短期 vs 长期 展现对照表", 1)
    add_paragraph(doc, "下表从用户输入或对话情境出发，对比同一情境下「短期方案」与「长期方案」在屏幕上的典型表现（表情/动作/口型/冲突处理）。")

    comparison_rows = [
        [
            "1",
            "终于搞定了，太好了！",
            "关键词命中「好」→ 直接 smile；动作可能单次点头或默认庆祝；口型按整段文本估时。",
            "综合情绪为欣喜+释然：smile 强度渐变、可加轻点头；口型若接 TTS 则跟音节；与 idle 平滑衔接。",
        ],
        [
            "2",
            "这个报错很烦…不过刚刚修好了。",
            "前半句可能 sad，后半句切 happy，易出现「瞬切」；中间无过渡动作。",
            "识别转折语气：先短暂皱眉/无奈，再过渡到轻松；动作用队列播放，避免跳变。",
        ],
        [
            "3",
            "（助手输出约 20 秒的技术长文解释）",
            "嘴型持续开合，节奏与标点/停顿弱相关；长文中途表情可能停在首轮映射结果。",
            "口型与分段/停顿对齐；中途可根据段落语气微调表情（如强调处略加重）。",
        ],
        [
            "4",
            "用户边快速移动鼠标边连续发消息。",
            "鼠标跟随与对话表情可能同时抢驱动，形象「各动各的」。",
            "对话期提高 chat 优先级，暂抑 hover；结束后再恢复跟随，过渡自然。",
        ],
        [
            "5",
            "对不起，刚才我理解错了。",
            "命中道歉词 → 歉意类表情（若映射表有）；否则 neutral。",
            "歉意+自责语气：低头/轻微鞠躬类动作（若模型支持）+ 较低强度表情，持续可配置。",
        ],
        [
            "6",
            "什么？原来是这样！",
            "惊讶词 → surprised 表情，动作可能固定一次。",
            "惊讶程度可分档；可先瞪眼再过渡到 neutral；避免与上一轮表情硬切。",
        ],
        [
            "7",
            "这产品太难用了，气死我了。",
            "生气词 → angry 或皱眉；易与真实用户情绪强度不匹配（过强或过弱）。",
            "结合强度与上下文：适度愤怒表现+安抚型后续回复时的表情回落策略。",
        ],
        [
            "8",
            "你能再说一遍步骤吗？我没听懂。",
            "疑问/请求类或映射为 neutral+轻微歪头（若有）；否则偏平淡。",
            "识别「困惑+求助」：表情偏耐心、鼓励；动作可配合「请讲」类手势（模型支持时）。",
        ],
        [
            "9",
            "谢谢你，帮大忙了。",
            "感谢词 → happy/smile；表现较套路化。",
            "感谢+高满意度：微笑强度略升、可加致谢点头；若连续感谢可去重避免重复动作。",
        ],
        [
            "10",
            "今天天气不错。",
            "若无强关键词，可能长期停在 idle 或 neutral，变化少。",
            "可配置「闲聊轻情绪」：轻微愉悦+小幅动作，避免过于呆板（需防骚扰式乱动，靠节流）。",
        ],
    ]

    add_table(
        doc,
        ["序号", "典型用户话术 / 情境", "短期方案（展现形式）", "长期方案（展现形式）"],
        comparison_rows,
    )

    add_heading(doc, "四、总体实施路径（四阶段）", 1)
    add_paragraph(doc, "阶段一：前端直连打通（快速见效）")
    add_paragraph(doc, "阶段二：统一协议抽象（降低返工）")
    add_paragraph(doc, "阶段三：AIRI Bridge 全链路接入（架构归一）")
    add_paragraph(doc, "阶段四：稳定性与体验优化（生产可用）")

    add_heading(doc, "五、阶段一：前端直连打通（建议先做）", 1)
    add_paragraph(doc, "目标：在不依赖 AIRI Runtime 全链路的前提下，让「每条对话回复」都能触发可见表情/动作。")
    add_paragraph(doc, "范围：仅改 SmartAgent4 后端输出结构 + 前端舞台事件总线，不改核心业务流程。")
    add_paragraph(doc, "主要任务：")
    add_paragraph(doc, "1) 后端在对话响应中增加结构化字段，例如 emotion、intent、intensity。")
    add_paragraph(doc, "2) 前端 chat 页面在收到消息后，派发 stage directive（expression/motion/lipsync）。")
    add_paragraph(doc, "3) useExpressionDriver / useMotionDriver / useLipsyncDriver 消费 directive 并执行。")
    add_paragraph(doc, "4) 增加兜底规则：映射失败时默认 neutral + idle。")
    add_paragraph(doc, "验收标准：")
    add_paragraph(doc, "- 连续 20 轮对话中，90% 以上回复可触发表情变化。")
    add_paragraph(doc, "- 任何异常都不影响文本对话（展示失败可降级）。")
    add_paragraph(doc, "- 前端可视化面板可看到每次 directive 的原始数据。")
    add_paragraph(doc, "预计工期：0.5~1 天。")

    add_heading(doc, "六、阶段二：统一协议抽象", 1)
    add_paragraph(doc, "目标：定义统一的 StageDirective，后续不论走前端直连还是 AIRI Bridge，均复用同一套协议。")
    add_paragraph(doc, "建议字段：")
    add_paragraph(doc, "- emotion: neutral/happy/sad/angry/surprised/...")
    add_paragraph(doc, "- expression: 模型表情名")
    add_paragraph(doc, "- motion: 模型动作名")
    add_paragraph(doc, "- intensity: 0~1")
    add_paragraph(doc, "- durationMs: 持续时长")
    add_paragraph(doc, "- priority: chat > hover > idle")
    add_paragraph(doc, "- traceId: 追踪链路ID")
    add_paragraph(doc, "主要任务：")
    add_paragraph(doc, "1) 定义 TypeScript 类型与运行时校验（Zod）。")
    add_paragraph(doc, "2) 统一映射表（语义标签 → 具体模型动作名）。")
    add_paragraph(doc, "3) 增加版本号与向后兼容处理。")
    add_paragraph(doc, "验收标准：")
    add_paragraph(doc, "- 同一条 directive 在本地直连和 Bridge 模式表现一致。")
    add_paragraph(doc, "- 升级映射表不影响历史消息回放。")
    add_paragraph(doc, "预计工期：0.5 天。")

    add_heading(doc, "七、阶段三：AIRI Bridge 全链路接入", 1)
    add_paragraph(doc, "目标：通过 Bridge 将 SmartAgent4 输出转发给 AIRI Runtime，再由 AIRI Runtime 驱动前端。")
    add_paragraph(doc, "前置条件：")
    add_paragraph(doc, "- AIRI Runtime WebSocket 服务可连接（默认 ws://localhost:6121/ws）。")
    add_paragraph(doc, "- Bridge 与 Runtime 协议事件已对齐。")
    add_paragraph(doc, "主要任务：")
    add_paragraph(doc, "1) 将 StageDirective 封装到 output:gen-ai:chat:message / complete 事件。")
    add_paragraph(doc, "2) 对齐 AIRI 端事件消费逻辑（表情、动作、口型、打断策略）。")
    add_paragraph(doc, "3) 增加连接状态面板（connected/reconnecting/failed）。")
    add_paragraph(doc, "验收标准：")
    add_paragraph(doc, "- 断开 Runtime 后，系统自动重连且不影响文本主流程。")
    add_paragraph(doc, "- 与阶段一同样的对话，在 Bridge 模式视觉表现一致。")
    add_paragraph(doc, "预计工期：1 天（视 Runtime 联调复杂度可浮动）。")

    add_heading(doc, "八、阶段四：稳定性与体验优化", 1)
    add_paragraph(doc, "目标：将联动从「能用」提升到「好用且稳定」。")
    add_paragraph(doc, "主要任务：")
    add_paragraph(doc, "1) 冲突仲裁：chat 动作高优先级，结束后平滑回 idle。")
    add_paragraph(doc, "2) 节流与去抖：避免高频消息造成动作抖动。")
    add_paragraph(doc, "3) A/B 参数调优：表情强度、动作时长、口型节奏。")
    add_paragraph(doc, "4) 观测告警：失败率、平均渲染延迟、重连次数。")
    add_paragraph(doc, "验收标准：")
    add_paragraph(doc, "- 长时间运行（2 小时）无明显卡顿或动作堆积。")
    add_paragraph(doc, "- 联动失败率低于 1%，平均延迟 < 300ms。")
    add_paragraph(doc, "预计工期：1~2 天。")

    add_heading(doc, "九、风险与对策", 1)
    add_paragraph(doc, "风险1：模型动作名不一致，导致事件有值但无表现。")
    add_paragraph(doc, "对策：建立「模型能力清单」，映射前先校验支持项。")
    add_paragraph(doc, "风险2：AIRI Runtime 地址或协议不一致。")
    add_paragraph(doc, "对策：加入连接探针与握手日志，先做协议最小闭环。")
    add_paragraph(doc, "风险3：多事件并发导致动作冲突。")
    add_paragraph(doc, "对策：引入 priority + cancel token + 队列上限。")

    add_heading(doc, "十、里程碑与交付清单", 1)
    add_paragraph(doc, "M1（阶段一完成）：前端可见联动 + 调试面板。")
    add_paragraph(doc, "M2（阶段二完成）：统一 StageDirective + 类型校验。")
    add_paragraph(doc, "M3（阶段三完成）：Bridge 全链路联调通过。")
    add_paragraph(doc, "M4（阶段四完成）：稳定性达标，可作为默认体验。")
    add_paragraph(doc, "交付物：")
    add_paragraph(doc, "- 方案文档（本文件）")
    add_paragraph(doc, "- StageDirective 类型定义与映射表")
    add_paragraph(doc, "- 联调脚本与回归检查清单")

    return doc


if __name__ == "__main__":
    out = "D:/DEMO/SmartAgent4_demo/docs/AIRI_integration_plan_v0.1.docx"
    build_document().save(out)
    print(out)
