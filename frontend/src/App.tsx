import { useEffect, useState } from 'react'
import { Routes, Route, Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query'

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

/* ── NavBar ────────────────────────────────────────── */

function NavBar() {
  return (
    <nav className="border-b border-[var(--surface)] px-6 py-3">
      <div className="mx-auto max-w-7xl flex items-center gap-6">
        <Link to="/" className="text-white font-bold text-lg">
          AgentOS
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link to="/" className="text-[var(--text)] hover:text-white transition">
            Dashboard
          </Link>
          <Link to="/sessions" className="text-[var(--text)] hover:text-white transition">
            Sessions
          </Link>
        </div>
      </div>
    </nav>
  )
}

/* ── Dashboard ───────────────────────────────────── */

function AgentCard({ agent }: { agent: AgentProfile }) {
  const isRunning = agent.process_alive && agent.gateway_state === 'running'
  return (
    <div className="rounded-xl border border-[var(--surface)] bg-[var(--surface)]/40 p-5 transition hover:bg-[var(--surface)]/70 hover:shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: isRunning ? '#22c55e' : '#6b7280' }}
          title={isRunning ? 'Running' : 'Stopped'}
        />
      </div>
      <p className="text-sm text-[var(--text)] opacity-80 mb-4">{agent.role}</p>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center rounded-md bg-[var(--bg)] px-2 py-1 text-xs font-mono text-[var(--accent)] border border-[var(--surface)]">
          {agent.model}
        </span>
        <span className="inline-flex items-center rounded-md bg-[var(--bg)] px-2 py-1 text-xs font-mono text-[var(--text)] opacity-70 border border-[var(--surface)]">
          {agent.provider}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--text)] opacity-60">
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

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <NavBar />
      <header className="px-6 py-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold text-white">AgentOS</h1>
          <p className="mt-1 text-sm opacity-70">Control plane for Hermes Agent</p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <p className="opacity-70">Loading agents…</p>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
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

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <NavBar />
      <div className="flex-1 flex flex-col items-center justify-center">
        <h1 className="text-3xl font-bold mb-6">System Status</h1>
        {error && <p className="text-red-400">Error: {error}</p>}
        {healthData ? (
          <pre className="bg-[var(--surface)] p-4 rounded-lg">
            {JSON.stringify(healthData, null, 2)}
          </pre>
        ) : (
          <p>Loading…</p>
        )}
        <div className="mt-8">
          <Link to="/" className="text-[var(--accent)] underline">
            ← Back to dashboard
          </Link>
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
    whatsapp: 'bg-green-600 text-white',
    discord: 'bg-indigo-600 text-white',
    telegram: 'bg-cyan-600 text-white',
    api_server: 'bg-amber-500 text-black',
    webhook: 'bg-rose-600 text-white',
    tui: 'bg-slate-600 text-white',
    cli: 'bg-slate-600 text-white',
    cron: 'bg-slate-600 text-white',
    homeassistant: 'bg-slate-600 text-white',
    subagent: 'bg-slate-600 text-white',
  }
  return map[source.toLowerCase()] || 'bg-slate-600 text-white'
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
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <NavBar />
      <header className="px-6 pt-8 pb-4">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold text-white">Sessions</h1>
          <p className="text-sm opacity-70 mt-1">Conversation history</p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-12">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            type="text"
            placeholder="Search by title..."
            value={rawSearch}
            onChange={(e) => {
              setRawSearch(e.target.value)
              // Reset offset on search change
              const params = new URLSearchParams(searchParams)
              params.delete('offset')
              setSearchParams(params)
            }}
            className="rounded-md bg-[var(--surface)] border border-[var(--surface)] px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] w-full sm:w-72"
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
            className="rounded-md bg-[var(--surface)] border border-[var(--surface)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            <option value="">All (source)</option>
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
            className="rounded-md bg-[var(--surface)] border border-[var(--surface)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            <option value="">All (model)</option>
            {modelList?.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        {isLoading && <p className="opacity-70">Loading sessions…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 mb-4">
            Error: {(error as Error).message}
          </div>
        )}
        {data && (
          <>
            <div className="overflow-x-auto rounded-lg border border-[var(--surface)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface)]/60 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Model</th>
                    <th className="px-4 py-3 font-medium text-right">Messages</th>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--surface)]">
                  {data.sessions.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/sessions/${encodeURIComponent(s.id)}`)}
                      className="cursor-pointer hover:bg-[var(--surface)]/40 transition"
                    >
                      <td className="px-4 py-3 text-white truncate max-w-xs">
                        {s.title || 'Untitled'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${sourceBadge(s.source)}`}>
                          {sourceLabel(s.source)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs opacity-80">{s.model}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.message_count}</td>
                      <td className="px-4 py-3 tabular-nums">{formatStartedAt(s.started_at)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatDuration(s.duration_seconds)}</td>
                    </tr>
                  ))}
                  {data.sessions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center opacity-60">
                        No sessions found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-sm">
              <button
                onClick={() => handlePage(offset - limit)}
                disabled={offset === 0}
                className="px-3 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--surface)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--surface)]/80 transition"
              >
                Previous
              </button>
              <span className="opacity-70">
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                onClick={() => handlePage(offset + limit)}
                disabled={!data || offset + limit >= data.total}
                className="px-3 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--surface)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--surface)]/80 transition"
              >
                Next
              </button>
            </div>
          </>
        )}
      </main>
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
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <button
          onClick={() => navigate('/sessions')}
          className="mb-4 text-sm text-[var(--accent)] hover:underline"
        >
          ← Back to sessions
        </button>

        {isLoading && <p className="opacity-70">Loading session…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Error: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <h1 className="text-2xl font-bold text-white mb-1">
              {data.title || 'Untitled'}
            </h1>
            <div className="flex items-center gap-2 mb-6">
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${sourceBadge(data.source)}`}>
                {sourceLabel(data.source)}
              </span>
              <span className="font-mono text-xs opacity-70">{data.model}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">ID</p>
                <p className="font-mono text-sm text-white break-all">{data.id}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Chat Type</p>
                <p className="text-sm text-white">{data.chat_type || '-'}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Started</p>
                <p className="text-sm text-white">{data.started_at ? new Date(data.started_at).toLocaleString() : '-'}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Ended</p>
                <p className="text-sm text-white">{data.ended_at ? new Date(data.ended_at).toLocaleString() : 'Running'}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Duration</p>
                <p className="text-sm text-white">{formatDuration(data.duration_seconds)}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Messages / Tool Calls</p>
                <p className="text-sm text-white">{data.message_count} / {data.tool_call_count}</p>
              </div>
              {data.archived && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                  <p className="text-xs text-amber-400 mb-1">Archived</p>
                  <p className="text-sm text-white">This session is archived.</p>
                </div>
              )}
              {data.snippet && (
                <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4 sm:col-span-2">
                  <p className="text-xs opacity-60 mb-1">Snippet</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{data.snippet}</p>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-6 text-center">
              <p className="text-lg font-semibold text-white mb-1">Messages</p>
              <p className="text-sm opacity-60">Coming soon — Phase 3</p>
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
      </Routes>
    </QueryClientProvider>
  )
}
