# OpenChamber Plugin Architecture

> OpenChamber as a dual-role application: **UI runtime** + **OpenCode in-process plugin**.

## Problem

OpenChamber sends image attachments to the OpenCode server regardless of whether
the selected model supports vision. When a user attaches an image to a non-vision
model (e.g. GLM coding models, DeepSeek Coder, many open-source models), the
request reaches the LLM provider, which returns a `400` error. The image is lost,
the turn fails, and the user gets an opaque toast.

OpenChamber **already knows** the model's modality capabilities
(`useConfigStore.ts` derives `modalities.input` from model metadata), but the send
path (`session-ui-store.ts` → `sanitizeAttachmentsForSend`) never checks them.

Meanwhile, the OpenCode upstream has three open PRs addressing this exact problem
(#30153, #29279, #21633), and Hermes Agent ships a production image-routing
pattern. The approach is well-validated; OpenChamber needs its own implementation.

## Solution: UI + Plugin Dual Architecture

OpenChamber already starts the OpenCode server (in-process for Electron, sidecar
for legacy Tauri). By shipping a **first-party plugin** that registers when
OpenCode boots, OpenChamber gains in-process hook access without modifying the
OpenCode core or depending on upstream PRs.

```
┌──────────────────────────────────────────────────┐
│  OpenCode Server Process                         │
│  ├── @openchamber/plugin (in-process)            │
│  │   ├── experimental.chat.messages.transform    │
│  │   ├── experimental.chat.system.transform      │
│  │   └── tool: { describe_image, ... }           │
│  └── HTTP + SSE Server                           │
└──────────────────────────────────────────────────┘
          ↑ HTTP + SSE (@opencode-ai/sdk)
┌──────────────────────────────────────────────────┐
│  OpenChamber UI (Electron / Web / VS Code)       │
│  ├── Modality-aware send path                    │
│  ├── Non-vision model image indicator            │
│  └── Vision MCP configuration UI (Stage 2)       │
└──────────────────────────────────────────────────┘
```

### Why not just fix it in the UI?

The UI could block images for non-vision models (and it should, as a first line of
defense). But blocking alone is a poor experience — the user attached the image
because they want the model to see it. The plugin layer lets us **save the image
to disk and give the model a tool to access it**, turning a hard block into a
graceful fallback.

### Why not modify OpenCode core?

1. OpenChamber is a customized fork that tracks upstream. Core changes create merge
   conflicts on every upstream sync.
2. OpenCode's plugin system is specifically designed for this — OMA
   (`oh-my-openagent`) implements 54+ hooks as a pure plugin with zero core changes.
3. A plugin can be iterated and shipped independently of the OpenCode release cycle.

## Plugin Hook Reference

The OpenCode plugin API (`@opencode-ai/plugin`) exposes these hooks. The ones used
by this design are marked ⭐.

| Hook | Purpose |
|---|---|
| ⭐ `experimental.chat.messages.transform` | Transform the full message list before it reaches the LLM. **This is where image parts are detected and replaced for non-vision models.** |
| ⭐ `experimental.chat.system.transform` | Modify the system prompt. Used to inject "you have a `describe_image` tool" guidance. |
| ⭐ `tool` | Register custom tools available to the model. Used to register `describe_image`. |
| `chat.message` | Intercept a user message as it enters the session (mutable `parts`). |
| `chat.params` | Modify LLM parameters (temperature, max tokens, etc.). |
| `tool.execute.before` / `tool.execute.after` | Intercept tool calls before/after execution. |
| `permission.ask` | Programmatically grant or deny permission requests. |
| `event` | Receive all session events. |
| `dispose` | Cleanup when the plugin unloads. |

A plugin also receives a `PluginInput` with:
- `client` — full `@opencode-ai/sdk` client (query models, sessions, config)
- `$` — `BunShell` for running shell commands
- `directory`, `worktree`, `project`, `serverUrl`

There is **no sandbox**. Plugins run with full process privileges in the OpenCode
server process. This is by design — OMA, Cloudflare, Copilot, and Codex all ship as
plugins.

## Stage 1: Image Fallback for Non-Vision Models

### Goal

When a user sends an image to a non-vision model, instead of triggering a provider
`400`:
1. Save the image to disk under OpenChamber's data directory.
2. Replace the image `Part` with a `text` Part containing the file path and a note
   that the `describe_image` tool is available.
3. Register a `describe_image` tool that the model can call to get a text
   description of the image (via a configured vision MCP server or built-in OCR).

Vision-capable models continue to receive base64 image parts as before — zero
behavior change.

### Data Flow

```
User attaches image.png
  → OpenChamber UI sends { type: "file", mime: "image/png", url: "data:..." }
  → OpenCode receives message, enters session runner
  → Plugin hook: experimental.chat.messages.transform
      ├─ Query model capabilities via client SDK
      ├─ If model supports image input → pass through unchanged
      └─ If model does NOT support image input:
           ├─ Decode base64 → write to {data_dir}/openchamber/images/{sha256}.png
           ├─ Replace file part with text part:
           │   "[Image: screenshot.png (image/png, 1920x1080)
           │    Saved to /Users/.../openchamber/images/abc123.png
           │    Use the describe_image tool to analyze it.]"
           └─ (System prompt already tells the model about describe_image)
  → LLM receives text-only message + tool definition
  → Model may call describe_image("/Users/.../abc123.png")
      └─ Plugin tool executes: calls vision MCP / OCR → returns text description
```

### Image Storage

- **Location**: `{Global.data_dir}/openchamber/images/`
  - macOS: `~/Library/Application Support/openchamber/images/`
  - Linux: `~/.local/share/openchamber/images/`
- **Naming**: `{sha256_of_content}.{ext}` — content-addressed, naturally deduplicated
- **Retention**: Stage 1 keeps all images (no GC). Stage 2 adds LRU + TTL.
- **Access**: The model receives an absolute `file://` path. Vision MCP servers that
  accept local file paths (e.g. `opencode-vision`, `agent-vision-mcp`) can read it
  directly.

### Vision Capability Detection

The plugin queries model capabilities via the SDK client:

```typescript
const models = await ctx.client.model.list()
const model = models.find(m => m.id === modelID && m.providerID === providerID)
const supportsImage = model?.capabilities?.input?.image === true
```

This uses the same `capabilities.input.image` flag that the UI's `useConfigStore`
already derives. No new metadata source is needed.

### The `describe_image` Tool

Registered via the `tool` hook. The model can call it when it needs to understand an
image:

```
describe_image(path: string, question?: string) → string
```

**Stage 1 behavior**: Returns a placeholder message explaining that no vision
backend is configured, with instructions on how to set one up (link to Settings).
This ensures the tool is always available even without a vision MCP server
configured — the model gets a deterministic response rather than a missing-tool
error.

**Stage 1.5 behavior** (optional): If a vision MCP server is configured (detected
via `client.mcp.status()`), the tool proxies to it. The plugin searches connected
MCP tools for known vision tool names (`vision_describe`, `describe_image`,
`analyze_image`, etc.) and calls the first match.

### UI Changes

1. **Send-time modality check** (`session-ui-store.ts`): Before sending, if the
   selected model lacks image input capability and the message has image
   attachments, show a non-blocking info toast: "This model doesn't support image
   input directly. Images will be saved and made available via the
   `describe_image` tool." Do NOT block the send — the plugin handles the
   transformation.

2. **Attachment chip indicator** (`FileAttachment.tsx`): When the current model is
   non-vision and an image is attached, show a small "via tool" badge on the image
   chip so the user understands what will happen.

3. **Settings section** (Stage 2): A "Vision" panel showing connected vision MCP
   servers and allowing one-click configuration of `opencode-vision` or similar.

## Stage 2: Cross-Session Image Cache (Future)

### Goal

Images saved in Stage 1 are content-addressed (`sha256`). Stage 2 builds an index
over them so that:
- The same image uploaded in different sessions is recognized and reused.
- Similar images (by perceptual hash) are linked.
- The model can search past images: "find the architecture diagram I shared last
  week."

### Architecture

```
┌─ OpenChamber Plugin ─────────────────────────────┐
│                                                   │
│  on image save:                                   │
│    1. Compute sha256 + pHash                      │
│    2. Write to cache SQLite (OpenChamber-owned):  │
│       { sha256, phash, path, sessionID,           │
│         time_saved, description? }                │
│    3. If description exists (from prior           │
│       describe_image call), reuse it              │
│                                                   │
│  register tools:                                  │
│    - search_images(query) → cached matches        │
│    - get_image_context(sha256) → prior analysis   │
│                                                   │
└───────────────────────────────────────────────────┘
```

**Cache DB**: Separate SQLite database at
`{data_dir}/openchamber/image-cache.db`. Never writes to OpenCode's `opencode.db`.

**Deduplication**: When the same image (same sha256) appears in a new session, the
plugin reuses the saved file and any prior `describe_image` output, skipping the
vision API call entirely.

**Perceptual hash**: Using `pHash` (perceptual hash, not cryptographic) allows
finding "similar" images — same screenshot with minor edits, resized versions, etc.
This is the novel part: no existing tool does cross-session image retrieval for AI
coding agents.

### Why not in OpenCode core?

Cross-session image caching requires:
- A persistent index that spans sessions (OpenCode's DB is session-scoped).
- Perceptual hashing (a dependency OpenCode core shouldn't carry).
- A query API for the model (new tool definitions).

All of this is cleanly expressible as a plugin with its own storage. OpenCode's DB
stays untouched.

## Artifact Publishing

The first-party plugin also registers:

```
publish_artifact(path, title?, description?) → persisted artifact metadata
```

The tool copies a completed file into
`{OPENCHAMBER_DATA_DIR}/artifacts/{publication_id}/content` and writes an immutable
`manifest.json` beside it. The publication ID is derived from the content SHA-256,
session ID, message ID, and filename, so retrying the same tool call is idempotent.

The completed OpenCode tool part stores a versioned `metadata.openchamberArtifact`
record. OpenChamber's shared UI recognizes that record and renders a persistent
preview/download card without parsing Markdown paths. The web server and VS Code
bridge expose content through `GET /api/artifacts/:artifactId/content`; clients
never send a local filesystem path to that endpoint.

Files inside the active worktree publish directly. Publishing a path outside the
worktree triggers an `artifact_publish` permission request before any content is
copied.

## Package Layout

```
packages/plugin/
├── package.json              # @openchamber/plugin, deps: @opencode-ai/plugin, @opencode-ai/sdk
├── tsconfig.json
├── src/
│   ├── index.ts              # PluginModule default export
│   ├── plugin.ts             # Plugin factory (input, options) => Hooks
│   ├── image-transform.ts    # experimental.chat.messages.transform handler
│   ├── system-transform.ts   # experimental.chat.system.transform handler
│   ├── tools/
│   │   ├── describe-image.ts # describe_image tool definition
│   │   └── publish-artifact.ts # persistent deliverable publishing
│   ├── artifact-store.ts     # Content-addressed persistent artifacts
│   ├── image-store.ts        # Save base64 → file, sha256 naming, dedup
│   ├── model-capability.ts   # Query model vision capability via SDK client
│   └── logger.ts             # Plugin-scoped logging
└── README.md
```

### Registration

OpenChamber's server bootstrap writes the plugin into the OpenCode config before
starting the server:

```jsonc
// ~/.config/opencode/opencode.json (managed by OpenChamber)
{
  "plugin": ["@openchamber/plugin"]
}
```

When OpenChamber starts the OpenCode server (in-process via
`startWebUiServer` for Electron, or sidecar for Tauri), it ensures this entry
exists. The plugin is resolved from the workspace `node_modules`.

## Constraints and Decisions

| Decision | Rationale |
|---|---|
| Plugin over core modification | Avoids merge conflicts on upstream sync; plugin API is designed for this. |
| Content-addressed file names (sha256) | Natural dedup; Stage 2 cache builds on this for free. |
| No GC in Stage 1 | Simplicity. Images are small relative to disk; Stage 2 adds LRU. |
| `describe_image` always registered | The model always has the tool available; no conditional tool gating needed. |
| Separate cache DB for Stage 2 | Never write to `opencode.db` — avoids corruption risk and migration drift. |
| UI does not block sends | The plugin handles the transformation; blocking would prevent the fallback from working. |
| File paths over base64 in fallback text | MCP vision tools need file paths; base64 in text is useless to a text model. |
| Artifact metadata in tool parts | Works without adding a custom OpenCode Part variant and survives session reload. |
| Copy-on-publish | Temporary source cleanup cannot remove a published deliverable. |

## Validation

- `bun run type-check` passes on all changed packages.
- `bun run lint` passes.
- Sending an image to a vision model: unchanged behavior (base64 passthrough).
- Sending an image to a non-vision model: image saved to disk, text part injected,
  no provider 400 error, `describe_image` tool visible to the model.
- Switching from a vision model to a non-vision model mid-session: historical image
  parts in the conversation are transformed on the next turn (handled by
  `experimental.chat.messages.transform` which sees the full message list).

## References

- OpenCode plugin types: `../opencode/packages/plugin/src/index.ts`
- OMA plugin (reference implementation): `../oh-my-openagent/packages/omo-opencode/`
- OMA image resizer hook (proof of concept): `../oh-my-openagent/packages/omo-opencode/src/hooks/read-image-resizer/`
- OpenCode upstream PRs: #30153 (save to disk), #29279 (metadata text), #21633 (clipboard file://)
- Hermes Agent vision routing: hermes-agent.nousresearch.com/docs/user-guide/features/vision
