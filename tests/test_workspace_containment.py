"""Workspace containment suite (F-M4-01 / F-M4-04 / F-M4-16 + root-strict).

Covers backend/tasks.py:
- _validate_workspace_path: allowlist root enforcement, file-not-dir,
  bad input, and the root-strict rule (the allowlist root itself is NOT a
  valid workspace_path — only strict children are).
- _contained_path: read-side file containment (symlink escapes, absolute
  path joins, dot-dot traversal).
- write-side: create_task raises ValueError BEFORE any DB work.

Layout built under the sandbox allowlist root (see conftest):
    wsroot/ws1              valid workspace
    wsroot/ws1-secrets      sibling sharing the string prefix, OUTSIDE ws1
    <sandbox>/outside       outside the allowlist root entirely
"""

import asyncio
import os

import pytest

from backend.tasks import _contained_path, _validate_workspace_path


@pytest.fixture(scope="module")
def tree(wsroot):
    ws = wsroot / "ws1"
    sibling = wsroot / "ws1-secrets"
    outside = wsroot.parent / "outside"
    ws.mkdir(exist_ok=True)
    sibling.mkdir(exist_ok=True)
    outside.mkdir(exist_ok=True)
    (ws / "ok.txt").write_text("ok")
    (sibling / "secret.txt").write_text("FAKE SECRET")
    (outside / "evil.txt").write_text("evil")
    leak = ws / "leak"
    if leak.is_symlink() or leak.exists():
        leak.unlink()
    leak.symlink_to(sibling / "secret.txt")  # M4-04 escape vector
    a_file = wsroot.parent / "afile.txt"
    a_file.write_text("x")
    return {"ws": ws, "sibling": sibling, "outside": outside, "a_file": a_file}


def _rejects(value) -> bool:
    try:
        _validate_workspace_path(value)
        return False
    except ValueError:
        return True


# ── _validate_workspace_path ────────────────────────────────────────────────


def test_inside_root_accepted(tree):
    assert _validate_workspace_path(str(tree["ws"])) == os.path.realpath(tree["ws"])


def test_outside_allowlist_root_rejected(tree):
    assert _rejects(str(tree["outside"]))  # F-M4-01


def test_sibling_prefix_dir_is_its_own_workspace(tree):
    # Allowed (it is under the root); the escape is prevented at file level,
    # see test_symlink_to_sibling_blocked below.
    assert not _rejects(str(tree["sibling"]))


def test_file_not_dir_rejected(tree):
    assert _rejects(str(tree["a_file"]))  # F-M4-16 write side


@pytest.mark.parametrize("bad", ["", "   ", None, 123, "/nonexistent-xyz"])
def test_bad_input_rejected(bad):
    assert _rejects(bad)


def test_allowlist_root_itself_rejected(wsroot):
    # Root-strict: only strict children are valid workspaces (real != root),
    # so the allowlist root can never become a task workspace.
    assert _rejects(str(wsroot))


def test_direct_child_accepted(wsroot):
    child = wsroot / "ws-child"
    child.mkdir(exist_ok=True)
    assert _validate_workspace_path(str(child)) == os.path.realpath(child)


# ── _contained_path (read-side, M4-04) ─────────────────────────────────────


def test_file_inside_ws_allowed(tree):
    assert _contained_path(str(tree["ws"] / "ok.txt"), str(tree["ws"]))


def test_symlink_to_sibling_blocked(tree):
    assert not _contained_path(str(tree["ws"] / "leak"), str(tree["ws"]))  # M4-04 repro


def test_sibling_file_blocked(tree):
    assert not _contained_path(str(tree["sibling"] / "secret.txt"), str(tree["ws"]))


def test_absolute_filename_join_blocks(tree):
    assert not _contained_path(str(tree["ws"] / "/etc/passwd"), str(tree["ws"]))


def test_dotdot_resolves_then_blocks(tree):
    escape = tree["ws"] / ".." / "ws1-secrets" / "secret.txt"
    assert not _contained_path(str(escape), str(tree["ws"]))


def test_ws_itself_contained_in_ws(tree):
    assert _contained_path(str(tree["ws"]), str(tree["ws"]))


# ── write-side: ValueError before any DB work ───────────────────────────────


def test_create_task_rejects_out_of_root_path_pre_db(tree):
    from backend import tasks as tmod

    with pytest.raises(ValueError):
        asyncio.run(tmod.create_task(title="probe", workspace_path=str(tree["outside"])))
