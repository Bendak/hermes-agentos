import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { NavBar } from '../App'

interface ProfileSummary {
  id: string
  name: string
  model: string
  provider: string
  toolsets_count: number
  fallback_count: number
}

interface ProfileDetail {
  id: string
  model: { default: string; provider: string; base_url: string }
  fallback_providers: string[]
  toolsets: string[]
  agent: {
    max_turns: number
    gateway_timeout: number
  }
}

const API = (import.meta as any).env?.VITE_API_URL || ''

async function apiFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem('agentos_token') || localStorage.getItem('agentos_access_token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API}${path}`, { ...opts, headers })
  if (!res.ok) throw new Error((await res.json()).detail || 'Request failed')
  return res.json()
}

export default function ProfilesPage() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => apiFetch('/api/profiles') as Promise<ProfileSummary[]>,
  })

  const { data: detail } = useQuery({
    queryKey: ['profile', editing],
    queryFn: () => apiFetch(`/api/profiles/${editing}`) as Promise<ProfileDetail>,
    enabled: !!editing,
  })

  const updateMut = useMutation({
    mutationFn: (data: any) => apiFetch(`/api/profiles/${editing}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profiles'] }); setEditing(null) },
  })

  const createMut = useMutation({
    mutationFn: (data: any) => apiFetch('/api/profiles', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profiles'] }); setCreating(false) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profiles'] }); setDeleteTarget(null) },
  })

  const dupMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/profiles/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
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
            <button
              onClick={() => setCreating(true)}
              className="bg-accent text-text-inverse px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              + New Profile
            </button>
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
                <div className="space-y-1.5 text-body-sm text-text-secondary">
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
                    <span className="text-text-primary">{p.fallback_count}</span>
                  </div>
                </div>
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
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.id) }}
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
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg-elevated border border-border rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-h5 font-bold text-text-primary mb-2">Delete Profile?</h3>
            <p className="text-body-sm text-text-secondary mb-4">
              This will permanently delete <span className="font-mono text-accent">{deleteTarget}</span> and its config.yaml.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm rounded border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
              <button
                onClick={() => deleteMut.mutate(deleteTarget)}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-caption text-text-tertiary uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  )
}

const inputClass = "w-full px-3 py-2 bg-bg-base border border-border rounded-md text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 transition-all"
const selectClass = inputClass

function ProfileEditDialog({ profile, onSave, onClose, saving }: {
  profile: ProfileDetail
  onSave: (data: any) => void
  onClose: () => void
  saving: boolean
}) {
  const [form, setForm] = useState({
    model: profile.model.default || '',
    provider: profile.model.provider || '',
    base_url: profile.model.base_url || '',
    fallback_providers: profile.fallback_providers.join(', '),
    toolsets: profile.toolsets.join(', '),
    max_turns: profile.agent.max_turns || 150,
    gateway_timeout: profile.agent.gateway_timeout || 1800,
  })

  const upd = (k: string, v: any) => setForm({ ...form, [k]: v })

  return (
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-elevated border border-border rounded-xl max-w-xl w-full max-h-[85vh] overflow-y-auto p-6">
        <h3 className="text-h5 font-bold text-text-primary mb-1">Edit Profile</h3>
        <p className="text-body-sm text-text-tertiary mb-6 font-mono">{profile.id}</p>

        <div className="space-y-4">
          <Field label="Model">
            <input value={form.model} onChange={(e) => upd('model', e.target.value)} className={inputClass} placeholder="e.g. mimo-v2.5" />
          </Field>

          <Field label="Provider">
            <select value={form.provider} onChange={(e) => upd('provider', e.target.value)} className={selectClass}>
              <option value="xiaomi">xiaomi</option>
              <option value="ollama-cloud">ollama-cloud</option>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="google">google</option>
              <option value="nvidia">nvidia</option>
              <option value="">(custom)</option>
            </select>
          </Field>

          <Field label="Base URL (optional)">
            <input value={form.base_url} onChange={(e) => upd('base_url', e.target.value)} className={inputClass} placeholder="https://api.example.com/v1" />
          </Field>

          <Field label="Toolsets (comma-separated)">
            <input value={form.toolsets} onChange={(e) => upd('toolsets', e.target.value)} className={inputClass} placeholder="hermes-cli, web, terminal" />
          </Field>

          <Field label="Fallback Providers (comma-separated)">
            <input value={form.fallback_providers} onChange={(e) => upd('fallback_providers', e.target.value)} className={inputClass} placeholder="ollama-cloud" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Max Turns">
              <input type="number" value={form.max_turns} onChange={(e) => upd('max_turns', parseInt(e.target.value) || 150)} className={inputClass} />
            </Field>
            <Field label="Gateway Timeout (s)">
              <input type="number" value={form.gateway_timeout} onChange={(e) => upd('gateway_timeout', parseInt(e.target.value) || 1800)} className={inputClass} />
            </Field>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
          <button
            onClick={() => onSave({
              model: { default: form.model, provider: form.provider, base_url: form.base_url },
              fallback_providers: form.fallback_providers.split(',').map((s: string) => s.trim()).filter(Boolean),
              toolsets: form.toolsets.split(',').map((s: string) => s.trim()).filter(Boolean),
              agent: { max_turns: form.max_turns, gateway_timeout: form.gateway_timeout },
            })}
            disabled={saving}
            className="bg-accent text-text-inverse px-4 py-2 text-sm rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfileCreateDialog({ onSave, onClose, saving }: {
  onSave: (data: any) => void
  onClose: () => void
  saving: boolean
}) {
  const [form, setForm] = useState({
    id: '',
    model: 'mimo-v2.5',
    provider: 'xiaomi',
    base_url: '',
    toolsets: 'hermes-cli',
    max_turns: 150,
    gateway_timeout: 1800,
  })

  const upd = (k: string, v: any) => setForm({ ...form, [k]: v })

  return (
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-elevated border border-border rounded-xl max-w-xl w-full p-6">
        <h3 className="text-h5 font-bold text-text-primary mb-1">Create New Profile</h3>
        <p className="text-body-sm text-text-tertiary mb-6">Configure a new agent profile</p>

        <div className="space-y-4">
          <Field label="Profile ID (lowercase, no spaces)">
            <input
              value={form.id}
              onChange={(e) => upd('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              className={inputClass + ' font-mono'}
              placeholder="e.g. researcher"
            />
          </Field>

          <Field label="Model">
            <input value={form.model} onChange={(e) => upd('model', e.target.value)} className={inputClass} />
          </Field>

          <Field label="Provider">
            <select value={form.provider} onChange={(e) => upd('provider', e.target.value)} className={selectClass}>
              <option value="xiaomi">xiaomi</option>
              <option value="ollama-cloud">ollama-cloud</option>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="google">google</option>
              <option value="nvidia">nvidia</option>
            </select>
          </Field>

          <Field label="Toolsets (comma-separated)">
            <input value={form.toolsets} onChange={(e) => upd('toolsets', e.target.value)} className={inputClass} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Max Turns">
              <input type="number" value={form.max_turns} onChange={(e) => upd('max_turns', parseInt(e.target.value) || 150)} className={inputClass} />
            </Field>
            <Field label="Gateway Timeout (s)">
              <input type="number" value={form.gateway_timeout} onChange={(e) => upd('gateway_timeout', parseInt(e.target.value) || 1800)} className={inputClass} />
            </Field>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
          <button
            onClick={() => onSave({
              id: form.id,
              model: { default: form.model, provider: form.provider, base_url: form.base_url },
              toolsets: form.toolsets.split(',').map((s: string) => s.trim()).filter(Boolean),
              agent: { max_turns: form.max_turns, gateway_timeout: form.gateway_timeout },
            })}
            disabled={saving || !form.id}
            className="bg-accent text-text-inverse px-4 py-2 text-sm rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}