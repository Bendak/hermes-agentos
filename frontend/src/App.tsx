import { useEffect, useState } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 5000,
      retry: 2,
    },
  },
})

interface AgentProfile {
  id: string
  name: string
  model: string
  provider: string
  role: string
  gateway_state: string
  pid: number | null
  process_alive: boolean
  sessions: number
}

function AgentCard({ agent }: { agent: AgentProfile }) {
  const isRunning = agent.process_alive && agent.gateway_state === 'running'
  return (
    <div className="rounded-xl border border-[var(--surface)] bg-[var(--surface)]/40 p-5 transition hover:bg-[var(--surface)]/70 hover:shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: isRunning ? '#22c55e' : '#6b7280' }}
          title={isRunning ? 'Em execução' : 'Parado'}
        />
      </div>
      <p className="text-sm text-[var(--text)] opacity-80 mb-4">{agent.role}</p>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center rounded-md bg-[var(--bg)] px-2 py-1 text-xs font-mono text-[var(--accent)] border border-[var(--surface)]">
          {agent.model}
        </span>
        <span className="inline-flex items-center rounded-md bg-[var(--bg)] px-2 py-1 text-xs font-mono text-[var(--text)] opacity-70 border border-[var(--surface)]">
          {agent.provider}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--text)] opacity-60">
        <span className="font-mono">PID: {agent.pid ?? '-'}</span>
        <span>Sessões: {agent.sessions}</span>
      </div>
    </div>
  )
}

function DashboardPage() {
  const { data, isLoading, error } = useQuery<AgentProfile[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetch('/api/agents')
      if (!res.ok) throw new Error('Falha ao carregar agentes')
      return res.json()
    },
  })

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--surface)] px-6 py-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold text-white">AgentOS</h1>
          <p className="mt-1 text-sm opacity-70">Control plane for Hermes Agent</p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <p className="opacity-70">Carregando agentes…</p>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Erro: {(error as Error).message}
          </div>
        )}
        {data && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {data.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}

        <div className="mt-8">
          <Link to="/health" className="text-[var(--accent)] underline text-sm">
            Verificar saúde do sistema →
          </Link>
        </div>
      </main>
    </div>
  )
}

function HealthPage() {
  const [healthData, setHealthData] = useState<{ status: string; version: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then(setHealthData)
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <h1 className="text-3xl font-bold mb-6">Estado do Sistema</h1>
      {error && <p className="text-red-400">Erro: {error}</p>}
      {healthData ? (
        <pre className="bg-[var(--surface)] p-4 rounded-lg">
          {JSON.stringify(healthData, null, 2)}
        </pre>
      ) : (
        <p>Carregando…</p>
      )}
      <div className="mt-8">
        <Link to="/" className="text-[var(--accent)] underline">
          ← Voltar ao painel
        </Link>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/health" element={<HealthPage />} />
      </Routes>
    </QueryClientProvider>
  )
}
