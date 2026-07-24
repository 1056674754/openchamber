import { beforeEach, describe, expect, test } from "bun:test"
import { useInputStore } from "./input-store"
import { useMessageQueueStore, type QueuedMessage } from "@/stores/messageQueueStore"
import type { AttachedFile } from "@/stores/types/sessionTypes"

const imageAttachment = (filename: string): AttachedFile => ({
  id: `img-${filename}`,
  file: new File(["png"], filename, { type: "image/png" }),
  dataUrl: `data:image/png;base64,${filename}`,
  mimeType: "image/png",
  filename,
  size: 3,
  source: "local",
})

describe("attachment + queue session isolation", () => {
  beforeEach(() => {
    useInputStore.setState({
      attachedFiles: [],
      attachedBySession: {},
      attachmentSessionKey: null,
      pendingInputText: null,
      pendingInputMode: "replace",
      pendingSyntheticParts: null,
      activeEditorFile: null,
    })
    useMessageQueueStore.setState({
      queuedMessages: {},
      followUpBehavior: "queue",
    })
  })

  test("queued image stays on original session while composer image does not follow a switch", () => {
    // Session A: paste image into composer, then queue it (busy follow-up path).
    useInputStore.getState().setAttachmentSessionKey("ses_a")
    const shot = imageAttachment("shot.png")
    useInputStore.getState().setAttachedFiles([shot])

    useMessageQueueStore.getState().addToQueue("ses_a", {
      content: "please review this screenshot",
      attachments: [shot],
    })
    useInputStore.getState().clearAttachedFiles()

    // User switches to session B before the queue auto-sends.
    useInputStore.getState().setAttachmentSessionKey("ses_b")

    // Bug symptom that used to happen with a global attachedFiles array:
    // the image would still be visible in B's composer.
    expect(useInputStore.getState().attachedFiles).toEqual([])

    // Queue for A still owns the image; B has no queue entry.
    const queueA = useMessageQueueStore.getState().getQueueForSession("ses_a")
    const queueB = useMessageQueueStore.getState().getQueueForSession("ses_b")
    expect(queueA).toHaveLength(1)
    expect(queueA[0]?.attachments?.map((file) => file.filename)).toEqual(["shot.png"])
    expect(queueB).toEqual([])

    // Returning to A shows an empty composer (already queued) and the queued chip still has the image.
    useInputStore.getState().setAttachmentSessionKey("ses_a")
    expect(useInputStore.getState().attachedFiles).toEqual([])
    expect(useMessageQueueStore.getState().getQueueForSession("ses_a")[0]?.attachments?.[0]?.filename)
      .toBe("shot.png")
  })

  test("unsent composer image stays on A when user only switches sessions", () => {
    useInputStore.getState().setAttachmentSessionKey("ses_a")
    useInputStore.getState().setAttachedFiles([imageAttachment("pending.png")])

    useInputStore.getState().setAttachmentSessionKey("ses_b")
    expect(useInputStore.getState().attachedFiles).toEqual([])

    useInputStore.getState().setAttachmentSessionKey("ses_a")
    expect(useInputStore.getState().attachedFiles.map((file) => file.filename)).toEqual(["pending.png"])
  })

  test("pop-to-edit from queue writes into the active session bucket only", () => {
    const queued: QueuedMessage = {
      id: "queued-1",
      content: "edit me",
      createdAt: 1,
      attachments: [imageAttachment("edit.png")],
    }
    useMessageQueueStore.setState({
      queuedMessages: { ses_a: [queued] },
    })

    useInputStore.getState().setAttachmentSessionKey("ses_a")
    const popped = useMessageQueueStore.getState().popToInput("ses_a", "queued-1")
    expect(popped?.attachments?.[0]?.filename).toBe("edit.png")

    const current = useInputStore.getState().attachedFiles
    useInputStore.getState().setAttachedFiles([
      ...current,
      ...(popped?.attachments ?? []),
    ])

    useInputStore.getState().setAttachmentSessionKey("ses_b")
    expect(useInputStore.getState().attachedFiles).toEqual([])
    expect(useInputStore.getState().attachedBySession.ses_a?.map((file) => file.filename))
      .toEqual(["edit.png"])
  })
})
