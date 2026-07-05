# AgentOS Visual Identity Specification

**Version:** 1.0  
**Date:** 2026-07-05  
**Theme:** Dark-primary (light theme defined as optional)  
**Target:** FastAPI + Vite React + Tailwind CSS

---

## 1. Logo Concept

### 1.1 Logo Direction: "Winged Glyph" (Recommended)

A combination mark merging a stylized **winged glyph** (abstracted Hermes sandal wing + a forward slash representing speed/messenger) with the wordmark **AgentOS**.

- **Icon:** Two overlapping, slightly curved strokes suggesting motion — one stroke is the primary accent color (electric teal), the second is a lighter tint. The negative space between them forms an implied forward slash or paper-airplane silhouette. At small sizes it reads as a fast, sharp chevron.
- **Wordmark:** "AgentOS" in a geometric sans-serif (Inter or similar). The "OS" is set in a slightly lighter weight (400) than "Agent" (600) to create visual rhythm and signal "Operating System".
- **Tagline lockup:** "Control plane for Hermes Agent" — set in monospace at 12px, primary text color at 60% opacity, placed below the wordmark on full-page layouts.

### 1.2 Logo Direction: "Caduceus Circuit" (Alternative)

An icon-only mark for users who prefer a literal mythological reference.

- **Icon:** A minimal caduceus re-interpreted as a circuit trace — two symmetrical winding lines (like the snakes) that terminate in small circles (nodes). A single horizontal bar at the top suggests a data bus or antenna. Rendered in the secondary gold accent against the dark background.
- **Wordmark:** Same as above.
- **Best for:** App icons, favicons, and contexts where users expect an AI/tech symbol. The circuit caduceus communicates "intelligent infrastructure."

### 1.3 Logo Direction: "Pure Wordmark" (Fallback)

For minimalist deployments where an icon is unnecessary.

- **Wordmark:** "AgentOS" with a small wing motif integrated into the letter "A" (the crossbar becomes a wing) or the "O" (a speed-ring halo).
- **Color:** Full wordmark in the primary accent (#00E5B9) or white, depending on background.
- **Best for:** Sidebar headers, narrow navbars, embedded widgets.

### 1.4 Logo Size & Usage

| Context | Size | Rendering |
|---|---|---|
| Favicon (`.ico` / `.png`) | 32×32, 180×180 (Apple touch) | Winged Glyph icon only. Solid fill, no gradients. |
| Sidebar / Mobile header | 24–32px height | Icon + "AgentOS" wordmark, compact spacing (8px gap). |
| Full page / Login / Marketing | 48–64px height | Icon above wordmark, 12px gap. Tagline optional below. |
| Loading spinner / watermark | 16–20px | Icon only, animated stroke-dashoffset on the wing shape. |

### 1.5 Logo Color Rules

- On dark backgrounds: icon and wordmark are **white (#FFFFFF)** or **primary accent (#00E5B9)**.
- On light backgrounds: icon and wordmark are **dark primary (#0B1120)**.
- Never place the full-color logo on a busy or photographic background without a subtle scrim or container.
- Minimum clear space: equal to the height of the letter "A" in "Agent" on all sides.

---

## 2. Color Palette

### 2.1 Philosophy

AgentOS is a **mission-control surface**. The palette must:
- Feel deep, focused, and premium (dark backgrounds reduce eye strain for long monitoring sessions).
- Use a vivid, fast-moving accent color (electric teal) to draw attention to active agents, live sessions, and primary actions.
- Use a warm secondary (gold/amber) sparingly for highlights, badges, and alerts — referencing the golden wings of Hermes.
- Maintain WCAG 2.1 AA contrast ratios for all text on surfaces.

### 2.2 Dark Theme (Primary)

| Token | Hex | RGB | Usage |
|---|---|---|---|
| `--bg-base` | `#0B1120` | `11, 17, 32` | Deepest background (app shell, page root) |
| `--bg-elevated` | `#0F172A` | `15, 23, 42` | Elevated panels, cards resting on base |
| `--bg-overlay` | `#131D33` | `19, 29, 51` | Popovers, modals, dropdowns |
| `--surface` | `#1A2744` | `26, 39, 68` | Card backgrounds, table rows, input fields |
| `--surface-hover` | `#233456` | `35, 52, 86` | Hover state for surface elements |
| `--surface-active` | `#2C3F68` | `44, 63, 104` | Active/selected surface state |
| `--border` | `#253656` | `37, 54, 86` | Subtle dividers, card borders, table lines |
| `--border-strong` | `#3A5175` | `58, 81, 117` | Focus rings, emphasized borders |
| `--text-primary` | `#F0F4FA` | `240, 244, 250` | Headings, primary body text |
| `--text-secondary` | `#94A3B8` | `148, 163, 184` | Labels, metadata, timestamps |
| `--text-tertiary` | `#64748B` | `100, 116, 139` | Placeholders, disabled text, captions |
| `--text-inverse` | `#0B1120` | `11, 17, 32` | Text on accent-colored buttons |
| `--accent-primary` | `#00E5B9` | `0, 229, 185` | Primary CTAs, active indicators, links |
| `--accent-primary-hover` | `#00FFC8` | `0, 255, 200` | Hover state for accent elements |
| `--accent-primary-subtle` | `#00E5B91A` | — | Accent backgrounds, badges, rings (10% opacity) |
| `--accent-secondary` | `#F5B800` | `245, 184, 0` | Warnings, secondary highlights, gold badges |
| `--accent-secondary-hover` | `#FFCC33` | `255, 204, 51` | Hover for secondary accent |
| `--accent-secondary-subtle` | `#F5B8001A` | — | Secondary accent backgrounds |
| `--accent-tertiary` | `#7C8CFF` | `124, 140, 255` | Tertiary info, special states, agent avatars |
| `--semantic-success` | `#22C55E` | `34, 197, 94` | Healthy agent, success toast |
| `--semantic-success-subtle` | `#22C55E1A` | — | Success background tint |
| `--semantic-warning` | `#F59E0B` | `245, 158, 11` | Degraded, caution toast |
| `--semantic-warning-subtle` | `#F59E0B1A` | — | Warning background tint |
| `--semantic-error` | `#EF4444` | `239, 68, 68` | Errors, unhealthy agent, toast |
| `--semantic-error-subtle` | `#EF44441A` | — | Error background tint |
| `--semantic-info` | `#38BDF8` | `56, 189, 248` | Info badges, tool call hints |
| `--semantic-info-subtle` | `#38BDF81A` | — | Info background tint |

### 2.3 Light Theme (Optional)

| Token | Hex | Usage |
|---|---|---|
| `--bg-base` | `#F8FAFC` | Page background |
| `--bg-elevated` | `#FFFFFF` | Cards, panels |
| `--bg-overlay` | `#FFFFFF` | Modals |
| `--surface` | `#F1F5F9` | Input backgrounds, table zebra stripes |
| `--surface-hover` | `#E2E8F0` | Hover |
| `--surface-active` | `#CBD5E1` | Active |
| `--border` | `#E2E8F0` | Borders |
| `--border-strong` | `#94A3B8` | Focus rings |
| `--text-primary` | `#0F172A` | Headings |
| `--text-secondary` | `#475569` | Body |
| `--text-tertiary` | `#94A3B8` | Captions |
| `--text-inverse` | `#FFFFFF` | Buttons |
| `--accent-primary` | `#059669` | Primary actions (darker for light readability) |
| `--accent-primary-hover` | `#047857` | Hover |
| `--accent-secondary` | `#D97706` | Secondary accent |
| `--accent-tertiary` | `#4F46E5` | Tertiary |
| `--semantic-*` | Same hexes | Semantic colors remain identical for consistency |

### 2.4 CSS Variable Definitions (`index.css`)

Drop the following into `frontend/src/index.css`, replacing the existing `:root` block.

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ── Fonts ─────────────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

/* ── Dark Theme (Default) ──────────────────────────── */
:root {
  /* Background Layers */
  --bg-base: #0B1120;
  --bg-elevated: #0F172A;
  --bg-overlay: #131D33;

  /* Surface Layers */
  --surface: #1A2744;
  --surface-hover: #233456;
  --surface-active: #2C3F68;

  /* Borders */
  --border: #253656;
  --border-strong: #3A5175;

  /* Text */
  --text-primary: #F0F4FA;
  --text-secondary: #94A3B8;
  --text-tertiary: #64748B;
  --text-inverse: #0B1120;

  /* Accents */
  --accent-primary: #00E5B9;
  --accent-primary-hover: #00FFC8;
  --accent-primary-subtle: rgba(0, 229, 185, 0.10);
  --accent-secondary: #F5B800;
  --accent-secondary-hover: #FFCC33;
  --accent-secondary-subtle: rgba(245, 184, 0, 0.10);
  --accent-tertiary: #7C8CFF;

  /* Semantic */
  --semantic-success: #22C55E;
  --semantic-success-subtle: rgba(34, 197, 94, 0.10);
  --semantic-warning: #F59E0B;
  --semantic-warning-subtle: rgba(245, 158, 11, 0.10);
  --semantic-error: #EF4444;
  --semantic-error-subtle: rgba(239, 68, 68, 0.10);
  --semantic-info: #38BDF8;
  --semantic-info-subtle: rgba(56, 189, 248, 0.10);
}

/* ── Light Theme (Optional Toggle) ───────────────── */
html.light {
  --bg-base: #F8FAFC;
  --bg-elevated: #FFFFFF;
  --bg-overlay: #FFFFFF;
  --surface: #F1F5F9;
  --surface-hover: #E2E8F0;
  --surface-active: #CBD5E1;
  --border: #E2E8F0;
  --border-strong: #94A3B8;
  --text-primary: #0F172A;
  --text-secondary: #475569;
  --text-tertiary: #94A3B8;
  --text-inverse: #FFFFFF;
  --accent-primary: #059669;
  --accent-primary-hover: #047857;
  --accent-primary-subtle: rgba(5, 150, 105, 0.10);
  --accent-secondary: #D97706;
  --accent-secondary-hover: #B45309;
  --accent-secondary-subtle: rgba(217, 119, 6, 0.10);
  --accent-tertiary: #4F46E5;
  --semantic-success: #22C55E;
  --semantic-success-subtle: rgba(34, 197, 94, 0.10);
  --semantic-warning: #F59E0B;
  --semantic-warning-subtle: rgba(245, 158, 11, 0.10);
  --semantic-error: #EF4444;
  --semantic-error-subtle: rgba(239, 68, 68, 0.10);
  --semantic-info: #38BDF8;
  --semantic-info-subtle: rgba(56, 189, 248, 0.10);
}

/* ── Base Styles ──────────────────────────────────── */
body {
  background-color: var(--bg-base);
  color: var(--text-primary);
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code, pre, kbd, .font-mono {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* Selection */
::selection {
  background-color: var(--accent-primary-subtle);
  color: var(--accent-primary);
}

/* Scrollbars (WebKit) */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--bg-base);
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}

/* Focus Ring (global) */
*:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

---

## 3. Typography

### 3.1 Font Stack

| Role | Font | Fallback |
|---|---|---|
| Primary (UI, headings, body) | **Inter** | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |
| Monospace (code, IDs, timestamps, metrics) | **JetBrains Mono** | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` |

Load via Google Fonts (see `index.css` above) or self-host for offline/air-gapped deployments.

### 3.2 Type Scale

All sizes are in `rem` (root font-size = 16px). Use Tailwind's `text-*` utilities mapped below.

| Token | Size | Line Height | Letter Spacing | Weight | Usage |
|---|---|---|---|---|---|
| `text-display` | 2.25rem (36px) | 1.1 | -0.02em | 700 | Page titles (Dashboard, Sessions) |
| `text-h1` | 1.875rem (30px) | 1.2 | -0.015em | 700 | Section headings |
| `text-h2` | 1.5rem (24px) | 1.25 | -0.01em | 600 | Card titles, modal headers |
| `text-h3` | 1.25rem (20px) | 1.3 | -0.005em | 600 | Sub-sections, form group labels |
| `text-h4` | 1.125rem (18px) | 1.35 | 0em | 600 | Sidebar nav active, emphasis |
| `text-h5` | 1rem (16px) | 1.4 | 0em | 500 | Labels, small headings |
| `text-h6` | 0.875rem (14px) | 1.4 | 0.01em | 500 | Badge text, uppercase labels |
| `text-body` | 0.875rem (14px) | 1.6 | 0em | 400 | Body copy, table cells, descriptions |
| `text-body-sm` | 0.8125rem (13px) | 1.5 | 0em | 400 | Dense UI, secondary descriptions |
| `text-caption` | 0.75rem (12px) | 1.4 | 0.01em | 400 | Timestamps, metadata, footnotes |
| `text-overline` | 0.6875rem (11px) | 1.2 | 0.08em | 500 | Uppercase section labels, status overlines |
| `text-mono` | 0.8125rem (13px) | 1.5 | 0em | 400 | Code blocks, entity IDs, model names |
| `text-mono-sm` | 0.75rem (12px) | 1.4 | 0em | 400 | Inline code, compact metrics |

### 3.3 Weights

| Weight | Value | Usage |
|---|---|---|
| Light | 300 | Large display numbers, hero stats (optional) |
| Regular | 400 | Body, captions, secondary text |
| Medium | 500 | Buttons, labels, nav items, small headings |
| SemiBold | 600 | Card titles, h2-h4, table headers |
| Bold | 700 | Page titles, h1, active nav, brand wordmark |

### 3.4 Monospace Rules

- Always use JetBrains Mono for any machine-generated string: session IDs, PIDs, model names, tool names, JSON dumps, timestamps in technical contexts.
- Monospace text should be rendered at 0.8125rem (13px) minimum for readability.
- Use `--text-secondary` color for monospace metadata to visually de-prioritize it against human-readable content.

---

## 4. Component Styling Guide

### 4.1 Cards

#### Agent Card (Dashboard)

```
Container:
  background: var(--surface)
  border: 1px solid var(--border)
  border-radius: 12px
  padding: 20px
  transition: all 150ms ease-out

Hover:
  background: var(--surface-hover)
  border-color: var(--border-strong)
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25)
  transform: translateY(-1px)

Active/Selected:
  border-color: var(--accent-primary)
  box-shadow: 0 0 0 1px var(--accent-primary), 0 4px 12px rgba(0, 229, 185, 0.08)

Internal Layout:
  - Header row: agent name (h3, white) + status dot (12px circle)
  - Role description: text-body-sm, text-secondary
  - Model/provider badges: inline-flex, surface-active bg, border radius 6px, text-mono-sm
  - Footer row: PID (text-mono-sm, text-tertiary) + session count (text-caption, text-secondary)
```

**Tailwind approximation:**

```tsx
<div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-all duration-150 ease-out hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] hover:shadow-lg hover:-translate-y-0.5 active:border-[var(--accent-primary)] active:shadow-[0_0_0_1px_var(--accent-primary),0_4px_12px_rgba(0,229,185,0.08)]">
```

#### Task Card (Kanban)

```
Container:
  background: var(--bg-elevated)
  border: 1px solid var(--border)
  border-radius: 10px
  padding: 16px
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15)

Hover:
  background: var(--surface)
  border-color: var(--border-strong)

Priority Stripe (left edge):
  - High:   3px solid var(--semantic-error)
  - Medium: 3px solid var(--accent-secondary)
  - Low:    3px solid var(--semantic-info)

Internal Layout:
  - Title: text-h5, text-primary, truncate
  - Assignee badge: 24px avatar circle + name (text-caption)
  - Tags: horizontal flex-wrap gap-2, text-overline, uppercase
  - Due date: text-caption, text-tertiary, with clock icon
```

#### Session Detail Info Card (Grid of metadata)

```
Container:
  background: var(--bg-elevated)
  border: 1px solid var(--border)
  border-radius: 10px
  padding: 16px

Label:
  text-overline, text-tertiary, uppercase, margin-bottom 4px

Value:
  text-body-sm, text-primary, font-mono (for IDs) or sans (for human text)
```

### 4.2 Tables

#### Session List Table

```
Container wrapper:
  overflow-x: auto
  border: 1px solid var(--border)
  border-radius: 10px

Table:
  width: 100%
  border-collapse: collapse
  font-size: 0.875rem (14px)
  text-align: left

Thead:
  background: var(--bg-elevated)
  border-bottom: 1px solid var(--border)
  th:
    padding: 12px 16px
    font-weight: 600
    color: var(--text-secondary)
    font-size: 0.8125rem (13px)
    white-space: nowrap

Tbody:
  tr:
    border-bottom: 1px solid var(--border)
    transition: background 100ms ease
  tr:last-child:
    border-bottom: none
  tr:hover:
    background: var(--surface-hover)
  td:
    padding: 12px 16px
    vertical-align: middle
    color: var(--text-primary)
  td.truncate:
    max-width: 280px

Empty State:
  text-align: center
  padding: 48px
  color: var(--text-tertiary)
```

**Tailwind approximation:**

```tsx
<div className="overflow-x-auto rounded-lg border border-[var(--border)]">
  <table className="w-full text-sm text-left">
    <thead className="bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-[13px]">
      <tr className="border-b border-[var(--border)]">
        <th className="px-4 py-3 font-semibold whitespace-nowrap">Title</th>
        {/* ... */}
      </tr>
    </thead>
    <tbody className="divide-y divide-[var(--border)]">
      <tr className="hover:bg-[var(--surface-hover)] transition-colors duration-100">
        <td className="px-4 py-3 text-white truncate max-w-xs">...</td>
      </tr>
    </tbody>
  </table>
</div>
```

### 4.3 Badges

Badges are compact status indicators. They use subtle background tints with matching text color.

#### Source Badges (Session list)

| Source | Background | Text | Border |
|---|---|---|---|
| WhatsApp | `var(--semantic-success-subtle)` | `#4ADE80` | `var(--semantic-success)` at 20% opacity |
| Discord | `rgba(99, 102, 241, 0.10)` | `#818CF8` | `#6366F1` at 20% opacity |
| Telegram | `rgba(14, 165, 233, 0.10)` | `#38BDF8` | `#0EA5E9` at 20% opacity |
| API | `var(--accent-secondary-subtle)` | `var(--accent-secondary)` | `var(--accent-secondary)` at 20% opacity |
| Webhook | `var(--semantic-error-subtle)` | `#F87171` | `var(--semantic-error)` at 20% opacity |
| TUI / CLI / Cron | `var(--surface-active)` | `var(--text-secondary)` | `var(--border-strong)` |
| Home Assistant | `rgba(3, 105, 161, 0.10)` | `#38BDF8` | `#0369A1` at 20% opacity |
| Subagent | `rgba(124, 140, 255, 0.10)` | `var(--accent-tertiary)` | `var(--accent-tertiary)` at 20% opacity |

**Badge base style:**

```
display: inline-flex
align-items: center
padding: 2px 8px
border-radius: 6px
font-size: 0.75rem (12px)
font-weight: 500
line-height: 1.4
gap: 4px
border: 1px solid <matching border color>
```

#### Status Badges (Agent health)

| State | Background | Text | Icon |
|---|---|---|---|
| Running | `var(--semantic-success-subtle)` | `var(--semantic-success)` | ● 8px circle |
| Stopped | `var(--surface-active)` | `var(--text-tertiary)` | ● 8px circle |
| Degraded | `var(--semantic-warning-subtle)` | `var(--semantic-warning)` | ● 8px circle |
| Error | `var(--semantic-error-subtle)` | `var(--semantic-error)` | ● 8px circle |
| Starting | `var(--semantic-info-subtle)` | `var(--semantic-info)` | ◐ spinner |

#### Assignee Badges (Kanban)

```
background: var(--accent-primary-subtle)
color: var(--accent-primary)
border-radius: 9999px
padding: 2px 10px
font-size: 0.75rem (12px)
font-weight: 500
```

### 4.4 Buttons

| Variant | Background | Text | Border | Hover | Active | Focus Ring |
|---|---|---|---|---|---|---|
| **Primary** | `var(--accent-primary)` | `var(--text-inverse)` | none | `var(--accent-primary-hover)` | scale(0.98) | `var(--accent-primary)` at 40% opacity, 2px offset |
| **Secondary** | `var(--surface)` | `var(--text-primary)` | `1px solid var(--border)` | `var(--surface-hover)` | scale(0.98) | `var(--border-strong)` |
| **Ghost** | transparent | `var(--text-secondary)` | none | `var(--surface)` bg | scale(0.98) | `var(--accent-primary)` |
| **Destructive** | `var(--semantic-error)` | `#FFFFFF` | none | `#DC2626` | scale(0.98) | `var(--semantic-error)` at 40% opacity |
| **Icon Button** | transparent | `var(--text-secondary)` | none | `var(--surface)` bg, `var(--text-primary)` text | scale(0.95) | `var(--accent-primary)` |

**Button base:**

```
  display: inline-flex
  align-items: center
  justify-content: center
  gap: 6px
  padding: 8px 16px
  border-radius: 8px
  font-size: 0.875rem (14px)
  font-weight: 500
  line-height: 1.4
  transition: all 100ms ease-out
  cursor: pointer
  user-select: none
  white-space: nowrap
```

**Sizes:**

| Size | Padding | Font Size | Height |
|---|---|---|---|
| Small | 4px 12px | 0.75rem (12px) | 28px |
| Medium | 8px 16px | 0.875rem (14px) | 36px |
| Large | 12px 24px | 1rem (16px) | 44px |

### 4.5 Navigation Bar

```
Container:
  background: var(--bg-elevated)
  border-bottom: 1px solid var(--border)
  height: 56px
  padding: 0 24px
  display: flex
  align-items: center
  justify-content: space-between
  position: sticky
  top: 0
  z-index: 50

Brand:
  font-weight: 700
  font-size: 1.125rem (18px)
  color: var(--text-primary)
  letter-spacing: -0.01em

Nav Links:
  font-size: 0.875rem (14px)
  font-weight: 500
  color: var(--text-secondary)
  padding: 6px 10px
  border-radius: 6px
  transition: all 100ms ease

Nav Link Hover:
  color: var(--text-primary)
  background: var(--surface)

Nav Link Active:
  color: var(--accent-primary)
  background: var(--accent-primary-subtle)

Right Actions:
  gap: 12px
  display: flex
  align-items: center
```

**Responsive:** On screens < 768px, nav links collapse into a hamburger menu drawer.

### 4.6 Chat Bubbles

Chat bubbles appear in the Session Detail message view. They follow a familiar messaging-app pattern adapted for dark mode.

#### User Message Bubble

```
Container:
  align-self: flex-end
  max-width: 80%

Bubble:
  background: var(--accent-primary)
  color: var(--text-inverse)
  border-radius: 16px
  border-top-right-radius: 4px   /* speech tail */
  padding: 10px 14px
  font-size: 0.875rem (14px)
  line-height: 1.5
  word-break: break-word

Timestamp:
  text-align: right
  font-size: 0.6875rem (11px)
  color: var(--text-tertiary)
  margin-top: 4px
```

#### Assistant Message Bubble

```
Container:
  align-self: flex-start
  max-width: 80%

Reasoning Block (optional, above bubble):
  font-size: 0.75rem (12px)
  color: var(--text-tertiary)
  font-style: italic
  margin-bottom: 4px
  cursor: pointer

Bubble:
  background: var(--surface)
  color: var(--text-primary)
  border: 1px solid var(--border)
  border-radius: 16px
  border-top-left-radius: 4px   /* speech tail */
  padding: 10px 14px
  font-size: 0.875rem (14px)
  line-height: 1.5

Timestamp:
  font-size: 0.6875rem (11px)
  color: var(--text-tertiary)
  margin-top: 4px
```

#### Tool Message (Expandable)

```
Container:
  width: 100%
  margin: 8px 0

Header Button:
  width: 100%
  display: flex
  align-items: center
  justify-content: space-between
  padding: 8px 12px
  background: var(--bg-elevated)
  border: 1px solid var(--border)
  border-radius: 8px
  font-family: 'JetBrains Mono', monospace
  font-size: 0.75rem (12px)
  color: var(--text-secondary)
  cursor: pointer
  transition: background 100ms ease

Header Button Hover:
  background: var(--surface)

Tool Label:
  display: inline-flex
  align-items: center
  gap: 6px
  background: var(--surface)
  border-radius: 4px
  padding: 2px 6px
  font-size: 0.625rem (10px)
  font-weight: 500
  letter-spacing: 0.05em
  text-transform: uppercase
  color: var(--text-tertiary)

Expanded Content:
  border: 1px solid var(--border)
  border-top: none
  border-radius: 0 0 8px 8px
  background: var(--bg-base)
  padding: 12px
  font-family: 'JetBrains Mono', monospace
  font-size: 0.75rem (12px)
  color: var(--text-secondary)
  overflow: auto
  max-height: 384px
  white-space: pre-wrap
```

### 4.7 Kanban Columns

Kanban is used for task/workflow tracking in AgentOS.

```
Board Container:
  display: flex
  gap: 16px
  overflow-x: auto
  padding: 4px

Column:
  min-width: 280px
  max-width: 340px
  flex-shrink: 0
  background: var(--bg-elevated)
  border: 1px solid var(--border)
  border-radius: 12px
  display: flex
  flex-direction: column

Column Header:
  padding: 14px 16px
  border-bottom: 1px solid var(--border)
  display: flex
  align-items: center
  justify-content: space-between

Column Title:
  font-size: 0.875rem (14px)
  font-weight: 600
  color: var(--text-primary)

Column Count Badge:
  background: var(--surface)
  color: var(--text-secondary)
  border-radius: 9999px
  padding: 2px 8px
  font-size: 0.75rem (12px)
  font-weight: 500

Column Content:
  flex: 1
  padding: 12px
  display: flex
  flex-direction: column
  gap: 10px
  overflow-y: auto

Add Button:
  margin: 12px
  padding: 8px
  border-radius: 8px
  border: 1px dashed var(--border)
  color: var(--text-tertiary)
  font-size: 0.8125rem (13px)
  text-align: center
  cursor: pointer
  transition: all 100ms ease

Add Button Hover:
  border-color: var(--border-strong)
  color: var(--text-secondary)
  background: var(--surface)
```

---

## 5. Layout Principles

### 5.1 Spacing System (4px Base Grid)

All spacing values are multiples of **4px**. This creates a predictable, rhythmic layout.

| Token | Value | Tailwind Equiv | Usage |
|---|---|---|---|
| `space-0` | 0px | `0` | Reset |
| `space-1` | 4px | `p-1` / `gap-1` | Tight icon padding, tiny gaps |
| `space-2` | 8px | `p-2` / `gap-2` | Inline gaps, badge padding-x |
| `space-3` | 12px | `p-3` / `gap-3` | Card internal gaps, section padding |
| `space-4` | 16px | `p-4` / `gap-4` | Standard padding, column gutters |
| `space-5` | 20px | `p-5` / `gap-5` | Agent card padding |
| `space-6` | 24px | `p-6` / `gap-6` | Page horizontal padding, nav spacing |
| `space-8` | 32px | `p-8` / `gap-8` | Section vertical spacing |
| `space-10` | 40px | `p-10` / `gap-10` | Large section separation |
| `space-12` | 48px | `p-12` / `gap-12` | Hero/page title spacing |
| `space-16` | 64px | `p-16` / `gap-16` | Major layout divisions |

### 5.2 Border Radius Scale

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 6px | Badges, small buttons, tags |
| `radius-md` | 8px | Buttons, inputs, tool panels |
| `radius-lg` | 10px | Tables, info cards, Kanban columns |
| `radius-xl` | 12px | Agent cards, modals, popover panels |
| `radius-2xl` | 16px | Chat bubbles, large cards |
| `radius-full` | 9999px | Avatars, pills, status dots |

### 5.3 Shadow / Elevation System

Shadows are subtle and colored to feel like "glow" on dark backgrounds rather than traditional drop-shadows.

| Level | Shadow | Usage |
|---|---|---|
| `shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.25)` | Resting cards, Kanban columns |
| `shadow-md` | `0 4px 12px rgba(0, 0, 0, 0.35)` | Hover lift, dropdowns |
| `shadow-lg` | `0 8px 24px rgba(0, 0, 0, 0.45)` | Modals, popovers |
| `shadow-glow` | `0 0 20px rgba(0, 229, 185, 0.12)` | Active agent card, focused primary button |
| `shadow-glow-secondary` | `0 0 16px rgba(245, 184, 0, 0.10)` | Warning emphasis, gold badges |
| `shadow-inner` | `inset 0 1px 2px rgba(0, 0, 0, 0.30)` | Inputs, pressed buttons |

**Implementation in Tailwind config:**

```js
boxShadow: {
  sm: '0 1px 2px rgba(0, 0, 0, 0.25)',
  md: '0 4px 12px rgba(0, 0, 0, 0.35)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.45)',
  glow: '0 0 20px rgba(0, 229, 185, 0.12)',
  'glow-secondary': '0 0 16px rgba(245, 184, 0, 0.10)',
  inner: 'inset 0 1px 2px rgba(0, 0, 0, 0.30)',
}
```

### 5.4 Responsive Breakpoints

| Name | Width | Tailwind Prefix | Usage |
|---|---|---|---|
| Mobile | < 640px | default | Single column, stacked nav, full-width cards |
| Tablet | 640px+ | `sm:` | 2-column grids, expanded nav |
| Laptop | 768px+ | `md:` | Sidebar + main content split, table fully visible |
| Desktop | 1024px+ | `lg:` | 3-column agent grid, Kanban side-scroll |
| Wide | 1280px+ | `xl:` | 4-5 column agent grid, max-width containers |
| Ultra-wide | 1536px+ | `2xl:` | Centered layout, increased gutters |

**Container max-widths:**

| Context | Max Width | Tailwind |
|---|---|---|
| Full page (Dashboard, Sessions) | 1280px | `max-w-7xl` (or `max-w-[1280px]`) |
| Chat / Detail view | 896px | `max-w-4xl` |
| Narrow form / modal | 480px | `max-w-md` |
| Popover / tooltip | 320px | `max-w-xs` |

---

## 6. Implementation Notes

### 6.1 Tailwind Config Changes (`tailwind.config.js`)

Replace the existing minimal config with the following. This extends the default Tailwind theme with AgentOS-specific design tokens.

```js
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
      },
    },
  },
  plugins: [],
}
```

### 6.2 Migration Notes for Existing Code

The existing `App.tsx` uses legacy variable names. After updating `index.css` and `tailwind.config.js`, perform these replacements across the frontend codebase:

| Old Variable / Class | New Variable / Class |
|---|---|
| `var(--bg)` | `var(--bg-base)` |
| `var(--surface)` (as background) | `var(--surface)` |
| `var(--text)` | `var(--text-secondary)` or `var(--text-primary)` depending on hierarchy |
| `var(--accent)` | `var(--accent-primary)` |
| `bg-[var(--surface)]/40` | `bg-surface/40` or `bg-bg-elevated` |
| `text-white` | `text-text-primary` |
| `text-[var(--text)]` | `text-text-secondary` |
| `border-[var(--surface)]` | `border-border` |
| `hover:text-white` | `hover:text-text-primary` |
| `hover:shadow-lg` | `hover:shadow-md` (or `hover:shadow-glow` for active cards) |
| `rounded-xl` | `rounded-xl` (unchanged) |
| `font-mono` | `font-mono` (now maps to JetBrains Mono) |

### 6.3 Font Imports

Use Google Fonts CDN for development (already included in the `index.css` block above):

```html
<!-- In index.html <head>, if not using @import in CSS -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

For production or offline deployments, self-host the font files in `frontend/public/fonts/` and reference them via `@font-face` in `index.css`.

### 6.4 Accessibility Checklist

- **Contrast:** All `--text-primary` on `--surface` backgrounds must pass WCAG AA (4.5:1). All `--text-secondary` on `--bg-base` must pass WCAG AA.
- **Focus:** Never remove `outline` globally. Use `focus-visible` with the accent ring (see global CSS).
- **Motion:** Respect `prefers-reduced-motion`. Do not animate `transform` or `opacity` for users who opt out.
- **Color alone:** Status badges must include an icon or text label; do not rely on color alone for "Running / Stopped" indicators.

### 6.5 Asset Checklist

| Asset | Format | Dimensions | Notes |
|---|---|---|---|
| Logo icon | SVG | scalable | Winged Glyph mark, stroke-based for theming |
| Logo full | SVG | scalable | Icon + wordmark lockup |
| Favicon | PNG / ICO | 32×32, 180×180 | Icon only, solid fill |
| Apple touch icon | PNG | 180×180 | Icon only, on `--bg-base` background |

---

## 7. Quick Reference: Token Map

| UI Element | Background | Text | Border | Shadow |
|---|---|---|---|---|
| Page shell | `--bg-base` | — | — | — |
| Navbar | `--bg-elevated` | `--text-primary` | `--border` (bottom) | — |
| Agent card | `--surface` | `--text-primary` | `--border` | `shadow-sm` |
| Agent card hover | `--surface-hover` | `--text-primary` | `--border-strong` | `shadow-md` |
| Agent card active | `--surface` | `--text-primary` | `--accent-primary` | `shadow-glow` |
| Session table | — | `--text-primary` | `--border` | — |
| Table header | `--bg-elevated` | `--text-secondary` | `--border` (bottom) | — |
| Table row hover | `--surface-hover` | — | — | — |
| Primary button | `--accent-primary` | `--text-inverse` | none | — |
| Primary button hover | `--accent-primary-hover` | `--text-inverse` | none | `shadow-glow` |
| Secondary button | `--surface` | `--text-primary` | `--border` | — |
| Ghost button | transparent | `--text-secondary` | none | — |
| User chat bubble | `--accent-primary` | `--text-inverse` | none | — |
| Assistant chat bubble | `--surface` | `--text-primary` | `--border` | — |
| Tool panel | `--bg-elevated` | `--text-secondary` | `--border` | — |
| Kanban column | `--bg-elevated` | — | `--border` | `shadow-sm` |
| Kanban card | `--bg-base` | `--text-primary` | `--border` | — |
| Info badge | `--info-subtle` | `--semantic-info` | `rgba(56,189,248,0.20)` | — |
| Success badge | `--success-subtle` | `--semantic-success` | `rgba(34,197,94,0.20)` | — |
| Warning badge | `--warning-subtle` | `--semantic-warning` | `rgba(245,158,11,0.20)` | — |
| Error badge | `--error-subtle` | `--semantic-error` | `rgba(239,68,68,0.20)` | — |
| Modal overlay | `rgba(11,17,32,0.80)` | — | — | — |
| Modal panel | `--bg-overlay` | `--text-primary` | `--border` | `shadow-lg` |
| Input field | `--surface` | `--text-primary` | `--border` | `shadow-inner` |
| Input focus | `--surface` | `--text-primary` | `--accent-primary` | `shadow-glow` |

---

*End of specification. Implement in order: (1) CSS variables + fonts, (2) Tailwind config, (3) Global base styles, (4) Component-by-component migration.*
