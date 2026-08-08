"""發布時間正規化的單一規則來源。

規則（依序套用）：
1. 無時區資訊的時間一律視為台灣時間（Asia/Taipei，UTC+8），不得當成 UTC。
2. 已帶時區者轉成 UTC。
3. 超出容忍值（5 分鐘）的未來時間，嘗試以「台灣時間誤標為 GMT」情境減 8 小時校正。
4. 校正後仍在未來則回傳 None（寧可捨棄也不顯示假時間）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

TAIPEI = timezone(timedelta(hours=8))
FUTURE_TOLERANCE = timedelta(minutes=5)


def normalize_published(value: datetime | None, now: datetime | None = None) -> datetime | None:
    if value is None:
        return None
    current = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=TAIPEI)
    value = value.astimezone(timezone.utc)
    if value > current + FUTURE_TOLERANCE:
        corrected = value - timedelta(hours=8)
        if corrected <= current + FUTURE_TOLERANCE:
            value = corrected
    if value > current + FUTURE_TOLERANCE:
        return None
    return value
