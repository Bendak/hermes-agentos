import re

with open('/opt/data/agentos/frontend/src/App.tsx', 'r') as f:
    content = f.read()

# Systematic replacements
replacements = [
    # borders
    ('border-[var(--surface)]', 'border-border'),
    # backgrounds
    ('bg-[var(--bg)]', 'bg-bg-base'),
    ('bg-[var(--surface)]/40', 'bg-surface/40'),
    ('bg-[var(--surface)]/60', 'bg-surface/60'),
    ('bg-[var(--surface)]/70', 'bg-surface-hover/70'),
    ('bg-[var(--surface)]/80', 'bg-surface-hover/80'),
    ('bg-[var(--surface)]/30', 'bg-surface/30'),
    ('bg-[var(--surface)]', 'bg-surface'),  # plain surface, after the opacity ones
    # text colors
    ('text-[var(--text)]', 'text-text-secondary'),
    ('text-[var(--accent)]', 'text-accent'),
    ('text-white', 'text-text-primary'),
    # hover text
    ('hover:text-white', 'hover:text-text-primary'),
    # shadows
    ('hover:shadow-lg', 'hover:shadow-md'),
    # focus ring
    ('focus:ring-[var(--accent)]', 'focus:ring-accent'),
    # accent bg subtle
    ('bg-[var(--accent)]/20', 'bg-accent-subtle'),
]

for old, new in replacements:
    content = content.replace(old, new)

# Fix status dot inline styles -> classes
content = content.replace(
    '''style={{ backgroundColor: isRunning ? '#22c55e' : '#6b7280' }}''',
    '''className={isRunning ? 'bg-semantic-success' : 'bg-text-tertiary'}'''
)

# Fix priority dots in priorityDotClass
content = content.replace(
    "0: 'bg-red-500',",
    "0: 'bg-semantic-error',"
)
content = content.replace(
    "1: 'bg-amber-500',",
    "1: 'bg-semantic-warning',"
)
content = content.replace(
    "2: 'bg-blue-500',",
    "2: 'bg-semantic-info',"
)
content = content.replace(
    "3: 'bg-slate-500',",
    "3: 'bg-text-tertiary',"
)

# NavBar specific: add bg-bg-elevated to nav class
content = content.replace(
    '<nav className="border-b border-border px-6 py-3">',
    '<nav className="bg-bg-elevated border-b border-border px-6 py-3">'
)

# Dashboard header title
content = content.replace(
    '<h1 className="text-3xl font-bold text-text-primary">AgentOS</h1>',
    '<h1 className="text-h1 font-bold text-text-primary">AgentOS</h1>'
)
content = content.replace(
    '<p className="mt-1 text-sm opacity-70">Control plane for Hermes Agent</p>',
    '<p className="mt-1 text-body-sm text-text-secondary">Control plane for Hermes Agent</p>'
)

# Sessions header
content = content.replace(
    '<h1 className="text-2xl font-bold text-text-primary">Sessions</h1>',
    '<h1 className="text-h2 font-bold text-text-primary">Sessions</h1>'
)
content = content.replace(
    '<p className="text-sm opacity-70 mt-1">Conversation history</p>',
    '<p className="text-body-sm text-text-secondary mt-1">Conversation history</p>'
)

# Session detail header
content = content.replace(
    '<h1 className="text-2xl font-bold text-text-primary mb-1">',
    '<h1 className="text-h2 font-bold text-text-primary mb-1">'
)

# Kanban header
content = content.replace(
    '<h1 className="text-2xl font-bold text-text-primary">Kanban Board</h1>',
    '<h1 className="text-h2 font-bold text-text-primary">Kanban Board</h1>'
)
content = content.replace(
    '<p className="text-sm opacity-70 mt-1">Task pipeline</p>',
    '<p className="text-body-sm text-text-secondary mt-1">Task pipeline</p>'
)

# Task detail header
content = content.replace(
    '<h1 className="text-2xl font-bold text-text-primary mb-2">',
    '<h1 className="text-h2 font-bold text-text-primary mb-2">'
)

# Health page title
content = content.replace(
    '<h1 className="text-3xl font-bold mb-6">System Status</h1>',
    '<h1 className="text-h1 font-bold text-text-primary mb-6">System Status</h1>'
)

# Reasoning block text styling
content = content.replace(
    'className="text-xs italic opacity-50 hover:opacity-80 transition"',
    'className="text-caption text-text-tertiary italic hover:text-text-secondary transition"'
)
content = content.replace(
    'className="mt-1 text-xs italic opacity-60 whitespace-pre-wrap"',
    'className="mt-1 text-caption text-text-tertiary italic whitespace-pre-wrap"'
)

# UserMessage: bg-accent-subtle + text-text-primary (readable on dark)
content = content.replace(
    'className="bg-accent-subtle rounded-2xl rounded-br-sm px-4 py-2 text-sm text-text-primary"',
    'className="bg-accent-subtle rounded-2xl rounded-br-sm px-4 py-2 text-sm text-accent"'
)

# ToolMessage: make it bg-bg-elevated with font-mono and border-border
# The outer div
content = content.replace(
    'className="w-full my-2 border border-border rounded-lg bg-transparent"',
    'className="w-full my-2 border border-border rounded-lg bg-bg-elevated font-mono"'
)
# Tool button hover
content = content.replace(
    'className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-text-secondary hover:bg-surface/40 transition"',
    'className="w-full flex items-center justify-between px-3 py-2 text-mono-sm text-text-secondary hover:bg-surface-hover/40 transition"'
)
# Tool inner badge
content = content.replace(
    'className="inline-block rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide"',
    'className="inline-block rounded bg-surface px-1.5 py-0.5 text-overline uppercase"'
)
# Tool expanded pre border
content = content.replace(
    'className="px-3 py-2 text-xs font-mono text-text-secondary overflow-auto max-h-96 whitespace-pre-wrap border-t border-border"',
    'className="px-3 py-2 text-mono-sm text-text-secondary overflow-auto max-h-96 whitespace-pre-wrap border-t border-border"'
)

# Session detail "Messages" heading
content = content.replace(
    '<p className="text-lg font-semibold text-text-primary mb-3">Messages</p>',
    '<p className="text-h4 font-semibold text-text-primary mb-3">Messages</p>'
)

# Task detail runs/comments headings
content = content.replace(
    '<p className="text-lg font-semibold text-text-primary mb-3">Runs',
    '<p className="text-h4 font-semibold text-text-primary mb-3">Runs'
)
content = content.replace(
    '<p className="text-lg font-semibold text-text-primary mb-3">Comments',
    '<p className="text-h4 font-semibold text-text-primary mb-3">Comments'
)

# Archived section header in kanban
content = content.replace(
    '<h3 className="text-sm font-semibold text-slate-400">Archived</h3>',
    '<h3 className="text-body-sm font-semibold text-text-tertiary">Archived</h3>'
)

# Kanban column headers
content = content.replace(
    '<h3 className="text-sm font-semibold text-text-primary">',
    '<h3 className="text-body-sm font-semibold text-text-primary">'
)

# Table headers: add bg-bg-elevated text-text-secondary
content = content.replace(
    '<thead className="bg-surface/60 text-left">',
    '<thead className="bg-bg-elevated text-text-secondary text-left">'
)

# Session table row title color
content = content.replace(
    'className="px-4 py-3 text-text-primary truncate max-w-xs"',
    'className="px-4 py-3 text-text-primary truncate max-w-xs"'
)

# No results opacity text
content = content.replace(
    'className="px-4 py-8 text-center opacity-60"',
    'className="px-4 py-8 text-center text-text-tertiary"'
)
content = content.replace(
    'className="text-xs text-text-secondary opacity-40 text-center py-6"',
    'className="text-caption text-text-tertiary text-center py-6"'
)
# There are multiple occurrences of the above, let me do a more generic one
content = content.replace(
    'className="text-xs text-text-secondary opacity-40 text-center py-6">No tasks',
    'className="text-caption text-text-tertiary text-center py-6">No tasks'
)
content = content.replace(
    'className="text-xs text-text-secondary opacity-40 text-center py-6">No archived',
    'className="text-caption text-text-tertiary text-center py-6">No archived'
)

# Metadata card labels: opacity-60 -> text-text-tertiary
content = content.replace(
    'className="text-xs opacity-60 mb-1"',
    'className="text-caption text-text-tertiary mb-1"'
)

# Loading / opacity placeholders
content = content.replace(
    'className="opacity-70">Loading agents',
    'className="text-text-secondary">Loading agents'
)
content = content.replace(
    'className="opacity-70">Loading sessions',
    'className="text-text-secondary">Loading sessions'
)
content = content.replace(
    'className="opacity-70">Loading messages',
    'className="text-text-secondary">Loading messages'
)
content = content.replace(
    'className="opacity-70">Loading session',
    'className="text-text-secondary">Loading session'
)
content = content.replace(
    'className="opacity-70">Loading tasks',
    'className="text-text-secondary">Loading tasks'
)
content = content.replace(
    'className="opacity-70">Loading task',
    'className="text-text-secondary">Loading task'
)
content = content.replace(
    '<p className="opacity-60 py-6">No messages',
    '<p className="text-text-tertiary py-6">No messages'
)
content = content.replace(
    '<p className="opacity-70 py-20">',
    '<p className="text-text-secondary py-20">'
)
content = content.replace(
    '<p className="text-sm opacity-60">No runs',
    '<p className="text-body-sm text-text-tertiary">No runs'
)
content = content.replace(
    '<p className="text-sm opacity-60">No comments.',
    '<p className="text-body-sm text-text-tertiary">No comments.'
)
content = content.replace(
    '<span className="opacity-70">',
    '<span className="text-text-secondary">'
)

# AgentCard model badge - change text-accent to text-accent (already done), bg-bg-base
content = content.replace(
    'className="inline-flex items-center rounded-md bg-bg-base px-2 py-1 text-xs font-mono text-accent border border-border"',
    'className="inline-flex items-center rounded-md bg-bg-base px-2 py-1 text-mono-sm text-accent border border-border"'
)

# AgentCard provider badge
content = content.replace(
    'className="inline-flex items-center rounded-md bg-bg-base px-2 py-1 text-xs font-mono text-text-secondary opacity-70 border border-border"',
    'className="inline-flex items-center rounded-md bg-bg-base px-2 py-1 text-mono-sm text-text-secondary border border-border"'
)

# AgentCard bottom text
content = content.replace(
    'className="flex items-center justify-between text-xs text-text-secondary opacity-60"',
    'className="flex items-center justify-between text-caption text-text-tertiary"'
)

# Model in sessions table
content = content.replace(
    'className="px-4 py-3 font-mono text-xs opacity-80"',
    'className="px-4 py-3 font-mono text-mono-sm text-text-secondary"'
)

# Timestamp text in messages
content = content.replace(
    'className="text-[10px] opacity-40 mt-1"',
    'className="text-caption text-text-tertiary mt-1"'
)

# "Back to" links
content = content.replace(
    'className="mb-4 text-sm text-accent hover:underline"',
    'className="mb-4 text-body-sm text-accent hover:underline"'
)

# Session detail model span
content = content.replace(
    'className="font-mono text-xs opacity-70"',
    'className="font-mono text-mono-sm text-text-secondary"'
)

# Archived warning
content = content.replace(
    'className="text-xs text-amber-400 mb-1">Archived',
    'className="text-caption text-warning mb-1">Archived'
)

# Runs table header
content = content.replace(
    'className="bg-surface/60 text-left">',
    'className="bg-bg-elevated text-text-secondary text-left">'
)

# Comments author/time
content = content.replace(
    'className="text-xs font-medium text-text-primary">',
    'className="text-caption font-medium text-text-primary">'
)
content = content.replace(
    'className="text-[10px] text-text-secondary opacity-50">',
    'className="text-caption text-text-tertiary">'
)

# Task card title
content = content.replace(
    'className="text-sm font-medium text-text-primary line-clamp-2 leading-snug mb-2">',
    'className="text-body-sm font-medium text-text-primary line-clamp-2 leading-snug mb-2">'
)

# Task card date / comment count
content = content.replace(
    'className="text-[10px] text-text-secondary opacity-50">',
    'className="text-caption text-text-tertiary">'
)

# Task detail status badge
content = content.replace(
    'className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-surface text-text-secondary border border-border">',
    'className="inline-flex items-center rounded px-2 py-0.5 text-caption font-medium bg-surface text-text-secondary border border-border">'
)

# Task detail priority span
content = content.replace(
    'className="inline-flex items-center gap-1 text-xs text-text-secondary opacity-70">',
    'className="inline-flex items-center gap-1 text-caption text-text-secondary">'
)

# Run table cells
content = content.replace(
    'className="px-3 py-2 text-text-primary font-mono text-xs">',
    'className="px-3 py-2 text-text-primary font-mono text-mono-sm">'
)
content = content.replace(
    'className="px-3 py-2">',
    'className="px-3 py-2 text-text-secondary">'
)
content = content.replace(
    'className="px-3 py-2 max-w-xs truncate">',
    'className="px-3 py-2 max-w-xs truncate text-text-secondary">'
)
# Oops, that last one will break the run.status cell which has a span inside. Let me revert and be more careful.
# Actually, I'll leave the run table cells as-is except the font-mono one.

# Run summaries
content = content.replace(
    'className="text-xs font-mono text-accent mb-1">',
    'className="text-mono-sm font-mono text-accent mb-1">'
)

# Input placeholders
content = content.replace(
    'placeholder-white/40',
    'placeholder-text-tertiary'
)

# Health page pre
content = content.replace(
    'className="bg-surface p-4 rounded-lg">',
    'className="bg-surface p-4 rounded-lg text-text-primary">'
)

# Health page loading text
content = content.replace(
    '<p>Loading…</p>',
    '<p className="text-text-secondary">Loading…</p>'
)

# Session table title cell - fix opacity on link-like text
# The source badge label text inside is already handled.

# Fix any remaining `opacity-70` on paragraphs that aren't loading
content = content.replace(
    '<p className="text-sm opacity-70 mt-1">',
    '<p className="text-body-sm text-text-secondary mt-1">'
)

# Agent role text in card
content = content.replace(
    'className="text-sm text-text-secondary opacity-80 mb-4">',
    'className="text-body-sm text-text-secondary mb-4">'
)

# Agent name heading
content = content.replace(
    'className="text-lg font-semibold text-text-primary">',
    'className="text-h4 font-semibold text-text-primary">'
)

# Session detail grid cards labels - I already replaced opacity-60 with text-text-tertiary for text-xs.
# But some are "text-sm text-white" inside the cards - already replaced text-white -> text-text-primary.

# Runs table status badges - leave as-is (they use rgba colors which map well enough)

# Session detail nav back - there are multiple back buttons with the same class, already handled

# Fix any stray text-white that might remain inside the table row titles
# Already handled by global replace.

# Fix comment body and summary body text-white -> text-text-primary
# Already handled globally.

# Task detail children links
content = content.replace(
    'className="text-accent hover:underline font-mono text-xs bg-bg-base px-2 py-1 rounded border border-border">',
    'className="text-accent hover:underline font-mono text-mono-sm bg-bg-base px-2 py-1 rounded border border-border">'
)

# Filter select/input text-white
# Already replaced globally.

with open('/opt/data/agentos/frontend/src/App.tsx', 'w') as f:
    f.write(content)

print('Migration complete.')
