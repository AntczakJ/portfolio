/**
 * Emoji derivation helper (ADR-005).
 *
 * `emojiFor(sessionId)` resolves the deterministic identity-emoji for a
 * session id by hashing the id via FNV-1a 32-bit and looking up the
 * entry at `(hash % 128)` in the whitelist.
 *
 * The returned record carries BOTH the `char` (rendered codepoint, e.g.
 * for the welcome frame `session.emojiName` field — though "name" is
 * the historical wire-field name from ADR-005, the value travels as
 * the codepoint string) AND the `name` (lowercase kebab-case ASCII
 * aria-label). Welcome-frame builders use `char` for the wire payload
 * and stash `name` for any server-side log line that needs to be
 * grep-safe (a log line containing a literal supplementary-plane
 * codepoint does not always render in operator terminals).
 *
 * The hash is the FNV-1a 32-bit from `./fnv1a` — same algorithm the
 * frontend will mirror in `meld-web/src/lib/identity/derive-emoji-name.ts`
 * once Task 2.5b lands. Per the ADR-005 / AGENT_NOTES.md "OKLCH
 * palette duplicated server-side AND client-side" pin, the algorithm
 * is documented in both places as a known duplication; this file is
 * the canonical TypeScript form server-side.
 */

import {
  EMOJI_WHITELIST,
  EMOJI_WHITELIST_SIZE,
  type EmojiEntry,
} from './emoji-names';
import { fnv1a32 } from './fnv1a';

/**
 * Resolve the deterministic emoji entry for `sessionId`. Same session
 * id always returns the same entry across reloads, restarts, and
 * processes — the entire derivation is a pure function of `sessionId`
 * + the (append-only) whitelist.
 *
 * Distribution: FNV-1a 32-bit mod 128 is uniform on uniformly random
 * inputs (`crypto.randomUUID()` produces uniformly random hex). Two
 * concurrent users on the same board have a ~6.5% chance of an emoji
 * collision (birthday-paradox-style); collisions become noticeable
 * around 13 concurrent users which is well past the typical demo
 * board's user count.
 */
export function emojiFor(sessionId: string): EmojiEntry {
  const slot = fnv1a32(sessionId) % EMOJI_WHITELIST_SIZE;
  // The lookup is safe at runtime: `EMOJI_WHITELIST_SIZE` is a literal
  // 128, the array is 128 entries long, and `fnv1a32 % 128` is in
  // `[0, 127]`. The `?? EMOJI_WHITELIST[0]` fallback satisfies
  // `noUncheckedIndexedAccess` and the `no-non-null-assertion` lint
  // without a runtime branch worth measuring — `EMOJI_WHITELIST[0]`
  // is the same literal-typed value at every call. Same fallback
  // shape as `routes/boards.ts` `pickDefaultBoardName`.
  return EMOJI_WHITELIST[slot] ?? EMOJI_WHITELIST[0];
}
