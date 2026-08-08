"""共用資料模型。Connector 一律輸出 NormalizedItem，後續演算法不依賴來源原始格式。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class NormalizedItem:
    """來源正規化後的單一內容項目（只保留可公開呈現的欄位）。"""

    source: str            # 來源代碼，例如 "cna"
    source_item_id: str    # 來源提供的 ID 或連結，用於去重
    title: str
    excerpt: str           # 短前言（截斷，不含全文）
    url: str               # 原文 canonical URL
    published_at: datetime  # UTC
    # 供關鍵字比對用的正規化文字（標題 + 前言）
    search_text: str = ""

    def __post_init__(self) -> None:
        if not self.search_text:
            self.search_text = f"{self.title} {self.excerpt}".strip()


@dataclass
class SourceResult:
    """單一來源這次擷取的結果與健康狀態。"""

    id: str
    name: str
    enabled: bool
    ok: bool
    error_code: str | None = None
    items: list[NormalizedItem] = field(default_factory=list)
    # 這次擷取被捨棄的項目統計（例如 {"invalid_time": 3, "no_link_or_title": 1}），供狀態頁診斷。
    drop_reasons: dict[str, int] = field(default_factory=dict)

    @property
    def item_count(self) -> int:
        return len(self.items)
