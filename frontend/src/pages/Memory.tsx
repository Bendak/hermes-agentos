import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageContainer, PageHeader } from '../components/PageHeader'

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('agentos_access_token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

/* ── Tipos (contrato congelado na spec honcho-monitor §5b) ───────── */

interface HonchoRep {
  chars: number
  observations: number
  latest_observation: string | null
}
interface HonchoHuman {
  id: string
  card?: string
  representation?: HonchoRep
}
interface HonchoConclusion {
  id: string
  content: string
  truncated?: boolean
  created_at: string | null
}
interface HonchoWorkspace {
  id: string
  created_at?: string | null
  sessions?: number
  conclusions?: number
  peers?: number
  latest_conclusion_at?: string | null
  queue?: { total?: number; completed?: number; pending?: number; in_progress?: number }
  representation_chars?: number | null
  humans?: HonchoHuman[]
  recent_conclusions?: HonchoConclusion[]
}
interface HonchoSummary {
  status: string
  base_url?: string
  workspaces?: HonchoWorkspace[]
  series?: Record<string, Array<{ ts: number; sessions?: number; conclusions?: number; pending?: number }>>
  errors?: string[]
  warnings?: string[]
  generated_at: number
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function brt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
}

function ageDays(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

const CARD_LABEL: Record<string, { text: string; cls: string }> = {
  not_generated: {
    text: 'não gerado nesta versão (2.1.2) — representação e conclusões intactas',
    cls: 'text-text-tertiary',
  },
  empty: { text: 'gerado, porém vazio', cls: 'text-warning' },
  populated: { text: 'populado', cls: 'text-success' },
}

const STATUS_LABEL: Record<string, string> = {
  ok: 'saudável',
  degraded: 'degradado',
  unreachable: 'inacessível',
  not_configured: 'não configurado',
  error: 'erro',
}

function statusTone(status: string): string {
  if (status === 'ok') return 'text-success'
  if (status === 'degraded') return 'text-warning'
  return 'text-error'
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div className="text-[11px] text-text-tertiary">sem histórico (precisa de ≥2 snapshots)</div>
  }
  const w = 260
  const h = 40
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = w / (points.length - 1)
  const coords = points.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
  return (
    <svg width={w} height={h} className="overflow-visible" role="img" aria-label="histórico">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-accent"
      />
    </svg>
  )
}

/* ── Seção por workspace (memória individual) ────────────────────── */

function WorkspaceCard({ ws, series }: { ws: HonchoWorkspace; series: number[] }) {
  const [openConc, setOpenConc] = useState(false)
  const fresh = ageDays(ws.latest_conclusion_at)
  const stale = fresh !== null && fresh > 14

  return (
    <section className="brand-card p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-h5 font-semibold text-text-primary">{ws.id}</h2>
          <span className="text-[11px] text-text-tertiary">
            criado {ws.created_at ? brt(ws.created_at) : '—'}
          </span>
        </div>
        {stale && (
          <span className="rounded border border-warning/40 px-2 py-0.5 text-[11px] text-warning">
            ⚠ sem conclusão há {fresh} dias
          </span>
        )}
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Sessões', value: ws.sessions },
          { label: 'Conclusões', value: ws.conclusions },
          { label: 'Pares', value: ws.peers },
          { label: 'Representação', value: ws.representation_chars != null ? `${ws.representation_chars.toLocaleString('pt-BR')} caracteres` : '—' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-surface/30 p-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-text-tertiary">{c.label}</p>
            <p className="text-sm font-semibold tabular-nums text-text-primary">
              {c.value ?? '—'}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface/30 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-text-tertiary">Histórico (sessões)</p>
          <Sparkline points={series} />
        </div>
        <div className="space-y-1.5 rounded-xl border border-border bg-surface/30 p-3 text-xs">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-tertiary">Saúde</p>
          <p className="text-text-secondary">
            Última conclusão: <span className="text-text-primary">{brt(ws.latest_conclusion_at)}</span>
          </p>
          <p className="text-text-secondary">
            Deriver: <span className="text-text-primary">{ws.queue?.pending ?? '—'} pendente(s)</span>
            {typeof ws.queue?.total === 'number' && (
              <span className="text-text-tertiary"> · {ws.queue.completed}/{ws.queue.total} concluídos</span>
            )}
          </p>
          {(ws.humans ?? []).map((h) => (
            <p key={h.id} className="text-text-secondary">
              <span className="font-mono text-text-primary">{h.id}</span>: card{' '}
              <span className={CARD_LABEL[h.card ?? '']?.cls ?? 'text-text-tertiary'}>
                {CARD_LABEL[h.card ?? '']?.text ?? h.card ?? '—'}
              </span>
              {h.representation && (
                <span className="text-text-tertiary">
                  {' '}· {h.representation.chars} caracteres / {h.representation.observations} obs
                  {h.representation.latest_observation ? ` (últ. ${h.representation.latest_observation})` : ''}
                </span>
              )}
            </p>
          ))}
        </div>
      </div>

      {(ws.recent_conclusions?.length ?? 0) > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setOpenConc(v => !v)}
            aria-expanded={openConc}
            className="text-xs text-accent transition-colors hover:text-accent-hover"
          >
            {openConc ? '▾ ocultar' : '▸ ver'} últimas {ws.recent_conclusions!.length} conclusões (conteúdo)
          </button>
          {openConc && (
            <ul className="mt-3 space-y-2">
              {ws.recent_conclusions!.map((c) => (
                <li key={c.id} className="rounded-xl border border-border bg-surface/30 p-3">
                  <p className="mb-1 text-[11px] text-text-tertiary">
                    {brt(c.created_at)}
                    {c.truncated && (
                      <span className="ml-2 rounded border border-warning/40 px-1.5 py-0.5 text-warning">
                        truncado (1.000 caracteres) — texto original maior
                      </span>
                    )}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-xs text-text-secondary">{c.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/* ── Página ──────────────────────────────────────────────────────── */

export default function MemoryPage() {
  const { data, isLoading, error } = useQuery<HonchoSummary>({
    queryKey: ['honcho-summary'],
    queryFn: async () => {
      const res = await fetch('/api/honcho/summary', { headers: getAuthHeaders() })
      if (!res.ok) throw new Error(res.status === 403 ? 'Apenas admin' : `HTTP ${res.status}`)
      return res.json()
    },
    refetchInterval: 60000,
  })

  const wsList = data?.workspaces ?? []
  const generated = data && typeof data.generated_at === 'number' && Number.isFinite(data.generated_at)
    ? brt(new Date(data.generated_at * 1000).toISOString())
    : null
  const subtitle = isLoading
    ? 'Carregando o resumo do Honcho…'
    : error
      ? 'Não foi possível carregar a memória.'
      : data
        ? `${data.base_url ?? '—'} · atualizado ${generated ?? '—'} BRT`
        : 'Sem dados do Honcho.'
  const actions = data ? (
    <span className={`text-sm font-mono ${statusTone(data.status)}`}>
      ● {STATUS_LABEL[data.status] ?? data.status}
    </span>
  ) : undefined

  return (
    <PageContainer>
      <PageHeader eyebrow="Memória persistente" title="Memória" subtitle={subtitle} actions={actions} />

      <main className="mt-6 space-y-5 pb-12">
        {isLoading ? (
          <div className="space-y-4" role="status" aria-label="Carregando memória">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="brand-card p-5">
                <div className="mb-4 h-4 w-48 animate-pulse rounded bg-surface/60" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <div key={j} className="h-16 animate-pulse rounded-xl bg-surface/40" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="brand-card max-w-xl space-y-3 p-5">
            <p className="text-body-sm text-error">Erro: {(error as Error).message}</p>
            {(error as Error).message === 'Apenas admin' && (
              <p className="text-xs text-text-tertiary">
                A memória do Honcho é restrita ao admin (contém fatos reais e privados).
              </p>
            )}
            <Link to="/" className="inline-block text-xs text-accent transition-colors hover:text-accent-hover">
              ← Voltar ao Dashboard
            </Link>
          </div>
        ) : !data ? (
          <div className="brand-card p-8 text-center text-body-sm text-text-secondary">Sem dados do Honcho.</div>
        ) : (
          <>
            {(data.errors ?? []).map((e) => (
              <div key={e} className="rounded-xl border border-error/40 bg-error/10 px-4 py-2 text-xs text-error">
                {e}
              </div>
            ))}
            {(data.warnings ?? []).filter((w) => /:\s*queda de\s/.test(w)).map((w) => (
              <div key={w} className="rounded-xl border border-error/40 bg-error/10 px-4 py-2 text-xs text-error">
                ⚠ queda detectada — {w}
              </div>
            ))}
            {(data.warnings ?? []).filter((w) => !/:\s*queda de\s/.test(w)).map((w) => (
              <div key={w} className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
                {w}
              </div>
            ))}

            {data.status === 'not_configured' && (
              <div className="brand-card p-5 text-sm text-text-secondary">
                Honcho não configurado (<code>honcho.json</code> ausente) — nada para mostrar.
              </div>
            )}
            {data.status === 'unreachable' && (
              <div className="brand-card p-5 text-sm text-text-secondary">
                Honcho inalcançável agora — o painel voltará a funcionar quando a API responder.
              </div>
            )}

            {wsList.length === 0 && data.status !== 'not_configured' && (
              <div className="brand-card p-8 text-center text-body-sm text-text-secondary">Nenhum workspace encontrado.</div>
            )}

            {/* Uma subseção por workspace: são memórias individuais por profile —
                nunca misturar numa lista única. */}
            {wsList.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                series={(data.series?.[ws.id] ?? []).map(s => s.sessions ?? 0)}
              />
            ))}

            <div className="brand-card p-4 text-xs text-text-tertiary">
              <p className="mb-1 font-medium text-text-secondary">Backup</p>
              <p>
                Volume Postgres do Honcho: <code>honcho-database-1</code> (pgvector/pg15). Sugestão: snapshot
                periódico do volume junto ao backup da stack (cron <code>backup-stack-casa</code>).
              </p>
            </div>
          </>
        )}
      </main>
    </PageContainer>
  )
}
