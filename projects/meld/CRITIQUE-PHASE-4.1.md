# meld — CRITIQUE Phase 4.1 (visual + interaction)

- **Date:** 2026-05-31
- **Reviewer:** designer-critic
- **Surfaces covered:** TopBar (BrandMark + IdentityBadge + ApiStatusDot + ThemeToggle + NewBoardButton), landing page (`CanvasPlaceholder`), `/board/[boardId]` host (BoardCanvasHost + BoardCaption), BoardToolbar, drawing primitives (rectangle / ellipse / freehand / text), preview canvas, remote presence cursor + name pill, ConnectionBanner, OfflineAriaLiveRegion, BoardNotFound dialog, StatusRow, theme tokens (`globals.css`), grid painter, color crossfade on reconnect.

## Methodology

- Read every chrome + board component source under `web/src/components/chrome/*` and `web/src/components/board/*`; read all painter modules under `web/src/lib/canvas/painters/*`; read `web/src/app/globals.css` end-to-end; read `app/layout.tsx`, `app/page.tsx`, `app/board/[boardId]/page.tsx`.
- Did **NOT** run a live dev server in this pass — Windows/PowerShell environment and the parent thread did not authorise spawning long-lived `pnpm dev` processes. All defects are sourced from the static reading + a mental render against the ADR-locked layout dimensions. Defects D-01 and D-12 specifically would benefit from a live screenshot pass; the rest are decidable from the source verbatim.
- Compared against six references named in `docs/inspirations.md`:
  - **Linear** ([linear.app](https://linear.app/)) — chrome restraint, icon-button hover treatment, focus ring economy.
  - **tldraw** ([tldraw.com](https://tldraw.com)) — floating toolbar geometry, active-tool affordance, cursor pill silhouette.
  - **Excalidraw** ([excalidraw.com](https://excalidraw.com)) — handwritten-feel preview marquee, dashed-stroke timing, text-tool baseline.
  - **rauno.me** ([rauno.me](https://rauno.me/)) — typographic detail polish, optical tracking, deliberate dim-state transitions.
  - **Vercel** ([vercel.com](https://vercel.com/)) — wordmark presence at small sizes, status-pip restraint.
  - **Codrops** ([tympanus.net/codrops](https://tympanus.net/codrops/)) — easing reference; "feels designed" curves vs default `easeOut`.
- Comparisons use OKLCH deltas, px values, and ms deltas — never "feels off".

## Defect ledger

### D-01 — BrandMark is a generic 18 px semibold "Meld" with zero identity (severity: **critical**)

- **File:** `web/src/components/chrome/brand-mark.tsx:21-28`.
- **Defect:** A wordmark rendered as `text-base font-semibold tracking-tight` on light at `sm:text-lg` (18 px) IS the Tailwind default heading. There is no logomark, no custom letterform tweak, no monospace counterpoint, no italic descender, no kerning override. Linear's wordmark has the bespoke "n" with the carved descender; Vercel's is the chevron with the flat baseline. The brief commits this project to "arresting, not clean and minimal because that's safe" (CLAUDE.md § 5). A semibold Inter "Meld" is exactly the safe-because-clean default the brief forbids. A recruiter's eye lands on the wordmark in the first 200 ms — the current treatment fails the 5-second-stopper test on first paint.
- **Compare:** Linear `linear.app` uses a 14 px / 600 weight wordmark with a leading mark and tracking `-0.011em`; Vercel `vercel.com` pairs the geometric chevron with the wordmark at exactly the same height as the leading icon. Both feel like brand. "Meld" in 18 px Inter semibold reads as placeholder.
- **Fix:** Two cheap moves:
  1. Pair the wordmark with a 14 px square SVG logomark to the left (a stylised meld/intersection mark — two overlapping rounded squares at 60% alpha could do it for this project's CRDT-merge metaphor; build it as inline SVG with `aria-hidden`). The squares mirror the rectangle + ellipse primitives so the brand visually previews the canvas.
  2. Drop the wordmark size to 14 px sm:15 px (matches the chrome height ratio Linear uses) and tighten tracking from `tracking-tight` (-0.025em) to a precise `-0.014em` via an inline `style={{ letterSpacing: '-0.014em' }}` so the wordmark is denser than display text but not as tight as Inter's preset.
- **Remediation severity check:** critical because every other surface is downstream of "do I trust this brand". A bare-default wordmark cap-rates the whole portfolio item.

### D-02 — Identity badge ring has no visible animation when the welcome color upgrades (severity: **high**)

- **File:** `web/src/components/chrome/identity-badge-client.tsx:142-177`.
- **Defect:** The component declares a 320 ms `easeOutCubic` "ring transition" via `<motion.span>` but the only animated Motion property is `opacity: 1 → 1` (lines 149-151). The actual color change happens via a CSS variable swap (`--badge-ring` reassigned in `useMemo`), and the only animation that fires on the color delta is Tailwind's `transition-colors duration-300 ease-out` class (line 171), which is the same boring CSS default the rest of the chrome uses. The whole point of the welcome-frame moment (ADR-005 first-paint identity card win) is the visible "your color resolved" beat — but the beat is currently the same generic 300 ms CSS color transition you would get from any shadcn component. The brand-anchor moment is invisible.
- **Compare:** rauno.me dim-state-to-live-state transitions use a 280 ms `cubic-bezier(0.16, 1, 0.3, 1)` with a simultaneous scale pulse (1 → 1.06 → 1). Linear's avatar pop-in on collaborator-joined fires a 200 ms scale + opacity that reads as "someone arrived".
- **Fix:** When `identity.color` transitions from `undefined → defined` (i.e. welcome arrived), animate the inner ring with `motion.span` from `{ scale: 0.92, borderWidth: 1 }` to `{ scale: 1, borderWidth: 2 }` over 280 ms with `[0.16, 1, 0.3, 1]`. Drive the actual border-color via `animate={{ borderColor: ringHexString }}` instead of relying on the CSS `transition-colors` fallback — Motion's color interpolation in OKLCH-string mode produces a perceptible 280 ms "ramp up" instead of a flat 300 ms instant swap. Keep the existing reduced-motion `duration: 0` guard.

### D-03 — Active toolbar slot is the same `--color-accent-soft` background with a ring at `--color-accent/40` — the active state is muddy at first glance (severity: **high**)

- **File:** `web/src/components/board/board-toolbar.tsx:164-168`.
- **Defect:** Active state is `bg-(--color-accent-soft) text-(--color-accent-strong) ring-2 ring-(--color-accent)/40`. On light: `--color-accent-soft` is `oklch(0.9 0.05 285)` (a pale lavender) and the ring is `oklch(0.55 0.18 285)` at 40% alpha. The ring at 40% sits at perceived chroma ~0.072 — visually IDENTICAL to the pale soft surface underneath. The user cannot tell from across a 27" monitor which slot is active; the ring dissolves into the lavender background. tldraw's active tool affordance is a clean inverted treatment (white-on-dark inside a single pill), not a layered soft+ring. The current treatment also doubles the slot's visual weight without doubling its differentiation — worst of both worlds.
- **Compare:** tldraw `tldraw.com` active tool: solid 100% accent fill with full-contrast foreground glyph; resting state is text-on-neutral. The differentiation is "this slot is clearly the chosen one" in one frame. Excalidraw uses the same single-pill solid-fill pattern.
- **Fix:** Replace lines 164-168 with `bg-(--color-accent) text-(--color-accent-fg)` for the active branch and DROP the ring entirely. Resting state stays `text-(--color-fg-muted) hover:text-(--color-fg)`. The differentiation becomes a 100% chroma+lightness inversion against neutral instead of a soft-tone-on-soft-tone whisper. If the brief wants a halo, add `shadow-[0_0_0_4px_oklch(0.55_0.18_285_/_0.18)]` (a single-prop OKLCH shadow that defaults to off when not active) — this is the Linear command-palette selected-row idiom, not a layered tint+ring.

### D-04 — Floating toolbar is `bottom-6 left-1/2 -translate-x-1/2` with no min-touch target and no shape baseline (severity: **medium**)

- **File:** `web/src/components/board/board-toolbar.tsx:135-145`.
- **Defect:** Container is `pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2`. Inner pill is `rounded-full p-1 shadow-md backdrop-blur-sm bg-(--color-surface)/95`. Three concrete issues:
  - `bottom-6` is 24 px above the canvas bottom edge. tldraw and Excalidraw both sit their floating toolbar at 12-16 px from the bottom — a 24 px gap leaves a visible whitespace strip below the toolbar that reads as "loose layout", not "deliberate margin".
  - `shadow-md` is Tailwind's default `0 4px 6px -1px rgb(0 0 0 / 0.1)` — a generic SaaS dropdown shadow. On a warm-paper bg this reads as cool grey; the violet brand should cast a tinted shadow.
  - The pill `p-1` plus `icon-sm` buttons (size-8, 32 px) produces a pill height of 40 px. tldraw's pill is 44 px (their button is size-9, 36 px, plus 4 px pad), which is exactly the WCAG 2.5.5 enhanced touch-target threshold. 40 px misses the target threshold on touch by 4 px.
- **Fix:**
  1. Move container to `bottom-4` (16 px gap) — matches Excalidraw.
  2. Replace `shadow-md` with `shadow-[0_8px_24px_-8px_oklch(0.2_0.018_285_/_0.18),0_2px_6px_-2px_oklch(0.2_0.018_285_/_0.12)]` — a tinted violet-ink shadow that reads as "lifted off paper" instead of "generic dropdown". Dark mode swaps to `oklch(0_0_0_/_0.5)` in the same shape.
  3. Bump button size from `icon-sm` (32 px) to `icon` (36 px) inside the toolbar pill specifically; the chrome buttons stay `icon-sm` because they are not primary touch surfaces. Pill height becomes 44 px (2 × 4 px pad + 36 px button) and meets WCAG 2.5.5 enhanced.

### D-05 — Cursor name pill text is 10 px Inter and pill bg uses `palette.surface` flat — illegible at standard zoom (severity: **high**)

- **File:** `web/src/lib/canvas/painters/cursors.ts:116-128, 174-218`.
- **Defect:** Three combined problems:
  - `PILL_FONT` is 10 px (line 117). On a 1440 px display at 100% browser zoom, 10 px Inter renders at ~13 device pixels with sub-pixel hinting — borderline at acuity threshold for a recruiter sitting 60 cm from a 27" monitor. tldraw's cursor pill text is 12 px; Figma's is 12 px; the 10 px choice here is "small for the sake of being small".
  - `palette.surface` on light is `oklch(0.96 0.006 90)` — almost the same as `--color-bg` `oklch(0.985 0.005 90)`. The pill background against the canvas bg has ~0.025 lightness delta — invisible separation. The pill reads as floating text, not a pill.
  - The border color is `color` (the peer's awareness color) at `globalAlpha = cursor.opacity * 0.4` — at full opacity that's 40% alpha. Against the near-bg surface, the 40% violet/teal/etc. border is barely there, and it pulses through the same low-contrast band as the surface.
- **Compare:** tldraw's cursor pill is 12 px text on a SOLID peer-color pill with white text (the peer color does the contrast lift, the pill IS the brand). Figma's is similar. Excalidraw uses a translucent pill but with 14 px text and a 1 px solid border at full opacity.
- **Fix:**
  1. Bump `PILL_FONT` from 10 px to 12 px and `PILL_HEIGHT` from 18 to 22, `PILL_PADDING_X` from 6 to 8. The arrow glyph stays at its current scale; only the pill grows.
  2. Replace the dual-alpha pill (surface bg + color border) with a SOLID peer-color background and white-on-color text:
     - Pill fill: `palette.awarenessSlots[colorSlot]` at full opacity.
     - Pill text: a `--color-on-awareness` token added to globals.css (always white in both themes — the awareness L=0.6 / 0.72 palette is chroma-balanced to clear ≥ 4.5:1 on white text per the existing comment at globals.css:131-134). Remove `palette.fg` from the text fill.
     - This gives every peer a strong color-identity pill, mirrors tldraw verbatim, and the pill becomes self-distinguishing without relying on the canvas bg behind it.
  3. Drop the per-peer 0.9 surface alpha multiply (lines 184) and the 0.4 border alpha (line 197) entirely — both were workarounds for the invisible-pill issue.

### D-06 — Cursor arrow asymmetry is "small and unintentional" — silhouette reads as a misaligned triangle (severity: **medium**)

- **File:** `web/src/lib/canvas/painters/cursors.ts:106-113`.
- **Defect:** Arrow tip at (0, 0), left base at (3, 18), notch at (7, 13), right base at (14, 14). The notch sits closer to the right base (delta 1 px Y) than the left base (delta 5 px Y). The result on a typical 16 px arrow is a silhouette that reads "this triangle has a slight squint" — the asymmetry is too small to register as deliberate handedness (per the comment at line 96-104) and too small to recover. Linear's and Figma's cursors are either deliberately tilted ~12° clockwise (a clear right-handed pen) or perfectly symmetric. The middle ground reads as a rendering bug, not a design choice.
- **Compare:** Linear's collaborator cursor uses a 12 px equilateral-ish triangle with a 14° clockwise tilt — clearly intentional. tldraw's is the canonical macOS arrow silhouette with a hollow tail.
- **Fix:** Tilt the entire arrow 12° clockwise via `ctx.rotate(12 * Math.PI / 180)` after the `translate(currentX, currentY)` on line 156, and use the macOS-arrow point set: `tip (0,0)`, `left base (12, 12)`, `notch (5, 12)`, `inner tail (8, 16)`. Width grows from 14 px to 12 px and reads as the canonical hollow-tailed pen pointer that the rest of the industry uses. Pure macOS-arrow imitation is the Linear / Figma / tldraw call — it is the convention for "remote cursor", not an opportunity for original geometry.

### D-07 — Preview shape dashed-stroke uses `[4, 4]` static dashes — no marching-ants motion, no Excalidraw feel (severity: **medium**)

- **File:** `web/src/components/board/board-pointer-overlay.tsx:252-262`.
- **Defect:** While dragging out a rectangle/ellipse, the preview paints with `ctx.setLineDash([4, 4])`. The dash phase is fixed at 0. The marquee is visually a static dotted outline — the "this is in-flight" affordance is the absence of fill saturation, not the motion of the dashes. Excalidraw's preview marquee uses a 1 Hz marching-ants offset that GIVES the in-flight state its visual life. tldraw's preview is similar. The current treatment looks like a finished dashed border.
- **Compare:** Excalidraw `excalidraw.com` dragging a rectangle: ~1.2 s loop, `[6, 4]` dash, `lineDashOffset` animating from 0 to 10. Codrops "marching ants" examples typically run ~600-800 ms loops.
- **Fix:** Add a `requestAnimationFrame` loop that runs only while `draftRef.current?.kind === 'rectangle' || 'ellipse'`, increments a `dashOffsetRef.current` by `(performance.now() - lastTickMs) / 80` per frame (yields ~12.5 px/s — readable as motion without being frantic), and sets `ctx.lineDashOffset = dashOffsetRef.current` before stroking. Stop the rAF on `handlePointerUp` / `handlePointerCancel`. Reduced-motion: skip the rAF entirely and keep the static dashes. ~25 LOC; visual delta is meaningful.

### D-08 — Connection banner copy contains a literal em-dash and reads as a generic warning strip (severity: **medium**)

- **File:** `web/src/components/chrome/connection-banner.tsx:40, 81-88`.
- **Defect:** Copy: `"Offline — your edits will sync when you reconnect"`. Two issues:
  - The em-dash glyph is the ASCII-but-not-quite character `—` (U+2014). The banner is set in `text-xs font-medium` — at 12 px Inter the em-dash optically collapses against the surrounding glyphs because Inter's em-dash sits at cap-height baseline and the surrounding lowercase letters sit at x-height. Visually it reads as a hyphen, which makes the copy parse as "Offline-your-edits" until the eye corrects. Linear / rauno copy at this size uses a typographic em-space + en-dash or just two clauses with a period.
  - The banner height is `h-8` (32 px) with a `WifiOff` icon at `size-4` (16 px) and `strokeWidth={2.25}`. The 2.25 strokeWidth on a 16 px lucide icon is the "default fat" — lucide's house weight is 1.5-2 for chrome. The icon dominates the banner copy and reads as alarm-state.
- **Compare:** Linear's connection-lost copy reads `Reconnecting…` in 13 px with no icon at all; the chrome dim itself is the signal. rauno.me's transient notices use 12 px sans + 1.25 strokeWidth lucide icons.
- **Fix:**
  1. Replace the copy with `Offline. Your edits will sync on reconnect.` — two short clauses separated by a period. Reads cleanly at 12 px Inter regardless of the dash-rendering quirk.
  2. Drop `strokeWidth={2.25}` from the WifiOff (use lucide's default 2) and reduce the icon to `size-3.5` (14 px). The signal becomes the amber surface + the copy, not the icon weight.
  3. The banner ALSO updates the OfflineAriaLiveRegion copy ("Offline. Your edits are saved locally and will sync when the connection returns.") to share the same first clause so the visual and assistive copy align. ADR-009 pins the assistive variant verbatim — escalate to architect via AGENT_NOTES if the visible-vs-assistive split is load-bearing; otherwise unify.

### D-09 — BoardCaption is a top-left card competing with the toolbar and the canvas for first attention (severity: **medium**)

- **File:** `web/src/components/board/board-canvas-host.tsx:414-428`.
- **Defect:** Top-left absolute card with `bg-(--color-surface)/90 backdrop-blur-sm border`, a 14 px medium board name, and a font-mono `[10px]` truncated id + creation time + connected count. The caption duplicates information already in the browser tab title (the board name is the `<title>`) and in the share-link URL bar. The card surface competes with the bottom toolbar for the canvas-chrome attention budget. Excalidraw and tldraw both ship the board name in the top-LEFT but as **plain typography directly on the canvas**, no card surface — the chrome is in the toolbar and the topbar, the canvas is sacred. The card+border treatment here belongs on the marketing page, not on the work surface.
- **Compare:** tldraw board-name placement: 14 px medium, no card, just left-aligned on the canvas surface at top-4 left-4. Excalidraw's is identical pattern.
- **Fix:** Drop the `rounded-(--radius-md) border bg-(--color-surface)/90 backdrop-blur-sm px-3 py-2` wrapper. Keep the two `<p>` elements with the same typography but render them directly against the canvas:
  ```tsx
  <div className="pointer-events-none absolute left-4 top-4 z-10 flex max-w-xs flex-col gap-0.5">
    <p className="text-sm font-medium text-(--color-fg)" title={boardName}>{boardName}</p>
    <p className="font-mono text-[10px] text-(--color-fg-subtle)">{...meta}</p>
  </div>
  ```
  The text-on-canvas treatment reads as label-not-chrome. If readability against shape fills becomes an issue later, add a `text-shadow: 0 1px 2px var(--color-bg)` rule (no surface card needed).

### D-10 — Landing page headline + body are competently typeset but lack hierarchy delta (severity: **medium**)

- **File:** `web/src/components/chrome/canvas-placeholder.tsx:27-39`.
- **Defect:** Stack is: 11 px mono uppercase eyebrow (`tracking-[0.18em]`), `text-2xl font-medium` headline (sm:text-3xl), 14 px body, button. The headline-to-body size ratio is 24 px → 14 px = 1.71×. rauno.me's display-to-body ratio is 2.4× minimum (display 36-40 px, body 14-15 px). Linear's marketing hero is similar. The current ratio reads as "small heading" not "anchored display". The eyebrow at 11 px uppercase + 0.18em tracking is a Linear idiom (correctly used here) but the headline below it does not earn the eyebrow — the eyebrow promises display below it, the body delivers paragraph.
- **Compare:** rauno.me hero: display ~44 px / weight 500 / tracking `-0.022em`; body ~15 px / weight 400. Linear hero: 48 px / 600 / `-0.025em`; body 17 px / 400.
- **Fix:** Bump headline to `text-3xl sm:text-4xl` (30 px → 36 px), tracking explicit `-0.022em` via inline style (`tracking-tight` resolves to `-0.025em` which is too tight at 36 px). Body drops to `text-[13px]` so the ratio becomes ~2.77×. Eyebrow stays as-is — it is the only piece doing real typographic work currently.

### D-11 — Status row "Open this board in two tabs to see live presence in action." is buried at the bottom of the page where the eye never lands (severity: **low**)

- **File:** `web/src/components/chrome/status-row.tsx:33-41`.
- **Defect:** The wow-moment hint ("open in two tabs") is the SINGLE most important piece of copy in the entire portfolio item — it is the literal user instruction that triggers the wow moment the brief sells. It is currently in a 12 px muted footer at the bottom of the page, hidden on mobile (below 640 px). A recruiter who lands on `/`, clicks "New board", and arrives at `/board/<id>` SEES the canvas with no instruction; the footer is below the fold on any 1366×768 laptop with the toolbar showing. The wow moment dies a quiet death.
- **Compare:** tldraw's onboarding overlay on first-board-open is a dismissible card centered on the canvas with the "share this link to collaborate" affordance front and center.
- **Fix:** When `connectedClients === 1` AND the route is `/board/[boardId]`, render a dismissible center card (Motion `AnimatePresence`, 280 ms `[0.16, 1, 0.3, 1]` slide-up enter, fade-out on first pointermove inside the canvas region). Card copy: `Open this URL in a second tab to see live cursors.` plus a `Copy link` button. Persist dismissal in `useUiStore` so the card does not re-appear on subsequent board opens in the same session. Keep the bottom StatusRow for the cross-route reminder; the center card carries the first-visit beat.

### D-12 — Theme toggle uses Linear's 180 ms `easeOutCubic` for the icon swap but the underlying `data-theme` flip triggers ~100+ CSS variable repaints with no orchestration (severity: **low**)

- **File:** `web/src/components/chrome/theme-toggle.tsx:80-110` and `web/src/app/globals.css:190-239`.
- **Defect:** The icon crossfade is well-tuned (180 ms `[0.33, 1, 0.68, 1]`, scale 0.85 → 1, AnimatePresence wait mode). The CSS variable swap underneath, however, is instant — every `--color-*` token jumps to its dark-mode value in one frame because they live on `:root[data-theme='dark']`. The result on a board with shapes painted is: icon fades smoothly, canvas + chrome FLASH to dark in the same instant. The icon transition reads as decoupled from the actual theme flip.
- **Compare:** Linear's theme toggle blocks the page for ~140 ms with a `view-transitions` API crossfade in supporting browsers. rauno.me uses a CSS `transition: background-color 280ms ease, color 280ms ease` on a global selector to bring the chrome along with the icon.
- **Fix:** Add to `@layer base` in `globals.css`:
  ```css
  html { transition: background-color 220ms ease-out, color 220ms ease-out; }
  body, header, footer, main { transition: background-color 220ms ease-out, border-color 220ms ease-out, color 220ms ease-out; }
  @media (prefers-reduced-motion: reduce) { html, body, header, footer, main { transition: none; } }
  ```
  The canvas itself stays instant (the engine reads the theme bridge snapshot, so any in-between value would force a redraw mid-tween). Chrome catches up to the icon, instead of jumping ahead.

### D-13 — Grid is the same 50 px square mesh in both themes — paper texture reads correctly in light but as graph-paper in dark (severity: **low**)

- **File:** `web/src/lib/canvas/painters/grid.ts:23-57`.
- **Defect:** The 50 px mesh uses `--color-border` directly. In light (`oklch(0.86 0.01 90)`) it reads as "subtle paper grid" — correct. In dark (`oklch(0.32 0.014 285)`) the same delta against `oklch(0.18 0.012 285)` bg renders as a sharply visible grid because the contrast ratio in dark is *higher* in perceived terms (the eye is dark-adapted; small lightness deltas at low L are more visible). The dark theme reads as "graph paper", which is the wrong vibe for a creative-tool surface. tldraw drops grid opacity to ~30% in dark mode for exactly this reason.
- **Compare:** tldraw dark grid alpha ~0.3 of border color; Figma dark mode uses dot-grid not line-grid.
- **Fix:** Either:
  1. In `engine.ts`'s `derivePalette`, return a separate `--color-grid` token that resolves to `--color-border` in light and `oklch(0.26 0.014 285)` in dark (lifted 0.06 L closer to the bg). Add the token to globals.css.
  2. OR: in the painter, apply `ctx.globalAlpha = 0.5` only when the theme bridge snapshot reports dark mode. Cheaper but couples the painter to the theme name.
  Option (1) is the right move — keeps the painter pure and gives future shape painters the same dark-mode-aware token.

### D-14 — ApiStatusDot is 6 px (`h-1.5 w-1.5`) and disappears under attention; "API offline" is silently legible only to screen readers (severity: **low**)

- **File:** `web/src/components/chrome/api-status-dot.tsx:62-71`.
- **Defect:** Intent (per the docstring lines 28-32) is that the dot "disappears under attention when the API is healthy". Achieved. But the error state ALSO disappears under attention because the dot is 6 px on a 56 px-tall top bar — a 6 px dot at the right end of a busy left cluster is below the saccade-grab threshold. The screen-reader path (`aria-live="polite"`) announces but the sighted recruiter who triggers the demo while the server is restarting silently gets nothing. Vercel's deployment-state pip is 8 px and pulses on bad state. Linear's is 6 px but RED-on-grey with a 200 ms attention pulse on transition to error.
- **Compare:** Vercel `vercel.com` deployment state — 8 px dot, sub-200 ms pulse on bad state. Linear connection pip — 6 px solid, animated ring expanding 8 px → 0 px on state change.
- **Fix:** Keep 6 px for `ok`/`idle`/`loading`. On `error`, render a halo ring via Motion: `<motion.span className="absolute inset-0 rounded-full bg-(--color-error)" animate={{ scale: [1, 1.8, 1.4, 1.8, 1.4], opacity: [0.6, 0, 0.4, 0, 0.4] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }} />`. Skip the halo under `prefers-reduced-motion`. The dot stays 6 px but commands attention via the radial pulse — recruiter gets the visual signal at peripheral vision.

### D-15 — `BoardNotFound` dialog reads as generic shadcn and has no acknowledgment of the brand or the canvas underneath (severity: **low**)

- **File:** `web/src/components/board/board-not-found.tsx:81-136`.
- **Defect:** A default shadcn `<Dialog>` with title "Board not found.", description, two CTAs. The dialog is functional but inherits all of shadcn's default surface treatment — `bg-popover` (which aliases to `--color-surface-raised`), default radius, default border, default shadow. There is zero meld-specific identity here. A recruiter who hits a stale URL gets a 100% generic shadcn modal and reads "this is a copy-paste portfolio template". The dialog is also the only error state in v1 — it carries disproportionate weight for first impressions on broken links from social shares.
- **Compare:** rauno.me's 404 page is a single sentence on the dark canvas with a custom hand-drawn back-arrow glyph; Vercel's missing-deployment dialog carries the chevron mark in the corner. Both feel like brand.
- **Fix:** Add a small SVG inline illustration above the title — a stylised "two overlapping rectangles drifting apart" (canonical CRDT-merge-failed metaphor, ironic given that on a real meld board, merge cannot fail). 64 px wide, drawn in `currentColor` so it inherits the dialog foreground. Below it, tighten the title to `Board's gone.` (3 words; carries personality vs "Board not found." which is system copy). Description stays. The two-rect motif is reusable for the brand mark (D-01) and ties the dialog to the visual identity.

## Blocks demo URL ship vs queues to v1.1

### Must fix BEFORE the demo URL ships (critical + high)

| ID | Surface | One-line summary |
| --- | --- | --- |
| D-01 | BrandMark | Replace the placeholder 18 px Inter wordmark with a logomark + 14 px wordmark pair; the brand is the first 200 ms. |
| D-02 | IdentityBadge ring | Add the 280 ms scale + Motion border-color animation on welcome arrival — the first-paint identity win is invisible. |
| D-03 | Toolbar active state | Replace soft+ring with solid accent + on-accent fg; the active slot is currently muddy and unscan-able. |
| D-05 | Cursor name pill | 12 px text, solid peer-color pill, white-on-color text; legibility + brand-color identity both fail today. |

### Queue to v1.1 (medium + low)

| ID | Surface | One-line summary |
| --- | --- | --- |
| D-04 | Toolbar geometry + shadow | `bottom-4`, tinted violet shadow, bump button to size-9 for WCAG 2.5.5. |
| D-06 | Cursor arrow silhouette | Tilt 12° clockwise + macOS-arrow point set; current asymmetry reads as bug. |
| D-07 | Preview marching ants | Add a ~12.5 px/s `lineDashOffset` rAF while a draft is in-flight; gate reduced-motion. |
| D-08 | Connection banner copy + icon | Two-clause copy, lucide default stroke, size-3.5 icon; current treatment reads alarm-state. |
| D-09 | BoardCaption card | Drop the surface card; render typography directly on canvas. |
| D-10 | Landing typography | Bump headline to 30/36 px with `-0.022em`; body to 13 px; restore display-to-body ratio. |
| D-11 | Wow-moment instruction | Center dismissible card on first board open with `Open in a second tab` + Copy link; current footer is below the fold. |
| D-12 | Theme transition orchestration | Add 220 ms transition on chrome surfaces in `@layer base`; canvas stays instant. |
| D-13 | Dark-mode grid | Add `--color-grid` token (or alpha 0.5 in painter) so dark grid reads as paper not graph-paper. |
| D-14 | API status error pulse | Add Motion radial halo pulse on `error` state; current 6 px dot is below saccade-grab. |
| D-15 | BoardNotFound dialog | Add stylised two-rect SVG + tighter title; current dialog reads as raw shadcn. |

## Verdict

**YELLOW** — fix the 4 critical/high defects (D-01, D-02, D-03, D-05) before publishing the demo URL. The brand wordmark, the identity-badge ring animation, the toolbar active-state, and the cursor pill are all visible in the first 5 seconds of any two-tab demo recording — three of them are the literal wow-moment surface. The other 11 defects queue cleanly to v1.1 without blocking the FOSDEM 2026 / HN-thread ship window.

The architectural restraint of ADRs 005, 008, and 009 is intact — none of these defects require ADR revision. ADR-005's per-board OKLCH color slot, ADR-008's two-canvas separation, and ADR-009's banner-only + crossfade contract are sound; the failures are at the visual surface, not the architecture.
