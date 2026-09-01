from tournament.event_settings import (
    DEFAULT_HERO_LAYERS,
    EventSettingsError,
    parse_event_settings,
    parse_hero_layers,
)


def test_hero_layers_default_to_see_through_dusk():
    assert parse_hero_layers(None) == DEFAULT_HERO_LAYERS
    assert parse_event_settings({})["hero_layers"] == DEFAULT_HERO_LAYERS


def test_hero_layers_accept_empty_list_and_color_wash():
    assert parse_hero_layers([]) == []
    parsed = parse_hero_layers(
        [{"kind": "dusk", "opacity": 0.5}, {"kind": "color", "color": "#1A1815", "opacity": 0.2}]
    )
    assert parsed == [
        {"kind": "dusk", "opacity": 0.5},
        {"kind": "color", "color": "#1a1815", "opacity": 0.2},
    ]


def test_hero_layers_reject_unknown_kind():
    try:
        parse_hero_layers([{"kind": "blur", "opacity": 0.4}])
    except EventSettingsError as exc:
        assert "dusk or color" in exc.message
    else:
        raise AssertionError("expected validation error")


def test_omitted_hero_layers_keeps_existing():
    stored = parse_event_settings(
        {"hero_layers": [{"kind": "color", "color": "#4a4030", "opacity": 0.4}]}
    )
    kept = parse_event_settings({"description": "x"}, existing=stored)
    assert kept["hero_layers"] == [{"kind": "color", "color": "#4a4030", "opacity": 0.4}]
    assert kept["description"] == "x"
