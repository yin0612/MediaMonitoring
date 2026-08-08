"""共現網絡納入 PERSON 後的行為測試。"""
from datetime import datetime, timezone
from pathlib import Path

from opinion_pipeline.analysis import build_entities, load_entity_lexicon
from opinion_pipeline.models import NormalizedItem

LEXICON = [
    {"name": "行政院", "aliases": [], "type": "ORG"},
    {"name": "立法院", "aliases": ["立院"], "type": "ORG"},
    {"name": "卓榮泰", "aliases": ["卓揆"], "type": "PERSON"},
    # 含空白的名稱，用來驗證邊的鍵值不會被空白裂解
    {"name": "Donald Trump", "aliases": [], "type": "PERSON"},
]


def item(index: int, title: str) -> NormalizedItem:
    return NormalizedItem(
        source="cna",
        source_item_id=str(index),
        title=title,
        excerpt="",
        url=f"https://example.com/{index}",
        published_at=datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc),
    )


def test_person_nodes_are_emitted_with_type_and_id_prefix():
    items = [item(i, "卓榮泰率行政院團隊赴立法院報告") for i in range(3)]
    graph = build_entities(items, LEXICON)

    people = [node for node in graph["nodes"] if node["type"] == "PERSON"]
    assert people, "PERSON 節點必須出現在共現圖中"
    assert all(node["id"].startswith("person-") for node in people)
    assert {node["name"] for node in people} == {"卓榮泰"}


def test_person_org_edges_are_created():
    items = [item(i, "卓榮泰率行政院團隊赴立法院報告") for i in range(3)]
    graph = build_entities(items, LEXICON)
    types = {node["id"]: node["type"] for node in graph["nodes"]}

    mixed = [
        edge for edge in graph["edges"] if types[edge["source"]] != types[edge["target"]]
    ]
    assert mixed, "應建立人物與組織之間的共現邊"


def test_names_containing_spaces_do_not_corrupt_edges():
    """名稱含空白時，邊仍必須指向真實節點（舊實作以空白串接會裂解）。"""
    items = [item(i, "Donald Trump 與行政院官員會面") for i in range(3)]
    graph = build_entities(items, LEXICON)

    node_ids = {node["id"] for node in graph["nodes"]}
    names = {node["name"] for node in graph["nodes"]}
    assert "Donald Trump" in names
    for edge in graph["edges"]:
        assert edge["source"] in node_ids and edge["target"] in node_ids


def test_real_lexicon_loads_both_types():
    lexicon = load_entity_lexicon(Path("config/entities.yml"))
    types = {entry["type"] for entry in lexicon}
    assert types == {"ORG", "PERSON"}
