/**
 * Input Store — pending input text, synthetic parts, and attached files.
 * Extracted from session-ui-store for subscription isolation.
 *
 * Composer attachments are keyed by session (or draft). `attachedFiles` is the
 * active session's view; inactive sessions keep their buckets in
 * `attachedBySession` so pasted images cannot follow a session switch.
 */

import { create } from "zustand"
import type { AttachedFile } from "@/stores/types/sessionTypes"

const FILE_URI_PREFIX = "file://"
const pendingVSCodeSelectionKeys = new Set<string>()
let attachmentReadGeneration = 0

/** Composer attachment bucket for the new-session draft (no session id yet). */
export const DRAFT_ATTACHMENT_SESSION_KEY = "__draft__"

const encodeFilePath = (filepath: string): string => {
  let normalized = filepath.replace(/\\/g, "/")
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = `/${normalized}`
  }
  return normalized
    .split("/")
    .map((segment, index) => {
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment
      return encodeURIComponent(segment)
    })
    .join("/")
}

const toFileUrl = (filepath: string): string => {
  const normalized = filepath.replace(/\\/g, "/").trim()
  if (normalized.toLowerCase().startsWith(FILE_URI_PREFIX)) {
    return normalized
  }
  return `${FILE_URI_PREFIX}${encodeFilePath(normalized)}`
}

const getVSCodeSelectionKey = (path: string, filename: string): string => `${path}\u0000${filename}`

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
  reader.onabort = () => reject(new Error("File read aborted"))
  reader.readAsDataURL(file)
})

const getDataUrlByteSize = (url: string): number => {
  if (!url.startsWith("data:")) return 0
  const commaIndex = url.indexOf(",")
  if (commaIndex < 0) return 0
  const metadata = url.slice(0, commaIndex).toLowerCase()
  const payload = url.slice(commaIndex + 1)
  if (!metadata.endsWith(";base64")) return 0
  let padding = 0
  if (payload.endsWith("==")) {
    padding = 2
  } else if (payload.endsWith("=")) {
    padding = 1
  }
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

const isSameVSCodeActiveEditorFile = (a: VSCodeActiveEditorFile | null, b: VSCodeActiveEditorFile | null): boolean => {
  if (a === b) return true
  if (!a || !b) return false
  return a.filePath === b.filePath
    && a.fileName === b.fileName
    && a.relativePath === b.relativePath
    && a.fileSize === b.fileSize
    && a.selection?.startLine === b.selection?.startLine
    && a.selection?.endLine === b.selection?.endLine
    && a.selection?.text === b.selection?.text
}

const writeBucket = (
  attachedBySession: Record<string, AttachedFile[]>,
  key: string,
  files: AttachedFile[],
): Record<string, AttachedFile[]> => {
  if (files.length === 0) {
    if (!(key in attachedBySession)) return attachedBySession
    const { [key]: _removed, ...rest } = attachedBySession
    void _removed
    return rest
  }
  return {
    ...attachedBySession,
    [key]: files,
  }
}

export const resolveAttachmentSessionKey = (options: {
  currentSessionId: string | null
  newSessionDraftOpen?: boolean
}): string => {
  if (options.currentSessionId) return options.currentSessionId
  // No active session: composer always uses the draft bucket. Returning null
  // previously left attachments "unscoped", and the first session bind would
  // carry them into whichever conversation the user opened next.
  void options.newSessionDraftOpen
  return DRAFT_ATTACHMENT_SESSION_KEY
}

export type SyntheticContextPart = {
  text: string
  attachments?: AttachedFile[]
  synthetic?: boolean
}

export type VSCodeActiveEditorFile = {
  filePath: string
  fileName: string
  relativePath: string
  fileSize: number | null
  selection: { startLine: number; endLine: number; text: string } | null
}

export type InputState = {
  pendingInputText: string | null
  pendingInputMode: "replace" | "append" | "append-inline"
  pendingSyntheticParts: SyntheticContextPart[] | null
  pendingPresetSubmit: string | null
  /** Active composer attachments (current attachmentSessionKey). */
  attachedFiles: AttachedFile[]
  /** Inactive session/draft attachment buckets. */
  attachedBySession: Record<string, AttachedFile[]>
  /** Session/draft key currently mirrored into attachedFiles. */
  attachmentSessionKey: string | null
  activeEditorFile: VSCodeActiveEditorFile | null

  setPendingInputText: (text: string | null, mode?: "replace" | "append" | "append-inline") => void
  consumePendingInputText: () => { text: string; mode: "replace" | "append" | "append-inline" } | null
  requestPresetSubmit: (text: string) => void
  consumePendingPresetSubmit: () => string | null
  setPendingSyntheticParts: (parts: SyntheticContextPart[] | null) => void
  consumePendingSyntheticParts: () => SyntheticContextPart[] | null
  setAttachmentSessionKey: (sessionKey: string | null) => void
  addAttachedFile: (file: File) => Promise<void>
  removeAttachedFile: (id: string) => void
  setAttachedFiles: (files: AttachedFile[]) => void
  setAttachedFilesForSession: (sessionKey: string, files: AttachedFile[]) => void
  clearAttachedFiles: () => void
  addVSCodeFileAttachment: (path: string, name: string, fileSize: number | null) => void
  addVSCodeSelectionAttachment: (path: string, file: File) => Promise<void>
  setActiveEditorFile: (file: VSCodeActiveEditorFile | null) => void
  addRestoredAttachment: (file: { url: string; mimeType: string; filename: string }) => void
}

export const useInputStore = create<InputState>()((set, get) => ({
  pendingInputText: null,
  pendingInputMode: "replace",
  pendingSyntheticParts: null,
  pendingPresetSubmit: null,
  attachedFiles: [],
  attachedBySession: {},
  attachmentSessionKey: null,
  activeEditorFile: null,

  setPendingInputText: (text, mode = "replace") =>
    set({ pendingInputText: text, pendingInputMode: mode }),

  consumePendingInputText: () => {
    const { pendingInputText, pendingInputMode } = get()
    if (pendingInputText === null) return null
    set({ pendingInputText: null, pendingInputMode: "replace" })
    return { text: pendingInputText, mode: pendingInputMode }
  },

  requestPresetSubmit: (text) => set({ pendingPresetSubmit: text }),

  consumePendingPresetSubmit: () => {
    const { pendingPresetSubmit } = get()
    if (pendingPresetSubmit === null) return null
    set({ pendingPresetSubmit: null })
    return pendingPresetSubmit
  },

  setPendingSyntheticParts: (parts) => set({ pendingSyntheticParts: parts }),

  consumePendingSyntheticParts: () => {
    const { pendingSyntheticParts } = get()
    if (pendingSyntheticParts !== null) {
      set({ pendingSyntheticParts: null })
    }
    return pendingSyntheticParts
  },

  setAttachmentSessionKey: (nextKey) => {
    const { attachmentSessionKey: prevKey, attachedFiles, attachedBySession } = get()
    if (prevKey === nextKey) return

    let nextBySession = attachedBySession
    if (prevKey) {
      nextBySession = writeBucket(nextBySession, prevKey, attachedFiles)
    } else if (attachedFiles.length > 0) {
      // Legacy unscoped composer content must never be inherited by the next
      // real session. Park it on the draft bucket instead.
      nextBySession = writeBucket(nextBySession, DRAFT_ATTACHMENT_SESSION_KEY, attachedFiles)
    }

    const nextFiles = nextKey ? (nextBySession[nextKey] ?? []) : []
    set({
      attachmentSessionKey: nextKey,
      attachedBySession: nextBySession,
      attachedFiles: nextFiles,
    })
  },

  addAttachedFile: async (file: File) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const targetKey = get().attachmentSessionKey
    const generation = attachmentReadGeneration
    let dataUrl: string
    try {
      dataUrl = await readFileAsDataUrl(file)
    } catch {
      return
    }
    if (generation !== attachmentReadGeneration) return
    const attached: AttachedFile = {
      id,
      file,
      dataUrl,
      mimeType: file.type,
      filename: file.name,
      size: file.size,
      source: "local",
    }
    set((s) => {
      if (!targetKey) {
        return { attachedFiles: [...s.attachedFiles, attached] }
      }
      const base = s.attachmentSessionKey === targetKey
        ? s.attachedFiles
        : (s.attachedBySession[targetKey] ?? [])
      const next = [...base, attached]
      return {
        attachedBySession: writeBucket(s.attachedBySession, targetKey, next),
        attachedFiles: s.attachmentSessionKey === targetKey ? next : s.attachedFiles,
      }
    })
  },

  removeAttachedFile: (id) =>
    set((s) => {
      const next = s.attachedFiles.filter((f) => f.id !== id)
      const key = s.attachmentSessionKey
      if (!key) return { attachedFiles: next }
      return {
        attachedFiles: next,
        attachedBySession: writeBucket(s.attachedBySession, key, next),
      }
    }),

  setAttachedFiles: (files) => {
    attachmentReadGeneration += 1
    const key = get().attachmentSessionKey
    if (!key) {
      set({ attachedFiles: files })
      return
    }
    set((s) => ({
      attachedFiles: files,
      attachedBySession: writeBucket(s.attachedBySession, key, files),
    }))
  },

  setAttachedFilesForSession: (sessionKey, files) => {
    const state = get()
    if (state.attachmentSessionKey === sessionKey) {
      attachmentReadGeneration += 1
      set({
        attachedFiles: files,
        attachedBySession: writeBucket(state.attachedBySession, sessionKey, files),
      })
      return
    }
    set({
      attachedBySession: writeBucket(state.attachedBySession, sessionKey, files),
    })
  },

  clearAttachedFiles: () => {
    attachmentReadGeneration += 1
    const key = get().attachmentSessionKey
    if (!key) {
      set({ attachedFiles: [] })
      return
    }
    set((s) => ({
      attachedFiles: [],
      attachedBySession: writeBucket(s.attachedBySession, key, []),
    }))
  },

  addVSCodeFileAttachment: (path: string, name: string, fileSize: number | null) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const targetKey = get().attachmentSessionKey
    const isDuplicate = get().attachedFiles.some(
      (f) => f.source === 'vscode' && f.vscodeSource === 'file' && (f.vscodePath || '') === path
    )
    if (isDuplicate) return
    const dataUrl = toFileUrl(path)
    // `file://` URLs are the same contract used by server-source attachments.
    // The submission path passes `dataUrl` as `url` directly to the OpenCode
    // server, which resolves `file://` paths natively. No base64 encoding needed.
    const attached: AttachedFile = {
      id,
      file: new File([], name, { type: 'text/plain' }),
      dataUrl,
      mimeType: 'text/plain',
      filename: name,
      size: fileSize || 0,
      source: 'vscode',
      vscodePath: path,
      vscodeSource: 'file',
    }
    set((s) => {
      if (!targetKey) {
        return { attachedFiles: [...s.attachedFiles, attached] }
      }
      const base = s.attachmentSessionKey === targetKey
        ? s.attachedFiles
        : (s.attachedBySession[targetKey] ?? [])
      const next = [...base, attached]
      return {
        attachedBySession: writeBucket(s.attachedBySession, targetKey, next),
        attachedFiles: s.attachmentSessionKey === targetKey ? next : s.attachedFiles,
      }
    })
  },

  addVSCodeSelectionAttachment: async (path: string, file: File) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const targetKey = get().attachmentSessionKey
    const generation = attachmentReadGeneration
    const selectionKey = getVSCodeSelectionKey(path, file.name)
    const activeFiles = get().attachmentSessionKey === targetKey
      ? get().attachedFiles
      : (targetKey ? (get().attachedBySession[targetKey] ?? []) : get().attachedFiles)
    const isDuplicate = activeFiles.some(
      (f) => f.source === 'vscode' && f.vscodeSource === 'selection' && f.filename === file.name && f.vscodePath === path
    )
    if (isDuplicate || pendingVSCodeSelectionKeys.has(selectionKey)) return
    pendingVSCodeSelectionKeys.add(selectionKey)
    let dataUrl: string
    try {
      dataUrl = await readFileAsDataUrl(file)
    } catch {
      return
    } finally {
      pendingVSCodeSelectionKeys.delete(selectionKey)
    }
    if (generation !== attachmentReadGeneration) return
    const attached: AttachedFile = {
      id,
      file,
      dataUrl,
      mimeType: file.type,
      filename: file.name,
      size: file.size,
      source: 'vscode',
      vscodePath: path,
      vscodeSource: 'selection',
    }
    set((s) => {
      if (!targetKey) {
        return { attachedFiles: [...s.attachedFiles, attached] }
      }
      const base = s.attachmentSessionKey === targetKey
        ? s.attachedFiles
        : (s.attachedBySession[targetKey] ?? [])
      const next = [...base, attached]
      return {
        attachedBySession: writeBucket(s.attachedBySession, targetKey, next),
        attachedFiles: s.attachmentSessionKey === targetKey ? next : s.attachedFiles,
      }
    })
  },

  setActiveEditorFile: (file) => {
    if (isSameVSCodeActiveEditorFile(get().activeEditorFile, file)) return
    set({ activeEditorFile: file })
  },

  addRestoredAttachment: ({ url, mimeType, filename }) => {
    const id = `restored-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const targetKey = get().attachmentSessionKey
    const attached: AttachedFile = {
      id,
      file: new File([], filename, { type: mimeType }),
      dataUrl: url,
      mimeType,
      filename,
      size: getDataUrlByteSize(url),
      source: "local",
      serverPath: url,
    }
    set((s) => {
      if (!targetKey) {
        return { attachedFiles: [...s.attachedFiles, attached] }
      }
      const base = s.attachmentSessionKey === targetKey
        ? s.attachedFiles
        : (s.attachedBySession[targetKey] ?? [])
      const next = [...base, attached]
      return {
        attachedBySession: writeBucket(s.attachedBySession, targetKey, next),
        attachedFiles: s.attachmentSessionKey === targetKey ? next : s.attachedFiles,
      }
    })
  },
}))
