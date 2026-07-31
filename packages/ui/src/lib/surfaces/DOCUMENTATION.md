# Context Surface Registry

## Purpose

`registry.ts` is the shared definition of Context Panel surfaces. It owns each
surface's stable ID, label key, icon, availability rule, default width, and
ordering normalization.

The registry does not own rendered content or runtime data. `ContextPanel.tsx`
maps an opened surface to its existing view, while `ContextPanelRail.tsx`
renders and reorders the currently available surface buttons.

## State authority

- Open tabs, active mode, rail order, and widths live in `useUIStore`.
- Widths are persisted by normalized `directory + mode`; changing projects
  must not reuse another project's width.
- Preview and embedded Chat are available only when their backing content
  exists. Plan remains controlled by its existing feature flag.
- Git, PR, Files, Terminal, Notes, and other runtime views must resolve their
  data from the active instance and directory rather than a global directory.

## Responsive behavior

The desktop rail remains visible at widths where the Context Panel can share
the viewport without overflow. At the mobile breakpoint the rail and desktop
panel are hidden so they cannot compress or cover the shared mobile Chat
surface.
