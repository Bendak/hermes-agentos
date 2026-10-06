"""WI-4b lote 1 — M10-10: session-count model→profile fallback.

Counts must map to REAL profile ids ('default', not the nonexistent 'hermes')
and unmapped models must be conserved in an explicit bucket, never dropped.
"""

import os
import sqlite3

import pytest

import backend.sessions as sessions_mod


def test_fallback_maps_to_real_ids_and_conserves(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    con = sqlite3.connect(db_path)
    # sessions table WITHOUT profile_name → forces the model-mapping fallback
    con.execute("CREATE TABLE sessions (model TEXT)")
    con.executemany("INSERT INTO sessions (model) VALUES (?)",
                    [("gemini-3-flash-preview",)] * 2 +
                    [("zz-unmapped-model",)] * 3)
    con.commit()
    con.close()
    monkeypatch.setattr(sessions_mod, "STATE_DB", str(db_path))

    import asyncio
    result = asyncio.run(sessions_mod.count_sessions_by_profile())

    assert result.get("default") == 2, result       # was: 'hermes' (nonexistent id)
    assert result.get("unknown") == 3, result       # unmapped models conserved
    assert sum(result.values()) == 5, result        # nothing dropped
    assert "hermes" not in result, result


def test_parse_yaml_simple_handles_quotes_and_comments(tmp_path):
    """M10-11: the hand-rolled parser kept quotes and bled keys across blocks."""
    import backend.agents as agents_mod
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        '# comment with default: fake\n'
        'model:\n'
        '  default: "quoted-model"\n'
        '  provider: plain-prov  # trailing comment\n'
        'other:\n'
        '  default: not-this-one\n'
    )
    parsed = agents_mod._parse_yaml_simple(str(cfg))
    assert parsed["model"]["default"] == "quoted-model", parsed
    assert parsed["model"]["provider"] == "plain-prov", parsed


def test_discovery_single_source_and_collision_safe(tmp_path, monkeypatch):
    """M10-16: one source, consistent filters, 'default' reserved exactly once."""
    import backend.profile_discovery as disc
    sub = tmp_path / "profiles"
    sub.mkdir()
    (sub / "ok").mkdir()
    (sub / "default").mkdir()      # collision attempt — must be ignored
    (sub / ".hidden").mkdir()
    (sub / "_archive").mkdir()
    (tmp_path / "config.yaml").write_text("model:\n  default: m\n")
    monkeypatch.setattr(disc, "PROFILES_DIR", str(sub))
    monkeypatch.setattr(disc, "MAIN_CONFIG", str(tmp_path / "config.yaml"))

    ids = disc.discover_profile_ids(include_default=True)
    assert ids == ["default", "ok"], ids
    assert disc.iter_sub_profile_ids() == ["ok"]
