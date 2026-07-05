# AgentOS — Plano de Desenvolvimento Executável

**Versão:** 2.0.0 (revisada por Hermes + Coder)
**Data:** 2026-07-05
**Status:** Aprovado para implementação incremental
**Repo:** GitHub público (sem secrets no código)

---

## 1. Arquitetura Final

```
┌─────────────────────────────────────────────────────┐
│  Container Hermes (s6, UID 10000, /opt/data)         │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Gateway   │  │ Dashboard │  │ AgentOS (s6)     │ │
│  │ :8642     │  │ :9119     │  │ :9120            │ │
│  │ API+SSE   │  │ Hermes UI │  │ FastAPI + SPA    │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│                                      ↑              │
│  ┌──────────────────────────────────┘              │
│  │ SQLite (read-only)    SQLite (read-write)        │
│  │ /opt/data/kanban.db   /opt/data/agentos.db       │
│  │ /opt/data/state.db    /opt/data/config.yaml(ro)  │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌──────────┐                                        │
│  │ ha-mcp   │  :8086 (separado)                     │
│  └──────────┘                                        │
└─────────────────────────────────────────────────────┘
```

### Decisões-chave (revisadas vs spec original)

| Aspecto | Spec original (Nexus) | Revisado (Hermes+Coder) | Razão |
|---------|----------------------|------------------------|-------|
| **Deploy** | Container Docker separado | **s6 service no container Hermes** | Evita UID mismatch (lição do Hermes Workspace) |
| **Porta** | :3000 | **:9120** | Próxima porta livre após dashboard :9119 |
| **Frontend** | Next.js (SSR) | **Vite SPA** | Sem SSR pra admin dashboard. 80MB vs 500MB RAM |
| **Backend** | FastAPI + Redis | **FastAPI standalone** | Redis é overkill pra 1 usuário |
| **DB** | PostgreSQL + SQLite | **SQLite only** | AgentOS.db próprio + read-only no kanban/state |
| **Auth** | JWT + RBAC desde o dia 1 | **Auth via reverse proxy** (defer JWT pra fase 13) | Single-user homelab não precisa de JWT no MVP |
| **Testes** | "Testes automatizados" | **Playwright E2E + vision (Pixel)** | Valida UI visualmente, não só DOM |
| **Entrega** | 5 fases em 16 semanas | **13 incrementos de 1 semana** | Feature por semana, testável, cron-automatizável |

---

## 2. Tech Stack Final

```
Backend:   FastAPI + Uvicorn + aiosqlite + cachetools
Frontend:  Vite + React + shadcn/ui + Tailwind + React Query + Zustand
Real-time: FastAPI native WebSocket
Kanban DnD: @dnd-kit/core
Charts:    Recharts
DB:        SQLite (/opt/data/agentos.db) + read-only Hermes DBs
Tests:     Playwright + pytest + Pixel vision
Deploy:    s6 service (uvicorn :9120)
```

**Footprint estimado:** ~80MB RAM, 1 processo Python.

---

## 3. Segurança (GitHub Público)

### Regras obrigatórias

1. **Nenhum secret no código** — todas as configs via env vars
2. `.gitignore` bulletproof:
   ```
   .env
   *.db
   *.db-shm
   *.db-wal
   __pycache__/
   node_modules/
   dist/
   .pytest_cache/
   /tmp/playwright-screenshots/
   ```
3. `example.env` com valores dummy pra documentar variáveis necessárias
4. CI GitHub Action que rejeita commits com arquivos `.*env*` ou `*.key`
5. SQLite Hermes DBs abertos **read-only** (`mode=ro` na URI)
6. Escritas no config.yaml via **Pydantic validation** + atomic write (temp+rename)
7. Path traversal guard em todos os endpoints de arquivo
8. `SECURITY.md` no repo com política de disclosure

### Variáveis de ambiente necessárias

```bash
# example.env — copiar para .env e preencher
AGENTOS_DATA_DIR=/opt/data                    # Hermes data volume
AGENTOS_DB_PATH=/opt/data/agentos.db          # AgentOS own DB
HERMES_API_URL=http://localhost:8642           # Gateway API
HERMES_API_KEY=                               # API_SERVER_KEY do Hermes
AGENTOS_PORT=9120                             # AgentOS port
AGENTOS_HOST=0.0.0.0                          # Bind address
```

---

## 4. SDLC — Fluxo de Desenvolvimento por Feature

### Roles dos profiles

| Profile | Role no SDLC | Quando |
|---------|-------------|--------|
| **Hermes (default)** | Orquestra o fluxo, cria task no Kanban | Início de cada increment |
| **Coder** | Implementa a feature (backend + frontend) | Durante a sprint |
| **Pixel** | Valida UI/UX com Playwright + screenshot vision | Após implementação |
| **Nexus** | Integra, roda testes de regressão, commit | Após validação |
| **Atlas** | Documenta a feature no README | Após integração |

### Fluxo por feature

```
1. Hermes cria task no Kanban (assignee=coder, workspace=dir:/opt/data/agentos)
2. Coder implementa:
   a. Backend (FastAPI endpoint)
   b. Frontend (React component)
   c. E2E test (Playwright)
3. Pixel valida:
   a. Roda playwright + tira screenshot
   b. vision_analyze no screenshot
   c. Reporta: PASS/FAIL + observações de UI
4. Nexus integra:
   a. Roda todos os testes E2E (regressão)
   b. Se PASS: git commit + push
   c. Se FAIL: reporta o que quebrou, volta pro Coder
5. Atlas documenta:
   a. Atualiza README com a nova feature
   b. Atualiza PLAN.md marcando o increment como done
```

### Estrutura de testes

```
tests/e2e/
├── conftest.py                    # Fixtures: start/stop AgentOS, clean DB
├── fixtures/
│   └── agentos_client.py          # Helper pra seed data via API
├── features/
│   ├── test_00_health.py          # Phase 0
│   ├── test_01_dashboard.py       # Phase 1
│   ├── test_02_sessions.py        # Phase 2
│   ├── test_03_chat_streaming.py  # Phase 3
│   ├── test_04_kanban_readonly.py # Phase 4
│   ├── test_05_kanban_dnd.py      # Phase 5
│   ├── test_06_task_detail.py     # Phase 6
│   ├── test_07_config_viewer.py   # Phase 7
│   ├── test_08_config_editor.py   # Phase 8
│   ├── test_09_skills_hub.py      # Phase 9
│   ├── test_10_workflow_view.py   # Phase 10
│   ├── test_11_workflow_run.py    # Phase 11
│   └── test_12_dark_mode.py       # Phase 12
└── screenshots/
    └── baseline/                  # Screenshots aprovados pra visual diff
```

### Padrão de teste (exemplo)

```python
@pytest.mark.feature("dashboard")
def test_dashboard_shows_5_agents(page: Page, seeded_db):
    page.goto("http://localhost:9120/")
    page.wait_for_selector("[data-testid='agent-card']")
    assert page.locator("[data-testid='agent-card']").count() == 5
    
    # Vision validation
    screenshot = page.screenshot(path="/tmp/dashboard_test.png")
    analysis = vision_analyze(
        image_url="/tmp/dashboard_test.png",
        question="Does this dashboard show 5 agent cards with status indicators (online/offline)?"
    )
    assert "yes" in analysis.lower()
```

---

## 5. Roadmap Incremental (1 feature por semana)

### Phase 0 — Bootstrap (Semana 1)
- [ ] Scaffold FastAPI app com `GET /health`
- [ ] Scaffold Vite + React + shadcn/ui com landing page
- [ ] s6 service definition (`/opt/hermes/docker/s6-rc.d/agentos/`)
- [ ] `GET /health` retorna `{"status": "ok", "version": "0.1.0"}`
- [ ] Landing page mostra "AgentOS" + botão de login (sem funcionalidade)
- [ ] E2E: `test_00_health.py` — asserts page title + health JSON
- [ ] Repo GitHub criado, `.gitignore`, `SECURITY.md`, `example.env`
- **Entrega:** App rodando em `:9120` com página inicial

### Phase 1 — Agent Health Cards (Semana 2)
- [ ] Backend: `GET /api/agents` — lista 5 profiles do `/opt/data/profiles/`
- [ ] Backend: `GET /api/agents/:id/health` — proxy pra `GET /health/detailed` do gateway
- [ ] Frontend: Dashboard com 5 cards (nome, modelo, status, sessões ativas)
- [ ] E2E: `test_01_dashboard.py` — vision valida 5 cards + cores de status
- **Entrega:** Dashboard funcional mostrando o time

### Phase 2 — Session List (Semana 3)
- [ ] Backend: `GET /api/sessions` — query read-only no `state.db`
- [ ] Frontend: Tabela ordenável (platform, profile, messages, last_active)
- [ ] Frontend: Busca FTS5 na lista de sessions
- [ ] E2E: `test_02_sessions.py` — cria session via API, verifica na lista
- **Entrega:** Lista de sessões com busca

### Phase 3 — Session Detail + Streaming Chat (Semana 4-5)
- [ ] Backend: `GET /api/sessions/:id/messages` — proxy Hermes API
- [ ] Backend: `POST /api/sessions/:id/chat/stream` — SSE → WebSocket
- [ ] Frontend: Chat thread com message bubbles
- [ ] Frontend: Tool call expand/collapse cards
- [ ] E2E: `test_03_chat_streaming.py` — envia msg, aguarda resposta, valida
- **Entrega:** Chat visual com streaming e tool calls

### Phase 4 — Kanban Board Read-Only (Semana 6)
- [ ] Backend: `GET /api/tasks` — query read-only no `kanban.db`
- [ ] Frontend: 5 colunas (TODO, READY, RUNNING, DONE, BLOCKED)
- [ ] Frontend: Cards com título, assignee, prioridade
- [ ] E2E: `test_04_kanban_readonly.py` — vision valida layout das colunas
- **Entrega:** Kanban board visual (só leitura)

### Phase 5 — Kanban Drag & Drop (Semana 7)
- [ ] Backend: `PATCH /api/tasks/:id` — valida status transitions, escreve no `kanban.db`
- [ ] Frontend: @dnd-kit/core pra mover cards entre colunas
- [ ] E2E: `test_05_kanban_dnd.py` — arrasta card, valida DB update
- **Entrega:** Kanban funcional com drag-and-drop

### Phase 6 — Task Detail Panel (Semana 8)
- [ ] Backend: `GET /api/tasks/:id` — task + comments + runs + artifacts
- [ ] Frontend: Painel lateral com tabs (Comments, Runs, Artifacts, Children)
- [ ] E2E: `test_06_task_detail.py` — click em task, valida painel
- **Entrega:** Detalhe de task com histórico completo

### Phase 7 — Config Viewer (Semana 9)
- [ ] Backend: `GET /api/config` — parse seguro do `config.yaml` (safe_load)
- [ ] Frontend: Tree view com syntax highlight (read-only)
- [ ] E2E: `test_07_config_viewer.py` — valida tree view
- **Entrega:** Visualizador de config

### Phase 8 — Config Editor (Semana 10)
- [ ] Backend: `PATCH /api/config` — Pydantic validation + atomic write
- [ ] Frontend: Form editor pra top-level keys (model, provider, toolsets)
- [ ] E2E: `test_08_config_editor.py` — edita campo seguro, valida, rollback
- **Entrega:** Editor de config com validação

### Phase 9 — Skills Hub Browser (Semana 11)
- [ ] Backend: `GET /api/skills` — parse `SKILL.md` frontmatter
- [ ] Frontend: Grid de skills com ícones, descrições, filtros
- [ ] E2E: `test_09_skills_hub.py` — valida grid
- **Entrega:** Browser de skills

### Phase 10 — Workflow Editor Visual (Semana 12)
- [ ] Backend: `GET /api/workflows` — do `agentos.db`
- [ ] Frontend: React Flow com nodes (trigger, action, condition)
- [ ] E2E: `test_10_workflow_view.py` — valida canvas
- **Entrega:** Editor visual de workflows (estático)

### Phase 11 — Workflow Execution (Semana 13)
- [ ] Backend: `POST /api/workflows/:id/run` — gera cron + kanban tasks
- [ ] Frontend: Botão "Run Now" + status indicator
- [ ] E2E: `test_11_workflow_run.py` — executa workflow, valida tasks criadas
- **Entrega:** Workflows executáveis

### Phase 12 — Polish (Semana 14)
- [ ] Dark mode (já com shadcn/ui, só ajustar tokens)
- [ ] Keyboard shortcuts (Cmd+K search, etc)
- [ ] Responsive (mobile breakpoints)
- [ ] E2E: `test_12_dark_mode.py` — vision valida dark theme
- **Entrega:** App polido e responsive

### Phase 13 — Auth (Opcional, Semana 15)
- [ ] JWT auth (apenas se precisar multi-user)
- [ ] RBAC (admin/operator/viewer)
- [ ] Só adicionar se o homelab efetivamente precisar

---

## 6. Cron de Implementação Automática

### Estrutura do cron

Cada increment é uma task Kanban. O fluxo automático:

```yaml
# Cron job: AgentOS Sprint
schedule: "0 9 * * 1"  # Toda segunda-feira às 9:00
prompt: |
  Verificar PLAN.md em /opt/data/agentos/PLAN.md
  Identificar o próximo increment não completado
  Criar task Kanban com:
    - assignee: coder
    - workspace: dir:/opt/data/agentos
    - skills: [planning-and-delegation, software-quality-practices]
  Após Coder completar, despachar Pixel para validar E2E
  Após Pixel validar, despachar Nexus para integrar e commit
  Após Nexus commit, despachar Atlas para documentar
  Marcar increment como done no PLAN.md
```

### Gates de qualidade (automáticos)

| Gate | Quem | O que verifica |
|------|------|----------------|
| Implementação | Coder | Feature funciona + E2E test escrito |
| Validação Visual | Pixel | Screenshot + vision_analyze = PASS |
| Regressão | Nexus | Todos os testes E2E anteriores ainda passam |
| Documentação | Atlas | README + PLAN.md atualizados |

### Condição de parada

Se um increment falhar 2 vezes (consecutive_failures=2), o Kanban auto-bloqueia e escala pra Hermes (default profile), que notifica Mauricio via WhatsApp com o erro e próximo step.

---

## 7. Estrutura do Repositório

```
agentos/
├── README.md                     # Visão geral + instalação
├── SECURITY.md                   # Política de disclosure
├── LICENSE                       # MIT
├── example.env                   # Env vars com valores dummy
├── .gitignore                    # Bulletproof
├── .github/
│   └── workflows/
│       ├── ci.yml                # Lint + test on PR
│       └── secrets-check.yml     # Reject .env/*.key commits
├── backend/
│   ├── main.py                   # FastAPI app
│   ├── config.py                 # Settings from env
│   ├── auth.py                   # Auth (deferred)
│   ├── routers/
│   │   ├── agents.py
│   │   ├── sessions.py
│   │   ├── tasks.py
│   │   ├── config.py
│   │   ├── skills.py
│   │   └── workflows.py
│   ├── integrations/
│   │   ├── hermes_api.py         # REST API client
│   │   ├── kanban_db.py          # Read-only SQLite
│   │   ├── session_db.py         # Read-only SQLite
│   │   └── config_store.py       # YAML read (safe_load)
│   └── ws/
│       └── manager.py           # WebSocket
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Sessions.tsx
│   │   │   ├── Tasks.tsx
│   │   │   ├── Config.tsx
│   │   │   └── Skills.tsx
│   │   ├── components/
│   │   └── lib/
│   ├── package.json
│   └── vite.config.ts
├── tests/
│   └── e2e/
│       ├── conftest.py
│       └── features/
├── docker/
│   ├── s6-agentos.run            # s6 service definition
│   └── Dockerfile               # Multi-stage (Node build → Python serve)
└── docs/
    ├── PLAN.md                   # Este documento (progress tracker)
    ├── ARCHITECTURE.md
    └── CHANGELOG.md
```

---

## 8. Estado Atual

| Phase | Status | Feature | Test |
|-------|--------|---------|------|
| 0 | 🔲 Pendente | Bootstrap + landing page | - |
| 1 | 🔲 Pendente | Agent health cards | - |
| 2 | 🔲 Pendente | Session list | - |
| 3 | 🔲 Pendente | Chat streaming | - |
| 4 | 🔲 Pendente | Kanban read-only | - |
| 5 | 🔲 Pendente | Kanban DnD | - |
| 6 | 🔲 Pendente | Task detail | - |
| 7 | 🔲 Pendente | Config viewer | - |
| 8 | 🔲 Pendente | Config editor | - |
| 9 | 🔲 Pendente | Skills hub | - |
| 10 | 🔲 Pendente | Workflow editor | - |
| 11 | 🔲 Pendente | Workflow execution | - |
| 12 | 🔲 Pendente | Polish | - |
| 13 | 🔲 Opcional | Auth | - |

---

## 9. Como Retomar (para qualquer session)

Para continuar de onde parou:

1. Ler este arquivo (`/opt/data/agentos/PLAN.md`) — ver qual phase está pendente
2. Verificar o repo: `cd /opt/data/agentos && git log --oneline -5`
3. Rodar testes existentes: `cd /opt/data/agentos && pytest tests/e2e/ -v`
4. Ver status do Kanban: `sqlite3 /opt/data/kanban.db "SELECT id,title,status FROM tasks WHERE title LIKE '%AgentOS%' ORDER BY created_at DESC LIMIT 5;"`
5. Implementar o próximo increment pendente
6. Seguir o fluxo SDLC (Coder → Pixel → Nexus → Atlas)

### Cron de retomada automática

```yaml
schedule: "0 9 * * *"  # Diário às 9:00
prompt: |
  Ler /opt/data/agentos/PLAN.md e identificar o próximo increment pendente.
  Verificar se há task Kanban ativa para AgentOS.
  Se não houver task ativa e houver increment pendente:
    1. Criar task Kanban (assignee=coder, workspace=dir:/opt/data/agentos)
    2. Após Coder completar, despachar Pixel para E2E + vision
    3. Após Pixel PASS, despachar Nexus para regressão + commit
    4. Após Nexus commit, atualizar PLAN.md marcando increment como done
  Se houver task bloqueada: notificar Mauricio via WhatsApp com erro.
```

---

*Documento vivo — atualizar a cada increment completado.*