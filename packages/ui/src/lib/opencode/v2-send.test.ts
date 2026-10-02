import { describe, expect, test } from "bun:test"
import { opencodeClient } from "./client"
import {
  applySendSelection,
  isV2SkillNotFound,
  readV2SendErrorStatus,
  toV2PromptFile,
  toV2SendError,
  type SessionSelection,
} from "./v2-send"

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

describe("v2 send error contract", () => {
  test("reads the status off a ClientError cause", () => {
    const cause = { status: 429 }
    const error = new Error("unexpected status", { cause })
    expect(readV2SendErrorStatus(error)).toBe(429)
  })

  test("maps tagged server errors onto statuses", () => {
    expect(readV2SendErrorStatus({ _tag: "SkillNotFoundError" })).toBe(404)
    expect(readV2SendErrorStatus({ _tag: "SessionBusyError" })).toBe(409)
    expect(readV2SendErrorStatus({ _tag: "UnknownError" })).toBeUndefined()
    expect(readV2SendErrorStatus({ status: 500 })).toBe(500)
    expect(readV2SendErrorStatus("boom")).toBeUndefined()
  })

  test("plain errors pass through unwrapped; tagged ones gain a status", () => {
    const plain = new Error("transport down")
    expect(toV2SendError("Send message", plain)).toBe(plain)

    const tagged = new Error("unexpected status", { cause: { status: 404 } })
    const wrapped = toV2SendError("Send message", tagged)
    expect(wrapped).not.toBe(tagged)
    expect(wrapped.message).toContain("(404)")
    expect((wrapped as { status?: number }).status).toBe(404)
    expect((wrapped as { cause?: unknown }).cause).toBe(tagged)
  })
})

// ---------------------------------------------------------------------------
// Prompt file mapping
// ---------------------------------------------------------------------------

describe("toV2PromptFile", () => {
  test("maps url and filename onto the v2 attachment", () => {
    expect(toV2PromptFile({ mime: "image/png", filename: "shot.png", url: "file:///tmp/shot.png" })).toEqual({
      uri: "file:///tmp/shot.png",
      name: "shot.png",
    })
    expect(toV2PromptFile({ mime: "text/plain", url: "file:///a.txt" })).toEqual({ uri: "file:///a.txt" })
  })
})

// ---------------------------------------------------------------------------
// Session selection (v2 sends model/agent on the session record)
// ---------------------------------------------------------------------------

type FakeSessionClient = {
  session: {
    get: (input: { sessionID: string }) => Promise<unknown>
    switchModel: (input: { sessionID: string; model: { providerID: string; id: string; variant?: string } }) => Promise<void>
    switchAgent: (input: { sessionID: string; agent: string }) => Promise<void>
  }
}

const fakeSessionClient = (state: { model?: Record<string, unknown>; agent?: string }) => {
  const calls: string[] = []
  const client: FakeSessionClient = {
    session: {
      get: async () => ({ model: state.model, agent: state.agent }),
      switchModel: async (input) => {
        calls.push(`model:${input.model.providerID}/${input.model.id}${input.model.variant ? `:${input.model.variant}` : ""}`)
        state.model = { providerID: input.model.providerID, id: input.model.id, variant: input.model.variant }
      },
      switchAgent: async (input) => {
        calls.push(`agent:${input.agent}`)
        state.agent = input.agent
      },
    },
  }
  return { client: client as unknown as Parameters<typeof applySendSelection>[0], calls }
}

describe("applySendSelection", () => {
  test("switches when the session record differs from the queued config", async () => {
    const { client, calls } = fakeSessionClient({ model: { providerID: "a", id: "old" }, agent: "plan" })
    const selection: SessionSelection = { model: { providerID: "a", modelID: "new" }, agent: "build" }
    await applySendSelection(client, "ses_1", selection)
    expect(calls).toEqual(["model:a/new", "agent:build"])
  })

  test("skips the round trips when the session already matches", async () => {
    const { client, calls } = fakeSessionClient({ model: { providerID: "a", id: "m", variant: "fast" }, agent: "build" })
    await applySendSelection(client, "ses_1", { model: { providerID: "a", modelID: "m", variant: "fast" }, agent: "build" })
    expect(calls).toEqual([])
  })

  test("a failed session read still applies the queued selection", async () => {
    const calls: string[] = []
    const client = {
      session: {
        get: async () => {
          throw new Error("down")
        },
        switchModel: async (input: { model: { providerID: string; id: string } }) => {
          calls.push(`model:${input.model.id}`)
        },
        switchAgent: async () => undefined,
      },
    } as unknown as Parameters<typeof applySendSelection>[0]
    await applySendSelection(client, "ses_1", { model: { providerID: "a", modelID: "m" } })
    expect(calls).toEqual(["model:m"])
  })
})

// ---------------------------------------------------------------------------
// Skill attachment resolution
// ---------------------------------------------------------------------------

describe("resolveSkillMentions via the v2 send path", () => {
  const sendV2 = (opencodeClient as unknown as {
    sendV2Message: (
      client: unknown,
      params: Record<string, unknown>,
      parts: unknown[],
      messageId: string,
      delivery?: "steer",
    ) => Promise<string>
  }).sendV2Message.bind(opencodeClient)

  const makeV2Client = (options: {
    skills?: Array<{ id: string; name: string }>
    promptError?: unknown
  }) => {
    const calls: Array<Record<string, unknown>> = []
    return {
      client: {
        session: {
          get: async () => ({ model: { providerID: "p", id: "m" }, agent: "build" }),
          switchModel: async () => undefined,
          switchAgent: async () => undefined,
          synthetic: async (input: Record<string, unknown>) => {
            calls.push({ kind: "synthetic", ...input })
          },
          prompt: async (input: Record<string, unknown>) => {
            calls.push({ kind: "prompt", ...input })
            if (options.promptError) throw options.promptError
            return { id: input.id, delivery: input.delivery ?? "queue" }
          },
        },
        skill: {
          list: async () => ({ data: options.skills ?? [] }),
        },
      },
      calls,
    }
  }

  test("attaches resolved skills to the prompt and hints unresolved ones", async () => {
    const { client, calls } = makeV2Client({ skills: [{ id: "sk_1", name: "commit" }] })
    const id = await sendV2(client, {
      id: "ses_1",
      providerID: "p",
      modelID: "m",
      text: "/commit please",
      skills: { names: ["commit", "ghost"], instructionFor: (names: readonly string[]) => names.length ? `hint:${names.join(",")}` : null },
    }, [], "msg_1")
    expect(id).toBe("msg_1")
    const synthetic = calls.find((call) => call.kind === "synthetic")
    expect(synthetic?.text).toBe("hint:ghost")
    const prompt = calls.find((call) => call.kind === "prompt")
    expect(prompt?.skills).toEqual([{ id: "sk_1" }])
    expect(prompt?.text).toBe("/commit please")
  })

  test("a failed skill list degrades to the instruction without blocking", async () => {
    const { client, calls } = makeV2Client({})
    Object.defineProperty(client.skill, "list", { value: async () => { throw new Error("list failed") } })
    await sendV2(client, {
      id: "ses_1",
      providerID: "p",
      modelID: "m",
      text: "go",
      skills: { names: ["commit"], instructionFor: (names: readonly string[]) => `hint:${names.join(",")}` },
    }, [], "msg_1")
    const synthetic = calls.find((call) => call.kind === "synthetic")
    expect(synthetic?.text).toBe("hint:commit")
  })

  test("a skill removed between list and prompt retries once without the attachment", async () => {
    const notFound = new Error("unexpected status", { cause: { _tag: "SkillNotFoundError", status: 404 } })
    expect(isV2SkillNotFound(notFound)).toBe(true)
    const { client, calls } = makeV2Client({ skills: [{ id: "sk_1", name: "commit" }], promptError: notFound })
    // First prompt fails; the retry must go out with no skills and a hint.
    Object.defineProperty(client.session, "prompt", {
      value: (input: Record<string, unknown>) => {
        calls.push({ kind: "prompt", ...input })
        if (input.skills && (input.skills as unknown[]).length > 0) throw notFound
        return Promise.resolve({ id: input.id })
      },
    })
    const id = await sendV2(client, {
      id: "ses_1",
      providerID: "p",
      modelID: "m",
      text: "go",
      skills: { names: ["commit"], instructionFor: (names: readonly string[]) => names.length ? `hint:${names.join(",")}` : null },
    }, [], "msg_1")
    expect(id).toBe("msg_1")
    const prompts = calls.filter((call) => call.kind === "prompt")
    expect(prompts).toHaveLength(2)
    expect(prompts[0].skills).toEqual([{ id: "sk_1" }])
    expect(prompts[1].skills).toBeUndefined()
    const synthetic = calls.find((call) => call.kind === "synthetic")
    expect(synthetic?.text).toBe("hint:commit")
  })

  test("batched queued text joins one prompt; synthetic members ride ahead", async () => {
    const { client, calls } = makeV2Client({})
    await sendV2(client, {
      id: "ses_1",
      providerID: "p",
      modelID: "m",
      text: "first",
      additionalParts: [
        { text: "queued two" },
        { text: "context carrier", synthetic: true },
      ],
    }, [], "msg_1")
    const prompt = calls.find((call) => call.kind === "prompt")
    expect(prompt?.text).toBe("first\n\nqueued two")
    const synthetic = calls.find((call) => call.kind === "synthetic")
    expect(synthetic?.text).toBe("context carrier")
  })

  test("steer delivery rides the prompt", async () => {
    const { client, calls } = makeV2Client({})
    await sendV2(client, { id: "ses_1", providerID: "p", modelID: "m", text: "go" }, [], "msg_1", "steer")
    const prompt = calls.find((call) => call.kind === "prompt")
    expect(prompt?.delivery).toBe("steer")
  })

  test("structured output fails honestly on the v2 track", async () => {
    const { client, calls } = makeV2Client({})
    await expect(sendV2(client, {
      id: "ses_1",
      providerID: "p",
      modelID: "m",
      text: "go",
      format: { type: "json_schema", schema: {} },
    }, [], "msg_1")).rejects.toThrow("Structured output")
    expect(calls).toEqual([])
  })
})
