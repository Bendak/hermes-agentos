"""WI-4a — Profiles: create contract, scoped delete, duplicate, broken-config repair.

Covers the M10 findings fixed in WI-4a:
  M10-01 create broken (payload contract id|name)
  M10-03 delete = destructive rmtree (now scoped; purge is opt-in)
  M10-06 duplicate loses SOUL.md
  M10-08 broken config.yaml makes the profile vanish + 500s
  M10-02 regression guard (viewer cannot mutate)
"""

import os

import pytest

PROFILES = os.environ["AGENTOS_PROFILES_DIR"]


def _pdir(pid: str) -> str:
    return os.path.join(PROFILES, pid)


def _mkprofile(pid: str, soul: str | None = None, skills: bool = False) -> None:
    os.makedirs(_pdir(pid), exist_ok=True)
    with open(os.path.join(_pdir(pid), "config.yaml"), "w", encoding="utf-8") as f:
        f.write(f"name: {pid}\nmodel:\n  default: zz-model\n  provider: zz-prov\n")
    if soul is not None:
        with open(os.path.join(_pdir(pid), "SOUL.md"), "w", encoding="utf-8") as f:
            f.write(soul)
    if skills:
        os.makedirs(os.path.join(_pdir(pid), "skills"), exist_ok=True)
        with open(os.path.join(_pdir(pid), "skills", "hello.md"), "w", encoding="utf-8") as f:
            f.write("# skill\n")


# ── M10-01: create contract ────────────────────────────────────────────────

def test_create_accepts_name(client, admin_headers):
    r = client.post("/api/profiles", headers=admin_headers,
                    json={"name": "zz-create-a", "model": {"default": "m", "provider": "p"}})
    assert r.status_code == 200, r.text
    assert os.path.isfile(os.path.join(_pdir("zz-create-a"), "config.yaml"))
    client.delete("/api/profiles/zz-create-a?purge=true", headers=admin_headers)


def test_create_accepts_legacy_id(client, admin_headers):
    """M10-01: the frontend used to send 'id' — the contract accepts either."""
    r = client.post("/api/profiles", headers=admin_headers,
                    json={"id": "zz-create-b", "model": {"default": "m", "provider": "p"}})
    assert r.status_code == 200, r.text
    assert os.path.isfile(os.path.join(_pdir("zz-create-b"), "config.yaml"))
    client.delete("/api/profiles/zz-create-b?purge=true", headers=admin_headers)


def test_create_without_name_or_id_is_400(client, admin_headers):
    r = client.post("/api/profiles", headers=admin_headers, json={"model": {"default": "m"}})
    assert r.status_code == 400, r.text


# ── M10-03: delete is scoped; purge is explicit ────────────────────────────

def test_delete_keeps_durable_data(client, admin_headers):
    _mkprofile("zz-del-keep", soul="# persona\n")
    # durable data that must survive a normal delete
    with open(os.path.join(_pdir("zz-del-keep"), "state.db"), "wb") as f:
        f.write(b"\x00")
    os.makedirs(os.path.join(_pdir("zz-del-keep"), "memories"), exist_ok=True)
    with open(os.path.join(_pdir("zz-del-keep"), "memories", "m.md"), "w") as f:
        f.write("memory\n")

    r = client.delete("/api/profiles/zz-del-keep", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["purged"] is False
    d = _pdir("zz-del-keep")
    assert not os.path.isfile(os.path.join(d, "config.yaml"))
    assert not os.path.isfile(os.path.join(d, "SOUL.md"))
    assert os.path.isfile(os.path.join(d, "state.db")), "state.db must survive a normal delete"
    assert os.path.isfile(os.path.join(d, "memories", "m.md")), "memories must survive"
    # gone from the listing (listing requires config.yaml)
    listed = [p["id"] for p in client.get("/api/profiles", headers=admin_headers).json()]
    assert "zz-del-keep" not in listed

    import shutil
    shutil.rmtree(d, ignore_errors=True)


def test_delete_purge_removes_everything(client, admin_headers):
    _mkprofile("zz-del-purge", soul="# persona\n")
    with open(os.path.join(_pdir("zz-del-purge"), "state.db"), "wb") as f:
        f.write(b"\x00")

    r = client.delete("/api/profiles/zz-del-purge?purge=true", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["purged"] is True
    assert not os.path.exists(_pdir("zz-del-purge"))


# ── M10-06: duplicate copies SOUL.md and capability dirs ───────────────────

def test_duplicate_copies_soul_and_skills(client, admin_headers):
    _mkprofile("zz-dup-src", soul="# my persona\n", skills=True)
    r = client.post("/api/profiles/zz-dup-src/duplicate", headers=admin_headers,
                    json={"name": "zz-dup-out"})
    assert r.status_code == 200, r.text
    out = _pdir("zz-dup-out")
    with open(os.path.join(out, "SOUL.md"), encoding="utf-8") as f:
        assert f.read() == "# my persona\n", "SOUL.md must be duplicated (M10-06)"
    assert os.path.isfile(os.path.join(out, "skills", "hello.md"))
    # runtime data must NOT be copied
    _mkprofile("zz-dup-src2", soul="# x\n")
    with open(os.path.join(_pdir("zz-dup-src2"), "state.db"), "wb") as f:
        f.write(b"\x00")
    client.post("/api/profiles/zz-dup-src2/duplicate", headers=admin_headers,
                json={"name": "zz-dup-out2"})
    assert not os.path.isfile(os.path.join(_pdir("zz-dup-out2"), "state.db"))

    import shutil
    for pid in ("zz-dup-src", "zz-dup-out", "zz-dup-src2", "zz-dup-out2"):
        shutil.rmtree(_pdir(pid), ignore_errors=True)


# ── M10-08: broken config stays listed, 400s cleanly, repair works ────────

def test_broken_config_stays_listed_with_error(client, admin_headers):
    _mkprofile("zz-broken")
    with open(os.path.join(_pdir("zz-broken"), "config.yaml"), "w") as f:
        f.write("model: [unclosed\n  bad: :\n")

    listed = client.get("/api/profiles", headers=admin_headers).json()
    entry = next((p for p in listed if p["id"] == "zz-broken"), None)
    assert entry is not None, "broken profile must NOT vanish from the list (M10-08)"
    assert entry.get("error"), "degraded entry must carry an error message"

    r = client.get("/api/profiles/zz-broken", headers=admin_headers)
    assert r.status_code == 400, f"parse error must be 400, got {r.status_code}"
    assert "invalid" in r.json()["detail"].lower()


def test_update_without_replace_fails_on_broken_config(client, admin_headers):
    _mkprofile("zz-broken2")
    with open(os.path.join(_pdir("zz-broken2"), "config.yaml"), "w") as f:
        f.write("model: [unclosed\n")
    r = client.put("/api/profiles/zz-broken2", headers=admin_headers,
                   json={"model": {"default": "m"}})
    assert r.status_code == 400, r.text


def test_update_replace_repairs_broken_config(client, admin_headers):
    _mkprofile("zz-broken3")
    with open(os.path.join(_pdir("zz-broken3"), "config.yaml"), "w") as f:
        f.write("model: [unclosed\n")
    r = client.put("/api/profiles/zz-broken3", headers=admin_headers,
                   json={"model": {"default": "repaired", "provider": "p"}, "replace": True})
    assert r.status_code == 200, r.text
    # now the profile reads cleanly again
    r2 = client.get("/api/profiles/zz-broken3", headers=admin_headers)
    assert r2.status_code == 200
    assert r2.json()["model"]["default"] == "repaired"

    import shutil
    shutil.rmtree(_pdir("zz-broken3"), ignore_errors=True)


# ── M10-08 wrong-shape class (fixes2-verdict N1/P2-N2/P3-N3) ─────────────

def _write_raw(pid: str, content: str) -> None:
    os.makedirs(_pdir(pid), exist_ok=True)
    with open(os.path.join(_pdir(pid), "config.yaml"), "w", encoding="utf-8") as f:
        f.write(content)


def test_wrong_shape_scalar_model_is_400_and_repairable(client, admin_headers):
    """Parseable but wrong-shape (scalar model:) must join the unparseable class:
    400 on GET, listed with error, and PUT replace:true repairs it."""
    _write_raw("zz-shape-a", "model: just-a-string\n")

    r = client.get("/api/profiles/zz-shape-a", headers=admin_headers)
    assert r.status_code == 400, f"expected 400, got {r.status_code}"

    listed = client.get("/api/profiles", headers=admin_headers).json()
    entry = next((p for p in listed if p["id"] == "zz-shape-a"), None)
    assert entry is not None and entry.get("error"), "must stay listed with error"

    r2 = client.put("/api/profiles/zz-shape-a", headers=admin_headers,
                    json={"model": {"default": "repaired", "provider": "p"}, "replace": True})
    assert r2.status_code == 200, f"replace must repair, got {r2.status_code}"
    r3 = client.get("/api/profiles/zz-shape-a", headers=admin_headers)
    assert r3.status_code == 200
    assert r3.json()["model"]["default"] == "repaired"

    import shutil
    shutil.rmtree(_pdir("zz-shape-a"), ignore_errors=True)


def test_wrong_shape_list_root_is_400(client, admin_headers):
    _write_raw("zz-shape-b", "- a\n- b\n")
    r = client.get("/api/profiles/zz-shape-b", headers=admin_headers)
    assert r.status_code == 400, f"expected 400, got {r.status_code}"

    import shutil
    shutil.rmtree(_pdir("zz-shape-b"), ignore_errors=True)


def test_duplicate_of_broken_config_is_400_not_500(client, admin_headers):
    """fixes2-verdict P2-N2: duplicate on an unparseable source was a 500."""
    _write_raw("zz-dup-broken", "model: [unclosed\n")
    r = client.post("/api/profiles/zz-dup-broken/duplicate", headers=admin_headers,
                    json={"name": "zz-dup-broken-copy"})
    assert r.status_code == 400, f"expected 400, got {r.status_code}"

    import shutil
    shutil.rmtree(_pdir("zz-dup-broken"), ignore_errors=True)
    shutil.rmtree(_pdir("zz-dup-broken-copy"), ignore_errors=True)


def test_duplicate_does_not_follow_symlinks(client, admin_headers):
    """fixes2-verdict P3-N3: duplicate must copy symlinks as symlinks
    (consistent with delete, which does not follow them)."""
    _mkprofile("zz-sym-src", soul="# s\n", skills=True)
    outside = os.path.join(PROFILES, "zz-outside-sentinel.txt")
    with open(outside, "w") as f:
        f.write("secret-sentinel\n")
    link = os.path.join(_pdir("zz-sym-src"), "skills", "link.md")
    os.symlink(outside, link)

    r = client.post("/api/profiles/zz-sym-src/duplicate", headers=admin_headers,
                    json={"name": "zz-sym-out"})
    assert r.status_code == 200, r.text
    copied = os.path.join(_pdir("zz-sym-out"), "skills", "link.md")
    assert os.path.islink(copied), "symlink must be copied as a symlink, not followed"

    import shutil
    for pid in ("zz-sym-src", "zz-sym-out"):
        shutil.rmtree(_pdir(pid), ignore_errors=True)
    os.unlink(outside)


# ── Cross-app ownership (bug report 06/10/26: root-owned profiles break the
# hermes-uid dashboard writer) ──────────────────────────────────────────

def test_created_profile_inherits_profiles_owner(client, admin_headers):
    """Files created via the API must belong to PROFILES_DIR's owner, not to
    the API process's uid (which may be root in the container)."""
    r = client.post("/api/profiles", headers=admin_headers,
                    json={"name": "zz-own-a", "model": {"default": "m", "provider": "p"}})
    assert r.status_code == 200, r.text
    owner = os.stat(PROFILES).st_uid, os.stat(PROFILES).st_gid
    d = _pdir("zz-own-a")
    assert (os.stat(d).st_uid, os.stat(d).st_gid) == owner, "profile dir must inherit owner"
    assert (os.stat(os.path.join(d, "config.yaml")).st_uid,
            os.stat(os.path.join(d, "config.yaml")).st_gid) == owner, "config.yaml must inherit owner"

    import shutil
    shutil.rmtree(d, ignore_errors=True)


def test_rewrite_keeps_owner_and_private_modes(client, admin_headers):
    """Atomic rename must not change ownership on rewrite (gateway-owned files
    stay gateway-owned) and new files are private (M10-15)."""
    r = client.post("/api/profiles", headers=admin_headers,
                    json={"name": "zz-own-b", "model": {"default": "m", "provider": "p"}})
    assert r.status_code == 200, r.text
    d = _pdir("zz-own-b")
    owner = os.stat(PROFILES).st_uid, os.stat(PROFILES).st_gid

    r2 = client.put("/api/profiles/zz-own-b", headers=admin_headers,
                    json={"description": "rewrite me"})
    assert r2.status_code == 200, r2.text

    st_cfg = os.stat(os.path.join(d, "config.yaml"))
    assert (st_cfg.st_uid, st_cfg.st_gid) == owner, "rewrite must not change owner"
    assert st_cfg.st_mode & 0o077 == 0, f"config.yaml must be private, got {oct(st_cfg.st_mode & 0o777)}"
    assert os.stat(d).st_mode & 0o077 == 0, "profile dir must be private"

    r3 = client.put("/api/profiles/zz-own-b/soul", headers=admin_headers, json={"content": "# soul\n"})
    assert r3.status_code == 200, r3.text
    st_soul = os.stat(os.path.join(d, "SOUL.md"))
    assert (st_soul.st_uid, st_soul.st_gid) == owner

    import shutil
    shutil.rmtree(d, ignore_errors=True)


def test_duplicate_tree_inherits_owner(client, admin_headers):
    _mkprofile("zz-own-src", soul="# s\n", skills=True)
    owner = os.stat(PROFILES).st_uid, os.stat(PROFILES).st_gid
    r = client.post("/api/profiles/zz-own-src/duplicate", headers=admin_headers,
                    json={"name": "zz-own-out"})
    assert r.status_code == 200, r.text
    for rel in ("", "config.yaml", "SOUL.md", "skills", "skills/hello.md"):
        path = os.path.join(_pdir("zz-own-out"), rel)
        st = os.stat(path, follow_symlinks=False)
        assert (st.st_uid, st.st_gid) == owner, f"{rel or '.'} must inherit owner"

    import shutil
    for pid in ("zz-own-src", "zz-own-out"):
        shutil.rmtree(_pdir(pid), ignore_errors=True)


# ── M10-02 regression guard: viewer cannot mutate profiles ─────────────────

@pytest.mark.parametrize("method,path,payload", [
    ("POST", "/api/profiles", {"name": "zz-v"}),
    ("PUT", "/api/profiles/zz-x", {"model": {}}),
    ("DELETE", "/api/profiles/zz-x", None),
])
def test_viewer_cannot_mutate_profiles(client, viewer_headers, method, path, payload):
    r = client.request(method, path, headers=viewer_headers, json=payload)
    assert r.status_code == 403, f"{method} {path} must be admin-only, got {r.status_code}"


# ── M2 (adversarial fixes4): _fix_owner called by EVERY writer ─────────────

def test_fix_owner_called_on_every_writer(client, admin_headers, monkeypatch):
    """Ownership inheritance can't be proven under non-root (chown-to-self is
    a no-op), so guard the CALL SITES instead: every create/rewrite path must
    route through _fix_owner. Deleting the mechanism fails this test."""
    from backend import profiles as profiles_mod

    calls: list[str] = []
    monkeypatch.setattr(profiles_mod, "_fix_owner", lambda p: calls.append(str(p)))

    r = client.post("/api/profiles", headers=admin_headers,
                    json={"name": "zz-own-spy", "model": {"default": "m", "provider": "p"}})
    assert r.status_code == 200, r.text
    create_calls = len(calls)
    assert create_calls >= 2, f"create should fix dir + config: {calls}"

    r = client.put("/api/profiles/zz-own-spy", headers=admin_headers,
                   json={"agent": {"max_turns": 5}})
    assert r.status_code == 200, r.text
    assert len(calls) > create_calls, "update must call _fix_owner"

    prev = len(calls)
    r = client.put("/api/profiles/zz-own-spy/soul", headers=admin_headers,
                   json={"content": "# spy"})
    assert r.status_code == 200, r.text
    assert len(calls) > prev, "soul write must call _fix_owner"

    prev = len(calls)
    r = client.post("/api/profiles/zz-own-spy/duplicate", headers=admin_headers,
                    json={"name": "zz-own-spy-2"})  # contract key is 'name', not 'new_id'
    assert r.status_code == 200, r.text
    assert len(calls) > prev + 1, f"duplicate must fix dir + copied tree: {calls[prev:]}"
    # M-3: os.walk never yields the root dir — deleting only the explicit
    # _fix_owner(new_dir) call must FAIL this test (mutation-verified hole).
    dup_dir = os.path.normpath(_pdir("zz-own-spy-2"))
    assert any(os.path.normpath(c) == dup_dir for c in calls[prev:]), \
        f"duplicate must fix the new dir itself: {calls[prev:]}"
    # N-2: the walk loop covers the copied FILES — SOUL.md is copied via copy2
    # and is ONLY fixed by the walk, so its absence kills walk-body deletion.
    assert any(c.endswith("SOUL.md") for c in calls[prev:]), \
        f"duplicate walk must fix copied files: {calls[prev:]}"
    # floor: atomic-write config + dir fix + walk (config + SOUL.md) = 4
    assert len(calls[prev:]) >= 4, f"expected 4+ fixes in duplicate: {calls[prev:]}"

    client.delete("/api/profiles/zz-own-spy-2?purge=true", headers=admin_headers)
    client.delete("/api/profiles/zz-own-spy?purge=true", headers=admin_headers)


def test_fix_owner_issues_symlink_safe_chown(monkeypatch):
    """M-empty-body mutant: call-site spies cannot see inside _fix_owner —
    assert the chown syscall itself happens with follow_symlinks=False."""
    from backend import profiles as profiles_mod

    spy: list[tuple] = []
    monkeypatch.setattr(os, "chown", lambda *a, **k: spy.append((a, k)))
    probe = os.path.join(PROFILES, "zz-chown-probe.txt")
    with open(probe, "w", encoding="utf-8") as f:
        f.write("x")
    try:
        profiles_mod._fix_owner(probe)
    finally:
        os.unlink(probe)
    assert spy, "_fix_owner must call os.chown"
    _args, kwargs = spy[0]
    assert kwargs.get("follow_symlinks") is False
