import { describe, expect, test } from "bun:test"

import { createSteerTransformRuntime } from "./steer-transform.js"

function baseOutput(sessionID: string) {
  return {
    messages: [
      {
        info: {
          id: "msg_start",
          role: "user",
          sessionID,
        },
        parts: [
          {
            id: "prt_start",
            messageID: "msg_start",
            sessionID,
            type: "text",
            text: "Start working",
          },
        ],
      },
    ],
  }
}

function admitSteer(sessionID: string, messageID: string, text: string) {
  return {
    type: "session.next.prompt.admitted",
    properties: {
      sessionID,
      messageID,
      delivery: "steer",
      prompt: { text },
    },
  }
}

describe("createSteerTransformRuntime", () => {
  test("injects an admitted live steer into the matching session message batch", () => {
    const runtime = createSteerTransformRuntime()
    runtime.recordEvent(admitSteer("ses_active", "msg_steer", "Change direction"))

    const output = baseOutput("ses_active")
    runtime.injectMessages(output)

    expect(output.messages).toHaveLength(2)
    expect(output.messages[1]?.info).toMatchObject({
      id: "msg_steer",
      role: "user",
      sessionID: "ses_active",
    })
    expect(output.messages[1]?.parts[0]?.text).toContain("Change direction")
  })

  test("does not inject a steer into another session", () => {
    const runtime = createSteerTransformRuntime()
    runtime.recordEvent(admitSteer("ses_active", "msg_steer", "Change direction"))

    const output = baseOutput("ses_other")
    runtime.injectMessages(output)

    expect(output.messages).toHaveLength(1)
  })

  test("does not inject queue admissions", () => {
    const runtime = createSteerTransformRuntime()
    runtime.recordEvent({
      type: "session.next.prompt.admitted",
      properties: {
        sessionID: "ses_active",
        messageID: "msg_queue",
        delivery: "queue",
        prompt: { text: "Run later" },
      },
    })

    const output = baseOutput("ses_active")
    runtime.injectMessages(output)

    expect(output.messages).toHaveLength(1)
  })

  test("drops pending steer after a promoted event", () => {
    const runtime = createSteerTransformRuntime()
    runtime.recordEvent(admitSteer("ses_active", "msg_steer", "Change direction"))
    runtime.recordEvent({
      type: "session.next.prompt.promoted",
      properties: {
        sessionID: "ses_active",
        messageID: "msg_steer",
        prompt: { text: "Change direction" },
      },
    })

    const output = baseOutput("ses_active")
    runtime.injectMessages(output)

    expect(output.messages).toHaveLength(1)
  })

  test("injects a pending steer only once", () => {
    const runtime = createSteerTransformRuntime()
    runtime.recordEvent(admitSteer("ses_active", "msg_steer", "Change direction"))

    const first = baseOutput("ses_active")
    runtime.injectMessages(first)
    const second = baseOutput("ses_active")
    runtime.injectMessages(second)

    expect(first.messages).toHaveLength(2)
    expect(second.messages).toHaveLength(1)
  })
})
