from tournament.event_settings import (
    DEFAULT_HERO_TEXT,
    EventSettingsError,
    parse_event_settings,
    parse_hero_text,
)


def test_hero_text_defaults_to_light_cream_on_dusk():
    assert parse_hero_text(None) == DEFAULT_HERO_TEXT
    assert parse_event_settings({})["hero_text"] == DEFAULT_HERO_TEXT


def test_hero_text_accepts_custom_fill_and_empty_outline():
    parsed = parse_hero_text({"color": "#C4A06A", "outline": ""})
    assert parsed == {"color": "#c4a06a", "outline": ""}


def test_hero_text_rejects_bad_hex():
    try:
        parse_hero_text({"color": "cream"})
    except EventSettingsError as exc:
        assert "hero_text.color" in exc.message
    else:
        raise AssertionError("expected validation error")


def test_omitted_hero_text_keeps_existing():
    stored = parse_event_settings({"hero_text": {"color": "#1a1815", "outline": "#e4dfd5"}})
    kept = parse_event_settings({"description": "x"}, existing=stored)
    assert kept["hero_text"] == {"color": "#1a1815", "outline": "#e4dfd5"}
    assert kept["description"] == "x"
