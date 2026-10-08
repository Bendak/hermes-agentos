// WI-8 batch 2 (F-WI2-UI-04): toast amigável — substitui JSON cru nos modais
// e dá feedback onde "Save não fazia nada". Auto-dismiss 5s (F-M9-15).
import { createContext, useCallback, useContext, useState, ReactNode } from 'react'

type ToastKind = 'error' | 'success' | 'info'
interface Toast { id: number; kind: ToastKind; message: string }

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => {
      // M29-01: erro persistente sem teto virava pilha infinita — dedupe
      // por mensagem e cap de 5 (descarta os mais antigos)
      const withoutDup = t.filter(x => !(x.message === message && x.kind === kind))
      return [...withoutDup, { id, kind, message }].slice(-5)
    })
    // M28-05: erro persiste até clique (5s era pouco p/ detalhe longo);
    // não-erros somem em 5s
    if (kind !== 'error') {
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
    }
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[120] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border px-4 py-2.5 text-sm shadow-lg backdrop-blur-md cursor-pointer ${
              t.kind === 'error'
                ? 'bg-semantic-error/15 border-semantic-error/30 text-semantic-error'
                : t.kind === 'success'
                  ? 'bg-semantic-success/15 border-semantic-success/30 text-semantic-success'
                  : 'bg-bg-elevated/95 border-border text-text-primary'
            }`}
            onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
