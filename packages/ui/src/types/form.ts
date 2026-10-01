/**
 * Blocking-form request shapes for the v1 protocol track.
 *
 * OpenChamber 2.x (spine S7) names this concept "form"; OpenCode 1.x framed
 * the same blocking request as a "question" and the v1 wire keeps those names
 * (`question.asked` events, `client.question.reply`, `questions` payload
 * fields, the `question` tool). The identifiers here are the fork-internal
 * vocabulary only — every wire-level string stays exactly as the v1 server
 * sends it, so v1 behavior is unchanged by the rename.
 *
 * The v2-native form type (`FormInfo`) lives in `@/lib/opencode/model` as
 * `FormRequest` and is consumed by the v2 dock components directly.
 */

export type FormAnswer = string[];

export interface FormOption {
  label: string;
  description: string;
}

export interface FormQuestion {
  question: string;
  header: string;
  options: FormOption[];
  multiple?: boolean;
}

export interface FormRequest {
  id: string;
  sessionID: string;
  questions: FormQuestion[];
  tool?: {
    messageID: string;
    callID: string;
  };
}

/** v1 wire event frames. The `question.*` type strings are the v1 contract. */
export interface FormAskedEvent {
  type: 'question.asked';
  properties: FormRequest;
}

export interface FormRepliedEvent {
  type: 'question.replied';
  properties: {
    sessionID: string;
    requestID: string;
    answers: FormAnswer[];
  };
}

export interface FormRejectedEvent {
  type: 'question.rejected';
  properties: {
    sessionID: string;
    requestID: string;
  };
}
