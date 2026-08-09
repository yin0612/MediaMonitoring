"""詞典法情緒判讀（baseline）。

刻意不使用模型：全部為字面比對，因此每一次判讀都能重算，也能對使用者說明
「為什麼判為負向」——命中詞就是依據。未經人工標註集驗證前，一律視為實驗性。

規則：
- 命中詞前 `negation_window` 個字內若出現否定詞，該詞極性反轉（「不看好」→ 負向）。
- 分數 = (正分 - 負分) / (正分 + 負分)，落在 -1..1；正負相等時為中立。

已知限制（刻意保留，Worker 端 analysis.js 行為完全相同以維持 parity）：
每個詞只採計**第一次出現**的位置，否定判斷也只看那個位置。因此「不看好後續，
但看好長線」這種同詞多次、極性不一致的句子只會反映第一次的判讀。要改動這點
必須同時修改兩端，並且需要人工標註集證明改動確實更準；在 macro-F1 達到 0.70
之前，這裡一律只當 baseline，不宜為了直覺而調整演算法。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_NEGATIONS = ["不", "未", "無", "沒", "免", "難以", "並非", "毫無", "拒", "否認"]


@dataclass
class SentimentLexicon:
    positive: dict[str, int] = field(default_factory=dict)
    negative: dict[str, int] = field(default_factory=dict)
    negations: list[str] = field(default_factory=lambda: list(DEFAULT_NEGATIONS))
    negation_window: int = 4

    @property
    def size(self) -> int:
        return len(self.positive) + len(self.negative)


def load_sentiment_lexicon(path: Path) -> SentimentLexicon:
    config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    def terms(key: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for entry in config.get(key) or []:
            if isinstance(entry, str):
                out[entry] = 1
            elif isinstance(entry, dict) and entry.get("term"):
                out[str(entry["term"])] = int(entry.get("weight", 1))
        return out

    return SentimentLexicon(
        positive=terms("positive"),
        negative=terms("negative"),
        negations=[str(n) for n in config.get("negations") or DEFAULT_NEGATIONS],
        negation_window=int(config.get("negation_window", 4)),
    )


def _negated(text: str, index: int, lexicon: SentimentLexicon) -> bool:
    """命中詞前方視窗內是否出現否定詞。"""
    start = max(0, index - lexicon.negation_window)
    window = text[start:index]
    return any(neg in window for neg in lexicon.negations)


def classify(text: str, lexicon: SentimentLexicon) -> dict:
    """回傳 {label, score, matched}；matched 即為前端顯示的正／負向依據。"""
    if not text:
        return {"label": "neutral", "score": 0.0, "matched": []}

    positive_score = 0
    negative_score = 0
    matched: list[dict] = []

    for polarity, table in (("positive", lexicon.positive), ("negative", lexicon.negative)):
        for term, weight in table.items():
            # 只取第一次出現；同詞多次且極性不一致時不會被完整反映。
            # 這是刻意的 baseline 限制，與 Worker 端一致，詳見模組 docstring。
            index = text.find(term)
            if index < 0:
                continue
            effective = polarity
            if _negated(text, index, lexicon):
                effective = "negative" if polarity == "positive" else "positive"
            if effective == "positive":
                positive_score += weight
            else:
                negative_score += weight
            matched.append({"term": term, "polarity": effective, "weight": weight})

    total = positive_score + negative_score
    if total == 0:
        return {"label": "neutral", "score": 0.0, "matched": []}

    score = (positive_score - negative_score) / total
    if positive_score > negative_score:
        label = "positive"
    elif negative_score > positive_score:
        label = "negative"
    else:
        label = "neutral"

    # 依權重排序，讓前端優先顯示最有代表性的依據
    matched.sort(key=lambda entry: (-entry["weight"], entry["term"]))
    return {"label": label, "score": round(score, 3), "matched": matched[:6]}


def aggregate(labels: list[str]) -> dict[str, float]:
    """把逐篇標籤彙總成主題層的三分比例（總和為 1）。"""
    if not labels:
        return {"positive": 0.0, "neutral": 1.0, "negative": 0.0}
    total = len(labels)
    counts = {
        "positive": sum(1 for label in labels if label == "positive"),
        "negative": sum(1 for label in labels if label == "negative"),
    }
    counts["neutral"] = total - counts["positive"] - counts["negative"]
    # 先取三位小數，再把捨入誤差補回最大項，確保總和恰為 1
    ratios = {key: round(value / total, 3) for key, value in counts.items()}
    drift = round(1.0 - sum(ratios.values()), 3)
    if drift:
        dominant = max(ratios, key=lambda key: ratios[key])
        ratios[dominant] = round(ratios[dominant] + drift, 3)
    return ratios
