import { isAdmin } from "../lib/admin"
import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { NavBar } from '../App'

/* ── Types ──────────────────────────────────────────────────────── */

interface ProfileSummary {
  id: string
  name: string
  model: string
  provider: string
  toolsets_count: number
  fallback_providers: string[]
  error?: string
}

interface AgentConfig {
  max_turns: number | null  // gateway default is None (unlimited)
  gateway_timeout: number
  restart_drain_timeout: number
  api_max_retries: number
  tool_use_enforcement: string
  task_completion_guidance: boolean
  parallel_tool_call_guidance: boolean
  verify_on_stop: boolean
  clarify_timeout: number
}

interface ProfileDetail {
  id: string
  model: { default: string; provider: string; base_url: string; api_mode?: string }
  fallback_providers: string[]
  toolsets: string[]
  agent: AgentConfig
  description: string
}

/* ── API helper ─────────────────────────────────────────────────── */

const API = (import.meta as any).env?.VITE_API_URL || ''

async function apiFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem('agentos_token') || localStorage.getItem('agentos_access_token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API}${path}`, { ...opts, headers })
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const j = await res.json()
      if (j && j.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      try {
        const t = await res.text()
        if (t) msg = t.slice(0, 300)
      } catch { /* keep generic */ }
    }
    throw new Error(msg)
  }
  return res.json()
}

/* ── Constants ──────────────────────────────────────────────────── */

const PROVIDERS = ['xiaomi', 'ollama-cloud', 'openai', 'anthropic', 'google', 'nvidia', 'nous', 'bedrock', 'openrouter']
const TOOL_USE_ENFORCEMENT = ['auto', 'enforce', 'suggest']
const KNOWN_TOOLSETS = [
  'hermes-cli', 'web', 'terminal', 'file', 'code_exec', 'delegation',
  'mcp-playright', 'mcp-homeassistant', 'mcp-rss-reader',
  'browser', 'vision', 'image_gen', 'video_gen', 'tts', 'stt',
  'memory', 'kanban', 'skills', 'todo', 'x_search',
]

type TabKey = 'model' | 'agent' | 'toolsets' | 'description' | 'memory' | 'preview'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'model', label: 'Model' },
  { key: 'agent', label: 'Agent' },
  { key: 'toolsets', label: 'Toolsets' },
  { key: 'description', label: 'Description' },
  { key: 'memory', label: 'Memory' },
  { key: 'preview', label: 'Preview' },
]

/* ── Reusable components ────────────────────────────────────────── */

const inputClass = 'w-full px-3 py-2 bg-bg-base border border-border rounded-md text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 transition-all'
const selectClass = inputClass
const textareaClass = inputClass + ' min-h-[120px] resize-y font-mono text-xs leading-relaxed'

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-caption text-text-tertiary uppercase tracking-wider mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-error mt-1">{error}</p>}
    </div>
  )
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
        active
          ? 'bg-accent/15 border-accent/40 text-accent'
          : 'bg-bg-base border-border text-text-tertiary hover:text-text-secondary hover:border-border/80'
      }`}
    >
      {active && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {label}
    </button>
  )
}

function TabBar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <div className="flex border-b border-border -mx-6 px-6 gap-1 overflow-x-auto">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
            active === t.key
              ? 'text-accent'
              : 'text-text-tertiary hover:text-text-primary'
          }`}
        >
          {t.label}
          {active === t.key && (
            <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-full" />
          )}
        </button>
      ))}
    </div>
  )
}

/* ── Validation ─────────────────────────────────────────────────── */

function validate(form: EditForm, isCreate: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  if (isCreate) {
    if (!form.id) errors.id = 'Required'
    else if (!/^[a-z0-9-]+$/.test(form.id)) errors.id = 'Lowercase letters, numbers, hyphens only'
  }
  if (!form.model) errors.model = 'Model name is required'
  if (form.max_turns < 0) errors.max_turns = 'Must be >= 0 (0 = unlimited)'
  if (form.gateway_timeout < 1) errors.gateway_timeout = 'Must be > 0'
  return errors
}

/* ── Form shape ─────────────────────────────────────────────────── */

interface EditForm {
  id: string
  model: string
  provider: string
  base_url: string
  fallback_providers: string
  toolsets: string[]
  max_turns: number
  gateway_timeout: number
  restart_drain_timeout: number
  api_max_retries: number
  tool_use_enforcement: string
  task_completion_guidance: boolean
  parallel_tool_call_guidance: boolean
  verify_on_stop: boolean
  clarify_timeout: number
  description: string
}

function defaultForm(): EditForm {
  return {
    id: '',
    model: '',
    provider: 'xiaomi',
    base_url: '',
    fallback_providers: '',
    toolsets: ['hermes-cli'],
    max_turns: 0,  // gateway default is None = unlimited; 0 is the form's equivalent
    gateway_timeout: 1800,
    restart_drain_timeout: 0,
    api_max_retries: 3,
    tool_use_enforcement: 'auto',
    task_completion_guidance: true,
    parallel_tool_call_guidance: true,
    verify_on_stop: false,
    clarify_timeout: 3600,
    description: '',
  }
}

function formFromDetail(d: ProfileDetail): EditForm {
  return {
    id: d.id,
    model: d.model.default || '',
    provider: d.model.provider || '',
    base_url: d.model.base_url || '',
    fallback_providers: (d.fallback_providers || []).join(', '),
    toolsets: d.toolsets || [],
    max_turns: d.agent.max_turns ?? 0,  // 0 = unlimited (gateway: None / <=0)
    gateway_timeout: d.agent.gateway_timeout ?? 1800,
    restart_drain_timeout: d.agent.restart_drain_timeout ?? 0,
    api_max_retries: d.agent.api_max_retries ?? 3,
    tool_use_enforcement: d.agent.tool_use_enforcement || 'auto',
    task_completion_guidance: d.agent.task_completion_guidance ?? true,
    parallel_tool_call_guidance: d.agent.parallel_tool_call_guidance ?? true,
    verify_on_stop: d.agent.verify_on_stop ?? false,
    clarify_timeout: d.agent.clarify_timeout ?? 3600,
    description: d.description || '',
  }
}

function buildPayload(form: EditForm) {
  return {
    model: { default: form.model, provider: form.provider, base_url: form.base_url },
    fallback_providers: form.fallback_providers.split(',').map((s) => s.trim()).filter(Boolean),
    toolsets: form.toolsets,
    agent: {
      max_turns: form.max_turns,
      gateway_timeout: form.gateway_timeout,
      restart_drain_timeout: form.restart_drain_timeout,
      api_max_retries: form.api_max_retries,
      tool_use_enforcement: form.tool_use_enforcement,
      task_completion_guidance: form.task_completion_guidance,
      parallel_tool_call_guidance: form.parallel_tool_call_guidance,
      verify_on_stop: form.verify_on_stop,
      clarify_timeout: form.clarify_timeout,
    },
    description: form.description,
  }
}

/* ── YAML preview helper ────────────────────────────────────────── */

function buildYamlPreview(form: EditForm): string {
  const payload = buildPayload(form)
  const lines: string[] = []
  lines.push(`model:`)
  lines.push(`  default: ${payload.model.default}`)
  lines.push(`  provider: ${payload.model.provider}`)
  lines.push(`  base_url: '${payload.model.base_url}'`)
  if (payload.fallback_providers.length) {
    lines.push(`fallback_providers:`)
    payload.fallback_providers.forEach(p => lines.push(`  - ${p}`))
  } else {
    lines.push(`fallback_providers: []`)
  }
  lines.push(`toolsets:`)
  payload.toolsets.forEach(t => lines.push(`  - ${t}`))
  lines.push(`agent:`)
  lines.push(`  max_turns: ${payload.agent.max_turns}`)
  lines.push(`  gateway_timeout: ${payload.agent.gateway_timeout}`)
  lines.push(`  restart_drain_timeout: ${payload.agent.restart_drain_timeout}`)
  lines.push(`  api_max_retries: ${payload.agent.api_max_retries}`)
  lines.push(`  tool_use_enforcement: ${payload.agent.tool_use_enforcement}`)
  lines.push(`  task_completion_guidance: ${payload.agent.task_completion_guidance}`)
  lines.push(`  parallel_tool_call_guidance: ${payload.agent.parallel_tool_call_guidance}`)
  lines.push(`  verify_on_stop: ${payload.agent.verify_on_stop}`)
  lines.push(`  clarify_timeout: ${payload.agent.clarify_timeout}`)
  if (payload.description) {
    lines.push(`description: >-`)
    lines.push(`  ${payload.description}`)
  }
  return lines.join('\n')
}

/* ── Tab content renderers ──────────────────────────────────────── */

function ModelTab({ form, setForm, errors, isCreate }: { form: EditForm; setForm: (f: EditForm) => void; errors: Record<string, string>; isCreate: boolean }) {
  const upd = (k: keyof EditForm, v: any) => setForm({ ...form, [k]: v })
  return (
    <div className="space-y-4">
      {isCreate && (
        <Field label="Profile ID" error={errors.id}>
          <input
            value={form.id}
            onChange={(e) => upd('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            className={inputClass + ' font-mono'}
            placeholder="e.g. researcher"
          />
        </Field>
      )}
      <Field label="Model" error={errors.model}>
        <input value={form.model} onChange={(e) => upd('model', e.target.value)} className={inputClass} placeholder="e.g. mimo-v2.5" />
      </Field>
      <Field label="Provider">
        <select value={form.provider} onChange={(e) => upd('provider', e.target.value)} className={selectClass}>
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="">(custom)</option>
        </select>
      </Field>
      <Field label="Base URL (optional)">
        <input value={form.base_url} onChange={(e) => upd('base_url', e.target.value)} className={inputClass} placeholder="https://api.example.com/v1" />
      </Field>
      <Field label="Fallback Providers (comma-separated)">
        <input value={form.fallback_providers} onChange={(e) => upd('fallback_providers', e.target.value)} className={inputClass} placeholder="ollama-cloud, openai" />
      </Field>
    </div>
  )
}

function AgentTab({ form, setForm, errors }: { form: EditForm; setForm: (f: EditForm) => void; errors: Record<string, string> }) {
  const upd = (k: keyof EditForm, v: any) => setForm({ ...form, [k]: v })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Max Turns" error={errors.max_turns}>
          <input type="number" value={form.max_turns} onChange={(e) => upd('max_turns', parseInt(e.target.value) || 0)} className={inputClass} />
        </Field>
        <Field label="Gateway Timeout (s)" error={errors.gateway_timeout}>
          <input type="number" value={form.gateway_timeout} onChange={(e) => upd('gateway_timeout', parseInt(e.target.value) || 0)} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Restart Drain Timeout (s)">
          <input type="number" value={form.restart_drain_timeout} onChange={(e) => upd('restart_drain_timeout', parseInt(e.target.value) || 0)} className={inputClass} />
        </Field>
        <Field label="API Max Retries">
          <input type="number" value={form.api_max_retries} onChange={(e) => upd('api_max_retries', parseInt(e.target.value) || 0)} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tool Use Enforcement">
          <select value={form.tool_use_enforcement} onChange={(e) => upd('tool_use_enforcement', e.target.value)} className={selectClass}>
            {TOOL_USE_ENFORCEMENT.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Clarify Timeout (s)">
          <input type="number" value={form.clarify_timeout} onChange={(e) => upd('clarify_timeout', parseInt(e.target.value) || 0)} className={inputClass} />
        </Field>
      </div>
      <div className="space-y-3 pt-2">
        {([
          ['task_completion_guidance', 'Task Completion Guidance'],
          ['parallel_tool_call_guidance', 'Parallel Tool Call Guidance'],
          ['verify_on_stop', 'Verify on Stop'],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex items-center gap-3 cursor-pointer group">
            <div
              className={`w-9 h-5 rounded-full transition-colors relative ${form[key] ? 'bg-accent' : 'bg-border'}`}
              onClick={() => upd(key, !form[key])}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form[key] ? 'translate-x-4' : 'translate-x-0.5'}`}
              />
            </div>
            <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">{label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function ToolsetsTab({ form, setForm }: { form: EditForm; setForm: (f: EditForm) => void }) {
  const toggle = (ts: string) => {
    setForm({
      ...form,
      toolsets: form.toolsets.includes(ts)
        ? form.toolsets.filter((t) => t !== ts)
        : [...form.toolsets, ts],
    })
  }
  return (
    <div>
      <p className="text-xs text-text-tertiary mb-3">Click to toggle toolsets for this profile.</p>
      <div className="flex flex-wrap gap-2">
        {KNOWN_TOOLSETS.map((ts) => (
          <ToggleChip key={ts} label={ts} active={form.toolsets.includes(ts)} onClick={() => toggle(ts)} />
        ))}
      </div>
      {form.toolsets.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-xs text-text-tertiary mb-1">Active ({form.toolsets.length}):</p>
          <p className="text-xs text-text-primary font-mono">{form.toolsets.join(', ')}</p>
        </div>
      )}
    </div>
  )
}

function DescriptionTab({ form, setForm }: { form: EditForm; setForm: (f: EditForm) => void }) {
  return (
    <div>
      <p className="text-xs text-text-tertiary mb-3">Notes about this profile's purpose and configuration.</p>
      <textarea
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className={textareaClass}
        rows={8}
        placeholder="Describe what this profile is for..."
      />
    </div>
  )
}

function MemoryTab({ profileId, visible, onDirtyChange, registerSave }: {
  profileId: string
  visible?: boolean
  onDirtyChange?: (dirty: boolean) => void
  registerSave?: (fn: () => Promise<boolean>) => void
}) {
  const [content, setContent] = useState<string>('')
  const [initial, setInitial] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // a failed load must never look like an empty file — the user would "save" a
  // fragment over the real SOUL.md (adversarial finding H3)
  const [loadError, setLoadError] = useState<string | null>(null)
  const savedTimer = useRef<number | null>(null)
  // N-1: refs mirror the live buffer so a fetch that resolves LATE can refuse
  // to clobber content typed (or saved) while the request was in flight.
  const contentRef = useRef(content)
  contentRef.current = content
  const initialRef = useRef(initial)
  initialRef.current = initial
  const genRef = useRef(0)

  const load = () => {
    setLoading(true)
    setLoadError(null)
    const gen = genRef.current
    apiFetch(`/api/profiles/${profileId}/soul`)
      .then((d) => {
        // dirty-since-fetch-start OR saved-since-fetch-start → keep the buffer
        if (gen !== genRef.current || contentRef.current !== initialRef.current) return
        setContent(d.content || ''); setInitial(d.content || ''); loadedOnce.current = true
      })
      .catch((e: any) => {
        // keep content/initial untouched — only mark the editor unusable
        setLoadError(String(e?.message || e))
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [profileId])
  useEffect(() => () => { if (savedTimer.current) window.clearTimeout(savedTimer.current) }, [])

  const dirty = content !== initial
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty])

  // M-2b: keep-mounted must not shadow external SOUL.md edits — refetch when
  // the tab becomes visible again, but ONLY over a clean buffer (never discard
  // what the user typed).
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const loadedOnce = useRef(false)
  useEffect(() => {
    if (visible && loadedOnce.current && !dirtyRef.current && !loadError) load()
  }, [visible])

  // returns success — the dialog's main Save aborts when this fails (finding H2)
  // N-8 (E11): synchronous re-entrancy guard — `saving` state lags a render, so
  // two triggers in the same window (dialog Save + tab Save) could start two
  // PUTs whose out-of-order landing leaves the FILE older than the buffer.
  const savingRef = useRef(false)
  const handleSave = async (): Promise<boolean> => {
    if (savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    try {
      await apiFetch(`/api/profiles/${profileId}/soul`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      })
      genRef.current += 1 // any save invalidates in-flight fetches (N-1)
      setInitial(content) // clears the dirty flag — dialog close won't warn
      setSaved(true)
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setSaved(false), 2000)
      return true
    } catch (e: any) {
      // never swallow a failed save — silent loss of typed content was the bug
      alert(`Failed to save SOUL.md: ${e?.message || e}`)
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // let the dialog's main Save button save the soul too (keeps its closure fresh)
  useEffect(() => { registerSave?.(handleSave) })

  if (loading) {
    return <div className="text-text-tertiary text-sm py-8 text-center">Loading SOUL.md…</div>
  }

  return (
    <div>
      {loadError && (
        <div className="mb-3 p-3 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
          <div className="font-medium mb-1">Failed to load SOUL.md — editing disabled to protect the file.</div>
          <div className="mb-2 font-mono">{loadError}</div>
          <button onClick={load} className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:opacity-90">Retry</button>
        </div>
      )}
      <div style={{ display: loadError ? 'none' : 'block' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-text-tertiary">
          Agent personality / system prompt stored in <span className="font-mono text-text-secondary">SOUL.md</span>
          {dirty && <span className="ml-2 text-amber-500">● unsaved changes</span>}
        </p>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save SOUL.md'}
        </button>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className={textareaClass + ' min-h-[240px]'}
        rows={12}
        placeholder="# SOUL.md&#10;&#10;Write the agent's personality and system prompt here..."
      />
      </div>
    </div>
  )
}

function PreviewTab({ form }: { form: EditForm }) {
  const yaml = useMemo(() => buildYamlPreview(form), [form])
  return (
    <div>
      <p className="text-xs text-text-tertiary mb-3">Live preview of the config.yaml that will be saved.</p>
      <pre className="bg-bg-base border border-border rounded-md p-4 text-xs text-text-primary font-mono leading-relaxed overflow-x-auto whitespace-pre max-h-[400px] overflow-y-auto">
        {yaml}
      </pre>
    </div>
  )
}

/* ── Count changed fields ───────────────────────────────────────── */

function countChanges(original: EditForm, current: EditForm): number {
  let count = 0
  if (original.model !== current.model) count++
  if (original.provider !== current.provider) count++
  if (original.base_url !== current.base_url) count++
  if (original.fallback_providers !== current.fallback_providers) count++
  if (JSON.stringify(original.toolsets) !== JSON.stringify(current.toolsets)) count++
  if (original.max_turns !== current.max_turns) count++
  if (original.gateway_timeout !== current.gateway_timeout) count++
  if (original.restart_drain_timeout !== current.restart_drain_timeout) count++
  if (original.api_max_retries !== current.api_max_retries) count++
  if (original.tool_use_enforcement !== current.tool_use_enforcement) count++
  if (original.task_completion_guidance !== current.task_completion_guidance) count++
  if (original.parallel_tool_call_guidance !== current.parallel_tool_call_guidance) count++
  if (original.verify_on_stop !== current.verify_on_stop) count++
  if (original.clarify_timeout !== current.clarify_timeout) count++
  if (original.description !== current.description) count++
  return count
}

/* ── Edit Dialog ────────────────────────────────────────────────── */

function ProfileEditDialog({ profile, onSave, onClose, saving }: {
  profile: ProfileDetail
  onSave: (data: any) => void
  onClose: () => void
  saving: boolean
}) {
  const [original] = useState(() => formFromDetail(profile))
  const [form, setForm] = useState(() => formFromDetail(profile))
  const [tab, setTab] = useState<TabKey>('model')
  const [touched, setTouched] = useState(false)
  const [soulDirty, setSoulDirty] = useState(false)
  const soulSaveRef = useRef<(() => Promise<boolean>) | null>(null)
  // M-2a: disable the main Save while the soul save is in flight — a second
  // click would double-fire the soul PUT and onSave
  const [busy, setBusy] = useState(false)

  const errors = useMemo(() => validate(form, false), [form])
  const changedCount = useMemo(() => countChanges(original, form), [original, form])
  const hasErrors = Object.keys(errors).length > 0

  const handleClose = () => {
    // SOUL edits lived in a separate save button and were silently discarded
    // on close — never drop typed content without asking.
    if (soulDirty && !window.confirm('SOUL.md has unsaved changes. Discard them?')) return
    onClose()
  }

  const handleSave = async () => {
    if (busy) return
    setTouched(true)
    if (hasErrors) return
    setBusy(true)
    try {
      if (soulDirty && soulSaveRef.current) {
        const ok = await soulSaveRef.current()
        // a failed soul save must keep the dialog open: onSave() closes it and
        // the unmount would bypass handleClose's unsaved-changes confirm (H2)
        if (!ok) return
      }
      onSave(buildPayload(form))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-elevated border border-border rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-h5 font-bold text-text-primary">Edit Profile</h3>
            <button onClick={handleClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface/60 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p className="text-body-sm text-text-tertiary mb-4 font-mono">{profile.id}</p>
        </div>

        {/* Tabs */}
        <TabBar active={tab} onChange={setTab} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'model' && <ModelTab form={form} setForm={setForm} errors={touched ? errors : {}} isCreate={false} />}
          {tab === 'agent' && <AgentTab form={form} setForm={setForm} errors={touched ? errors : {}} />}
          {tab === 'toolsets' && <ToolsetsTab form={form} setForm={setForm} />}
          {tab === 'description' && <DescriptionTab form={form} setForm={setForm} />}
          {/* kept mounted across tab switches: unmounting destroyed typed SOUL
              content silently and left a stale dirty flag (H1) */}
          <div style={{ display: tab === 'memory' ? 'block' : 'none' }}>
            <MemoryTab
              profileId={profile.id}
              visible={tab === 'memory'}
              onDirtyChange={setSoulDirty}
              registerSave={(fn) => { soulSaveRef.current = fn }}
            />
          </div>
          {tab === 'preview' && <PreviewTab form={form} />}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-tertiary">
            {changedCount > 0 ? `${changedCount} field${changedCount > 1 ? 's' : ''} changed` : 'No changes'}
          </span>
          <div className="flex gap-3">
            <button onClick={handleClose} className="px-4 py-2 text-sm rounded-md border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving || busy || (touched && hasErrors)}
              className="bg-accent text-text-inverse px-4 py-2 text-sm rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Create Dialog ──────────────────────────────────────────────── */

function ProfileCreateDialog({ onSave, onClose, saving }: {
  onSave: (data: any) => void
  onClose: () => void
  saving: boolean
}) {
  const [form, setForm] = useState<EditForm>(defaultForm)
  const [tab, setTab] = useState<TabKey>('model')
  const [touched, setTouched] = useState(false)

  const errors = useMemo(() => validate(form, true), [form])
  const hasErrors = Object.keys(errors).length > 0

  const handleSave = () => {
    setTouched(true)
    if (hasErrors) return
    onSave({ id: form.id, name: form.id, ...buildPayload(form) })
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-elevated border border-border rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-h5 font-bold text-text-primary">Create New Profile</h3>
            <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface/60 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p className="text-body-sm text-text-tertiary mb-4">Configure a new agent profile</p>
        </div>

        {/* Tabs */}
        <TabBar active={tab} onChange={setTab} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'model' && <ModelTab form={form} setForm={setForm} errors={touched ? errors : {}} isCreate={true} />}
          {tab === 'agent' && <AgentTab form={form} setForm={setForm} errors={touched ? errors : {}} />}
          {tab === 'toolsets' && <ToolsetsTab form={form} setForm={setForm} />}
          {tab === 'description' && <DescriptionTab form={form} setForm={setForm} />}
          {tab === 'memory' && (
            <div className="text-text-tertiary text-sm py-8 text-center">
              Save the profile first, then edit its SOUL.md from the edit dialog.
            </div>
          )}
          {tab === 'preview' && <PreviewTab form={form} />}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || (touched && hasErrors)}
            className="bg-accent text-text-inverse px-4 py-2 text-sm rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ──────────────────────────────────────────────────── */

export default function ProfilesPage() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deletePurge, setDeletePurge] = useState(false)

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => apiFetch('/api/profiles') as Promise<ProfileSummary[]>,
  })

  const { data: detail, error: detailError, isLoading: detailLoading } = useQuery({
    queryKey: ['profile', editing],
    queryFn: () => apiFetch(`/api/profiles/${editing}`) as Promise<ProfileDetail>,
    enabled: !!editing,
    retry: false,
  })

  const updateMut = useMutation({
    mutationFn: (data: any) => apiFetch(`/api/profiles/${editing}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['profile', editing] }) // M10-13: detail must not go stale
      setEditing(null)
    },
    onError: (e: any) => { alert(`Failed to save profile: ${e.message || e}`) },
  })

  const createMut = useMutation({
    mutationFn: (data: any) => apiFetch('/api/profiles', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profiles'] }); setCreating(false) },
    onError: (e: any) => { alert(`Failed to create profile: ${e.message || e}`) },
  })

  const deleteMut = useMutation({
    mutationFn: ({ id, purge }: { id: string; purge: boolean }) =>
      apiFetch(`/api/profiles/${id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profiles'] }); setDeleteTarget(null); setDeletePurge(false) },
    onError: (e: any) => { alert(`Failed to delete profile: ${e.message || e}`) },
  })

  const dupMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/profiles/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
    onError: (e: any) => { alert(`Failed to duplicate profile: ${e.message || e}`) },
  })

  // M10-08 repair: rebuild a fresh config.yaml for a broken profile
  const recreateMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/profiles/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...buildPayload(defaultForm()), replace: true }),
      }),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      qc.invalidateQueries({ queryKey: ['profile', id] })
    },
    onError: (e: any) => { alert(`Failed to rebuild config: ${e.message || e}`) },
  })

  return (
    <div className="min-h-screen bg-bg-base text-text-secondary">
      <NavBar />
      <header className="px-6 pt-10 pb-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-display font-bold text-text-primary tracking-tight">Agent Profiles</h1>
              <p className="mt-2 text-body text-text-secondary max-w-lg">
                Manage agent configurations, models, and toolsets
              </p>
            </div>
{isAdmin() && (
            <button
              onClick={() => setCreating(true)}
              className="bg-accent text-text-inverse px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              + New Profile
            </button>
            )}
          </div>
        </div>
      </header>

      <main className="px-6 pb-12">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="bg-bg-elevated border border-border rounded-xl p-5 hover:border-accent/50 transition cursor-pointer"
                onClick={() => setEditing(p.id)}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-h5 font-semibold text-text-primary">{p.name}</h3>
                  <span className="text-caption px-2 py-1 rounded bg-accent-subtle text-accent font-mono">{p.id}</span>
                </div>
                {p.error ? (
                  <div className="mb-3 rounded-md border border-error/40 bg-error-subtle/40 px-3 py-2">
                    <div className="text-caption font-semibold text-error mb-0.5">⚠ Invalid config.yaml</div>
                    <div className="text-caption text-text-tertiary line-clamp-3 break-all">{p.error}</div>
                    <div className="text-caption text-text-tertiary mt-1">Use <b>Edit</b> to rebuild the configuration.</div>
                  </div>
                ) : null}
                {!p.error && (<div className="space-y-1.5 text-body-sm text-text-secondary">
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Model</span>
                    <span className="text-text-primary font-mono text-xs">{p.model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Provider</span>
                    <span className="text-text-primary">{p.provider}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Toolsets</span>
                    <span className="text-text-primary">{p.toolsets_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">Fallbacks</span>
                    <span className="text-text-primary">{p.fallback_providers?.length ?? 0}</span>
                  </div>
                </div>)}
                <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditing(p.id) }}
                    className="px-3 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); dupMut.mutate(p.id) }}
                    className="px-3 py-1 text-xs rounded border border-border text-text-secondary hover:text-text-primary hover:bg-surface/60 transition-colors"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.id); setDeletePurge(false) }}
                    className="px-3 py-1 text-xs rounded border border-error/30 text-error hover:bg-error-subtle/50 transition-colors ml-auto"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Edit Dialog */}
      {(editing && detail) && (
        <ProfileEditDialog
          profile={detail}
          onSave={(data) => updateMut.mutate(data)}
          onClose={() => setEditing(null)}
          saving={updateMut.isPending}
        />
      )}

      {/* Repair Dialog — broken config.yaml (M10-08) */}
      {(editing && !detail && !detailLoading && detailError) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg-elevated border border-border rounded-xl p-6 max-w-md w-full">
            <h3 className="text-h5 font-bold text-text-primary mb-2">⚠ Invalid config.yaml</h3>
            <p className="text-body-sm text-text-secondary mb-3 break-all">
              {(detailError as Error)?.message || 'Could not read the configuration.'}
            </p>
            <p className="text-body-sm text-text-tertiary mb-4">
              You can rebuild a default configuration for this profile (replaces the current file).
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm rounded border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
              <button
                onClick={() => recreateMut.mutate(editing)}
                disabled={recreateMut.isPending}
                className="px-4 py-2 text-sm rounded bg-accent text-text-inverse hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {recreateMut.isPending ? 'Rebuilding…' : 'Rebuild configuration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      {creating && (
        <ProfileCreateDialog
          onSave={(data) => createMut.mutate(data)}
          onClose={() => setCreating(false)}
          saving={createMut.isPending}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg-elevated border border-border rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-h5 font-bold text-text-primary mb-2">Delete Profile?</h3>
            <p className="text-body-sm text-text-secondary mb-3">
              Removes the configuration of <span className="font-mono text-accent">{deleteTarget}</span> (config.yaml and SOUL.md).{' '}
              History, memories and profile data are preserved.
            </p>
            <label className="flex items-start gap-2 mb-4 text-body-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={deletePurge}
                onChange={(e) => setDeletePurge(e.target.checked)}
                className="mt-0.5"
              />
              <span>Also delete <b>all data</b> (history, memories, auth) — irreversible</span>
            </label>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm rounded border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
              <button
                onClick={() => deleteMut.mutate({ id: deleteTarget, purge: deletePurge })}
                className="px-4 py-2 text-sm rounded bg-error text-white hover:bg-error/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
