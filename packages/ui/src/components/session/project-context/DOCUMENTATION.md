# Project Knowledge panel

Project-owned Notes, Todo and saved Plans for the directory currently shown by
the chat. The desktop Context rail, legacy right sidebar and mobile workspace
drawer all render this same panel through `ProjectContextPanel`.

## Authority

`RightSidebarTabs.tsx` resolves the project from `useEffectiveDirectory()` and
`availableWorktreesByProject`. It must not use `activeProjectId` while a
Session/draft directory exists. The resulting `ProjectRef` carries both the
owning project path and `serverId`; every API request routes through that
explicit instance.

An unresolved directory renders the missing-project state. It never falls back
to a local project merely because that project is active elsewhere in the UI.

## Data flow

```text
project-context server routes
        |
projectContextApi (explicit server + project id)
        |
useProjectContextStore (last-known-good cache + optimistic rollback)
        |
ProjectNotesTodoPanel -> NotesSection / TodosSection / PlansSection
```

The UI does not read storage paths. Project context is server-owned under
`<projectsDir>/<path-derived-project-id>/context.json`; plan markdown stays in
that directory's `plans/` folder and is addressed by plan id.

## Layout

Content is left of a resizable section sidebar. One search query filters all
three sections and their navigation rows show result counts. When the current
section has no result but another does, search follows the first matching
section.

There is one content scroller. `ProjectContextPanel` therefore uses
`overflow-hidden`; nesting another host scroller makes long notes and plans
fight the panel for wheel input.

## Notes

- Each note is an independent card and server record.
- Only one note is expanded at a time.
- Edits are local and debounce for 400ms.
- A blank body is restored instead of sent; deletion is explicit.
- A server update is adopted only while the local draft is untouched.
- Load/save failure keeps the last good list and exposes the raw store error.

## Todo

Todo writes replace only the todo list. Display order sinks completed items to
the bottom, while persistence and drag operations always use the complete
unfiltered list. Items can still be sent to the current Session, a new Session,
or a new worktree Session.

## Plans

Plans import markdown into server-owned storage. Opening one replaces the list
with a lazy `PlanView` in the same panel. `PlanView.projectPlanId` reads and
saves raw markdown through the project-context routes; it never exposes or
reconstructs the underlying path.

## Session-scoped pins

Note and plan pin controls attach ids to the current Session metadata, or to a
new draft until its Session is created. The server assembles and signs the
knowledge block; the UI only carries the returned synthetic part and reports
delivery after the prompt is accepted. Scheduled tasks, agent-dispatched
Sessions and post-compaction restoration call the same server runtime.

## Deferred v1.20 scope

Agent Memory remains deferred. It is feature-gated upstream and requires
its server runtime, tool actions and project-owner resolution together; this
panel must not show a Memory tab before those pieces exist.

## Tests

- `useProjectContextStore.test.ts`: last-known-good, optimistic rollback,
  mutation/load races and write serialization.
- `projectContextApi.test.ts`: path-derived ids and explicit remote routing.
- server `project-context` tests: atomic storage, legacy migration, CRUD and
  HTTP error semantics.
