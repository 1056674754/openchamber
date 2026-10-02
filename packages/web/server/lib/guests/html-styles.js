import { GUEST_SCROLLBAR_CSS } from '@openchamber/sdk';

// The panel iframe inherits the host's dark color scheme, and a document that
// does not declare one gets an opaque white canvas until its own theme loads:
// a white flash on every mount (upstream #4017, d0af2666e). The declaration
// has to precede the first paint, so it goes first: right after a leading
// doctype (matched only at the very start, never inside authored markup),
// else before all.
const GUEST_COLOR_SCHEME_META = '<meta name="color-scheme" content="light dark">';
const LEADING_DOCTYPE = /^\s*<!doctype[^>]*>/i;

const declareColorScheme = (html) => {
  const doctype = LEADING_DOCTYPE.exec(html)?.[0] ?? '';
  return `${doctype}${GUEST_COLOR_SCHEME_META}${html.slice(doctype.length)}`;
};

/** Append instead of matching tags inside untrusted comments, scripts, or templates (the one
 * exception is the color-scheme meta, placed after a leading doctype; see above).
 * Browsers accept the style after the document; its doctype and authored CSP stay intact.
 */
export const injectGuestDocumentStyles = (html) => `${declareColorScheme(html)}\n<style data-openchamber-guest-styles>${GUEST_SCROLLBAR_CSS}</style>`;
