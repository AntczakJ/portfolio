import type { ReactNode } from 'react';

/**
 * JsonLd (Task 6.3) — render a JSON-LD structured-data block.
 *
 * A Server Component that emits a `<script type="application/ld+json">` with the
 * serialized data. `JSON.stringify` output is HTML-safe for a script of this type
 * (the only escape concern is a literal `</script>`, which we guard by escaping
 * the `<` — defensive, though our schema contains no such substring). No client
 * JS is involved; this is static markup that ships in the SSR HTML for crawlers.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }): ReactNode {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      // The content is our own static schema object, serialized + escaped above.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
