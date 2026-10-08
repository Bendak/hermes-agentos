"""Artifacts em subfolders (relato do usuário, 07/10/26): listagem recursiva
com relpath como handle canônico + download por subcaminho (rota :path).

A cobertura de segurança (containment/traversal) continua em
test_workspace_containment.py; aqui validamos que o :path novo não abriu
furo e que a listagem acha arquivos em n+2 níveis.
"""

import urllib.parse

from pathlib import Path


def _nested_ws(task, *parts, content="x"):
    ws = Path(task["workspace_path"])
    p = ws
    for part in parts:
        p = p / part
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return p


def test_listing_is_recursive_with_relpaths(client, admin_headers, make_task):
    task = make_task({"root.md": "raiz"})
    _nested_ws(task, "sub", "mid.txt", content="2")
    _nested_ws(task, "sub", "deep", "low.txt", content="3")  # nível n+2

    r = client.get(f"/api/tasks/{task['id']}/artifacts", headers=admin_headers)
    assert r.status_code == 200
    files = r.json()["files"]
    rels = {f["relpath"] for f in files}
    assert rels == {"root.md", "sub/mid.txt", "sub/deep/low.txt"}
    # campos de compatibilidade preservados (name/size/modified/type)
    for f in files:
        assert f["name"] in ("root.md", "mid.txt", "low.txt")
        assert isinstance(f["size"], int)
        assert "modified" in f and "type" in f


def test_listing_prunes_hidden_dirs_and_pycache(client, admin_headers, make_task):
    task = make_task({})
    _nested_ws(task, ".git", "config", content="nope")
    _nested_ws(task, "__pycache__", "mod.cpython-313.pyc", content="junk")
    _nested_ws(task, "sub", "ok.txt", content="yes")
    _nested_ws(task, "sub", "stray.pyc", content="junk")

    r = client.get(f"/api/tasks/{task['id']}/artifacts", headers=admin_headers)
    rels = {f["relpath"] for f in r.json()["files"]}
    assert rels == {"sub/ok.txt"}  # .git/*, __pycache__/* e *.pyc nunca aparecem


def test_download_subpath_n2(client, admin_headers, make_task):
    task = make_task({})
    _nested_ws(task, "sub", "deep", "low.txt", content="deep ok")

    r = client.get(
        f"/api/tasks/{task['id']}/artifacts/sub/deep/low.txt", headers=admin_headers
    )
    assert r.status_code == 200
    assert r.content == b"deep ok"


def test_download_subpath_preview_mode(client, admin_headers, make_task):
    task = make_task({})
    _nested_ws(task, "sub", "note.md", content="# hi")
    r = client.get(
        f"/api/tasks/{task['id']}/artifacts/sub/note.md?preview=true",
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("inline")


def test_download_traversal_blocked_despite_path_route(client, admin_headers, make_task):
    """O :path novo não pode abrir furo: segmentos '..' caem no
    _contained_path (realpath+commonpath) -> 403/404, nunca conteúdo."""
    task = make_task({})
    _nested_ws(task, "sub", "ok.txt", content="ok")
    evil = urllib.parse.quote("..", safe="")  # %2e%2e não é normalizado pelo client
    r = client.get(
        f"/api/tasks/{task['id']}/artifacts/{evil}/{evil}/outside.txt",
        headers=admin_headers,
    )
    assert r.status_code in (403, 404)
    assert b"evil" not in r.content


def test_listing_skips_symlinks_dotfiles_and_venv(client, admin_headers, make_task):
    """M29-02/03/05: symlink (metadado não vaza), dot-file, venv/node_modules."""
    task = make_task({})
    ws = Path(task["workspace_path"])
    _nested_ws(task, "sub", "real.txt", content="ok")
    _nested_ws(task, ".hidden.txt", content="nope")
    _nested_ws(task, "venv", "lib", "x.py", content="nope")
    _nested_ws(task, "node_modules", "pkg", "index.js", content="nope")
    target = ws / "sub" / "real.txt"
    link = ws / "sub" / "leak.txt"
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(target)

    r = client.get(f"/api/tasks/{task['id']}/artifacts", headers=admin_headers)
    rels = {f["relpath"] for f in r.json()["files"]}
    assert rels == {"sub/real.txt"}
