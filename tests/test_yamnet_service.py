from modules.team5_multimodal.yamnet_service import YamnetNoiseService


def test_compute_penalty_zero_when_no_classes():
    severity, penalty = YamnetNoiseService.compute_penalty([], max_penalty_points=25.0)
    assert severity == 0.0
    assert penalty == 0.0


def test_compute_penalty_respects_cap():
    classes = [
        {"confidence": 0.95, "time_share": 0.9, "penalty_weight": 1.0},
        {"confidence": 0.9, "time_share": 0.8, "penalty_weight": 1.0},
    ]
    severity, penalty = YamnetNoiseService.compute_penalty(classes, max_penalty_points=25.0)
    assert 0.0 <= severity <= 100.0
    assert 0.0 <= penalty <= 25.0


def test_merge_timeline_hits_merges_adjacent_same_label():
    hits = [
        {"label": "Electric fan", "start": 0.0, "end": 0.48, "confidence": 0.6, "category": "ac_fan"},
        {"label": "Electric fan", "start": 0.5, "end": 0.98, "confidence": 0.8, "category": "ac_fan"},
        {"label": "Television", "start": 1.2, "end": 1.68, "confidence": 0.7, "category": "tv_media"},
    ]
    merged = YamnetNoiseService.merge_timeline_hits(hits, max_gap=0.1)
    assert len(merged) == 2
    assert merged[0]["label"] == "Electric fan"
    assert merged[0]["start"] == 0.0
    assert merged[0]["end"] == 0.98
