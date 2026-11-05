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

interface ChatMsg {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp?: string | number
  tool_name?: string | null
  reasoning_content?: string | null
  tool_calls?: ToolCall[] | null
  display_kind?: string | null
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
): Promise<void> {
  const res = await fetch('/api/chat/sessions/' + sessionId + '/stream', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ message: text }),
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

export default function ChatPage() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
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
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string>('default')

  const bottomRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef<string | null>(null)

  const active = useMemo(() => sessions.find((s) => s.id === activeId) || null, [sessions, activeId])

  const scrollDown = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

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

  const loadMessages = useCallback(async (id: string) => {
    setLoadingMessages(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/sessions/' + id + '/messages?limit=200', { headers: authHeaders() })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      const body = await res.json()
      setMessages(body.data || [])
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
          list.map((r: { id?: string; name?: string }) => ({ id: String(r.id || r.name || ''), name: String(r.name || r.id || '') })),
        ).filter((o) => o.id)
        setProfiles(opts)
      } catch {
        /* dropdown degrada para o texto */
      }
    })()
  }, [user?.role])

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
    setMessages([])
    setStreamText('')
    setThinking('')
    setLiveTools([])
    void loadMessages(id)
  }

  async function createChat(profileOverride?: string): Promise<ChatSession> {
    const body: Record<string, unknown> = {}
    if (user?.role === 'admin') body.profile = profileOverride || selectedProfile || 'default'
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

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setInput('')
    setError(null)
    setSending(true)
    setStreamText('')
    setThinking('')
    setLiveTools([])

    try {
      let id = activeIdRef.current
      if (!id) {
        const row = await createChat()
        id = row.id
      }
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
      const controller = new AbortController()
      abortRef.current = controller
      await streamTurn(
        id,
        trimmed,
        (event, payload) => {
          if (event === 'assistant.delta' && typeof payload.delta === 'string') {
            setStreamText((prev) => prev + (payload.delta as string))
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
      )
      await loadMessages(id)
      setStreamText('')
      setThinking('')
      setLiveTools([])
      await loadSessions()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message)
        const id = activeIdRef.current
        if (id) await loadMessages(id)
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
                  'group mb-0.5 flex items-center gap-1 rounded-lg px-2 py-1.5 ' +
                  (s.id === activeId ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-bg-base')
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
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <div className="flex h-[calc(100vh-64px)]">
        <div className="hidden md:flex">{sidebar}</div>

        {sidebarOpen && (
          <div className="fixed inset-x-0 bottom-0 top-16 z-40 flex md:hidden">
            <div className="h-full">{sidebar}</div>
            <button
              className="flex-1 bg-black/40"
              aria-label="Close chats"
              onClick={() => setSidebarOpen(false)}
            />
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <button
              className="rounded-lg border border-border px-2 py-1 text-sm md:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open chats"
            >
              ☰
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary">{active?.title || 'Chat'}</p>
              <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                <span className="truncate">{user?.username || 'user'}</span>
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
              {messages.map((m, i) => {
                if (m.role === 'tool' || m.role === 'system') {
                  return (
                    <details
                      key={i}
                      className="rounded-lg border border-border bg-bg-elevated/40 px-3 py-2 text-xs text-text-tertiary"
                    >
                      <summary className="cursor-pointer">{m.tool_name || m.role}</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words">{m.content.slice(0, 4000)}</pre>
                    </details>
                  )
                }
                const mine = m.role === 'user'
                return (
                  <div key={i} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}>
                    <div
                      className={
                        'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ' +
                        (mine
                          ? 'rounded-br-sm bg-accent text-white'
                          : 'rounded-bl-sm border border-border bg-bg-elevated text-text-primary')
                      }
                    >
                      {mine ? (
                        <span className="whitespace-pre-wrap">{m.content}</span>
                      ) : (
                        <>
                          {m.reasoning_content && (
                            <details className="mb-2 rounded-lg border border-border/60 px-2 py-1 text-xs text-text-tertiary">
                              <summary className="cursor-pointer">Thinking</summary>
                              <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                                {m.reasoning_content}
                              </pre>
                            </details>
                          )}
                          {m.tool_calls && m.tool_calls.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1">
                              {m.tool_calls.map((tc, k) => (
                                <details
                                  key={k}
                                  className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-text-tertiary"
                                >
                                  <summary className="cursor-pointer">🔧 {toolCallName(tc)}</summary>
                                  <pre className="mt-1 max-h-40 max-w-[420px] overflow-auto whitespace-pre-wrap break-words">
                                    {toolCallArgs(tc)}
                                  </pre>
                                </details>
                              ))}
                            </div>
                          )}
                          <div className="prose-invert max-w-full">
                            <MarkdownRenderer content={m.content || '…'} />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
              {sending && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-bg-elevated px-4 py-2.5 text-sm text-text-primary">
                    {thinking && (
                      <details open className="mb-2 rounded-lg border border-border/60 px-2 py-1 text-xs text-text-tertiary">
                        <summary className="cursor-pointer">Thinking…</summary>
                        <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words">{thinking}</pre>
                      </details>
                    )}
                    {liveTools.length > 0 && (
                      <div className="mb-2 flex flex-col gap-1">
                        {liveTools.map((t, k) => (
                          <div
                            key={k}
                            className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-text-tertiary"
                          >
                            <span>{t.status === 'running' ? '⏳' : t.status === 'failed' ? '⚠️' : '✓'}</span>
                            <span className="font-medium">{t.name}</span>
                            {t.preview && <span className="truncate opacity-70">{t.preview}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {streamText ? (
                      <div className="prose-invert max-w-full">
                        <MarkdownRenderer content={streamText} />
                        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-accent align-middle" />
                      </div>
                    ) : (
                      <span className="text-text-tertiary">
                        {thinking || liveTools.length ? 'Working…' : 'Thinking…'}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="border-t border-border p-3">
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
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
              <button
                onClick={() => void sendMessage(input)}
                disabled={sending || !input.trim()}
                className="h-[42px] shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
