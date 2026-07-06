/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        'bg-base': 'var(--bg-base)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-overlay': 'var(--bg-overlay)',

        // Surfaces
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        'surface-active': 'var(--surface-active)',

        // Borders
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',

        // Text
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-inverse': 'var(--text-inverse)',

        // Accents
        accent: 'var(--accent-primary)',
        'accent-hover': 'var(--accent-primary-hover)',
        'accent-subtle': 'var(--accent-primary-subtle)',
        'accent-secondary': 'var(--accent-secondary)',
        'accent-secondary-hover': 'var(--accent-secondary-hover)',
        'accent-secondary-subtle': 'var(--accent-secondary-subtle)',
        'accent-tertiary': 'var(--accent-tertiary)',

        // Semantic
        success: 'var(--semantic-success)',
        'success-subtle': 'var(--semantic-success-subtle)',
        warning: 'var(--semantic-warning)',
        'warning-subtle': 'var(--semantic-warning-subtle)',
        error: 'var(--semantic-error)',
        'error-subtle': 'var(--semantic-error-subtle)',
        info: 'var(--semantic-info)',
        'info-subtle': 'var(--semantic-info-subtle)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        // Display
        display: ['2.25rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        // Headings
        h1: ['1.875rem', { lineHeight: '1.2', letterSpacing: '-0.015em' }],
        h2: ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        h3: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.005em' }],
        h4: ['1.125rem', { lineHeight: '1.35', letterSpacing: '0em' }],
        h5: ['1rem', { lineHeight: '1.4', letterSpacing: '0em' }],
        h6: ['0.875rem', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        // Body
        body: ['0.875rem', { lineHeight: '1.6', letterSpacing: '0em' }],
        'body-sm': ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0em' }],
        caption: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.01em' }],
        overline: ['0.6875rem', { lineHeight: '1.2', letterSpacing: '0.08em' }],
        // Mono
        mono: ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0em' }],
        'mono-sm': ['0.75rem', { lineHeight: '1.4', letterSpacing: '0em' }],
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0, 0, 0, 0.25)',
        md: '0 4px 12px rgba(0, 0, 0, 0.35)',
        lg: '0 8px 24px rgba(0, 0, 0, 0.45)',
        glow: '0 0 20px rgba(0, 229, 185, 0.12)',
        'glow-secondary': '0 0 16px rgba(245, 184, 0, 0.10)',
        inner: 'inset 0 1px 2px rgba(0, 0, 0, 0.30)',
      },
      transitionTimingFunction: {
        'agent-os': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'agent-os-bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
    },
  },
  plugins: [],
}
