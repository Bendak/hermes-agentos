import { useEffect, useRef, useState } from 'react'
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
          <Link to="/tasks" className="text-[var(--text)] hover:text-white transition">
            Tasks
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
        className="text-xs italic opacity-50 hover:opacity-80 transition"
      >
        {expanded ? 'Hide thinking…' : 'Thinking…'}
      </button>
      {expanded && (
        <div className="mt-1 text-xs italic opacity-60 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  )
}

function ToolMessage({ msg }: { msg: MessageItem }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="w-full my-2 border border-[var(--surface)] rounded-lg bg-transparent">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-[var(--text)] hover:bg-[var(--surface)]/40 transition"
      >
        <span className="flex items-center gap-2">
          <span className="inline-block rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            Tool
          </span>
          <span className="opacity-80">{msg.tool_name || 'unknown'}</span>
        </span>
        <span className="opacity-50">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <pre className="px-3 py-2 text-xs font-mono text-[var(--text)] overflow-auto max-h-96 whitespace-pre-wrap border-t border-[var(--surface)]">
          {msg.content || ''}
        </pre>
      )}
    </div>
  )
}

function UserMessage({ msg }: { msg: MessageItem }) {
  return (
    <div className="flex flex-col items-end my-2 max-w-[80%] self-end">
      <div className="bg-[var(--accent)]/20 rounded-2xl rounded-br-sm px-4 py-2 text-sm text-white">
        {msg.content || ''}
      </div>
      <span className="text-[10px] opacity-40 mt-1">{formatMessageTime(msg.timestamp)}</span>
    </div>
  )
}

function AssistantMessage({ msg }: { msg: MessageItem }) {
  return (
    <div className="flex flex-col items-start my-2 max-w-[80%]">
      {msg.reasoning_content && <ReasoningBlock content={msg.reasoning_content} />}
      <div className="bg-[var(--surface)]/60 rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-white">
        {msg.content || ''}
      </div>
      <span className="text-[10px] opacity-40 mt-1">{formatMessageTime(msg.timestamp)}</span>
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

  if (isLoading) return <p className="opacity-70 py-6">Loading messages…</p>
  if (error) return <p className="text-red-400 text-sm py-4">Error: {(error as Error).message}</p>
  if (!data || data.messages.length === 0) return <p className="opacity-60 py-6">No messages in this session</p>

  return (
    <div className="flex flex-col">
      {canLoadMore && (
        <div className="flex justify-center py-3">
          <button
            onClick={handleLoadMore}
            className="px-4 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--surface)] text-sm text-white hover:bg-[var(--surface)]/80 transition"
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

            <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
              <p className="text-lg font-semibold text-white mb-3">Messages</p>
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
  { status: 'todo', label: 'Backlog', accent: 'border-l-slate-500', header: 'border-slate-500/50', badge: 'bg-slate-500/20 text-slate-400' },
  { status: 'ready', label: 'Ready', accent: 'border-l-blue-500', header: 'border-blue-500/50', badge: 'bg-blue-500/20 text-blue-400' },
  { status: 'running', label: 'Running', accent: 'border-l-amber-500', header: 'border-amber-500/50', badge: 'bg-amber-500/20 text-amber-400' },
  { status: 'done', label: 'Done', accent: 'border-l-green-500', header: 'border-green-500/50', badge: 'bg-green-500/20 text-green-400' },
  { status: 'blocked', label: 'Blocked', accent: 'border-l-red-500', header: 'border-red-500/50', badge: 'bg-red-500/20 text-red-400' },
]

function columnForStatus(status: string): string {
  const known = ['todo', 'ready', 'running', 'done', 'blocked']
  return known.includes(status) ? status : 'todo'
}

function assigneeBadgeClass(assignee: string | null): string {
  const map: Record<string, string> = {
    nexus: 'bg-purple-600 text-white',
    atlas: 'bg-blue-600 text-white',
    coder: 'bg-emerald-600 text-white',
    pixel: 'bg-pink-600 text-white',
    nova: 'bg-orange-600 text-white',
  }
  return map[assignee?.toLowerCase() || ''] || 'bg-slate-600 text-white'
}

function priorityDotClass(priority: number | null): string {
  const map: Record<number, string> = {
    0: 'bg-red-500',
    1: 'bg-amber-500',
    2: 'bg-blue-500',
    3: 'bg-slate-500',
  }
  return map[priority ?? 3] || 'bg-slate-500'
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
      onClick={() => navigate(`/tasks/${encodeURIComponent(task.id)}`)}
      className={`mb-3 cursor-pointer rounded-lg border border-[var(--surface)] bg-[var(--surface)]/40 p-3 transition hover:bg-[var(--surface)]/70 hover:shadow-md border-l-4 ${COLUMN_META.find((c) => c.status === columnForStatus(task.status))?.accent || 'border-l-slate-500'}`}
    >
      <h4 className="text-sm font-medium text-white line-clamp-2 leading-snug mb-2">
        {task.title || 'Untitled'}
      </h4>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {task.assignee && (
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${assigneeBadgeClass(task.assignee)}`}>
            {task.assignee}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text)] opacity-70">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${priorityDotClass(task.priority)}`} />
          {priorityLabel(task.priority)}
        </span>
        {task.run_count > 0 && (
          <span className="text-[10px] text-[var(--text)] opacity-60">
            {task.run_count} run{task.run_count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--text)] opacity-50">{task.created_date}</span>
        {task.comment_count > 0 && (
          <span className="text-[10px] text-[var(--text)] opacity-50">
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
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${meta.badge}`}>
          {tasks.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-12rem)] pr-1">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {tasks.length === 0 && (
          <p className="text-xs text-[var(--text)] opacity-40 text-center py-6">No tasks</p>
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
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <NavBar />
      <header className="px-6 pt-8 pb-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Kanban Board</h1>
            <p className="text-sm opacity-70 mt-1">Task pipeline</p>
          </div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="rounded-md bg-[var(--surface)] border border-[var(--surface)] px-3 py-1.5 text-sm text-white hover:bg-[var(--surface)]/80 transition"
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-12">
        {isLoading && <p className="opacity-70">Loading tasks…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 mb-4">
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
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-500/30">
                  <h3 className="text-sm font-semibold text-slate-400">Archived</h3>
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-slate-500/20 text-slate-400">
                    {archivedTasks.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {archivedTasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
                {archivedTasks.length === 0 && (
                  <p className="text-xs text-[var(--text)] opacity-40 text-center py-6">No archived tasks</p>
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
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <NavBar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <button
          onClick={() => navigate('/tasks')}
          className="mb-4 text-sm text-[var(--accent)] hover:underline"
        >
          ← Back to tasks
        </button>

        {isLoading && <p className="opacity-70">Loading task…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Error: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <h1 className="text-2xl font-bold text-white mb-2">{data.title || 'Untitled'}</h1>
            <div className="flex flex-wrap items-center gap-2 mb-6">
              {data.assignee && (
                <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${assigneeBadgeClass(data.assignee)}`}>
                  {data.assignee}
                </span>
              )}
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-[var(--surface)] text-[var(--text)] border border-[var(--surface)]">
                {data.status}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-[var(--text)] opacity-70">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${priorityDotClass(data.priority)}`} />
                {priorityLabel(data.priority)}
              </span>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">ID</p>
                <p className="font-mono text-sm text-white break-all">{data.id}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Created by</p>
                <p className="text-sm text-white">{data.created_by || '-'}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Created at</p>
                <p className="text-sm text-white">{formatIso(data.created_at)}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Started at</p>
                <p className="text-sm text-white">{formatIso(data.started_at)}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Completed at</p>
                <p className="text-sm text-white">{formatIso(data.completed_at)}</p>
              </div>
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                <p className="text-xs opacity-60 mb-1">Workspace</p>
                <p className="text-sm text-white font-mono">{data.workspace_kind || '-'} {data.workspace_path ? `(${data.workspace_path})` : ''}</p>
              </div>
              {data.session_id && (
                <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                  <p className="text-xs opacity-60 mb-1">Session</p>
                  <p className="text-sm text-white font-mono break-all">{data.session_id}</p>
                </div>
              )}
              {data.project_id && (
                <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
                  <p className="text-xs opacity-60 mb-1">Project</p>
                  <p className="text-sm text-white">{data.project_id}</p>
                </div>
              )}
            </div>

            {/* Body */}
            {data.body && (
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4 mb-8">
                <p className="text-xs opacity-60 mb-2">Body</p>
                <pre className="text-sm text-white whitespace-pre-wrap font-sans">{data.body}</pre>
              </div>
            )}

            {/* Links */}
            {(data.parent_id || data.children.length > 0) && (
              <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4 mb-8">
                <p className="text-xs opacity-60 mb-2">Links</p>
                {data.parent_id && (
                  <div className="mb-1 text-sm">
                    <span className="opacity-60">Parent:</span>{' '}
                    <button
                      onClick={() => navigate(`/tasks/${encodeURIComponent(data.parent_id!)}`)}
                      className="text-[var(--accent)] hover:underline font-mono"
                    >
                      {data.parent_id}
                    </button>
                  </div>
                )}
                {data.children.length > 0 && (
                  <div className="text-sm">
                    <span className="opacity-60">Children:</span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {data.children.map((childId) => (
                        <button
                          key={childId}
                          onClick={() => navigate(`/tasks/${encodeURIComponent(childId)}`)}
                          className="text-[var(--accent)] hover:underline font-mono text-xs bg-[var(--bg)] px-2 py-1 rounded border border-[var(--surface)]"
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
            <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4 mb-8">
              <p className="text-lg font-semibold text-white mb-3">Runs ({data.runs.length})</p>
              {data.runs.length === 0 && <p className="text-sm opacity-60">No runs recorded.</p>}
              {data.runs.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--surface)]/60 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">Step</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Profile</th>
                        <th className="px-3 py-2 font-medium">Started</th>
                        <th className="px-3 py-2 font-medium">Ended</th>
                        <th className="px-3 py-2 font-medium">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--surface)]">
                      {data.runs.map((run) => (
                        <tr key={run.id} className="hover:bg-[var(--surface)]/40 transition">
                          <td className="px-3 py-2 text-white font-mono text-xs">{run.step_key || '-'}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${run.status === 'done' ? 'bg-green-500/20 text-green-400' : run.status === 'running' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-400'}`}>
                              {run.status}
                            </span>
                          </td>
                          <td className="px-3 py-2">{run.profile || '-'}</td>
                          <td className="px-3 py-2 tabular-nums">{formatIso(run.started_at)}</td>
                          <td className="px-3 py-2 tabular-nums">{formatIso(run.ended_at)}</td>
                          <td className="px-3 py-2 max-w-xs truncate">{run.outcome || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.runs.some((r) => r.summary) && (
                <div className="mt-4 space-y-3">
                  {data.runs.filter((r) => r.summary).map((run) => (
                    <div key={`summary-${run.id}`} className="rounded border border-[var(--surface)] bg-[var(--bg)]/40 p-3">
                      <p className="text-xs font-mono text-[var(--accent)] mb-1">Run {run.id} — {run.step_key || '?'}</p>
                      <p className="text-sm text-white whitespace-pre-wrap">{run.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="rounded-lg border border-[var(--surface)] bg-[var(--surface)]/30 p-4">
              <p className="text-lg font-semibold text-white mb-3">Comments ({data.comments.length})</p>
              {data.comments.length === 0 && <p className="text-sm opacity-60">No comments.</p>}
              {data.comments.length > 0 && (
                <div className="space-y-3">
                  {data.comments.map((comment) => (
                    <div key={comment.id} className="rounded border border-[var(--surface)] bg-[var(--bg)]/40 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-white">{comment.author}</span>
                        <span className="text-[10px] text-[var(--text)] opacity-50">{formatIso(comment.created_at)}</span>
                      </div>
                      <p className="text-sm text-white whitespace-pre-wrap">{comment.body}</p>
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
