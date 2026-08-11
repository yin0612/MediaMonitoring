"""從真實新聞快照計算關鍵字熱度與 ORG 共現網絡。

所有數字都可由 news-archive 的 items 重算：
- 關鍵字命中＝標題+短摘要的 substring 比對（大小寫不敏感）。
- 熱度公式：NewsHeat = 100 × (0.50·V + 0.33·A + 0.17·D)
  - V 聲量：24 小時命中數 log1p 後除以當期最大值。
  - A 加速度：近 6 小時相對前 6 小時的成長，0.5 為持平。
  - D 來源多樣性：來源分布熵除以 ln(啟用來源數)。
- 共現＝兩個詞典實體出現在同一篇（標題+短摘要）的獨立文件數。
"""
from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median

import yaml

from .models import NormalizedItem

HEAT_WEIGHTS = {"volume": 0.5, "acceleration": 0.33, "diversity": 0.17}
KEYWORD_WINDOW = timedelta(hours=24)
TREND_BUCKETS = 24
# 碎片升級：父字串需涵蓋本詞至少此比例的文件才視為更完整的詞。
PROMOTE_RATIO = 0.6
MAX_PROMOTE_STEPS = 4
_CJK_RUN_RE = re.compile(r"[㐀-鿿]+")


def _normalized_title(value: str) -> str:
    value = re.sub(r"[\s\W_]+", "", value.casefold(), flags=re.UNICODE)
    return re.sub(r"(?:快訊|即時|更新)$", "", value)


def _trigrams(value: str) -> set[str]:
    normalized = _normalized_title(value)
    if len(normalized) < 3:
        return {normalized} if normalized else set()
    return {normalized[index : index + 3] for index in range(len(normalized) - 2)}


def cluster_events(items: list[NormalizedItem], *, threshold: float = 0.46) -> list[dict]:
    """Greedy, traceable 48-hour title clustering using Chinese 3-gram Jaccard."""
    clusters: list[dict] = []
    for item in sorted(items, key=lambda value: value.published_at, reverse=True):
        grams = _trigrams(item.title)
        match = None
        best = 0.0
        for cluster in clusters:
            if abs((cluster["latest"] - item.published_at).total_seconds()) > 48 * 3600:
                continue
            union = grams | cluster["grams"]
            score = len(grams & cluster["grams"]) / len(union) if union else 0.0
            if score >= threshold and score > best:
                match, best = cluster, score
        if match is None:
            clusters.append({"latest": item.published_at, "grams": grams, "items": [item]})
        else:
            match["items"].append(item)
            match["grams"] |= grams
    result = []
    for index, cluster in enumerate(clusters, 1):
        members = cluster["items"]
        result.append({
            "id": f"event-{members[0].published_at:%Y%m%d}-{index}",
            "representativeTitle": members[0].title,
            "articleCount": len(members),
            "sourceCount": len({item.source for item in members}),
            "startedAt": min(item.published_at for item in members).isoformat().replace("+00:00", "Z"),
            "updatedAt": max(item.published_at for item in members).isoformat().replace("+00:00", "Z"),
            "sourceCounts": dict(sorted(Counter(item.source for item in members).items())),
            "articles": [
                {
                    "title": item.title,
                    "source": item.source,
                    "url": item.url,
                    "publishedAt": item.published_at.isoformat().replace("+00:00", "Z"),
                }
                for item in members[:8]
            ],
        })
    return sorted(result, key=lambda value: (-value["articleCount"], value["id"]))


def robust_burst_score(current: int, baseline: list[int], *, source_count: int) -> float | None:
    """Median/MAD burst score; low-support samples intentionally produce no claim."""
    if current < 5 or source_count < 3 or len(baseline) < 7:
        return None
    center = median(baseline)
    mad = median(abs(value - center) for value in baseline)
    return round((current - center) / max(1.0, 1.4826 * mad), 3)


def load_watch_config(path: Path) -> dict:
    config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {
        "watch_terms": config.get("watch_terms") or [],
        "auto_terms": config.get("auto_terms") or {},
    }


def _matches(search_text: str, any_of: list[str], exclude: list[str]) -> bool:
    haystack = search_text.casefold()
    if any(term.casefold() in haystack for term in exclude if term):
        return False
    return any(term.casefold() in haystack for term in any_of if term)


def extract_auto_terms(
    items: list[NormalizedItem], watch_terms: list[dict], auto_cfg: dict
) -> list[str]:
    """從標題的 CJK n-gram（2–6 字）統計自動熱詞；全程可重算、無模型。"""
    max_terms = int(auto_cfg.get("max_terms", 10))
    min_docs = max(2, int(auto_cfg.get("min_docs", 2)))
    min_length = int(auto_cfg.get("min_length", 2))
    # 單一媒體的固定版型詞（例如節目名、欄目前綴）不具跨媒體熱度意義。
    min_sources = max(1, int(auto_cfg.get("min_sources", 3)))
    stopwords = [str(word) for word in auto_cfg.get("stopwords") or []]
    watch_vocab = [
        str(term) for entry in watch_terms for term in [entry.get("display", ""), *(entry.get("any_of") or [])] if term
    ]

    doc_count: dict[str, int] = {}
    gram_docs: dict[str, set[int]] = {}
    gram_sources: dict[str, set[str]] = {}
    for doc_id, item in enumerate(items):
        grams: set[str] = set()
        for run in _CJK_RUN_RE.findall(item.title):
            for size in range(min_length, 7):
                for start in range(0, len(run) - size + 1):
                    grams.add(run[start : start + size])
        for gram in grams:
            doc_count[gram] = doc_count.get(gram, 0) + 1
            gram_docs.setdefault(gram, set()).add(doc_id)
            gram_sources.setdefault(gram, set()).add(item.source)

    def blocked(gram: str) -> bool:
        if any(stop in gram for stop in stopwords):
            return True
        return any(gram in vocab or vocab in gram for vocab in watch_vocab)

    def dominated_by_blocked(gram: str) -> bool:
        """若某個「更長且被封鎖」的詞涵蓋了本詞 ≥80% 的文件，本詞只是它的碎片（如「目標」←「目標價」）。"""
        threshold = 0.8 * doc_count[gram]
        for cand, count in doc_count.items():
            if len(cand) > len(gram) and gram in cand and count >= threshold and blocked(cand):
                return True
        return False

    def eligible(gram: str) -> bool:
        return (
            doc_count[gram] >= min_docs
            and len(gram_sources[gram]) >= min_sources
            and not blocked(gram)
            and not dominated_by_blocked(gram)
        )

    def promote(gram: str) -> str:
        """碎片升級：反覆往外擴一個字，直到沒有夠支配性的父字串。

        單次擴一字無法處理「無人」→「無人機」這種需要連續擴展、且子詞文件數
        只佔部分的情況，故改為迭代並將門檻放寬到 PROMOTE_RATIO。
        真正的獨立詞（如「台積電」）出現語境分散，不會有單一父字串達到此比例，
        因此不會被過度升級。
        """
        current = gram
        for _ in range(MAX_PROMOTE_STEPS):
            threshold = PROMOTE_RATIO * doc_count[current]
            candidates = [
                cand
                for cand in doc_count
                if current in cand
                and len(cand) == len(current) + 1
                and doc_count[cand] >= threshold
                and eligible(cand)
            ]
            if not candidates:
                break
            current = max(candidates, key=lambda cand: (doc_count[cand], cand))
        return current

    def redundant(gram: str, chosen: list[str]) -> bool:
        """去冗餘：子/父字串、或與已選詞的命中文件高度重疊（同一事件的不同碎片）。"""
        for kept in chosen:
            if gram in kept or kept in gram:
                return True
            overlap = len(gram_docs[gram] & gram_docs[kept])
            if overlap >= 0.6 * min(len(gram_docs[gram]), len(gram_docs[kept])):
                return True
        return False

    ranked = sorted(
        (gram for gram in doc_count if eligible(gram)),
        key=lambda gram: (-doc_count[gram], -len(gram), gram),
    )
    chosen: list[str] = []
    for gram in ranked:
        if len(chosen) >= max_terms:
            break
        term = promote(gram)
        if not redundant(term, chosen):
            chosen.append(term)
    return chosen


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def _js_round(value: float, digits: int = 0) -> float:
    """與 JavaScript Math.round 對齊，避免 Python bankers rounding 造成 parity 漂移。"""
    factor = 10**digits
    return math.floor(value * factor + 0.5) / factor


def _entropy_diversity(share: dict[str, float], enabled_source_count: int) -> float:
    if len(share) <= 1 or enabled_source_count <= 1:
        return 0.0
    entropy = -sum(p * math.log(p) for p in share.values() if p > 0)
    return _clamp01(entropy / math.log(enabled_source_count))


def build_keywords(
    items: list[NormalizedItem],
    watch_config: dict,
    now: datetime | None = None,
    *,
    # 必填：這個值是 diversity 分量的分母，直接決定顯示給使用者的熱度。
    # 先前預設為 24，實際來源已是 37；沿用預設值會產出看似正常但偏高的熱度，
    # 而且不會有任何錯誤訊息。寧可要求呼叫端明講。
    enabled_source_count: int,
) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    window_start = now - KEYWORD_WINDOW
    recent = [item for item in items if item.published_at >= window_start]

    watch_terms = watch_config.get("watch_terms") or []
    auto_terms = extract_auto_terms(recent, watch_terms, watch_config.get("auto_terms") or {})

    definitions: list[dict] = []
    for entry in watch_terms:
        display = str(entry.get("display", "")).strip()
        if not display:
            continue
        any_of = [str(term) for term in entry.get("any_of") or [display]]
        definitions.append(
            {
                "id": f"watch-{entry.get('id', display)}",
                "term": display,
                "kind": "manual",
                "any_of": any_of,
                "exclude": [str(term) for term in entry.get("exclude") or []],
                "aliases": [term for term in any_of if term != display],
            }
        )
    for index, term in enumerate(auto_terms):
        definitions.append(
            {"id": f"auto-{index + 1}", "term": term, "kind": "auto", "any_of": [term], "exclude": [], "aliases": []}
        )

    bucket_ms = KEYWORD_WINDOW / TREND_BUCKETS
    computed: list[dict] = []
    for definition in definitions:
        matched = [item for item in recent if _matches(item.search_text, definition["any_of"], definition["exclude"])]
        source_counts: dict[str, int] = {}
        for item in matched:
            source_counts[item.source] = source_counts.get(item.source, 0) + 1
        total = len(matched)
        share = {source: _js_round(count / total, 3) for source, count in source_counts.items()} if total else {}
        buckets = [0] * TREND_BUCKETS
        for item in matched:
            index = min(TREND_BUCKETS - 1, int((item.published_at - window_start) / bucket_ms))
            buckets[index] += 1
        recent6 = sum(buckets[-6:])
        previous6 = sum(buckets[-12:-6])
        if total:
            raw_acceleration = _clamp01(0.5 + (recent6 - previous6) / (2 * max(1, recent6, previous6)))
            # 低聲量時向 0.5（持平）收斂，避免 2 篇新聞就被判定為爆量成長。
            acceleration = 0.5 + (raw_acceleration - 0.5) * min(1.0, total / 10)
        else:
            acceleration = 0.0
        computed.append(
            {
                "definition": definition,
                "matched": total,
                "share": share,
                "buckets": buckets,
                "acceleration": acceleration,
            }
        )

    max_mentions = max([entry["matched"] for entry in computed], default=0)
    max_bucket = max((count for entry in computed for count in entry["buckets"]), default=0)
    keywords: list[dict] = []
    for entry in computed:
        definition = entry["definition"]
        total = entry["matched"]
        volume = _clamp01(math.log1p(total) / math.log1p(max_mentions)) if max_mentions and total else 0.0
        diversity = _entropy_diversity(entry["share"], enabled_source_count)
        acceleration = entry["acceleration"]
        heat = _js_round(
            100
            * (
                HEAT_WEIGHTS["volume"] * volume
                + HEAT_WEIGHTS["acceleration"] * acceleration
                + HEAT_WEIGHTS["diversity"] * diversity
            ),
            1,
        )
        keyword = {
            "id": definition["id"],
            "term": definition["term"],
            "kind": definition["kind"],
            "heat": heat,
            "mentions24h": total,
            "components": {
                "volume": _js_round(volume, 3),
                "acceleration": _js_round(acceleration, 3),
                "diversity": _js_round(diversity, 3),
                "weights": dict(HEAT_WEIGHTS),
            },
            "sourceShare": entry["share"],
            "trend": [
                {
                    "t": (
                        window_start + index * bucket_ms
                    ).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                    "mentions": count,
                    "heat": _js_round(100 * count / max_bucket, 1) if max_bucket else 0.0,
                }
                for index, count in enumerate(entry["buckets"])
            ],
        }
        if definition["aliases"]:
            keyword["aliases"] = definition["aliases"]
        keywords.append(keyword)

    keywords.sort(key=lambda value: (-value["heat"], -value["mentions24h"], value["term"]))
    return keywords


# ── ORG 共現網絡 ──────────────────────────────────────────────────────────────

MIN_NODE_MENTIONS = 2
MIN_EDGE_WEIGHT = 2
# 分型別配額：ORG 提及數天然較高，共用單一上限會把 PERSON 全數擠掉
MAX_ORG_NODES = 24
MAX_PERSON_NODES = 16


def load_entity_lexicon(path: Path) -> list[dict]:
    """載入 ORG 與 PERSON 詞典；每筆帶 type，供共現圖區分節點類別。"""
    config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    lexicon: list[dict] = []
    for key, entity_type in (("orgs", "ORG"), ("persons", "PERSON")):
        for entry in config.get(key) or []:
            if isinstance(entry, str):
                lexicon.append({"name": entry, "aliases": [], "type": entity_type})
            elif isinstance(entry, dict) and entry.get("name"):
                lexicon.append(
                    {
                        "name": str(entry["name"]),
                        "aliases": [str(a) for a in entry.get("aliases") or []],
                        "type": entity_type,
                    }
                )
    return lexicon


def build_entities(items: list[NormalizedItem], lexicon: list[dict]) -> dict:
    """回傳 {nodes, edges}；只統計詞典內 ORG／PERSON 在同一篇的共現，不做推論。

    ORG 的提及數天然高於 PERSON，若用單一總量上限，人物幾乎不可能入選，
    因此改為分型別配額，確保兩類都能呈現。
    """
    types = {entry["name"]: entry.get("type", "ORG") for entry in lexicon}
    mentions: dict[str, int] = {}
    pair_docs: dict[tuple[str, str], int] = {}
    for item in items:
        haystack = item.search_text.casefold()
        present = sorted(
            {
                entry["name"]
                for entry in lexicon
                if any(term.casefold() in haystack for term in [entry["name"], *entry["aliases"]])
            }
        )
        for name in present:
            mentions[name] = mentions.get(name, 0) + 1
        for left_index in range(len(present)):
            for right_index in range(left_index + 1, len(present)):
                pair = (present[left_index], present[right_index])
                pair_docs[pair] = pair_docs.get(pair, 0) + 1

    eligible = [name for name, count in mentions.items() if count >= MIN_NODE_MENTIONS]
    kept: list[str] = []
    for entity_type, quota in (("ORG", MAX_ORG_NODES), ("PERSON", MAX_PERSON_NODES)):
        ranked = sorted(
            (name for name in eligible if types.get(name, "ORG") == entity_type),
            key=lambda name: (-mentions[name], name),
        )
        kept.extend(ranked[:quota])
    kept.sort(key=lambda name: (-mentions[name], name))

    node_ids = {
        name: f"{'person' if types.get(name, 'ORG') == 'PERSON' else 'org'}-{index + 1}"
        for index, name in enumerate(kept)
    }
    nodes = [
        {"id": node_ids[name], "name": name, "type": types.get(name, "ORG"), "mentions": mentions[name]}
        for name in kept
    ]
    total_docs = max(1, len(items))
    edges = [
        {
            "source": node_ids[left],
            "target": node_ids[right],
            "weight": weight,
            "jaccard": round(weight / (mentions[left] + mentions[right] - weight), 3),
            "npmi": (
                round(
                    math.log((weight / total_docs) / ((mentions[left] / total_docs) * (mentions[right] / total_docs)))
                    / max(1e-9, -math.log(weight / total_docs)),
                    3,
                )
                if weight < total_docs
                else 1.0
            ),
        }
        for (left, right), weight in sorted(pair_docs.items(), key=lambda pair: (-pair[1], pair[0]))
        if weight >= MIN_EDGE_WEIGHT and left in node_ids and right in node_ids
    ]
    return {"nodes": nodes, "edges": edges}
