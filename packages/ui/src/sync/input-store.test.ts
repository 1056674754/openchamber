import { beforeEach, describe, expect, test } from "bun:test"
import {
  DRAFT_ATTACHMENT_SESSION_KEY,
  resolveAttachmentSessionKey,
  useInputStore,
} from "./input-store"

class MockFileReader {
  result: string | ArrayBuffer | null = null
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null
  onerror: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null
  onabort: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null
  error: DOMException | null = null

  readAsDataURL() {
    pendingReaders.push(this)
  }
}

const pendingReaders: MockFileReader[] = []
const originalFileReader = globalThis.FileReader

const restoreFileReader = () => {
  pendingReaders.length = 0
  globalThis.FileReader = originalFileReader
}

const testWithMockFileReader = (name: string, fn: () => Promise<void>) => {
  test(name, async () => {
    try {
      await fn()
    } finally {
      restoreFileReader()
    }
  })
}

const resolveReader = (reader: MockFileReader, result: string) => {
  reader.result = result
  reader.onload?.call(reader as unknown as FileReader, {} as ProgressEvent<FileReader>)
}

const rejectReader = (reader: MockFileReader) => {
  reader.error = new DOMException("read failed", "NotReadableError")
  reader.onerror?.call(reader as unknown as FileReader, {} as ProgressEvent<FileReader>)
}

const resetInputStore = () => {
  pendingReaders.length = 0
  globalThis.FileReader = MockFileReader as unknown as typeof FileReader
  useInputStore.setState({
    pendingInputText: null,
    pendingInputMode: "replace",
    pendingSyntheticParts: null,
    activeEditorFile: null,
    attachedBySession: {},
    attachmentSessionKey: null,
  })
  useInputStore.getState().setAttachedFiles([])
}

describe("input-store attachments", () => {
  beforeEach(() => {
    resetInputStore()
  })

  testWithMockFileReader("does not attach a local file that finishes reading after attachments are cleared", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(new File(["hello"], "hello.txt", { type: "text/plain" }))
    expect(pendingReaders).toHaveLength(1)

    useInputStore.getState().clearAttachedFiles()
    resolveReader(pendingReaders[0], "data:text/plain;base64,aGVsbG8=")
    await addPromise

    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  testWithMockFileReader("does not attach a local file after attached files are replaced", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(new File(["hello"], "hello.txt", { type: "text/plain" }))
    expect(pendingReaders).toHaveLength(1)

    useInputStore.getState().setAttachedFiles([])
    resolveReader(pendingReaders[0], "data:text/plain;base64,aGVsbG8=")
    await addPromise

    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  testWithMockFileReader("does not attach a local file after attached files are restored", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(new File(["hello"], "hello.txt", { type: "text/plain" }))
    expect(pendingReaders).toHaveLength(1)

    const restored = new File(["restored"], "restored.txt", { type: "text/plain" })
    useInputStore.getState().setAttachedFiles([{
      id: "restored",
      file: restored,
      dataUrl: "data:text/plain;base64,cmVzdG9yZWQ=",
      mimeType: "text/plain",
      filename: "restored.txt",
      size: restored.size,
      source: "local",
    }])
    resolveReader(pendingReaders[0], "data:text/plain;base64,aGVsbG8=")
    await addPromise

    expect(useInputStore.getState().attachedFiles.map((file) => file.filename)).toEqual(["restored.txt"])
  })

  testWithMockFileReader("does not attach a VS Code selection that finishes reading after attachments are cleared", async () => {
    const addPromise = useInputStore.getState().addVSCodeSelectionAttachment(
      "/workspace/hello.txt",
      new File(["hello"], "hello.txt", { type: "text/plain" })
    )
    expect(pendingReaders).toHaveLength(1)

    useInputStore.getState().clearAttachedFiles()
    resolveReader(pendingReaders[0], "data:text/plain;base64,aGVsbG8=")
    await addPromise

    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  test("does not leave local file reads pending after a reader error", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(new File(["hello"], "hello.txt", { type: "text/plain" }))
    expect(pendingReaders).toHaveLength(1)

    rejectReader(pendingReaders[0])
    await addPromise

    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  test("cleans up pending VS Code selection keys after a reader error", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" })
    const firstAdd = useInputStore.getState().addVSCodeSelectionAttachment("/workspace/hello.txt", file)
    expect(pendingReaders).toHaveLength(1)

    rejectReader(pendingReaders[0])
    await firstAdd

    const secondAdd = useInputStore.getState().addVSCodeSelectionAttachment("/workspace/hello.txt", file)
    expect(pendingReaders).toHaveLength(2)
    resolveReader(pendingReaders[1], "data:text/plain;base64,aGVsbG8=")
    await secondAdd

    expect(useInputStore.getState().attachedFiles.map((attached) => attached.filename)).toEqual(["hello.txt"])
  })
})

describe("input-store session-scoped attachments", () => {
  beforeEach(() => {
    resetInputStore()
  })

  test("resolveAttachmentSessionKey prefers session id over draft", () => {
    expect(resolveAttachmentSessionKey({
      currentSessionId: "ses_a",
      newSessionDraftOpen: true,
    })).toBe("ses_a")
    expect(resolveAttachmentSessionKey({
      currentSessionId: null,
      newSessionDraftOpen: true,
    })).toBe(DRAFT_ATTACHMENT_SESSION_KEY)
    expect(resolveAttachmentSessionKey({
      currentSessionId: null,
      newSessionDraftOpen: false,
    })).toBe(DRAFT_ATTACHMENT_SESSION_KEY)
  })

  testWithMockFileReader("unscoped/draft paste does not follow into the next real session", async () => {
    useInputStore.getState().setAttachmentSessionKey(DRAFT_ATTACHMENT_SESSION_KEY)
    const addPromise = useInputStore.getState().addAttachedFile(
      new File(["png"], "draft.png", { type: "image/png" }),
    )
    resolveReader(pendingReaders[0], "data:image/png;base64,DRAFT=")
    await addPromise

    useInputStore.getState().setAttachmentSessionKey("ses_b")
    expect(useInputStore.getState().attachedFiles).toEqual([])
    expect(
      useInputStore.getState().attachedBySession[DRAFT_ATTACHMENT_SESSION_KEY]?.map((file) => file.filename),
    ).toEqual(["draft.png"])
  })

  testWithMockFileReader("keeps pasted attachments on the original session when switching away", async () => {
    useInputStore.getState().setAttachmentSessionKey("ses_a")
    const addPromise = useInputStore.getState().addAttachedFile(
      new File(["png"], "shot.png", { type: "image/png" }),
    )
    resolveReader(pendingReaders[0], "data:image/png;base64,AAA=")
    await addPromise

    expect(useInputStore.getState().attachedFiles.map((file) => file.filename)).toEqual(["shot.png"])

    useInputStore.getState().setAttachmentSessionKey("ses_b")
    expect(useInputStore.getState().attachedFiles).toEqual([])
    expect(useInputStore.getState().attachedBySession.ses_a?.map((file) => file.filename)).toEqual(["shot.png"])

    useInputStore.getState().setAttachmentSessionKey("ses_a")
    expect(useInputStore.getState().attachedFiles.map((file) => file.filename)).toEqual(["shot.png"])
    expect(useInputStore.getState().attachmentSessionKey).toBe("ses_a")
  })

  testWithMockFileReader("async paste that finishes after a session switch stays on the original session", async () => {
    useInputStore.getState().setAttachmentSessionKey("ses_a")
    const addPromise = useInputStore.getState().addAttachedFile(
      new File(["png"], "late.png", { type: "image/png" }),
    )
    expect(pendingReaders).toHaveLength(1)

    useInputStore.getState().setAttachmentSessionKey("ses_b")
    resolveReader(pendingReaders[0], "data:image/png;base64,QkE=")
    await addPromise

    expect(useInputStore.getState().attachmentSessionKey).toBe("ses_b")
    expect(useInputStore.getState().attachedFiles).toEqual([])
    expect(useInputStore.getState().attachedBySession.ses_a?.map((file) => file.filename)).toEqual(["late.png"])
  })

  test("setAttachedFilesForSession restores into a non-visible session bucket", () => {
    useInputStore.getState().setAttachmentSessionKey("ses_b")
    const restored = [{
      id: "queued-img",
      file: new File(["png"], "queued.png", { type: "image/png" }),
      dataUrl: "data:image/png;base64,QUE=",
      mimeType: "image/png",
      filename: "queued.png",
      size: 3,
      source: "local" as const,
    }]

    useInputStore.getState().setAttachedFilesForSession("ses_a", restored)

    expect(useInputStore.getState().attachmentSessionKey).toBe("ses_b")
    expect(useInputStore.getState().attachedFiles).toEqual([])
    expect(useInputStore.getState().attachedBySession.ses_a?.map((file) => file.filename)).toEqual(["queued.png"])

    useInputStore.getState().setAttachmentSessionKey("ses_a")
    expect(useInputStore.getState().attachedFiles.map((file) => file.filename)).toEqual(["queued.png"])
  })

  test("normalizes code files to text/plain", async () => {
    const addPromise = useInputStore.getState().addAttachedFile(
      new File(["const value = 1"], "example.ts", { type: "text/typescript" }),
    )
    expect(pendingReaders).toHaveLength(1)
    resolveReader(pendingReaders[0], "data:text/typescript;base64,Y29uc3QgdmFsdWUgPSAx")
    expect(await addPromise).toBe(true)
    expect(useInputStore.getState().attachedFiles[0]?.mimeType).toBe("text/plain")
    expect(useInputStore.getState().attachedFiles[0]?.dataUrl).toBe(
      "data:text/plain;base64,Y29uc3QgdmFsdWUgPSAx",
    )
  })

  test("rejects an unknown binary file after inspecting its contents", async () => {
    const attached = await useInputStore.getState().addAttachedFile(
      new File([new Uint8Array([0, 1, 2, 3])], "archive.bin", { type: "application/octet-stream" }),
    )
    expect(attached).toBe(false)
    expect(pendingReaders).toHaveLength(0)
    expect(useInputStore.getState().attachedFiles).toEqual([])
  })

  test("opening a cleared draft does not steal the previous session attachments", () => {
    useInputStore.getState().setAttachmentSessionKey("ses_a")
    useInputStore.getState().setAttachedFiles([{
      id: "keep-me",
      file: new File(["png"], "keep.png", { type: "image/png" }),
      dataUrl: "data:image/png;base64,KEEP=",
      mimeType: "image/png",
      filename: "keep.png",
      size: 4,
      source: "local",
    }])

    useInputStore.getState().setAttachmentSessionKey(DRAFT_ATTACHMENT_SESSION_KEY)
    useInputStore.getState().clearAttachedFiles()

    expect(useInputStore.getState().attachedFiles).toEqual([])
    expect(useInputStore.getState().attachedBySession.ses_a?.map((file) => file.filename)).toEqual(["keep.png"])
  })
})
