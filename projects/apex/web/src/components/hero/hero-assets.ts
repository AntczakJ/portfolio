/**
 * Hero static-asset constants (Task 4.2).
 *
 * The blur-placeholder data URI for the hero <Image> (CLS-safe first paint).
 * It is a 16x9 AVIF thumbnail of the LIGHT hero render, produced by
 * `scripts/render-from-scene.mjs` (`pnpm -F apex-web renders:scene`) from the
 * live rig + the real GLB, and inlined here so the placeholder ships in the
 * markup (no extra request). Regenerate by re-running `renders:scene`, then
 * paste `public/renders/lumen-gt/hero-blur.txt`.
 */
export const HERO_BLUR_DATA_URL =
  'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAARgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAABAAAAAJAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAABObWRhdBIACgg4DP4YQENBpDI4GYAEEAAEAM+cYaKGvarFm4c/Qhl6ERIDMvlXbp7q41A9T6IVwXdTGRwXeJbiqn5bnOjUj+Bl9oA=';

/**
 * The dark "night-studio" counterpart blur (D-16). On the dark theme the
 * configurator stage and the dark hero crops must NOT flash the light blur
 * placeholder before the dark AVIF decodes — that read as a bright rectangle on
 * the near-black page. Produced alongside the light one by
 * `scripts/render-from-scene.mjs` (`hero-blur-dark.txt`) from the dark live rig.
 */
export const HERO_BLUR_DATA_URL_DARK =
  'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAAHgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAABAAAAAJAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAmbWRhdBIACgg4DP4YQENBpDIQGYAIIAAEAKP+Ws8GB8FogA==';
