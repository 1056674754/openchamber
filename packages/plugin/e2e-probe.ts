/**
 * Temporary e2e probe — run against a live opencode server. Not shipped.
 * Usage: bun run e2e-probe.ts [baseUrl]
 */
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

import { createSessionListTool } from "./src/tools/session-list.js"
import { createSessionSendTool } from "./src/tools/session-send.js"
import { createOfferTaskTool } from "./src/tools/offer-task.js"

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4977"
const dirA = "/tmp/oc-e2e/dirA"
const dirB = "/tmp/oc-e2e/dirB"

const plain = createOpencodeClient({ baseUrl })
const clientA = plain
const clientB = plain

const results: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail: string) => {
  results.push([name, ok, detail])
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`)
}

const ctxA = {
  sessionID: "PENDING",
  messageID: "msg_probe",
  agent: "build",
  directory: dirA,
  worktree: dirA,
  abort: new AbortController().signal,
} as never

async function main() {
  // 1. create two root sessions in different directories (payload location —
  //    header/query location routing is broken in this build, see report)
  const a = await plain.v2.session.create({ location: { directory: dirA } }, { throwOnError: true })
  const b = await plain.v2.session.create({ location: { directory: dirB } }, { throwOnError: true })
  const aInfo = (a.data as { data?: { id?: string; title?: string } }).data
  const bInfo = (b.data as { data?: { id?: string; title?: string } }).data
  check("create sessions in two directories", !!aInfo?.id && !!bInfo?.id, `A=${aInfo?.id} B=${bInfo?.id}`)
  ctxA.sessionID = aInfo!.id!

  // 2. transport: admit-only prompt (resume:false) from A into B — cross-directory,
  //    location resolved from the session row, not the caller
  const admitted = await plain.v2.session.prompt(
    { sessionID: bInfo!.id!, prompt: { text: "[probe] direct transport check" }, delivery: "queue", resume: false },
    { throwOnError: true },
  )
  const admittedSeq = (admitted.data as { data?: { admittedSeq?: number } })?.data?.admittedSeq
  check("v2 prompt admit (resume:false, cross-directory)", typeof admittedSeq === "number", `admittedSeq=${admittedSeq}`)

  // 3. verify via durable history — admitted inputs are durable events; they
  //    appear in projected context only after the target loop promotes them
  const historyB = await plain.v2.session.history({ sessionID: bInfo!.id! }, { throwOnError: true })
  const historyRaw = JSON.stringify((historyB.data as { data?: unknown })?.data ?? historyB.data)
  const admittedEvent = historyRaw.includes("prompt.admitted") && historyRaw.includes("direct transport check")
  check("admitted input is a durable event on B", admittedEvent, historyRaw.slice(0, 160))

  // 4. real tool: session_list
  const listTool = createSessionListTool({ client: plain })
  const listResult = await listTool.execute({}, ctxA)
  const listOk = listResult.output.includes(bInfo!.id!) || listResult.output.includes("Probe B")
  check("session_list sees both roots", listOk, listResult.output.split("\n").slice(0, 6).join(" | ").slice(0, 200))

  // 5. real tool: session_send A -> B (default queue, resume default)
  const sendTool = createSessionSendTool({ client: plain })
  const sendResult = await sendTool.execute({ session_id: bInfo!.id!, message: "probe: session_send round trip" }, ctxA)
  const sendOk = sendResult.output.includes("Delivered")
  check("session_send delivers", sendOk, sendResult.output.slice(0, 160))

  // 6. verify framed message landed durably in B's input queue
  const historyB2 = await plain.v2.session.history({ sessionID: bInfo!.id! }, { throwOnError: true })
  const raw2 = JSON.stringify((historyB2.data as { data?: unknown })?.data ?? historyB2.data)
  const framed = raw2.includes("message from session") && raw2.includes("probe: session_send round trip")
  check("B received framed message + reply hint", framed, `framed=${raw2.includes("message from session")}, body=${raw2.includes("round trip")}`)

  // 7. refusal paths: self-send (child targets cannot be created via the v2
  //    API — parentID is not part of the create payload; the refusal branch
  //    is covered by unit tests)
  const selfRefusal = await sendTool.execute({ session_id: ctxA.sessionID, message: "self" }, ctxA)
  check("self-send refused", selfRefusal.output.includes("current session"), selfRefusal.output.slice(0, 100))

  // 8. offer_task metadata round trip through the real UI parser
  const offerTool = createOfferTaskTool()
  const offer = await offerTool.execute(
    { title: "Probe task", prompt: "This is a self-contained probe prompt for a new conversation." },
    ctxA,
  )
  const cardShape = {
    type: "tool",
    tool: "offer_task",
    state: { metadata: offer.metadata },
  }
  // ui parser lives in another package — inline equivalent contract check instead:
  const meta = offer.metadata as { openchamberTaskCard?: { title?: string; sessionID?: string; prompt?: string } }
  const card = meta?.openchamberTaskCard
  check(
    "offer_task emits UI-shaped card",
    !!card && card.title === "Probe task" && card.sessionID === ctxA.sessionID && typeof card.prompt === "string",
    JSON.stringify(card).slice(0, 140),
  )

  const failed = results.filter(([, ok]) => !ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error("PROBE CRASHED:", error)
  process.exit(1)
})
