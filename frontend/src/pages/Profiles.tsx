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
  const token = localStorage.getItem('agentos_token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API}${path}`, { ...opts, headers })
  if (!res.ok) throw new Error((await res.json()).detail || 'Request failed')
  return res.json()
}

export default function ProfilesPage() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<ProfileDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => apiFetch('/api/profiles') as Promise<ProfileSummary[]>,
  })

  const { data: detail } = useQuery({
    queryKey: ['profile', editing?.id],
    queryFn: () => apiFetch(`/api/profiles/${editing!.id}`) as Promise<ProfileDetail>,
    enabled: !!editing,
  })

  const updateMut = useMutation({
    mutationFn: (data: any) => apiFetch(`/api/profiles/${editing!.id}`, { method: 'PUT', body: JSON.stringify(data) }),
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
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Agent Profiles</h1>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 bg-accent text-black rounded-lg font-medium hover:opacity-90 transition"
        >
          + New Profile
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {profiles.map((p) => (
          <div
            key={p.id}
            className="bg-surface border border-border rounded-xl p-5 hover:border-accent/50 transition cursor-pointer"
            onClick={() => setEditing({ id: p.id, model: { default: '', provider: '', base_url: '' }, fallback_providers: [], toolsets: [], agent: { max_turns: 0, gateway_timeout: 0 } })}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-text-primary">{p.name}</h3>
              <span className="text-xs px-2 py-1 rounded bg-accent/10 text-accent font-mono">{p.id}</span>
            </div>
            <div className="space-y-1 text-sm text-text-secondary">
              <p><span className="text-text-tertiary">Model:</span> {p.model}</p>
              <p><span className="text-text-tertiary">Provider:</span> {p.provider}</p>
              <p><span className="text-text-tertiary">Toolsets:</span> {p.toolsets_count}</p>
              <p><span className="text-text-tertiary">Fallbacks:</span> {p.fallback_count}</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={(e) => { e.stopPropagation(); setEditing({ id: p.id, model: { default: '', provider: '', base_url: '' }, fallback_providers: [], toolsets: [], agent: { max_turns: 0, gateway_timeout: 0 } }) }}
                className="px-3 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20"
              >
                Edit
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); dupMut.mutate(p.id) }}
                className="px-3 py-1 text-xs rounded bg-surface text-text-secondary border border-border hover:border-accent/30"
              >
                Duplicate
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(p.id) }}
                className="px-3 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-text-primary mb-2">Delete Profile?</h3>
            <p className="text-sm text-text-secondary mb-4">
              This will permanently delete <span className="font-mono text-accent">{deleteTarget}</span> and its config.yaml.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm rounded border border-border text-text-secondary hover:bg-background">Cancel</button>
              <button
                onClick={() => deleteMut.mutate(deleteTarget)}
                className="px-4 py-2 text-sm rounded bg-red-500 text-white hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-text-primary mb-4">Edit Profile: {profile.id}</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-tertiary mb-1">Model</label>
            <input
              value={form.model}
              onChange={(e) => upd('model', e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
              placeholder="e.g. mimo-v2.5"
            />
          </div>

          <div>
            <label className="block text-sm text-text-tertiary mb-1">Provider</label>
            <select
              value={form.provider}
              onChange={(e) => upd('provider', e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
            >
              <option value="xiaomi">xiaomi</option>
              <option value="ollama-cloud">ollama-cloud</option>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="google">google</option>
              <option value="nvidia">nvidia</option>
              <option value="">(custom)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-text-tertiary mb-1">Base URL (optional)</label>
            <input
              value={form.base_url}
              onChange={(e) => upd('base_url', e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div>
            <label className="block text-sm text-text-tertiary mb-1">Toolsets (comma-separated)</label>
            <input
              value={form.toolsets}
              onChange={(e) => upd('toolsets', e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
              placeholder="hermes-cli, web, terminal"
            />
          </div>

          <div>
            <label className="block text-sm text-text-tertiary mb-1">Fallback Providers (comma-separated)</label>
            <input
              value={form.fallback_providers}
              onChange={(e) => upd('fallback_providers', e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
              placeholder="ollama-cloud"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-tertiary mb-1">Max Turns</label>
              <input
                type="number"
                value={form.max_turns}
                onChange={(e) => upd('max_turns', parseInt(e.target.value) || 150)}
                className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-text-tertiary mb-1">Gateway Timeout (s)</label>
              <input
                type="number"
                value={form.gateway_timeout}
                onChange={(e) => upd('gateway_timeout', parseInt(e.target.value) || 1800)}
                className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-border text-text-secondary hover:bg-background">Cancel</button>
          <button
            onClick={() => onSave({
              model: { default: form.model, provider: form.provider, base_url: form.base_url },
              fallback_providers: form.fallback_providers.split(',').map((s: string) => s.trim()).filter(Boolean),
              toolsets: form.toolsets.split(',').map((s: string) => s.trim()).filter(Boolean),
              agent: { max_turns: form.max_turns, gateway_timeout: form.gateway_timeout },
            })}
            disabled={saving}
            className="px-4 py-2 text-sm rounded bg-accent text-black font-medium hover:opacity-90 disabled:opacity-50"
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl p-6 max-w-lg w-full">
        <h3 className="text-lg font-bold text-text-primary mb-4">Create New Profile</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-tertiary mb-1">Profile ID (lowercase, no spaces)</label>
            <input
              value={form.id}
              onChange={(e) => upd('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm font-mono"
              placeholder="e.g. researcher"
            />
          </div>

          <div>
            <label className="block text-sm text-text-tertiary mb-1">Model</label>
            <input
              value={form.model}
              onChange={(e) => upd('model', e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-text-tertiary mb-1">Provider</label>
            <select
              value={form.provider}
              onChange={(e) => upd('provider', e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
            >
              <option value="xiaomi">xiaomi</option>
              <option value="ollama-cloud">ollama-cloud</option>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="google">google</option>
              <option value="nvidia">nvidia</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-text-tertiary mb-1">Toolsets (comma-separated)</label>
            <input
              value={form.toolsets}
              onChange={(e) => upd('toolsets', e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-tertiary mb-1">Max Turns</label>
              <input type="number" value={form.max_turns} onChange={(e) => upd('max_turns', parseInt(e.target.value) || 150)} className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm" />
            </div>
            <div>
              <label className="block text-sm text-text-tertiary mb-1">Gateway Timeout (s)</label>
              <input type="number" value={form.gateway_timeout} onChange={(e) => upd('gateway_timeout', parseInt(e.target.value) || 1800)} className="w-full px-3 py-2 bg-background border border-border rounded text-text-primary text-sm" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-border text-text-secondary hover:bg-background">Cancel</button>
          <button
            onClick={() => onSave({
              id: form.id,
              model: { default: form.model, provider: form.provider, base_url: form.base_url },
              toolsets: form.toolsets.split(',').map((s: string) => s.trim()).filter(Boolean),
              agent: { max_turns: form.max_turns, gateway_timeout: form.gateway_timeout },
            })}
            disabled={saving || !form.id}
            className="px-4 py-2 text-sm rounded bg-accent text-black font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}