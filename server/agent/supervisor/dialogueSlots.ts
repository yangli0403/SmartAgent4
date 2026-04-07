/**
 * DialogueSlots — 多轮对话结构化槽位（启发式抽取）
 *
 * 与「最近对话文本摘要」互补：槽位给模型稳定的城市/起终点/途经点，
 * 摘要保留指代与自然语言细节。抽取无额外 LLM 调用，可随会话增长重算全量。
 */

import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import type { DialogueSlots } from "./state";

function contentToPlain(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          "text" in (part as Record<string, unknown>)
        ) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

/** 城市/区域：更具体的优先（列表顺序：先长后短同类） */
const REGION_CANDIDATES: string[] = [
  "苏州工业园区",
  "苏州市",
  "北京",
  "上海市",
  "上海",
  "深圳市",
  "深圳",
  "杭州市",
  "杭州",
  "南京市",
  "南京",
  "广州市",
  "广州",
  "成都市",
  "成都",
  "武汉市",
  "武汉",
  "香港特别行政区",
  "香港",
  "葵涌",
  "苏州",
];

function pickRegionHint(full: string): string | undefined {
  let best: string | undefined;
  for (const c of REGION_CANDIDATES) {
    if (!full.includes(c)) continue;
    if (!best || c.length > best.length) best = c;
  }
  return best;
}

/**
 * 从当前会话全部用户消息中抽取槽位（每轮重算，状态一致）。
 */
export function extractDialogueSlotsFromMessages(
  messages: BaseMessage[]
): DialogueSlots | undefined {
  const texts: string[] = [];
  for (const m of messages) {
    const type =
      typeof (m as { _getType?: () => string })._getType === "function"
        ? (m as { _getType: () => string })._getType()
        : "";
    if (type !== "human" && !(m instanceof HumanMessage)) continue;
    const t = contentToPlain(m.content).trim();
    if (t) texts.push(t);
  }
  const full = texts.join("\n");
  if (!full.trim()) return undefined;

  const slots: DialogueSlots = {};

  const region = pickRegionHint(full);
  if (region) slots.regionHint = region;

  const mCo = full.match(
    /(?:公司|单位|上班)(?:在|位于)?[：:\s]*([^；。\n]{2,50})/u
  );
  if (mCo) slots.navOrigin = mCo[1].trim();

  const mHome = full.match(
    /(?:家|住)(?:在|位于)?[：:\s]*([^；。\n]{2,50})/u
  );
  if (mHome) slots.navDestination = mHome[1].trim();

  if (/太湖软件园/.test(full) && !slots.navOrigin) {
    slots.navOrigin = "太湖软件园";
  }

  if (/九龙仓/.test(full) && !slots.navDestination) {
    slots.navDestination = "苏州工业园区九龙仓";
  }

  const wpSet = new Set<string>();
  for (const wm of full.matchAll(
    /(?:途径|途经|顺路|路过)(?:一下)?\s*([^\n。，？!?]{2,40})/gu
  )) {
    const w = wm[1].trim();
    if (w.length > 1) wpSet.add(w);
  }
  if (wpSet.size > 0) slots.navWaypoints = [...wpSet];

  if (
    !slots.regionHint &&
    !slots.navOrigin &&
    !slots.navDestination &&
    (!slots.navWaypoints || slots.navWaypoints.length === 0)
  ) {
    return undefined;
  }

  return slots;
}

/**
 * 无文本城市线索时，用语义层 IP/常住地城市作区域兜底。
 */
export function mergeDialogueSlotsWithLocationCity(
  slots: DialogueSlots | undefined,
  locationCity?: string
): DialogueSlots | undefined {
  if (!locationCity?.trim()) return slots;
  if (slots?.regionHint) return slots;
  if (!slots) {
    return { regionHint: locationCity.trim() };
  }
  return { ...slots, regionHint: locationCity.trim() };
}

/** 注入到 Domain Agent 任务消息（简短、固定格式） */
export function formatDialogueSlotsForTask(slots: DialogueSlots): string {
  const lines: string[] = ["（以下为会话槽位，工具检索城市/POI 时优先与此一致）"];
  if (slots.regionHint) lines.push(`- 区域/城市线索: ${slots.regionHint}`);
  if (slots.navOrigin) lines.push(`- 导航起点: ${slots.navOrigin}`);
  if (slots.navDestination) lines.push(`- 导航终点: ${slots.navDestination}`);
  if (slots.navWaypoints?.length) {
    lines.push(`- 途经/兴趣点: ${slots.navWaypoints.join("；")}`);
  }
  return lines.join("\n");
}
