"""Regression: issue #1 — config write must never drop file ownership.

Incident (2026-10-07): update_config() wrote via mkstemp (root-owned
temp) + rename, replacing /opt/data/config.yaml with root:root 640. The
gateway (user 'hermes') lost read access and every new agent turn died at
terminal_scope policy init. Mode was preserved (copymode) but OWNER was
not — this suite pins both.

The incident reproduction needs euid 0 (root writes over another uid's
file); on non-root runners the ownership part degrades to same-uid
preservation and the fail-loud unit tests still run.
"""

import asyncio
import os
from types import SimpleNamespace

import pytest

from backend import config_viewer
from backend.config_viewer import _preserve_owner, update_config


CONFIG_BODY = "model:\n  default: test-model\n"


def _write_config(path, uid=None, gid=None):
    path.write_text(CONFIG_BODY)
    os.chmod(path, 0o600)
    if uid is not None:
        os.chown(path, uid, gid)
    return os.stat(path)


def test_update_config_preserves_owner_and_mode(tmp_path, monkeypatch):
    cfg = tmp_path / "config.yaml"
    st = _write_config(cfg)
    monkeypatch.setattr(config_viewer, "CONFIG_PATH", str(cfg))

    if os.geteuid() == 0:
        # Reproduce the incident: config owned by ANOTHER user (the
        # gateway), written by root. The owner must survive.
        os.chown(cfg, 10000, 10000)
        st = os.stat(cfg)

    result = asyncio.run(update_config([{"path": ["model", "default"], "value": "other"}]))
    assert result is not None

    after = os.stat(cfg)
    assert (after.st_uid, after.st_gid) == (st.st_uid, st.st_gid), (
        "issue #1 regression: config write dropped ownership "
        f"{st.st_uid}:{st.st_gid} -> {after.st_uid}:{after.st_gid}"
    )
    assert (after.st_mode & 0o777) == (st.st_mode & 0o777)
    assert cfg.read_text().count("other") == 1  # patch actually applied


def test_preserve_owner_fails_loud_on_mismatch(tmp_path, monkeypatch):
    """If chown fails AND the temp owner differs from the original's, we
    must refuse loudly — never swap in a file the gateway cannot read."""
    tmp = tmp_path / "x.tmp"
    tmp.write_text("data")

    def boom(*a, **k):
        raise PermissionError("simulated: not allowed to chown")

    monkeypatch.setattr(config_viewer.os, "chown", boom)
    foreign = SimpleNamespace(st_uid=999999, st_gid=999999)
    with pytest.raises(RuntimeError, match="cannot preserve owner"):
        _preserve_owner(str(tmp), foreign)


def test_preserve_owner_tolerates_failed_chown_when_owner_matches(tmp_path, monkeypatch):
    """Non-root writer whose temp already has the right owner: a chown
    failure is harmless and must not block the write."""
    tmp = tmp_path / "x.tmp"
    tmp.write_text("data")
    st = os.stat(tmp)

    def boom(*a, **k):
        raise PermissionError("simulated")

    monkeypatch.setattr(config_viewer.os, "chown", boom)
    _preserve_owner(str(tmp), SimpleNamespace(st_uid=st.st_uid, st_gid=st.st_gid))
