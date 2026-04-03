/**
 * 从长期记忆中推断用户「常住地 / 家」的地理编码查询串，供 ContextManager 优先于 IP 定位使用。
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memories } from "../../drizzle/schema";

const RESIDENCE_HINT =
  /(?:家在|家住|住在|居住|住址|我家|落户|定居|常住)/;
const WORK_WITHOUT_HOME =
  /(?:公司|单位|上班|工作)(?:在|于)/;

const AFTER_RESIDENCE =
  /(?:家住|住在|居住(?:于|在)?|家[在是]|我的家[在是]|住址[为是：:]|定居在?|落户在?|常住(?:于|在)?)\s*([^，。；\n]+)/;

/**
 * 从一条记忆正文中抽出适合交给地理编码 API 的短查询（城市/区县等）。
 */
export function extractGeocodeQueryFromResidenceText(raw: string): string {
  let t = raw
    .trim()
    .replace(/^(?:用户|他|她|该用户)?(?:说|提到|表示)?[：:：]?\s*/, "");

  const m = t.match(AFTER_RESIDENCE);
  if (m?.[1]) {
    let seg = m[1].trim();
    const wi = seg.search(WORK_WITHOUT_HOME);
    if (wi > 2) seg = seg.slice(0, wi).trim();
    seg = seg.replace(/^(?:的|在|是)\s*/, "").trim();
    if (seg.length > 48) seg = seg.slice(0, 48).trim();
    if (seg.length >= 2) return seg;
  }

  t = t.replace(
    /^(?:我在|我家|我的家|家[在是]|家住|住在|居住(?:于|在)?|住址[为是：:]|定居在?|落户在?|常住(?:于|在)?)\s*/,
    ""
  );

  let first = t.split(/[，。；\n]/)[0]?.trim() || t;
  const workIdx = first.search(WORK_WITHOUT_HOME);
  if (workIdx > 2) {
    first = first.slice(0, workIdx).trim();
  }

  first = first.replace(/^(?:的|在|是)\s*/, "").trim();
  if (first.length > 48) first = first.slice(0, 48).trim();
  return first;
}

/**
 * 返回用于 open-meteo 等地理编码的一条查询串；无合适记忆时返回 null。
 */
export async function getPreferredResidenceGeocodeQuery(
  userId: number
): Promise<string | null> {
  if (userId <= 0) return null;

  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.type, "fact")))
    .orderBy(desc(memories.updatedAt))
    .limit(80);

  type Cand = { q: string; score: number; t: number };
  const candidates: Cand[] = [];

  for (const m of rows) {
    const c = (m.content || "").trim();
    if (c.length < 4 || c.length > 800) continue;

    let score = 0;
    if (RESIDENCE_HINT.test(c)) score += 4;
    if (/家/.test(c)) score += 2;
    if (/住/.test(c)) score += 1;
    if (
      /(?:公司|单位|上班)/.test(c) &&
      !/家|居住|住址|定居|常住/.test(c)
    ) {
      score -= 3;
    }

    if (score < 3) continue;

    const q = extractGeocodeQueryFromResidenceText(c);
    if (q.length < 2) continue;

    const t = m.updatedAt ? new Date(m.updatedAt).getTime() : 0;
    candidates.push({ q, score, t });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score || b.t - a.t);
  return candidates[0].q;
}
