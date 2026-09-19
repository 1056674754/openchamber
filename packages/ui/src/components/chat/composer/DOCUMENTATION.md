# Composer

The chat composer: the prompt language, the editor that renders it, and
everything between typing and sending.

`ChatInput.tsx` (one directory up) is the orchestrator. It holds the composer's
own state and wires these modules together; it should not grow logic that
belongs to one of them.

## Floating panels

`ComposerFloatingPanel` (`ui/`) is the shared frame for `BtwPanel`,
`QueuedMessageChips`, and `SessionSuggestionChip`. They mount inside the
composer form at its end, outside the editor, with one absolute `bottom-full`
anchor, input-column width, gap, and glass surface. Appearing, disappearing,
or collapsing a panel does not resize the transcript or composer. The frame
also owns the header row through its `header` and `compact` props; collapsed
queue/BTW and the suggestion use the same compact header sizing.

Visibility priority is btw, then a nonempty queue, then suggestion. Every btw
frame, including its collapsed strip and creation state, hides the other two
(`isBtwPanelVisible` in `ChatInput`). Composer content also hides suggestion;
new-session drafts hide both queue and suggestion. Hiding the queue does not
pause its delivery.

The queue header toggles an `aria-expanded` disclosure with the current count.
Its collapse state is local to the mounted session queue and survives temporary
hiding behind btw; switching sessions resets it. The expanded list retains its
drag sensors, ordering, edit, send, and remove actions, and clamps to available
space above the composer.

The shared frame measures its height and gap into the composer's
`--chat-floating-panel-clearance` (written on the `[data-composer-bound]`
container in `ChatContainer`). `ScrollToBottomButton` translates upward by that
amount. Transcript height, insets, and scroll position remain unchanged.
Unmounting clears the offset; resizing or collapsing the frame updates it.

## Layers

| Directory | Owns |
|---|---|
| `language/` | What the text *means*: `@` references, `/` and `#` tokens, markdown, and which picker a caret asks for |
| `editor/` | The CodeMirror view that renders the language and owns the caret |
| `state/` | Popup placement relative to the CodeMirror caret |
| `attachments/` | Files: paths, drop payloads |
| `text.ts` | How inserted text meets the text already there |

The fork deliberately keeps submit, draft, queue/steer, mobile shell and
multi-instance targeting in `ChatInput.tsx` and the existing sync stores. The
upstream composer implementations of those policies assume a different
sidebar/runtime authority and are not copied as inactive parallel code.

## The prompt language

`language/` is the single source of truth for composer syntax. Everything that
needs to know what a token means — highlighting, send-time resolution, and the
autocomplete triggers — goes through it.

**This is the invariant that matters most in this module.** Before it existed,
the `@` rule was written four times with divergent cleanup and the `/` rule
three times with different valid character sets, so a token could be painted as
a reference and then not resolve as one. Adding a construct meant finding every
copy.

- `mentions.ts` — `@` references. The `start..end` span is the reference
  itself and is what gets highlighted; in `see @a/b.ts,` the comma is sentence
  punctuation, not part of the file being referenced. Mentions are plain
  editable text: deleting a character edits the token and reopens the mention
  picker, the same way `/skill` tokens behave — not an atomic delete.
- `prefixTokens.ts` — `/command`, `/skill`, `#snippet`. Scanning is deliberately
  generous; **membership in the command, skill or snippet registry is the
  authority**, not the pattern. An unknown `/token` stays plain prose.
- `triggers.ts` — which picker a caret position asks for. Exactly one can be
  active, with precedence `command > skill > snippet > mention`.
- `tokenize.ts` — one pass producing every highlight range. Adding a construct
  to the language means adding it here, once.

## The editor

`editor/` wraps CodeMirror. The document is a plain string: `getValue()` is
exactly what gets sent, so nothing downstream serializes a rich document model
back into a prompt.

The composer previously painted a transparent `<textarea>` over a mirror
`<div>`. That restricted highlighting to styles which do not change glyph
advance width — colour, background, underline — because anything else made the
mirror drift out from under the caret. Bold and italic were impossible, and the
overlay was disabled outright on mobile, where wrapped text drifted anyway.
**Those constraints are gone**; adding a width-affecting style is now a
question of design, not of feasibility.

Selection rendering: every device runs CodeMirror's `drawSelection()` — it
keeps typing on the drawn-selection code path, and removing it makes
CodeMirror enforce cursor association on the native selection, which iOS
answers with severe input lag. What differs is who paints the selection;
`composerSelectionExtension` (`editor/theme.ts`) picks once per editor.

Outside CodeMirror 6.43.9's exact iOS predicate,
`composerNativeSelectionExtension` re-shows the native selection and, only
while a range is selected, the native caret. The range-only caret scoping is
load-bearing: a native caret visible while typing makes WebKit repaint its
caret UI after every decoration update.

On CodeMirror's iOS branch, `composerIOSSelectionExtension` keeps the built-in
selection-handle geometry. It raises CodeMirror's existing selection layer
above opaque token backgrounds, expands the clipping area by the handles' 8px
overhang without moving text, and leaves the layer transparent to touch. The
synthetic selection rectangle is transparent because iOS still paints its
system highlight; drawing both produces visibly different stacked geometry.
Do not add custom handles or restore native selection paint on this branch.

`composerLanguage.ts` retokenizes the whole document on every change. The
composer holds a prompt, not a source file: it is short enough that a full pass
is cheaper and far simpler than incremental mapping, and it keeps the editor
and the send path reading the same grammar.

## Fork integration rules

- `ChatInput.tsx` owns send ordering. Queue items retain their captured
  provider/model/agent/variant and `serverId + directory` target; CodeMirror
  only replaces the text/caret surface.
- Draft persistence remains session-scoped in the fork and is not inferred
  from editor state.
- The autocomplete resolver is shared across `@`, `/` and `#`; exactly one
  picker is active at a time.
- Attachments and dropped paths use the pure helpers in `attachments/`, but
  the existing input store remains authoritative for upload and rollback.
- Mobile keyboard and viewport choreography remains in the established
  `ChatInput` hooks. The editor exposes `focus({ preventScroll: true })` and a
  bounded scroller so that choreography does not depend on a textarea.

## Testing

The package has no DOM test environment, so automated coverage stops at the
logic layers: the language, path and drop handling, text splicing, and the
CodeMirror language extension at the `EditorState` level.

Rendering, focus, keyboard behavior, IME and WKWebView are **not covered by
tests** and are verified by hand. Do not report a change to them as validated
on the strength of type-check and unit tests.

Run tests per file (`bun test <path>`): `mock.module` is process-global, so
suites that install module mocks are order-dependent.
