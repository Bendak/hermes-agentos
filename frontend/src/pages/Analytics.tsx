import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageContainer, PageHeader } from '../components/PageHeader'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts'

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('agentos_access_token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

/* ── Types ────────────────────────────────────────── */

interface TokenByModel {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated_cost_usd: number
  session_count: number
}

interface TokenTrend {
  day: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
}

interface TopSession {
  session_id: string
  display_name: string | null
  model: string
  profile: string
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  estimated_cost_usd: number
}

interface TokenUsageResponse {
  by_model: TokenByModel[]
  trend: TokenTrend[]
  top_sessions: TopSession[]
  totals: {
    input_tokens: number; output_tokens: number; cache_read_tokens: number
    cache_write_tokens: number; reasoning_tokens: number; total_tokens: number
    estimated_cost_usd: number; api_call_count: number
  }
}

interface HeatmapEntry { day: string; hour: number; count: number }
interface ActivityResponse {
  heatmap: HeatmapEntry[]
  per_hour: Record<string, number>
  per_day: Record<string, number>
  peak_hour: number | null
  peak_day: string | null
  total_sessions: number
}

interface HardwareResponse {
  cpu: { percent: number; cores: number; load_avg: number[] }
  ram: { total: number; used: number; free: number; percent: number }
  disk: { total: number; used: number; free: number; percent: number }
  uptime: { seconds: number; formatted: string }
}

/* ── Helpers ──────────────────────────────────────── */

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function percentColor(pct: number): string {
  if (pct < 60) return 'bg-success'
  if (pct < 80) return 'bg-yellow-500'
  return 'bg-error'
}

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_LABEL: Record<string, string> = {
  Mon: 'Seg', Tue: 'Ter', Wed: 'Qua', Thu: 'Qui', Fri: 'Sex', Sat: 'Sáb', Sun: 'Dom',
}

/* ── Uso de tokens Section ──────────────────────────── */

function TokenUsageSection() {
  const { data, isLoading, error } = useQuery<TokenUsageResponse>({
    queryKey: ['analytics-tokens'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/tokens', { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Falha ao carregar dados de tokens')
      return res.json()
    },
  })

  if (isLoading) return <div className="text-text-tertiary text-sm py-8">Carregando dados de tokens…</div>
  if (error) return <div className="text-error text-sm py-8">Não foi possível carregar os dados de tokens.</div>
  if (!data) return null

  // Prepare bar chart data: top models by total tokens
  const barData = data.by_model.slice(0, 8).map((m) => ({
    name: m.model.length > 20 ? m.model.slice(0, 18) + '…' : m.model,
    fullName: m.model,
    input: m.input_tokens,
    output: m.output_tokens,
    cache: m.cache_read_tokens,
    cacheWrite: m.cache_write_tokens,
    reasoning: m.reasoning_tokens,
  }))

  // Prepare line chart: aggregate trend by day
  const dayMap: Record<string, { input: number; output: number; cache: number; reasoning: number }> = {}
  for (const t of data.trend) {
    if (!dayMap[t.day]) dayMap[t.day] = { input: 0, output: 0, cache: 0, reasoning: 0 }
    dayMap[t.day].input += t.input_tokens
    dayMap[t.day].output += t.output_tokens
    dayMap[t.day].cache += t.cache_read_tokens
    dayMap[t.day].reasoning += t.reasoning_tokens
  }
  const lineData = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day: day.slice(5), ...v })) // MM-DD

  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: 'Tokens de entrada', value: data.totals.input_tokens, color: 'text-accent', fmt: formatTokens },
          { label: 'Tokens de saída', value: data.totals.output_tokens, color: 'text-purple-400', fmt: formatTokens },
          { label: 'Cache leitura', value: data.totals.cache_read_tokens, color: 'text-success', fmt: formatTokens },
          { label: 'Cache escrita', value: data.totals.cache_write_tokens, color: 'text-sky-400', fmt: formatTokens },
          { label: 'Raciocínio', value: data.totals.reasoning_tokens, color: 'text-yellow-400', fmt: formatTokens },
          { label: 'Custo estimado', value: data.totals.estimated_cost_usd, color: 'text-warning', fmt: (v: number) => `$${v.toFixed(2)}` },
        ].map((c) => (
          <div key={c.label} className="brand-card p-5">
            <p className="text-caption text-text-tertiary uppercase tracking-wider mb-1">{c.label}</p>
            <p className={`text-h3 font-bold ${c.color} tabular-nums`}>{c.fmt(c.value)}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar chart: tokens by model */}
        <div className="brand-card p-5">
          <h3 className="text-h5 font-semibold text-text-primary mb-4">Tokens por modelo</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => formatTokens(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: '8px', color: '#e5e7eb' }}
                formatter={(value: any, name: any) => [formatTokens(Number(value)), String(name)]}
              />
              <Bar dataKey="input" stackId="a" fill="#0ea5e9" name="Entrada" radius={[0, 0, 0, 0]} />
              <Bar dataKey="output" stackId="a" fill="#a855f7" name="Saída" />
              <Bar dataKey="cache" stackId="a" fill="#22c55e" name="Cache leitura" />
              <Bar dataKey="cacheWrite" stackId="a" fill="#38bdf8" name="Cache escrita" />
              <Bar dataKey="reasoning" stackId="a" fill="#f59e0b" name="Raciocínio" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Line chart: daily trend */}
        <div className="brand-card p-5">
          <h3 className="text-h5 font-semibold text-text-primary mb-4">Tendência diária (7 dias)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={lineData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => formatTokens(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: '8px', color: '#e5e7eb' }}
                formatter={(value: any, name: any) => [formatTokens(Number(value)), String(name)]}
              />
              <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
              <Line type="monotone" dataKey="input" stroke="#0ea5e9" name="Entrada" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="output" stroke="#a855f7" name="Saída" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="cache" stroke="#22c55e" name="Cache leitura" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top sessões table */}
      <div className="brand-card p-5">
        <h3 className="text-h5 font-semibold text-text-primary mb-4">Sessões com mais tokens</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-tertiary text-left">
                <th className="pb-2 pr-4 font-medium">Sessão</th>
                <th className="pb-2 pr-4 font-medium">Perfil</th>
                <th className="pb-2 pr-4 font-medium">Modelo</th>
                <th className="pb-2 pr-4 font-medium text-right">Total</th>
                <th className="pb-2 pr-4 font-medium text-right">Entrada</th>
                <th className="pb-2 pr-4 font-medium text-right">Saída</th>
                <th className="pb-2 pr-4 font-medium text-right">Cache</th>
                <th className="pb-2 font-medium text-right">Custo</th>
              </tr>
            </thead>
            <tbody>
              {data.top_sessions.map((s) => (
                <tr key={s.session_id} className="border-b border-border hover:bg-surface/60 transition">
                  <td className="py-2.5 pr-4 text-text-primary font-mono text-xs">
                    {s.display_name || s.session_id}
                  </td>
                  <td className="py-2.5 pr-4 text-xs">
                    <span className="rounded border border-border px-1.5 py-0.5 text-text-tertiary">{s.profile}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-text-secondary text-xs">{s.model}</td>
                  <td className="py-2.5 pr-4 text-right text-accent font-mono text-xs">{formatTokens(s.total_tokens)}</td>
                  <td className="py-2.5 pr-4 text-right text-text-secondary font-mono text-xs">{formatTokens(s.input_tokens)}</td>
                  <td className="py-2.5 pr-4 text-right text-text-secondary font-mono text-xs">{formatTokens(s.output_tokens)}</td>
                  <td className="py-2.5 pr-4 text-right text-text-secondary font-mono text-xs">{formatTokens(s.cache_read_tokens + s.cache_write_tokens)}</td>
                  <td className="py-2.5 text-right text-text-secondary font-mono text-xs">${s.estimated_cost_usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── Atividade Section ─────────────────────── */

function ActivityHeatmapSection() {
  const { data, isLoading, error } = useQuery<ActivityResponse>({
    queryKey: ['analytics-activity'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/activity', { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Falha ao carregar dados de atividade')
      return res.json()
    },
  })

  const [hoveredCell, setHoveredCell] = useState<string | null>(null)

  if (isLoading) return <div className="text-text-tertiary text-sm py-8">Carregando dados de atividade…</div>
  if (error) return <div className="text-error text-sm py-8">Não foi possível carregar os dados de atividade.</div>
  if (!data) return null

  // Build lookup: {day_hour: count}
  const lookup: Record<string, number> = {}
  let maxCount = 0
  for (const entry of data.heatmap) {
    const key = `${entry.day}_${entry.hour}`
    lookup[key] = entry.count
    if (entry.count > maxCount) maxCount = entry.count
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="brand-card p-5">
          <p className="text-caption text-text-tertiary uppercase tracking-wider mb-1">Horário de pico</p>
          <p className="text-h3 font-bold text-accent tabular-nums">
            {data.peak_hour !== null ? `${data.peak_hour}:00 BRT` : '—'}
          </p>
        </div>
        <div className="brand-card p-5">
          <p className="text-caption text-text-tertiary uppercase tracking-wider mb-1">Dia de pico</p>
          <p className="text-h3 font-bold text-purple-400 tabular-nums">{data.peak_day ? (DAY_LABEL[data.peak_day] ?? data.peak_day) : '—'}</p>
        </div>
        <div className="brand-card p-5">
          <p className="text-caption text-text-tertiary uppercase tracking-wider mb-1">Total de sessões</p>
          <p className="text-h3 font-bold text-text-primary tabular-nums">{data.total_sessions}</p>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="brand-card p-5 overflow-x-auto">
        <h3 className="text-h5 font-semibold text-text-primary mb-4">Mapa de atividade (BRT)</h3>
        <div className="min-w-[700px]">
          {/* Hour labels */}
          <div className="flex mb-1">
            <div className="w-12 shrink-0" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center text-[10px] text-text-tertiary font-mono">
                {h % 3 === 0 ? `${h}` : ''}
              </div>
            ))}
          </div>
          {/* Day rows */}
          {DAY_ORDER.map((day) => (
            <div key={day} className="flex items-center mb-0.5">
              <div className="w-12 shrink-0 text-xs text-text-secondary font-medium pr-2 text-right">{DAY_LABEL[day] ?? day}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const count = lookup[`${day}_${h}`] || 0
                const intensity = maxCount > 0 ? count / maxCount : 0
                const cellKey = `${day}_${h}`
                return (
                  <div
                    key={h}
                    className="flex-1 relative group"
                    onMouseEnter={() => setHoveredCell(cellKey)}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <div
                      className="aspect-square rounded-sm mx-[1px] transition-all"
                      style={{
                        backgroundColor: count > 0
                          ? `rgba(14, 165, 233, ${0.1 + intensity * 0.9})`
                          : 'rgba(14, 165, 233, 0.04)',
                      }}
                    />
                    {hoveredCell === cellKey && (
                      <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-bg-elevated border border-border rounded text-xs text-text-primary whitespace-nowrap shadow-lg pointer-events-none">
                        {DAY_LABEL[day] ?? day} {h}:00 — {count} {count === 1 ? 'sessão' : 'sessões'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {/* Legend */}
          <div className="flex items-center justify-end gap-2 mt-3 text-xs text-text-tertiary">
            <span>Menos</span>
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <div
                key={v}
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: v === 0 ? 'rgba(14,165,233,0.04)' : `rgba(14,165,233,${0.1 + v * 0.9})` }}
              />
            ))}
            <span>Mais</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Hardware Section ─────────────────────────────── */

function HardwareSection() {
  const { data, isLoading, error } = useQuery<HardwareResponse>({
    queryKey: ['analytics-hardware'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/hardware', { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Falha ao carregar dados do sistema')
      return res.json()
    },
    refetchInterval: 10_000,
  })

  if (isLoading) return <div className="text-text-tertiary text-sm py-8">Carregando recursos do sistema…</div>
  if (error) return <div className="text-error text-sm py-8">Não foi possível carregar os recursos do sistema.</div>
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* CPU */}
      <div className="brand-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-h5 font-semibold text-text-primary">CPU</h3>
          <span className="text-text-secondary text-sm font-mono">{data.cpu.cores} núcleos</span>
        </div>
        <div className="mb-2">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-secondary">Uso</span>
            <span className="text-text-primary font-mono">{data.cpu.percent}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-bg-base overflow-hidden">
            <div className={`h-full rounded-full transition-all ${percentColor(data.cpu.percent)}`} style={{ width: `${data.cpu.percent}%` }} />
          </div>
        </div>
        <div className="flex gap-4 text-sm mt-3">
          <div>
            <span className="text-text-tertiary">Carga 1m: </span>
            <span className="text-text-primary font-mono">{data.cpu.load_avg[0]}</span>
          </div>
          <div>
            <span className="text-text-tertiary">5m: </span>
            <span className="text-text-primary font-mono">{data.cpu.load_avg[1]}</span>
          </div>
          <div>
            <span className="text-text-tertiary">15m: </span>
            <span className="text-text-primary font-mono">{data.cpu.load_avg[2]}</span>
          </div>
        </div>
      </div>

      {/* RAM & Disk */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* RAM */}
        <div className="brand-card p-5">
          <h3 className="text-h5 font-semibold text-text-primary mb-3">RAM</h3>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-secondary">{formatBytes(data.ram.used)} / {formatBytes(data.ram.total)}</span>
            <span className="text-text-primary font-mono">{data.ram.percent}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-bg-base overflow-hidden mb-2">
            <div className={`h-full rounded-full transition-all ${percentColor(data.ram.percent)}`} style={{ width: `${data.ram.percent}%` }} />
          </div>
          <p className="text-xs text-text-tertiary">Livre: {formatBytes(data.ram.free)}</p>
        </div>

        {/* Disk */}
        <div className="brand-card p-5">
          <h3 className="text-h5 font-semibold text-text-primary mb-3">Disco</h3>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-secondary">{formatBytes(data.disk.used)} / {formatBytes(data.disk.total)}</span>
            <span className="text-text-primary font-mono">{data.disk.percent}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-bg-base overflow-hidden mb-2">
            <div className={`h-full rounded-full transition-all ${percentColor(data.disk.percent)}`} style={{ width: `${data.disk.percent}%` }} />
          </div>
          <p className="text-xs text-text-tertiary">Livre: {formatBytes(data.disk.free)}</p>
        </div>
      </div>

      {/* Uptime */}
      <div className="brand-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-h5 font-semibold text-text-primary">Uptime</h3>
          <span className="text-h4 font-bold text-accent font-mono">{data.uptime.formatted}</span>
        </div>
      </div>
    </div>
  )
}

/* ── Page ─────────────────────────────────────────── */

export default function AnalyticsPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Observabilidade"
        title="Analytics"
        subtitle="Consumo de tokens, atividade e recursos do sistema em tempo real."
      />

      <main className="mt-6 space-y-10 pb-12">
        <section>
          <h2 className="mb-4 text-h3 font-semibold text-text-primary">Uso de tokens</h2>
          <TokenUsageSection />
        </section>

        <section>
          <h2 className="mb-4 text-h3 font-semibold text-text-primary">Atividade</h2>
          <ActivityHeatmapSection />
        </section>

        <section>
          <h2 className="mb-4 text-h3 font-semibold text-text-primary">Recursos do sistema</h2>
          <HardwareSection />
        </section>
      </main>
    </PageContainer>
  )
}
