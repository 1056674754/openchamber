# Settings

## Purpose

`packages/ui/src/lib/settings` owns what an OpenChamber setting *is*: its key, its scope, how a value is parsed at the boundary, and where the UI keeps its live copy. The storage and sync mechanics (debounced writes, mirrors, bootstrap adoption) live in `lib/persistence.ts` and consume this module; the Settings pages consume the stores.

## Fork transition state (port of upstream 82a0ee757, D2: coexistence)

Upstream derives `DesktopSettings` from the registry and routes every read and write through it. This fork still carries settings for features that have not been ported from upstream yet, so this batch lands the registry as the **new channel** beside the existing path instead of switching over:

- The canonical document type stays the hand-written `DesktopSettings` in `@/lib/desktop`; the registry table is type-checked against it (every key must have an entry; every parser must produce the key's exact type). A later batch flips the derivation once the fork's key set converges with upstream.
- The fork's existing fetch/apply/save path (`sanitizeWebSettings`, `applyDesktopUiPreferences`, `updateDesktopSettings`) is unchanged and remains the boundary for now; `parseSettingsDocument` / `applySettingsToStores` are the shared path new consumers use.
- Keys for not-yet-ported upstream features (terminal shells, work status, enter-to-send, large-text paste, mermaid mode, …) join the table with their feature ports; until then they are absent, not stubbed.
- Device-scoped keys the fork still round-trips through the server today (window controls, mobile keyboard mode, input bar offset) keep their `device` scope but stay writable until the client migration stops sending them; genuinely local keys are marked `local` and the server gate rejects them, matching the fork server's behavior today.
- `search.ts` (the settings search index) is not ported yet: it needs the extended `SettingsRuntimeContext` (`isMac`/`isWindows`/…) and search i18n keys that arrive with the settings-search feature port.

## Modules

- `registry.ts` — the settings registry. One `SETTINGS_REGISTRY` table plus two key lists (`LOCAL_DEVICE_KEYS`, `DESKTOP_SHELL_KEYS`) and the derived helpers other modules use: `SettingsKey`, `parseSettingsDocument`, `applySettingsToStores`, `AUTO_SAVE_KEYS` / `readAutoSaveSnapshot`, `MIRRORED_KEYS`, `buildSettingsRegistrySnapshot`.
- `parsers.ts` — value-level boundary parsers (zod schemas wrapped as `SettingsParser<T>`). `undefined` means "reject", never "default".
- `registry-snapshot.ts` — renders the plain-JSON snapshot for the two consumers that cannot import the UI's TypeScript: the OpenChamber server (`packages/web/server/lib/opencode/settings-registry.json`) and the VS Code extension host (`packages/vscode/src/settings-registry.json`). Regenerate with `bun run settings-registry:generate`; `registry.test.ts` fails when a checked-in copy is stale.
- `metadata.ts` — Settings page metadata (pre-existing in this fork; the upstream `search.ts` companion is deferred, see above).

## Invariants

- **A key that is not in the registry does not persist (through the new channel).** `parseSettingsDocument` drops unknown keys on the way in; the server and the VS Code bridge drop anything the snapshot does not list. The fork's legacy `sanitizeWebSettings` path keeps its own list until the switchover batch.
- **Every key has exactly one scope.** `instance` (a fact about the machine the server runs on, never synced), `profile` (the person's preference, shared by every client of the instance), `device` (state of this install/surface). `LOCAL_DEVICE_KEYS` are device fields that only ever lived in `useUIStore`'s persisted slice; `DESKTOP_SHELL_KEYS` are instance facts the Electron main process writes straight into `settings.json` and no client reads.
- **Missing is not default.** `applySettingsToStores` writes only the fields the snapshot carries; an omitted field leaves the store as it is. Defaults live in the stores' initial state, not in the registry.
- **Writes carry intent.** Fields with `ui.autoSave` are the ones a store-subscribing auto-save watches once it is wired to the shared path; the fork's existing `appearanceAutoSave` / `modelPrefsAutoSave` behavior is unchanged in this batch.
- **Sibling-dependent applies are explicit.** A `ui.write` receives the parsed snapshot as `SettingsSiblingView`, which names the only siblings a write may consult (`draftStartersScheduleTaskAdded`). Extend the view when a new field needs one.
- **Markers, not code, carry the special cases.** `adopt: 'bootstrap-only'` (workspace pointers), `derived` (computed by the writer from other fields), `secret` (accepted on write, never returned), `computed` (server-emitted, never persisted), `local` (store-only, never crosses the wire), `surfaces` (which surface kinds have the field).

## Adding a setting

1. Add one entry to `SETTINGS_REGISTRY` with `scope`, a parser from `parsers.ts`, and a `ui` binding when a store holds the live value. Use an existing setter so its side effects run. The mapped table annotation fails the type-check when a `DesktopSettings` key is missing or a parser produces the wrong type.
2. Run `bun run settings-registry:generate` and commit both JSON snapshots.
3. If the server must validate the value beyond the registry gate, add its branch to `sanitizeSettingsUpdate` in `packages/web/server/lib/opencode/settings-helpers.js`; the drift test in `settings-helpers.test.js` needs a valid sample value for the new key.
