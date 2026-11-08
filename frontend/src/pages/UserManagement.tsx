import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { apiErrorMessage } from '../lib/api'
import { PageContainer, PageHeader } from '../components/PageHeader'

interface UserRecord {
  id: number
  username: string
  role: string
  created_at: string
  chat_profile?: string | null
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('agentos_access_token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

const ROLE_LABEL: Record<string, string> = { admin: 'Administrador', viewer: 'Visualizador' }

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/** Foco inicial, trap de Tab, Escape e restauração — padrão dos modais da casa. */
function useDialogA11y(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const lastFocused = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    lastFocused.current = document.activeElement
    closeRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!panelRef.current.contains(document.activeElement)) {
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

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const target = lastFocused.current
      if (target instanceof HTMLElement) target.focus()
    }
  }, [])

  return { panelRef, closeRef }
}

export default function UserManagement() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'

  // ── Data fetching ───────────────────────────────────────────────
  const { data: usersData, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/auth/users', { headers: getAuthHeaders() })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json() as Promise<{ users: UserRecord[] }>
    },
    enabled: isAdmin,
  })

  const users = usersData?.users ?? []

  // Profiles disponíveis para mapear o chat (default + subprofiles).
  const { data: profileOptions } = useQuery({
    queryKey: ['chat-profile-options'],
    queryFn: async () => {
      const res = await fetch('/api/profiles', { headers: getAuthHeaders() })
      if (!res.ok) return [{ id: 'default', name: 'default' }]
      const rows = (await res.json()) as { id?: string; name?: string }[]
      const opts = [{ id: 'default', name: 'default' }].concat(
        rows.map((r) => ({ id: String(r.id || r.name || ''), name: String(r.name || r.id || '') })),
      )
      return opts.filter((o) => o.id)
    },
    enabled: isAdmin,
  })

  const profileMutation = useMutation({
    mutationFn: async ({ userId, profile }: { userId: number; profile: string | null }) => {
      const res = await fetch(`/api/auth/users/${userId}/profile`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ chat_profile: profile }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  // ── Dialog state ────────────────────────────────────────────────
  const [changePwTarget, setChangePwTarget] = useState<UserRecord | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null)

  // ── Mutations ───────────────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const deleteMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/auth/users/${userId}`, { method: 'DELETE', headers: getAuthHeaders() })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      return res.json()
    },
    onSuccess: () => { invalidate(); setDeleteTarget(null) },
  })

  const renderUserActions = (u: UserRecord) => (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => setChangePwTarget(u)}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface/60 hover:text-text-primary"
      >
        Alterar senha
      </button>
      {u.id !== user?.id && (
        <button
          onClick={() => { deleteMutation.reset(); setDeleteTarget(u) }}
          className="rounded-md border border-error/30 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10"
        >
          Excluir
        </button>
      )}
    </div>
  )

  // Non-admin users can still change their own password
  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Sistema" title="Usuários" subtitle="Gerencie sua conta e senha." />
        <main className="mt-6 pb-12">
          <div className="brand-card max-w-xl p-6">
            <h2 className="text-h3 font-semibold text-text-primary">Sua conta</h2>
            <p className="mt-2 text-sm text-text-secondary">
              Você pode alterar sua própria senha.
            </p>
            <button
              onClick={() => setChangePwTarget({ id: user?.id ?? 0, username: user?.username ?? '', role: user?.role ?? '', created_at: '' })}
              className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface/60 hover:text-text-primary"
            >
              Alterar minha senha
            </button>
          </div>
        </main>
        {changePwTarget && (
          <ChangePasswordDialog
            target={changePwTarget}
            isSelf={true}
            onClose={() => setChangePwTarget(null)}
            onSuccess={() => { setChangePwTarget(null) }}
          />
        )}
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Sistema"
        title="Usuários"
        subtitle={
          isLoading
            ? 'Carregando contas…'
            : error
              ? 'Não foi possível carregar as contas.'
              : `${users.length} ${users.length === 1 ? 'conta' : 'contas'}`
        }
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent/90"
          >
            + Novo usuário
          </button>
        }
      />

      <main className="mt-6 pb-12">
        {error && !isLoading && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
            Não foi possível carregar as contas: {error instanceof Error ? error.message : 'erro desconhecido'}
          </div>
        )}

        {profileMutation.isError && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error">
            Não foi possível atualizar o perfil do chat: {profileMutation.error instanceof Error ? profileMutation.error.message : 'erro desconhecido'}
          </div>
        )}

        {isLoading && (
          <div className="brand-card space-y-3 p-5" role="status" aria-label="Carregando contas">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-surface/60" style={{ width: `${90 - i * 8}%` }} />
            ))}
          </div>
        )}

        {!isLoading && !error && users.length === 0 && (
          <div className="brand-card p-6 text-sm text-text-secondary">Nenhuma conta encontrada.</div>
        )}

        {!isLoading && !error && users.length > 0 && (
          <>
            <div className="brand-card hidden overflow-hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-elevated/50">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">Usuário</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">Papel</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">Perfil do chat</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">Criado em</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-tertiary">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border transition-colors last:border-0 hover:bg-surface/40">
                      <td className="px-4 py-3 font-medium text-text-primary">
                        {u.username}
                        {u.id === user?.id && (
                          <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">você</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                          u.role === 'admin' ? 'bg-accent/10 text-accent' : 'bg-surface/60 text-text-secondary'
                        }`}>
                          {roleLabel(u.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.chat_profile || ''}
                          onChange={(e) => profileMutation.mutate({ userId: u.id, profile: e.target.value || null })}
                          disabled={profileMutation.isPending}
                          aria-label={`Perfil do chat de ${u.username}`}
                          className="rounded-md border border-border bg-bg-base px-2 py-1 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                        >
                          <option value="">— nenhum (mapa legado) —</option>
                          {(profileOptions || []).map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-tertiary">{formatDate(u.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end">{renderUserActions(u)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 lg:hidden">
              {users.map((u) => (
                <article key={u.id} className="brand-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-primary">
                        {u.username}
                        {u.id === user?.id && (
                          <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">você</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-text-tertiary">Criado em {formatDate(u.created_at)}</p>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                      u.role === 'admin' ? 'bg-accent/10 text-accent' : 'bg-surface/60 text-text-secondary'
                    }`}>
                      {roleLabel(u.role)}
                    </span>
                  </div>
                  <label className="mt-3 block text-xs font-medium text-text-secondary">
                    Perfil do chat
                    <select
                      value={u.chat_profile || ''}
                      onChange={(e) => profileMutation.mutate({ userId: u.id, profile: e.target.value || null })}
                      disabled={profileMutation.isPending}
                      aria-label={`Perfil do chat de ${u.username}`}
                      className="mt-1 w-full rounded-md border border-border bg-bg-base px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="">— nenhum (mapa legado) —</option>
                      {(profileOptions || []).map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-3 border-t border-border/60 pt-3">{renderUserActions(u)}</div>
                </article>
              ))}
            </div>
          </>
        )}
      </main>

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
    </PageContainer>
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
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { panelRef, closeRef } = useDialogA11y(onClose)

  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPw !== confirmPw) { setError('As senhas não coincidem.'); return }
    if (newPw.length < 4) { setError('A senha deve ter pelo menos 4 caracteres.'); return }
    setLoading(true)
    try {
      const url = isSelf ? '/api/auth/password' : `/api/auth/users/${target.id}/password`
      const body: Record<string, string> = { new_password: newPw }
      if (isSelf) body.current_password = currentPw
      const res = await fetch(url, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
      setSuccess(true)
      successTimer.current = setTimeout(onSuccess, 1200)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={isSelf ? 'Alterar sua senha' : `Alterar a senha de ${target.username}`}
        className="brand-card relative w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            {isSelf ? 'Alterar sua senha' : `Alterar senha — ${target.username}`}
          </h2>
          <button ref={closeRef} onClick={onClose} aria-label="Fechar" className="rounded p-1 text-text-tertiary hover:bg-surface/60 hover:text-text-primary">✕</button>
        </div>
        {success ? (
          <div className="py-6 text-center font-medium text-success">Senha atualizada com sucesso ✓</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSelf && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Senha atual
                  <input
                    type="password"
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                    required
                  />
                </label>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                Nova senha
                <input
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                  required
                  minLength={4}
                />
              </label>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                Confirmar nova senha
                <input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                  required
                  minLength={4}
                />
              </label>
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface/60">Cancelar</button>
              <button type="submit" disabled={loading} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent/90 disabled:opacity-50">
                {loading ? 'Salvando…' : 'Atualizar senha'}
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
  const { panelRef, closeRef } = useDialogA11y(onClose)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ username, password, role }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res))
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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Criar novo usuário"
        className="brand-card relative w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Criar novo usuário</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Fechar" className="rounded p-1 text-text-tertiary hover:bg-surface/60 hover:text-text-primary">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">
              Usuário
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                required
              />
            </label>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">
              Senha
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                required
                minLength={4}
              />
            </label>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">
              Papel
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                aria-label="Papel"
                className="mt-1.5 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
              >
                <option value="viewer">Visualizador</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface/60">Cancelar</button>
            <button type="submit" disabled={loading} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse transition-colors hover:bg-accent/90 disabled:opacity-50">
              {loading ? 'Criando…' : 'Criar usuário'}
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
  const { panelRef, closeRef } = useDialogA11y(onClose)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Excluir usuário ${target.username}`}
        className="brand-card relative w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Excluir usuário</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Fechar" className="rounded p-1 text-text-tertiary hover:bg-surface/60 hover:text-text-primary">✕</button>
        </div>
        <p className="mb-4 text-sm text-text-secondary">
          Tem certeza que deseja excluir <span className="font-medium text-text-primary">{target.username}</span>? Esta ação não pode ser desfeita.
        </p>
        {error && <p className="mb-3 text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface/60">Cancelar</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-error/90 disabled:opacity-50"
          >
            {loading ? 'Excluindo…' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  )
}
