import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 5000,
      retry: 2,
    },
  },
})

/* ── Types ─────────────────────────────────────────── */

interface AgentProfile {
  id: string
  name: string
  model: string
  provider: string
  role: string
  gateway_state: string
  pid: number | null
  process_alive: boolean
  sessions: number
}

interface SessionItem {
  id: string
  source: string
  model: string
  title: string | null
  started_at: string | null
  ended_at: string | null
  message_count: number
  tool_call_count: number
  chat_type: string | null
  archived: boolean
  duration_seconds: number | null
  snippet?: string
}

interface SessionListResponse {
  sessions: SessionItem[]
  total: number
  limit: number
  offset: number
}

interface MessageItem {
  id: number
  session_id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_name: string | null
  timestamp: string | null
  tool_calls: unknown
  finish_reason: string | null
  token_count: number | null
  reasoning_content: string | null
}

interface MessagesResponse {
  messages: MessageItem[]
  total: number
  limit: number
  offset: number
}

interface TaskItem {
  id: string
  title: string | null
  body: string | null
  assignee: string | null
  status: string
  priority: number | null
  created_by: string | null
  created_at: string | null
  started_at: string | null
  completed_at: string | null
  workspace_kind: string | null
  workspace_path: string | null
  session_id: string | null
  project_id: string | null
  has_children: boolean
  parent_id: string | null
  run_count: number
  comment_count: number
  created_date: string
}

interface TaskRun {
  id: number
  profile: string | null
  step_key: string | null
  status: string
  started_at: string | null
  ended_at: string | null
  outcome: string | null
  summary: string | null
}

interface TaskComment {
  id: number
  author: string
  body: string
  created_at: string | null
}

interface TaskDetail {
  id: string
  title: string | null
  body: string | null
  assignee: string | null
  status: string
  priority: number | null
  created_by: string | null
  created_at: string | null
  started_at: string | null
  completed_at: string | null
  workspace_kind: string | null
  workspace_path: string | null
  session_id: string | null
  project_id: string | null
  runs: TaskRun[]
  comments: TaskComment[]
  children: string[]
  parent_id: string | null
}

/* ── NavBar ────────────────────────────────────────── */

function NavBar() {
  const navLink = (to: string, label: string) => {
    const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to))
    return (
      <Link
        to={to}
        className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition duration-200 ease-agent-os ${
          active ? 'text-accent bg-accent-subtle' : 'text-text-secondary hover:text-text-primary hover:bg-surface/60'
        }`}
      >
        {label}
        {active && (
          <span className="absolute bottom-[-13px] left-1 right-1 h-[2px] bg-accent rounded-full shadow-glow" />
        )}
      </Link>
    )
  }

  return (
    <nav className="bg-bg-elevated/80 backdrop-blur-md border-b border-border px-6 py-3 sticky top-0 z-50">
      <div className="mx-auto max-w-7xl flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2 text-text-primary font-bold text-lg tracking-tight group">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-accent/10 border border-accent/20">
            <span className="w-2 h-2 rounded-full bg-accent shadow-glow animate-pulse" />
          </span>
          <span>AgentOS</span>
        </Link>
        <div className="flex items-center gap-5 ml-2">
          {navLink('/', 'Dashboard')}
          {navLink('/sessions', 'Sessions')}
          {navLink('/tasks', 'Tasks')}
        </div>
      </div>
    </nav>
  )
}

/* ── Dashboard ───────────────────────────────────── */

function AgentCard({ agent }: { agent: AgentProfile }) {
  const isRunning = agent.process_alive && agent.gateway_state === 'running'
  return (
    <div
      tabIndex={0}
      role="button"
      aria-label={`${agent.name} agent card. Status: ${isRunning ? 'Running' : 'Stopped'}. Role: ${agent.role}. Sessions: ${agent.sessions}.`}
      className="card-focus rounded-xl border border-border bg-surface/40 p-5 transition hover:bg-surface-hover/70 hover:shadow-md cursor-pointer"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-h4 font-semibold text-text-primary">{agent.name}</h3>
        <span
          className={`inline-block h-2 w-2 rounded-full ${isRunning ? 'bg-semantic-success' : 'bg-text-tertiary'}`}
          title={isRunning ? 'Running' : 'Stopped'}
          aria-label={isRunning ? 'Running' : 'Stopped'}
        />
      </div>
      <p className="text-body-sm text-text-secondary mb-4">{agent.role}</p>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center rounded-md bg-bg-base px-2 py-1 text-mono-sm text-accent border border-border">
          {agent.model}
        </span>
        <span className="inline-flex items-center rounded-md bg-bg-base px-2 py-1 text-mono-sm text-text-secondary border border-border">
          {agent.provider}
        </span>
      </div>
      <div className="flex items-center justify-between text-caption text-text-tertiary">
        <span className="font-mono">PID: {agent.pid ?? '-'}</span>
        <span>Sessions: {agent.sessions}</span>
      </div>
    </div>
  )
}

function DashboardPage() {
  const { data, isLoading, error } = useQuery<AgentProfile[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetch('/api/agents')
      if (!res.ok) throw new Error('Failed to load agents')
      return res.json()
    },
  })

  const activeCount = data?.filter((a) => a.process_alive).length ?? 0
  const totalSessions = data?.reduce((sum, a) => sum + a.sessions, 0) ?? 0

  return (
    <div className="min-h-screen bg-bg-base text-text-secondary">
      <NavBar />
      <header className="px-6 pt-10 pb-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-display font-bold text-text-primary tracking-tight">AgentOS</h1>
              <p className="mt-2 text-body text-text-secondary max-w-lg">
                Control plane for Hermes Agent
              </p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-caption text-text-tertiary uppercase tracking-widest mb-0.5">Active Agents</p>
                <p className="text-h2 font-bold text-accent tabular-nums">{activeCount}</p>
              </div>
              <div className="text-right">
                <p className="text-caption text-text-tertiary uppercase tracking-widest mb-0.5">Sessions</p>
                <p className="text-h2 font-bold text-text-primary tabular-nums">{totalSessions}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-12">
        {isLoading && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-surface/20 p-5 animate-skeleton"
                aria-hidden="true"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="h-5 w-24 rounded bg-surface/60" />
                  <div className="h-2 w-2 rounded-full bg-surface/60" />
                </div>
                <div className="h-4 w-40 rounded bg-surface/60 mb-4" />
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-20 rounded bg-surface/60" />
                  <div className="h-5 w-20 rounded bg-surface/60" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="h-3 w-16 rounded bg-surface/60" />
                  <div className="h-3 w-20 rounded bg-surface/60" />
                </div>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-subtle px-4 py-3 text-sm text-error">
            Error: {(error as Error).message}
          </div>
        )}
        {data && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {data.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

/* ── Health ────────────────────────────────────────── */

function HealthPage() {
  const [healthData, setHealthData] = useState<{ status: string; version: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then(setHealthData)
      .catch((e) => setError(e.message))
  }, [])

  const statusColor = healthData?.status === 'ok' ? 'text-semantic-success' : 'text-semantic-error'
  const statusBg = healthData?.status === 'ok' ? 'bg-semantic-success/10' : 'bg-semantic-error/10'
  const statusBorder = healthData?.status === 'ok' ? 'border-semantic-success/30' : 'border-semantic-error/30'
  const statusDot = healthData?.status === 'ok' ? 'bg-semantic-success' : 'bg-semantic-error'

  return (
    <div className="min-h-screen flex flex-col bg-bg-base text-text-secondary">
      <NavBar />
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className={`rounded-xl border ${statusBorder} ${statusBg} p-6 mb-6 text-center`}>
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-bg-elevated border border-border mb-4">
              <span className={`inline-block w-3 h-3 rounded-full ${statusDot} shadow-md`} />
            </div>
            <h1 className="text-h2 font-bold text-text-primary mb-1">System Status</h1>
            <p className="text-body text-text-secondary">
              {healthData ? (
                <span className="inline-flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
                  <span className={`font-medium ${statusColor}`}>{healthData.status.toUpperCase()}</span>
                </span>
              ) : (
                'Checking…'
              )}
            </p>
          </div>

          {error && <p className="text-semantic-error text-sm text-center mb-4">Error: {error}</p>}

          {healthData && (
            <div className="rounded-xl border border-border bg-surface/30 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-caption text-text-tertiary uppercase tracking-wider">Status</span>
                <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${statusColor}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot}`} />
                  {healthData.status}
                </span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between">
                <span className="text-caption text-text-tertiary uppercase tracking-wider">Version</span>
                <span className="font-mono text-sm text-text-primary">{healthData.version}</span>
              </div>
            </div>
          )}

          {!healthData && !error && (
            <p className="text-text-secondary text-center">Loading…</p>
          )}

          <div className="mt-8 text-center">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent-hover transition"
            >
              ← Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Utilities ───────────────────────────────────── */

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function formatStartedAt(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month} ${hour}:${minute}`
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return 'Running'
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m === 0) return `${rem}s`
  return `${m}m ${rem}s`
}

function sourceBadge(source: string) {
  const map: Record<string, string> = {
    whatsapp:   'bg-success-subtle text-success border border-success/20',
    discord:    'bg-accent-tertiary/10 text-accent-tertiary border border-accent-tertiary/20',
    telegram:   'bg-info-subtle text-info border border-info/20',
    api_server: 'bg-accent-secondary-subtle text-accent-secondary border border-accent-secondary/20',
    webhook:    'bg-error-subtle text-error border border-error/20',
    tui:        'bg-surface text-text-secondary border border-border',
    cli:        'bg-surface text-text-secondary border border-border',
    cron:       'bg-surface text-text-secondary border border-border',
    homeassistant: 'bg-info-subtle text-info border border-info/20',
    subagent:   'bg-accent-tertiary/10 text-accent-tertiary border border-accent-tertiary/20',
  }
  return map[source.toLowerCase()] || 'bg-surface text-text-secondary border border-border'
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    whatsapp: 'WhatsApp',
    discord: 'Discord',
    telegram: 'Telegram',
    api_server: 'API',
    webhook: 'Webhook',
    tui: 'TUI',
    cli: 'CLI',
    cron: 'Cron',
    homeassistant: 'Home Assistant',
    subagent: 'Subagent',
  }
  return labels[source.toLowerCase()] || source
}

/* ── Sessions Page ─────────────────────────────────── */

function SessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [rawSearch, setRawSearch] = useState(searchParams.get('search') || '')
  const search = useDebounce(rawSearch, 300)
  const source = searchParams.get('source') || ''
  const model = searchParams.get('model') || ''

  const limit = 20
  const offset = parseInt(searchParams.get('offset') || '0', 10) || 0

  // Update URL when debounced search changes
  useEffect(() => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (source) params.set('source', source)
    if (model) params.set('model', model)
    if (offset) params.set('offset', String(offset))
    setSearchParams(params, { replace: true })
  }, [search, source, model, offset])

  const { data, isLoading, error } = useQuery<SessionListResponse>({
    queryKey: ['sessions', limit, offset, search, source, model],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (search) params.set('search', search)
      if (source) params.set('source', source)
      if (model) params.set('model', model)
      const res = await fetch(`/api/sessions?${params}`)
      if (!res.ok) throw new Error('Failed to load sessions')
      return res.json()
    },
  })

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0
  const currentPage = data ? Math.floor(data.offset / data.limit) + 1 : 1

  // Fetch unique models for dropdown
  const { data: modelList } = useQuery<string[]>({
    queryKey: ['session-models'],
    queryFn: async () => {
      const res = await fetch('/api/sessions?limit=500')
      if (!res.ok) return []
      const payload: SessionListResponse = await res.json()
      const set = new Set<string>()
      payload.sessions.forEach((s) => { if (s.model) set.add(s.model) })
      return Array.from(set).sort()
    },
  })

  const handlePage = (newOffset: number) => {
    if (newOffset < 0) return
    const params = new URLSearchParams(searchParams)
    params.set('offset', String(newOffset))
    setSearchParams(params)
  }

  return (
    <div className="min-h-screen bg-bg-base text-text-secondary">
      <NavBar />
      <header className="px-6 pt-8 pb-4 border-b border-border">
        <div className="mx-auto max-w-7xl flex items-end justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-h2 font-bold text-text-primary">Sessions</h1>
              {data && (
                <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-surface text-text-secondary border border-border">
                  {data.total}
                </span>
              )}
            </div>
            <p className="text-body text-text-secondary">Conversation history</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search by title..."
              value={rawSearch}
              onChange={(e) => {
                setRawSearch(e.target.value)
                const params = new URLSearchParams(searchParams)
                params.delete('offset')
                setSearchParams(params)
              }}
              className="rounded-md bg-surface border border-border px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-72"
            />
            <select
              value={source}
              onChange={(e) => {
                const params = new URLSearchParams(searchParams)
                if (e.target.value) params.set('source', e.target.value)
                else params.delete('source')
                params.delete('offset')
                setSearchParams(params)
              }}
              className="rounded-md bg-surface border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">All sources</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="discord">Discord</option>
              <option value="telegram">Telegram</option>
              <option value="api_server">API</option>
              <option value="webhook">Webhook</option>
              <option value="tui">TUI</option>
              <option value="cli">CLI</option>
              <option value="cron">Cron</option>
              <option value="homeassistant">Home Assistant</option>
              <option value="subagent">Subagent</option>
            </select>

            <select
              value={model}
              onChange={(e) => {
                const params = new URLSearchParams(searchParams)
                if (e.target.value) params.set('model', e.target.value)
                else params.delete('model')
                params.delete('offset')
                setSearchParams(params)
              }}
              className="rounded-md bg-surface border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">All models</option>
              {modelList?.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {isLoading && (
          <div className="rounded-xl border border-border bg-surface/20 p-8 animate-skeleton">
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-4 w-48 rounded bg-surface/60" />
                  <div className="h-4 w-20 rounded bg-surface/60" />
                  <div className="h-4 w-32 rounded bg-surface/60" />
                  <div className="h-4 w-12 rounded bg-surface/60" />
                  <div className="h-4 w-20 rounded bg-surface/60" />
                  <div className="h-4 w-20 rounded bg-surface/60" />
                </div>
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-subtle px-4 py-3 text-sm text-error">
            Error: {(error as Error).message}
          </div>
        )}
        {data && data.sessions.length === 0 && (
          <div className="rounded-xl border border-border bg-surface/20 p-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </div>
            <p className="text-body text-text-primary mb-1">No sessions found</p>
            <p className="text-caption text-text-tertiary">Try adjusting your search or filters.</p>
          </div>
        )}
        {data && data.sessions.length > 0 && (
          <>
            <div role="region" aria-label="Sessions table" tabIndex={0} className="overflow-x-auto rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2">
              <table className="w-full text-sm" role="table" aria-label="Sessions list">
                <thead className="bg-bg-elevated text-text-secondary text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium text-text-tertiary">Title</th>
                    <th className="px-4 py-3 font-medium text-text-tertiary">Source</th>
                    <th className="px-4 py-3 font-medium text-text-tertiary">Model</th>
                    <th className="px-4 py-3 font-medium text-text-tertiary text-right">Messages</th>
                    <th className="px-4 py-3 font-medium text-text-tertiary">Started</th>
                    <th className="px-4 py-3 font-medium text-text-tertiary">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.sessions.map((s) => (
                    <tr
                      key={s.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Session ${s.title || 'Untitled'} from ${sourceLabel(s.source)}. ${s.message_count} messages. ${formatDuration(s.duration_seconds)}.`}
                      onClick={() => navigate(`/sessions/${encodeURIComponent(s.id)}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(`/sessions/${encodeURIComponent(s.id)}`)
                        }
                      }}
                      className="tr-focus cursor-pointer hover:bg-surface/40 transition"
                    >
                      <td className="px-4 py-3 text-text-primary truncate max-w-xs font-medium">
                        {s.title || 'Untitled'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${sourceBadge(s.source)}`}>
                          {sourceLabel(s.source)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-mono-sm text-text-secondary">{s.model}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{s.message_count}</td>
                      <td className="px-4 py-3 tabular-nums text-text-secondary">{formatStartedAt(s.started_at)}</td>
                      <td className="px-4 py-3 tabular-nums">
                        <span className={`inline-flex items-center gap-1.5 ${s.duration_seconds === null ? 'text-semantic-warning' : 'text-text-secondary'}`}>
                          {s.duration_seconds === null && <span className="inline-block w-1.5 h-1.5 rounded-full bg-semantic-warning animate-pulse" />}
                          {formatDuration(s.duration_seconds)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <nav aria-label="Sessions pagination" className="flex items-center justify-between mt-4 text-sm">
              <button
                onClick={() => handlePage(offset - limit)}
                disabled={offset === 0}
                aria-label="Previous page"
                className="px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover/80 transition"
              >
                Previous
              </button>
              <span className="text-text-secondary" aria-live="polite">
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                onClick={() => handlePage(offset + limit)}
                disabled={!data || offset + limit >= data.total}
                aria-label="Next page"
                className="px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover/80 transition"
              >
                Next
              </button>
            </nav>
          </>
        )}
      </main>
    </div>
  )
}

/* ── Markdown Renderer ─────────────────────────────── */

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        p: ({ children }) => <p className="text-sm leading-relaxed mb-2" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</p>,
        h1: ({ children }) => <h1 className="text-text-primary font-semibold text-lg mb-2 mt-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-text-primary font-semibold text-base mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-text-primary font-semibold text-sm mb-1 mt-2">{children}</h3>,
        h4: ({ children }) => <h4 className="text-text-primary font-semibold text-sm mb-1 mt-2">{children}</h4>,
        h5: ({ children }) => <h5 className="text-text-primary font-semibold text-sm mb-1 mt-2">{children}</h5>,
        h6: ({ children }) => <h6 className="text-text-primary font-semibold text-sm mb-1 mt-2">{children}</h6>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-2 text-sm">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 text-sm">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-accent/30 pl-4 italic text-text-secondary mb-2">
            {children}
          </blockquote>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-')
          if (isBlock) {
            return (
              <pre className="bg-bg-elevated rounded-md p-3 overflow-auto max-h-96 mb-2 text-mono-sm" style={{ overflowWrap: 'anywhere', wordBreak: 'break-all' }}>
                <code className={className}>{children}</code>
              </pre>
            )
          }
          return (
            <code className="bg-surface rounded px-1 py-0.5 text-mono-sm text-accent">
              {children}
            </code>
          )
        },
        table: ({ children }) => (
          <div className="overflow-auto max-w-full mb-2">
            <table className="w-full text-sm border-collapse border border-border">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-bg-elevated">{children}</thead>,
        th: ({ children }) => (
          <th className="border border-border px-2 py-1 text-left text-text-primary font-semibold">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-border px-2 py-1 text-text-secondary">{children}</td>
        ),
        hr: () => <hr className="border-border my-3" />,
        strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        del: ({ children }) => <del className="line-through text-text-tertiary">{children}</del>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

/* ── Message Components ────────────────────────────── */

function formatMessageTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month} ${hour}:${minute}`
}

function ReasoningBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide reasoning' : 'Show reasoning'}
        className="text-caption text-text-tertiary italic hover:text-text-secondary transition"
      >
        {expanded ? 'Hide thinking…' : 'Thinking…'}
      </button>
      {expanded && (
        <div className="mt-1 text-caption text-text-tertiary italic whitespace-pre-wrap overflow-hidden">
          <MarkdownRenderer content={content} />
        </div>
      )}
    </div>
  )
}

function ToolMessage({ msg }: { msg: MessageItem }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="w-full my-2 border border-border rounded-lg bg-bg-elevated font-mono">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${msg.tool_name || 'tool'} result` : `Expand ${msg.tool_name || 'tool'} result`}
        className="w-full flex items-center justify-between px-3 py-2 text-mono-sm text-text-secondary hover:bg-surface-hover/40 transition cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <span className="inline-block rounded bg-surface px-1.5 py-0.5 text-overline uppercase">
            Tool
          </span>
          <span className="text-mono-sm text-text-secondary">{msg.tool_name || 'unknown'}</span>
        </span>
        <span
          className="text-text-tertiary transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-border overflow-hidden max-h-96" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          <MarkdownRenderer content={msg.content || ''} />
        </div>
      )}
    </div>
  )
}

function UserMessage({ msg }: { msg: MessageItem }) {
  return (
    <div className="flex flex-col items-end my-2 max-w-[80%] self-end min-w-0">
      <div
        className="bg-accent-subtle rounded-2xl rounded-br-sm px-4 py-2 text-sm text-accent overflow-hidden"
        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
      >
        <MarkdownRenderer content={msg.content || ''} />
      </div>
      <span className="text-caption text-text-tertiary mt-1">{formatMessageTime(msg.timestamp)}</span>
    </div>
  )
}

function AssistantMessage({ msg }: { msg: MessageItem }) {
  return (
    <div className="flex flex-col items-start my-2 max-w-[80%] min-w-0">
      {msg.reasoning_content && <ReasoningBlock content={msg.reasoning_content} />}
      <div
        className="bg-surface/60 rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-text-primary overflow-hidden"
        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
      >
        <MarkdownRenderer content={msg.content || ''} />
      </div>
      <span className="text-caption text-text-tertiary mt-1">{formatMessageTime(msg.timestamp)}</span>
    </div>
  )
}

function MessagesSection({ sessionId }: { sessionId: string }) {
  const [offset, setOffset] = useState(0)
  const limit = 100
  const bottomRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  const { data, isLoading, error } = useQuery<MessagesResponse>({
    queryKey: ['messages', sessionId, offset, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`)
      if (!res.ok) throw new Error('Failed to load messages')
      return res.json()
    },
  })

  useEffect(() => {
    if (data && !hasScrolledRef.current) {
      hasScrolledRef.current = true
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' })
      }, 50)
    }
  }, [data])

  const canLoadMore = data ? offset + data.messages.length < data.total : false

  const handleLoadMore = () => {
    if (!data) return
    const newOffset = offset + limit
    setOffset(newOffset)
    hasScrolledRef.current = false
  }

  if (isLoading) return (
    <div className="space-y-3 py-6" aria-label="Loading messages" role="status">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
          <div className="animate-skeleton rounded-2xl px-4 py-3 bg-surface/30 max-w-[70%] min-w-[12rem]">
            <div className="h-3 w-full rounded bg-surface/40 mb-2" />
            <div className="h-3 w-3/4 rounded bg-surface/40" />
          </div>
        </div>
      ))}
    </div>
  )
  if (error) return <p className="text-error text-sm py-4">Error: {(error as Error).message}</p>
  if (!data || data.messages.length === 0) return <p className="text-text-tertiary py-6">No messages in this session</p>

  return (
    <div className="flex flex-col">
      {canLoadMore && (
        <div className="flex justify-center py-3">
          <button
            onClick={handleLoadMore}
            className="px-4 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary hover:bg-surface-hover/80 transition"
          >
            Load more
          </button>
        </div>
      )}
      <div className="flex flex-col px-2">
        {[...data.messages].reverse().map((msg) => {
          if (msg.role === 'user') return <UserMessage key={msg.id} msg={msg} />
          if (msg.role === 'assistant') return <AssistantMessage key={msg.id} msg={msg} />
          return <ToolMessage key={msg.id} msg={msg} />
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  )
}

/* ── Session Detail Page ───────────────────────────── */

function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery<SessionItem>({
    queryKey: ['session', id],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id!)}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('Session not found')
        throw new Error('Failed to load session')
      }
      return res.json()
    },
  })

  return (
    <div className="min-h-screen bg-bg-base text-text-secondary">
      <NavBar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <button
          onClick={() => navigate('/sessions')}
          className="mb-4 text-body-sm text-accent hover:underline"
        >
          ← Back to sessions
        </button>

        {isLoading && <p className="text-text-secondary">Loading session…</p>}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-subtle px-4 py-3 text-sm text-error">
            Error: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <h1 className="text-h2 font-bold text-text-primary mb-1">
              {data.title || 'Untitled'}
            </h1>
            <div className="flex items-center gap-2 mb-6">
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${sourceBadge(data.source)}`}>
                {sourceLabel(data.source)}
              </span>
              <span className="font-mono text-mono-sm text-text-secondary">{data.model}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">ID</p>
                <p className="font-mono text-sm text-text-primary break-all">{data.id}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Chat Type</p>
                <p className="text-sm text-text-primary">{data.chat_type || '-'}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Started</p>
                <p className="text-sm text-text-primary">{data.started_at ? new Date(data.started_at).toLocaleString() : '-'}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Ended</p>
                <p className="text-sm text-text-primary">{data.ended_at ? new Date(data.ended_at).toLocaleString() : 'Running'}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Duration</p>
                <p className="text-sm text-text-primary">{formatDuration(data.duration_seconds)}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Messages / Tool Calls</p>
                <p className="text-sm text-text-primary">{data.message_count} / {data.tool_call_count}</p>
              </div>
              {data.archived && (
                <div className="rounded-lg border border-warning/30 bg-warning-subtle p-4">
                  <p className="text-caption text-warning mb-1">Archived</p>
                  <p className="text-sm text-text-primary">This session is archived.</p>
                </div>
              )}
              {data.snippet && (
                <div className="rounded-lg border border-border bg-surface/30 p-4 sm:col-span-2">
                  <p className="text-caption text-text-tertiary mb-1">Snippet</p>
                  <p className="text-sm text-text-primary whitespace-pre-wrap">{data.snippet}</p>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface/30 p-4">
              <p className="text-h4 font-semibold text-text-primary mb-3">Messages</p>
              <MessagesSection sessionId={data.id} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

/* ── Kanban Board ──────────────────────────────────── */

const COLUMN_META = [
  { status: 'todo',    label: 'Backlog', accent: 'border-l-text-tertiary', header: 'border-text-tertiary/50', badge: 'bg-surface text-text-tertiary border border-text-tertiary/20' },
  { status: 'ready',   label: 'Ready',   accent: 'border-l-info',           header: 'border-info/50',           badge: 'bg-info-subtle text-info border border-info/20' },
  { status: 'running', label: 'Running', accent: 'border-l-warning',        header: 'border-warning/50',        badge: 'bg-warning-subtle text-warning border border-warning/20' },
  { status: 'done',    label: 'Done',    accent: 'border-l-success',        header: 'border-success/50',        badge: 'bg-success-subtle text-success border border-success/20' },
  { status: 'blocked', label: 'Blocked', accent: 'border-l-error',          header: 'border-error/50',          badge: 'bg-error-subtle text-error border border-error/20' },
]

function columnForStatus(status: string): string {
  const known = ['todo', 'ready', 'running', 'done', 'blocked']
  return known.includes(status) ? status : 'todo'
}

function assigneeBadgeClass(assignee: string | null): string {
  const map: Record<string, string> = {
    nexus: 'bg-accent-tertiary/15 text-accent-tertiary border border-accent-tertiary/20',
    atlas: 'bg-info/15 text-info border border-info/20',
    coder: 'bg-success/15 text-success border border-success/20',
    pixel: 'bg-accent-secondary-subtle text-accent-secondary border border-accent-secondary/20',
    nova:  'bg-warning/15 text-warning border border-warning/20',
  }
  return map[assignee?.toLowerCase() || ''] || 'bg-surface text-text-secondary border border-border'
}

function priorityDotClass(priority: number | null): string {
  const map: Record<number, string> = {
    0: 'bg-semantic-error',
    1: 'bg-semantic-warning',
    2: 'bg-semantic-info',
    3: 'bg-text-tertiary',
  }
  return map[priority ?? 3] || 'bg-text-tertiary'
}

function priorityLabel(priority: number | null): string {
  const map: Record<number, string> = {
    0: 'P0',
    1: 'P1',
    2: 'P2',
    3: 'P3',
  }
  return map[priority ?? 3] || 'P?'
}

function TaskCard({ task }: { task: TaskItem }) {
  const navigate = useNavigate()
  return (
    <div
      tabIndex={0}
      role="button"
      aria-label={`Task ${task.title || 'Untitled'}. Priority ${priorityLabel(task.priority)}. Assignee ${task.assignee || 'unassigned'}. ${task.run_count} runs. ${task.comment_count} comments.`}
      onClick={() => navigate(`/tasks/${encodeURIComponent(task.id)}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/tasks/${encodeURIComponent(task.id)}`)
        }
      }}
      className={`card-focus mb-3 cursor-pointer rounded-lg border border-border bg-surface/40 p-3 transition hover:bg-surface-hover/70 hover:shadow-md border-l-4 ${COLUMN_META.find((c) => c.status === columnForStatus(task.status))?.accent || 'border-l-text-tertiary'}`}
    >
      <h4 className="text-body-sm font-medium text-text-primary line-clamp-2 leading-snug mb-2">
        {task.title || 'Untitled'}
      </h4>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {task.assignee && (
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${assigneeBadgeClass(task.assignee)}`}>
            {task.assignee}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-caption text-text-secondary">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${priorityDotClass(task.priority)}`} aria-hidden="true" />
          {priorityLabel(task.priority)}
        </span>
        {task.run_count > 0 && (
          <span className="text-caption text-text-tertiary">
            {task.run_count} run{task.run_count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-caption text-text-tertiary">{task.created_date}</span>
        {task.comment_count > 0 && (
          <span className="text-caption text-text-tertiary">
            {task.comment_count} comment{task.comment_count === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}

function KanbanColumn({ label, status, tasks }: { label: string; status: string; tasks: TaskItem[] }) {
  const meta = COLUMN_META.find((c) => c.status === status) || COLUMN_META[0]
  return (
    <div className="flex flex-col min-w-[16rem] max-w-[20rem] flex-1">
      <div className={`flex items-center justify-between mb-3 pb-2 border-b ${meta.header}`}>
        <h3 className="text-body-sm font-semibold text-text-primary">{label}</h3>
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${meta.badge}`}>
          {tasks.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-12rem)] pr-1">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {tasks.length === 0 && (
          <p className="text-caption text-text-tertiary text-center py-6">No tasks</p>
        )}
      </div>
    </div>
  )
}

function KanbanBoardPage() {
  const [showArchived, setShowArchived] = useState(false)

  const { data, isLoading, error } = useQuery<TaskItem[]>({
    queryKey: ['tasks', 'all'],
    queryFn: async () => {
      const res = await fetch('/api/tasks?include_archived=true&limit=500')
      if (!res.ok) throw new Error('Failed to load tasks')
      return res.json()
    },
    refetchInterval: 10000,
  })

  const activeTasks = data?.filter((t) => t.status !== 'archived') || []
  const archivedTasks = data?.filter((t) => t.status === 'archived') || []

  const columns = COLUMN_META.map((col) => ({
    ...col,
    tasks: activeTasks.filter((t) => columnForStatus(t.status) === col.status),
  }))

  return (
    <div className="min-h-screen bg-bg-base text-text-secondary">
      <NavBar />
      <header className="px-6 pt-8 pb-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div>
            <h1 className="text-h2 font-bold text-text-primary">Kanban Board</h1>
            <p className="text-body-sm text-text-secondary mt-1">Task pipeline</p>
          </div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="rounded-md bg-surface border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover/80 transition"
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-12">
        {isLoading && <p className="text-text-secondary">Loading tasks…</p>}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-subtle px-4 py-3 text-sm text-error mb-4">
            Error: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {columns.map((col) => (
                <KanbanColumn
                  key={col.status}
                  label={col.label}
                  status={col.status}
                  tasks={col.tasks}
                />
              ))}
            </div>

            {showArchived && (
              <div className="mt-8">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-text-tertiary/30">
                  <h3 className="text-body-sm font-semibold text-text-tertiary">Archived</h3>
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-surface text-text-tertiary border border-text-tertiary/20">
                    {archivedTasks.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {archivedTasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
                {archivedTasks.length === 0 && (
                  <p className="text-caption text-text-tertiary text-center py-6">No archived tasks</p>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

/* ── Task Detail Page ──────────────────────────────── */

function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery<TaskDetail>({
    queryKey: ['task', id],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id!)}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('Task not found')
        throw new Error('Failed to load task')
      }
      return res.json()
    },
    refetchInterval: 10000,
  })

  function formatIso(iso: string | null): string {
    if (!iso) return '-'
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '-' : d.toLocaleString()
  }

  return (
    <div className="min-h-screen bg-bg-base text-text-secondary">
      <NavBar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <button
          onClick={() => navigate('/tasks')}
          className="mb-4 text-body-sm text-accent hover:underline"
        >
          ← Back to tasks
        </button>

        {isLoading && <p className="text-text-secondary">Loading task…</p>}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-subtle px-4 py-3 text-sm text-error">
            Error: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <h1 className="text-h2 font-bold text-text-primary mb-2">{data.title || 'Untitled'}</h1>
            <div className="flex flex-wrap items-center gap-2 mb-6">
              {data.assignee && (
                <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${assigneeBadgeClass(data.assignee)}`}>
                  {data.assignee}
                </span>
              )}
              <span className="inline-flex items-center rounded px-2 py-0.5 text-caption font-medium bg-surface text-text-secondary border border-border">
                {data.status}
              </span>
              <span className="inline-flex items-center gap-1 text-caption text-text-secondary">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${priorityDotClass(data.priority)}`} />
                {priorityLabel(data.priority)}
              </span>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">ID</p>
                <p className="font-mono text-sm text-text-primary break-all">{data.id}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Created by</p>
                <p className="text-sm text-text-primary">{data.created_by || '-'}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Created at</p>
                <p className="text-sm text-text-primary">{formatIso(data.created_at)}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Started at</p>
                <p className="text-sm text-text-primary">{formatIso(data.started_at)}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Completed at</p>
                <p className="text-sm text-text-primary">{formatIso(data.completed_at)}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/30 p-4">
                <p className="text-caption text-text-tertiary mb-1">Workspace</p>
                <p className="text-sm text-text-primary font-mono">{data.workspace_kind || '-'} {data.workspace_path ? `(${data.workspace_path})` : ''}</p>
              </div>
              {data.session_id && (
                <div className="rounded-lg border border-border bg-surface/30 p-4">
                  <p className="text-caption text-text-tertiary mb-1">Session</p>
                  <p className="text-sm text-text-primary font-mono break-all">{data.session_id}</p>
                </div>
              )}
              {data.project_id && (
                <div className="rounded-lg border border-border bg-surface/30 p-4">
                  <p className="text-caption text-text-tertiary mb-1">Project</p>
                  <p className="text-sm text-text-primary">{data.project_id}</p>
                </div>
              )}
            </div>

            {/* Body */}
            {data.body && (
              <div className="rounded-lg border border-border bg-surface/30 p-4 mb-8">
                <p className="text-caption text-text-tertiary mb-2">Body</p>
                <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans">{data.body}</pre>
              </div>
            )}

            {/* Links */}
            {(data.parent_id || data.children.length > 0) && (
              <div className="rounded-lg border border-border bg-surface/30 p-4 mb-8">
                <p className="text-caption text-text-tertiary mb-2">Links</p>
                {data.parent_id && (
                  <div className="mb-1 text-sm">
                    <span className="text-text-tertiary">Parent:</span>{' '}
                    <button
                      onClick={() => navigate(`/tasks/${encodeURIComponent(data.parent_id!)}`)}
                      className="text-accent hover:underline font-mono"
                    >
                      {data.parent_id}
                    </button>
                  </div>
                )}
                {data.children.length > 0 && (
                  <div className="text-sm">
                    <span className="text-text-tertiary">Children:</span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {data.children.map((childId) => (
                        <button
                          key={childId}
                          onClick={() => navigate(`/tasks/${encodeURIComponent(childId)}`)}
                          className="text-accent hover:underline font-mono text-xs bg-bg-base px-2 py-1 rounded border border-border"
                        >
                          {childId}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Runs */}
            <div className="rounded-lg border border-border bg-surface/30 p-4 mb-8">
              <p className="text-h4 font-semibold text-text-primary mb-3">Runs ({data.runs.length})</p>
              {data.runs.length === 0 && <p className="text-body-sm text-text-tertiary">No runs recorded.</p>}
              {data.runs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-elevated text-text-secondary text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">Step</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Profile</th>
                        <th className="px-3 py-2 font-medium">Started</th>
                        <th className="px-3 py-2 font-medium">Ended</th>
                        <th className="px-3 py-2 font-medium">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.runs.map((run) => (
                        <tr key={run.id} className="hover:bg-surface/40 transition">
                          <td className="px-3 py-2 text-text-primary font-mono text-mono-sm">{run.step_key || '-'}</td>
                          <td className="px-3 py-2 text-text-secondary">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${run.status === 'done' ? 'bg-success-subtle text-success border border-success/20' : run.status === 'running' ? 'bg-warning-subtle text-warning border border-warning/20' : 'bg-surface text-text-secondary border border-border'}`}>
                              {run.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{run.profile || '-'}</td>
                          <td className="px-3 py-2 tabular-nums">{formatIso(run.started_at)}</td>
                          <td className="px-3 py-2 tabular-nums">{formatIso(run.ended_at)}</td>
                          <td className="px-3 py-2 max-w-xs truncate text-text-secondary">{run.outcome || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.runs.some((r) => r.summary) && (
                <div className="mt-4 space-y-3">
                  {data.runs.filter((r) => r.summary).map((run) => (
                    <div key={`summary-${run.id}`} className="rounded border border-border bg-bg-base/40 p-3">
                      <p className="text-mono-sm font-mono text-accent mb-1">Run {run.id} — {run.step_key || '?'}</p>
                      <p className="text-sm text-text-primary whitespace-pre-wrap">{run.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="rounded-lg border border-border bg-surface/30 p-4">
              <p className="text-h4 font-semibold text-text-primary mb-3">Comments ({data.comments.length})</p>
              {data.comments.length === 0 && <p className="text-body-sm text-text-tertiary">No comments.</p>}
              {data.comments.length > 0 && (
                <div className="space-y-3">
                  {data.comments.map((comment) => (
                    <div key={comment.id} className="rounded border border-border bg-bg-base/40 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-caption font-medium text-text-primary">{comment.author}</span>
                        <span className="text-caption text-text-tertiary">{formatIso(comment.created_at)}</span>
                      </div>
                      <p className="text-sm text-text-primary whitespace-pre-wrap">{comment.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

/* ── App ───────────────────────────────────────────── */

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
        <Route path="/tasks" element={<KanbanBoardPage />} />
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
      </Routes>
    </QueryClientProvider>
  )
}
