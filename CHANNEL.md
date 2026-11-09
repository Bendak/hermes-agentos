# Chat transport

AgentOS can deliver chat turns to Hermes in two ways. **Plugin mode is the recommended
path** and is the mode used by the current family/homelab deployment. **Legacy HTTP mode
remains supported** while the old path is still in the tree.

Both modes keep the AgentOS UI, authentication, local chat index, attachments, and
approval cards. They differ in how a turn reaches the Hermes gateway.

## Modes

| Mode | Flag | Transport | Best for |
|---|---|---|---|
| Plugin (recommended) | `AGENTOS_CHANNEL=plugin` | WebSocket to the `agentos-channel` Hermes plugin (`ws://127.0.0.1:9130/ws`) | Per-user identity, streaming drafts, thinking/tool timeline, native approvals, reconnect/resume |
| Legacy HTTP | `AGENTOS_CHANNEL=http` | Hermes HTTP API (`HERMES_API_URL`, default `http://localhost:8642`) | Older deployments, compatibility, cutover comparison |

The flag is read at runtime. Changing it requires restarting **only** the AgentOS service:

```bash
docker exec -u root hermes /command/s6-svc -r /run/service/agentos
```

Do not use `pkill` on the backend; s6 owns the process.

## Plugin mode

```bash
AGENTOS_CHANNEL=plugin
AGENTOS_CHANNEL_URL=ws://127.0.0.1:9130/ws
AGENTOS_CHANNEL_TOKEN=<shared-secret>          # required
AGENTOS_CHANNEL_MEDIA_ROOT=/opt/data/agentos/uploads
```

The gateway side must load the `agentos-channel` platform plugin and allow the same
users. Access is controlled by the platform allowlist / Hermes pairing, not by the
AgentOS JWT alone. On a new user's first message, approve the platform identity:

```bash
hermes pairing list
hermes pairing approve agentos <id>
```

Inbound attachments are accepted only as regular files under
`AGENTOS_CHANNEL_MEDIA_ROOT` (symlinks are resolved first) and are size-capped by
`AGENTOS_CHANNEL_MAX_MEDIA_MB` (default 25 MB). AgentOS writes browser uploads with
`0644` so the gateway user can read them.

## Legacy HTTP mode

```bash
AGENTOS_CHANNEL=http
HERMES_API_URL=http://localhost:8642
```

This path keeps the older Hermes API/session behavior. It is intentionally documented
and left available for compatibility; it is not the recommended mode for new
deployments.

## Environment resolution

The AgentOS **s6 service does not receive `AGENTOS_*` variables in its process
environment**. Channel settings are resolved by `backend.channel_client` from, in order:

1. the process environment (if set manually), then
2. `<AGENTOS_DATA_DIR>/.env` — in the container, `/opt/data/.env`.

Use `channel_mode()` / `channel_env()` when adding channel-aware code. Reading
`os.environ["AGENTOS_CHANNEL"]` directly reports the wrong mode and produces a false
"legacy HTTP" status. `chat._channel_media_root()` and `health._uploads_root()` use the
same resolver so uploads and health cannot disagree.

## Health checks

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | public | Liveness of the AgentOS process only |
| `GET /api/health/status` | Bearer JWT | Dependency snapshot: AgentOS, Hermes API, channel/plugin, local auth DB, uploads |

`/api/health/status` returns `{status, checked_at, services[]}`. Each service has
`status: ok | down | unknown`; `unknown` means the mode does not use that dependency
(for example, the plugin channel in legacy HTTP mode), not a failure. The dashboard
shows a compact summary and `/system-health` shows the full page.

## Troubleshooting

- **Channel shows "modo HTTP legado" while the plugin is active** — the health check is
  reading the wrong environment source. Use `channel_mode()`; the s6 service resolves
  the flag from `/opt/data/.env`.
- **First message from a new user gets no reply** — check `hermes pairing list` and
  approve the `agentos:<id>` identity.
- **Attachment uploaded but not readable by the agent** — the file must be under the
  configured media root, owned readably (`0644`), and within the size cap.
- **Plugin reconnect/timeout** — verify `AGENTOS_CHANNEL_URL`, the shared token, and
  that port 9130 is bound on loopback only. Do not expose it publicly.
