/**
 * Emoji whitelist for the anonymous-session identity scheme (ADR-005).
 *
 * 128 single-codepoint emoji from Unicode 15.1, drawn from the
 * animals + nature + food + drink blocks (0x1F32D-0x1F370 for plants
 * and food, 0x1F400-0x1F43E for animals). 128 = 2^7 — a power-of-two
 * modulo space gives uniform FNV-1a distribution per ADR-005's
 * `emojiFor(sessionId) = fnv1a32(sessionId) % 128`.
 *
 * Sort invariant — load-bearing.
 *
 *   The array is sorted lexicographically by Unicode codepoint
 *   (numeric ascending). This is the contract every visitor's
 *   `sessionId -> emoji` derivation depends on: if the array order
 *   changes, every previously-minted session id silently re-assigns
 *   to a different emoji on the next reload, which is a worse UX
 *   than any benefit from re-curation.
 *
 *   Therefore: this file is APPEND-ONLY past index 127. If a future
 *   ADR-revision wants to widen the pool to 256, the new entries are
 *   appended at the end (regardless of codepoint order — the sort
 *   invariant holds only for the original 128) AND the modulo space
 *   is split into "old slots" vs "new slots" in a separate derivation
 *   helper. Removing or reordering an existing entry requires bumping
 *   a session-version field in the cookie payload.
 *
 *   If you DO add an emoji during a v1-scope curation pass (e.g.,
 *   replacing one that renders blank on a target platform), the
 *   replacement MUST keep the same array index — write a new
 *   `{ char, name }` object at the same position, do not reorder the
 *   tail.
 *
 * Single-codepoint constraint.
 *
 *   Every entry is a single Unicode scalar value in the supplementary
 *   plane (U+1F32D and above). NO ZWJ sequences (no families,
 *   profession + skin tone, etc.), NO skin-tone modifiers, NO
 *   regional indicator pairs (no flags). The constraint keeps string
 *   slicing + equality + length comparisons single-codepoint-safe
 *   across the runtime contract (welcome frame payload, frontend
 *   render, screen-reader label lookup).
 *
 * Format.
 *
 *   `{ char: string, name: string }`. `char` is the emoji codepoint
 *   (encoded as `\u{...}` for transport-safe ASCII source). `name` is
 *   a lowercase kebab-case ASCII noun usable as an aria-label
 *   ('otter', 'mushroom', 'soft-ice-cream'). The frontend renders the
 *   `char` and binds the `name` to the visible / accessible label.
 *
 *   `as const` freezes the literal types so `EmojiName` resolves to a
 *   union of every entry's `char` literal. The derived emoji helper
 *   returns this narrow type, not a wide `string`.
 *
 * Where this is consumed.
 *
 *   - `src/lib/session/emoji.ts` — `emojiFor(sessionId)` looks up
 *     `EMOJI_WHITELIST[fnv1a32(sessionId) % 128]`.
 *   - `src/lib/session/cookie.ts` — middleware stashes the derived
 *     emoji on the request context.
 *   - The Hocuspocus welcome-frame builder (Task 1.7b — NOT this
 *     task) reads the same helper to populate `session.emojiName` on
 *     the wire.
 *
 *   The frontend does NOT bundle this whitelist — the welcome frame
 *   carries the codepoint string directly per the AGENT_NOTES.md
 *   "Emoji whitelist convention" pin.
 */

export const EMOJI_WHITELIST = [
  { char: '\u{1F32D}', name: 'hot-dog' },
  { char: '\u{1F32E}', name: 'taco' },
  { char: '\u{1F32F}', name: 'burrito' },
  { char: '\u{1F330}', name: 'chestnut' },
  { char: '\u{1F331}', name: 'seedling' },
  { char: '\u{1F332}', name: 'evergreen-tree' },
  { char: '\u{1F333}', name: 'deciduous-tree' },
  { char: '\u{1F334}', name: 'palm-tree' },
  { char: '\u{1F335}', name: 'cactus' },
  { char: '\u{1F337}', name: 'tulip' },
  { char: '\u{1F338}', name: 'cherry-blossom' },
  { char: '\u{1F339}', name: 'rose' },
  { char: '\u{1F33A}', name: 'hibiscus' },
  { char: '\u{1F33B}', name: 'sunflower' },
  { char: '\u{1F33D}', name: 'corn' },
  { char: '\u{1F33E}', name: 'ear-of-rice' },
  { char: '\u{1F33F}', name: 'herb' },
  { char: '\u{1F340}', name: 'four-leaf-clover' },
  { char: '\u{1F341}', name: 'maple-leaf' },
  { char: '\u{1F342}', name: 'fallen-leaf' },
  { char: '\u{1F343}', name: 'leaf' },
  { char: '\u{1F345}', name: 'tomato' },
  { char: '\u{1F346}', name: 'eggplant' },
  { char: '\u{1F347}', name: 'grapes' },
  { char: '\u{1F348}', name: 'melon' },
  { char: '\u{1F349}', name: 'watermelon' },
  { char: '\u{1F34A}', name: 'tangerine' },
  { char: '\u{1F34B}', name: 'lemon' },
  { char: '\u{1F34C}', name: 'banana' },
  { char: '\u{1F34D}', name: 'pineapple' },
  { char: '\u{1F34E}', name: 'red-apple' },
  { char: '\u{1F34F}', name: 'green-apple' },
  { char: '\u{1F350}', name: 'pear' },
  { char: '\u{1F351}', name: 'peach' },
  { char: '\u{1F352}', name: 'cherries' },
  { char: '\u{1F353}', name: 'strawberry' },
  { char: '\u{1F354}', name: 'hamburger' },
  { char: '\u{1F355}', name: 'pizza' },
  { char: '\u{1F356}', name: 'meat' },
  { char: '\u{1F357}', name: 'poultry' },
  { char: '\u{1F358}', name: 'rice-ball' },
  { char: '\u{1F359}', name: 'rice-cracker' },
  { char: '\u{1F35A}', name: 'rice' },
  { char: '\u{1F35B}', name: 'curry' },
  { char: '\u{1F35C}', name: 'ramen' },
  { char: '\u{1F35D}', name: 'spaghetti' },
  { char: '\u{1F35E}', name: 'bread' },
  { char: '\u{1F35F}', name: 'fries' },
  { char: '\u{1F360}', name: 'sweet-potato' },
  { char: '\u{1F361}', name: 'dango' },
  { char: '\u{1F362}', name: 'oden' },
  { char: '\u{1F363}', name: 'sushi' },
  { char: '\u{1F364}', name: 'fried-shrimp' },
  { char: '\u{1F365}', name: 'fish-cake' },
  { char: '\u{1F366}', name: 'soft-ice-cream' },
  { char: '\u{1F367}', name: 'shaved-ice' },
  { char: '\u{1F368}', name: 'ice-cream' },
  { char: '\u{1F369}', name: 'donut' },
  { char: '\u{1F36A}', name: 'cookie' },
  { char: '\u{1F36B}', name: 'chocolate-bar' },
  { char: '\u{1F36C}', name: 'candy' },
  { char: '\u{1F36D}', name: 'lollipop' },
  { char: '\u{1F36E}', name: 'custard' },
  { char: '\u{1F36F}', name: 'honey-pot' },
  { char: '\u{1F370}', name: 'cake' },
  { char: '\u{1F400}', name: 'rat' },
  { char: '\u{1F401}', name: 'mouse' },
  { char: '\u{1F402}', name: 'ox' },
  { char: '\u{1F403}', name: 'water-buffalo' },
  { char: '\u{1F404}', name: 'cow' },
  { char: '\u{1F405}', name: 'tiger' },
  { char: '\u{1F406}', name: 'leopard' },
  { char: '\u{1F407}', name: 'rabbit' },
  { char: '\u{1F408}', name: 'cat' },
  { char: '\u{1F409}', name: 'dragon' },
  { char: '\u{1F40A}', name: 'crocodile' },
  { char: '\u{1F40B}', name: 'whale' },
  { char: '\u{1F40C}', name: 'snail' },
  { char: '\u{1F40D}', name: 'snake' },
  { char: '\u{1F40E}', name: 'horse' },
  { char: '\u{1F40F}', name: 'ram' },
  { char: '\u{1F410}', name: 'goat' },
  { char: '\u{1F411}', name: 'ewe' },
  { char: '\u{1F412}', name: 'monkey' },
  { char: '\u{1F413}', name: 'rooster' },
  { char: '\u{1F414}', name: 'chicken' },
  { char: '\u{1F415}', name: 'dog' },
  { char: '\u{1F416}', name: 'pig' },
  { char: '\u{1F417}', name: 'boar' },
  { char: '\u{1F418}', name: 'elephant' },
  { char: '\u{1F419}', name: 'octopus' },
  { char: '\u{1F41A}', name: 'shell' },
  { char: '\u{1F41B}', name: 'bug' },
  { char: '\u{1F41C}', name: 'ant' },
  { char: '\u{1F41D}', name: 'honeybee' },
  { char: '\u{1F41E}', name: 'ladybug' },
  { char: '\u{1F41F}', name: 'fish' },
  { char: '\u{1F420}', name: 'tropical-fish' },
  { char: '\u{1F421}', name: 'blowfish' },
  { char: '\u{1F422}', name: 'turtle' },
  { char: '\u{1F423}', name: 'hatching-chick' },
  { char: '\u{1F424}', name: 'baby-chick' },
  { char: '\u{1F425}', name: 'front-facing-baby-chick' },
  { char: '\u{1F426}', name: 'bird' },
  { char: '\u{1F427}', name: 'penguin' },
  { char: '\u{1F428}', name: 'koala' },
  { char: '\u{1F429}', name: 'poodle' },
  { char: '\u{1F42A}', name: 'camel' },
  { char: '\u{1F42B}', name: 'two-hump-camel' },
  { char: '\u{1F42C}', name: 'dolphin' },
  { char: '\u{1F42D}', name: 'mouse-face' },
  { char: '\u{1F42E}', name: 'cow-face' },
  { char: '\u{1F42F}', name: 'tiger-face' },
  { char: '\u{1F430}', name: 'rabbit-face' },
  { char: '\u{1F431}', name: 'cat-face' },
  { char: '\u{1F432}', name: 'dragon-face' },
  { char: '\u{1F433}', name: 'spouting-whale' },
  { char: '\u{1F434}', name: 'horse-face' },
  { char: '\u{1F435}', name: 'monkey-face' },
  { char: '\u{1F436}', name: 'dog-face' },
  { char: '\u{1F437}', name: 'pig-face' },
  { char: '\u{1F438}', name: 'frog' },
  { char: '\u{1F439}', name: 'hamster' },
  { char: '\u{1F43A}', name: 'wolf' },
  { char: '\u{1F43B}', name: 'bear' },
  { char: '\u{1F43C}', name: 'panda' },
  { char: '\u{1F43D}', name: 'pig-nose' },
  { char: '\u{1F43E}', name: 'paw-prints' },
] as const;

/**
 * The narrow `char` union — every entry's `char` literal joined by `|`.
 * Returned by `emojiFor()` so consumers see the exhaustive type rather
 * than a wide `string`.
 */
export type EmojiName = (typeof EMOJI_WHITELIST)[number]['char'];

/**
 * Single entry shape — `{ char, name }`. Re-exported for downstream
 * helpers that want to pass the whole record (e.g., welcome-frame
 * builder).
 */
export type EmojiEntry = (typeof EMOJI_WHITELIST)[number];

/**
 * The whitelist size. Exported as a literal-typed constant so the
 * modulo space in `emojiFor` / call sites stays a number that the
 * type system understands as exactly 128 (not a wide `number`).
 */
export const EMOJI_WHITELIST_SIZE = 128 as const;
