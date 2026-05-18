# fix: display selected source label in skills catalog dropdown (#1270)

**Upstream**: `945ffa17`  
**Date**: 2026-05-15  
**Files**: `packages/ui/src/components/sections/skills/catalog/SkillsCatalogPage.tsx` (+3, -1)

## What upstream did

Fixed the skills catalog dropdown to show the selected source label instead of being blank.

## Merge decision: ALREADY MERGED

Our `SkillsCatalogPage.tsx` matches upstream exactly.

## Verification

```
git diff v1.11.1 HEAD -- packages/ui/src/components/sections/skills/catalog/SkillsCatalogPage.tsx → MATCH
```

## Status

Complete. No action needed.
