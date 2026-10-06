"""Cron availability contract (WI-1 dependency on the Hermes store).

AgentOS cron is a UI over the Hermes cron store: without it, every endpoint
answers 503 (Service Unavailable) — not a crash and not a silent empty list.
This module only runs where the store is ABSENT (e.g. CI runners), pinning
that contract; where the store exists, test_cron_store.py covers behavior.
"""

import pytest

import backend.cron as c

pytestmark = pytest.mark.skipif(
    c.HAVE_STORE,
    reason="store present — this contract is for store-less environments",
)


def test_cron_endpoints_answer_503_without_store(client, admin_headers):
    r = client.get("/api/cron", headers=admin_headers)
    assert r.status_code == 503
    r = client.post(
        "/api/cron",
        headers=admin_headers,
        json={"name": "x", "prompt": "p", "schedule": "0 8 * * *"},
    )
    assert r.status_code == 503
