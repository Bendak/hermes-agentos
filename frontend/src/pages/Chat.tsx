import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavBar, MarkdownRenderer } from '../App'
import { useAuth } from '../auth/AuthContext'
import { apiErrorMessage } from '../lib/api'

interface ChatSession {
  id: string
  profile: string
  title: string
  created_at: number
  updated_at: number
  archived: boolean
}

interface ToolCall {
  id?: string
  type?: string
  name?: string
  arguments?: string
  function?: { name?: string; arguments?: string }
}

interface ChatAttachment {
  kind?: string
  name?: string
  mime?: string
  caption?: string
  path?: string
  url?: string
}

interface PendingAttachment {
  path: string
  name: string
  mime: string
  size: number
}

interface ApprovalOption {
  id: string
  label: string
  style?: string
}

interface ApprovalCard {
  prompt_id: string
  kind: string
  text: string
  options: ApprovalOption[]
}

interface ChatMsg {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp?: string | number
  tool_name?: string | null
  reasoning_content?: string | null
  tool_calls?: ToolCall[] | null
  display_kind?: string | null
  error?: { code?: string; message?: string } | null
  attachments?: ChatAttachment[]
  turn_id?: string | null
}

interface LiveTool {
  name: string
  status: 'running' | 'done' | 'failed'
  preview?: string
}

function toolCallName(tc: ToolCall): string {
  return tc.function?.name || tc.name || tc.type || 'tool'
}

function toolCallArgs(tc: ToolCall): string {
  return tc.function?.arguments || tc.arguments || ''
}

interface RenderTool {
  name: string
  args?: string
  output?: string
}

interface ToolEntry extends RenderTool {
  status?: 'running' | 'done' | 'failed'
  preview?: string
}

const UPLOAD_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
  'pdf', 'txt', 'md', 'csv', 'json', 'doc', 'docx', 'odt', 'rtf',
  'mp3', 'wav', 'ogg', 'm4a', 'webm', 'mp4', 'mov',
])

interface RenderItem {
  role: 'user' | 'agent'
  content: string
  reasoning?: string
  tools: RenderTool[]
  attachments: ChatAttachment[]
  error?: string
  ts?: string | number
}

/** Mesmo formato da view de sessão: cada passo do agente vira um bloco com timestamp. */
function buildItems(messages: ChatMsg[]): RenderItem[] {
  const items: RenderItem[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      items.push({ role: 'user', content: m.content, tools: [], attachments: m.attachments || [], ts: m.timestamp })
      continue
    }
    if (m.role === 'tool') {
      const agents = items.filter((i) => i.role === 'agent')
      const name = m.tool_name || 'tool'
      if (agents.length > 0) {
        // Tool results can arrive after more than one assistant message. Attach
        // to the oldest unfilled slot that matches, not blindly to the last
        // agent bubble, so a later intermediate group never steals this output.
        const target = agents.find((i) =>
          i.tools.some((t) => t.output === undefined && (!m.tool_name || t.name === name)),
        ) || agents[agents.length - 1]
        const slot = target.tools.find((t) => t.output === undefined && (!m.tool_name || t.name === name))
        if (slot) slot.output = m.content
        else target.tools.push({ name, output: m.content })
      } else {
        items.push({ role: 'agent', content: '', tools: [{ name, output: m.content }], attachments: [], ts: m.timestamp })
      }
      continue
    }
    const tools: RenderTool[] = (m.tool_calls || []).map((tc) => ({
      name: toolCallName(tc),
      args: toolCallArgs(tc),
    }))
    items.push({
      role: 'agent',
      content: m.content || '',
      reasoning: m.reasoning_content || '',
      tools,
      attachments: m.attachments || [],
      error: m.error?.message,
      ts: m.timestamp,
    })
  }
  return items.filter((i) => i.role === 'user' || i.content || i.reasoning || i.tools.length > 0)
}

function fmtTs(ts?: string | number): string {
  if (ts === undefined || ts === null || ts === '') return ''
  const raw = typeof ts === 'number' ? ts : Number(ts)
  const ms = Number.isFinite(raw) ? (raw > 1e11 ? raw : raw * 1000) : Date.parse(String(ts))
  if (!Number.isFinite(ms)) return ''
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((x) => x.type === type)?.value || ''
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`
}

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem('agentos_access_token')
  const h: Record<string, string> = {}
  if (token) h['Authorization'] = 'Bearer ' + token
  if (json) h['Content-Type'] = 'application/json'
  return h
}

function dayBucket(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return 'Previous 7 days'
  if (diffDays < 30) return 'Previous 30 days'
  return 'Older'
}

/** Consome o SSE do gateway (frames completos: `event:` + `data:` + linha vazia). */
async function streamTurn(
  sessionId: string,
  text: string,
  onEvent: (event: string, payload: Record<string, unknown>) => void,
  signal: AbortSignal,
  media: PendingAttachment[] = [],
): Promise<void> {
  const res = await fetch('/api/chat/sessions/' + sessionId + '/stream', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      message: text,
      media_urls: media.map((m) => m.path),
      media_types: media.map((m) => m.mime),
      media_filenames: media.map((m) => m.name),
    }),
    signal,
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res))
  if (!res.body) throw new Error('Empty stream')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      try {
        onEvent(event, JSON.parse(data))
      } catch {
        /* frame parcial/ruído: o transcript canônico vem no reload final */
      }
    }
  }
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mb-1 w-full min-w-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide reasoning' : 'Show reasoning'}
        className="text-caption text-text-tertiary italic transition hover:text-text-secondary"
      >
        {expanded ? 'Hide thinking…' : 'Thinking…'}
      </button>
      {expanded && (
        <div className="mt-1 max-h-80 w-full min-w-0 overflow-y-auto rounded-lg border border-border bg-bg-base/40 p-2 text-caption italic text-text-tertiary whitespace-pre-wrap">
          <div className="w-full min-w-0" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            <MarkdownRenderer content={text} />
          </div>
        </div>
      )}
    </div>
  )
}

function ToolRow({ tool, index }: { tool: ToolEntry; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const label = tool.name && tool.name !== 'tool' ? tool.name : (tool.args || 'command')
  const body = [
    tool.args != null ? 'ARGS\n' + (tool.args || '—') : '',
    tool.output != null ? 'OUTPUT\n' + (tool.output || '—') : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const hasBody = Boolean(body)
  const statusIcon = tool.status === 'running'
    ? '⏳'
    : tool.status === 'failed'
      ? '⚠️'
      : tool.output != null || tool.status === 'done'
        ? '✓'
        : ''
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => hasBody && setExpanded((v) => !v)}
        disabled={!hasBody}
        aria-expanded={hasBody ? expanded : undefined}
        aria-label={`Tool ${index}: ${label || 'unknown'}`}
        className={
          'flex w-full items-center gap-2 px-3 py-2 text-left text-mono-sm text-text-secondary transition ' +
          (hasBody ? 'cursor-pointer hover:bg-bg-base/60' : 'cursor-default')
        }
      >
        <span className="min-w-5 shrink-0 px-0.5 text-right text-[10px] tabular-nums text-text-tertiary">{index}.</span>
        <span className="min-w-0 flex-1 truncate text-mono-sm text-text-secondary">{label || 'unknown'}</span>
        {statusIcon ? <span className="shrink-0 text-[11px] text-text-tertiary">{statusIcon}</span> : null}
        {tool.preview && !expanded ? (
          <span className="max-w-[38%] shrink-0 truncate text-[10px] text-text-tertiary">{tool.preview}</span>
        ) : null}
        {hasBody ? (
          <span
            className="shrink-0 text-text-tertiary transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            aria-hidden="true"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        ) : null}
      </button>
      {expanded && hasBody && (
        <div className="max-h-96 w-full min-w-0 overflow-y-auto overflow-x-hidden border-t border-border px-3 py-2" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          <pre className="whitespace-pre-wrap break-words text-[11px] text-text-tertiary">{body}</pre>
        </div>
      )}
    </div>
  )
}

function ToolGroup({ tools }: { tools: ToolEntry[] }) {
  const [expanded, setExpanded] = useState(false)
  if (tools.length === 0) return null
  const running = tools.some((t) => t.status === 'running')
  return (
    <div className="my-1 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-bg-elevated font-mono">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tools.length} tool call${tools.length === 1 ? '' : 's'}`}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-mono-sm text-text-secondary transition hover:bg-bg-base/60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-block shrink-0 rounded bg-surface px-1.5 py-0.5 text-overline uppercase">Tools</span>
          <span className="truncate text-mono-sm text-text-secondary">
            {tools.length} tool{tools.length === 1 ? '' : 's'}
          </span>
          {running ? <span className="shrink-0 text-[10px] text-text-tertiary">running…</span> : null}
        </span>
        <span
          className="shrink-0 text-text-tertiary transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border">
          {tools.map((tool, k) => (
            <ToolRow key={k} tool={tool} index={k + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function safeAttachmentUrl(raw?: string): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function AttachmentCard({ item }: { item: ChatAttachment }) {
  const label = item.name || item.kind || 'attachment'
  const href = safeAttachmentUrl(item.url)
  return (
    <div className="flex w-full max-w-[80%] items-center gap-3 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-xs">
      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">
        {item.kind || 'file'}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-secondary" title={label}>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">open</a>
      ) : null}
      {item.caption ? <span className="max-w-[40%] truncate text-text-tertiary">{item.caption}</span> : null}
    </div>
  )
}

export default function ChatPage() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [uploadingCount, setUploadingCount] = useState(0)
  const [streamText, setStreamText] = useState('')
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [thinking, setThinking] = useState('')
  const [liveTools, setLiveTools] = useState<LiveTool[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [liveAttachments, setLiveAttachments] = useState<ChatAttachment[]>([])
  const [approvalCards, setApprovalCards] = useState<ApprovalCard[]>([])
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string>('default')

  const bottomRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const turnIdRef = useRef<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([])
  const uploadingRef = useRef(0)
  const reservedSlotsRef = useRef(0)

  const active = useMemo(() => sessions.find((s) => s.id === activeId) || null, [sessions, activeId])

  const scrollDown = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments
  }, [pendingAttachments])

  useEffect(() => {
    scrollDown()
  }, [messages, streamText, scrollDown])

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const res = await fetch('/api/chat/sessions', { headers: authHeaders() })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      const body = await res.json()
      const rows: ChatSession[] = body.data || []
      setSessions(rows)
      return rows
    } catch (err) {
      setError((err as Error).message)
      return []
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  const loadMessages = useCallback(async (id: string, clearError = true) => {
    setLoadingMessages(true)
    if (clearError) setError(null)
    try {
      const res = await fetch('/api/chat/sessions/' + id + '/messages?limit=200&tail=1', { headers: authHeaders() })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      const body = await res.json()
      const data: ChatMsg[] = body.data || []
      setMessages(data)
      const lastUser = [...data].reverse().find((m) => m.role === 'user' && m.turn_id)
      turnIdRef.current = lastUser?.turn_id || null
    } catch (err) {
      setError((err as Error).message)
      setMessages([])
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role !== 'admin') return
    void (async () => {
      try {
        const res = await fetch('/api/profiles', { headers: authHeaders() })
        if (!res.ok) return
        const rows = await res.json()
        const list = Array.isArray(rows) ? rows : []
        const opts = [{ id: 'default', name: 'default' }].concat(
          list
            // só profiles com home inicializado (state.db) conseguem abrir sessão
            .filter((r: { chat_ready?: boolean }) => r.chat_ready !== false)
            .map((r: { id?: string; name?: string }) => ({
              id: String(r.id || r.name || ''),
              name: String(r.name || r.id || ''),
            })),
        ).filter((o) => o.id)
        setProfiles(opts)
      } catch {
        /* dropdown degrada para o texto */
      }
    })()
  }, [user?.role])

  // Profile selecionado pode morrer (delete na tela de Profiles). Normaliza para
  // um que exista: o <select> mostra a 1ª opção quando o value não casa, mas o
  // estado continuaria apontando para o morto.
  useEffect(() => {
    if (user?.role !== 'admin' || profiles.length === 0) return
    const ids = new Set(profiles.map((p) => p.id))
    if (active?.profile && ids.has(active.profile)) {
      if (selectedProfile !== active.profile) setSelectedProfile(active.profile)
      return
    }
    if (!ids.has(selectedProfile)) {
      setSelectedProfile(ids.has('default') ? 'default' : profiles[0].id)
    }
  }, [profiles, active?.profile, selectedProfile, user?.role])

  useEffect(() => {
    void loadSessions().then((rows) => {
      if (rows.length > 0) {
        setActiveId(rows[0].id)
        activeIdRef.current = rows[0].id
        if (user?.role === 'admin') setSelectedProfile(rows[0].profile || 'default')
        void loadMessages(rows[0].id)
      }
    })
  }, [loadSessions, loadMessages])

  function selectSession(id: string) {
    setSidebarOpen(false)
    if (id === activeIdRef.current) return
    abortRef.current?.abort()
    setActiveId(id)
    activeIdRef.current = id
    const target = sessions.find((x) => x.id === id)
    if (user?.role === 'admin' && target) setSelectedProfile(target.profile)
    setMessages([])
    setStreamText('')
    setThinking('')
    setLiveTools([])
    setLiveAttachments([])
    setApprovalCards([])
    void loadMessages(id)
  }

  async function resetTurn() {
    abortRef.current?.abort()
    abortRef.current = null
    if (activeId) await resetChannelTurn(activeId, turnIdRef.current, true)
    turnIdRef.current = null
    setSending(false)
    setStreamText('')
    setThinking('')
    setLiveTools([])
    setLiveAttachments([])
    setApprovalCards([])
  }

  async function createChat(profileOverride?: string): Promise<ChatSession> {
    const body: Record<string, unknown> = {}
    if (user?.role === 'admin') {
      // fonte única: o que o dropdown mostra é o profile da sessão ativa
      const wanted = profileOverride || active?.profile || selectedProfile || 'default'
      // lista carregada e o profile não está nela (deletado) -> não manda fantasma
      const exists = profiles.length === 0 || profiles.some((p) => p.id === wanted)
      body.profile = exists ? wanted : 'default'
    }
    const res = await fetch('/api/chat/sessions', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await apiErrorMessage(res))
    const row: ChatSession = await res.json()
    setSessions((prev) => [row, ...prev])
    setActiveId(row.id)
    activeIdRef.current = row.id
    setMessages([])
    setStreamText('')
    setSidebarOpen(false)
    return row
  }

  async function newChat() {
    setError(null)
    try {
      await createChat()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** Admin troca de profile: começa uma conversa nova com ele (a sessão atual mantém o seu). */
  async function switchProfile(profile: string) {
    if (!profile || profile === active?.profile) return
    setError(null)
    setSelectedProfile(profile)
    try {
      await createChat(profile)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function resetChannelTurn(id: string, turnId: string | null, force = false): Promise<boolean> {
    if (!turnId) return false
    try {
      const res = await fetch('/api/chat/sessions/' + id + '/reset-channel', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ turn_id: turnId, force }),
      })
      if (!res.ok) return false
      const data = await res.json().catch(() => ({}))
      return data.status === 'reset'
    } catch {
      return false
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    const attached = pendingAttachments
    if ((!trimmed && attached.length === 0) || sending) return
    if (uploadingRef.current > 0) {
      setError((prev) => (prev && prev.includes('Aguarde o upload')
        ? prev
        : (prev ? `${prev} Aguarde o upload do anexo terminar antes de enviar.` : 'Aguarde o upload do anexo terminar antes de enviar.')))
      return
    }
    setInput('')
    setPendingAttachments([])
    setError(null)
    setSending(true)
    setStreamText('')
    setThinking('')
    setLiveTools([])
    setLiveAttachments([])
    setApprovalCards([])

    try {
      let id = activeIdRef.current
      if (!id) {
        const row = await createChat()
        id = row.id
      }
      setMessages((prev) => [...prev, { role: 'user', content: trimmed || attached.map((a) => a.name).join(', ') }])
      const controller = new AbortController()
      abortRef.current = controller
      await streamTurn(
        id,
        trimmed,
        (event, payload) => {
          if (event === 'turn.started' && typeof payload.turn_id === 'string') {
            turnIdRef.current = payload.turn_id
          } else if (event === 'assistant.delta' && typeof payload.delta === 'string') {
            setStreamText((prev) => prev + (payload.delta as string))
          } else if (event === 'assistant.attachment') {
            setLiveAttachments((prev) => [...prev, payload as unknown as ChatAttachment])
          } else if (event === 'approval.card') {
            setApprovalCards((prev) => [
              ...prev.filter((c) => c.prompt_id !== String(payload.prompt_id)),
              payload as unknown as ApprovalCard,
            ])
          } else if (event === 'approval.result') {
            setApprovalCards((prev) => prev.filter((c) => c.prompt_id !== String(payload.prompt_id)))
          } else if (event === 'error') {
            setError(String(payload.message || payload.code || 'Erro no canal'))
            if (payload.code === 'timeout' && turnIdRef.current) {
              void resetChannelTurn(id, turnIdRef.current)
            }
          } else if (event === 'tool.progress' && payload.tool_name === '_thinking') {
            setThinking((prev) => prev + String(payload.delta || ''))
          } else if (event === 'tool.started') {
            const name = String(payload.tool_name || 'tool')
            setLiveTools((prev) => [
              ...prev,
              { name, status: 'running', preview: typeof payload.preview === 'string' ? payload.preview : '' },
            ])
          } else if (event === 'tool.completed' || event === 'tool.failed') {
            const name = String(payload.tool_name || 'tool')
            const status: LiveTool['status'] = event === 'tool.failed' ? 'failed' : 'done'
            setLiveTools((prev) => {
              const next = [...prev]
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].name === name && next[i].status === 'running') {
                  next[i] = {
                    ...next[i],
                    status,
                    preview: typeof payload.preview === 'string' ? payload.preview : next[i].preview,
                  }
                  return next
                }
              }
              next.push({ name, status, preview: typeof payload.preview === 'string' ? payload.preview : '' })
              return next
            })
          }
        },
        controller.signal,
        attached,
      )
      await loadMessages(id)
      setStreamText('')
      setThinking('')
      setLiveTools([])
      setLiveAttachments([])
      setApprovalCards([])
      await loadSessions()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const message = (err as Error).message
        setError(message)
        const id = activeIdRef.current
        if (id && message.includes('Turno') && turnIdRef.current) {
          const recovered = await resetChannelTurn(id, turnIdRef.current)
          if (recovered) {
            setError('Turno anterior liberado. Envie a mensagem novamente.')
          }
        }
        // não limpar o erro no reload: o 409 de turno concorrente tem que ficar visível
        if (id) await loadMessages(id, false)
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  async function archiveSession(id: string) {
    try {
      const res = await fetch('/api/chat/sessions/' + id, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      const remaining = sessions.filter((s) => s.id !== id)
      setSessions(remaining)
      if (activeIdRef.current === id) {
        const next = remaining[0] || null
        setActiveId(next ? next.id : null)
        activeIdRef.current = next ? next.id : null
        setMessages([])
        if (next) void loadMessages(next.id)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function commitRename(id: string) {
    const title = renameValue.trim()
    setRenamingId(null)
    if (!title) return
    try {
      const res = await fetch('/api/chat/sessions/' + id, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      const row: ChatSession = await res.json()
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: row.title } : s)))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg')
          ? 'audio/ogg'
          : ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
        if (blob.size < 1000) {
          setError('Nothing captured — try speaking closer to the microphone.')
          return
        }
        await transcribe(blob)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch {
      setError('Microphone unavailable (needs permission and HTTPS/localhost).')
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  async function transcribe(blob: Blob) {
    try {
      const fd = new FormData()
      fd.append('file', blob, 'recording.webm')
      fd.append('language', 'pt')
      const res = await fetch('/api/voice', { method: 'POST', headers: authHeaders(), body: fd })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      const data = await res.json()
      const text: string = data.text ?? ''
      if (text) setInput((prev) => (prev ? prev + ' ' + text : text))
      else setError('Could not understand the audio — try again.')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function uploadFiles(
    files: FileList | File[] | null,
    opts: { preserveError?: boolean } = {},
  ) {
    if (!files || files.length === 0) return
    const room = Math.max(0, 10 - pendingAttachmentsRef.current.length - reservedSlotsRef.current)
    const limitError = 'Limite de 10 anexos por mensagem.'
    const reportLimit = () => setError((prev) => (opts.preserveError && prev ? `${prev} ${limitError}` : limitError))
    if (room === 0) {
      reportLimit()
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    const selected = Array.from(files).slice(0, room)
    if (Array.from(files).length > room) reportLimit()
    else if (!opts.preserveError) setError(null)
    reservedSlotsRef.current += selected.length
    uploadingRef.current += 1
    setUploadingCount((n) => n + 1)
    try {
      const added: PendingAttachment[] = []
      for (const file of selected) {
        try {
          const fd = new FormData()
          fd.append('file', file, file.name)
          const res = await fetch('/api/chat/uploads', {
            method: 'POST', headers: authHeaders(), body: fd,
          })
          if (!res.ok) {
            setError(await apiErrorMessage(res))
            continue
          }
          added.push(await res.json() as PendingAttachment)
        } catch (err) {
          setError((err as Error).message)
        }
      }
      if (added.length) {
        setPendingAttachments((prev) => {
          const next = [...prev, ...added].slice(0, 10)
          pendingAttachmentsRef.current = next
          return next
        })
      }
    } finally {
      reservedSlotsRef.current = Math.max(0, reservedSlotsRef.current - selected.length)
      uploadingRef.current -= 1
      setUploadingCount((n) => Math.max(0, n - 1))
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /** Clipboard images arrive as File objects without a useful upload name. */
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files: File[] = []
    let skippedType = false
    const el = e.currentTarget
    const selectionStart = el.selectionStart
    const selectionEnd = el.selectionEnd
    for (const item of Array.from(e.clipboardData?.items || [])) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      const nameExt = (file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1] || '').toLowerCase()
      if (nameExt && UPLOAD_EXTS.has(nameExt)) {
        files.push(file)
        continue
      }
      const extByMime: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/bmp': 'bmp',
        'image/svg+xml': 'svg',
        'application/pdf': 'pdf',
        'text/plain': 'txt',
        'text/markdown': 'md',
        'text/csv': 'csv',
        'application/json': 'json',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/rtf': 'rtf',
        'application/vnd.oasis.opendocument.text': 'odt',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/mp4': 'm4a',
        'video/webm': 'webm',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
      }
      const ext = extByMime[file.type]
      if (!ext) {
        skippedType = true
        setError(`Tipo de anexo não suportado: ${file.type || 'desconhecido'}`)
        continue
      }
      files.push(new File(
        [file],
        `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}-${files.length + 1}.${ext}`,
        { type: file.type, lastModified: Date.now() },
      ))
    }
    if (files.length === 0) return
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain') || ''
    if (text) {
      const base = el.value
      const next = base.slice(0, selectionStart) + text + base.slice(selectionEnd)
      setInput(next)
      const caret = selectionStart + text.length
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(caret, caret)
      })
    }
    void uploadFiles(files, { preserveError: skippedType })
  }

  async function answerApproval(card: ApprovalCard, option: ApprovalOption) {
    const id = activeIdRef.current
    if (!id) return
    setApprovalCards((prev) => prev.filter((c) => c.prompt_id !== card.prompt_id))
    try {
      const res = await fetch('/api/chat/approvals', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({
          session_id: id, prompt_id: card.prompt_id, option_id: option.id,
        }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => s.title.toLowerCase().includes(q))
  }, [sessions, search])

  const groups = useMemo(() => {
    const out: { label: string; items: ChatSession[] }[] = []
    for (const s of filtered) {
      const label = dayBucket(s.updated_at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(s)
      else out.push({ label, items: [s] })
    }
    return out
  }, [filtered])

  const items = useMemo(() => buildItems(messages), [messages])

  const sidebar = (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-bg-elevated">
      <div className="space-y-2 border-b border-border p-3">
        <button
          onClick={() => void newChat()}
          className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          + New chat
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats"
          className="w-full rounded-lg border border-border bg-bg-base px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loadingSessions && <p className="px-2 py-3 text-xs text-text-tertiary">Loading…</p>}
        {!loadingSessions && filtered.length === 0 && (
          <p className="px-2 py-3 text-xs text-text-tertiary">No conversations yet.</p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-tertiary">{g.label}</p>
            {g.items.map((s) => (
              <div
                key={s.id}
                className={
                  'group mb-0.5 flex items-center gap-1 rounded-lg border-l-2 px-2 py-1.5 ' +
                  (s.id === activeId
                    ? 'border-accent bg-bg-base text-text-primary'
                    : 'border-transparent text-text-secondary hover:bg-bg-base')
                }
              >
                {renamingId === s.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(s.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="min-w-0 flex-1 rounded border border-border bg-bg-base px-1.5 py-1 text-xs"
                  />
                ) : (
                  <button
                    onClick={() => selectSession(s.id)}
                    className="min-w-0 flex-1 truncate text-left text-sm"
                    title={s.title}
                  >
                    {s.title}
                  </button>
                )}
                <button
                  onClick={() => {
                    setRenamingId(s.id)
                    setRenameValue(s.title)
                  }}
                  className="hidden shrink-0 rounded p-1 text-text-tertiary hover:text-text-primary group-hover:block"
                  title="Rename"
                  aria-label={'Rename ' + s.title}
                >
                  ✎
                </button>
                <button
                  onClick={() => void archiveSession(s.id)}
                  className="hidden shrink-0 rounded p-1 text-text-tertiary hover:text-red-400 group-hover:block"
                  title="Archive"
                  aria-label={'Archive ' + s.title}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-border px-3 py-2 text-[11px] text-text-tertiary">
        {user?.username} · {active?.profile || '—'}
      </div>
    </aside>
  )

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-bg-base"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <NavBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="hidden lg:flex">{sidebar}</div>

        {sidebarOpen && (
          <div className="absolute inset-0 z-40 flex lg:hidden">
            <div className="h-full">{sidebar}</div>
            <button
              className="flex-1 bg-black/40"
              aria-label="Close chats"
              onClick={() => setSidebarOpen(false)}
            />
          </div>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <button
              className="rounded-lg border border-border px-2 py-1 text-sm lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open chats"
            >
              ☰
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary">{active?.title || 'Chat'}</p>
              <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                {user?.role === 'admin' ? (
                  <select
                    value={active?.profile || selectedProfile}
                    onChange={(e) => void switchProfile(e.target.value)}
                    disabled={sending}
                    title="Profile for new chats"
                    aria-label="Profile for new chats"
                    className="max-w-[180px] rounded border border-border bg-bg-base px-1.5 py-0.5 text-[11px] text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {(profiles.length
                      ? profiles
                      : [{ id: active?.profile || selectedProfile, name: active?.profile || selectedProfile }]
                    ).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : active?.profile ? (
                  <span className="truncate">· {active.profile}</span>
                ) : null}
              </div>
            </div>
          </header>

          {error && (
            <div className="mx-4 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {!active && !loadingSessions && (
                <div className="py-16 text-center">
                  <p className="text-sm text-text-secondary">No conversation selected.</p>
                  <button
                    onClick={() => void newChat()}
                    className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
                  >
                    Start a chat
                  </button>
                </div>
              )}
              {loadingMessages && <p className="text-center text-xs text-text-tertiary">Loading messages…</p>}
              {items.map((item, i) => {
                if (item.role === 'user') {
                  return (
                    <div key={i} className="flex flex-col items-end gap-1">
                      <div className="w-full max-w-[80%] rounded-2xl rounded-br-sm bg-accent-subtle px-4 py-2.5 text-sm leading-relaxed text-accent">
                        <span className="whitespace-pre-wrap">{item.content}</span>
                        {item.attachments.map((a, k) => (
                          <div key={k} className="mt-2"><AttachmentCard item={a} /></div>
                        ))}
                      </div>
                      {fmtTs(item.ts) && (
                        <span className="mt-1 text-caption text-text-tertiary">{fmtTs(item.ts)}</span>
                      )}
                    </div>
                  )
                }
                return (
                  <div key={i} className="flex w-full flex-col items-start gap-2">
                    {fmtTs(item.ts) && (
                      <span className="text-caption text-text-tertiary">{fmtTs(item.ts)}</span>
                    )}
                    {item.reasoning && <ThinkingBlock text={item.reasoning} />}
                    {item.error && (
                      <div className="w-full max-w-[80%] rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        ⚠️ {item.error}
                      </div>
                    )}
                    {item.tools.length > 0 && (
                      <ToolGroup tools={item.tools} />
                    )}
                    {item.content && (
                      <div className="w-full max-w-[80%] rounded-2xl rounded-bl-sm bg-surface/60 px-4 py-2.5 text-sm leading-relaxed text-text-primary">
                        <div className="prose-invert max-w-full">
                          <MarkdownRenderer content={item.content} />
                        </div>
                        {item.attachments.map((a, k) => (
                          <div key={k} className="mt-2"><AttachmentCard item={a} /></div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {sending && (
                <div className="flex w-full flex-col items-start gap-2">
                  <span className="text-caption text-text-tertiary">{fmtTs(Date.now() / 1000)}</span>
                  {thinking && <ThinkingBlock text={thinking} />}
                  {liveTools.length > 0 && <ToolGroup tools={liveTools} />}
                  {liveAttachments.map((a, k) => (
                    <AttachmentCard key={k} item={a} />
                  ))}
                  {approvalCards.map((card) => (
                    <div key={card.prompt_id} className="w-full max-w-[80%] rounded-xl border border-accent/40 bg-accent-subtle/30 p-3">
                      <p className="mb-2 text-xs text-text-primary whitespace-pre-wrap">{card.text}</p>
                      <div className="flex flex-wrap gap-2">
                        {card.options.map((opt) => (
                          <button key={opt.id} onClick={() => void answerApproval(card, opt)}
                            className={'rounded-lg px-3 py-1.5 text-xs font-medium ' +
                              (opt.style === 'danger'
                                ? 'border border-red-500/40 text-red-300 hover:bg-red-500/10'
                                : 'bg-accent text-white hover:opacity-90')}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {streamText ? (
                    <div className="w-full max-w-[80%] rounded-2xl rounded-bl-sm bg-surface/60 px-4 py-2.5 text-sm leading-relaxed text-text-primary">
                      <div className="prose-invert max-w-full">
                        <MarkdownRenderer content={streamText} />
                        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-accent align-middle" />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div
            className="border-t border-border p-3"
            style={{
              paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
            }}
          >
            {(pendingAttachments.length > 0 || uploadingCount > 0) && (
              <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-1.5">
                {pendingAttachments.map((a) => (
                  <span key={a.path} className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text-secondary">
                    {a.name}
                    <button onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                      className="text-text-tertiary hover:text-red-400" aria-label={'Remove ' + a.name}>×</button>
                  </span>
                ))}
                {uploadingCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-text-tertiary">
                    Enviando anexo…
                  </span>
                )}
              </div>
            )}
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <input ref={fileInputRef} type="file" multiple className="hidden"
                onChange={(e) => void uploadFiles(e.target.files)} />
              <button onClick={() => fileInputRef.current?.click()} disabled={sending || !active}
                className="h-[42px] shrink-0 rounded-xl border border-border px-3 text-sm text-text-secondary hover:text-text-primary disabled:opacity-40"
                title="Attach files" aria-label="Attach files">📎</button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={1}
                placeholder={active ? 'Message… (Enter sends, Shift+Enter breaks line)' : 'Start a new chat to write'}
                disabled={!active && sessions.length > 0}
                className="max-h-40 min-h-[42px] flex-1 resize-y rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!recording) void startRecording()
                }}
                onMouseUp={() => {
                  if (recording) stopRecording()
                }}
                onMouseLeave={() => {
                  if (recording) stopRecording()
                }}
                onTouchStart={(e) => {
                  e.preventDefault()
                  if (!recording) void startRecording()
                }}
                onTouchEnd={() => {
                  if (recording) stopRecording()
                }}
                disabled={sending}
                className={
                  'h-[42px] shrink-0 rounded-xl border px-3 text-sm ' +
                  (recording
                    ? 'animate-pulse border-red-500 bg-red-500/20 text-red-300'
                    : 'border-border text-text-secondary hover:text-text-primary')
                }
                title="Hold to talk"
                aria-label="Hold to talk"
              >
                🎙
              </button>
              {sending ? (
                <button
                  onClick={() => void resetTurn()}
                  className="h-[42px] shrink-0 rounded-xl border border-red-500/50 px-4 text-sm font-medium text-red-300 hover:bg-red-500/10"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => void sendMessage(input)}
                  disabled={uploadingCount > 0 || (!input.trim() && pendingAttachments.length === 0)}
                  className="h-[42px] shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-white disabled:opacity-40"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
