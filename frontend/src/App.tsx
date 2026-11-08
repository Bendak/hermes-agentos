import { isAdmin } from "./lib/admin"
import { apiErrorMessage } from "./lib/api"
import { ToastProvider, useToast } from "./lib/toast"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, Link, Navigate, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import ProtectedRoute from './auth/ProtectedRoute'
import UserManagement from './pages/UserManagement'
import AppShell, { useAppShell } from './components/AppShell'
import { PageContainer, PageHeader } from './components/PageHeader'
import ProfilesPage from './pages/Profiles'
import AnalyticsPage from './pages/Analytics'
import MemoryPage from './pages/Memory'
import ChatPage from './pages/Chat'
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DndContext, DragOverlay, useDroppable, closestCorners, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import monokai from 'react-syntax-highlighter/dist/esm/styles/hljs/monokai'
import typescriptLang from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import pythonLang from 'react-syntax-highlighter/dist/esm/languages/hljs/python'
import javascriptLang from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript'
import yamlLang from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml'
import jsonLang from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import bashLang from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import cssLang from 'react-syntax-highlighter/dist/esm/languages/hljs/css'
import xmlLang from 'react-syntax-highlighter/dist/esm/languages/hljs/xml'
import goLang from 'react-syntax-highlighter/dist/esm/languages/hljs/go'
import rustLang from 'react-syntax-highlighter/dist/esm/languages/hljs/rust'
import rubyLang from 'react-syntax-highlighter/dist/esm/languages/hljs/ruby'
import sqlLang from 'react-syntax-highlighter/dist/esm/languages/hljs/sql'
import dockerfileLang from 'react-syntax-highlighter/dist/esm/languages/hljs/dockerfile'
import shellLang from 'react-syntax-highlighter/dist/esm/languages/hljs/shell'

SyntaxHighlighter.registerLanguage('typescript', typescriptLang)
SyntaxHighlighter.registerLanguage('tsx', typescriptLang)
SyntaxHighlighter.registerLanguage('jsx', javascriptLang)
SyntaxHighlighter.registerLanguage('python', pythonLang)
SyntaxHighlighter.registerLanguage('javascript', javascriptLang)
SyntaxHighlighter.registerLanguage('yaml', yamlLang)
SyntaxHighlighter.registerLanguage('json', jsonLang)
SyntaxHighlighter.registerLanguage('bash', bashLang)
SyntaxHighlighter.registerLanguage('sh', shellLang)
SyntaxHighlighter.registerLanguage('css', cssLang)
SyntaxHighlighter.registerLanguage('html', xmlLang)
SyntaxHighlighter.registerLanguage('xml', xmlLang)
SyntaxHighlighter.registerLanguage('go', goLang)
SyntaxHighlighter.registerLanguage('rust', rustLang)
SyntaxHighlighter.registerLanguage('ruby', rubyLang)
SyntaxHighlighter.registerLanguage('sql', sqlLang)
SyntaxHighlighter.registerLanguage('dockerfile', dockerfileLang)
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
  kanban_task?: string | null
  status?: string
  sessions: number
}

interface SessionItem {
  profile?: string | null
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
  node_count?: number | null  // M8-15: counts travel with the list; null = graph corrupt
  edge_count?: number
  graph_corrupt?: boolean
}

// M17-5: run-level honesty — a completed TRIGGER is not "work done", so a
// trigger+stubs run reads 🚧 and a trigger+all-skipped run reads ⏭️, never ✅.
const runLevelIcon = (status: string, res: any): string => {
  if (status === 'running' || status === 'pending') return '⏳'
  if (status !== 'completed') return '❌'
  const biz = (res?.executed_nodes || 0) - (res?.trigger_nodes || 0)
  if (biz > 0) return '✅'
  if ((res?.stub_nodes || 0) > 0) return '🚧'
  if ((res?.skipped_nodes || 0) > 0) return '⏭️'
  return '✅'
}

const runLevelClass = (icon: string): string =>
  icon === '✅' ? 'text-emerald-400' : icon === '❌' ? 'text-red-400' : 'text-amber-400'

interface WorkflowNodeData {
  label: string
  nodeType: 'trigger' | 'action' | 'condition'
  config?: Record<string, any>
  runStatus?: string
}

/* ── NavBar ────────────────────────────────────────── */

export function NavBar() {
  const inShell = useAppShell()
  const onOpenSearch = useOpenSearch()
  const { user, logout } = useAuth()
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('agentos-theme') as 'dark' | 'light') || 'dark'
    }
    return 'dark'
  })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuCloseTimer = useRef<number | null>(null)

  // F-6 (adversarial lote 2): teclado — Escape fecha o dropdown; clique fora
  // também (o mouseleave cobre o mouse, mas não o teclado). Sem isso o menu
  // ficava preso aberto quando o ponteiro estava parado.
  useEffect(() => {
    if (!openMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    const onPointer = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-nav-group]')) setOpenMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [openMenu])

  useEffect(() => {
    if (inShell) return
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('agentos-theme', theme)
  }, [theme, inShell])

  if (inShell) return null

  const navLink = (to: string, label: string, closeMobile?: () => void, role?: string) => {
    const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to))
    return (
      <Link
        to={to}
        role={role}
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

  // Fecho por hover com atraso: sem isso o vão entre o botão e o painel dispara
  // mouseleave no meio do trajeto e o menu some antes de o mouse chegar.
  const cancelMenuClose = () => {
    if (menuCloseTimer.current) {
      window.clearTimeout(menuCloseTimer.current)
      menuCloseTimer.current = null
    }
  }
  const scheduleMenuClose = () => {
    cancelMenuClose()
    menuCloseTimer.current = window.setTimeout(() => setOpenMenu(null), 180)
  }

  const navGroup = (label: string, items: Array<[string, string]>) => {
    const open = openMenu === label
    const active = items.some(([to]) => location.pathname === to || (to !== '/' && location.pathname.startsWith(to)))
    return (
      <div
        key={label}
        data-nav-group
        className="relative"
        onMouseEnter={cancelMenuClose}
        onMouseLeave={scheduleMenuClose}
      >
        <button
          onClick={() => setOpenMenu(open ? null : label)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition duration-200 ease-agent-os flex items-center gap-1 ${
            active ? 'text-accent bg-accent-subtle' : 'text-text-secondary hover:text-text-primary hover:bg-surface/60'
          }`}
        >
          {label}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          {active && (
            <span className="absolute bottom-[-13px] left-1 right-1 h-[2px] bg-accent rounded-full shadow-glow hidden sm:block" />
          )}
        </button>
        {open && (
          <div className="absolute left-0 top-full pt-2 min-w-[180px] z-50">
          <div
            role="menu"
            className="rounded-lg border border-border bg-bg-elevated shadow-xl py-1"
          >
            {items.map(([to, lbl]) => (
              <div key={to} role="none" className="px-1" onClick={() => setOpenMenu(null)}>
                {navLink(to, lbl, undefined, 'menuitem')}
              </div>
            ))}
          </div>
          </div>
        )}
      </div>
    )
  }

  const admin = user?.role === 'admin'

  return (
    <>
      <nav
        className="bg-bg-elevated/80 backdrop-blur-md border-b border-border px-4 sm:px-6 py-3 sticky top-0 z-50"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2 text-text-primary font-bold text-lg tracking-tight group shrink-0">
              <img src={theme === 'light' ? '/logo-light.svg' : '/logo.svg'} alt="AgentOS" className="h-7 w-auto" />
            </Link>
            {/* Desktop nav links — M11-01: inline só quando cabe de verdade (xl);
                abaixo disso o hamburger cobre 640–1280px (Z Fold 768px clipava os links) */}
            <div className="hidden xl:flex items-center gap-1 ml-2">
              {navLink('/', 'Dashboard')}
              {navLink('/chat', 'Chat')}
              {admin && navGroup('Operação', [['/sessions', 'Sessions'], ['/tasks', 'Tasks'], ['/cron', 'Cron']])}
              {admin && navGroup('IA', [['/skills', 'Skills'], ['/profiles', 'Profiles'], ['/workflows', 'Workflows']])}
              {admin && navGroup('Sistema', [
                ['/analytics', 'Analytics'],
                ['/config', 'Config'],
                ['/settings', 'Usuários'],
                ['/memory', 'Memória'],
              ])}
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
            {/* User info + logout */}
            {user && (
              <div className="hidden sm:flex items-center gap-2 ml-1 pl-2 border-l border-border">
                <span className="text-xs text-text-tertiary font-mono">{user.username}</span>
                <button
                  onClick={logout}
                  className="p-1.5 rounded-md text-text-tertiary hover:text-error hover:bg-error-subtle/50 transition-colors"
                  title="Sign out"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                </button>
              </div>
            )}
            {/* Mobile hamburger */}
            <button
              className="xl:hidden p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface/60 transition-colors"
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
        <div
          className="xl:hidden border-b border-border bg-bg-elevated/95 backdrop-blur-md px-4 py-3 sticky z-40"
          style={{ top: 'calc(65px + env(safe-area-inset-top))' }}
        >
          <div className="flex flex-col gap-1">
            {navLink('/', 'Dashboard')}
            {navLink('/chat', 'Chat')}
            {(admin ? ['Operação', 'IA', 'Sistema'] : []).map((g) => (
              <div key={g}>
                <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-text-tertiary">{g}</p>
                {g === 'Operação' && [navLink('/sessions', 'Sessions'), navLink('/tasks', 'Tasks'), navLink('/cron', 'Cron')]}
                {g === 'IA' && [navLink('/skills', 'Skills'), navLink('/profiles', 'Profiles'), navLink('/workflows', 'Workflows')]}
                {g === 'Sistema' && [
                  ...(admin ? [navLink('/analytics', 'Analytics')] : []),
                  navLink('/config', 'Config'),
                  navLink('/settings', 'Usuários'),
                  ...(admin ? [navLink('/memory', 'Memória')] : []),
                ]}
              </div>
            ))}
            {onOpenSearch && (
              <button
                onClick={() => { setMobileMenuOpen(false); onOpenSearch() }}
                className="px-3 py-1.5 text-sm font-medium rounded-md text-text-secondary hover:text-text-primary hover:bg-surface/60 text-left transition-colors"
              >
                🔍 Search
              </button>
            )}
            {user && (
              <div className="flex items-center justify-between px-3 py-1.5 mt-1 border-t border-border pt-2">
                <span className="text-xs text-text-tertiary font-mono">{user.username}</span>
                <button
                  onClick={() => { setMobileMenuOpen(false); logout() }}
                  className="px-2 py-1 text-xs rounded text-text-tertiary hover:text-error hover:bg-error-subtle/50 transition-colors"
                  title="Sign out"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* ── Dashboard ───────────────────────────────────── */

function payloadList<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value as T[]
    }
  }
  return []
}

function DashGlyph({ kind }: { kind: 'agents' | 'sessions' | 'tasks' | 'cron' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      {kind === 'agents' && <><path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z" /><path d="M8.5 12h7M12 8.5v7" /></>}
      {kind === 'sessions' && <><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9.7 9.7 0 0 1-3.8-.8L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z" /></>}
      {kind === 'tasks' && <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>}
      {kind === 'cron' && <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>}
    </svg>
  )
}

function DashboardStat({ label, value, suffix, detail, kind, loading = false, error = false }: {
  label: string
  value: number | string
  suffix?: string
  detail: string
  kind: 'agents' | 'sessions' | 'tasks' | 'cron'
  loading?: boolean
  error?: boolean
}) {
  const muted = loading || error
  return (
    <div className="brand-card brand-card-hover p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-caption font-medium text-text-tertiary">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-accent/15 bg-accent/10 text-accent">
          <DashGlyph kind={kind} />
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={`text-[28px] font-semibold leading-none tracking-tight text-text-primary tabular-nums ${muted ? 'opacity-40' : ''}`}>{muted ? '—' : value}</span>
        {!muted && suffix && <span className="text-caption font-medium text-text-tertiary">{suffix}</span>}
      </div>
      <p className="mt-2 text-caption text-text-tertiary">{loading ? 'carregando…' : error ? 'indisponível' : detail}</p>
    </div>
  )
}

function DashboardPanel({ title, subtitle, action, children, className = '' }: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`brand-card min-w-0 p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h4 font-semibold text-text-primary">{title}</h2>
          {subtitle && <p className="mt-0.5 text-caption text-text-tertiary">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function DashboardEmpty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body-sm text-text-tertiary">{children}</div>
}

function DashboardLoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Carregando" role="status">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border border-border/40 bg-bg-base/30 px-3 py-2.5">
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-surface/60" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface/60" />
            <div className="h-2.5 w-2/3 animate-pulse rounded bg-surface/40" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ResourceMeter({ label, value }: { label: string; value: number }) {
  const color = value < 60 ? 'bg-semantic-success' : value < 80 ? 'bg-semantic-warning' : 'bg-semantic-error'
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-caption">
        <span className="text-text-secondary">{label}</span>
        <span className="font-mono text-text-primary tabular-nums">{value}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-base">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  )
}

function SystemHealthPanel() {
  const { data, isLoading, error } = useQuery<{ cpu: { percent: number }; ram: { percent: number }; disk: { percent: number } }>({
    queryKey: ['hardware-widget'],
    queryFn: async () => {
      const token = localStorage.getItem('agentos_access_token')
      const res = await fetch('/api/analytics/hardware', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Falha ao carregar recursos')
      return res.json()
    },
    refetchInterval: 10_000,
  })

  if (isLoading) {
    return <div className="space-y-4">{['CPU', 'RAM', 'Disco'].map((label) => <div key={label} className="h-8 animate-pulse rounded-lg bg-surface/60" />)}</div>
  }
  if (error || !data) {
    return <DashboardEmpty>Não foi possível ler os recursos do host.</DashboardEmpty>
  }
  return (
    <div className="space-y-4">
      <ResourceMeter label="CPU" value={data.cpu.percent} />
      <ResourceMeter label="RAM" value={data.ram.percent} />
      <ResourceMeter label="Disco" value={data.disk.percent} />
    </div>
  )
}

function DashboardActivityRow({ title, meta, status, tone, kind }: {
  title: string
  meta: string
  status: string
  tone: 'success' | 'warning' | 'info'
  kind: 'sessions' | 'tasks'
}) {
  const toneClass = tone === 'warning'
    ? 'border-warning/20 bg-warning/10 text-warning'
    : tone === 'info'
      ? 'border-info/20 bg-info/10 text-info'
      : 'border-success/20 bg-success/10 text-success'
  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-bg-base text-text-secondary">
        <DashGlyph kind={kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-medium text-text-primary">{title}</p>
        <p className="mt-0.5 truncate text-caption text-text-tertiary">{meta}</p>
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneClass}`}>{status}</span>
    </div>
  )
}

function DashboardPage() {
  const admin = isAdmin()

  const agentsQuery = useQuery<AgentProfile[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetch('/api/agents')
      if (!res.ok) throw new Error('Falha ao carregar agentes')
      return payloadList<AgentProfile>(await res.json(), ['agents'])
    },
    refetchInterval: 15_000,
  })

  const sessionsQuery = useQuery<{ items: SessionItem[]; total: number }>({
    queryKey: ['dashboard-sessions'],
    enabled: admin,
    queryFn: async () => {
      const res = await fetch('/api/sessions?limit=500')
      if (!res.ok) throw new Error('Falha ao carregar sessões')
      const payload = await res.json()
      const items = payloadList<SessionItem>(payload, ['sessions'])
      return { items, total: Array.isArray(payload) ? items.length : (payload?.total ?? items.length) }
    },
    refetchInterval: 15_000,
  })

  const tasksQuery = useQuery<TaskItem[]>({
    queryKey: ['dashboard-tasks'],
    queryFn: async () => {
      const res = await fetch('/api/tasks?limit=500')
      if (!res.ok) throw new Error('Falha ao carregar tarefas')
      return payloadList<TaskItem>(await res.json(), ['tasks'])
    },
    refetchInterval: 15_000,
  })

  const cronQuery = useQuery<CronJob[]>({
    queryKey: ['dashboard-cron'],
    queryFn: async () => {
      const res = await fetch('/api/cron')
      if (!res.ok) throw new Error('Falha ao carregar crons')
      return payloadList<CronJob>(await res.json(), ['jobs'])
    },
    refetchInterval: 15_000,
  })

  const agents = agentsQuery.data ?? []
  const sessions = sessionsQuery.data?.items ?? []
  const tasks = tasksQuery.data ?? []
  const cronJobs = cronQuery.data ?? []

  const activeAgents = agents.filter((agent) => agent.process_alive || agent.kanban_task).length
  const openTasks = tasks.filter((task) => !['done', 'archived'].includes(task.status)).length
  const isCronActive = (job: CronJob) => job.enabled && job.state !== 'paused'
  const activeCrons = cronJobs.filter(isCronActive).length
  const nextCrons = cronJobs
    .filter((job) => isCronActive(job) && job.next_run_at)
    .sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)))
    .slice(0, 4)
  const hasError = agentsQuery.error || tasksQuery.error || cronQuery.error || (admin && sessionsQuery.error)

  const activity = useMemo(() => {
    const sessionRows = sessions.slice(0, 5).map((session) => ({
      id: `session-${session.id}`,
      title: session.title || `Sessão ${sourceLabel(session.source)}`,
      meta: `${sourceLabel(session.source)} · ${formatStartedAt(session.started_at)}`,
      status: session.ended_at ? 'Concluída' : 'Em andamento',
      tone: session.ended_at ? 'success' as const : 'info' as const,
      kind: 'sessions' as const,
      at: session.started_at || '',
    }))
    const taskRows = tasks
      .filter((task) => !['done', 'archived'].includes(task.status))
      .slice(0, 5)
      .map((task) => ({
      id: `task-${task.id}`,
      title: task.title || `Tarefa ${task.id}`,
      meta: `${task.assignee || 'sem responsável'} · ${task.status}`,
      status: task.status === 'review' ? 'Em review' : task.status === 'blocked' ? 'Bloqueada' : 'Em aberto',
      tone: task.status === 'blocked' ? 'warning' as const : task.status === 'review' ? 'warning' as const : 'info' as const,
      kind: 'tasks' as const,
      at: task.created_at || '',
    }))
    return [...sessionRows, ...taskRows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  }, [sessions, tasks])

  const sessionsLoading = admin && sessionsQuery.isLoading
  const sessionsTotal = admin ? sessionsQuery.data?.total : undefined

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Workspace / Visão geral"
        title="Dashboard"
        subtitle="Control plane do Hermes Agent: operação, inteligência e saúde do workspace."
        actions={
          <Link to="/chat" className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition hover:bg-accent-hover">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9.7 9.7 0 0 1-3.8-.8L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z" />
            </svg>
            Abrir chat
          </Link>
        }
      />

      {hasError && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-body-sm text-warning">
          Alguns dados do dashboard não carregaram. Os números abaixo podem estar incompletos.
        </div>
      )}

      <section className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <DashboardStat label="Agentes ativos" value={activeAgents} detail={agents.length ? `${agents.length} no workspace` : 'Nenhum agente conectado'} kind="agents" loading={agentsQuery.isLoading} error={agentsQuery.isError} />
        <DashboardStat label="Sessões" value={admin ? (sessionsTotal ?? '—') : '—'} detail={admin ? 'histórico total' : 'restrito a administradores'} kind="sessions" loading={sessionsLoading} error={admin && sessionsQuery.isError} />
        <DashboardStat label="Tarefas abertas" value={openTasks} detail={openTasks ? 'no fluxo do kanban' : 'nada pendente'} kind="tasks" loading={tasksQuery.isLoading} error={tasksQuery.isError} />
        <DashboardStat label="Crons ativos" value={activeCrons} detail={activeCrons ? 'automações habilitadas' : 'nenhuma ativa'} kind="cron" loading={cronQuery.isLoading} error={cronQuery.isError} />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(290px,.75fr)]">
        <DashboardPanel
          title="Atividade recente"
          subtitle="Sessões e tarefas do workspace"
          action={<span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-success">Ao vivo</span>}
        >
          {activity.length ? (
            <div>{activity.map((row) => <DashboardActivityRow key={row.id} title={row.title} meta={row.meta} status={row.status} tone={row.tone} kind={row.kind} />)}</div>
          ) : sessionsLoading || tasksQuery.isLoading ? (
            <DashboardLoadingRows />
          ) : sessionsQuery.isError || tasksQuery.isError ? (
            <DashboardEmpty>Não foi possível carregar a atividade recente.</DashboardEmpty>
          ) : (
            <DashboardEmpty>Nenhuma atividade recente. Abra o chat para começar.</DashboardEmpty>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Saúde do sistema"
          subtitle="Recursos do host"
          action={<Link to="/analytics" className="text-caption text-accent transition hover:text-accent-hover">Detalhes →</Link>}
        >
          {isAdmin() ? <SystemHealthPanel /> : <DashboardEmpty>Recursos disponíveis apenas para administradores.</DashboardEmpty>}
        </DashboardPanel>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <DashboardPanel
          title="Agentes"
          subtitle="Processos e tarefas do gateway"
          action={<Link to="/analytics" className="text-caption text-accent transition hover:text-accent-hover">Ver analytics →</Link>}
        >
          {agents.length ? (
            <div className="space-y-3">
              {agents.slice(0, 4).map((agent) => {
                const running = agent.process_alive && agent.gateway_state === 'running'
                return (
                  <div key={agent.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-bg-base/40 px-3 py-2.5">
                    <span
                      role="img"
                      aria-label={running ? 'Em execução' : 'Parado'}
                      title={running ? 'Em execução' : 'Parado'}
                      className={`h-2 w-2 shrink-0 rounded-full ${running ? 'bg-semantic-success' : 'bg-text-tertiary'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium text-text-primary">{agent.name}</p>
                      <p className="truncate text-caption text-text-tertiary">{agent.role} · {agent.model}</p>
                    </div>
                    <span className="shrink-0 text-caption text-text-tertiary tabular-nums">{agent.sessions} sess.</span>
                  </div>
                )
              })}
            </div>
          ) : agentsQuery.isLoading ? (
            <DashboardLoadingRows />
          ) : agentsQuery.isError ? (
            <DashboardEmpty>Não foi possível carregar os agentes.</DashboardEmpty>
          ) : (
            <DashboardEmpty>Nenhum agente ativo no gateway.</DashboardEmpty>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Próximos crons"
          subtitle="Agenda do dispatcher"
          action={<Link to="/cron" className="text-caption text-accent transition hover:text-accent-hover">Ver todos →</Link>}
        >
          {nextCrons.length ? (
            <div className="space-y-3">
              {nextCrons.map((job) => (
                <div key={job.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-bg-base/40 px-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-surface/60 text-text-secondary">
                    <DashGlyph kind="cron" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-medium text-text-primary">{job.name}</p>
                    <p className="truncate text-caption text-text-tertiary">{job.schedule_display || job.schedule?.display || 'agendado'}</p>
                  </div>
                  <span className="shrink-0 text-caption text-text-tertiary">{formatRelativeTime(job.next_run_at)}</span>
                </div>
              ))}
            </div>
          ) : cronQuery.isLoading ? (
            <DashboardLoadingRows rows={4} />
          ) : cronQuery.isError ? (
            <DashboardEmpty>Não foi possível carregar os crons.</DashboardEmpty>
          ) : (
            <DashboardEmpty>Nenhum cron agendado.</DashboardEmpty>
          )}
        </DashboardPanel>
      </section>
    </PageContainer>
  )
}

/* ── Health ────────────────────────────────────────── */

function NotFoundPage() {
  return (
    <>
      <NavBar />
      <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-6xl font-bold text-text-tertiary mb-4">404</div>
      <p className="text-body text-text-secondary mb-6">This page doesn't exist.</p>
      <Link to="/" className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors text-sm font-medium">
        Back to Dashboard
      </Link>
      </div>
    </>
  )
}

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
  if (seconds === null || seconds === undefined) return 'Em execução'
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m === 0) return `${rem}s`
  return `${m}m ${rem}s`
}

function sourceBadge(source?: string) {
  if (!source) return 'bg-surface text-text-secondary border border-border'
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

function sourceLabel(source?: string): string {
  if (!source) return 'Desconhecida'
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
  const admin = isAdmin()

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
    enabled: admin,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (search) params.set('search', search)
      if (source) params.set('source', source)
      if (model) params.set('model', model)
      const res = await fetch(`/api/sessions?${params}`)
      if (!res.ok) throw new Error('Falha ao carregar sessões')
      const payload = await res.json()
      // Compat: some backend builds returned a bare array; the shell should
      // render either shape instead of crashing on `sessions.length`.
      if (Array.isArray(payload)) {
        return { sessions: payload, total: payload.length, limit, offset }
      }
      return payload
    },
  })

  const totalPages = data ? Math.ceil((data.total ?? 0) / (data.limit || limit)) : 0
  const currentPage = data ? Math.floor((data.offset ?? 0) / (data.limit || limit)) + 1 : 1
  const sessions = data?.sessions ?? []

  // Fetch unique models for dropdown
  const { data: modelList } = useQuery<string[]>({
    queryKey: ['session-models'],
    enabled: admin,
    queryFn: async () => {
      const res = await fetch('/api/sessions?limit=500')
      if (!res.ok) return []
      const payload = await res.json()
      const list = Array.isArray(payload) ? payload : (payload.sessions ?? [])
      const set = new Set<string>()
      ;(list as SessionItem[]).forEach((s) => { if (s.model) set.add(s.model) })
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
    <PageContainer>
      <PageHeader
        eyebrow="Histórico de conversas"
        title="Sessões"
        subtitle="Mensagens, modelos, ferramentas e duração de cada execução."
        actions={
          <span className="rounded-full border border-border bg-surface/50 px-2.5 py-1 text-caption tabular-nums text-text-secondary">
            {data ? `${data.total} sessões` : '—'}
          </span>
        }
      />

      {!admin ? (
        <div className="brand-card mt-6 px-6 py-12 text-center">
          <p className="text-h4 font-semibold text-text-primary">Sessões restritas</p>
          <p className="mt-1.5 text-body-sm text-text-tertiary">O histórico completo é visível apenas para administradores.</p>
        </div>
      ) : (
        <>
          <div className="brand-card mt-5 flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="Buscar por título..."
              value={rawSearch}
              onChange={(e) => {
                setRawSearch(e.target.value)
                const params = new URLSearchParams(searchParams)
                params.delete('offset')
                setSearchParams(params)
              }}
              className="search-input min-w-0 flex-1 rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
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
              className="rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Todas as fontes</option>
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
              className="rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Todos os modelos</option>
              {modelList?.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <main className="mt-4">
            {isLoading && (
              <div className="brand-card p-6" aria-label="Carregando sessões" role="status">
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <div className="h-4 w-48 animate-pulse rounded bg-surface/60" />
                      <div className="h-4 w-20 animate-pulse rounded bg-surface/60" />
                      <div className="h-4 w-32 animate-pulse rounded bg-surface/60" />
                      <div className="h-4 w-12 animate-pulse rounded bg-surface/60" />
                      <div className="h-4 w-20 animate-pulse rounded bg-surface/60" />
                      <div className="h-4 w-20 animate-pulse rounded bg-surface/60" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
                Não foi possível carregar as sessões.
              </div>
            )}
            {data && sessions.length === 0 && (
              <div className="brand-card px-6 py-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface/60">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <p className="mb-1 text-body text-text-primary">Nenhuma sessão encontrada</p>
                <p className="text-caption text-text-tertiary">Ajuste a busca ou os filtros.</p>
              </div>
            )}
            {data && sessions.length > 0 && (
              <>
                <div role="region" aria-label="Tabela de sessões" tabIndex={0} className="brand-card overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2">
                  <table className="w-full text-sm" aria-label="Lista de sessões">
                    <thead className="bg-surface/35 text-left text-text-secondary">
                      <tr>
                        <th className="px-4 py-3 font-medium text-text-tertiary">Título</th>
                        <th className="px-4 py-3 font-medium text-text-tertiary">Fonte</th>
                        <th className="px-4 py-3 font-medium text-text-tertiary">Modelo</th>
                        <th className="px-4 py-3 text-right font-medium text-text-tertiary">Msgs</th>
                        <th className="px-4 py-3 font-medium text-text-tertiary">Início</th>
                        <th className="px-4 py-3 font-medium text-text-tertiary">Duração</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {sessions.map((s) => (
                        <tr
                          key={s.id}
                          onClick={() => navigate(`/sessions/${encodeURIComponent(s.id)}`)}
                          className="cursor-pointer transition hover:bg-surface/40"
                        >
                          <td className="max-w-xs truncate px-4 py-3 font-medium text-text-primary">
                            <Link
                              to={`/sessions/${encodeURIComponent(s.id)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-accent hover:underline"
                            >
                              {s.title || 'Sem título'}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${sourceBadge(s.source)}`}>
                              {sourceLabel(s.source)}
                            </span>
                            {s.profile && s.profile !== 'default' && (
                              <span className="ml-1 inline-flex items-center rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-text-secondary">
                                {s.profile}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-mono-sm text-text-secondary">{s.model}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{s.message_count}</td>
                          <td className="px-4 py-3 tabular-nums text-text-secondary">{formatStartedAt(s.started_at)}</td>
                          <td className="px-4 py-3 tabular-nums">
                            <span className={`inline-flex items-center gap-1.5 ${s.duration_seconds === null ? 'text-warning' : 'text-text-secondary'}`}>
                              {s.duration_seconds === null && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />}
                              {formatDuration(s.duration_seconds)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <nav aria-label="Paginação de sessões" className="mt-4 flex items-center justify-between text-sm">
                  <button
                    onClick={() => handlePage(offset - limit)}
                    disabled={offset === 0}
                    aria-label="Página anterior"
                    className="rounded-md border border-border bg-surface px-3 py-1.5 text-text-primary transition hover:bg-surface-hover/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span className="text-text-secondary" aria-live="polite">
                    Página {currentPage} de {totalPages || 1}
                  </span>
                  <button
                    onClick={() => handlePage(offset + limit)}
                    disabled={!data || offset + limit >= data.total}
                    aria-label="Próxima página"
                    className="rounded-md border border-border bg-surface px-3 py-1.5 text-text-primary transition hover:bg-surface-hover/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </nav>
              </>
            )}
          </main>
        </>
      )}
    </PageContainer>
  )
}

/* ── Task Session Log Viewer ─────────────────────── */

function TaskSessionLog({ taskId }: { taskId: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['task-logs', taskId],
    queryFn: () => fetch(`/api/tasks/${taskId}/logs`).then(r => r.json()),
    enabled: isOpen,
    refetchInterval: isOpen ? 10000 : false,
  })

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="text-xs text-accent hover:text-accent/80 transition flex items-center gap-1"
      >
        <span>📋</span> Mostrar log da sessão
      </button>
    )
  }

  const logContent = data?.content as string | null
  const truncated = data?.truncated as boolean

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-text-secondary">Log da sessão</h4>
        <button
          onClick={() => setIsOpen(false)}
          className="text-xs text-text-tertiary hover:text-text-secondary transition"
        >
          Ocultar log
        </button>
      </div>
      {isLoading ? (
        <p className="text-xs text-text-tertiary italic">Carregando log…</p>
      ) : !logContent ? (
        <p className="text-xs text-text-tertiary italic">Nenhum log disponível para esta tarefa.</p>
      ) : (
        <>
          {truncated && (
            <p className="text-xs text-warning mb-2">⚠ Log truncado (mostrando os últimos ~100KB)</p>
          )}
          <LogRenderer content={logContent} />
        </>
      )}
    </div>
  )
}

function LogRenderer({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Reasoning block: ┌─ Reasoning ─┐ ... └───┘
    if (/^┌─.*─┐/.test(line)) {
      const reasoningLines: string[] = []
      i++
      while (i < lines.length && !/^└─.*─┘/.test(lines[i])) {
        reasoningLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // skip closing └───┘
      elements.push(
        <div key={elements.length} className="border-l-2 border-accent pl-3 py-2 bg-surface/30 rounded-r my-1">
          <pre className="text-xs text-text-secondary whitespace-pre-wrap">{reasoningLines.join('\n')}</pre>
        </div>
      )
      continue
    }

    // Hermes message block: ╭─ ... ╮ ... ╰─...─╯
    if (/^╭─/.test(line)) {
      const msgLines: string[] = []
      i++
      while (i < lines.length && !/^╰─/.test(lines[i])) {
        msgLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // skip closing ╰───╯
      elements.push(
        <div key={elements.length} className="border-l-2 border-accent pl-3 py-2 bg-accent-subtle/20 rounded-r my-1">
          <pre className="text-xs text-text-primary whitespace-pre-wrap">{msgLines.join('\n')}</pre>
        </div>
      )
      continue
    }

    // Tool call: ┊ 📋 preparing ... or ┊ ⚡ ...
    if (/^\s*┊\s*📋/.test(line)) {
      const match = line.match(/┊\s*📋\s*preparing\s+(\S+)/)
      elements.push(
        <div key={elements.length} className="flex items-center gap-1.5 my-0.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface text-text-secondary text-xs border border-border">
            📋 {match?.[1] || 'preparing'}
          </span>
        </div>
      )
      i++
      continue
    }

    // Tool result: ┊ ⚡ tool_name ... 0.0s
    if (/^\s*┊\s*⚡/.test(line)) {
      const match = line.match(/┊\s*⚡\s*(\S+)\s+(.*)/)
      elements.push(
        <div key={elements.length} className="flex items-center gap-1.5 my-0.5 ml-4">
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-accent-subtle text-accent text-xs font-medium">
            ⚡ {match?.[1] || 'tool'}
          </span>
          {match?.[2] && <span className="text-xs text-text-tertiary">{match[2].trim()}</span>}
        </div>
      )
      i++
      continue
    }

    // Terminal command: ┊ 💻 $ command ... 0.0s
    if (/^\s*┊\s*💻\s*\$/.test(line)) {
      const match = line.match(/┊\s*💻\s*\$\s+(.*)/)
      elements.push(
        <div key={elements.length} className="font-mono text-xs bg-bg-base p-1.5 rounded border border-border my-0.5 ml-4">
          <span className="text-success">$</span> <span className="text-text-primary">{match?.[1]?.trim() || ''}</span>
        </div>
      )
      i++
      continue
    }

    // Terminal preparing: ┊ 💻 preparing terminal…
    if (/^\s*┊\s*💻\s*preparing/.test(line)) {
      elements.push(
        <div key={elements.length} className="flex items-center gap-1.5 my-0.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface text-text-tertiary text-xs border border-border">
            💻 preparing terminal…
          </span>
        </div>
      )
      i++
      continue
    }

    // Kanban success: ┊ ✔ ...
    if (/^\s*┊\s*✔/.test(line)) {
      elements.push(
        <div key={elements.length} className="flex items-center gap-1.5 my-0.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-success-subtle text-success text-xs">
            ✔ {line.replace(/^\s*┊\s*✔\s*/, '')}
          </span>
        </div>
      )
      i++
      continue
    }

    // Session summary lines (skip noise)
    if (/^(Resume this session|Session:|Duration:|Messages:)/.test(line.trim())) {
      elements.push(
        <div key={elements.length} className="text-xs text-text-tertiary my-0.5">{line.trim()}</div>
      )
      i++
      continue
    }

    // Regular text (skip empty lines and warnings)
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('Warning:')) {
      elements.push(
        <div key={elements.length} className="text-xs text-text-secondary my-0.5">{trimmed}</div>
      )
    }
    i++
  }

  return (
    <div className="max-h-96 overflow-y-auto rounded border border-border bg-bg-base/60 p-3 space-y-0.5">
      {elements}
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

export function MarkdownRenderer({ content }: { content: string }) {
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

/* ── Artifact Preview ──────────────────────────────── */

const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.tsx', '.jsx', '.yaml', '.yml', '.json',
  '.sh', '.bash', '.css', '.html', '.xml', '.toml', '.ini', '.cfg',
  '.sql', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.rb',
  '.php', '.swift', '.kt', '.scala', '.r', '.lua', '.pl', '.dockerfile',
  '.makefile', '.vue', '.svelte',
])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function getLanguageFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
    '.tsx': 'tsx', '.jsx': 'jsx', '.yaml': 'yaml', '.yml': 'yaml',
    '.json': 'json', '.sh': 'bash', '.bash': 'bash', '.css': 'css',
    '.html': 'html', '.xml': 'xml', '.toml': 'toml', '.sql': 'sql',
    '.go': 'go', '.rs': 'rust', '.java': 'java', '.c': 'c',
    '.cpp': 'cpp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
    '.kt': 'kotlin', '.scala': 'scala', '.r': 'r', '.lua': 'lua',
    '.pl': 'perl', '.vue': 'vue', '.svelte': 'svelte',
  }
  return map[ext] || 'text'
}

function encodeArtifactPath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/')
}

type ArtNode = { folders: Map<string, ArtNode>; files: any[] }

function buildArtifactTree(files: any[]): ArtNode {
  const root: ArtNode = { folders: new Map(), files: [] }
  for (const f of files) {
    const rel: string = f.relpath || f.name
    const parts = rel.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.folders.get(parts[i])
      if (!next) {
        next = { folders: new Map(), files: [] }
        node.folders.set(parts[i], next)
      }
      node = next
    }
    node.files.push({ ...f, relpath: rel })
  }
  return root
}

function countArtFiles(node: ArtNode): number {
  let n = node.files.length
  for (const child of node.folders.values()) n += countArtFiles(child)
  return n
}

function ArtifactFileRow({ file, taskId, previewFile, setPreviewFile }: {
  file: any; taskId: string; previewFile: string | null; setPreviewFile: (v: string | null) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-3 p-2 rounded hover:bg-surface/40 group">
        <span className="text-lg">{fileIcon(file.type)}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary truncate">{file.name}</p>
          <p className="text-xs text-text-tertiary">{formatFileSize(file.size)} • {formatTime(file.modified)}</p>
        </div>
        <button
          onClick={async () => {
            const res = await fetch(`/api/tasks/${taskId}/artifacts/${encodeArtifactPath(file.relpath)}`)
            if (!res.ok) return
            const url = URL.createObjectURL(await res.blob())
            const a = document.createElement('a')
            a.href = url
            a.download = file.name
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 text-xs text-accent hover:text-accent-hover transition"
        >
          ⬇ Baixar
        </button>
        <button
          onClick={() => setPreviewFile(previewFile === file.relpath ? null : file.relpath)}
          className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 text-xs text-accent hover:text-accent-hover transition"
        >
          {previewFile === file.relpath ? '✕ Fechar' : '👁 Visualizar'}
        </button>
      </div>
      {previewFile === file.relpath && (
        <ArtifactPreview filename={file.relpath} taskId={taskId} />
      )}
    </div>
  )
}

function ArtifactFolderNode({ name, node, taskId, previewFile, setPreviewFile }: {
  name: string; node: ArtNode; taskId: string; previewFile: string | null; setPreviewFile: (v: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 p-2 rounded hover:bg-surface/40 text-left transition"
        aria-expanded={open}
      >
        <span className="text-xs text-text-tertiary w-3">{open ? '▾' : '▸'}</span>
        <span className="text-lg">{open ? '📂' : '📁'}</span>
        <span className="text-sm text-text-primary flex-1 truncate">{name}</span>
        <span className="text-xs text-text-tertiary">{countArtFiles(node)} arquivo{countArtFiles(node) === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div className="ml-4 pl-2 border-l border-border">
          <ArtifactTreeNodes node={node} taskId={taskId} previewFile={previewFile} setPreviewFile={setPreviewFile} />
        </div>
      )}
    </div>
  )
}

function ArtifactTreeNodes({ node, taskId, previewFile, setPreviewFile }: {
  node: ArtNode; taskId: string; previewFile: string | null; setPreviewFile: (v: string | null) => void
}) {
  return (
    <>
      {[...node.folders.entries()].map(([name, child]) => (
        <ArtifactFolderNode key={name} name={name} node={child} taskId={taskId} previewFile={previewFile} setPreviewFile={setPreviewFile} />
      ))}
      {node.files.map((f: any) => (
        <ArtifactFileRow key={f.relpath} file={f} taskId={taskId} previewFile={previewFile} setPreviewFile={setPreviewFile} />
      ))}
    </>
  )
}

function ArtifactTree({ files, taskId, previewFile, setPreviewFile }: {
  files: any[]; taskId: string; previewFile: string | null; setPreviewFile: (v: string | null) => void
}) {
  const root = useMemo(() => buildArtifactTree(files), [files])
  return <ArtifactTreeNodes node={root} taskId={taskId} previewFile={previewFile} setPreviewFile={setPreviewFile} />
}

function ArtifactPreview({ filename, taskId }: { filename: string; taskId: string }) {
  const [mode, setMode] = useState<'preview' | 'raw'>('preview')
  const ext = getFileExtension(filename)
  const isCode = CODE_EXTENSIONS.has(ext)
  const isVideo = VIDEO_EXTENSIONS.has(ext)
  const isAudio = AUDIO_EXTENSIONS.has(ext)
  const isImage = IMAGE_EXTENSIONS.has(ext)
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext)
  const isPdf = ext === '.pdf'
  // Binary formats that can't be fetched as text
  const isBinary = isVideo || isAudio || isImage || isPdf
  // WI-3 (F-M4-08): media elements can't set Authorization headers, and tokens in
  // URLs leak via logs/referrers/history. Binary previews load through the
  // authenticated fetch (global interceptor) + blob object URLs instead of the
  // old ?token= query-param pattern.
  const previewUrl = `/api/tasks/${taskId}/artifacts/${filename.split('/').map(encodeURIComponent).join('/')}?preview=true`

  // Artifact bytes must NEVER be refetched: the app's QueryClient has a
  // global refetchInterval of 5s (live data default), and a refetch here
  // swaps the object URL — <video>/<img> see a new src and reload from
  // scratch every 5 seconds (reported bug: video preview resets while
  // playing). Artifact bytes are immutable per (task, filename), so the
  // query is fully refetch-immune and cached for the whole session.
  const STATIC_QUERY = {
    refetchInterval: false as const,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: Infinity,
  }

  const { data: content, isLoading } = useQuery({
    queryKey: ['artifact-content', taskId, filename],
    queryFn: async () => {
      const res = await fetch(previewUrl)
      if (!res.ok) throw new Error('Failed to fetch artifact')
      return res.text()
    },
    enabled: !isBinary,
    ...STATIC_QUERY,
  })

  const { data: blobUrl, isLoading: blobLoading } = useQuery({
    queryKey: ['artifact-blob', taskId, filename],
    queryFn: async () => {
      const res = await fetch(previewUrl)
      if (!res.ok) throw new Error('Failed to fetch artifact')
      return URL.createObjectURL(await res.blob())
    },
    enabled: isBinary,
    ...STATIC_QUERY,
  })

  const showToggle = isCode || isMarkdown || (!isBinary && !isCode && !isMarkdown)

  return (
    <div className="mt-2 rounded-lg border border-border bg-surface/20 overflow-hidden">
      {/* Toggle header */}
      {showToggle && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-bg-base/50">
          <button
            onClick={() => setMode('preview')}
            className={`px-2 py-0.5 text-xs rounded transition ${mode === 'preview' ? 'bg-accent/20 text-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
          >
            Visualizar
          </button>
          <button
            onClick={() => setMode('raw')}
            className={`px-2 py-0.5 text-xs rounded transition ${mode === 'raw' ? 'bg-accent/20 text-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
          >
            Bruto
          </button>
          <span className="ml-auto text-xs text-text-tertiary">{filename}</span>
        </div>
      )}

      {/* Preview content */}
      <div className="p-0">
        {(isLoading || (isBinary && blobLoading)) && (
          <p className="text-xs text-text-tertiary p-3">Carregando visualização…</p>
        )}
        {isBinary && !blobUrl && !blobLoading && (
          <p className="text-xs text-error p-3">Falha ao carregar a visualização.</p>
        )}

        {/* Raw mode */}
        {mode === 'raw' && content && (
          <pre className="bg-bg-base p-3 text-xs text-text-secondary overflow-auto max-h-[32rem] font-mono whitespace-pre-wrap break-all">
            {content}
          </pre>
        )}

        {/* Markdown preview */}
        {mode === 'preview' && isMarkdown && content && (
          <div className="p-3">
            <MarkdownRenderer content={content} />
          </div>
        )}

        {/* Code preview */}
        {mode === 'preview' && isCode && content && (
          <div className="bg-bg-base">
            <SyntaxHighlighter
              language={getLanguageFromExt(ext)}
              style={monokai}
              customStyle={{
                margin: 0,
                background: '#0B1120',
                fontSize: '0.75rem',
                maxHeight: '32rem',
              }}
              showLineNumbers
              wrapLongLines
            >
              {content}
            </SyntaxHighlighter>
          </div>
        )}

        {/* Video preview */}
        {isVideo && (
          <div className="p-3">
            <video
              controls
              src={blobUrl}
              className="max-w-full max-h-96 rounded border border-border"
            />
          </div>
        )}

        {/* Audio preview */}
        {isAudio && (
          <div className="p-3">
            <audio controls src={blobUrl} className="w-full" />
          </div>
        )}

        {/* Image preview */}
        {isImage && (
          <div className="p-3">
            <img
              src={blobUrl}
              alt={filename}
              className="max-w-full rounded border border-border"
            />
          </div>
        )}

        {/* PDF preview */}
        {isPdf && (
          <iframe
            src={blobUrl}
            title={filename}
            className="w-full h-[32rem] border-0"
          />
        )}

        {/* Fallback: plain text for unknown types in preview mode */}
        {mode === 'preview' && !isCode && !isMarkdown && !isBinary && content && (
          <pre className="bg-bg-base p-3 text-xs text-text-secondary overflow-auto max-h-[32rem] font-mono whitespace-pre-wrap break-all">
            {content}
          </pre>
        )}
      </div>
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
    <div className="mb-1 w-full min-w-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide reasoning' : 'Show reasoning'}
        className="text-caption text-text-tertiary italic hover:text-text-secondary transition"
      >
        {expanded ? 'Hide thinking…' : 'Thinking…'}
      </button>
      {expanded && (
        <div className="mt-1 text-caption text-text-tertiary italic whitespace-pre-wrap w-full min-w-0 max-h-80 overflow-y-auto border border-border rounded-lg p-2 bg-bg-base/40">
          <div className="w-full min-w-0" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            <MarkdownRenderer content={content} />
          </div>
        </div>
      )}
    </div>
  )
}

function ToolMessage({ msg }: { msg: MessageItem }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="w-full my-2 border border-border rounded-lg bg-bg-elevated font-mono min-w-0 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${msg.tool_name || 'tool'} result` : `Expand ${msg.tool_name || 'tool'} result`}
        className="w-full flex items-center justify-between px-3 py-2 text-mono-sm text-text-secondary hover:bg-surface-hover/40 transition cursor-pointer"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="inline-block rounded bg-surface px-1.5 py-0.5 text-overline uppercase shrink-0">
            Tool
          </span>
          <span className="text-mono-sm text-text-secondary truncate">{msg.tool_name || 'unknown'}</span>
        </span>
        <span
          className="text-text-tertiary transition-transform duration-200 shrink-0"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-border max-h-96 w-full min-w-0 overflow-y-auto overflow-x-hidden" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          <div className="w-full min-w-0 max-w-full">
            <MarkdownRenderer content={msg.content || ''} />
          </div>
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
    <div className="flex flex-col items-start my-2 max-w-[80%] min-w-0 w-full">
      {msg.reasoning_content && <ReasoningBlock content={msg.reasoning_content} />}
      <div
        className="bg-surface/60 rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-text-primary w-full min-w-0 overflow-hidden"
        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
      >
        <MarkdownRenderer content={msg.content || ''} />
      </div>
      <span className="text-caption text-text-tertiary mt-1">{formatMessageTime(msg.timestamp)}</span>
    </div>
  )
}

function MessagesSection({ sessionId }: { sessionId: string }) {
  const limit = 100
  const [offset, setOffset] = useState<number | null>(null) // null = haven't determined last page yet
  const [total, setTotal] = useState(0)
  const [pageInput, setPageInput] = useState('')
  const [followTail, setFollowTail] = useState(true) // follow tail: auto-scroll to newest
  const [showScrollButtons, setShowScrollButtons] = useState(false) // only show when content > 2x viewport
  const messagesRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isInitialLoad = useRef(true)

  // First: fetch total count with limit=1
  const { data: countData, isLoading: countLoading } = useQuery<MessagesResponse>({
    queryKey: ['messages-count', sessionId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '1', offset: '0' })
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`)
      if (!res.ok) throw new Error('Failed to load message count')
      return res.json()
    },
  })

  // Once we know the total, set offset to last page
  useEffect(() => {
    if (countData && offset === null) {
      const t = countData.total
      setTotal(t)
      if (t === 0) {
        setOffset(0)
      } else {
        const lastOffset = Math.floor((t - 1) / limit) * limit
        setOffset(lastOffset)
      }
    }
  }, [countData, offset])

  // Fetch the actual page of messages
  const { data, isLoading: messagesLoading, error } = useQuery<MessagesResponse>({
    queryKey: ['messages', sessionId, offset, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset!) })
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`)
      if (!res.ok) throw new Error('Failed to load messages')
      return res.json()
    },
    enabled: offset !== null,
    // When follow tail is on, refetch every 10s to check for new messages
    refetchInterval: followTail ? 10_000 : false,
  })

  // Sync total from message response
  useEffect(() => {
    if (data) {
      const newTotal = data.total
      const totalChanged = newTotal !== total
      setTotal(newTotal)
      // On first successful load, scroll to bottom
      if (isInitialLoad.current) {
        isInitialLoad.current = false
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'auto' })
        }, 50)
      } else if (followTail && totalChanged) {
        // Follow tail: if new messages arrived, re-jump to last page and scroll to bottom
        const newLastOffset = Math.floor((newTotal - 1) / limit) * limit
        if (offset !== newLastOffset) {
          setOffset(newLastOffset)
        }
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 50)
      }
    }
  }, [data, followTail])

  // Check if scroll buttons should be visible (content > 2x viewport)
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const checkHeight = () => {
      const viewportHeight = window.innerHeight
      const contentHeight = container.scrollHeight
      setShowScrollButtons(contentHeight > viewportHeight * 2)
    }

    checkHeight()
    const observer = new ResizeObserver(checkHeight)
    observer.observe(container)
    window.addEventListener('resize', checkHeight)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', checkHeight)
    }
  }, [data])

  // Pagination calculations
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1
  const currentPage = offset !== null ? Math.floor(offset / limit) + 1 : 1
  const isFirstPage = currentPage <= 1
  const isLastPage = currentPage >= totalPages
  const rangeStart = offset !== null ? offset + 1 : 0
  const rangeEnd = offset !== null ? Math.min(offset + (data?.messages.length || 0), total) : 0

  const scrollToMessagesTop = () => {
    messagesRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const goToPage = (page: number, fromFollowTail = false) => {
    const clamped = Math.max(1, Math.min(page, totalPages))
    const newOffset = (clamped - 1) * limit
    setOffset(newOffset)
    // If user manually navigates away from last page, disable follow tail
    if (!fromFollowTail && clamped !== totalPages) {
      setFollowTail(false)
    }
    // Scroll to top of messages area after render
    setTimeout(() => scrollToMessagesTop(), 50)
  }

  const goToFirstPage = () => {
    setFollowTail(false)
    goToPage(1)
    setTimeout(() => scrollToMessagesTop(), 50)
  }

  const goToLastPage = () => {
    setFollowTail(true)
    goToPage(totalPages, true)
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 50)
  }

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const num = parseInt(pageInput, 10)
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      goToPage(num)
      setPageInput('')
    }
  }

  // Loading state
  if (countLoading || (offset === null && messagesLoading)) return (
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
  if (!data || total === 0) return <p className="text-text-tertiary py-6">No messages in this session</p>

  return (
    <div className="flex flex-col">
      {/* Pagination controls at top */}
      <div ref={messagesRef} className="flex items-center justify-between gap-3 px-2 py-3 border-b border-border mb-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="text-caption text-text-tertiary">
            Showing {rangeStart}–{rangeEnd} of {total}
          </div>
          <label className="flex items-center gap-1.5 text-caption text-text-tertiary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={followTail}
              onChange={(e) => {
                const checked = e.target.checked
                setFollowTail(checked)
                if (checked) {
                  // Re-enabling: jump to last page and scroll to bottom
                  goToPage(totalPages, true)
                  setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
                }
              }}
              className="w-3.5 h-3.5 rounded border-border accent-accent cursor-pointer"
            />
            Follow tail
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goToFirstPage}
            disabled={isFirstPage}
            className="px-2 py-1 rounded-md text-xs bg-bg-elevated border border-border text-text-secondary hover:bg-surface-hover/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title="First page (oldest)"
          >
            ««
          </button>
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={isFirstPage}
            className="px-2 py-1 rounded-md text-xs bg-bg-elevated border border-border text-text-secondary hover:bg-surface-hover/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ‹ Prev
          </button>
          <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1">
            <span className="text-caption text-text-tertiary">Page</span>
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              placeholder={String(currentPage)}
              className="w-10 text-center text-xs bg-bg-elevated border border-border rounded px-1 py-0.5 text-text-primary focus:outline-none focus:border-accent"
              title={`Jump to page (1–${totalPages})`}
            />
            <span className="text-caption text-text-tertiary">of {totalPages}</span>
          </form>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={isLastPage}
            className="px-2 py-1 rounded-md text-xs bg-bg-elevated border border-border text-text-secondary hover:bg-surface-hover/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next ›
          </button>
          <button
            onClick={goToLastPage}
            disabled={isLastPage}
            className="px-2 py-1 rounded-md text-xs bg-bg-elevated border border-border text-text-secondary hover:bg-surface-hover/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title="Last page (newest)"
          >
            »»
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex flex-col px-2">
        {messagesLoading && offset !== null ? (
          <div className="space-y-3 py-6" aria-label="Loading page" role="status">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                <div className="animate-skeleton rounded-2xl px-4 py-3 bg-surface/30 max-w-[70%] min-w-[12rem]">
                  <div className="h-3 w-full rounded bg-surface/40 mb-2" />
                  <div className="h-3 w-3/4 rounded bg-surface/40" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          data.messages.map((msg) => {
            if (msg.role === 'user') return <UserMessage key={msg.id} msg={msg} />
            if (msg.role === 'assistant') return <AssistantMessage key={msg.id} msg={msg} />
            return <ToolMessage key={msg.id} msg={msg} />
          })
        )}
      </div>
      <div ref={bottomRef} />

      {/* Floating navigation buttons — only visible when content > 2x viewport */}
      {showScrollButtons && (
        <div className="fixed bottom-20 right-4 flex flex-col gap-2 z-50">
          <button
            onClick={() => messagesRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-bg-elevated border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover/80 transition shadow-lg"
            title="Scroll to top of page"
          >
            ↑
          </button>
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-bg-elevated border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover/80 transition shadow-lg"
            title="Scroll to bottom of page"
          >
            ↓
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Session Detail Page ───────────────────────────── */

function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const admin = isAdmin()

  const { data, isLoading, error } = useQuery<SessionItem>({
    queryKey: ['session', id],
    enabled: admin,
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id!)}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('Sessão não encontrada')
        throw new Error('Falha ao carregar a sessão')
      }
      const payload = await res.json()
      if (!payload || Array.isArray(payload) || !payload.id) throw new Error('Sessão não encontrada')
      return payload
    },
  })

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Detalhe da sessão"
        title={data?.title || 'Sessão'}
        subtitle={data ? `${sourceLabel(data.source)} · ${data.model || '—'}` : 'Histórico e mensagens da execução.'}
        actions={
          <button
            onClick={() => navigate('/sessions')}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3.5 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
          >
            ← Voltar
          </button>
        }
      />

      {!admin ? (
        <div className="brand-card mt-6 px-6 py-12 text-center">
          <p className="text-h4 font-semibold text-text-primary">Sessão restrita</p>
          <p className="mt-1.5 text-body-sm text-text-tertiary">O detalhe da sessão é visível apenas para administradores.</p>
        </div>
      ) : (
        <div className="mx-auto mt-6 max-w-4xl">
          {isLoading && (
            <div className="brand-card p-6" role="status" aria-label="Carregando sessão">
              <div className="h-4 w-40 animate-pulse rounded bg-surface/60" />
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-surface/40" />
                ))}
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
              Não foi possível carregar a sessão.
            </div>
          )}

          {data && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${sourceBadge(data.source)}`}>
                  {sourceLabel(data.source)}
                </span>
                {data.profile && data.profile !== 'default' && (
                  <span className="inline-flex items-center rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-text-secondary">
                    {data.profile}
                  </span>
                )}
                <span className="font-mono text-mono-sm text-text-secondary">{data.model || '—'}</span>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="brand-card p-4">
                  <p className="mb-1 text-caption text-text-tertiary">ID</p>
                  <p className="break-all font-mono text-sm text-text-primary">{data.id}</p>
                </div>
                <div className="brand-card p-4">
                  <p className="mb-1 text-caption text-text-tertiary">Tipo de chat</p>
                  <p className="text-sm text-text-primary">{data.chat_type || '—'}</p>
                </div>
                <div className="brand-card p-4">
                  <p className="mb-1 text-caption text-text-tertiary">Início</p>
                  <p className="text-sm text-text-primary">{data.started_at ? formatStartedAt(data.started_at) : '—'}</p>
                </div>
                <div className="brand-card p-4">
                  <p className="mb-1 text-caption text-text-tertiary">Fim</p>
                  <p className="text-sm text-text-primary">{data.ended_at ? formatStartedAt(data.ended_at) : 'Em execução'}</p>
                </div>
                <div className="brand-card p-4">
                  <p className="mb-1 text-caption text-text-tertiary">Duração</p>
                  <p className="text-sm text-text-primary">{formatDuration(data.duration_seconds)}</p>
                </div>
                <div className="brand-card p-4">
                  <p className="mb-1 text-caption text-text-tertiary">Mensagens / tool calls</p>
                  <p className="text-sm text-text-primary">{data.message_count} / {data.tool_call_count}</p>
                </div>
                {data.archived && (
                  <div className="rounded-xl border border-warning/30 bg-warning-subtle p-4 sm:col-span-2">
                    <p className="mb-1 text-caption text-warning">Arquivada</p>
                    <p className="text-sm text-text-primary">Esta sessão está no arquivo.</p>
                  </div>
                )}
              </div>

              <div className="brand-card p-4">
                <h2 className="mb-3 text-h4 font-semibold text-text-primary">Mensagens</h2>
                <MessagesSection key={data.id} sessionId={data.id} />
              </div>
            </>
          )}
        </div>
      )}
    </PageContainer>
  )
}

/* ── Kanban Board ──────────────────────────────────── */

const COLUMN_META = [
  { status: 'triage',  label: 'Triagem',    accent: 'border-l-purple',        header: 'border-purple/50',        badge: 'bg-purple-subtle text-purple border border-purple/20' },
  { status: 'todo',    label: 'Backlog',    accent: 'border-l-text-tertiary', header: 'border-text-tertiary/50', badge: 'bg-surface text-text-tertiary border border-text-tertiary/20' },
  { status: 'ready',   label: 'Pronto',     accent: 'border-l-info',           header: 'border-info/50',           badge: 'bg-info-subtle text-info border border-info/20' },
  { status: 'running', label: 'Executando', accent: 'border-l-warning',        header: 'border-warning/50',        badge: 'bg-warning-subtle text-warning border border-warning/20' },
  { status: 'done',    label: 'Concluído',  accent: 'border-l-success',        header: 'border-success/50',        badge: 'bg-success-subtle text-success border border-success/20' },
  { status: 'blocked', label: 'Bloqueado',  accent: 'border-l-error',          header: 'border-error/50',          badge: 'bg-error-subtle text-error border border-error/20' },
]

const ALL_STATUSES = ['triage', 'todo', 'ready', 'running', 'done', 'blocked', 'archived']
const ALL_ASSIGNEES = ['coder', 'pixel', 'atlas', 'nova', 'nexus', 'hermes']
const ALL_PRIORITIES = [0, 1, 2, 3]

const ALL_WORKSPACE_KINDS = ['scratch', 'workspace', 'dir']

const TRIAGE_TEMPLATE = `## Objetivo
[Descreva o objetivo da task]

## Contexto
[Forneça contexto relevante - problema, motivação, etc.]

## Critérios de Aceitação
- [ ] [Critério 1]
- [ ] [Critério 2]

## Assignee Sugerido
[Sugira um perfil: coder, pixel, atlas, nova, nexus]

## Notas
[Informações adicionais]`

function columnForStatus(status: string): string {
  const known = ['triage', 'todo', 'ready', 'running', 'done', 'blocked']
  return known.includes(status) ? status : 'todo'
}

/* ── Task Editor Modal ─────────────────────────────── */

function TaskEditorModal({ task, onClose, onSaved, initialStatus, initialBody }: {
  task?: TaskItem | TaskDetail
  onClose: () => void
  onSaved: () => void
  initialStatus?: string
  initialBody?: string
}) {
  const queryClient = useQueryClient()
  const isCreate = !task
  const [title, setTitle] = useState(task?.title || '')
  const [body, setBody] = useState(initialBody ?? task?.body ?? '')
  const [assignee, setAssignee] = useState(task?.assignee || 'coder')
  const [priority, setPriority] = useState(task?.priority ?? 2)
  const [status, setStatus] = useState(initialStatus ?? task?.status ?? 'todo')
  const [workspaceKind, setWorkspaceKind] = useState(task?.workspace_kind || 'scratch')
  const [workspacePath, setWorkspacePath] = useState(task?.workspace_path || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const toast = useToast()

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = isCreate ? '/api/tasks' : `/api/tasks/${encodeURIComponent(task!.id)}`
      const method = isCreate ? 'POST' : 'PATCH'
      const payload: Record<string, unknown> = { title, body, assignee: assignee || null, priority, status }
      // Only send workspace_kind on create, or on edit if it changed
      if (isCreate || workspaceKind !== (task?.workspace_kind || 'scratch')) {
        payload.workspace_kind = workspaceKind
      }
      // Send workspace_path if workspace_kind is workspace or dir
      if (workspaceKind === 'workspace' || workspaceKind === 'dir') {
        payload.workspace_path = workspacePath || null
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onMutate: () => { setSaving(true); setError(null) },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      if (task) queryClient.invalidateQueries({ queryKey: ['task', task.id] })
      onSaved()
      onClose()
    },
    onError: (err: Error) => { setError(err.message); setSaving(false); toast(err.message || 'Falha na requisição', 'error') },
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
        aria-label={isCreate ? 'Criar tarefa' : 'Editar tarefa'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-elevated z-10">
          <h2 className="text-h3 font-bold text-text-primary">{isCreate ? 'Nova tarefa' : 'Editar tarefa'}</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 text-text-tertiary hover:text-text-secondary transition-colors"
              title={expanded ? 'Restaurar' : 'Maximizar'}
            >
              {expanded ? '❐' : '⬜'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface/60 transition" aria-label="Fechar">
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-caption text-text-secondary mb-1.5 font-medium">Título</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
              placeholder="Título da tarefa…"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-caption text-text-secondary mb-1.5 font-medium">Descrição (Markdown)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none transition resize-y"
              placeholder="## Objetivo&#10;Descreva a tarefa…"
            />
          </div>

          {/* Grid: assignee, status, priority */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-caption text-text-secondary mb-1.5 font-medium">Responsável</label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
              >
                <option value="">Sem responsável</option>
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
                {ALL_STATUSES.filter((s) => s !== 'archived' || status === 'archived').map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1.5 font-medium">Prioridade</label>
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

          {/* Workspace kind selector */}
          <div>
            <label className="block text-caption text-text-secondary mb-1.5 font-medium">
              Tipo de workspace
            </label>
            <div className="flex items-center gap-3">
              <select
                value={workspaceKind}
                onChange={(e) => setWorkspaceKind(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
              >
                {ALL_WORKSPACE_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              {isCreate && (
                <button
                  type="button"
                  onClick={() => { setStatus('triage'); setBody(TRIAGE_TEMPLATE) }}
                  className="shrink-0 rounded-md border border-purple/30 bg-purple-subtle px-3 py-2 text-sm text-purple hover:bg-purple/20 transition"
                  title="Definir status Triagem e carregar o template de especificação"
                >
                  Template de triagem
                </button>
              )}
            </div>
            <p className="text-caption text-text-tertiary mt-1">
              <span className="text-text-secondary">scratch</span> = temporário (apagado ao concluir) ·{' '}
              <span className="text-text-secondary">workspace</span> = diretório persistente da tarefa ·{' '}
              <span className="text-text-secondary">dir</span> = diretório compartilhado persistente
            </p>
            {/* Workspace path field - only show for workspace or dir */}
            {(workspaceKind === 'workspace' || workspaceKind === 'dir') && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Caminho do workspace {workspaceKind === 'dir' ? '(diretório compartilhado)' : '(gerado automaticamente se vazio)'}
                </label>
                <input
                  type="text"
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder={workspaceKind === 'dir' ? '/opt/data/shared/my-project' : '/opt/data/kanban/workspaces/{task_id}'}
                  className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary font-mono focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
                />
                <p className="text-caption text-text-tertiary mt-1">
                  {workspaceKind === 'dir'
                    ? 'Caminho do diretório compartilhado — persiste entre tarefas'
                    : 'Deixe vazio para gerar automaticamente a partir do ID da tarefa'}
                </p>
              </div>
            )}
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
            Cancelar
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saving || !title.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm text-white font-medium hover:bg-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando…' : (isCreate ? 'Criar tarefa' : 'Salvar alterações')}
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
    <div className="brand-card mb-4 flex flex-wrap items-center gap-3 p-3">
      {/* Search */}
      <div className="relative min-w-[200px] flex-1">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Buscar tarefas…"
          className="w-full rounded-md border border-border bg-bg-base py-1.5 pl-9 pr-3 text-sm text-text-primary outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>

      {/* Assignee filter */}
      <select
        value={filters.assignee}
        onChange={(e) => onChange({ ...filters, assignee: e.target.value })}
        className={selectClass}
        title="Filtrar por responsável"
      >
        <option value="">Todos os responsáveis</option>
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
        title="Filtrar por prioridade"
      >
        <option value="">Todas as prioridades</option>
        {ALL_PRIORITIES.map((p) => (
          <option key={p} value={String(p)}>{priorityLabel(p)}</option>
        ))}
      </select>

      {/* Status filter (column highlight) */}
      <select
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
        className={selectClass}
        title="Filtrar por status"
      >
        <option value="">Todos os status</option>
        {ALL_STATUSES.filter((s) => s !== 'archived').map((s) => (
          <option key={s} value={s}>{COLUMN_META.find((c) => c.status === s)?.label ?? s}</option>
        ))}
      </select>

      {/* Clear */}
      {(filters.search || filters.assignee || filters.priority || filters.status) && (
        <button
          onClick={() => onChange({ search: '', assignee: '', priority: '', status: '' })}
          className="px-2 text-caption text-text-tertiary transition hover:text-text-primary"
        >
          Limpar filtros
        </button>
      )}

      {/* Total count badge */}
      {stats && typeof stats.total === 'number' && (
        <span className="ml-auto text-caption text-text-tertiary">
          {stats.total} tarefa{stats.total === 1 ? '' : 's'}
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

function statusLabel(status?: string): string {
  if (!status) return '—'
  const map: Record<string, string> = {
    archived: 'Arquivada',
    triage: 'Triagem',
    todo: 'Backlog',
    ready: 'Pronto',
    running: 'Executando',
    done: 'Concluído',
    blocked: 'Bloqueado',
    completed: 'Concluído',
    crashed: 'Falhou',
    gave_up: 'Desistiu',
    rate_limited: 'Rate limit',
    reclaimed: 'Recuperado',
    spawn_failed: 'Falha ao iniciar',
    timed_out: 'Tempo esgotado',
  }
  return map[status] ?? COLUMN_META.find((c) => c.status === status)?.label ?? status
}

function outcomeLabel(outcome?: string | null): string {
  if (!outcome) return '—'
  const map: Record<string, string> = {
    blocked: 'Bloqueado',
    completed: 'Concluído',
    crashed: 'Falhou',
    gave_up: 'Desistiu',
    rate_limited: 'Rate limit',
    reclaimed: 'Recuperado',
    spawn_failed: 'Falha ao iniciar',
    timed_out: 'Tempo esgotado',
    done: 'Concluído',
  }
  return map[outcome] ?? outcome
}

function TaskCard({ task, isOverlay, onEdit, onArchive }: { task: TaskItem; isOverlay?: boolean; onEdit?: (task: TaskItem) => void; onArchive?: (task: TaskItem) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task }, disabled: !isAdmin() })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging && !isOverlay ? 0.25 : 1,
    // Touch: without this the browser consumes pointermove for scrolling and
    // PointerSensor (distance: 5) never completes activation on touch devices
    // (tablet / Z Fold drag-and-drop silently did nothing). Only applied when
    // the card is actually draggable — viewer cards keep scroll-by-card.
    touchAction: isAdmin() ? 'none' : 'auto',
  }

  const handleClick = (_e: React.MouseEvent) => {
    // DnD kit activationConstraint handles click vs drag; navigation is allowed here.
    navigate(`/tasks/${encodeURIComponent(task.id)}`)
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit?.(task)
  }

  const handleArchiveClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onArchive) {
      onArchive(task)
    } else {
      // Direct API call fallback
      fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      }).then(() => queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] }))
    }
  }

  const isArchived = task.status === 'archived'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      tabIndex={0}
      role="button"
      aria-label={`Tarefa ${task.title || 'Sem título'}. Prioridade ${priorityLabel(task.priority)}. Responsável ${task.assignee || 'sem responsável'}. ${task.run_count} execuções. ${task.comment_count} comentários.`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigate(`/tasks/${encodeURIComponent(task.id)}`)
        }
      }}
      className={`brand-card brand-card-hover card-focus mb-3 cursor-pointer p-3 transition border-l-4 ${COLUMN_META.find((c) => c.status === columnForStatus(task.status))?.accent || 'border-l-text-tertiary'} ${isOverlay ? 'shadow-lg rotate-1' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-body-sm font-medium text-text-primary line-clamp-2 leading-snug flex-1 prose-kanban-card">
          <MarkdownRenderer content={task.title || 'Sem título'} />
        </div>
        {(onEdit || onArchive) && !isOverlay && isAdmin() && (
          <div className="flex items-center gap-0.5 shrink-0">
            {onEdit && (
            <button
              onClick={handleEditClick}
              className="p-1 rounded text-text-tertiary hover:text-accent hover:bg-surface/60 transition opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              aria-label="Edit task"
              title="Edit task"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            )}
            {!isArchived && onArchive && (
              <button
                onClick={handleArchiveClick}
                className="p-1 rounded text-text-tertiary hover:text-warning hover:bg-surface/60 transition opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                aria-label="Archive task"
                title="Archive task"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
              </button>
            )}
            {isArchived && onArchive && (
              <button
                onClick={handleArchiveClick}
                className="p-1 rounded text-text-tertiary hover:text-success hover:bg-surface/60 transition opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                aria-label="Unarchive task"
                title="Unarchive task"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="12" y1="12" x2="12" y2="12"/></svg>
              </button>
            )}
          </div>
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
            {task.run_count} execuç{task.run_count === 1 ? 'ão' : 'ões'}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-caption text-text-tertiary">{task.created_date}</span>
        {task.comment_count > 0 && (
          <span className="text-caption text-text-tertiary">
            {task.comment_count} comentári{task.comment_count === 1 ? 'o' : 'os'}
          </span>
        )}
      </div>
    </div>
  )
}

function KanbanColumn({ label, status, tasks, onEdit, onArchive, bulkSelectMode, selectedIds, onToggleSelect }: {
  label: string
  status: string
  tasks: TaskItem[]
  onEdit?: (task: TaskItem) => void
  onArchive?: (task: TaskItem) => void
  bulkSelectMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}) {
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
          <div key={task.id} className="group flex items-start gap-1.5">
            {bulkSelectMode && (
              <input
                type="checkbox"
                checked={selectedIds?.has(task.id) || false}
                onChange={() => onToggleSelect?.(task.id)}
                className="mt-3 shrink-0 cursor-pointer accent-accent"
                aria-label={`Selecionar tarefa ${task.title}`}
              />
            )}
            <div className="flex-1">
              <TaskCard task={task} onEdit={onEdit} onArchive={onArchive} />
            </div>
          </div>
        ))}
        {tasks.length === 0 && (
          <p className="py-6 text-center text-caption text-text-tertiary">Nenhuma tarefa</p>
        )}
      </div>
    </div>
  )
}

function KanbanBoardPage() {
  const toast = useToast()
  const [showArchived, setShowArchived] = useState(false)
  const [draggedTask, setDraggedTask] = useState<TaskItem | null>(null)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createTriageModalOpen, setCreateTriageModalOpen] = useState(false)
  const [filters, setFilters] = useState<FilterState>({ search: '', assignee: '', priority: '', status: '' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSelectMode, setBulkSelectMode] = useState(false)
  const queryClient = useQueryClient()

  const sensors = useSensors(
    // Mouse: arraste imediato após 5px (comportamento de desktop preservado).
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    // Touch: toque longo (200ms) ativa o drag; swipe rápido rola a coluna.
    // Sem isso qualquer rolagem que aterrissa num card o arranca (relato do
    // device check no Z Fold). tolerance=8 ignora o tremor do dedo.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
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
      if (!res.ok) throw new Error(await apiErrorMessage(res))
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
    onSuccess: (data: any, vars: { taskId: string; status: string }) => {
      // M30-b: o backend pode coagir o status (claim vivo → running) —
      // avisar em vez de o card "pular" de volta silenciosamente
      if (data?.status && vars?.status && data.status !== vars.status) {
        toast(`Worker ativo nesta task — status real: "${data.status}"`, 'info')
      }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks', 'all'], context.previousTasks)
      }
      toast(_err instanceof Error ? _err.message : 'Move failed', 'error')  // M28-02
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      queryClient.invalidateQueries({ queryKey: ['kanban', 'stats'] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: async ({ taskId, archive }: { taskId: string; archive: boolean }) => {
      const status = archive ? 'archived' : 'ready'  // spec: unarchive → ready (M30-b coage p/ running c/ worker)
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onError: (e: Error) => toast(e.message || 'Archive failed', 'error'),  // M28-02
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      queryClient.invalidateQueries({ queryKey: ['kanban', 'stats'] })
    },
  })

  const bulkArchiveMutation = useMutation({
    mutationFn: async ({ taskIds, archive }: { taskIds: string[]; archive: boolean }) => {
      const status = archive ? 'archived' : 'ready'  // spec: unarchive → ready (M30-b coage p/ running c/ worker)
      const res = await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: taskIds, updates: { status } }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onError: (e: Error) => toast(e.message || 'Bulk archive failed', 'error'),  // M28-02
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      queryClient.invalidateQueries({ queryKey: ['kanban', 'stats'] })
      setSelectedIds(new Set())
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
    if (!isAdmin()) return  // M28-01: viewer não move card (403 era silencioso)
    if (!over) return
    const taskId = active.id as string
    // M30-04: closestCorners também retorna CARDS como droppable — over.id
    // pode ser o id de outra task (o PATCH saía com status=<task-id> →
    // 404 + rollback em touch e mouse). Só colunas são alvo direto; drop
    // em card resolve pra coluna em que o card está.
    let newStatus = over.id as string
    if (!COLUMN_META.some((c) => c.status === newStatus)) {
      const overTask = data?.find((t) => t.id === newStatus)
      if (!overTask) return
      newStatus = columnForStatus(overTask.status)
    }
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
    <PageContainer>
      <PageHeader
        eyebrow="Pipeline de tarefas"
        title="Tarefas"
        subtitle="Kanban de execuções, prioridades e entregas do workspace."
        actions={
          <>
            {isAdmin() && (
              <button
                onClick={() => setCreateModalOpen(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-text-inverse transition hover:opacity-90"
              >
                <span>+</span> Nova tarefa
              </button>
            )}
            {isAdmin() && (
              <button
                onClick={() => setCreateTriageModalOpen(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-purple/30 bg-purple-subtle px-3.5 text-sm font-medium text-purple transition hover:bg-purple/20"
                title="Criar tarefa na Triagem com o template de especificação"
              >
                <span>+</span> Triagem
              </button>
            )}
            {stats && typeof stats.total === 'number' && (
              <div className="hidden items-center gap-3 text-caption text-text-tertiary sm:flex">
                <span title="Tarefas ativas">{stats.total} total</span>
                <span title="Concluídas nos últimos 7 dias" className="text-success">{stats.recent_done_7d} em 7d</span>
              </div>
            )}
            {isAdmin() && (
              <button
                onClick={() => { setBulkSelectMode(!bulkSelectMode); if (bulkSelectMode) setSelectedIds(new Set()) }}
                className={`h-9 rounded-lg border px-3 text-sm transition ${bulkSelectMode ? 'border-accent bg-accent text-text-inverse' : 'border-border bg-surface text-text-primary hover:bg-surface-hover'}`}
              >
                {bulkSelectMode ? '✕ Cancelar lote' : 'Selecionar lote'}
              </button>
            )}
            {isAdmin() && bulkSelectMode && selectedIds.size > 0 && (
              <>
                <span className="text-caption text-text-secondary">{selectedIds.size} selecionadas</span>
                <button
                  onClick={() => bulkArchiveMutation.mutate({ taskIds: [...selectedIds], archive: true })}
                  disabled={bulkArchiveMutation.isPending}
                  className="h-9 rounded-lg border border-warning/30 bg-warning/20 px-3 text-sm text-warning transition hover:bg-warning/30"
                >
                  Arquivar {selectedIds.size}
                </button>
              </>
            )}
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-text-primary transition hover:bg-surface-hover"
            >
              {showArchived ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}
            </button>
          </>
        }
      />

      <main className="mt-6 pb-12">
        {/* Filter bar */}
        {data && (
          <FilterBar filters={filters} onChange={setFilters} stats={stats} />
        )}

        {isLoading && (
          <div className="brand-card p-6" role="status" aria-label="Carregando tarefas">
            <div className="mb-4 h-4 w-44 animate-pulse rounded bg-surface/60" />
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-40 min-w-[220px] flex-1 animate-pulse rounded-lg bg-surface/40" />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
            Não foi possível carregar as tarefas.
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
                    onArchive={(t) => archiveMutation.mutate({ taskId: t.id, archive: true })}
                    bulkSelectMode={bulkSelectMode}
                    selectedIds={selectedIds}
                    onToggleSelect={(id) => setSelectedIds(prev => {
                      const next = new Set(prev)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })}
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
                  <h3 className="text-body-sm font-semibold text-text-tertiary">Arquivadas</h3>
                  <div className="flex items-center gap-2">
                    {bulkSelectMode && archivedTasks.length > 0 && selectedIds.size > 0 && (
                      <button
                        onClick={() => bulkArchiveMutation.mutate({ taskIds: [...selectedIds], archive: false })}
                        disabled={bulkArchiveMutation.isPending}
                        className="rounded-md bg-success/20 border border-success/30 px-3 py-1.5 text-sm text-success hover:bg-success/30 transition"
                      >
                        Desarquivar {selectedIds.size}
                      </button>
                    )}
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-surface text-text-tertiary border border-text-tertiary/20">
                      {archivedTasks.length}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {archivedTasks.map((task) => (
                    <div key={task.id} className="flex items-start gap-1.5">
                      {bulkSelectMode && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(task.id)}
                          onChange={() => setSelectedIds(prev => {
                            const next = new Set(prev)
                            if (next.has(task.id)) next.delete(task.id)
                            else next.add(task.id)
                            return next
                          })}
                          className="mt-3 shrink-0 cursor-pointer accent-accent"
                          aria-label={`Selecionar tarefa ${task.title}`}
                        />
                      )}
                      <div className="flex-1">
                        <TaskCard task={task} onArchive={(t) => archiveMutation.mutate({ taskId: t.id, archive: false })} />
                      </div>
                    </div>
                  ))}
                </div>
                {archivedTasks.length === 0 && (
                  <p className="py-6 text-center text-caption text-text-tertiary">Nenhuma tarefa arquivada</p>
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

      {/* Task Editor Modal (create triage mode) */}
      {createTriageModalOpen && (
        <TaskEditorModal
          onClose={() => setCreateTriageModalOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['kanban', 'stats'] })
          }}
          initialStatus="triage"
          initialBody={TRIAGE_TEMPLATE}
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
    </PageContainer>
  )
}

/* ── Task Detail Page ──────────────────────────────── */

function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'runs' | 'comments' | 'children' | 'artifacts'>('overview')
  const [showEditModal, setShowEditModal] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('agentos')
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set())
  const [previewFile, setPreviewFile] = useState<string | null>(null)

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

  const { data: artifacts } = useQuery({
    queryKey: ['task-artifacts', id],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${id}/artifacts`)
      if (!res.ok) return { files: [], workspace_path: null }
      return res.json()
    },
    enabled: activeTab === 'artifacts',
  })

  const addCommentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id!)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentText, author: commentAuthor }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onSuccess: () => {
      setCommentText('')
      queryClient.invalidateQueries({ queryKey: ['task', id] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
    },
  })

  function formatIso(iso: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Detalhe da tarefa"
        title={data?.title || 'Tarefa'}
        subtitle={data ? `${statusLabel(data.status)} · ${data.assignee || 'sem responsável'} · ${priorityLabel(data.priority)}` : 'Visão geral, runs e artefatos da tarefa.'}
        actions={
          <>
            <button
              onClick={() => navigate('/tasks')}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3.5 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
            >
              ← Voltar
            </button>
            {data && isAdmin() && (
              <>
                <button
                  onClick={() => {
                    const newStatus = data.status === 'archived' ? 'todo' : 'archived'
                    fetch(`/api/tasks/${encodeURIComponent(id!)}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: newStatus }),
                    }).then(() => queryClient.invalidateQueries({ queryKey: ['task', id] }))
                  }}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${data.status === 'archived' ? 'border-success/30 bg-success/20 text-success hover:bg-success/30' : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'}`}
                  title={data.status === 'archived' ? 'Desarquivar tarefa' : 'Arquivar tarefa'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                  {data.status === 'archived' ? 'Desarquivar' : 'Arquivar'}
                </button>
                <button
                  onClick={() => setShowEditModal(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-text-inverse transition hover:opacity-90"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar
                </button>
              </>
            )}
          </>
        }
      />

      <main className="mx-auto mt-6 max-w-4xl">
        {isLoading && (
          <div className="brand-card p-6" role="status" aria-label="Carregando tarefa">
            <div className="h-4 w-52 animate-pulse rounded bg-surface/60" />
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-surface/40" />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
            Não foi possível carregar a tarefa.
          </div>
        )}

        {data && (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-2">
              {data.assignee && (
                <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${assigneeBadgeClass(data.assignee)}`}>
                  {data.assignee}
                </span>
              )}
              <span className="inline-flex items-center rounded px-2 py-0.5 text-caption font-medium bg-surface text-text-secondary border border-border">
                {statusLabel(data.status)}
              </span>
              <span className="inline-flex items-center gap-1 text-caption text-text-secondary">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${priorityDotClass(data.priority)}`} />
                {priorityLabel(data.priority)}
              </span>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="brand-card p-4">
                <p className="text-caption text-text-tertiary mb-1">ID</p>
                <p className="font-mono text-sm text-text-primary break-all">{data.id}</p>
              </div>
              <div className="brand-card p-4">
                <p className="text-caption text-text-tertiary mb-1">Criada por</p>
                <p className="text-sm text-text-primary">{data.created_by || '—'}</p>
              </div>
              <div className="brand-card p-4">
                <p className="text-caption text-text-tertiary mb-1">Criada em</p>
                <p className="text-sm text-text-primary">{formatIso(data.created_at)}</p>
              </div>
              <div className="brand-card p-4">
                <p className="text-caption text-text-tertiary mb-1">Iniciada em</p>
                <p className="text-sm text-text-primary">{formatIso(data.started_at)}</p>
              </div>
              <div className="brand-card p-4">
                <p className="text-caption text-text-tertiary mb-1">Concluída em</p>
                <p className="text-sm text-text-primary">{formatIso(data.completed_at)}</p>
              </div>
              <div className="brand-card p-4">
                <p className="text-caption text-text-tertiary mb-1">Espaço de trabalho</p>
                <p className="text-sm text-text-primary font-mono break-all">{data.workspace_kind || '—'} {data.workspace_path ? `(${data.workspace_path})` : ''}</p>
              </div>
              {data.session_id && (
                <div className="brand-card p-4">
                  <p className="text-caption text-text-tertiary mb-1">Sessão</p>
                  <p className="text-sm text-text-primary font-mono break-all">{data.session_id}</p>
                </div>
              )}
              {data.project_id && (
                <div className="brand-card p-4">
                  <p className="text-caption text-text-tertiary mb-1">Projeto</p>
                  <p className="text-sm text-text-primary">{data.project_id}</p>
                </div>
              )}
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 overflow-x-auto border-b border-border mb-6" data-testid="task-detail-tabs">
              {[
                { key: 'overview' as const, label: 'Visão geral' },
                { key: 'runs' as const, label: `Execuções (${data.runs.length})` },
                { key: 'comments' as const, label: `Comentários (${data.comments.length})` },
                { key: 'children' as const, label: `Filhas (${data.children.length})` },
                { key: 'artifacts' as const, label: 'Artefatos' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  data-testid={`tab-${tab.key}`}
                  onClick={() => setActiveTab(tab.key)}
                  className={`shrink-0 px-4 py-2 text-sm font-medium transition duration-200 ${
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
                  <div className="brand-card p-4 mb-6">
                    <p className="text-caption text-text-tertiary mb-2">Descrição</p>
                    <div className="text-sm text-text-primary">
                      <MarkdownRenderer content={data.body} />
                    </div>
                  </div>
                )}
                {(data.parent_id || data.children.length > 0) && (
                  <div className="brand-card p-4 mb-6">
                    <p className="text-caption text-text-tertiary mb-2">Vínculos</p>
                    {data.parent_id && (
                      <div className="mb-1 text-sm">
                        <span className="text-text-tertiary">Pai:</span>{' '}
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
                        <span className="text-text-tertiary">Filhas:</span>
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
                  <p className="text-body-sm text-text-tertiary">Sem detalhes adicionais.</p>
                )}
              </div>
            )}

            {/* Runs tab */}
            {activeTab === 'runs' && (
              <div data-testid="tab-panel-runs" className="brand-card p-4">
                {data.runs.length === 0 && <p className="text-body-sm text-text-tertiary">Nenhuma execução registrada.</p>}
                {data.runs.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-bg-elevated text-text-secondary text-left">
                        <tr>
                          <th className="px-3 py-2 font-medium">Etapa</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Perfil</th>
                          <th className="px-3 py-2 font-medium">Início</th>
                          <th className="px-3 py-2 font-medium">Fim</th>
                          <th className="px-3 py-2 font-medium">Resultado</th>
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
                                  {statusLabel(run.status)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-text-secondary">{run.profile || '—'}</td>
                              <td className="px-3 py-2 tabular-nums">{formatIso(run.started_at)}</td>
                              <td className="px-3 py-2 tabular-nums">{formatIso(run.ended_at)}</td>
                              <td className="px-3 py-2 max-w-xs truncate text-text-secondary">{outcomeLabel(run.outcome)}</td>
                            </tr>
                            {expandedRuns.has(run.id) && (
                              <tr>
                                <td colSpan={6} className="px-4 py-4 bg-surface/40">
                                  {/* Resumo */}
                                  {run.summary && (
                                    <div className="mb-3">
                                      <h4 className="text-sm font-medium text-text-secondary mb-2">Resumo</h4>
                                      <MarkdownRenderer content={run.summary} />
                                    </div>
                                  )}
                                  {/* Metadata */}
                                  {run.metadata && (() => {
                                    try {
                                      const meta = JSON.parse(run.metadata)
                                      return (
                                        <div className="mb-3">
                                          <h4 className="text-sm font-medium text-text-secondary mb-2">Detalhes</h4>
                                          <RunMetadata meta={meta} />
                                        </div>
                                      )
                                    } catch { return null }
                                  })()}
                                  {/* Error */}
                                  {run.error && (
                                    <div className="rounded border border-error/30 bg-error-subtle p-3">
                                      <p className="text-sm font-medium text-error mb-1">Erro</p>
                                      <pre className="text-xs text-error font-mono whitespace-pre-wrap">{run.error}</pre>
                                    </div>
                                  )}
                                  {/* Session Log */}
                                  <TaskSessionLog taskId={data.id} />
                                  {/* Empty state */}
                                  {!run.summary && !run.metadata && !run.error && (
                                    <p className="text-sm text-text-tertiary italic">Sem detalhes adicionais desta execução.</p>
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
              <div data-testid="tab-panel-comments" className="brand-card p-4">
{/* Comment form */}
                {isAdmin() && (
                <div className="mb-4 pb-4 border-b border-border">
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={commentAuthor}
                      onChange={(e) => setCommentAuthor(e.target.value)}
                      placeholder="Autor"
                      className="w-32 rounded-md border border-border bg-bg-base px-2.5 py-1.5 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
                    />
                    <button
                      onClick={() => addCommentMutation.mutate()}
                      disabled={!commentText.trim() || addCommentMutation.isPending}
                      className="ml-auto rounded-md bg-accent px-3 py-1.5 text-sm text-white font-medium hover:bg-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {addCommentMutation.isPending ? 'Publicando…' : 'Adicionar comentário'}
                    </button>
                  </div>
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={3}
                    placeholder="Escreva um comentário… (Markdown suportado)"
                    className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none transition resize-y"
                  />
                  {addCommentMutation.isError && (
                    <p className="mt-2 text-sm text-error">{(addCommentMutation.error as Error).message}</p>
                  )}
                </div>)}

                {/* Comment list */}
                {data.comments.length === 0 && <p className="text-body-sm text-text-tertiary">Nenhum comentário ainda.</p>}
                {data.comments.length > 0 && (
                  <div className="space-y-3">
                    {data.comments.map((comment) => (
                      <div key={comment.id} className="rounded border border-border bg-surface/40 p-3">
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
              <div data-testid="tab-panel-children" className="brand-card p-4">
                {data.children.length === 0 && <p className="text-body-sm text-text-tertiary">Nenhuma tarefa filha.</p>}
                {data.children.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.children.map((childId) => {
                      const childTask = childTasks?.find((t) => t.id === childId)
                      return (
                        <button
                          key={childId}
                          onClick={() => navigate(`/tasks/${encodeURIComponent(childId)}`)}
                          className="text-left rounded-lg border border-border bg-surface/40 p-4 hover:bg-surface/50 transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-mono text-xs text-accent">{childId}</p>
                            {childTask && (
                              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${childTask.status === 'done' ? 'bg-success-subtle text-success border border-success/20' : childTask.status === 'running' ? 'bg-warning-subtle text-warning border border-warning/20' : childTask.status === 'blocked' ? 'bg-error-subtle text-error border border-error/20' : 'bg-surface text-text-secondary border border-border'}`}>
                                {statusLabel(childTask.status)}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-text-primary line-clamp-2">{childTask?.title || 'Tarefa sem título'}</p>
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

            {/* Artifacts tab */}
            {activeTab === 'artifacts' && (
              <div data-testid="tab-panel-artifacts" className="brand-card p-4">
                {!artifacts?.workspace_path && (
                  <p className="text-body-sm text-text-tertiary">Nenhum workspace configurado para esta tarefa.</p>
                )}
                {artifacts?.workspace_path && artifacts.files.length === 0 && (
                  <p className="text-body-sm text-text-tertiary">Nenhum arquivo no workspace.</p>
                )}
                {artifacts?.files.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-text-tertiary mb-2">{artifacts.workspace_path}</p>
                    <ArtifactTree
                      files={artifacts.files}
                      taskId={id!}
                      previewFile={previewFile}
                      setPreviewFile={setPreviewFile}
                    />
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
    </PageContainer>
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

    const allPrimitive = value.every((item) => typeof item !== 'object' || item === null)

    return (
      <div style={{ marginLeft: depth * 16 }}>
        <div className="flex items-center gap-1 py-0.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-sm font-medium text-text-primary hover:text-accent transition-colors"
          >
            <span className="text-text-tertiary w-3 inline-block">{expanded ? '▼' : '▶'}</span>
            <span>{name}</span>
            <span className="text-text-tertiary text-xs ml-1">[{value.length}]</span>
          </button>
          {editMode && onChange && allPrimitive && (
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={() => {
                  const newVal = [...value, '']
                  onChange(path || name, newVal)
                }}
                className="text-xs text-accent hover:text-accent-hover transition-colors px-1.5 py-0.5 rounded border border-accent/30 hover:border-accent/60"
                title="Adicionar item"
              >
                + Adicionar
              </button>
            </div>
          )}
        </div>
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
            ) : editMode && onChange ? (
              <div
                key={idx}
                style={{ marginLeft: (depth + 1) * 16 }}
                className="flex items-center gap-2 py-0.5 text-sm border-l-2 border-accent/50 pl-2 group"
              >
                <span className="text-text-tertiary shrink-0">[{idx}]</span>
                {typeof item === 'boolean' ? (
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item}
                      onChange={(e) => onChange(`${path}[${idx}]`, e.target.checked)}
                      className="w-4 h-4 accent-accent rounded"
                    />
                    <span className="text-text-primary">{item ? 'true' : 'false'}</span>
                  </label>
                ) : typeof item === 'number' ? (
                  <input
                    type="number"
                    value={item}
                    onChange={(e) => onChange(`${path}[${idx}]`, e.target.valueAsNumber)}
                    className="bg-bg-elevated border border-border rounded px-2 py-0.5 text-sm text-text-primary w-32 font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                ) : (
                  <input
                    type="text"
                    value={String(item)}
                    onChange={(e) => onChange(`${path}[${idx}]`, e.target.value)}
                    className="bg-bg-elevated border border-border rounded px-2 py-0.5 text-sm text-text-primary font-mono flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                )}
                {allPrimitive && (
                  <button
                    onClick={() => {
                      const newVal = value.filter((_: any, i: number) => i !== idx)
                      onChange(path || name, newVal)
                    }}
                    className="opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 text-xs text-error hover:text-error transition-opacity px-1 shrink-0"
                    title="Remover item"
                  >
                    ✕
                  </button>
                )}
              </div>
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
        <span className="text-warning font-mono text-xs" title="Segredo oculto">
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
  const admin = isAdmin()

  const { data, isLoading, error } = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const res = await fetch('/api/config')
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    enabled: admin,
    // Don't refetch while user is editing — refetch resets mergedData and breaks controlled inputs
    refetchInterval: editMode ? false : 5000,
  })

  const { data: rawData, error: rawError } = useQuery({
    queryKey: ['config-raw'],
    queryFn: async () => {
      const res = await fetch('/api/config/raw')
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    enabled: admin && viewMode === 'yaml',
  })

  const mergedData = useMemo(() => {
    if (!data || Object.keys(changes).length === 0) return data

    const result = JSON.parse(JSON.stringify(data)) // Deep clone
    for (const [pathStr, value] of Object.entries(changes)) {
      // Parse path: "a.b[0].c" → ["a", "b", "[0]", "c"]
      const keys = pathStr.split(/\.|\b(?=\[)/).filter(Boolean)
      let obj: any = result
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]
        if (k.startsWith('[') && k.endsWith(']')) {
          const idx = parseInt(k.slice(1, -1))
          if (!Array.isArray(obj) || idx >= obj.length) break
          obj = obj[idx]
        } else {
          if (obj[k] === undefined) obj[k] = {}
          obj = obj[k]
        }
      }
      const final = keys[keys.length - 1]
      if (final.startsWith('[') && final.endsWith(']')) {
        const idx = parseInt(final.slice(1, -1))
        if (Array.isArray(obj) && idx < obj.length) obj[idx] = value
      } else {
        obj[final] = value
      }
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
        throw new Error(err.detail || 'Falha ao salvar')
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
      path: path.split(/\.|\b(?=\[)/).filter(Boolean),
      value,
    }))
    saveMutation.mutate(patches)
  }

  if (!admin) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Sistema" title="Configuração" subtitle="Acesso restrito" />
        <main className="mt-6 pb-12">
          <div className="brand-card p-6">
            <h2 className="text-h3 font-semibold text-text-primary">Acesso restrito</h2>
            <p className="mt-2 text-sm text-text-secondary">
              A configuração do Hermes é visível apenas para administradores.
            </p>
          </div>
        </main>
      </PageContainer>
    )
  }

  const pending = Object.keys(changes).length

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Sistema"
        title="Configuração"
        subtitle={editMode ? 'Modo edição — campos sensíveis bloqueados' : 'Visão somente leitura do config.yaml do Hermes'}
        actions={
          viewMode === 'tree' ? (
            editMode ? (
              <span className="rounded-lg bg-warning/15 px-3 py-1.5 text-sm font-medium text-warning">
                ✎ Editando
              </span>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface/50 hover:text-text-primary"
              >
                ✎ Editar
              </button>
            )
          ) : undefined
        }
      />

      <main className="mt-6 pb-12">
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <span className="text-lg text-warning" aria-hidden="true">⚠️</span>
          <p className="text-sm text-warning">
            {editMode
              ? 'Editando config.yaml — campos sensíveis (chaves de API, tokens, senhas) não podem ser alterados. Reinicie o container para aplicar.'
              : 'Somente leitura — alterações no config.yaml exigem reinício do container.'}
          </p>
        </div>

        <div className="brand-card mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label="Modo de visualização" className="flex gap-2">
            <button
              onClick={() => setViewMode('tree')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === 'tree'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-secondary hover:bg-surface/50 hover:text-text-primary'
              }`}
            >
              Árvore
            </button>
            <button
              onClick={() => setViewMode('yaml')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === 'yaml'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-secondary hover:bg-surface/50 hover:text-text-primary'
              }`}
            >
              YAML
            </button>
          </div>
          <input
            type="text"
            placeholder="Buscar chaves…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input w-full rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40 sm:w-72"
          />
        </div>

        {saveMutation.isError && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
            Falha ao salvar: {String(saveMutation.error?.message || 'erro desconhecido')}
          </div>
        )}

        {isLoading && (
          <div className="brand-card space-y-3 p-5" role="status" aria-label="Carregando configuração">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-surface/60" style={{ width: `${92 - i * 7}%` }} />
            ))}
          </div>
        )}

        {error && (
          <div className="brand-card border-error/30 bg-error/10 p-4 text-sm text-error">
            Não foi possível carregar a configuração: {error instanceof Error ? error.message : 'erro desconhecido'}
          </div>
        )}

        {viewMode === 'tree' && mergedData && (
          <div className="brand-card p-4 lg:p-5">
            {Object.keys(mergedData).length === 0 ? (
              <p className="text-sm text-text-secondary">Nenhuma configuração encontrada.</p>
            ) : (
              Object.entries(mergedData).map(([k, v]) => (
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
              ))
            )}
          </div>
        )}

        {viewMode === 'yaml' && rawData && (
          <div className="brand-card overflow-hidden">
            <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-sm text-text-primary">
              {rawData.yaml}
            </pre>
          </div>
        )}

        {viewMode === 'yaml' && rawError && (
          <div className="brand-card border-error/30 bg-error/10 p-4 text-sm text-error">
            Não foi possível carregar o YAML bruto: {rawError instanceof Error ? rawError.message : 'erro desconhecido'}
          </div>
        )}

        {viewMode === 'yaml' && !rawData && !rawError && (
          <div className="brand-card space-y-3 p-5" role="status" aria-label="Carregando YAML">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-surface/60" style={{ width: `${88 - i * 9}%` }} />
            ))}
          </div>
        )}

        {editMode && (
          <div className="sticky bottom-0 z-40 mt-6 flex flex-col gap-3 rounded-xl border border-border bg-bg-elevated/95 px-4 py-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-text-secondary">
              {pending === 0
                ? 'Nenhuma alteração ainda — edite os campos acima'
                : `${pending} ${pending === 1 ? 'alteração pendente' : 'alterações pendentes'}`}
            </span>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface/60 hover:text-text-primary"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={pending === 0 || saveMutation.isPending}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-text-inverse transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saveMutation.isPending ? 'Salvando…' : `Salvar (${pending})`}
              </button>
            </div>
          </div>
        )}
      </main>
    </PageContainer>
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

function formatRunTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return iso
  }
}

function fileIcon(type: string): string {
  if (type.startsWith('image/')) return '🖼️'
  if (type === 'application/pdf') return '📄'
  if (type.startsWith('video/')) return '🎬'
  if (type.startsWith('audio/')) return '🎵'
  if (type.includes('json') || type.includes('yaml')) return '📋'
  if (type.includes('python') || type.includes('javascript')) return '💻'
  if (type.includes('markdown') || type.includes('text')) return '📝'
  return '📁'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const NODE_TYPE_LABEL: Record<string, string> = {
  trigger: 'Gatilho',
  action: 'Ação',
  condition: 'Condição',
}

const RUN_STATUS_LABEL: Record<string, string> = {
  completed: 'concluída',
  failed: 'falhou',
  running: 'em execução',
  pending: 'pendente',
  skipped: 'ignorada',
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
    stub: 'ring-2 ring-amber-500/50',
    failed: 'ring-2 ring-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.3)]',
  }

  const runStatusIcons: Record<string, string> = {
    completed: '✅',
    skipped: '⏭️',
    stub: '🚧',
    failed: '❌',
  }

  const statusClass = nd.runStatus ? runStatusStyles[nd.runStatus] || '' : ''

  return (
    <div className={`rounded-lg border-2 ${colors.border} ${colors.bg} min-w-[180px] shadow-lg ${statusClass}`}>
      <div className={`px-3 py-1.5 border-b ${colors.border} flex items-center gap-2`}>
        <span>{colors.icon}</span>
        <span className="text-xs font-semibold text-text-secondary uppercase">{NODE_TYPE_LABEL[nd.nodeType] ?? nd.nodeType}</span>
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
  const toast = useToast()
  const admin = isAdmin()
  const { data: workflows, isLoading, error } = useQuery<Workflow[]>({
    queryKey: ['workflows'],
    queryFn: async () => {
      const res = await fetch('/api/workflows')
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Workflow sem título',
          description: '',
          nodes: [
            { id: 'trigger-1', type: 'workflowNode', position: { x: 250, y: 150 }, data: { label: 'Início', nodeType: 'trigger' } }
          ],
          edges: [],
        }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onSuccess: (wf: Workflow) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      navigate(`/workflows/${wf.id}`)
    },
    onError: (e: Error) => toast(e.message || 'Falha na solicitação', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json().catch(() => null)  // M28-03: 2xx empty body = sucesso
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    onError: (e: Error) => toast(e.message || 'Falha na solicitação', 'error'),
  })

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (window.confirm(`Excluir o workflow "${name}"? Essa ação não pode ser desfeita.`)) {
      deleteMutation.mutate(id)
    }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  const nodeCount = (wf: Workflow): number | null => {
    if (typeof wf.node_count === 'number') return wf.node_count
    if (wf.node_count === null || wf.graph_corrupt) return null
    try { return JSON.parse(wf.nodes).length } catch { return null }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Automação"
        title="Workflows"
        subtitle={
          isLoading
            ? 'Carregando workflows…'
            : error
              ? 'Não foi possível carregar os workflows.'
              : `${workflows?.length ?? 0} ${(workflows?.length ?? 0) === 1 ? 'workflow' : 'workflows'}`
        }
        actions={
          admin ? (
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              <span>+</span>
              <span>{createMutation.isPending ? 'Criando…' : 'Novo workflow'}</span>
            </button>
          ) : undefined
        }
      />

      <main className="mt-6 pb-12">
        {error && !isLoading && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
            Não foi possível carregar os workflows: {error instanceof Error ? error.message : 'erro desconhecido'}
          </div>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Carregando workflows">
            {[1, 2, 3].map(i => (
              <div key={i} className="brand-card h-36 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && !error && workflows && workflows.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workflows.map(wf => (
              <article
                key={wf.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a,button')) return
                  navigate(`/workflows/${wf.id}`)
                }}
                className="brand-card brand-card-hover group flex cursor-pointer flex-col p-5"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-h4 font-semibold text-text-primary">
                    <Link to={`/workflows/${wf.id}`} className="hover:text-accent">{wf.name}</Link>
                  </h3>
                  {admin && (
                    <button
                      onClick={(e) => handleDelete(e, wf.id, wf.name)}
                      className="rounded-md p-1.5 text-text-tertiary opacity-0 transition-all hover:bg-error/10 hover:text-error focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-error/40 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                      title="Excluir workflow"
                      aria-label={`Excluir workflow ${wf.name}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  )}
                </div>
                <p className="mb-4 line-clamp-2 text-sm text-text-secondary">
                  {wf.description || 'Sem descrição'}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 text-xs text-text-tertiary">
                  <span>
                    {nodeCount(wf) === null
                      ? '—'
                      : `${nodeCount(wf)} ${nodeCount(wf) === 1 ? 'nó' : 'nós'}`}
                  </span>
                  <div className="flex items-center gap-3">
                    <span>{formatDate(wf.updated_at)}</span>
                    <Link to={`/workflows/${wf.id}`} className="font-medium text-accent hover:text-accent-hover">Abrir →</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {!isLoading && !error && workflows && workflows.length === 0 && (
          <div className="brand-card px-6 py-16 text-center">
            <div className="mb-4 text-4xl" aria-hidden="true">⚡</div>
            <h3 className="mb-2 text-h4 font-semibold text-text-primary">Nenhum workflow ainda</h3>
            <p className="mb-6 text-sm text-text-secondary">
              {admin
                ? 'Crie seu primeiro workflow para começar a automatizar tarefas.'
                : 'Os workflows aparecerão aqui quando forem criados.'}
            </p>
            {admin && (
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {createMutation.isPending ? 'Criando…' : 'Criar workflow'}
              </button>
            )}
          </div>
        )}
      </main>
    </PageContainer>
  )
}

function WorkflowEditorPage() {
  const toast = useToast()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as any[])
  const [wfName, setWfName] = useState('Workflow sem título')
  const [wfDescription, setWfDescription] = useState('')
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Record<string, string>>({})
  const [showPalette, setShowPalette] = useState(false)  // M8-10: drawer esquerda < lg
  const [showProps, setShowProps] = useState(false)      // M8-10: drawer direita < lg
  const loadedRef = useRef<string | null>(null)  // M8-03: which id is loaded, not just 'once'
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set())
  const [runDetails, setRunDetails] = useState<Record<string, any>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

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
  const { data: workflow, isLoading, error } = useQuery<Workflow>({
    queryKey: ['workflow', id],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${id}`)
      if (res.status === 404) throw new Error('Workflow não encontrado')
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    enabled: !!id,
  })

  // Parse and set nodes/edges when workflow loads
  useEffect(() => {
    // M8-03: load once PER workflow id — navigating A→B must load B's graph,
    // never keep A's canvas (which Save would then write over B).
    if (workflow && loadedRef.current !== (id ?? null)) {
      loadedRef.current = id ?? null
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
      // Q4-3: transients die with the previous workflow
      setRunResults({})
      setSelectedNode(null)
      setSaveStatus('idle')
      setSaveError(null)
      setExpandedRuns(new Set())
      setRunDetails({})
    }
  }, [workflow, id, setNodes, setEdges])

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
      if (loadedRef.current !== (id ?? null)) throw new Error('Estado do editor desatualizado')  // M8-03
      setSaveStatus('saving')
      setSaveError(null)
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
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onSuccess: () => {
      setSaveStatus('saved')
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 2000)
    },
    onError: (e: Error) => {
      setSaveStatus('error')
      setSaveError(e.message || 'erro desconhecido')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 3000)
    },
  })

  // Run workflow mutation
  const runMutation = useMutation({
    mutationFn: async () => {
      setRunResults({})  // Q4-3: stale overlays never survive into a new run
      // Save first — M29-04: falha de save não pode ser mascarada como
      // falha de run (o usuário precisa saber QUAL etapa morreu)
      try {
        await saveMutation.mutateAsync()
      } catch (e) {
        throw new Error('Falha ao salvar antes de executar: ' + (e instanceof Error ? e.message : 'erro desconhecido'))
      }
      const res = await fetch(`/api/workflows/${id}/run`, { method: 'POST' })
      if (!res.ok) throw new Error(await apiErrorMessage(res))  // M28-04
      return res.json()
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-runs', id] })
      // Build runResults map from node results
      if (data.result?.node_results) {
        const results: Record<string, string> = {}
        for (const nr of data.result.node_results) {
          // Q4-2: 'skipped' is sticky — a later duplicate entry never overwrites it
          if (results[nr.node_id] !== 'skipped') results[nr.node_id] = nr.status
        }
        setRunResults(results)
      }
    },
    onError: (e: Error) => toast(e.message || 'Falha ao executar o workflow', 'error'),  // M28-04
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
      trigger: 'Novo gatilho',
      action: 'Nova ação',
      condition: 'Nova condição',
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
      <PageContainer>
        <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Carregando workflow">
          <div className="animate-skeleton h-16 w-16 rounded-full" />
        </div>
      </PageContainer>
    )
  }

  if (error && !workflow) {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="Automação"
          title="Workflow indisponível"
          subtitle="Não foi possível carregar este workflow."
          actions={
            <button
              onClick={() => navigate('/workflows')}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-secondary transition hover:text-text-primary"
            >
              ← Voltar para Workflows
            </button>
          }
        />
        <div className="brand-card mt-6 border border-error/30 bg-error/10 p-6 text-sm text-error">
          {error instanceof Error ? error.message : 'Erro desconhecido'}
        </div>
      </PageContainer>
    )
  }

  const nodeInfo = selectedNode ? (selectedNode.data as unknown as WorkflowNodeData) : null
  const selectedColors = nodeInfo ? nodeColors[nodeInfo.nodeType] : null

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Automação"
        title="Editor de workflow"
        subtitle="Monte o fluxo arrastando nós e conectando etapas."
        actions={
          <>
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1 text-caption text-success">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                Salvo
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="max-w-[220px] truncate text-caption text-error" title={saveError ?? 'Falha ao salvar'}>
                Falha ao salvar
              </span>
            )}
            <button
              onClick={() => setShowPalette(v => !v)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-body-sm text-text-secondary lg:hidden"
              aria-label="Alternar paleta de nós"
              title="Paleta de nós"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
            </button>
            <button
              onClick={() => setShowProps(v => !v)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-body-sm text-text-secondary lg:hidden"
              aria-label="Alternar painel de propriedades"
              title="Propriedades do nó"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>
            </button>
            {isAdmin() && (
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveStatus === 'saving'}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-1.5 text-body-sm font-medium text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {saveStatus === 'saving' ? 'Salvando…' : 'Salvar'}
              </button>
            )}
            {isAdmin() && (
              <button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-body-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {runMutation.isPending ? '⏳ Executando…' : '▶ Executar agora'}
              </button>
            )}
          </>
        }
      />

      {error && workflow && (
        <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          Falha ao atualizar o workflow: {error instanceof Error ? error.message : 'erro desconhecido'}. Exibindo a última versão carregada.
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 brand-card p-3 sm:flex-row sm:items-center">
        <button
          onClick={() => navigate('/workflows')}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-body-sm text-text-secondary transition hover:bg-surface/60 hover:text-text-primary"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Workflows
        </button>
        <div className="hidden h-5 w-px bg-border sm:block" />
        <input
          type="text"
          value={wfName}
          onChange={(e) => setWfName(e.target.value)}
          aria-label="Nome do workflow"
          className="min-w-0 flex-1 rounded px-3 py-1.5 text-h5 font-semibold text-text-primary outline-none transition focus:bg-surface/40"
          placeholder="Nome do workflow"
        />
        <span className="hidden text-caption text-text-tertiary sm:block">/</span>
        <input
          type="text"
          value={wfDescription}
          onChange={(e) => setWfDescription(e.target.value)}
          aria-label="Descrição do workflow"
          className="min-w-0 flex-1 rounded px-3 py-1.5 text-body-sm text-text-secondary outline-none transition focus:bg-surface/40"
          placeholder="Descrição (opcional)"
        />
      </div>

      {/* Main Editor Area */}
      <div className="brand-card mt-4 overflow-hidden">
      <div className="relative flex h-[calc(100dvh-360px)] min-h-[460px]">
        {/* Left Sidebar — Node Palette (M8-10: drawer below lg, canvas full-width) */}
        <div className={`w-56 bg-bg-elevated/60 border-r border-border p-4 flex-col gap-3 shrink-0 max-lg:absolute max-lg:z-20 max-lg:h-full max-lg:shadow-xl ${showPalette ? 'flex' : 'hidden lg:flex'}`}>
          <h3 className="text-caption font-semibold text-text-tertiary uppercase tracking-wider mb-1">Adicionar nós</h3>
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
                  <p className="text-body-sm font-medium text-text-primary">{NODE_TYPE_LABEL[nodeType] ?? nodeType}</p>
                  <p className="text-caption text-text-tertiary">
                    {nodeType === 'trigger' ? 'Inicia o fluxo' : nodeType === 'action' ? 'Executa uma tarefa' : 'Desvia o fluxo'}
                  </p>
                </div>
              </button>
            )
          })}

          <div className="mt-4 p-3 rounded-lg bg-bg-overlay/50 border border-border">
            <h4 className="text-caption font-semibold text-text-secondary mb-2">Dicas</h4>
            <ul className="text-caption text-text-tertiary space-y-1">
              <li>• Arraste para conectar nós</li>
              <li>• Clique num nó para editar</li>
              <li>• Pressione Delete para remover</li>
              <li>• Role para zoom, arraste para mover</li>
            </ul>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            key={loadedRef.current ?? 'loading'}
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
            onInit={(instance) => {
              requestAnimationFrame(() => requestAnimationFrame(() => instance.fitView({ padding: 0.2 })))
            }}
            nodeTypes={workflowNodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            className="bg-bg-base"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
            <Controls />
          </ReactFlow>
        </div>

        {/* Right Panel — Propriedades do nó */}
        {selectedNode && nodeInfo && (
          <div className={`w-64 bg-bg-elevated/60 border-l border-border p-4 shrink-0 overflow-y-auto max-lg:absolute max-lg:right-0 max-lg:z-20 max-lg:h-full max-lg:shadow-xl ${showProps ? 'block' : 'hidden lg:block'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-h6 font-semibold text-text-primary">Propriedades do nó</h3>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded hover:bg-surface/60 text-text-tertiary hover:text-text-primary transition"
                aria-label="Fechar propriedades"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            {/* Type badge */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${selectedColors?.border} ${selectedColors?.bg} mb-4`}>
              <span>{selectedColors?.icon}</span>
              <span className="text-body-sm font-medium text-text-primary">{NODE_TYPE_LABEL[nodeInfo.nodeType] ?? nodeInfo.nodeType}</span>
            </div>

            {/* Label field */}
            <label className="block mb-3">
              <span className="text-caption font-semibold text-text-secondary mb-1.5 block">Rótulo</span>
              <input
                type="text"
                value={nodeInfo.label}
                onChange={(e) => updateNodeLabel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none transition"
              />
            </label>

            {/* ID do nó (read-only) */}
            <label className="block mb-4">
              <span className="text-caption font-semibold text-text-secondary mb-1.5 block">ID do nó</span>
              <div className="px-3 py-2 rounded-lg bg-bg-base border border-border text-mono-sm text-text-tertiary">
                {selectedNode.id}
              </div>
            </label>

            {/* Node Config Fields */}
            {nodeInfo.nodeType === 'trigger' && (
              <div className="mb-4 space-y-3">
                <h4 className="text-caption font-semibold text-text-secondary">Configuração do gatilho</h4>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Tipo</span>
                  <select
                    value={(nodeInfo as any).config?.type || 'manual'}
                    onChange={(e) => updateNodeConfig('type', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  >
                    <option value="manual">Manual</option>
                    <option value="schedule">Agendamento</option>
                    <option value="webhook">Webhook</option>
                  </select>
                </label>
              </div>
            )}

            {nodeInfo.nodeType === 'action' && (
              <div className="mb-4 space-y-3">
                <h4 className="text-caption font-semibold text-text-secondary">Configuração da ação</h4>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Tipo de ação</span>
                  <select
                    value={(nodeInfo as any).config?.action_type || 'log'}
                    onChange={(e) => updateNodeConfig('action_type', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  >
                    <option value="log">Registrar</option>
                    <option value="set_variable">Definir variável</option>
                    <option value="create_task">Criar tarefa</option>
                    <option value="http_request">Requisição HTTP</option>
                  </select>
                </label>

                {((nodeInfo as any).config?.action_type || 'log') === 'log' && (
                  <label className="block">
                    <span className="text-caption text-text-tertiary mb-1 block">Mensagem</span>
                    <input
                      type="text"
                      value={(nodeInfo as any).config?.message || ''}
                      onChange={(e) => updateNodeConfig('message', e.target.value)}
                      placeholder="Mensagem do log"
                      className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                    />
                  </label>
                )}

                {(nodeInfo as any).config?.action_type === 'set_variable' && (
                  <>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Nome da variável</span>
                      <input
                        type="text"
                        value={(nodeInfo as any).config?.variable || ''}
                        onChange={(e) => updateNodeConfig('variable', e.target.value)}
                        placeholder="nome_da_variavel"
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      />
                    </label>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Valor</span>
                      <input
                        type="text"
                        value={(nodeInfo as any).config?.value || ''}
                        onChange={(e) => updateNodeConfig('value', e.target.value)}
                        placeholder="valor"
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      />
                    </label>
                  </>
                )}

                {(nodeInfo as any).config?.action_type === 'create_task' && (
                  <>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Título</span>
                      <input
                        type="text"
                        value={(nodeInfo as any).config?.title || ''}
                        onChange={(e) => updateNodeConfig('title', e.target.value)}
                        placeholder="Título da tarefa"
                        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                      />
                    </label>
                    <label className="block">
                      <span className="text-caption text-text-tertiary mb-1 block">Responsável</span>
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
                      <span className="text-caption text-text-tertiary mb-1 block">Método</span>
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
                <h4 className="text-caption font-semibold text-text-secondary">Configuração da condição</h4>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Campo</span>
                  <input
                    type="text"
                    value={(nodeInfo as any).config?.field || ''}
                    onChange={(e) => updateNodeConfig('field', e.target.value)}
                    placeholder="campo_do_contexto"
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  />
                </label>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Operador</span>
                  <select
                    value={(nodeInfo as any).config?.operator || 'equals'}
                    onChange={(e) => updateNodeConfig('operator', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-body text-text-primary focus:border-accent outline-none transition"
                  >
                    <option value="equals">Igual a</option>
                    <option value="not_equals">Diferente de</option>
                    <option value="contains">Contém</option>
                    <option value="greater_than">Maior que</option>
                    <option value="less_than">Menor que</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-caption text-text-tertiary mb-1 block">Valor</span>
                  <input
                    type="text"
                    value={(nodeInfo as any).config?.value || ''}
                    onChange={(e) => updateNodeConfig('value', e.target.value)}
                    placeholder="valor de comparação"
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
              Excluir nó
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Histórico de execuções Panel */}
      {runs && runs.length > 0 && (
        <div className="brand-card mt-4 p-4">
          <h3 className="text-sm font-semibold text-text-secondary mb-2">Histórico de execuções</h3>
          <div className="space-y-2">
            {runs.slice(0, 10).map((run: any) => {
              const isExpanded = expandedRuns.has(run.id)
              const detail = runDetails[run.id]
              const duration = run.finished_at ? calculateDuration(run.started_at, run.finished_at) : null

              return (
                <div key={run.id} className="rounded border border-border">
                  {/* Header - clickable */}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 p-2 text-left text-xs cursor-pointer hover:bg-surface/40"
                    onClick={() => toggleRun(run.id)}
                    aria-expanded={isExpanded}
                  >
                    <span className="text-text-tertiary" aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
                    <span className={runLevelClass(runLevelIcon(run.status, run.result))}>
                      {runLevelIcon(run.status, run.result)}
                    </span>
                    <span className="text-text-secondary font-mono flex-1">{run.id}</span>
                    <span className="text-text-tertiary">{formatRunTime(run.started_at)}</span>
                    {duration && <span className="text-text-tertiary">{duration}</span>}
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && detail && (
                    <div className="p-3 bg-bg-base/40 border-t border-border">
                      {/* Summary stats */}
                      <div className="flex gap-4 text-xs mb-3">
                        <span className={(detail.result?.executed_nodes || 0) > 0 ? 'text-emerald-400' : 'text-text-tertiary'}>{(detail.result?.executed_nodes || 0) > 0 ? '✅' : '○'} {detail.result?.executed_nodes || 0} executados</span>
                        <span className="text-text-tertiary">⏭️ {detail.result?.skipped_nodes || 0} ignorados</span>
                        <span className="text-amber-400">🚧 {detail.result?.stub_nodes || 0} simulados</span>
                        <span className="text-text-secondary">📊 {detail.result?.total_nodes || 0} total</span>
                      </div>

                      {/* Node results */}
                      {detail.result?.node_results && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-text-secondary">Execução por nó:</p>
                          {detail.result.node_results.map((node: any) => (
                            <div key={node.node_id} className="flex items-start gap-2 pl-2">
                              <span className={node.status === 'completed' ? 'text-emerald-400' : node.status === 'skipped' ? 'text-text-tertiary' : node.status === 'stub' ? 'text-amber-400' : 'text-red-400'}>
                                {node.status === 'completed' ? '✅' : node.status === 'skipped' ? '⏭️' : node.status === 'stub' ? '🚧' : '❌'}
                              </span>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-text-primary">{node.label}</span>
                                  <span className="text-xs text-text-tertiary px-1 rounded bg-surface">{NODE_TYPE_LABEL[node.node_type] ?? node.node_type}</span>
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
                          <p className="text-xs font-medium text-text-secondary mb-1">Variáveis de contexto:</p>
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
            <span className={runLevelClass(runLevelIcon(runMutation.data.status, runMutation.data.result))}>
              {runLevelIcon(runMutation.data.status, runMutation.data.result)}
            </span>
            <span className="text-sm font-medium text-text-primary">
              Execução: {RUN_STATUS_LABEL[runMutation.data.status] ?? runMutation.data.status}
            </span>
          </div>
          <div className="text-xs text-text-secondary space-y-1">
            <p>Nós executados: {runMutation.data.result?.executed_nodes || 0}</p>
            <p>Nós ignorados: {runMutation.data.result?.skipped_nodes || 0}</p>
            <p>Nós simulados: {runMutation.data.result?.stub_nodes || 0}</p>
            <p>Duração: {calculateDuration(runMutation.data.started_at, runMutation.data.finished_at)}</p>
          </div>
          <button onClick={() => { runMutation.reset(); setRunResults({}) }} className="mt-2 text-xs text-text-tertiary hover:text-text-secondary">
            Fechar
          </button>
        </div>
      )}
    </PageContainer>
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
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}

function AppInner() {
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
    <ToastProvider>
    <QueryClientProvider client={queryClient}>
      <SearchContext.Provider value={{ openSearch: () => setSearchOpen(true) }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppShell onOpenSearch={() => setSearchOpen(true)} />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/chat" element={<ChatPage />} />
            {/* M11-02: /health pertence ao backend (monitoring) — a SPA vive em /system-health */}
            <Route path="/system-health" element={<HealthPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/:id" element={<SessionDetailPage />} />
            <Route path="/tasks" element={<KanbanBoardPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/skills" element={<SkillsHubPage />} />
            <Route path="/workflows" element={<WorkflowListPage />} />
            <Route path="/workflows/:id" element={<WorkflowEditorPage />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/analytics" element={isAdmin() ? <AnalyticsPage /> : <Navigate to="/" replace />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/settings" element={<UserManagement />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      </SearchContext.Provider>
    </QueryClientProvider>
    </ToastProvider>
  )
}

/* ── Cron Jobs ─────────────────────────────────────── */

interface CronJob {
  id: string
  name: string
  prompt: string
  schedule: { kind: string; expr: string; display: string }
  schedule_display: string
  repeat: { times: number | null; completed: number }
  enabled: boolean
  state: string
  paused_at: string | null
  paused_reason: string | null
  created_at: string
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  deliver: string | null
  origin: { platform: string; chat_id: string; chat_name: string } | null
  skills: string[]
  model: string | null
  provider: string | null
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const now = Date.now()
  const diff = d.getTime() - now
  const absDiff = Math.abs(diff)
  const minutes = Math.floor(absDiff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (absDiff < 60000) return 'agora'
  if (minutes < 60) return diff > 0 ? `em ${minutes}m` : `há ${minutes}m`
  if (hours < 24) return diff > 0 ? `em ${hours}h` : `há ${hours}h`
  return diff > 0 ? `em ${days}d` : `há ${days}d`
}

/* ── Cron Job Edit/Create Dialog ──────────────────── */

function CronJobDialog({
  job,
  onSave,
  onClose,
  isSaving,
}: {
  job: CronJob | null
  onSave: (data: Record<string, unknown>) => void
  onClose: () => void
  isSaving: boolean
}) {
  const [name, setName] = useState(job?.name || '')
  const [schedule, setSchedule] = useState(job?.schedule?.expr || job?.schedule_display || '0 * * * *')
  const [prompt, setPrompt] = useState(job?.prompt || '')
  const [enabled, setEnabled] = useState(job?.enabled ?? true)
  const [model, setModel] = useState(job?.model || '')
  const [deliver, setDeliver] = useState(job?.deliver || 'origin')
  const [availableModels, setAvailableModels] = useState<{ model: string; provider: string }[]>([])
  const [defaultModel, setDefaultModel] = useState<{ model: string; provider: string }>({ model: '', provider: '' })
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    lastFocusedRef.current = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      lastFocusedRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('agentos_access_token')
    fetch('/api/models', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setAvailableModels(data.models || [])
          setDefaultModel(data.default || { model: '', provider: '' })
        }
      })
      .catch(() => {})
  }, [])

  // Determine initial select value: match existing job model, or default
  const [modelSelect, setModelSelect] = useState(() => {
    if (job?.model === '' || job?.model === null || job?.model === undefined) return ''
    return job?.model || ''
  })

  const handleModelSelectChange = (val: string) => {
    setModelSelect(val)
    if (val === '__none__') {
      setModel('')
    } else {
      setModel(val)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data: Record<string, unknown> = {
      name: name.trim(),
      schedule: schedule.trim(),
      prompt: prompt.trim(),
      enabled,
      deliver,
    }
    if (modelSelect === '__none__') {
      data.model = ''
    } else if (model.trim()) {
      data.model = model.trim()
    }
    onSave(data)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        ref={dialogRef}
        className="brand-card max-h-[85vh] w-full max-w-xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={job ? 'Editar tarefa agendada' : 'Nova tarefa agendada'}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold text-text-primary">
            {job ? 'Editar tarefa agendada' : 'Nova tarefa agendada'}
          </h2>
          <button ref={closeButtonRef} onClick={onClose} aria-label="Fechar" className="text-xl leading-none text-text-tertiary hover:text-text-primary">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="ex.: Resumo diário"
              className="w-full bg-bg-base border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Agendamento <span className="text-text-tertiary">(expressão cron)</span>
            </label>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              required
              placeholder="0 * * * *"
              className="w-full bg-bg-base border border-border rounded-md px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <p className="text-[11px] text-text-tertiary mt-1">
              minuto hora dia mês dia-da-semana &mdash; ex.: <code className="text-accent">0 8 * * 1-5</code> = dias úteis às 8h,{' '}
              <code className="text-accent">0 */6 * * *</code> = a cada 6h,{' '}
              <code className="text-accent">30 21 * * 2</code> = terças às 21h30
            </p>
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="Descreva o que esta tarefa deve fazer…"
              className="w-full bg-bg-base border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40 resize-y font-mono text-xs leading-relaxed"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Modelo <span className="text-text-tertiary">(opcional)</span></label>
            <select
              value={modelSelect}
              onChange={(e) => handleModelSelectChange(e.target.value)}
              className="w-full bg-bg-base border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="">
                Padrão{defaultModel.model ? ` (${defaultModel.model} — ${defaultModel.provider})` : ''}
              </option>
              {Object.entries(
                availableModels.reduce<Record<string, typeof availableModels>>((acc, m) => {
                  const p = m.provider || 'unknown'
                  ;(acc[p] ||= []).push(m)
                  return acc
                }, {})
              ).map(([provider, pmodels]) => (
                <optgroup key={provider} label={provider}>
                  {pmodels.map((m) => (
                    <option key={`${provider}-${m.model}`} value={m.model}>
                      {m.model}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="__none__">Sem modelo (somente script)</option>
            </select>
            {modelSelect === '__none__' ? (
              <p className="text-[11px] text-text-tertiary mt-1">
                A tarefa executará apenas o script — sem processamento de LLM. O prompt ainda é enviado, mas nenhum modelo é invocado.
              </p>
            ) : (
              <p className="text-[11px] text-text-tertiary mt-1">
                Deixe em Padrão para usar o modelo do sistema{defaultModel.model ? ` (${defaultModel.model})` : ''}. Escolha um modelo específico para sobrescrever.
              </p>
            )}
          </div>

          {/* Deliver */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Entregar em</label>
            <select
              value={deliver}
              onChange={(e) => setDeliver(e.target.value)}
              className="w-full bg-bg-base border border-border rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="origin">Chat de origem</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="none">Sem entrega</option>
            </select>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                enabled ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
            <span className="text-sm text-text-secondary">{enabled ? 'Ativo' : 'Pausado'}</span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md text-text-secondary hover:text-text-primary hover:bg-surface/60 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim() || !schedule.trim()}
              className="px-4 py-2 text-sm rounded-md bg-accent text-white hover:bg-accent/80 disabled:opacity-50 transition-colors font-medium"
            >
              {isSaving ? 'Salvando…' : job ? 'Salvar alterações' : 'Criar tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Cron Page (table + dialog) ─────────────────────── */

function CronPage() {
  const [editJob, setEditJob] = useState<CronJob | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const admin = isAdmin()

  const { data, isLoading, error } = useQuery({
    queryKey: ['cron-jobs'],
    queryFn: async () => {
      const res = await fetch('/api/cron')
      if (!res.ok) throw new Error('Falha ao carregar tarefas agendadas')
      return res.json() as Promise<{ jobs: CronJob[] }>
    },
    refetchInterval: 10000,
  })

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/cron', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Falha ao criar tarefa')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
      setShowCreate(false)
    },
    onError: (e: Error) => toast(e.message || 'Falha na solicitação', 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown>) => {
      const res = await fetch(`/api/cron/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Falha ao atualizar tarefa')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] })
      setEditJob(null)
    },
    onError: (e: Error) => toast(e.message || 'Falha na solicitação', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/cron/${jobId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json().catch(() => null)  // M28-03: 2xx empty body = sucesso
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron-jobs'] }),
    onError: (e: Error) => toast(e.message || 'Falha na solicitação', 'error'),
  })

  const pauseMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/cron/${jobId}/pause`, { method: 'POST' })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron-jobs'] }),
    onError: (e: Error) => toast(e.message || 'Falha na solicitação', 'error'),
  })

  const resumeMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/cron/${jobId}/resume`, { method: 'POST' })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron-jobs'] }),
    onError: (e: Error) => toast(e.message || 'Falha na solicitação', 'error'),
  })

  const runNowMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/cron/${jobId}/run`, { method: 'POST' })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json() as Promise<{ status: string; message: string }>
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron-jobs'] }),
    onError: (e: Error) => toast(e.message || 'Falha na solicitação', 'error'),
  })

  const jobs = data?.jobs || []
  const activeCount = jobs.filter(j => j.enabled && j.state !== 'paused').length
  const pausedCount = jobs.filter(j => !j.enabled || j.state === 'paused').length

  const renderJobActions = (job: CronJob, isPaused: boolean) => (
    <>
      <button
        onClick={() => runNowMutation.mutate(job.id)}
        disabled={runNowMutation.isPending && runNowMutation.variables === job.id}
        className="rounded bg-accent/10 px-2 py-1 text-[11px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        title="Executar agora"
      >
        {runNowMutation.isPending && runNowMutation.variables === job.id ? '…' : '▶ Executar'}
      </button>
      <button
        onClick={() => setEditJob(job)}
        className="rounded bg-surface/60 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
        title="Editar tarefa"
      >
        ✎ Editar
      </button>
      {isPaused ? (
        <button
          onClick={() => resumeMutation.mutate(job.id)}
          disabled={resumeMutation.isPending && resumeMutation.variables === job.id}
          className="rounded bg-success/10 px-2 py-1 text-[11px] text-success transition-colors hover:bg-success/20 disabled:opacity-50"
          title="Retomar"
        >
          {resumeMutation.isPending && resumeMutation.variables === job.id ? '…' : '▶ Retomar'}
        </button>
      ) : (
        <button
          onClick={() => pauseMutation.mutate(job.id)}
          disabled={pauseMutation.isPending && pauseMutation.variables === job.id}
          className="rounded bg-warning/10 px-2 py-1 text-[11px] text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
          title="Pausar"
        >
          {pauseMutation.isPending && pauseMutation.variables === job.id ? '…' : '⏸ Pausar'}
        </button>
      )}
      <button
        onClick={() => {
          if (window.confirm(`Excluir a tarefa agendada "${job.name || job.id}"? Isso não pode ser desfeito.`)) {
            deleteMutation.mutate(job.id)
          }
        }}
        disabled={deleteMutation.isPending && deleteMutation.variables === job.id}
        className="rounded bg-error/10 px-2 py-1 text-[11px] text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        title="Excluir"
        aria-label={`Excluir ${job.name || job.id}`}
      >
        {deleteMutation.isPending && deleteMutation.variables === job.id ? '…' : '✕'}
      </button>
    </>
  )

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Operação agendada"
        title="Cron"
        subtitle={
          isLoading
            ? 'Carregando tarefas agendadas…'
            : error
              ? 'Não foi possível carregar as tarefas agendadas.'
              : `${jobs.length} tarefa${jobs.length === 1 ? '' : 's'} · ${activeCount} ativa${activeCount === 1 ? '' : 's'}${pausedCount > 0 ? ` · ${pausedCount} pausada${pausedCount === 1 ? '' : 's'}` : ''}`
        }
        actions={admin ? (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80"
          >
            <span className="text-base leading-none">+</span> Nova tarefa
          </button>
        ) : undefined}
      />

      <main className="mt-6 pb-12">
        {isLoading && (
          <div className="space-y-3" role="status" aria-label="Carregando tarefas agendadas">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="brand-card p-4">
                <div className="mb-2 h-4 w-40 animate-pulse rounded bg-surface/60" />
                <div className="mb-3 h-3 w-64 animate-pulse rounded bg-surface/60" />
                <div className="h-8 w-32 animate-pulse rounded bg-surface/60" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            Não foi possível carregar as tarefas agendadas.
          </div>
        )}

        {!isLoading && !error && jobs.length === 0 && (
          <div className="brand-card p-8 text-center">
            <p className="text-sm text-text-secondary">Nenhuma tarefa agendada.</p>
            <p className="mt-1 text-xs text-text-tertiary">
              {admin ? 'Use “+ Nova tarefa” para criar a primeira tarefa agendada.' : 'Nenhuma tarefa disponível no momento.'}
            </p>
          </div>
        )}

        {!isLoading && !error && jobs.length > 0 && (
          <>
            <div className="space-y-3 lg:hidden">
              {jobs.map((job) => {
                const isPaused = !job.enabled || job.state === 'paused'
                const schedule = job.schedule?.display || job.schedule_display || '—'
                return (
                  <div key={job.id} className="brand-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-primary">{job.name || job.id}</p>
                        {job.model && (
                          <p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{job.model}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${isPaused ? 'text-warning' : 'text-success'}`}>
                          <span className={`inline-block h-2 w-2 rounded-full ${isPaused ? 'bg-warning' : 'bg-success'}`} />
                          {isPaused ? 'Pausado' : 'Ativo'}
                        </span>
                        {job.last_status && (
                          <span
                            aria-label={job.last_status === 'ok' ? 'Última execução concluída' : 'Última execução falhou'}
                            className={`rounded px-1.5 py-0.5 text-[11px] ${
                              job.last_status === 'ok' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                            }`}
                          >
                            {job.last_status === 'ok' ? '✓' : '✗'}
                          </span>
                        )}
                      </div>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-text-tertiary">Agendamento</dt>
                        <dd className="break-all font-mono text-text-secondary">{schedule}</dd>
                      </div>
                      <div>
                        <dt className="text-text-tertiary">Última execução</dt>
                        <dd className="text-text-secondary">{formatRelativeTime(job.last_run_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-text-tertiary">Próxima execução</dt>
                        <dd className="text-text-secondary">{formatRelativeTime(job.next_run_at)}</dd>
                      </div>
                    </dl>

                    {admin && (
                      <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3">
                        {renderJobActions(job, isPaused)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="brand-card hidden overflow-hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" aria-label="Tarefas agendadas">
                <thead>
                  <tr className="bg-surface/40 text-left text-xs uppercase tracking-wider text-text-tertiary">
                    <th className="px-4 py-3 font-medium">Nome</th>
                    <th className="px-4 py-3 font-medium">Agendamento</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">Última execução</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">Próxima execução</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {jobs.map((job) => {
                    const isPaused = !job.enabled || job.state === 'paused'
                    const schedule = job.schedule?.display || job.schedule_display || '—'
                    return (
                      <tr key={job.id} className="transition-colors hover:bg-surface/30">
                        <td className="px-4 py-3">
                          <div className="max-w-[200px] truncate font-medium text-text-primary">{job.name || job.id}</div>
                          {job.model && (
                            <div className="mt-0.5 font-mono text-[11px] text-text-tertiary">{job.model}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-text-secondary">{schedule}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 text-xs ${isPaused ? 'text-warning' : 'text-success'}`}>
                              <span className={`inline-block h-2 w-2 rounded-full ${isPaused ? 'bg-warning' : 'bg-success'}`} />
                              {isPaused ? 'Pausado' : 'Ativo'}
                            </span>
                            {job.last_status && (
                              <span
                                aria-label={job.last_status === 'ok' ? 'Última execução concluída' : 'Última execução falhou'}
                                className={`rounded px-1.5 py-0.5 text-[11px] ${
                                  job.last_status === 'ok' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                                }`}
                              >
                                {job.last_status === 'ok' ? '✓' : '✗'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 text-xs text-text-tertiary lg:table-cell">
                          {formatRelativeTime(job.last_run_at)}
                        </td>
                        <td className="hidden px-4 py-3 text-xs text-text-tertiary lg:table-cell">
                          {formatRelativeTime(job.next_run_at)}
                        </td>
                        <td className="px-4 py-3">
                          {admin && (
                            <div className="flex items-center justify-end gap-1">
                              {renderJobActions(job, isPaused)}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}

        {runNowMutation.isSuccess && runNowMutation.data && (
          <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-accent/30 bg-bg-elevated px-4 py-3 shadow-lg">
            <p className="text-sm font-medium text-text-primary">Tarefa disparada</p>
            <p className="mt-0.5 text-xs text-text-secondary">{(runNowMutation.data as { message: string }).message}</p>
          </div>
        )}
      </main>

      {showCreate && (
        <CronJobDialog
          job={null}
          onSave={(data) => createMutation.mutate(data)}
          onClose={() => setShowCreate(false)}
          isSaving={createMutation.isPending}
        />
      )}

      {editJob && (
        <CronJobDialog
          job={editJob}
          onSave={(data) => updateMutation.mutate({ id: editJob.id, ...data })}
          onClose={() => setEditJob(null)}
          isSaving={updateMutation.isPending}
        />
      )}
    </PageContainer>
  )
}

/* ── Skills Hub ────────────────────────────────────── */

function skillCategoryLabel(category?: string): string {
  if (!category) return 'Outra'
  return category.toLowerCase() === 'other' ? 'Outra' : category
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/)
  return match ? content.slice(match[0].length) : content
}

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
      className="brand-card brand-card-hover text-left p-4 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-body font-semibold text-text-primary">{skill.name}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${colorClass}`}>
          {skillCategoryLabel(skill.category)}
        </span>
      </div>
      <p className="text-body-sm text-text-secondary line-clamp-2 mb-3">
        {skill.description}
      </p>
      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        <span>{skill.file_count} arquivo{skill.file_count === 1 ? '' : 's'}</span>
        {skill.has_references && <span title="Possui referências">📄</span>}
        {skill.has_scripts && <span title="Possui scripts">⚙️</span>}
        {skill.has_templates && <span title="Possui templates">📋</span>}
      </div>
      {skill.profiles && skill.profiles.length > 0 ? (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <span className="text-text-tertiary text-xs">Usado por:</span>
          {skill.profiles.map(p => (
            <span key={p} className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">{p}</span>
          ))}
        </div>
      ) : (
        <div className="mt-2">
          <span className="text-xs text-amber-400">Sem uso</span>
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
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!selectedSlug) return
    lastFocusedRef.current = document.activeElement as HTMLElement | null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedSlug(null)
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      lastFocusedRef.current?.focus()
    }
  }, [selectedSlug])

  const { data: skills, isLoading, error } = useQuery({
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

  useEffect(() => {
    if (!selectedSlug || !selectedSkill) return
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [selectedSlug, selectedSkill?.slug])

  const filtered = useMemo(() => {
    if (!skills) return []
    let result = skills.filter((s: Skill) => {
      const matchesSearch = !search || (s.name || '').toLowerCase().includes(search.toLowerCase()) || (s.description || '').toLowerCase().includes(search.toLowerCase())
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
    <PageContainer>
      <PageHeader
        eyebrow="Biblioteca de habilidades"
        title="Skills"
        subtitle={error ? 'Não foi possível carregar o catálogo de skills.' : `${skills?.length || 0} skill${(skills?.length || 0) === 1 ? '' : 's'} instalada${(skills?.length || 0) === 1 ? '' : 's'} no workspace.`}
      />

      <main className="mt-6 pb-12">
        <div className="brand-card mb-6 flex flex-col gap-3 p-3 sm:flex-row">
          <input
            type="text"
            placeholder="Buscar skills…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input flex-1 rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            {categories.map((cat: string) => (
              <option key={cat} value={cat}>{cat === 'all' ? 'Todas as categorias' : skillCategoryLabel(cat)}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'name-asc' | 'name-desc' | 'files')}
            className="rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            <option value="name-asc">Nome A-Z</option>
            <option value="name-desc">Nome Z-A</option>
            <option value="files">Mais arquivos</option>
          </select>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
            Não foi possível carregar as skills.
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Carregando skills">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="brand-card p-4">
                <div className="mb-3 h-4 w-40 animate-pulse rounded bg-surface/60" />
                <div className="mb-2 h-3 w-full animate-pulse rounded bg-surface/40" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-surface/40" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 && !error ? (
          <div className="brand-card p-8 text-center text-body-sm text-text-secondary">Nenhuma skill encontrada.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((skill: Skill) => (
              <SkillCard key={skill.slug} skill={skill} onClick={() => setSelectedSlug(skill.slug)} />
            ))}
          </div>
        )}

        {selectedSlug && selectedSkill && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedSlug(null)}>
            <div
              ref={dialogRef}
              className="brand-card max-h-[80vh] w-full max-w-2xl overflow-y-auto p-6"
              onClick={e => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={selectedSkill.name}
            >
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-h2 font-bold text-text-primary">{selectedSkill.name}</h2>
                <button ref={closeButtonRef} onClick={() => setSelectedSlug(null)} className="text-text-secondary hover:text-text-primary text-xl" aria-label="Fechar">×</button>
              </div>
              <p className="text-text-secondary mb-4">{selectedSkill.description}</p>
              <div className="flex gap-4 text-xs text-text-tertiary mb-4">
                <span>{selectedSkill.file_count} arquivo{selectedSkill.file_count === 1 ? '' : 's'}</span>
                <span>{skillCategoryLabel(selectedSkill.category)}</span>
              </div>
              <div className="border-t border-border pt-4">
                <MarkdownRenderer content={stripFrontmatter(selectedSkill.full_content)} />
              </div>
              {selectedSkill.files?.length > 0 && (
                <div className="border-t border-border mt-4 pt-4">
                  <h3 className="text-body font-semibold text-text-primary mb-2">Arquivos</h3>
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
    </PageContainer>
  )
}
