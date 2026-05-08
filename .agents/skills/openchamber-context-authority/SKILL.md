---
name: openchamber-context-authority
description: Use when changing OpenChamber code that derives project, directory, session, remote server, routing, permission, question, filesystem, git, or header/sidebar context. Prevents bugs caused by using global active/current state instead of the current entity's authoritative context.
---

# OpenChamber Context Authority

When code needs project, directory, or server context, first identify the entity being acted on:

- Current session: use the session's authoritative directory, worktree attachment, or session-server index.
- Request/reply action: use the request's actual store/directory or the owning session directory.
- File/git/config operation: require explicit directory where mutation or read authority matters.
- Header/sidebar display: derive labels from the displayed/open session or directory, not from global selection.
- Session tree display: when a parent session is moved to a synthetic section such as Global Pinned, move/exclude its full descendant tree with it.

## Rules

- Do not treat `activeProjectId`, `currentDirectory`, `lastDirectory`, or `projects[0]` as authoritative for an existing session.
- Do not use global UI directory as a fallback for permission/question replies, session actions, prompt routing, command routing, file writes, or file reads.
- For display labels, match the current `openDirectory` or session directory to the longest owning project path. Use global active project only when there is no current session/directory.
- For pinned/recent/sidebar sections, preserve parent-child ownership. Never remove a parent from one section while leaving descendants to re-root in a project section.
- For remote sessions, route by `serverRegistry` session index first. Directory matching is secondary and must support subpaths under a remote project.
- If the authoritative context is missing, fail explicitly or show a missing-context state. Do not silently substitute the global UI context.

## Checklist

Before finalizing:

- Search changed code for `activeProjectId`, `getDirectory()`, `currentDirectory`, `lastDirectory`, `projects[0]`, `|| dir()`, and `?? dir()`.
- For every usage, confirm it is only for visual defaults, new-draft defaults, or navigation restoration.
- Verify existing-session actions keep web, desktop, VS Code, local, and remote behavior aligned.
