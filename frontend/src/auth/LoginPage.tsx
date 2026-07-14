import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isFirstRun, setIsFirstRun] = useState(false)
  const [checkingFirstRun, setCheckingFirstRun] = useState(true)
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, navigate])

  useEffect(() => {
    const checkFirstRun = async () => {
      try {
        const res = await fetch('/api/auth/check')
        const data = await res.json()
        setIsFirstRun(!data.users_exist)
      } catch {
        // Assume not first run on error
      }
      setCheckingFirstRun(false)
    }
    checkFirstRun()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isFirstRun) {
        // Create first admin user
        const res = await fetch('/api/auth/register-first', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Registration failed' }))
          throw new Error(err.detail || 'Registration failed')
        }
        const data = await res.json()
        // Store tokens and user directly
        localStorage.setItem('agentos_access_token', data.access_token)
        localStorage.setItem('agentos_refresh_token', data.refresh_token)
        localStorage.setItem('agentos_user', JSON.stringify(data.user))
        // Force page reload to pick up auth state
        window.location.href = '/'
      } else {
        await login(username, password)
        navigate('/', { replace: true })
      }
    } catch (err: any) {
      setError(err.message || 'Login failed')
    }
    setLoading(false)
  }

  if (checkingFirstRun) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="text-text-secondary">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-surface/40 p-8 shadow-lg">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🤖</div>
            <h1 className="text-2xl font-bold text-text-primary">AgentOS</h1>
            <p className="text-sm text-text-tertiary mt-1">
              {isFirstRun ? 'Create your admin account' : 'Sign in to continue'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-text-secondary mb-1.5">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg-base text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
                placeholder="Enter username"
                autoFocus
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg-base text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
                placeholder="Enter password"
                required
                autoComplete={isFirstRun ? 'new-password' : 'current-password'}
              />
            </div>

            {error && (
              <div className="text-sm text-error bg-error-subtle rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-2.5 px-4 rounded-lg bg-accent text-white font-medium text-sm hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? (isFirstRun ? 'Creating account...' : 'Signing in...')
                : (isFirstRun ? 'Create Admin Account' : 'Sign In')
              }
            </button>
          </form>

          {isFirstRun && (
            <p className="text-xs text-text-tertiary text-center mt-4">
              This is your first time. Create an admin account to get started.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
