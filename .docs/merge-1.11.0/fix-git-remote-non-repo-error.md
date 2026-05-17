# fix: silence git remote errors on non-repo directories

**Date**: 2026-05-16  
**Files**: `packages/web/server/lib/git/service.js`

## Problem

`getRemotes()` function called `simple-git`'s `git.getRemotes(true)` on any directory, including temp-sessions directories that are not git repositories. `simple-git` throws "fatal: not a git repository (or any of the parent directories): .git" for non-repo directories.

The error was caught, logged via `console.error`, and then **re-thrown**, propagating the error further up the call chain and producing noisy stack traces in server logs.

## Fix

Modified the catch block in `getRemotes()`: when the error message contains "not a git repository", return an empty array `[]` instead of re-throwing. Only log and re-throw for other (genuine) errors.