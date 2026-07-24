# Artifacts Module Documentation

## Purpose

Own the read-only HTTP surface for files published by the first-party OpenChamber plugin.
Published files live outside project worktrees so temporary-directory cleanup and project
switches do not remove user-facing deliverables.

## Entrypoint

- `registerArtifactRoutes(app, dependencies)` from `routes.js`
  - Registers `GET /api/artifacts/:artifactId/content`.
  - Resolves only 64-character lowercase SHA-256 publication IDs.
  - Reads immutable content and its `manifest.json` from
    `{openchamberDataDir}/artifacts/{artifactId}/`.
  - Serves safe image, text, and PDF MIME types inline.
  - Forces all other MIME types to download and applies a sandbox CSP.

## Ownership boundary

- The OpenChamber plugin owns publication, hashing, and manifest creation.
- This module never accepts filesystem paths from HTTP clients.
- The shared UI consumes artifact metadata persisted in an OpenCode tool part and addresses
  content only by artifact ID.
