"""Media/artifact transport suite (WI-3b): no tokens in URLs (F-M4-02/08/10).

Covers:
- the ?token= query-param auth fallback is gone (credentials never travel in
  URLs);
- artifact responses carry X-Content-Type-Options: nosniff and a CSP sandbox;
- html/xhtml are never served as markup (text/plain), so uploaded artifacts
  cannot execute at app origin;
- dispositions: preview=inline, download=attachment;
- downloads work through the Authorization header (the frontend turns the
  response into a blob — fetch+blob; covered by tsc, not here).
"""


def test_token_query_param_rejected(client, admin_headers, make_task):
    task = make_task(files={"note.txt": "hello"})
    token = admin_headers["Authorization"].split(" ", 1)[1]
    r = client.get(f"/api/tasks/{task['id']}/artifacts/note.txt?token={token}")
    assert r.status_code == 401


def test_missing_auth_rejected(client, make_task):
    task = make_task(files={"note.txt": "hello"})
    r = client.get(f"/api/tasks/{task['id']}/artifacts/note.txt")
    assert r.status_code == 401


def test_download_via_header(client, admin_headers, make_task):
    task = make_task(files={"note.txt": "hello"})
    r = client.get(f"/api/tasks/{task['id']}/artifacts/note.txt", headers=admin_headers)
    assert r.status_code == 200
    assert r.text == "hello"


def test_security_headers_present(client, admin_headers, make_task):
    task = make_task(files={"note.txt": "hello"})
    r = client.get(f"/api/tasks/{task['id']}/artifacts/note.txt", headers=admin_headers)
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert "sandbox" in (r.headers.get("content-security-policy") or "")


def test_html_served_as_plain_text(client, admin_headers, make_task):
    """F-M4-10: uploaded HTML can never execute at app origin."""
    task = make_task(files={"page.html": "<html><script>alert(1)</script></html>"})
    r = client.get(f"/api/tasks/{task['id']}/artifacts/page.html?preview=true", headers=admin_headers)
    assert r.status_code == 200
    assert "text/plain" in r.headers.get("content-type", "")


def test_svg_keeps_image_type(client, admin_headers, make_task):
    """SVG keeps image/svg+xml so <img> blob rendering works — safe there,
    because scripts never execute in img context."""
    task = make_task(files={"img.svg": "<svg xmlns='http://www.w3.org/2000/svg'></svg>"})
    r = client.get(f"/api/tasks/{task['id']}/artifacts/img.svg?preview=true", headers=admin_headers)
    assert r.status_code == 200
    assert "image/svg+xml" in r.headers.get("content-type", "")


def test_preview_inline_download_attachment(client, admin_headers, make_task):
    task = make_task(files={"note.txt": "hello"})
    r = client.get(f"/api/tasks/{task['id']}/artifacts/note.txt?preview=true", headers=admin_headers)
    assert "inline" in (r.headers.get("content-disposition") or "")
    r = client.get(f"/api/tasks/{task['id']}/artifacts/note.txt", headers=admin_headers)
    assert "attachment" in (r.headers.get("content-disposition") or "")


def test_artifact_cannot_escape_workspace(client, admin_headers, make_task):
    """Artifact reads go through _contained_path — dot-dot traversal is dead."""
    task = make_task(files={"note.txt": "hello"})
    r = client.get(f"/api/tasks/{task['id']}/artifacts/..%2F..%2F..%2Fetc%2Fpasswd", headers=admin_headers)
    assert r.status_code in (400, 403, 404)
