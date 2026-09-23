"""Golden-file tests for the Prydwen adapter.

These exist so that a Prydwen redesign **fails loudly here** rather than
silently producing empty recommendations in the app. If one of these breaks,
open the failing selector in ``html_adapter`` and re-check it against a real
page (``scripts/capture-prydwen.py`` saves one locally).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from zzz_sidecar.prydwen.html_adapter import HtmlPrydwenSource
from zzz_sidecar.prydwen.http import clean_image_url
from zzz_sidecar.prydwen.source import PrydwenParseError

GOLDEN = Path(__file__).parent / "golden" / "agent_guide.html"


@pytest.fixture(scope="module")
def guide():
    html = GOLDEN.read_text(encoding="utf-8")
    # No network client needed: parse_guide is a pure function over HTML.
    parser = HtmlPrydwenSource.__new__(HtmlPrydwenSource)
    return parser.parse_guide("testagent", html)


def test_agent_name_strips_prydwens_title_framing(guide):
    assert guide.agent_name == "Testagent"


def test_primary_disc_set_is_four_piece_and_ranked(guide):
    primary = next(s for s in guide.disc_sets if s.pieces == 4)
    assert primary.set_name == "Mock Metal"
    assert primary.recommended is True
    assert "Best-in-slot" in primary.note


def test_an_ordinal_badge_is_a_rank_not_a_percentage(guide):
    # Prydwen reuses .percentage for a bare "1"/"2"/"3" on many disc-set
    # sections. Reading that as a score renders a best-in-slot set as "1%".
    primary = next(s for s in guide.disc_sets if s.pieces == 4)
    assert primary.rank == 1
    assert primary.rating == 0.0


def test_a_split_badge_reads_the_headline_figure(guide):
    # .percentage.split holds team and solo figures; take the first.
    assert guide.engines[1].rating == 72.40


def test_two_piece_options_are_captured_with_recommended_flag(guide):
    two_piece = {s.set_name: s for s in guide.disc_sets if s.pieces == 2}
    assert set(two_piece) == {"Fake Punk", "Sample Electro"}
    assert two_piece["Fake Punk"].recommended is True
    assert two_piece["Sample Electro"].recommended is False


def test_engines_are_ranked_among_engines_only(guide):
    # Disc sets share the .single-item class, so a naive enumerate would make
    # the second engine rank 3. Guard against that regression.
    assert [(e.rank, e.name) for e in guide.engines] == [
        (1, "Testing Blade"),
        (2, "Budget Driver"),
    ]


def test_engine_rating_and_superimpose(guide):
    top = guide.engines[0]
    assert top.rating == 100.0
    assert top.recommended_superimpose == 1
    assert guide.engines[1].recommended_superimpose == 5


def test_engine_note_comes_from_the_following_sibling(guide):
    # Prydwen renders .information as a sibling of .single-item, not a child.
    assert "strongest option" in guide.engines[0].note
    # Usage-pill blocks are not prose and must not leak into the note.
    assert "Usage:" not in guide.engines[1].note


def test_substat_priority_is_split_and_ordered(guide):
    # Bare names now — the stated cap moved to substat_targets, so it is not
    # duplicated (and differently formatted) in two fields.
    assert guide.substat_priority == [
        "CRIT RATE",
        "CRIT DMG",
        "ATK%",
        "Anomaly Proficiency",
        "PEN",
    ]


def test_substat_targets_splits_the_stated_cap_from_the_name(guide):
    targets = {t.name: t.target for t in guide.substat_targets}
    assert targets["CRIT RATE"] == "Until 80%"
    # The rest of the order has no stated cap — chase as much as the build
    # allows, not a specific number.
    assert targets["CRIT DMG"] == ""
    assert targets["ATK%"] == ""


def test_substat_targets_is_the_same_order_as_substat_priority(guide):
    assert [t.name for t in guide.substat_targets] == guide.substat_priority


def test_endgame_stats_split_label_from_value(guide):
    stats = {s.stat: s.value for s in guide.endgame_stats}
    assert stats["ATK"] == "2500 - 3600+ (Depending on Disc Drive main stat choice)"
    assert stats["CRIT RATE"] == "75-95%"
    assert stats["CRIT DMG"] == "150-190%"


def test_skill_priority_is_ordered_and_skips_the_chevron_separators(guide):
    # Both the desktop and mobile chevron each have their own <div> between
    # skills — a naive "every child" read would double them up as phantom
    # skill entries.
    assert [s.skill for s in guide.skill_priority] == [
        "Chain Attack",
        "Special Attack",
        "Basic Attack",
    ]
    assert guide.skill_priority[0].icon.endswith("icon_ulti_full.webp")


def test_main_stats_keyed_by_disc_slot(guide):
    assert guide.main_stats == {
        "4": ["CRIT Rate%", "ATK%"],
        "5": ["Ice DMG%", "ATK%"],
        "6": ["ATK%"],
    }


def test_teams_use_display_names_from_image_alt(guide):
    assert guide.teams[0].agent_names == ["Testagent", "Supportagent", "Stunagent"]
    assert "Rank 1" in guide.teams[0].note
    assert guide.teams[1].agent_names == ["Testagent", "Unownedagent"]


def test_a_page_that_is_not_a_guide_fails_loudly():
    parser = HtmlPrydwenSource.__new__(HtmlPrydwenSource)
    with pytest.raises(PrydwenParseError) as excinfo:
        parser.parse_guide("nope", "<html><body><p>404</p></body></html>")
    assert excinfo.value.slug == "nope"


def test_next_image_urls_are_unwrapped_to_the_cdn():
    wrapped = "/_next/image?url=https%3A%2F%2Fcdn.prydwen.gg%2Fimages%2Fa.webp&w=128&q=75"
    assert clean_image_url(wrapped) == "https://cdn.prydwen.gg/images/a.webp"
    assert clean_image_url("https://cdn.prydwen.gg/b.webp") == "https://cdn.prydwen.gg/b.webp"
    assert clean_image_url("") == ""
