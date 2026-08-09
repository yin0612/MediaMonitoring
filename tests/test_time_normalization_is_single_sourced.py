"""所有發布時間都必須走 timeutil.normalize_published 這一條規則。

README 宣稱時間正規化只有一份規則，但 rss.py 與 archive.py 曾各自複製一份
帶魔術數字（5 分鐘容忍值／8 小時校正）的實作，總共三份。任何一份被單獨修改
都會靜默分歧，而且分歧的是「新聞多新」這種使用者直接看到的數字。
"""
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from opinion_pipeline.archive import item_to_public, public_to_item
from opinion_pipeline.connectors.rss import _parse_time
from opinion_pipeline.models import NormalizedItem
from opinion_pipeline.timeutil import FUTURE_TOLERANCE, normalize_published

NOW = datetime(2026, 8, 9, 9, 0, tzinfo=timezone.utc)
SOURCES_WITH_OWN_COPY = (
    Path("src/opinion_pipeline/connectors/rss.py"),
    Path("src/opinion_pipeline/archive.py"),
)


def _struct_time(value: datetime):
    return time.struct_time(value.utctimetuple())


def test_no_module_reimplements_the_eight_hour_correction():
    """校正常數只能出現在 timeutil；別處出現就是又複製了一份規則。"""
    for path in SOURCES_WITH_OWN_COPY:
        body = path.read_text(encoding="utf-8")
        assert "timedelta(hours=8)" not in body, f"{path} 不應自行實作 8 小時校正"
        assert "timedelta(minutes=5)" not in body, f"{path} 不應自行實作未來時間容忍值"
        assert "normalize_published" in body, f"{path} 應委派 timeutil.normalize_published"


def test_rss_parse_time_matches_the_single_rule():
    """feedparser 的時間必須與直接呼叫 normalize_published 得到相同結果。"""
    for offset in (timedelta(hours=-30), timedelta(hours=-1), timedelta(minutes=1)):
        moment = NOW + offset
        entry = {"published_parsed": _struct_time(moment)}
        expected = normalize_published(moment.replace(tzinfo=timezone.utc), NOW)
        assert _parse_time(entry, NOW) == expected


def test_rss_parse_time_corrects_taiwan_time_mislabelled_as_gmt():
    """台灣時間誤標 GMT 會落在未來 8 小時，必須被校正回真實時刻。"""
    mislabelled = NOW + timedelta(hours=8)
    entry = {"published_parsed": _struct_time(mislabelled)}

    assert _parse_time(entry, NOW) == NOW


def test_rss_parse_time_drops_unrecoverable_future_times():
    entry = {"published_parsed": _struct_time(NOW + timedelta(days=3))}

    assert _parse_time(entry, NOW) is None


def test_rss_parse_time_falls_back_to_updated_when_published_missing():
    moment = NOW - timedelta(hours=2)
    entry = {"updated_parsed": _struct_time(moment)}

    assert _parse_time(entry, NOW) == moment


def test_public_round_trip_preserves_the_published_instant():
    moment = NOW - timedelta(hours=5)
    item = NormalizedItem(
        source="tvbs",
        source_item_id="a1",
        title="標題",
        excerpt="摘要",
        url="https://news.tvbs.com.tw/story/1",
        published_at=moment,
    )

    restored = public_to_item(item_to_public(item), NOW)

    assert restored is not None
    assert restored.published_at == moment


def test_public_to_item_applies_the_taipei_rule_to_a_naive_timestamp():
    """缺時區的快照不該整筆丟棄；依規則視為台北時間。

    先前的實作會讓 naive 與 aware 相減而拋 TypeError，整筆被吞掉。
    """
    naive_taipei = "2026-08-09T16:00:00"  # 台北 16:00 == 08:00Z

    restored = public_to_item(
        {
            "source": "tvbs",
            "title": "標題",
            "url": "https://news.tvbs.com.tw/story/2",
            "publishedAt": naive_taipei,
        },
        NOW,
    )

    assert restored is not None
    assert restored.published_at == datetime(2026, 8, 9, 8, 0, tzinfo=timezone.utc)


def test_public_to_item_still_drops_unrecoverable_future_times():
    assert (
        public_to_item(
            {
                "source": "tvbs",
                "title": "標題",
                "url": "https://news.tvbs.com.tw/story/3",
                "publishedAt": (NOW + timedelta(days=3)).isoformat().replace("+00:00", "Z"),
            },
            NOW,
        )
        is None
    )


def test_future_tolerance_boundary_is_shared():
    """容忍值邊界由 timeutil 定義，兩條路徑都必須遵守同一個界線。"""
    inside = NOW + FUTURE_TOLERANCE
    entry = {"published_parsed": _struct_time(inside)}

    assert _parse_time(entry, NOW) == inside
