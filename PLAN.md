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

### Testing (future)

E2E tests with Playwright + vision validation will be added in a future phase.

---

## 5. Roadmap Incremental (1 feature por semana)

### Phase 0 — Bootstrap (Semana 1) ✅ DONE
- [x] Scaffold FastAPI app com `GET /health`
- [x] Scaffold Vite + React com landing page
- [x] `GET /health` retorna `{"status": "ok", "version": "0.1.0"}`
- [x] Landing page mostra "AgentOS"
- [x] Repo GitHub criado, `.gitignore`, `SECURITY.md`
- **Entrega:** App rodando em `:9120` com página inicial

### Phase 1 — Agent Health Cards (Semana 2) ✅ DONE
- [x] Backend: `GET /api/agents` — descoberta dinâmica de profiles (default + sub-profiles)
- [x] Frontend: Dashboard com cards (nome, modelo, status, sessões)
- [x] Pixel: Validação visual com Playwright + design refinement
- **Entrega:** Dashboard funcional mostrando o time (6 agentes)

### Phase 2 — Session List (Semana 3) ✅ DONE
- [x] Backend: `GET /api/sessions` — query read-only no `state.db`
- [x] Frontend: Tabela com filtros (profile, search, date)
- [x] Frontend: Busca FTS5 na lista de sessions
- [x] Frontend: Pagination
- **Entrega:** Lista de sessões com busca e filtros

### Phase 3 — Session Detail + Chat (Semana 4-5) ✅ DONE
- [x] Backend: `GET /api/sessions/:id/messages` — read from `state.db`
- [x] Frontend: Chat thread with message bubbles (user/assistant/tool)
- [x] Frontend: Tool call expand/collapse cards
- [x] Frontend: Reasoning blocks
- [x] Bug fix: Message overflow (overflowWrap: anywhere for long content)
- [x] Bug fix: Default profile (Hermes) missing from dashboard
- **Entrega:** Chat thread com tool calls e reasoning blocks (read-only)

### Phase 3.5 — Chat Detail Improvements (Semana 5.5) ✅ DONE
- [x] **Markdown rendering** — react-markdown + remark-gfm renders headings, lists, code blocks, bold/italic, links, tables, blockquotes
- [x] **Line break handling** — remark-gfm preserves line breaks properly
- [x] **Code block syntax highlighting** — rehype-highlight with github-dark theme
- [x] **Message content sanitization** — react-markdown default (no raw HTML allowed)
- [x] **Tool call content formatting** — markdown in scrollable container
- **Entrega:** Mensagens renderizadas com formatação Markdown, quebras de linha, e code blocks legíveis

### Phase 4 — Kanban Board Read-Only (Semana 6) ✅ DONE
- [x] Backend: `GET /api/tasks` — query read-only no `kanban.db`
- [x] Frontend: 5 colunas (backlog, todo, in_progress, review, done)
- [x] Frontend: Cards com título, assignee, prioridade
- [x] Frontend: Task detail view + archived toggle
- **Entrega:** Kanban board visual (só leitura)

### Phase 5 — Kanban Drag & Drop (Semana 7) ✅ DONE
- [x] Backend: `PATCH /api/tasks/{id}` — valida status, escreve no `kanban.db`, auto-set started_at/completed_at
- [x] Frontend: @dnd-kit/core + @dnd-kit/sortable — drag cards entre 5 colunas com closestCorners
- [x] Frontend: Optimistic update via useMutation com rollback on error
- [x] Frontend: DragOverlay com rotação + sombra, column drop highlight (ring-accent)
- [x] Frontend: PointerSensor distance:5 (click vs drag sem conflito)
- [x] Frontend: MarkdownRenderer nos cards (task.title) e task detail (task.body) com prose-kanban-card CSS
- **Entrega:** Kanban funcional com drag-and-drop + markdown rendering

### Phase 6 — Task Detail Panel (Semana 8) ✅ DONE
- [x] Frontend: Tabbed interface (Overview, Runs, Comments, Children) with state-based tabs
- [x] Frontend: MarkdownRenderer in task title, comments, and body
- [x] Frontend: Count badges on tabs (Runs (N), Comments (N))
- [x] Frontend: data-testid attributes for testability
- [x] Frontend: Children tab with clickable cards
- **Entrega:** Task detail com tabs organizadas e markdown em todo conteúdo

### Phase 7 — Config Viewer (Semana 9) ✅ DONE
- [x] Backend: `GET /api/config` — parse seguro do `config.yaml` (safe_load) com redação de secrets
- [x] Backend: `GET /api/config/raw` — YAML redacted como texto
- [x] Frontend: Tree view colapsável (ConfigNode recursivo, auto-expand 2 níveis)
- [x] Frontend: YAML view com toggle (tree ↔ yaml)
- [x] Frontend: Search/filter por key name
- [x] Frontend: Secret indicators (🔒 + amber text para valores redacted)
- [x] Frontend: Warning banner "Read-only — changes require container restart"
- [x] Frontend: Navbar link "Config"
- **Entrega:** Visualizador de config read-only com redação de secrets

### Phase 8 — Config Editor (Semana 10) ✅ DONE
- [x] Backend: `PATCH /api/config` — atomic write (temp + rename), yaml.safe_dump
- [x] Backend: Secret field validation (NEVER_EDITABLE list, rejects api_key/token/password/etc)
- [x] Backend: Suffix-based matching (avoids false positives like max_tokens)
- [x] Frontend: Edit toggle (View ↔ Edit mode)
- [x] Frontend: Inline editors by type (text, number, boolean checkbox, list)
- [x] Frontend: Change tracking with modified indicator + count badge
- [x] Frontend: Sticky save bar (Save Changes (N) / Cancel)
- [x] Frontend: useMutation with cache invalidation
- **Entrega:** Editor de config seguro com validação e atomic write

### Phase 9 — Skills Hub Browser (Semana 11) ✅ DONE
- [x] Backend: `GET /api/skills` — parse SKILL.md YAML frontmatter
- [x] Backend: `GET /api/skills/{slug}` — full detail + file list
- [x] Frontend: Grid de skills com category colors, search, filtros, sort
- [x] Frontend: Detail modal com MarkdownRenderer
- [x] Cleanup: remove example.env, fix SECURITY.md, clean PLAN.md tests, improve .gitignore
- **Entrega:** Browser de skills funcional
### Phase 10 — Workflow Editor Visual (Semana 12) ✅ DONE
- [x] Backend: CRUD completo — `backend/workflows.py` (SQLite table, 5 endpoints)
- [x] Frontend: React Flow canvas com nodes customizados (trigger/action/condition)
- [x] Frontend: WorkflowListPage + WorkflowEditorPage + node palette + properties panel
- [x] Styling: Dark theme CSS overrides pra React Flow
- **Entrega:** Editor visual de workflows (estático)

### Phase 11 — Workflow Execution (Semana 13)
- [ ] Backend: `POST /api/workflows/:id/run` — gera cron + kanban tasks
- [ ] Frontend: Botão "Run Now" + status indicator
- **Entrega:** Workflows executáveis

### Phase 12 — Polish (Semana 14)
- [ ] Dark mode (já com shadcn/ui, só ajustar tokens)
- [ ] Keyboard shortcuts (Cmd+K search, etc)
- [ ] Responsive (mobile breakpoints)
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
├── 020-agentos                   # s6 cont-init.d script (reference)
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

| Phase | Status | Feature | Notes |
|-------|--------|---------|-------|
| 0 | ✅ Done | Bootstrap + landing page | FastAPI + Vite scaffold |
| 1 | ✅ Done | Agent health cards | 6 profiles (incl. default/Hermes), dynamic discovery |
| 2 | ✅ Done | Session list | FTS5 search, pagination, filters |
| 3 | ✅ Done | Session detail + chat | Message bubbles, tool calls, reasoning blocks |
| 3.5 | ✅ Done | Chat detail improvements | Markdown rendering, syntax highlighting, GFM |
| 4 | ✅ Done | Kanban read-only | 5 columns, task detail, archived toggle |
| — | ✅ Done | Visual identity | DESIGN.md, dark theme, Pixel refinement |
| — | ✅ Done | Bug fixes | Message overflow, default profile missing |
| 5 | ✅ Done | Kanban DnD + Markdown | @dnd-kit, PATCH endpoint, optimistic update, MarkdownRenderer in cards |
| 6 | ✅ Done | Task detail tabs | Overview/Runs/Comments/Children tabs, markdown in title+comments |
| 7 | ✅ Done | Config viewer | Tree+YAML view, secret redaction, search, read-only |
| 8 | ✅ Done | Config editor | Atomic write, secret validation, inline editors, change tracking |
| 9 | ✅ Done | Skills hub | Grid view, category colors, search/filter/sort, detail modal |
| 10 | ✅ Done | Workflow editor | React Flow canvas, CRUD, node palette, dark theme |
| 11 | 🔲 Pending | Workflow execution | — |
| 12 | 🔲 Pending | Polish | — |
| 13 | 🔲 Optional | Auth | — |

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