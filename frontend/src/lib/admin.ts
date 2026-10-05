// WI-2: viewer-role UI guard. Server enforces require_admin on mutations;
// this hides the primary mutation affordances for non-admin sessions.
export function isAdmin(): boolean {
  try {
    const raw = localStorage.getItem('agentos_user')
    if (!raw) return true // pre-auth render (login page) — keep default visible
    return JSON.parse(raw).role === 'admin'
  } catch {
    return true
  }
}
