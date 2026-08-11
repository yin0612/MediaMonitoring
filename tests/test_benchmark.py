from scripts.build_benchmark import build_candidates


def test_benchmark_is_deterministic_stratified_and_reserves_double_annotations():
    items = [
        {"id": str(index), "source": f"s{index % 5}", "publishedAt": f"2026-08-{index % 10 + 1:02d}T00:00:00Z", "title": f"t{index}", "url": f"https://e/{index}"}
        for index in range(100)
    ]
    first = build_candidates(items, 80)
    second = build_candidates(list(reversed(items)), 80)
    assert first == second
    assert len(first) == 80
    assert len({row["sampleId"] for row in first}) == 80
    assert sum(row["doubleAnnotation"] for row in first) == 8
    assert {row["split"] for row in first} == {"train", "dev", "test"}
    assert all(row["annotations"]["annotator1"] is None for row in first)
