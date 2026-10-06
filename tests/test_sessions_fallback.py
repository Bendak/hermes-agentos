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
