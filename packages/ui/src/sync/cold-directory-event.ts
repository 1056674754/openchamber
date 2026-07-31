import type { Event, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"

export type ColdDirectoryEventDecision =
  | { readonly kind: "session"; readonly info: Session }
  | { readonly kind: "status"; readonly sessionID: string; readonly status: SessionStatus }
  | { readonly kind: "delete"; readonly sessionID: string }
  | { readonly kind: "materialize" }
  | { readonly kind: "ignore" }

export function classifyColdDirectoryEvent(event: Event): ColdDirectoryEventDecision {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      return { kind: "session", info: event.properties.info }
    case "session.status":
      return {
        kind: "status",
        sessionID: event.properties.sessionID,
        status: event.properties.status,
      }
    case "session.idle":
      return {
        kind: "status",
        sessionID: event.properties.sessionID,
        status: { type: "idle" },
      }
    case "session.error":
      return event.properties.sessionID
        ? {
            kind: "status",
            sessionID: event.properties.sessionID,
            status: { type: "idle" },
          }
        : { kind: "ignore" }
    case "session.deleted":
      return { kind: "delete", sessionID: event.properties.sessionID }
    case "permission.asked":
    case "question.asked":
      return { kind: "materialize" }
    default:
      return { kind: "ignore" }
  }
}
