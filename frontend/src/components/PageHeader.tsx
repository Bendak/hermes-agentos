import type { ReactNode } from 'react'

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1440px] px-5 py-6 lg:px-8 lg:py-8">{children}</div>
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-overline font-medium uppercase tracking-[0.14em] text-text-tertiary">{eyebrow}</p>
        )}
        <h1 className="mt-2 text-h1 font-semibold tracking-tight text-text-primary">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-body text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
