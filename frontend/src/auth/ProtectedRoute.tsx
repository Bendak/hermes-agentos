import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="text-text-secondary">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
