// KaTeX's stylesheet must be imported through JavaScript at the app entry
// points. A JS import makes Vite resolve the stylesheet's relative
// `url(fonts/...)` references and emit the KaTeX_* font files; loading the CSS
// lazily from the markdown renderer chunk instead injects a stylesheet late on
// the first markdown render, whose style recalc briefly lost the layered
// `.chat-message-column` width clamp and flashed message text to full width.
//
// Every app entry point that loads `styles/fonts` must also load this module,
// before index.css, so the base stylesheet stays ahead of the theme overrides
// in index.css.
import 'katex/dist/katex.min.css';
