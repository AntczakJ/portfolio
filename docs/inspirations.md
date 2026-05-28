# Inspirations

These are the references the `frontend-engineer` reaches for when implementing UI and the `designer-critic` reaches for when calling out defects. They are not aspirations — they are the bar.

Update this file when you find something new worth stealing from. Remove entries that have decayed (sites get rebuilt and sometimes the magic leaves).

---

## Product polish

Sites that look like the company spent real money on their interface and it shows in every pixel.

- **Linear** — [linear.app](https://linear.app/) · Hierarchy, type system, motion timing on micro-interactions. Use as a baseline for "good marketing site" — if your project's home page does not hold up next to it, raise the bar.
- **Vercel** — [vercel.com](https://vercel.com/) · Restraint with energy. Dark surfaces, deliberate accents, dense information without feeling busy.
- **Stripe** — [stripe.com](https://stripe.com/) · Long-form scrolling pages with custom WebGL elements that justify their bundle cost. Type as a primary design element.

## Personal / portfolio sites

The work the designer-critic compares portfolio projects to. If your project's home page does not feel like it could live next to one of these, it is not done.

- **Rauno Freiberg** — [rauno.me](https://rauno.me/) · Restraint, type, deliberate motion, original details.
- **Aristide Benoist** — [aristide.io](https://aristide.io/) · Generative typography, kinetic transitions.
- **Olivier Larose** — [olivierlarose.com](https://www.olivierlarose.com/) · Scroll-driven storytelling, photographic art direction.

## Motion

References when picking easings, durations, choreography.

- **Codrops** — [tympanus.net/codrops](https://tympanus.net/codrops/) · Technique source. Most of the "how did they do that" answers are here.
- **Hyperplexed** — [youtube.com/@Hyperplexed](https://www.youtube.com/@Hyperplexed) · CSS/JS recreations of viral interactions, with code.
- **Awwwards SOTD / SOTM** — [awwwards.com](https://www.awwwards.com/) · Not for blind imitation, but for staying current on the bar.

## Type & layout

- **Linear**, **Stripe** (above) — variable fonts used with intent.
- **Klim Type Foundry** — [klim.co.nz](https://klim.co.nz/) · Specimen pages that demonstrate display type at its best.
- Any project that uses `font-variation-settings` to animate weight or width axes — collect references as you find them.

## 3D & WebGL

Reach for these only when the project committed to R3F.

- **Bruno Simon** — [bruno-simon.com](https://bruno-simon.com/) · The canonical "what's possible with three.js in a portfolio".
- **Stripe Sigma launch page, Vercel ship pages** — production-grade WebGL inside marketing pages.

## Microinteractions

- **Hyperplexed** (above) — short-form reference for the small stuff.
- **Linear** changelogs and command palette — for the "this feels alive" feeling at the smallest scale.

---

## How the designer-critic uses this file

For every critique, the designer-critic references **at least two** sites from above by name. Generic praise ("the motion is nice") is not a critique — comparison to a specific reference ("the hero transition takes 600 ms with a `linear` curve; Linear's equivalent takes 320 ms with `cubic-bezier(0.16, 1, 0.3, 1)` and the difference reads as the gap between 'animated' and 'designed'") is.

## How the frontend-engineer uses this file

Before starting a new visual element, skim the section that applies (motion, type, 3D). Steal a specific decision, not a vibe. If a reference suggests a better approach than what PLAN.md committed to, raise it in `AGENT_NOTES.md` and let the architect decide whether to revise the plan.
