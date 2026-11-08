import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/* ── Shell context ─────────────────────────────────────
   Pages still render <NavBar /> for legacy reasons. Inside
   the shell it becomes a no-op so we don't end up with two
   navbars (and no duplicate theme effects). */
const AppShellContext = createContext(false)
export const useAppShell = () => useContext(AppShellContext)

type NavItem = {
  to: string
  label: string
  icon: IconName
}

type NavGroup = {
  label: string
  adminOnly?: boolean
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { to: '/', label: 'Dashboard', icon: 'home' },
      { to: '/chat', label: 'Chat', icon: 'chat' },
    ],
  },
  {
    label: 'Operação',
    adminOnly: true,
    items: [
      { to: '/sessions', label: 'Sessões', icon: 'sessions' },
      { to: '/tasks', label: 'Tarefas', icon: 'tasks' },
      { to: '/cron', label: 'Cron', icon: 'clock' },
    ],
  },
  {
    label: 'Inteligência',
    adminOnly: true,
    items: [
      { to: '/skills', label: 'Skills', icon: 'skills' },
      { to: '/profiles', label: 'Profiles', icon: 'profiles' },
      { to: '/workflows', label: 'Workflows', icon: 'workflow' },
      { to: '/memory', label: 'Memória', icon: 'memory' },
    ],
  },
  {
    label: 'Sistema',
    adminOnly: true,
    items: [
      { to: '/analytics', label: 'Analytics', icon: 'chart' },
      { to: '/config', label: 'Config', icon: 'config' },
      { to: '/settings', label: 'Usuários', icon: 'users' },
    ],
  },
]

type IconName =
  | 'home'
  | 'chat'
  | 'sessions'
  | 'tasks'
  | 'clock'
  | 'skills'
  | 'profiles'
  | 'workflow'
  | 'memory'
  | 'chart'
  | 'config'
  | 'users'

const ICONS: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /><path d="M9.5 21v-6h5v6" /></>,
  chat: <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 9.7 9.7 0 0 1-3.8-.8L3 21l1.8-5.2A8.5 8.5 0 1 1 21 11.5Z" />,
  sessions: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 9h10M7 13h6" /></>,
  tasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  skills: <><path d="m12 3 2.2 5.2L20 10.5l-5.8 2.3L12 18l-2.2-5.2L4 10.5l5.8-2.3L12 3Z" /><path d="m18.5 16 .8 1.8 1.7.7-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.7.8-1.8Z" /></>,
  profiles: <><circle cx="12" cy="8" r="3.2" /><path d="M5 20c.7-3.4 3.3-5.2 7-5.2s6.3 1.8 7 5.2" /></>,
  workflow: <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><path d="M14 17h6M17 14v6" /></>,
  memory: <path d="M12 3v18M5 8.5C5 6.6 7 5 10 5h4c3 0 5 1.6 5 3.5S17 12 14 12h-4c-3 0-5 1.6-5 3.5S7 19 10 19h4c3 0 5-1.6 5-3.5" />,
  chart: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  config: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M16 5.5a3 3 0 0 1 0 5.8M18 14.5c2 .6 3.3 2.4 3.7 5" /></>,
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

const SIDEBAR_KEY = 'agentos.sidebar.collapsed'

function readCollapsed() {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(SIDEBAR_KEY) === '1'
}

function isActivePath(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

function currentGroup(pathname: string, admin = false) {
  return NAV_GROUPS.find(
    (group) => (!group.adminOnly || admin) && group.items.some((item) => isActivePath(pathname, item.to)),
  )
}

function Sidebar({
  collapsed,
  onToggle,
  theme,
  mobile = false,
  onNavigate,
}: {
  collapsed: boolean
  onToggle?: () => void
  theme: 'dark' | 'light'
  mobile?: boolean
  onNavigate?: () => void
}) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const admin = user?.role === 'admin'
  const groups = NAV_GROUPS.filter((group) => !group.adminOnly || admin)

  return (
    <aside className={`agent-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="agent-brand">
        <Link to="/" className="agent-brand-link" aria-label="AgentOS" onClick={() => onNavigate?.()}>
          <img
            src={theme === 'light' ? '/logo-light.svg' : '/logo.svg'}
            alt="AgentOS"
            className="agent-logo-full"
          />
          <img
            src="/favicon.svg"
            alt=""
            className="agent-logo-glyph"
            aria-hidden="true"
          />
        </Link>
      </div>

      {!mobile && onToggle && (
        <button
          type="button"
          className="agent-rail-toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Encolher barra lateral'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expandir barra lateral' : 'Encolher barra lateral'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      )}

      <nav className="agent-nav" aria-label="Navegação principal">
        {groups.map((group) => (
          <div className="agent-nav-group" key={group.label}>
            <div className="agent-nav-label">{group.label}</div>
            {group.items.map((item) => {
              const active = isActivePath(location.pathname, item.to)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`agent-nav-item ${active ? 'is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  onClick={() => onNavigate?.()}
                >
                  <span className="agent-nav-icon"><Icon name={item.icon} /></span>
                  <span className="agent-nav-copy">{item.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="agent-sidebar-foot">
        <div className="agent-user">
          <div className="agent-avatar" aria-hidden="true">
            {(user?.username || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="agent-nav-copy agent-user-copy">
            <div className="agent-user-name">{user?.username || '—'}</div>
            <div className="agent-user-role">{admin ? 'Administrador' : 'Membro'}</div>
          </div>
          <button type="button" className="agent-logout" onClick={logout} title="Sair" aria-label="Sair">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}

function Topbar({
  theme,
  onToggleTheme,
  onOpenSearch,
  onOpenMobile,
  menuButtonRef,
  mobileOpen,
}: {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenSearch?: () => void
  onOpenMobile: () => void
  menuButtonRef: React.RefObject<HTMLButtonElement>
  mobileOpen: boolean
}) {
  const location = useLocation()
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const group = currentGroup(location.pathname, admin)
  const item = group?.items.find((entry) => isActivePath(location.pathname, entry.to))
  const title = item?.label || (location.pathname === '/' ? 'Visão geral' : location.pathname === '/chat' ? 'Chat' : 'AgentOS')

  return (
    <header className="agent-topbar">
      <button
        ref={menuButtonRef}
        type="button"
        className="agent-mobile-menu"
        onClick={onOpenMobile}
        aria-label="Abrir navegação"
        aria-expanded={mobileOpen}
        aria-controls="agent-mobile-nav"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <div className="agent-crumb">
        {group && group.label !== 'Principal' ? <><span>{group.label}</span><i>/</i><b>{title}</b></> : <b>{title}</b>}
      </div>

      <div className="agent-top-actions">
        {onOpenSearch && (
          <button type="button" className="agent-search" onClick={onOpenSearch} title="Busca rápida (⌘K)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span>Buscar</span>
            <kbd>⌘K</kbd>
          </button>
        )}
        <button
          type="button"
          className="agent-icon-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  )
}

export default function AppShell({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    return (localStorage.getItem('agentos-theme') as 'dark' | 'light') || 'dark'
  })
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const mobileButtonRef = useRef<HTMLButtonElement>(null)
  const mobileDrawerRef = useRef<HTMLDivElement>(null)
  const wasMobileOpen = useRef(false)

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('agentos-theme', theme)
  }, [theme])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (mobileOpen) {
      const frame = requestAnimationFrame(() => {
        mobileDrawerRef.current?.querySelector<HTMLElement>('.agent-nav-item')?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }
    if (wasMobileOpen.current) mobileButtonRef.current?.focus()
    wasMobileOpen.current = true
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false)
        return
      }
      if (event.key !== 'Tab' || !mobileDrawerRef.current) return
      const focusable = Array.from(
        mobileDrawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0')
      return next
    })
  }

  const isChat = location.pathname === '/chat' || location.pathname.startsWith('/chat/')

  return (
    <AppShellContext.Provider value={true}>
      <div className={`agent-shell ${collapsed ? 'is-collapsed' : ''}`}>
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} theme={theme} />

        <div className="agent-workspace">
          <Topbar
            theme={theme}
            onToggleTheme={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
            onOpenSearch={onOpenSearch}
            onOpenMobile={() => setMobileOpen(true)}
            menuButtonRef={mobileButtonRef}
            mobileOpen={mobileOpen}
          />
          <main className={`agent-main ${isChat ? 'is-chat' : ''}`}>
            <Outlet />
          </main>
        </div>

        {mobileOpen && (
          <div className="agent-mobile-layer">
            <button
              type="button"
              className="agent-mobile-backdrop"
              onClick={() => setMobileOpen(false)}
              aria-label="Fechar navegação"
            />
            <div
              id="agent-mobile-nav"
              ref={mobileDrawerRef}
              className="agent-mobile-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navegação"
            >
              <Sidebar
                collapsed={false}
                theme={theme}
                mobile
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </div>
        )}
      </div>
    </AppShellContext.Provider>
  )
}
