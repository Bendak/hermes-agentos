import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface User {
  id: number
  username: string
  role: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  refreshToken: () => Promise<string | null>
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'agentos_access_token'
const REFRESH_KEY = 'agentos_refresh_token'
const USER_KEY = 'agentos_user'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(USER_KEY)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [isLoading, setIsLoading] = useState(true)

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
    setUser(null)
    setToken(null)
  }, [])

  const doRefresh = useCallback(async (): Promise<string | null> => {
    const refreshTok = localStorage.getItem(REFRESH_KEY)
    if (!refreshTok) return null
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshTok }),
      })
      if (!res.ok) {
        clearAuth()
        return null
      }
      const data = await res.json()
      localStorage.setItem(TOKEN_KEY, data.access_token)
      setToken(data.access_token)
      return data.access_token
    } catch {
      clearAuth()
      return null
    }
  }, [clearAuth])

  // Validate token on mount
  useEffect(() => {
    const validate = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY)
      if (!storedToken) {
        setIsLoading(false)
        return
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${storedToken}` },
        })
        if (res.ok) {
          const data = await res.json()
          setUser(data.user)
          setToken(storedToken)
        } else {
          const refreshed = await doRefresh()
          if (!refreshed) {
            clearAuth()
          }
        }
      } catch {
        clearAuth()
      }
      setIsLoading(false)
    }
    validate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Global fetch interceptor: add auth header to /api/ calls
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      // Only intercept /api/ calls (not auth endpoints)
      if (url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
        const currentToken = localStorage.getItem(TOKEN_KEY)
        if (currentToken) {
          const headers = new Headers(init?.headers)
          headers.set('Authorization', `Bearer ${currentToken}`)
          init = { ...init, headers }
        }
      }
      let res = await originalFetch(input, init)
      // Auto-refresh on 401
      if (res.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
        const refreshTok = localStorage.getItem(REFRESH_KEY)
        if (refreshTok) {
          try {
            const refreshRes = await originalFetch('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refreshTok }),
            })
            if (refreshRes.ok) {
              const data = await refreshRes.json()
              localStorage.setItem(TOKEN_KEY, data.access_token)
              setToken(data.access_token)
              // Retry original request
              const headers = new Headers(init?.headers)
              headers.set('Authorization', `Bearer ${data.access_token}`)
              res = await originalFetch(input, { ...init, headers })
            } else {
              clearAuth()
            }
          } catch {
            clearAuth()
          }
        }
      }
      return res
    }
    return () => { window.fetch = originalFetch }
  }, [clearAuth])

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }))
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    setToken(data.access_token)
    setUser(data.user)
  }, [])

  const logout = useCallback(() => {
    clearAuth()
  }, [clearAuth])

  const refreshToken = useCallback(async () => {
    return doRefresh()
  }, [doRefresh])

  const authFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const currentToken = localStorage.getItem(TOKEN_KEY)
    const headers = new Headers(options.headers)
    if (currentToken) {
      headers.set('Authorization', `Bearer ${currentToken}`)
    }

    let res = await fetch(url, { ...options, headers })

    if (res.status === 401 && localStorage.getItem(REFRESH_KEY)) {
      const newToken = await doRefresh()
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`)
        res = await fetch(url, { ...options, headers })
      }
    }

    return res
  }, [doRefresh])

  const value = useMemo(() => ({
    user,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    login,
    logout,
    refreshToken,
    authFetch,
  }), [user, token, isLoading, login, logout, refreshToken, authFetch])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
