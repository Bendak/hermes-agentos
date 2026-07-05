import { useEffect, useState } from 'react'
import { Routes, Route, Link } from 'react-router-dom'

function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <h1 className="text-5xl font-bold mb-4">AgentOS</h1>
      <p className="text-xl mb-8 opacity-80">Control plane for Hermes Agent</p>
      <button className="px-6 py-2 rounded-lg bg-[var(--accent)] text-white font-semibold hover:opacity-90 transition">
        Login
      </button>
      <div className="mt-8">
        <Link to="/health" className="text-[var(--accent)] underline">
          Check Health →
        </Link>
      </div>
    </div>
  )
}

function HealthPage() {
  const [data, setData] = useState<{ status: string; version: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <h1 className="text-3xl font-bold mb-6">Health Status</h1>
      {error && <p className="text-red-400">Error: {error}</p>}
      {data ? (
        <pre className="bg-[var(--surface)] p-4 rounded-lg">
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : (
        <p>Loading…</p>
      )}
      <div className="mt-8">
        <Link to="/" className="text-[var(--accent)] underline">
          ← Back
        </Link>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/health" element={<HealthPage />} />
    </Routes>
  )
}
