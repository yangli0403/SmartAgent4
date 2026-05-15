#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SmartAgent4 低延迟相似性意图纠偏原型。

目的：验证不引入重模型时，基于小规模意图样例库的字符 n-gram TF-IDF / cosine
是否能在 Manus 沙盒中快速运行，并对当前 Demo 中的误分类样例给出更合理的纠偏信号。

说明：这是工程方案评估用原型，不依赖外部服务、不访问网络、不读取隐私数据。
"""
from __future__ import annotations

import math
import re
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple


@dataclass(frozen=True)
class IntentCandidate:
    domain: str
    agent: str
    label: str
    examples: List[str]


CANDIDATES: List[IntentCandidate] = [
    IntentCandidate(
        domain="general",
        agent="generalAgent",
        label="memory_personalized_recommendation_or_query",
        examples=[
            "按我的喜好推荐今晚安排",
            "根据我的偏好适合吃什么听什么",
            "你还记得我喜欢听谁的歌吗",
            "我之前说过我喜欢什么",
            "按照我的习惯给我推荐",
            "我喜欢周杰伦少吃辣更喜欢安静活动",
            "记住我的偏好",
            "更新我的偏好",
            "以后别推荐太吵的活动",
            "昨晚那条路线帮我再说一遍",
            "上次说的路线怎么走",
        ],
    ),
    IntentCandidate(
        domain="navigation",
        agent="navigationAgent",
        label="navigation_route_or_poi",
        examples=[
            "帮我规划从起点到终点的路线",
            "导航到虹桥机场",
            "怎么去苏州北站",
            "查附近的餐厅和停车场",
            "从太湖软件园到上海虹桥机场途经山姆和苏州北站",
            "开车路线 公交路线 步行路线",
            "查询天气 地图 周边 POI",
        ],
    ),
    IntentCandidate(
        domain="multimedia",
        agent="multimediaAgent",
        label="music_search_or_playback",
        examples=[
            "播放周杰伦的歌",
            "搜索歌曲和歌手",
            "来一首音乐",
            "打开歌单",
            "播放每日推荐",
            "找专辑歌词",
        ],
    ),
    IntentCandidate(
        domain="file_system",
        agent="fileAgent",
        label="file_search_or_disk",
        examples=[
            "查找文件",
            "分析磁盘空间",
            "打开文档",
            "扫描目录",
        ],
    ),
    IntentCandidate(
        domain="office",
        agent="officeAgent",
        label="office_message_calendar",
        examples=[
            "发送飞书消息",
            "创建日程",
            "帮我写邮件",
            "新建会议",
        ],
    ),
]

# 这些规则不是替代相似性，而是模拟线上应有的“高精度保护条件”。
MEMORY_GUARD_PATTERNS = [
    re.compile(p)
    for p in [
        r"你还?记得|记不记得|我.*(之前|以前|上次|昨晚|昨天).*(说|提|聊|告诉|路线)",
        r"(昨晚|昨天|上次|之前|以前).{0,12}(路线|怎么走|怎么去)|那条路线",
        r"按我的|根据我的|我的(喜好|偏好|习惯)|适合我的",
        r"以后.*(少|别|不要)|记住|更新.*偏好",
    ]
]

NAV_EXPLICIT_PATTERNS = [
    re.compile(p)
    for p in [
        r"(导航|路线|怎么去|到.+怎么走|从.+到.+|途经|途径)",
        r"(机场|火车站|高铁站|软件园|山姆|虹桥|苏州北站)",
    ]
]

MUSIC_ACTION_PATTERNS = [re.compile(r"^(播放|放|来一首|搜索|搜|找).{0,12}(歌|音乐|歌曲|歌手|专辑|歌词)")]


def char_ngrams(text: str, n_min: int = 1, n_max: int = 3) -> List[str]:
    text = re.sub(r"\s+", "", text.lower())
    grams: List[str] = []
    for n in range(n_min, n_max + 1):
        if len(text) >= n:
            grams.extend(text[i : i + n] for i in range(len(text) - n + 1))
    return grams


def build_docs() -> Tuple[List[Tuple[str, str, str]], Dict[str, float], List[Counter]]:
    docs: List[Tuple[str, str, str]] = []
    counters: List[Counter] = []
    df: Dict[str, int] = defaultdict(int)
    for c in CANDIDATES:
        merged = " ".join([c.label, c.domain, c.agent, *c.examples])
        docs.append((c.domain, c.agent, c.label))
        cnt = Counter(char_ngrams(merged))
        counters.append(cnt)
        for term in cnt:
            df[term] += 1
    total = len(docs)
    idf = {term: math.log((1 + total) / (1 + freq)) + 1.0 for term, freq in df.items()}
    return docs, idf, counters


DOCS, IDF, DOC_COUNTERS = build_docs()


def vectorize(counter: Counter) -> Dict[str, float]:
    return {term: tf * IDF.get(term, 1.0) for term, tf in counter.items()}


DOC_VECS = [vectorize(c) for c in DOC_COUNTERS]
DOC_NORMS = [math.sqrt(sum(v * v for v in vec.values())) or 1.0 for vec in DOC_VECS]


def cosine(a: Dict[str, float], b: Dict[str, float], norm_b: float) -> float:
    norm_a = math.sqrt(sum(v * v for v in a.values())) or 1.0
    if len(a) > len(b):
        a, b = b, a
    dot = sum(v * b.get(k, 0.0) for k, v in a.items())
    return dot / (norm_a * norm_b)


def guard_domain(query: str) -> str | None:
    if any(p.search(query) for p in MEMORY_GUARD_PATTERNS):
        # 如果是显式规划路线，而不是“昨晚/上次/记得”的回忆路线，允许导航优先。
        explicit_nav = any(p.search(query) for p in NAV_EXPLICIT_PATTERNS)
        memory_ref = re.search(r"(昨晚|上次|之前|记得|说过|那条)", query)
        if explicit_nav and not memory_ref and not re.search(r"按我的|根据我的|偏好|喜好", query):
            return None
        return "general"
    if any(p.search(query) for p in MUSIC_ACTION_PATTERNS):
        return "multimedia"
    return None


def classify_by_similarity(query: str) -> List[Tuple[str, str, str, float]]:
    qvec = vectorize(Counter(char_ngrams(query)))
    scores = []
    for (domain, agent, label), dvec, norm in zip(DOCS, DOC_VECS, DOC_NORMS):
        scores.append((domain, agent, label, cosine(qvec, dvec, norm)))
    scores.sort(key=lambda x: x[3], reverse=True)
    return scores


def correct_intent(query: str, llm_domain: str | None = None) -> Dict[str, object]:
    guarded = guard_domain(query)
    scores = classify_by_similarity(query)
    top = scores[0]
    second = scores[1]
    chosen_domain = guarded or top[0]
    reason = "guard" if guarded else "similarity"

    # 与 LLM 分类冲突时，只有在相似性足够高且分差明显/命中 guard 时才覆盖。
    should_override = False
    if llm_domain and llm_domain != chosen_domain:
        if guarded:
            should_override = True
        elif top[3] >= 0.26 and (top[3] - second[3]) >= 0.035:
            should_override = True

    return {
        "query": query,
        "llm_domain": llm_domain,
        "chosen_domain": chosen_domain if should_override or not llm_domain else llm_domain,
        "suggested_domain": chosen_domain,
        "should_override": should_override,
        "reason": reason,
        "top_scores": scores[:3],
    }


def main() -> None:
    tests = [
        ("按我的喜好，今晚适合吃什么、听什么？", "navigation"),
        ("你还记得我喜欢听谁的歌吗？", "multimedia"),
        ("昨晚的路线怎么走？", "navigation"),
        ("帮我规划一下明天早上从苏州太湖软件园到上海虹桥机场的路线，中途经过山姆会员店和苏州北站。", "navigation"),
        ("播放周杰伦的歌", "multimedia"),
        ("帮我查附近的川菜馆怎么走", "navigation"),
        ("以后少给我推荐太吵的活动，我更喜欢安静一点。", "general"),
    ]

    print("=== 样例纠偏结果 ===")
    for query, llm_domain in tests:
        r = correct_intent(query, llm_domain)
        print(f"query={query}")
        print(f"  llm={llm_domain} suggested={r['suggested_domain']} final={r['chosen_domain']} override={r['should_override']} reason={r['reason']}")
        print("  top=", [(d, round(s, 4)) for d, _a, _l, s in r["top_scores"]])

    rounds = 20000
    start = time.perf_counter()
    for i in range(rounds):
        q, d = tests[i % len(tests)]
        correct_intent(q, d)
    elapsed_ms = (time.perf_counter() - start) * 1000
    print("\n=== 延迟基准 ===")
    print(f"rounds={rounds}")
    print(f"total_ms={elapsed_ms:.2f}")
    print(f"avg_ms={elapsed_ms / rounds:.4f}")


if __name__ == "__main__":
    main()
