# Markdown Image Grants

## Purpose

Authorize completed-assistant Markdown image galleries without exposing arbitrary filesystem paths as browser assets.

## Route

`POST /api/openchamber/sessions/:sessionId/markdown-image-grants`

The request carries the owning `directory`, assistant `messageId`, and 1-12 image `sources`. The server fetches the authoritative message from OpenCode and accepts only sources actually present in image syntax outside code spans and fences.

## File Policy

- Workspace images must resolve canonically inside the owning directory.
- External images are allowed only under OpenCode's dedicated temporary root (`<os.tmpdir()>/opencode`).
- Symlinks are resolved before root comparison.
- Files must be regular PNG/JPEG/GIF/WebP images no larger than 10 MiB, with a matching binary signature.
- External images receive a path-bound, `raw`-only FS grant that expires after 10 minutes.
- Missing/invalid images return per-source status without failing the whole gallery.

## Client Lifecycle

The UI prepares all local candidates in one message-level request when the gallery approaches the viewport. Individual thumbnail pixels load lazily, and grant expiry schedules a refresh before the raw asset URL expires.
