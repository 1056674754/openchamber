/**
 * experimental.session.compacting handler.
 *
 * When the user types `/compact <focus text>` in the OpenChamber UI, the UI
 * writes the focus text to a per-session file and then triggers compaction.
 * This hook picks up that file, injects the focus as additional context into
 * the compaction prompt, and deletes the file (one-time use).
 *
 * If no focus file exists (plain `/compact`), the hook is a no-op and the
 * default compaction prompt runs unchanged.
 *
 * File path: ~/.config/openchamber/compact-focus/<sessionID>.txt
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { log } from "./logger.js"

const FOCUS_DIR = join(homedir(), ".config", "openchamber", "compact-focus")

export function createCompactionFocusHandler() {
  return async function compactionFocus(
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ): Promise<void> {
    const focusFile = join(FOCUS_DIR, `${input.sessionID}.txt`)
    if (!existsSync(focusFile)) return

    try {
      const focus = readFileSync(focusFile, "utf8").trim()
      if (focus) {
        output.context.push(`## User-specified compaction focus\n\n${focus}`)
        log("compaction-focus: injected focus", { sessionID: input.sessionID })
      }
    } catch (error) {
      log("compaction-focus: failed to read focus file", { error: String(error) })
    } finally {
      // One-time use: delete regardless of read success/failure
      try {
        unlinkSync(focusFile)
      } catch {
        // already deleted or inaccessible — best-effort cleanup
      }
    }
  }
}
