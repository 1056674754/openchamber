# fix: hide branch selection for non-git projects in draft session

**Upstream**: `a314411f`  
**Date**: 2026-05-15  
**Files**: `packages/ui/src/components/chat/ChatInput.tsx` (+16, -3)

## What upstream did

In the draft session flow, hides the branch selector when the project is not a Git repository. Uses `useIsGitRepo` from `useGitStore`.

## Our divergence

Our `ChatInput.tsx` has significant custom changes:
- Queue mode with Ctrl+Enter toggle
- Custom send/queue button UI
- Multi-instance directory handling

The upstream branch-hiding fix may or may not be present in our version. Need to check if `useIsGitRepo` is imported and used in the draft session section.

## Merge decision: ALREADY MERGED

Our `ChatInput.tsx` has `useIsGitRepo` imported and used in both the main chat flow and draft session flow:
- Line 54: `import { useGitBranches, useGitStore, useIsGitRepo } from '@/stores/useGitStore'`
- Line 875: `const isGitRepo = useIsGitRepo(currentDirectory)`
- Line 3115: `const selectedDraftProjectIsGitRepo = useIsGitRepo(selectedDraftProjectPath)`

Matches upstream usage exactly (same line counts: import + 2 usage sites).

## Status

Complete. No action needed.
