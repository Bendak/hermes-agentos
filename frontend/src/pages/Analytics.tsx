import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavBar } from '../App'
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
  reasoning_tokens: number
  session_count: number
}

interface TokenTrend {
  day: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  reasoning_tokens: number
}

interface TopSession {
  session_id: string
  display_name: string | null
  model: string
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  reasoning_tokens: number
}

interface TokenUsageResponse {
  by_model: TokenByModel[]
  trend: TokenTrend[]
  top_sessions: TopSession[]
  totals: { input_tokens: number; output_tokens: number; cache_read_tokens: number; reasoning_tokens: number }
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
  if (pct < 60) return 'bg-semantic-success'
  if (pct < 80) return 'bg-yellow-500'
  return 'bg-semantic-error'
}

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/* ── Token Usage Section ──────────────────────────── */

function TokenUsageSection() {
  const { data, isLoading, error } = useQuery<TokenUsageResponse>({
    queryKey: ['analytics-tokens'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/tokens', { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Failed to load token data')
      return res.json()
    },
  })

  if (isLoading) return <div className="text-text-tertiary text-sm py-8">Loading token data…</div>
  if (error) return <div className="text-semantic-error text-sm py-8">Error loading token data</div>
  if (!data) return null

  // Prepare bar chart data: top models by total tokens
  const barData = data.by_model.slice(0, 8).map((m) => ({
    name: m.model.length > 20 ? m.model.slice(0, 18) + '…' : m.model,
    fullName: m.model,
    input: m.input_tokens,
    output: m.output_tokens,
    cache: m.cache_read_tokens,
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Input Tokens', value: data.totals.input_tokens, color: 'text-accent' },
          { label: 'Output Tokens', value: data.totals.output_tokens, color: 'text-purple-400' },
          { label: 'Cache Read', value: data.totals.cache_read_tokens, color: 'text-semantic-success' },
          { label: 'Reasoning', value: data.totals.reasoning_tokens, color: 'text-yellow-400' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-surface/40 p-5">
            <p className="text-caption text-text-tertiary uppercase tracking-wider mb-1">{c.label}</p>
            <p className={`text-h3 font-bold ${c.color} tabular-nums`}>{formatTokens(c.value)}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar chart: tokens by model */}
        <div className="rounded-xl border border-border bg-surface/40 p-5">
          <h3 className="text-h5 font-semibold text-text-primary mb-4">Tokens by Model</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => formatTokens(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: '8px', color: '#e5e7eb' }}
                formatter={(value: any, name: any) => [formatTokens(Number(value)), String(name)]}
              />
              <Bar dataKey="input" stackId="a" fill="#0ea5e9" name="Input" radius={[0, 0, 0, 0]} />
              <Bar dataKey="output" stackId="a" fill="#a855f7" name="Output" />
              <Bar dataKey="cache" stackId="a" fill="#22c55e" name="Cache Read" />
              <Bar dataKey="reasoning" stackId="a" fill="#f59e0b" name="Reasoning" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Line chart: daily trend */}
        <div className="rounded-xl border border-border bg-surface/40 p-5">
          <h3 className="text-h5 font-semibold text-text-primary mb-4">Daily Token Trend (7 days)</h3>
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
              <Line type="monotone" dataKey="input" stroke="#0ea5e9" name="Input" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="output" stroke="#a855f7" name="Output" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="cache" stroke="#22c55e" name="Cache" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top sessions table */}
      <div className="rounded-xl border border-border bg-surface/40 p-5">
        <h3 className="text-h5 font-semibold text-text-primary mb-4">Top Sessions by Token Usage</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-tertiary text-left">
                <th className="pb-2 pr-4 font-medium">Session</th>
                <th className="pb-2 pr-4 font-medium">Model</th>
                <th className="pb-2 pr-4 font-medium text-right">Total</th>
                <th className="pb-2 pr-4 font-medium text-right">Input</th>
                <th className="pb-2 pr-4 font-medium text-right">Output</th>
                <th className="pb-2 font-medium text-right">Cache</th>
              </tr>
            </thead>
            <tbody>
              {data.top_sessions.map((s) => (
                <tr key={s.session_id} className="border-b border-border/50 hover:bg-surface/60 transition">
                  <td className="py-2.5 pr-4 text-text-primary font-mono text-xs">
                    {s.display_name || s.session_id}
                  </td>
                  <td className="py-2.5 pr-4 text-text-secondary text-xs">{s.model}</td>
                  <td className="py-2.5 pr-4 text-right text-accent font-mono text-xs">{formatTokens(s.total_tokens)}</td>
                  <td className="py-2.5 pr-4 text-right text-text-secondary font-mono text-xs">{formatTokens(s.input_tokens)}</td>
                  <td className="py-2.5 pr-4 text-right text-text-secondary font-mono text-xs">{formatTokens(s.output_tokens)}</td>
                  <td className="py-2.5 text-right text-text-secondary font-mono text-xs">{formatTokens(s.cache_read_tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── Activity Heatmap Section ─────────────────────── */

function ActivityHeatmapSection() {
  const { data, isLoading, error } = useQuery<ActivityResponse>({
    queryKey: ['analytics-activity'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/activity', { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Failed to load activity data')
      return res.json()
    },
  })

  if (isLoading) return <div className="text-text-tertiary text-sm py-8">Loading activity data…</div>
  if (error) return <div className="text-semantic-error text-sm py-8">Error loading activity data</div>
  if (!data) return null

  // Build lookup: {day_hour: count}
  const lookup: Record<string, number> = {}
  let maxCount = 0
  for (const entry of data.heatmap) {
    const key = `${entry.day}_${entry.hour}`
    lookup[key] = entry.count
    if (entry.count > maxCount) maxCount = entry.count
  }

  const [hoveredCell, setHoveredCell] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-surface/40 p-5">
          <p className="text-caption text-text-tertiary uppercase tracking-wider mb-1">Peak Hour</p>
          <p className="text-h3 font-bold text-accent tabular-nums">
            {data.peak_hour !== null ? `${data.peak_hour}:00 BRT` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface/40 p-5">
          <p className="text-caption text-text-tertiary uppercase tracking-wider mb-1">Peak Day</p>
          <p className="text-h3 font-bold text-purple-400 tabular-nums">{data.peak_day || '—'}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface/40 p-5">
          <p className="text-caption text-text-tertiary uppercase tracking-wider mb-1">Total Sessions</p>
          <p className="text-h3 font-bold text-text-primary tabular-nums">{data.total_sessions}</p>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="rounded-xl border border-border bg-surface/40 p-5 overflow-x-auto">
        <h3 className="text-h5 font-semibold text-text-primary mb-4">Activity Heatmap (BRT)</h3>
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
              <div className="w-12 shrink-0 text-xs text-text-secondary font-medium pr-2 text-right">{day}</div>
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
                        {day} {h}:00 — {count} sessions
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {/* Legend */}
          <div className="flex items-center justify-end gap-2 mt-3 text-xs text-text-tertiary">
            <span>Less</span>
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <div
                key={v}
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: v === 0 ? 'rgba(14,165,233,0.04)' : `rgba(14,165,233,${0.1 + v * 0.9})` }}
              />
            ))}
            <span>More</span>
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
      if (!res.ok) throw new Error('Failed to load hardware data')
      return res.json()
    },
    refetchInterval: 10_000,
  })

  if (isLoading) return <div className="text-text-tertiary text-sm py-8">Loading system stats…</div>
  if (error) return <div className="text-semantic-error text-sm py-8">Error loading system stats</div>
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* CPU */}
      <div className="rounded-xl border border-border bg-surface/40 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-h5 font-semibold text-text-primary">CPU</h3>
          <span className="text-text-secondary text-sm font-mono">{data.cpu.cores} cores</span>
        </div>
        <div className="mb-2">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-secondary">Usage</span>
            <span className="text-text-primary font-mono">{data.cpu.percent}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-bg-base overflow-hidden">
            <div className={`h-full rounded-full transition-all ${percentColor(data.cpu.percent)}`} style={{ width: `${data.cpu.percent}%` }} />
          </div>
        </div>
        <div className="flex gap-4 text-sm mt-3">
          <div>
            <span className="text-text-tertiary">Load 1m: </span>
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
        <div className="rounded-xl border border-border bg-surface/40 p-5">
          <h3 className="text-h5 font-semibold text-text-primary mb-3">RAM</h3>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-secondary">{formatBytes(data.ram.used)} / {formatBytes(data.ram.total)}</span>
            <span className="text-text-primary font-mono">{data.ram.percent}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-bg-base overflow-hidden mb-2">
            <div className={`h-full rounded-full transition-all ${percentColor(data.ram.percent)}`} style={{ width: `${data.ram.percent}%` }} />
          </div>
          <p className="text-xs text-text-tertiary">Free: {formatBytes(data.ram.free)}</p>
        </div>

        {/* Disk */}
        <div className="rounded-xl border border-border bg-surface/40 p-5">
          <h3 className="text-h5 font-semibold text-text-primary mb-3">Disk</h3>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-secondary">{formatBytes(data.disk.used)} / {formatBytes(data.disk.total)}</span>
            <span className="text-text-primary font-mono">{data.disk.percent}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-bg-base overflow-hidden mb-2">
            <div className={`h-full rounded-full transition-all ${percentColor(data.disk.percent)}`} style={{ width: `${data.disk.percent}%` }} />
          </div>
          <p className="text-xs text-text-tertiary">Free: {formatBytes(data.disk.free)}</p>
        </div>
      </div>

      {/* Uptime */}
      <div className="rounded-xl border border-border bg-surface/40 p-5">
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
    <div className="min-h-screen bg-bg-base text-text-secondary">
      <NavBar />
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-10">
        <h1 className="text-display font-bold text-text-primary">Analytics</h1>

        {/* Token Usage */}
        <section>
          <h2 className="text-h3 font-semibold text-text-primary mb-4">Token Usage</h2>
          <TokenUsageSection />
        </section>

        {/* Activity Heatmap */}
        <section>
          <h2 className="text-h3 font-semibold text-text-primary mb-4">Activity Heatmap</h2>
          <ActivityHeatmapSection />
        </section>

        {/* Hardware */}
        <section>
          <h2 className="text-h3 font-semibold text-text-primary mb-4">System Resources</h2>
          <HardwareSection />
        </section>
      </div>
    </div>
  )
}
