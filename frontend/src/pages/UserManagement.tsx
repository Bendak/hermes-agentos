import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { NavBar } from '../App'

interface UserRecord {
  id: number
  username: string
  role: string
  created_at: string
}

export default function UserManagement() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'

  // ── Data fetching ───────────────────────────────────────────────
  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/auth/users')
      if (!res.ok) throw new Error('Failed to fetch users')
      return res.json() as Promise<{ users: UserRecord[] }>
    },
    enabled: isAdmin,
  })

  const users = usersData?.users ?? []

  // ── Dialog state ────────────────────────────────────────────────
  const [changePwTarget, setChangePwTarget] = useState<UserRecord | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null)

  // ── Mutations ───────────────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const deleteMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/auth/users/${userId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Delete failed' }))
        throw new Error(err.detail || 'Delete failed')
      }
      return res.json()
    },
    onSuccess: () => { invalidate(); setDeleteTarget(null) },
  })

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="rounded-xl border border-border bg-surface/40 p-8 text-center">
          <p className="text-text-secondary">Admin access required to manage users.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-base text-text-secondary">
      <NavBar />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">User Management</h1>
          <p className="text-sm text-text-tertiary mt-1">Manage user accounts and permissions</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          + New User
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-elevated/50">
              <th className="text-left px-4 py-3 text-text-tertiary font-medium text-xs uppercase tracking-wider">Username</th>
              <th className="text-left px-4 py-3 text-text-tertiary font-medium text-xs uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 text-text-tertiary font-medium text-xs uppercase tracking-wider">Created</th>
              <th className="text-right px-4 py-3 text-text-tertiary font-medium text-xs uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-text-tertiary">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-text-tertiary">No users found</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-border/50 last:border-0 hover:bg-surface/60 transition-colors">
                <td className="px-4 py-3 text-text-primary font-medium">
                  {u.username}
                  {u.id === user?.id && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent font-semibold">you</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                    u.role === 'admin' ? 'bg-accent/10 text-accent' : 'bg-surface text-text-secondary'
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-tertiary text-xs font-mono">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setChangePwTarget(u)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface/80 transition-colors"
                    >
                      Change Password
                    </button>
                    {u.id !== user?.id && (
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-error/30 text-error hover:bg-error-subtle/50 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dialogs */}
      {changePwTarget && (
        <ChangePasswordDialog
          target={changePwTarget}
          isSelf={changePwTarget.id === user?.id}
          onClose={() => setChangePwTarget(null)}
          onSuccess={() => { setChangePwTarget(null) }}
        />
      )}
      {createOpen && (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onSuccess={() => { setCreateOpen(false); invalidate() }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog
          target={deleteTarget}
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
          error={deleteMutation.error?.message}
        />
      )}
      </div>
    </div>
  )
}

/* ── Change Password Dialog ─────────────────────────────────── */

function ChangePasswordDialog({
  target,
  isSelf,
  onClose,
  onSuccess,
}: {
  target: UserRecord
  isSelf: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPw !== confirmPw) { setError('Passwords do not match'); return }
    if (newPw.length < 4) { setError('Password must be at least 4 characters'); return }
    setLoading(true)
    try {
      const url = isSelf ? '/api/auth/password' : `/api/auth/users/${target.id}/password`
      const body: Record<string, string> = { new_password: newPw }
      if (isSelf) body.current_password = currentPw
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed' }))
        throw new Error(err.detail || 'Failed to update password')
      }
      setSuccess(true)
      setTimeout(onSuccess, 1200)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-elevated border border-border rounded-xl shadow-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-text-primary">
            {isSelf ? 'Change Your Password' : `Change Password — ${target.username}`}
          </h2>
          <button onClick={onClose} className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface/60">✕</button>
        </div>
        {success ? (
          <div className="py-6 text-center text-accent font-medium">Password updated successfully ✓</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSelf && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Current Password</label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-bg-base border border-border rounded-lg text-text-primary outline-none focus:border-accent transition-colors"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg-base border border-border rounded-lg text-text-primary outline-none focus:border-accent transition-colors"
                required
                minLength={4}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Confirm New Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-bg-base border border-border rounded-lg text-text-primary outline-none focus:border-accent transition-colors"
                required
                minLength={4}
              />
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
              <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {loading ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/* ── Create User Dialog ─────────────────────────────────────── */

function CreateUserDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed' }))
        throw new Error(err.detail || 'Failed to create user')
      }
      onSuccess()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-elevated border border-border rounded-xl shadow-lg w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-text-primary">Create New User</h2>
          <button onClick={onClose} className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface/60">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-bg-base border border-border rounded-lg text-text-primary outline-none focus:border-accent transition-colors"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-bg-base border border-border rounded-lg text-text-primary outline-none focus:border-accent transition-colors"
              required
              minLength={4}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-bg-base border border-border rounded-lg text-text-primary outline-none focus:border-accent transition-colors"
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors">
              {loading ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Delete Confirm Dialog ──────────────────────────────────── */

function DeleteConfirmDialog({
  target,
  loading,
  onConfirm,
  onClose,
  error,
}: {
  target: UserRecord
  loading: boolean
  onConfirm: () => void
  onClose: () => void
  error?: string
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-bg-elevated border border-border rounded-xl shadow-lg w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-text-primary mb-2">Delete User</h2>
        <p className="text-sm text-text-secondary mb-4">
          Are you sure you want to delete <span className="font-medium text-text-primary">{target.username}</span>? This action cannot be undone.
        </p>
        {error && <p className="text-sm text-error mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-text-secondary hover:bg-surface/60 transition-colors">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-error text-white hover:bg-error/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
