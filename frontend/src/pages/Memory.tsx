import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavBar } from '../App'
import { Link } from 'react-router-dom'

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
  empty: { text: 'gerado, porém vazio', cls: 'text-semantic-warning' },
  populated: { text: 'populado', cls: 'text-semantic-success' },
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
    <section className="rounded-xl border border-border bg-surface/40 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-h5 font-semibold text-text-primary font-mono">{ws.id}</h3>
          <span className="text-[11px] text-text-tertiary">
            criado {ws.created_at ? brt(ws.created_at) : '—'}
          </span>
        </div>
        {stale && (
          <span className="text-[11px] rounded border border-semantic-warning/40 text-semantic-warning px-2 py-0.5">
            ⚠ sem conclusão há {fresh} dias
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Sessões', value: ws.sessions },
          { label: 'Conclusões', value: ws.conclusions },
          { label: 'Peers', value: ws.peers },
          { label: 'Representação', value: ws.representation_chars != null ? `${ws.representation_chars.toLocaleString('pt-BR')} chars` : '—' },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-border/60 p-3">
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">{c.label}</p>
            <p className="text-sm font-semibold text-text-primary tabular-nums">
              {c.value ?? '—'}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Histórico (sessões)</p>
          <Sparkline points={series} />
        </div>
        <div className="rounded-lg border border-border/60 p-3 text-xs space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Saúde</p>
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
                  {' '}· {h.representation.chars} chars / {h.representation.observations} obs
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
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            {openConc ? '▾ ocultar' : '▸ ver'} últimas {ws.recent_conclusions!.length} conclusões (conteúdo)
          </button>
          {openConc && (
            <ul className="mt-3 space-y-2">
              {ws.recent_conclusions!.map((c) => (
                <li key={c.id} className="rounded-lg border border-border/60 bg-bg-base/40 p-3">
                  <p className="text-[11px] text-text-tertiary mb-1">
                    {brt(c.created_at)}
                    {c.truncated && (
                      <span className="ml-2 rounded border border-semantic-warning/40 text-semantic-warning px-1.5 py-0.5">
                        truncado (1000 chars) — texto original maior
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-text-secondary whitespace-pre-wrap break-words">{c.content}</p>
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

  const shell = (inner: React.ReactNode) => (
    <>
      <NavBar />
      <div className="mx-auto max-w-7xl px-6 py-8">{inner}</div>
    </>
  )

  if (isLoading) return shell(<div className="text-text-tertiary text-sm py-8">Carregando memória…</div>)
  if (error) {
    const msg = (error as Error).message
    return shell(
      <div className="max-w-xl space-y-3 py-8">
        <p className="text-semantic-error text-sm">Erro: {msg}</p>
        {msg === 'Apenas admin' && (
          <p className="text-xs text-text-tertiary">
            A memória do Honcho é restrita ao admin (contém fatos reais e privados).
          </p>
        )}
        <Link to="/" className="inline-block text-xs text-accent hover:text-accent-hover">
          ← Voltar ao Dashboard
        </Link>
      </div>,
    )
  }
  if (!data) return shell(null)

  const wsList = data.workspaces ?? []
  const statusColor =
    data.status === 'ok' ? 'text-semantic-success' :
    data.status === 'degraded' ? 'text-semantic-warning' : 'text-semantic-error'

  return (
    <>
      <NavBar />
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3 font-bold text-text-primary">Memória (Honcho)</h2>
          <p className="text-xs text-text-tertiary mt-1">
            {data.base_url ?? '—'} · atualizado{' '}
            {typeof data.generated_at === 'number' && Number.isFinite(data.generated_at)
              ? `${brt(new Date(data.generated_at * 1000).toISOString())} BRT`
              : '—'}
          </p>
        </div>
        <span className={`text-sm font-mono ${statusColor}`}>● {data.status}</span>
      </div>

      {(data.errors ?? []).map((e) => (
        <div key={e} className="rounded-lg border border-semantic-error/40 bg-semantic-error/10 px-4 py-2 text-xs text-semantic-error">
          {e}
        </div>
      ))}
      {(data.warnings ?? []).filter((w) => /:\s*queda de\s/.test(w)).map((w) => (
        <div key={w} className="rounded-lg border border-semantic-error/40 bg-semantic-error/10 px-4 py-2 text-xs text-semantic-error">
          ⚠ queda detectada — {w}
        </div>
      ))}
      {(data.warnings ?? []).filter((w) => !/:\s*queda de\s/.test(w)).map((w) => (
        <div key={w} className="rounded-lg border border-semantic-warning/40 bg-semantic-warning/10 px-4 py-2 text-xs text-semantic-warning">
          {w}
        </div>
      ))}

      {data.status === 'not_configured' && (
        <div className="text-sm text-text-secondary">
          Honcho não configurado (<code>honcho.json</code> ausente) — nada para mostrar.
        </div>
      )}
      {data.status === 'unreachable' && (
        <div className="text-sm text-text-secondary">
          Honcho inalcançável agora — o painel voltará a funcionar quando a API responder.
        </div>
      )}

      {wsList.length === 0 && data.status !== 'not_configured' && (
        <div className="text-sm text-text-tertiary">Nenhum workspace encontrado.</div>
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

      <div className="rounded-lg border border-border/60 p-4 text-xs text-text-tertiary">
        <p className="font-medium text-text-secondary mb-1">Backup</p>
        <p>
          Volume Postgres do Honcho: <code>honcho-database-1</code> (pgvector/pg15). Sugestão: snapshot
          periódico do volume junto ao backup da stack (cron <code>backup-stack-casa</code>).
        </p>
      </div>
      </div>
    </>
  )
}
