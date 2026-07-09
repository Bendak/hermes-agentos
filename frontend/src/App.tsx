import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DndContext, DragOverlay, useDroppable, closestCorners, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import '@xyflow/react/dist/style.css'
import { ReactFlow, Handle, Position, Controls, Background, type NodeProps, type Node, type Connection, addEdge, useNodesState, useEdgesState, BackgroundVariant } from '@xyflow/react'

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
  metadata: string | null
  error: string | null
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

interface Skill {
  slug: string
  name: string
  description: string
  category: string
  icon: string
  file_count: number
  preview: string
  has_references: boolean
  has_scripts: boolean
  has_templates: boolean
  profiles: string[]
}

interface SkillDetail extends Skill {
  full_content: string
  files: { path: string; size: number }[]
}

interface Workflow {
  id: string
  name: string
  description: string
  nodes: string  // JSON string from backend
  edges: string  // JSON string from backend
  created_at: string
  updated_at: string
}

interface WorkflowNodeData {
  label: string
  nodeType: 'trigger' | 'action' | 'condition'
  config?: Record<string, any>
  runStatus?: string
}

/* ── NavBar ────────────────────────────────────────── */

function NavBar() {
  const onOpenSearch = useOpenSearch()
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('agentos-theme') as 'dark' | 'light') || 'dark'
    }
    return 'dark'
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('agentos-theme', theme)
  }, [theme])

  const navLink = (to: string, label: string, closeMobile?: () => void) => {
    const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to))
    return (
      <Link
        to={to}
        onClick={() => { setMobileMenuOpen(false); closeMobile?.() }}
        className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition duration-200 ease-agent-os ${
          active ? 'text-accent bg-accent-subtle' : 'text-text-secondary hover:text-text-primary hover:bg-surface/60'
        }`}
      >
        {label}
        {active && (
          <span className="absolute bottom-[-13px] left-1 right-1 h-[2px] bg-accent rounded-full shadow-glow hidden sm:block" />
        )}
      </Link>
    )
  }

  return (
    <>
      <nav className="bg-bg-elevated/80 backdrop-blur-md border-b border-border px-4 sm:px-6 py-3 sticky top-0 z-50">
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2 text-text-primary font-bold text-lg tracking-tight group shrink-0">
              <img src={theme === 'light' ? '/logo-light.svg' : '/logo.svg'} alt="AgentOS" className="h-7 w-auto" />
            </Link>
            {/* Desktop nav links */}
            <div className="hidden sm:flex items-center gap-1 ml-2">
              {navLink('/', 'Dashboard')}
              {navLink('/sessions', 'Sessions')}
              {navLink('/tasks', 'Tasks')}
              {navLink('/config', 'Config')}
              {navLink('/skills', 'Skills')}
              {navLink('/workflows', 'Workflows')}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Search shortcut hint (desktop only) */}
            {onOpenSearch && (
              <button
                onClick={onOpenSearch}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-text-tertiary hover:text-text-secondary hover:bg-surface/60 transition-colors border border-border"
                title="Quick search (⌘K)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span className="hidden lg:inline">Search…</span>
                <kbd className="hidden lg:inline text-[10px] font-mono bg-bg-base border border-border rounded px-1 py-0.5 ml-1">⌘K</kbd>
              </button>
            )}
            {/* Theme toggle */}
            <button
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface/60 transition-colors"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {/* Mobile hamburger */}
            <button
              className="sm:hidden p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface/60 transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>
      </nav>
      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="sm:hidden border-b border-border bg-bg-elevated/95 backdrop-blur-md px-4 py-3 sticky top-[53px] z-40">
          <div className="flex flex-col gap-1">
            {navLink('/', 'Dashboard')}
            {navLink('/sessions', 'Sessions')}
            {navLink('/tasks', 'Tasks')}
            {navLink('/config', 'Config')}
            {navLink('/skills', 'Skills')}
            {navLink('/workflows', 'Workflows')}
            {onOpenSearch && (
              <button
                onClick={() => { setMobileMenuOpen(false); onOpenSearch() }}
                className="px-3 py-1.5 text-sm font-medium rounded-md text-text-secondary hover:text-text-primary hover:bg-surface/60 text-left transition-colors"
              >
                🔍 Search
              </button>
            )}
          </div>
        </div>
      )}
    </>
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
      className="card-focus rounded-xl border border-border bg-surface/40 p-5 transition hover:bg-surface-hover/70 hover:shadow-md hover-shadow-enhanced cursor-pointer"
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
              className="search-input rounded-md bg-bg-elevated border border-border px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-72"
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

/* ── Run Metadata Display ──────────────────────────── */

function RunMetadata({ meta }: { meta: Record<string, any> }) {
  return (
    <div className="space-y-2 text-sm">
      {meta.artifacts_produced && Array.isArray(meta.artifacts_produced) && (
        <div>
          <span className="text-text-tertiary">Artifacts:</span>
          <ul className="ml-4 mt-1 space-y-1">
            {meta.artifacts_produced.map((a: string, i: number) => (
              <li key={i} className="text-text-secondary flex items-center gap-2">
                <span>📄</span> {a}
              </li>
            ))}
          </ul>
        </div>
      )}
      {meta.gaps && Array.isArray(meta.gaps) && (
        <div>
          <span className="text-warning">Gaps:</span>
          <ul className="ml-4 mt-1 space-y-1">
            {meta.gaps.map((g: string, i: number) => (
              <li key={i} className="text-warning/80">⚠️ {g}</li>
            ))}
          </ul>
        </div>
      )}
      {meta.acceptance_met !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-text-tertiary">Acceptance:</span>
          <span className={meta.acceptance_met ? 'text-success' : 'text-error'}>
            {meta.acceptance_met ? '✅ Met' : '❌ Not met'}
          </span>
        </div>
      )}
      {meta.modules && Array.isArray(meta.modules) && (
        <div>
          <span className="text-text-tertiary">Modules:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {meta.modules.map((m: string, i: number) => (
              <span key={i} className="px-2 py-0.5 rounded bg-accent/10 text-accent text-xs">{m}</span>
            ))}
          </div>
        </div>
      )}
      {Object.entries(meta).filter(([k]) => !['artifacts_produced', 'gaps', 'acceptance_met', 'modules'].includes(k)).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-text-tertiary">{k}:</span>
          <span className="text-text-secondary">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Markdown Renderer ─────────────────────────────── */

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="max-w-full overflow-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => <p className="text-sm leading-relaxed mb-2 max-w-full" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{children}</p>,
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
                <pre className="bg-bg-elevated rounded-md p-3 overflow-x-auto max-h-96 mb-2 text-mono-sm max-w-full">
                  <code className={className}>{children}</code>
                </pre>
              )
            }
            return (
              <code className="bg-surface rounded px-1 py-0.5 text-mono-sm text-accent break-all">
                {children}
              </code>
            )
          },
          table: ({ children }) => (
            <div className="overflow-x-auto max-w-full mb-2">
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
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide reasoning' : 'Show reasoning'}
        className="text-caption text-text-tertiary italic hover:text-text-secondary transition"
      >
        {expanded ? 'Hide thinking…' : 'Thinking…'}
      </button>
      {expanded && (
        <div className="mt-1 text-caption text-text-tertiary italic whitespace-pre-wrap max-w-full w-full">
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
        <div className="px-3 py-2 border-t border-border max-h-96 max-w-full w-full" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
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
        className="bg-accent-subtle rounded-2xl rounded-br-sm px-4 py-2 text-sm text-accent w-full"
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
        className="bg-surface/60 rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-text-primary w-full"
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

const ALL_STATUSES = ['todo', 'ready', 'running', 'done', 'blocked', 'archived']
const ALL_ASSIGNEES = ['coder', 'pixel', 'atlas', 'nova', 'nexus']
const ALL_PRIORITIES = [0, 1, 2, 3]

function columnForStatus(status: string): string {
  const known = ['todo', 'ready', 'running', 'done', 'blocked']
  return known.includes(status) ? status : 'todo'
}

/* ── Task Editor Modal ─────────────────────────────── */

function TaskEditorModal({ task, onClose, onSaved }: {
  task?: TaskItem | TaskDetail
  onClose: () => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const isCreate = !task
  const [title, setTitle] = useState(task?.title || '')
  const [body, setBody] = useState(task?.body || '')
  const [assignee, setAssignee] = useState(task?.assignee || 'coder')
  const [priority, setPriority] = useState(task?.priority ?? 2)
  const [status, setStatus] = useState(task?.status || 'todo')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = isCreate ? '/api/tasks' : `/api/tasks/${encodeURIComponent(task!.id)}`
      const method = isCreate ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, assignee: assignee || null, priority, status }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onMutate: () => { setSaving(true); setError(null) },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      if (task) queryClient.invalidateQueries({ queryKey: ['task', task.id] })
      onSaved()
      onClose()
    },
    onError: (err: Error) => { setError(err.message); setSaving(false) },
  })

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className={expanded ? 'fixed inset-0 z-[60] bg-bg-elevated overflow-y-auto' : 'fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm'}
      onClick={expanded ? undefined : onClose}
    >
      <div
        className={expanded ? 'min-h-screen p-6' : 'w-full max-w-2xl rounded-xl border border-border bg-bg-elevated shadow-2xl max-h-[90vh] overflow-y-auto'}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? 'Create task' : 'Edit task'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-elevated z-10">
          <h2 className="text-h3 font-bold text-text-primary">{isCreate ? 'New Task' : 'Edit Task'}</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 text-text-tertiary hover:text-text-secondary transition-colors"
              title={expanded ? 'Restore' : 'Maximize'}
            >
              {expanded ? '❐' : '⬜'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface/60 transition" aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-caption text-text-secondary mb-1.5 font-medium">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
              placeholder="Task title…"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-caption text-text-secondary mb-1.5 font-medium">Body (Markdown)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none transition resize-y"
              placeholder="## Objective&#10;Describe the task…"
            />
          </div>

          {/* Grid: assignee, status, priority */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-caption text-text-secondary mb-1.5 font-medium">Assignee</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
              >
                <option value="">Unassigned</option>
                {ALL_ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1.5 font-medium">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
              >
                {ALL_STATUSES.filter((s) => s !== 'archived').map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1.5 font-medium">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
              >
                {ALL_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{priorityLabel(p)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Task ID */}
          {task && (
            <div className="pt-2">
              <p className="text-caption text-text-tertiary font-mono">ID: {task.id}</p>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-error/30 bg-error-subtle px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-bg-elevated">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface/60 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saving || !title.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm text-white font-medium hover:bg-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : (isCreate ? 'Create Task' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Filter Bar ────────────────────────────────────── */

interface FilterState {
  search: string
  assignee: string
  priority: string
  status: string
}

function FilterBar({ filters, onChange, stats }: {
  filters: FilterState
  onChange: (f: FilterState) => void
  stats?: { total: number; by_status?: Record<string, number>; by_assignee?: Record<string, number> }
}) {
  const selectClass = "rounded-md border border-border bg-bg-base px-2.5 py-1.5 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition cursor-pointer"

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search tasks…"
          className="w-full rounded-md border border-border bg-bg-base pl-9 pr-3 py-1.5 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>

      {/* Assignee filter */}
      <select
        value={filters.assignee}
        onChange={(e) => onChange({ ...filters, assignee: e.target.value })}
        className={selectClass}
        title="Filter by assignee"
      >
        <option value="">All assignees</option>
        {ALL_ASSIGNEES.map((a) => (
          <option key={a} value={a}>
            {a}{stats?.by_assignee?.[a] ? ` (${stats.by_assignee[a]})` : ''}
          </option>
        ))}
      </select>

      {/* Priority filter */}
      <select
        value={filters.priority}
        onChange={(e) => onChange({ ...filters, priority: e.target.value })}
        className={selectClass}
        title="Filter by priority"
      >
        <option value="">All priorities</option>
        {ALL_PRIORITIES.map((p) => (
          <option key={p} value={String(p)}>{priorityLabel(p)}</option>
        ))}
      </select>

      {/* Status filter (column highlight) */}
      <select
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
        className={selectClass}
        title="Filter by status"
      >
        <option value="">All statuses</option>
        {ALL_STATUSES.filter((s) => s !== 'archived').map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Clear */}
      {(filters.search || filters.assignee || filters.priority || filters.status) && (
        <button
          onClick={() => onChange({ search: '', assignee: '', priority: '', status: '' })}
          className="text-caption text-text-tertiary hover:text-text-primary transition px-2"
        >
          Clear filters
        </button>
      )}

      {/* Total count badge */}
      {stats && (
        <span className="ml-auto text-caption text-text-tertiary">
          {stats.total} task{stats.total === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
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

function TaskCard({ task, isOverlay, onEdit }: { task: TaskItem; isOverlay?: boolean; onEdit?: (task: TaskItem) => void }) {
  const navigate = useNavigate()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging && !isOverlay ? 0.25 : 1,
  }

  const handleClick = (_e: React.MouseEvent) => {
    // DnD kit activationConstraint handles click vs drag; navigation is allowed here.
    navigate(`/tasks/${encodeURIComponent(task.id)}`)
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit?.(task)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      tabIndex={0}
      role="button"
      aria-label={`Task ${task.title || 'Untitled'}. Priority ${priorityLabel(task.priority)}. Assignee ${task.assignee || 'unassigned'}. ${task.run_count} runs. ${task.comment_count} comments.`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/tasks/${encodeURIComponent(task.id)}`)
        }
      }}
      className={`card-focus mb-3 cursor-pointer rounded-lg border border-border bg-surface/40 p-3 transition hover:bg-surface-hover/70 hover:shadow-md hover-shadow-enhanced border-l-4 ${COLUMN_META.find((c) => c.status === columnForStatus(task.status))?.accent || 'border-l-text-tertiary'} ${isOverlay ? 'shadow-lg rotate-1' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-body-sm font-medium text-text-primary line-clamp-2 leading-snug flex-1 prose-kanban-card">
          <MarkdownRenderer content={task.title || 'Untitled'} />
        </div>
        {onEdit && !isOverlay && (
          <button
            onClick={handleEditClick}
            className="shrink-0 p-1 rounded text-text-tertiary hover:text-accent hover:bg-surface/60 transition opacity-0 group-hover:opacity-100"
            aria-label="Edit task"
            title="Edit task"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        )}
      </div>
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

function KanbanColumn({ label, status, tasks, onEdit }: { label: string; status: string; tasks: TaskItem[]; onEdit?: (task: TaskItem) => void }) {
  const meta = COLUMN_META.find((c) => c.status === status) || COLUMN_META[0]
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div className="flex flex-col min-w-[16rem] max-w-[20rem] flex-1">
      <div className={`flex items-center justify-between mb-3 pb-2 border-b ${meta.header}`}>
        <h3 className="text-body-sm font-semibold text-text-primary">{label}</h3>
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${meta.badge}`}>
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto max-h-[calc(100vh-12rem)] pr-1 rounded-lg transition ${isOver ? 'bg-accent/10 ring-1 ring-accent/30' : ''}`}
      >
        {tasks.map((task) => (
          <div key={task.id} className="group">
            <TaskCard task={task} onEdit={onEdit} />
          </div>
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
  const [draggedTask, setDraggedTask] = useState<TaskItem | null>(null)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [filters, setFilters] = useState<FilterState>({ search: '', assignee: '', priority: '', status: '' })
  const queryClient = useQueryClient()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const { data, isLoading, error } = useQuery<TaskItem[]>({
    queryKey: ['tasks', 'all'],
    queryFn: async () => {
      const res = await fetch('/api/tasks?include_archived=true&limit=500')
      if (!res.ok) throw new Error('Failed to load tasks')
      return res.json()
    },
    refetchInterval: 10000,
  })

  const { data: stats } = useQuery<{ total: number; by_status: Record<string, number>; by_assignee: Record<string, number>; by_priority: Record<string, number>; recent_done_7d: number }>({
    queryKey: ['kanban', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/kanban/stats')
      if (!res.ok) throw new Error('Failed to load stats')
      return res.json()
    },
    refetchInterval: 15000,
  })

  const updateMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', 'all'] })
      const previousTasks = queryClient.getQueryData<TaskItem[]>(['tasks', 'all'])
      queryClient.setQueryData<TaskItem[]>(['tasks', 'all'], (old) => {
        if (!old) return old
        return old.map((t) => (t.id === taskId ? { ...t, status } : t))
      })
      return { previousTasks }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks', 'all'], context.previousTasks)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      queryClient.invalidateQueries({ queryKey: ['kanban', 'stats'] })
    },
  })

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const task = data?.find((t) => t.id === active.id)
    if (task) setDraggedTask(task)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setDraggedTask(null)
    if (!over) return
    const taskId = active.id as string
    const newStatus = over.id as string
    const task = data?.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return
    updateMutation.mutate({ taskId, status: newStatus })
  }

  // Apply client-side filters
  const filterTask = (t: TaskItem): boolean => {
    if (filters.search) {
      const q = filters.search.toLowerCase()
      if (!(t.title || '').toLowerCase().includes(q) && !(t.body || '').toLowerCase().includes(q))
        return false
    }
    if (filters.assignee && t.assignee !== filters.assignee) return false
    if (filters.priority && String(t.priority) !== filters.priority) return false
    if (filters.status && columnForStatus(t.status) !== filters.status) return false
    return true
  }

  const activeTasks = (data?.filter((t) => t.status !== 'archived') || []).filter(filterTask)
  const archivedTasks = (data?.filter((t) => t.status === 'archived') || []).filter(filterTask)

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
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors text-sm font-medium"
            >
              <span>+</span> New Task
            </button>
            {stats && (
              <div className="hidden sm:flex items-center gap-4 text-caption text-text-tertiary">
                <span title="Total active tasks">{stats.total} total</span>
                <span title="Completed in last 7 days" className="text-success">{stats.recent_done_7d} done/7d</span>
              </div>
            )}
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="rounded-md bg-surface border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover/80 transition"
            >
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-12">
        {/* Filter bar */}
        {data && (
          <FilterBar filters={filters} onChange={setFilters} stats={stats} />
        )}

        {isLoading && <p className="text-text-secondary">Loading tasks…</p>}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-subtle px-4 py-3 text-sm text-error mb-4">
            Error: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-4 overflow-x-auto pb-4">
                {columns.map((col) => (
                  <KanbanColumn
                    key={col.status}
                    label={col.label}
                    status={col.status}
                    tasks={col.tasks}
                    onEdit={setEditingTask}
                  />
                ))}
              </div>
              <DragOverlay>
                {draggedTask ? (
                  <div className="opacity-90">
                    <TaskCard task={draggedTask} isOverlay />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

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

      {/* Task Editor Modal (create mode) */}
      {createModalOpen && (
        <TaskEditorModal
          onClose={() => setCreateModalOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['kanban', 'stats'] })
          }}
        />
      )}

      {/* Task Editor Modal (edit mode) */}
      {editingTask && (
        <TaskEditorModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['kanban', 'stats'] })
          }}
        />
      )}
    </div>
  )
}

/* ── Task Detail Page ──────────────────────────────── */

function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'runs' | 'comments' | 'children'>('overview')
  const [showEditModal, setShowEditModal] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('agentos')
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set())

  const toggleRun = (runId: number) => {
    setExpandedRuns(prev => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }

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

  // Fetch child task titles for richer display
  const childIds = data?.children || []
  const { data: childTasks } = useQuery<TaskItem[]>({
    queryKey: ['tasks', 'children', childIds],
    queryFn: async () => {
      if (childIds.length === 0) return []
      const res = await fetch('/api/tasks?include_archived=true&limit=500')
      if (!res.ok) return []
      const all: TaskItem[] = await res.json()
      return all.filter((t) => childIds.includes(t.id))
    },
    enabled: childIds.length > 0,
    staleTime: 30000,
  })

  const addCommentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id!)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentText, author: commentAuthor }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      setCommentText('')
      queryClient.invalidateQueries({ queryKey: ['task', id] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
    },
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
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate('/tasks')}
            className="text-body-sm text-accent hover:underline"
          >
            ← Back to tasks
          </button>
          {data && (
            <button
              onClick={() => setShowEditModal(true)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-white font-medium hover:bg-accent-hover transition flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
          )}
        </div>

        {isLoading && <p className="text-text-secondary">Loading task…</p>}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error-subtle px-4 py-3 text-sm text-error">
            Error: {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <div className="text-h2 font-bold text-text-primary mb-2 prose-kanban-card">
              <MarkdownRenderer content={data.title || 'Untitled'} />
            </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-border mb-6" data-testid="task-detail-tabs">
              {[
                { key: 'overview' as const, label: 'Overview' },
                { key: 'runs' as const, label: `Runs (${data.runs.length})` },
                { key: 'comments' as const, label: `Comments (${data.comments.length})` },
                { key: 'children' as const, label: `Children (${data.children.length})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  data-testid={`tab-${tab.key}`}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium transition duration-200 ${
                    activeTab === tab.key
                      ? 'bg-surface text-text-primary border-b-2 border-accent'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {activeTab === 'overview' && (
              <div data-testid="tab-panel-overview">
                {data.body && (
                  <div className="rounded-lg border border-border bg-surface/30 p-4 mb-6">
                    <p className="text-caption text-text-tertiary mb-2">Body</p>
                    <div className="text-sm text-text-primary">
                      <MarkdownRenderer content={data.body} />
                    </div>
                  </div>
                )}
                {(data.parent_id || data.children.length > 0) && (
                  <div className="rounded-lg border border-border bg-surface/30 p-4 mb-6">
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
                {!data.body && !data.parent_id && data.children.length === 0 && (
                  <p className="text-body-sm text-text-tertiary">No additional details.</p>
                )}
              </div>
            )}

            {/* Runs tab */}
            {activeTab === 'runs' && (
              <div data-testid="tab-panel-runs" className="rounded-lg border border-border bg-surface/30 p-4">
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
                          <React.Fragment key={run.id}>
                            <tr
                              className="hover:bg-surface/40 transition cursor-pointer"
                              onClick={() => toggleRun(run.id)}
                            >
                              <td className="px-3 py-2 text-text-primary font-mono text-mono-sm">
                                <span className="text-text-tertiary mr-2 select-none">
                                  {expandedRuns.has(run.id) ? '▼' : '▶'}
                                </span>
                                {run.step_key || '-'}
                              </td>
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
                            {expandedRuns.has(run.id) && (
                              <tr>
                                <td colSpan={6} className="px-4 py-4 bg-bg-base/40">
                                  {/* Summary */}
                                  {run.summary && (
                                    <div className="mb-3">
                                      <h4 className="text-sm font-medium text-text-secondary mb-2">Summary</h4>
                                      <MarkdownRenderer content={run.summary} />
                                    </div>
                                  )}
                                  {/* Metadata */}
                                  {run.metadata && (() => {
                                    try {
                                      const meta = JSON.parse(run.metadata)
                                      return (
                                        <div className="mb-3">
                                          <h4 className="text-sm font-medium text-text-secondary mb-2">Details</h4>
                                          <RunMetadata meta={meta} />
                                        </div>
                                      )
                                    } catch { return null }
                                  })()}
                                  {/* Error */}
                                  {run.error && (
                                    <div className="rounded border border-error/30 bg-error-subtle p-3">
                                      <p className="text-sm font-medium text-error mb-1">Error</p>
                                      <pre className="text-xs text-error font-mono whitespace-pre-wrap">{run.error}</pre>
                                    </div>
                                  )}
                                  {/* Empty state */}
                                  {!run.summary && !run.metadata && !run.error && (
                                    <p className="text-sm text-text-tertiary italic">No additional details for this run.</p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Comments tab */}
            {activeTab === 'comments' && (
              <div data-testid="tab-panel-comments" className="rounded-lg border border-border bg-surface/30 p-4">
                {/* Comment form */}
                <div className="mb-4 pb-4 border-b border-border">
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={commentAuthor}
                      onChange={(e) => setCommentAuthor(e.target.value)}
                      placeholder="Author"
                      className="w-32 rounded-md border border-border bg-bg-base px-2.5 py-1.5 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
                    />
                    <button
                      onClick={() => addCommentMutation.mutate()}
                      disabled={!commentText.trim() || addCommentMutation.isPending}
                      className="ml-auto rounded-md bg-accent px-3 py-1.5 text-sm text-white font-medium hover:bg-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {addCommentMutation.isPending ? 'Posting…' : 'Add comment'}
                    </button>
                  </div>
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={3}
                    placeholder="Write a comment… (Markdown supported)"
                    className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition resize-y"
                  />
                  {addCommentMutation.isError && (
                    <p className="mt-2 text-sm text-error">{(addCommentMutation.error as Error).message}</p>
                  )}
                </div>

                {/* Comment list */}
                {data.comments.length === 0 && <p className="text-body-sm text-text-tertiary">No comments yet.</p>}
                {data.comments.length > 0 && (
                  <div className="space-y-3">
                    {data.comments.map((comment) => (
                      <div key={comment.id} className="rounded border border-border bg-bg-base/40 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-caption font-medium text-text-primary">{comment.author}</span>
                          <span className="text-caption text-text-tertiary">{formatIso(comment.created_at)}</span>
                        </div>
                        <div className="text-sm text-text-primary">
                          <MarkdownRenderer content={comment.body} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Children tab */}
            {activeTab === 'children' && (
              <div data-testid="tab-panel-children" className="rounded-lg border border-border bg-surface/30 p-4">
                {data.children.length === 0 && <p className="text-body-sm text-text-tertiary">No child tasks.</p>}
                {data.children.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.children.map((childId) => {
                      const childTask = childTasks?.find((t) => t.id === childId)
                      return (
                        <button
                          key={childId}
                          onClick={() => navigate(`/tasks/${encodeURIComponent(childId)}`)}
                          className="text-left rounded-lg border border-border bg-bg-base/40 p-4 hover:bg-surface/50 transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-mono text-xs text-accent">{childId}</p>
                            {childTask && (
                              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${childTask.status === 'done' ? 'bg-success-subtle text-success border border-success/20' : childTask.status === 'running' ? 'bg-warning-subtle text-warning border border-warning/20' : childTask.status === 'blocked' ? 'bg-error-subtle text-error border border-error/20' : 'bg-surface text-text-secondary border border-border'}`}>
                                {childTask.status}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-text-primary line-clamp-2">{childTask?.title || 'Untitled task'}</p>
                          {childTask?.assignee && (
                            <p className="text-caption text-text-tertiary mt-1">@{childTask.assignee}</p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Edit modal */}
      {data && showEditModal && (
        <TaskEditorModal
          task={data}
          onClose={() => setShowEditModal(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['task', id] })
            queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
            queryClient.invalidateQueries({ queryKey: ['kanban', 'stats'] })
          }}
        />
      )}
    </div>
  )
}

/* ── Config Viewer ─────────────────────────────────── */

function isEditableKey(key: string): boolean {
  const lower = key.toLowerCase()
  const protectedKeys = [
    'api_key', 'apikey', 'token', 'secret', 'password', 'pwd',
    'client_secret', 'access_token', 'refresh_token', 'basic_auth',
    'oauth', 'secrets', 'hermes_api_server_key', 'oauth_client_id',
  ]
  return !protectedKeys.some((p) => lower === p || lower.endsWith('_' + p) || lower.endsWith('.' + p))
}

function ConfigNode({
  name,
  value,
  depth,
  searchTerm,
  editMode,
  path,
  onChange,
}: {
  name: string
  value: any
  depth: number
  searchTerm: string
  editMode?: boolean
  path?: string
  onChange?: (path: string, value: any) => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)

  const matches = searchTerm === '' || name.toLowerCase().includes(searchTerm.toLowerCase())

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const children = Object.entries(value)
    const anyChildMatches = searchTerm === '' || children.some(([k]) => k.toLowerCase().includes(searchTerm.toLowerCase()))
    const shouldShow = matches || anyChildMatches

    if (!shouldShow) return null

    return (
      <div style={{ marginLeft: depth * 16 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-sm font-medium text-text-primary hover:text-accent transition-colors py-0.5"
        >
          <span className="text-text-tertiary w-3 inline-block">{expanded ? '▼' : '▶'}</span>
          <span>{name}</span>
          <span className="text-text-tertiary text-xs ml-1">{'{}'}</span>
        </button>
        {expanded &&
          children.map(([k, v]) => (
            <ConfigNode
              key={k}
              name={k}
              value={v}
              depth={depth + 1}
              searchTerm={searchTerm}
              editMode={editMode}
              path={path ? `${path}.${k}` : k}
              onChange={onChange}
            />
          ))}
      </div>
    )
  }

  if (Array.isArray(value)) {
    const shouldShow = matches || searchTerm === ''
    if (!shouldShow) return null

    return (
      <div style={{ marginLeft: depth * 16 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-sm font-medium text-text-primary hover:text-accent transition-colors py-0.5"
        >
          <span className="text-text-tertiary w-3 inline-block">{expanded ? '▼' : '▶'}</span>
          <span>{name}</span>
          <span className="text-text-tertiary text-xs ml-1">[{value.length}]</span>
        </button>
        {expanded &&
          value.map((item, idx) =>
            typeof item === 'object' && item !== null ? (
              <ConfigNode
                key={idx}
                name={`[${idx}]`}
                value={item}
                depth={depth + 1}
                searchTerm={searchTerm}
                editMode={editMode}
                path={`${path}[${idx}]`}
                onChange={onChange}
              />
            ) : (
              <div
                key={idx}
                style={{ marginLeft: (depth + 1) * 16 }}
                className="flex items-start gap-2 py-0.5 text-sm"
              >
                <span className="text-text-tertiary">[{idx}]</span>
                <span className="text-text-primary">{JSON.stringify(item)}</span>
              </div>
            )
          )}
      </div>
    )
  }

  if (!matches) return null

  const isRedacted = typeof value === 'string' && value.startsWith('***')
  const editable = editMode && isEditableKey(name) && !isRedacted

  if (editable && onChange) {
    // Editable leaf — show inline input
    if (typeof value === 'boolean') {
      return (
        <div style={{ marginLeft: depth * 16 }} className="flex items-center gap-2 py-0.5 text-sm border-l-2 border-accent/50 pl-2">
          <span className="text-text-secondary shrink-0">{name}:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => onChange(path || name, e.target.checked)}
              className="w-4 h-4 accent-accent rounded"
            />
            <span className="text-text-primary">{value ? 'true' : 'false'}</span>
          </label>
        </div>
      )
    }

    if (typeof value === 'number') {
      return (
        <div style={{ marginLeft: depth * 16 }} className="flex items-center gap-2 py-0.5 text-sm border-l-2 border-accent/50 pl-2">
          <span className="text-text-secondary shrink-0">{name}:</span>
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(path || name, e.target.valueAsNumber)}
            className="bg-bg-elevated border border-border rounded px-2 py-0.5 text-sm text-text-primary w-32 font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
      )
    }

    // string or other — text input
    return (
      <div style={{ marginLeft: depth * 16 }} className="flex items-center gap-2 py-0.5 text-sm border-l-2 border-accent/50 pl-2">
        <span className="text-text-secondary shrink-0">{name}:</span>
        <input
          type="text"
          value={String(value)}
          onChange={(e) => onChange(path || name, e.target.value)}
          className="bg-bg-elevated border border-border rounded px-2 py-0.5 text-sm text-text-primary font-mono flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>
    )
  }

  // Read-only leaf
  return (
    <div style={{ marginLeft: depth * 16 }} className="flex items-start gap-2 py-0.5 text-sm">
      <span className="text-text-secondary shrink-0">{name}:</span>
      {isRedacted ? (
        <span className="text-warning font-mono text-xs" title="Redacted secret">
          🔒 {value}
        </span>
      ) : (
        <span className="text-text-primary break-all">{JSON.stringify(value)}</span>
      )}
    </div>
  )
}

function ConfigPage() {
  const [viewMode, setViewMode] = useState<'tree' | 'yaml'>('tree')
  const [searchTerm, setSearchTerm] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [changes, setChanges] = useState<Record<string, any>>({})
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const res = await fetch('/api/config')
      if (!res.ok) throw new Error('Failed to load config')
      return res.json()
    },
  })

  const { data: rawData } = useQuery({
    queryKey: ['config-raw'],
    queryFn: async () => {
      const res = await fetch('/api/config/raw')
      if (!res.ok) throw new Error('Failed to load raw config')
      return res.json()
    },
    enabled: viewMode === 'yaml',
  })

  const mergedData = useMemo(() => {
    if (!data || Object.keys(changes).length === 0) return data

    const result = JSON.parse(JSON.stringify(data)) // Deep clone
    for (const [pathStr, value] of Object.entries(changes)) {
      const keys = pathStr.split('.')
      let obj: any = result
      for (let i = 0; i < keys.length - 1; i++) {
        if (obj[keys[i]] === undefined) obj[keys[i]] = {}
        obj = obj[keys[i]]
      }
      obj[keys[keys.length - 1]] = value
    }
    return result
  }, [data, changes])

  const saveMutation = useMutation({
    mutationFn: async (patches: { path: string[]; value: any }[]) => {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patches }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to save')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      queryClient.invalidateQueries({ queryKey: ['config-raw'] })
      setChanges({})
      setEditMode(false)
    },
  })

  const handleChange = (path: string, value: any) => {
    setChanges((prev) => ({ ...prev, [path]: value }))
  }

  const handleCancel = () => {
    setChanges({})
    setEditMode(false)
  }

  const handleSave = () => {
    const patches = Object.entries(changes).map(([path, value]) => ({
      path: path.split('.').filter(Boolean),
      value,
    }))
    saveMutation.mutate(patches)
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <header className="px-6 pt-8 pb-4">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-h2 font-bold text-text-primary">Configuration</h1>
          <p className="text-body-sm text-text-secondary mt-1">
            {editMode ? 'Edit mode — secret fields are locked' : 'Read-only view of Hermes config.yaml'}
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 pb-12">
        {/* Warning banner */}
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning-subtle p-4 flex items-center gap-3">
          <span className="text-warning text-lg">⚠️</span>
          <p className="text-sm text-warning">
            {editMode
              ? 'Editing config.yaml — secret fields (API keys, tokens, passwords) cannot be modified. A container restart is required for changes to take effect.'
              : 'Read-only view — changes to config.yaml require a container restart'}
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('tree')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition duration-200 ${
                viewMode === 'tree'
                  ? 'text-accent bg-accent-subtle'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface/60'
              }`}
            >
              Tree
            </button>
            <button
              onClick={() => setViewMode('yaml')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition duration-200 ${
                viewMode === 'yaml'
                  ? 'text-accent bg-accent-subtle'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface/60'
              }`}
            >
              YAML
            </button>
            {viewMode === 'tree' && (
              <button
                onClick={() => {
                  if (editMode) handleCancel()
                  else setEditMode(true)
                }}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition duration-200 ${
                  editMode
                    ? 'text-warning bg-warning-subtle'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface/60'
                }`}
              >
                {editMode ? '✎ Editing' : '✎ Edit'}
              </button>
            )}
          </div>
          <input
            type="text"
            placeholder="Search keys..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input bg-bg-elevated border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40 w-full sm:w-auto"
          />
        </div>

        {/* Content */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-subtle p-4 text-sm text-danger">
            Error loading config: {String(error)}
          </div>
        )}
        {saveMutation.isError && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-subtle p-4 text-sm text-danger">
            Save failed: {String(saveMutation.error?.message || 'Unknown error')}
          </div>
        )}

        {viewMode === 'tree' && mergedData && (
          <div className="rounded-lg border border-border bg-surface/30 p-4">
            {Object.entries(mergedData).map(([k, v]) => (
              <ConfigNode
                key={k}
                name={k}
                value={v}
                depth={0}
                searchTerm={searchTerm}
                editMode={editMode}
                path={k}
                onChange={handleChange}
              />
            ))}
          </div>
        )}

        {viewMode === 'yaml' && rawData && (
          <pre className="rounded-lg border border-border bg-surface/30 p-4 overflow-x-auto text-sm font-mono text-text-primary">
            {rawData.yaml}
          </pre>
        )}
      </main>

      {/* Sticky save bar */}
      {editMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-bg-elevated border-t border-border px-6 py-3 flex items-center justify-between z-50 shadow-lg">
          <span className="text-body-sm text-text-secondary">
            {Object.keys(changes).length === 0
              ? 'No changes yet — edit fields above'
              : `${Object.keys(changes).length} change(s) pending`}
          </span>
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="px-4 py-1.5 text-sm font-medium text-text-secondary hover:text-text-primary border border-border rounded-md hover:bg-surface/60 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={Object.keys(changes).length === 0 || saveMutation.isPending}
              className="bg-accent text-text-inverse px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {saveMutation.isPending ? 'Saving...' : `Save Changes (${Object.keys(changes).length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Workflow Editor ─────────────────────────────────── */

function calculateDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const nodeColors: Record<string, { bg: string; border: string; icon: string }> = {
  trigger: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', icon: '⚡' },
  action: { bg: 'bg-blue-500/20', border: 'border-blue-500/40', icon: '🔧' },
  condition: { bg: 'bg-amber-500/20', border: 'border-amber-500/40', icon: '🔀' },
}

function WorkflowNode({ data }: NodeProps) {
  const nd = data as unknown as WorkflowNodeData
  const colors = nodeColors[nd.nodeType] || nodeColors.action

  const runStatusStyles: Record<string, string> = {
    completed: 'ring-2 ring-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.3)]',
    skipped: 'opacity-50',
    failed: 'ring-2 ring-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.3)]',
  }

  const runStatusIcons: Record<string, string> = {
    completed: '✅',
    skipped: '⏭️',
    failed: '❌',
  }

  const statusClass = nd.runStatus ? runStatusStyles[nd.runStatus] || '' : ''

  return (
    <div className={`rounded-lg border-2 ${colors.border} ${colors.bg} min-w-[180px] shadow-lg ${statusClass}`}>
      <div className={`px-3 py-1.5 border-b ${colors.border} flex items-center gap-2`}>
        <span>{colors.icon}</span>
        <span className="text-xs font-semibold text-text-secondary uppercase">{nd.nodeType}</span>
        {nd.runStatus && (
          <span className="ml-auto text-xs">{runStatusIcons[nd.runStatus] || ''}</span>
        )}
      </div>
      <div className="px-3 py-2">
        <p className="text-sm font-medium text-text-primary">{nd.label}</p>
      </div>
      {nd.nodeType !== 'trigger' && (
        <Handle type="target" position={Position.Left} className="!bg-text-secondary !w-2 !h-2" />
      )}
      <Handle type="source" position={Position.Right} className="!bg-accent !w-2 !h-2" />
    </div>
  )
}

const workflowNodeTypes = { workflowNode: WorkflowNode }

function WorkflowListPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: workflows, isLoading } = useQuery<Workflow[]>({
    queryKey: ['workflows'],
    queryFn: async () => {
      const res = await fetch('/api/workflows')
      if (!res.ok) throw new Error('Failed to fetch workflows')
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled Workflow',
          description: '',
          nodes: [
            { id: 'trigger-1', type: 'workflowNode', position: { x: 250, y: 150 }, data: { label: 'Start', nodeType: 'trigger' } }
          ],
          edges: [],
        }),
      })
      if (!res.ok) throw new Error('Failed to create workflow')
      return res.json()
    },
    onSuccess: (wf: Workflow) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      navigate(`/workflows/${wf.id}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete workflow')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  })

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (window.confirm(`Delete workflow "${name}"?`)) {
      deleteMutation.mutate(id)
    }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso
    }
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-h2 font-bold text-text-primary">Workflows</h1>
            <p className="text-body text-text-secondary mt-1">Design and manage your automation workflows</p>
          </div>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-text-inverse font-medium text-body hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            <span>+</span>
            <span>{createMutation.isPending ? 'Creating...' : 'New Workflow'}</span>
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-skeleton rounded-xl border border-border bg-surface/40 h-40" />
            ))}
          </div>
        ) : workflows && workflows.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map(wf => (
              <div
                key={wf.id}
                tabIndex={0}
                role="button"
                onClick={() => navigate(`/workflows/${wf.id}`)}
                className="card-focus rounded-xl border border-border bg-surface/40 p-5 transition hover:bg-surface-hover/70 hover:shadow-md hover-shadow-enhanced cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-h4 font-semibold text-text-primary truncate flex-1 mr-2">{wf.name}</h3>
                  <button
                    onClick={(e) => handleDelete(e, wf.id, wf.name)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-error-subtle text-text-tertiary hover:text-error transition-all"
                    title="Delete workflow"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
                <p className="text-body-sm text-text-secondary mb-4 line-clamp-2">
                  {wf.description || 'No description'}
                </p>
                <div className="flex items-center justify-between text-caption text-text-tertiary">
                  <span>{(() => { try { return JSON.parse(wf.nodes).length } catch { return 0 } })()} nodes</span>
                  <span>{formatDate(wf.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">⚡</div>
            <h3 className="text-h4 font-semibold text-text-primary mb-2">No workflows yet</h3>
            <p className="text-body text-text-secondary mb-6">Create your first workflow to start automating tasks</p>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="px-4 py-2 rounded-lg bg-accent text-text-inverse font-medium text-body hover:bg-accent-hover transition-colors"
            >
              Create Workflow
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as any[])
  const [wfName, setWfName] = useState('Untitled')
  const [wfDescription, setWfDescription] = useState('')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [runResults, setRunResults] = useState<Record<string, string>>({})
  const loadedRef = useRef(false)
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [runDetails, setRunDetails] = useState<Record<string, any>>({})

  const fetchRunDetail = async (runId: string) => {
    if (runDetails[runId]) return
    const res = await fetch(`/api/runs/${runId}`)
    if (res.ok) {
      const data = await res.json()
      setRunDetails(prev => ({ ...prev, [runId]: data }))
    }
  }

  const toggleRun = (runId: string) => {
    setExpandedRuns(prev => {
      const next = new Set(prev)
      if (next.has(runId)) {
        next.delete(runId)
      } else {
        next.add(runId)
        fetchRunDetail(runId)
      }
      return next
    })
  }

  // Load workflow
  const { data: workflow, isLoading } = useQuery<Workflow>({
    queryKey: ['workflow', id],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${id}`)
      if (!res.ok) throw new Error('Failed to fetch workflow')
      return res.json()
    },
    enabled: !!id,
  })

  // Parse and set nodes/edges when workflow loads
  useEffect(() => {
    if (workflow && !loadedRef.current) {
      loadedRef.current = true
      setWfName(workflow.name)
      setWfDescription(workflow.description)
      try {
        const parsedNodes = JSON.parse(workflow.nodes)
        const parsedEdges = JSON.parse(workflow.edges)
        setNodes(parsedNodes)
        setEdges(parsedEdges)
      } catch {
        setNodes([])
        setEdges([])
      }
    }
  }, [workflow, setNodes, setEdges])

  // Handle new connections
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#94A3B8' } }, eds))
    },
    [setEdges]
  )

  // Track node selection
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      setSaveStatus('saving')
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: wfName,
          description: wfDescription,
          nodes: nodes,
          edges: edges,
        }),
      })
      if (!res.ok) throw new Error('Failed to save')
      return res.json()
    },
    onSuccess: () => {
      setSaveStatus('saved')
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setTimeout(() => setSaveStatus('idle'), 2000)
    },
    onError: () => {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    },
  })

  // Run workflow mutation
  const runMutation = useMutation({
    mutationFn: async () => {
      // Save first
      await saveMutation.mutateAsync()
      const res = await fetch(`/api/workflows/${id}/run`, { method: 'POST' })
      if (!res.ok) throw new Error('Run failed')
      return res.json()
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs', id] })
      // Build runResults map from node results
      if (data.result?.node_results) {
        const results: Record<string, string> = {}
        for (const nr of data.result.node_results) {
          results[nr.node_id] = nr.status
        }
        setRunResults(results)
      }
    },
  })

  // Run history query
  const { data: runs } = useQuery({
    queryKey: ['workflow-runs', id],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${id}/runs`)
      if (!res.ok) return []
      return res.json()
    },
    enabled: !!id,
  })

  // Add node to canvas
  const addNode = useCallback((nodeType: 'trigger' | 'action' | 'condition') => {
    const id = `${nodeType}-${Date.now()}`
    const labels: Record<string, string> = {
      trigger: 'New Trigger',
      action: 'New Action',
      condition: 'New Condition',
    }
    // Place near center with some randomness so nodes don't stack
    const x = 250 + Math.random() * 200 - 100
    const y = 150 + Math.random() * 200 - 100
    const newNode: Node = {
      id,
      type: 'workflowNode',
      position: { x, y },
      data: { label: labels[nodeType], nodeType },
    }
    setNodes((nds) => [...nds, newNode])
  }, [setNodes])

  // Update selected node's label
  const updateNodeLabel = useCallback((label: string) => {
    if (!selectedNode) return
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? { ...n, data: { ...n.data, label } }
          : n
      )
    )
    setSelectedNode((prev) => prev ? { ...prev, data: { ...prev.data, label } } : null)
  }, [selectedNode, setNodes])

  // Update selected node's config
  const updateNodeConfig = useCallback((key: string, value: any) => {
    if (!selectedNode) return
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? { ...n, data: { ...n.data, config: { ...((n.data as any)?.config || {}), [key]: value } } }
          : n
      )
    )
    setSelectedNode((prev) => {
      if (!prev) return null
      const currentConfig = (prev.data as any)?.config || {}
      return { ...prev, data: { ...prev.data, config: { ...currentConfig, [key]: value } } }
    })
  }, [selectedNode, setNodes])

  // Delete selected node
  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id))
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id))
    setSelectedNode(null)
  }, [selectedNode, setNodes, setEdges])

  // Keyboard shortcut: Delete/Backspace to remove selected node
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode && (e.target as HTMLElement).tagName !== 'INPUT') {
        deleteSelectedNode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedNode, deleteSelectedNode])

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <NavBar />
        <div className="flex items-center justify-center h-[calc(100vh-56px)]">
          <div className="animate-skeleton w-16 h-16 rounded-full" />
        </div>
      </div>
    )
  }

  const nodeInfo = selectedNode ? (selectedNode.data as unknown as WorkflowNodeData) : null
  const selectedColors = nodeInfo ? nodeColors[nodeInfo.nodeType] : null

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Toolbar */}
      <NavBar />
      <div className="bg-bg-elevated/80 border-b border-border px-4 py-2 flex items-center gap-3">
        <button
          onClick={() => navigate('/workflows')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body-sm text-text-secondary hover:text-text-primary hover:bg-surface/60 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Back
        </button>
        <div className="h-5 w-px bg-border" />
        <input
          type="text"
          value={wfName}
          onChange={(e) => setWfName(e.target.value)}
          className="bg-transparent text-h5 font-semibold text-text-primary border-none outline-none focus:bg-surface/40 rounded px-2 py-1 transition min-w-[200px]"
          placeholder="Workflow name"
        />
        <span className="text-caption text-text-tertiary">/</span>
        <input
          type="text"
          value={wfDescription}
          onChange={(e) => setWfDescription(e.target.value)}
          className="bg-transparent text-body-sm text-text-secondary border-none outline-none focus:bg-surface/40 rounded px-2 py-1 transition flex-1 min-w-0"
          placeholder="Description (optional)"
        />
        <div className="flex items-center gap-2 ml-auto">
          {saveStatus === 'saved' && (
            <span className="text-caption text-success flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="text-caption text-error">Save failed</span>
          )}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveStatus === 'saving'}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-accent text-text-inverse font-medium text-body-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="bg-emerald-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {runMutation.isPending ? '⏳ Running...' : '▶ Run Now'}
          </button>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar — Node Palette */}
        <div className="w-56 bg-bg-elevated/60 border-r border-border p-4 flex flex-col gap-3 shrink-0">
          <h3 className="text-caption font-semibold text-text-tertiary uppercase tracking-wider mb-1">Add Nodes</h3>
          {(['trigger', 'action', 'condition'] as const).map((nodeType) => {
            const colors = nodeColors[nodeType]
            return (
              <button
                key={nodeType}
                onClick={() => addNode(nodeType)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${colors.border} ${colors.bg} hover:brightness-110 transition text-left`}
              >
                <span className="text-lg">{colors.icon}</span>
                <div>
                  <p className="text-body-sm font-medium text-text-primary capitalize">{nodeType}</p>
                  <p className="text-caption text-text-tertiary">
                    {nodeType === 'trigger' ? 'Start workflow' : nodeType === 'action' ? 'Perform task' : 'Branch logic'}
                  </p>
                </div>
              </button>
            )
          })}

          <div className="mt-4 p-3 rounded-lg bg-bg-overlay/50 border border-border">
            <h4 className="text-caption font-semibold text-text-secondary mb-2">Tips</h4>
            <ul className="text-caption text-text-tertiary space-y-1">
              <li>• Drag to connect nodes</li>
              <li>• Click a node to edit it</li>
              <li>• Press Delete to remove</li>
              <li>• Scroll to zoom, drag to pan</li>
            </ul>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes.map(n => ({
              ...n,
              data: { ...n.data, runStatus: runResults[n.id] || undefined },
            }))}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={workflowNodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            className="bg-bg-base"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
            <Controls />
          </ReactFlow>
        </div>

        {/* Right Panel — Node Properties */}
        {selectedNode && nodeInfo && (
          <div className="w-64 bg-bg-elevated/60 border-l border-border p-4 shrink-0 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-h6 font-semibold text-text-primary">Node Properties</h3>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded hover:bg-surface/60 text-text-tertiary hover:text-text-primary transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            {/* Type badge */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${selectedColors?.border} ${selectedColors?.bg} mb-4`}>
              <span>{selectedColors?.icon}</span>
              <span className="text-body-sm font-medium capitalize text-text-primary">{nodeInfo.nodeType}</span>
            </div>

            {/* Label field */}
            <label className="block mb-3">
              <span className="text-caption font-semibold text-text-secondary mb-1.5 block">Label</span>
              <input
                type="text"
                value={nodeInfo.label}
                onChange={(e) => updateNodeLabel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none transition"
              />
            </label>

            {/* Node ID (read-only) */}
            <label className="block mb-4">
              <span className="text-caption font-semibold text-text-secondary mb-1.5 block">Node ID</span>
              <div className="px-3 py-2 rounded-lg bg-bg-base border border-border text-mono-sm text-text-tertiary">
                {selectedNode.id}
              </div>
            </label>

            {/* Node Config Fields */}
            {nodeInfo.nodeType === 'trigger' && (
              <div className="mb-4 space-y-3">
                <h4 className="text-caption font-semibold text-text-secondary">Trigger Config</h4>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Type</span>
                  <select
                    value={(nodeInfo as any).config?.type || 'manual'}
                    onChange={(e) => updateNodeConfig('type', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  >
                    <option value="manual">Manual</option>
                    <option value="schedule">Schedule</option>
                    <option value="webhook">Webhook</option>
                  </select>
                </label>
              </div>
            )}

            {nodeInfo.nodeType === 'action' && (
              <div className="mb-4 space-y-3">
                <h4 className="text-caption font-semibold text-text-secondary">Action Config</h4>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Action Type</span>
                  <select
                    value={(nodeInfo as any).config?.action_type || 'log'}
                    onChange={(e) => updateNodeConfig('action_type', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  >
                    <option value="log">Log</option>
                    <option value="set_variable">Set Variable</option>
                    <option value="create_task">Create Task</option>
                    <option value="http_request">HTTP Request</option>
                  </select>
                </label>

                {((nodeInfo as any).config?.action_type || 'log') === 'log' && (
                  <label className="block">
                    <span className="text-caption text-text-tertiary mb-1 block">Message</span>
                    <input
                      type="text"
                      value={(nodeInfo as any).config?.message || ''}
                      onChange={(e) => updateNodeConfig('message', e.target.value)}
                      placeholder="Log message"
                      className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                    />
                  </label>
                )}

                {(nodeInfo as any).config?.action_type === 'set_variable' && (
                  <>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Variable Name</span>
                      <input
                        type="text"
                        value={(nodeInfo as any).config?.variable || ''}
                        onChange={(e) => updateNodeConfig('variable', e.target.value)}
                        placeholder="variable_name"
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      />
                    </label>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Value</span>
                      <input
                        type="text"
                        value={(nodeInfo as any).config?.value || ''}
                        onChange={(e) => updateNodeConfig('value', e.target.value)}
                        placeholder="value"
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      />
                    </label>
                  </>
                )}

                {(nodeInfo as any).config?.action_type === 'create_task' && (
                  <>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Title</span>
                      <input
                        type="text"
                        value={(nodeInfo as any).config?.title || ''}
                        onChange={(e) => updateNodeConfig('title', e.target.value)}
                        placeholder="Task title"
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      />
                    </label>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Assignee</span>
                      <select
                        value={(nodeInfo as any).config?.assignee || 'coder'}
                        onChange={(e) => updateNodeConfig('assignee', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      >
                        <option value="coder">Coder</option>
                        <option value="pixel">Pixel</option>
                        <option value="atlas">Atlas</option>
                        <option value="nova">Nova</option>
                      </select>
                    </label>
                  </>
                )}

                {(nodeInfo as any).config?.action_type === 'http_request' && (
                  <>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">URL</span>
                      <input
                        type="text"
                        value={(nodeInfo as any).config?.url || ''}
                        onChange={(e) => updateNodeConfig('url', e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      />
                    </label>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Method</span>
                      <select
                        value={(nodeInfo as any).config?.method || 'GET'}
                        onChange={(e) => updateNodeConfig('method', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            )}

            {nodeInfo.nodeType === 'condition' && (
              <div className="mb-4 space-y-3">
                <h4 className="text-caption font-semibold text-text-secondary">Condition Config</h4>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Field</span>
                  <input
                    type="text"
                    value={(nodeInfo as any).config?.field || ''}
                    onChange={(e) => updateNodeConfig('field', e.target.value)}
                    placeholder="context_field"
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  />
                </label>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Operator</span>
                  <select
                    value={(nodeInfo as any).config?.operator || 'equals'}
                    onChange={(e) => updateNodeConfig('operator', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  >
                    <option value="equals">Equals</option>
                    <option value="not_equals">Not Equals</option>
                    <option value="contains">Contains</option>
                    <option value="greater_than">Greater Than</option>
                    <option value="less_than">Less Than</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Value</span>
                  <input
                    type="text"
                    value={(nodeInfo as any).config?.value || ''}
                    onChange={(e) => updateNodeConfig('value', e.target.value)}
                    placeholder="comparison value"
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  />
                </label>
              </div>
            )}

            {/* Delete button */}
            <button
              onClick={deleteSelectedNode}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-error/30 bg-error-subtle text-error text-body-sm font-medium hover:bg-error/20 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              Delete Node
            </button>
          </div>
        )}
      </div>

      {/* Run History Panel */}
      {runs && runs.length > 0 && (
        <div className="border-t border-border p-4 bg-bg-elevated/60">
          <h3 className="text-sm font-semibold text-text-secondary mb-2">Run History</h3>
          <div className="space-y-2">
            {runs.slice(0, 10).map((run: any) => {
              const isExpanded = expandedRuns.has(run.id)
              const detail = runDetails[run.id]
              const duration = run.finished_at ? calculateDuration(run.started_at, run.finished_at) : null

              return (
                <div key={run.id} className="rounded border border-border">
                  {/* Header - clickable */}
                  <div
                    className="flex items-center gap-2 text-xs p-2 cursor-pointer hover:bg-surface/40"
                    onClick={() => toggleRun(run.id)}
                  >
                    <span className="text-text-tertiary">{isExpanded ? '▼' : '▶'}</span>
                    <span className={run.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}>
                      {run.status === 'completed' ? '✅' : '❌'}
                    </span>
                    <span className="text-text-secondary font-mono flex-1">{run.id}</span>
                    <span className="text-text-tertiary">{formatTime(run.started_at)}</span>
                    {duration && <span className="text-text-tertiary">{duration}</span>}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && detail && (
                    <div className="p-3 bg-bg-base/40 border-t border-border">
                      {/* Summary stats */}
                      <div className="flex gap-4 text-xs mb-3">
                        <span className="text-emerald-400">✅ {detail.result?.executed_nodes || 0} executed</span>
                        <span className="text-text-tertiary">⏭️ {detail.result?.skipped_nodes || 0} skipped</span>
                        <span className="text-text-secondary">📊 {detail.result?.total_nodes || 0} total</span>
                      </div>

                      {/* Node results */}
                      {detail.result?.node_results && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-text-secondary">Node Execution:</p>
                          {detail.result.node_results.map((node: any) => (
                            <div key={node.node_id} className="flex items-start gap-2 pl-2">
                              <span className={node.status === 'completed' ? 'text-emerald-400' : node.status === 'skipped' ? 'text-text-tertiary' : 'text-red-400'}>
                                {node.status === 'completed' ? '✅' : node.status === 'skipped' ? '⏭️' : '❌'}
                              </span>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-text-primary">{node.label}</span>
                                  <span className="text-xs text-text-tertiary capitalize px-1 rounded bg-surface">{node.node_type}</span>
                                </div>
                                {node.output && (
                                  <pre className="text-xs text-text-secondary mt-1 font-mono bg-bg-base p-2 rounded overflow-x-auto">
                                    {JSON.stringify(node.output, null, 2)}
                                  </pre>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Context variables */}
                      {detail.result?.context && Object.keys(detail.result.context).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-xs font-medium text-text-secondary mb-1">Context Variables:</p>
                          {Object.entries(detail.result.context).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-xs">
                              <span className="text-accent font-mono">{k}:</span>
                              <span className="text-text-secondary">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Run result toast */}
      {runMutation.isSuccess && runMutation.data && (
        <div className="fixed bottom-20 right-4 bg-bg-elevated border border-border rounded-lg p-4 shadow-xl max-w-sm z-50">
          <div className="flex items-center gap-2 mb-2">
            <span className={runMutation.data.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}>
              {runMutation.data.status === 'completed' ? '✅' : '❌'}
            </span>
            <span className="text-sm font-medium text-text-primary">
              Run {runMutation.data.status}
            </span>
          </div>
          <div className="text-xs text-text-secondary space-y-1">
            <p>Nodes executed: {runMutation.data.result?.executed_nodes || 0}</p>
            <p>Nodes skipped: {runMutation.data.result?.skipped_nodes || 0}</p>
            <p>Duration: {calculateDuration(runMutation.data.started_at, runMutation.data.finished_at)}</p>
          </div>
          <button onClick={() => { runMutation.reset(); setRunResults({}) }} className="mt-2 text-xs text-text-tertiary hover:text-text-secondary">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Search / Keyboard Context ──────────────────────── */

const SearchContext = createContext<{ openSearch: () => void }>({ openSearch: () => {} })

function useOpenSearch() {
  return useContext(SearchContext).openSearch
}

/* ── Search Modal ──────────────────────────────────── */

interface SearchResult {
  type: 'session' | 'task' | 'skill' | 'workflow'
  id: string
  title: string
  subtitle?: string
  path: string
}

function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const q = query.toLowerCase()
        const [sessions, tasks, skills, workflows] = await Promise.all([
          fetch(`/api/sessions?limit=20&search=${encodeURIComponent(query)}`, { signal: ctrl.signal }).then(r => r.ok ? r.json() : { sessions: [] }).catch(() => ({ sessions: [] })),
          fetch(`/api/tasks/search?q=${encodeURIComponent(query)}&limit=20`, { signal: ctrl.signal }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`/api/skills`, { signal: ctrl.signal }).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`/api/workflows`, { signal: ctrl.signal }).then(r => r.ok ? r.json() : []).catch(() => []),
        ])
        const out: SearchResult[] = []
        for (const s of (sessions.sessions || [])) {
          if ((s.title || '').toLowerCase().includes(q)) {
            out.push({ type: 'session', id: s.id, title: s.title || 'Untitled', subtitle: `${s.message_count} messages`, path: `/sessions/${encodeURIComponent(s.id)}` })
          }
        }
        for (const t of (Array.isArray(tasks) ? tasks : [])) {
          if ((t.title || '').toLowerCase().includes(q)) {
            out.push({ type: 'task', id: t.id, title: t.title || 'Untitled', subtitle: t.status, path: `/tasks/${encodeURIComponent(t.id)}` })
          }
        }
        for (const sk of (Array.isArray(skills) ? skills : [])) {
          if ((sk.name || '').toLowerCase().includes(q)) {
            out.push({ type: 'skill', id: sk.slug, title: sk.name, subtitle: sk.category, path: `/skills` })
          }
        }
        for (const wf of (Array.isArray(workflows) ? workflows : [])) {
          if ((wf.name || '').toLowerCase().includes(q)) {
            out.push({ type: 'workflow', id: wf.id, title: wf.name, subtitle: wf.description?.slice(0, 60), path: `/workflows/${encodeURIComponent(wf.id)}` })
          }
        }
        if (!ctrl.signal.aborted) setResults(out)
      } catch { /* ignore */ }
      finally { if (!ctrl.signal.aborted) setLoading(false) }
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [query])

  if (!open) return null

  const typeColors: Record<string, string> = {
    session: 'bg-blue-500/20 text-blue-400',
    task: 'bg-orange-500/20 text-orange-400',
    skill: 'bg-purple-500/20 text-purple-400',
    workflow: 'bg-green-500/20 text-green-400',
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] = acc[r.type] || []).push(r)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-elevated border border-border rounded-xl shadow-lg w-full max-w-xl max-h-[60vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-tertiary shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sessions, tasks, skills, workflows…"
            className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-tertiary"
            onKeyDown={e => { if (e.key === 'Escape') onClose() }}
          />
          <kbd className="text-[10px] font-mono text-text-tertiary bg-bg-base border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading && <div className="px-3 py-6 text-center text-text-tertiary text-sm">Searching…</div>}
          {!loading && query && results.length === 0 && <div className="px-3 py-6 text-center text-text-tertiary text-sm">No results found</div>}
          {!loading && !query && <div className="px-3 py-6 text-center text-text-tertiary text-sm">Type to search across all pages…</div>}
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="mb-2">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">{type}s</div>
              {items.map(item => (
                <button
                  key={`${item.type}-${item.id}`}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface/60 text-left transition-colors"
                  onClick={() => { navigate(item.path); onClose() }}
                >
                  <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${typeColors[item.type] || ''}`}>{item.type}</span>
                  <span className="flex-1 text-sm text-text-primary truncate">{item.title}</span>
                  {item.subtitle && <span className="text-xs text-text-tertiary truncate max-w-[120px]">{item.subtitle}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Help Modal ────────────────────────────────────── */

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-elevated border border-border rounded-xl shadow-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-text-primary">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface/60">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold mb-2">Navigation</h3>
            <div className="space-y-1.5">
              {[
                ['g d', 'Dashboard'],
                ['g s', 'Sessions'],
                ['g t', 'Tasks'],
                ['g c', 'Config'],
                ['g k', 'Skills'],
                ['g w', 'Workflows'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">{label}</span>
                  <kbd className="text-xs font-mono bg-bg-base border border-border rounded px-2 py-0.5 text-text-tertiary">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <h3 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold mb-2">Actions</h3>
            <div className="space-y-1.5">
              {[
                ['⌘ K', 'Quick search'],
                ['?', 'Show this help'],
                ['Esc', 'Close modal'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">{label}</span>
                  <kbd className="text-xs font-mono bg-bg-base border border-border rounded px-2 py-0.5 text-text-tertiary">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── App ───────────────────────────────────────────── */

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const keySeqRef = useRef<string[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable

      // Cmd+K / Ctrl+K — quick search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        setHelpOpen(false)
        return
      }

      // Escape — close modals
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setHelpOpen(false)
        return
      }

      // Don't trigger shortcuts in input fields
      if (isInput) return

      // ? — show help
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setHelpOpen(h => !h)
        return
      }

      // g + key — navigation shortcuts
      keySeqRef.current = [...keySeqRef.current, e.key].slice(-2)
      const seq = keySeqRef.current
      if (seq.length === 2 && seq[0] === 'g') {
        const routes: Record<string, string> = {
          d: '/', s: '/sessions', t: '/tasks', c: '/config', k: '/skills', w: '/workflows'
        }
        if (routes[seq[1]]) {
          navigate(routes[seq[1]])
          keySeqRef.current = []
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  return (
    <QueryClientProvider client={queryClient}>
      <SearchContext.Provider value={{ openSearch: () => setSearchOpen(true) }}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/tasks" element={<KanbanBoardPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/skills" element={<SkillsHubPage />} />
          <Route path="/workflows" element={<WorkflowListPage />} />
          <Route path="/workflows/:id" element={<WorkflowEditorPage />} />
        </Routes>
        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      </SearchContext.Provider>
    </QueryClientProvider>
  )
}

/* ── Skills Hub ────────────────────────────────────── */

function SkillCard({ skill, onClick }: { skill: Skill; onClick: () => void }) {
  const categoryColors: Record<string, string> = {
    anthropic: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    hermes: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    autonomous: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    creative: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    'data science': 'bg-green-500/20 text-green-400 border-green-500/30',
    devops: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    debugging: 'bg-red-500/20 text-red-400 border-red-500/30',
    documents: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    gaming: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    github: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    kanban: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
    mcp: 'bg-lime-500/20 text-lime-400 border-lime-500/30',
    media: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    mlops: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    planning: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    productivity: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
    'red team': 'bg-red-700/20 text-red-500 border-red-700/30',
    research: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'smart home': 'bg-emerald-600/20 text-emerald-500 border-emerald-600/30',
    social: 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30',
    software: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    'ui/ux': 'bg-fuchsia-600/20 text-fuchsia-500 border-fuchsia-600/30',
    web: 'bg-sky-600/20 text-sky-500 border-sky-600/30',
    other: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  }
  const colorClass = categoryColors[skill.category?.toLowerCase()] || categoryColors.other

  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-border bg-surface/30 p-4 hover:border-accent/40 hover:bg-surface/50 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-body font-semibold text-text-primary">{skill.name}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${colorClass}`}>
          {skill.category || 'Other'}
        </span>
      </div>
      <p className="text-body-sm text-text-secondary line-clamp-2 mb-3">
        {skill.description}
      </p>
      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        <span>{skill.file_count} files</span>
        {skill.has_references && <span title="Has references">📄</span>}
        {skill.has_scripts && <span title="Has scripts">⚙️</span>}
        {skill.has_templates && <span title="Has templates">📋</span>}
      </div>
      {skill.profiles && skill.profiles.length > 0 ? (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <span className="text-text-tertiary text-xs">Used by:</span>
          {skill.profiles.map(p => (
            <span key={p} className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">{p}</span>
          ))}
        </div>
      ) : (
        <div className="mt-2">
          <span className="text-xs text-amber-400">Unused</span>
        </div>
      )}
    </button>
  )
}

function SkillsHubPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<'name-asc' | 'name-desc' | 'files'>('name-asc')
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

  const { data: skills, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const res = await fetch('/api/skills')
      if (!res.ok) throw new Error('Failed to load skills')
      return res.json() as Promise<Skill[]>
    },
  })

  const { data: selectedSkill } = useQuery({
    queryKey: ['skill', selectedSlug],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${selectedSlug}`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<SkillDetail>
    },
    enabled: !!selectedSlug,
  })

  const filtered = useMemo(() => {
    if (!skills) return []
    let result = skills.filter((s: Skill) => {
      const matchesSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase())
      const matchesCategory = category === 'all' || s.category?.toLowerCase() === category.toLowerCase()
      return matchesSearch && matchesCategory
    })
    if (sort === 'name-asc') result.sort((a: Skill, b: Skill) => a.name.localeCompare(b.name))
    if (sort === 'name-desc') result.sort((a: Skill, b: Skill) => b.name.localeCompare(a.name))
    if (sort === 'files') result.sort((a: Skill, b: Skill) => b.file_count - a.file_count)
    return result
  }, [skills, search, category, sort])

  const categories = useMemo(() => {
    if (!skills) return ['all']
    const cats = [...new Set(skills.map((s: Skill) => s.category || 'uncategorized'))]
    return ['all', ...cats.sort()]
  }, [skills])

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <header className="px-6 pt-8 pb-4">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-h2 font-bold text-text-primary">Skills Hub</h1>
          <p className="text-body-sm text-text-secondary mt-1">
            {skills?.length || 0} installed skills
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-12">
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input flex-1 bg-bg-elevated border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-bg-elevated border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            {categories.map((cat: string) => (
              <option key={cat} value={cat}>{cat === 'all' ? 'All Categories' : cat}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'name-asc' | 'name-desc' | 'files')}
            className="bg-bg-elevated border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="files">Most Files</option>
          </select>
        </div>

        {isLoading ? (
          <div className="text-text-secondary text-center py-12">Loading skills...</div>
        ) : filtered.length === 0 ? (
          <div className="text-text-secondary text-center py-12">No skills found.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((skill: Skill) => (
              <SkillCard key={skill.slug} skill={skill} onClick={() => setSelectedSlug(skill.slug)} />
            ))}
          </div>
        )}

        {selectedSkill && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setSelectedSlug(null)}>
            <div className="bg-bg-elevated border border-border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-h2 font-bold text-text-primary">{selectedSkill.name}</h2>
                <button onClick={() => setSelectedSlug(null)} className="text-text-secondary hover:text-text-primary text-xl">×</button>
              </div>
              <p className="text-text-secondary mb-4">{selectedSkill.description}</p>
              <div className="flex gap-4 text-xs text-text-tertiary mb-4">
                <span>{selectedSkill.file_count} files</span>
                <span>{selectedSkill.category}</span>
              </div>
              <div className="border-t border-border pt-4">
                <MarkdownRenderer content={selectedSkill.full_content} />
              </div>
              {selectedSkill.files?.length > 0 && (
                <div className="border-t border-border mt-4 pt-4">
                  <h3 className="text-body font-semibold text-text-primary mb-2">Files</h3>
                  <ul className="text-sm text-text-secondary space-y-1">
                    {selectedSkill.files.map((f: { path: string; size: number }) => (
                      <li key={f.path} className="font-mono text-xs">
                        {f.path} <span className="text-text-tertiary">({f.size} bytes)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
