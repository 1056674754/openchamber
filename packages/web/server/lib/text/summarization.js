/**
 * Shared text summarization service.
 *
 * Modes:
 * - tts: concise speakable text
 * - notification: concise notification text
 * - note: distilled project note
 * - topic: short directory-name-friendly topic
 *
 * Helpers:
 * - generateSessionTitleCandidates: produces 3 human-readable session title
 *   candidates via the same zen API, without touching any OpenCode session.
 */

function buildSummarizationPrompt(maxLength, mode = 'tts') {
  if (mode === 'note') {
    return `You are distilling selected assistant text into a single short project note.

Goal:
- Produce one concise note the user may want to keep in project notes.

Rules:
1. Output ONLY the final note text.
2. Keep the result under ${maxLength} characters.
3. Prefer one sentence or a short sentence fragment.
4. Keep the most useful insight, decision, constraint, or recommendation.
5. Be concrete and specific.
6. Do not use markdown, bullets, code fences, headings, or quotes.
7. Do not mention the assistant, the text, or that this is a summary.
8. Do not include filler like In summary or Heres a note.
9. If the text contains multiple ideas, keep only the most important one.
10. Rewrite and compress the input into a distilled note. Do not copy the source text verbatim unless it is already an extremely short note.
11. Prefer a shorter phrasing than the input whenever possible.
12. Write the result as a plain sentence or sentence fragment, not as a bullet point.`;
  }

  if (mode === 'notification') {
    return `Summarize the following text in approximately ${maxLength} characters. Be concise and capture the key point.

Rules:
1. Output plain text only.
2. Do not use markdown, bullets, headings, code fences, backticks, or quotes.
3. Output only the summary text.
4. Prefer a short notification-friendly sentence.`;
  }

  if (mode === 'topic') {
    return `Generate a very short topic name (2-5 words) for this conversation, suitable as a directory name.

Rules:
1. Output ONLY the topic name. Nothing else.
2. Use lowercase words separated by hyphens (e.g. "fix-auth-bug", "add-search-feature").
3. No special characters except hyphens.
4. Maximum 50 characters.
5. Be descriptive but extremely concise.
6. Do not use generic words like "conversation", "chat", "task", "help".
7. Focus on the primary action or subject of the conversation.`;
  }

  return `You are a text summarizer for text-to-speech output. Create a concise, natural-sounding summary that captures the key points. Keep the summary under ${maxLength} characters.

CRITICAL INSTRUCTIONS:
1. Output ONLY the final summary - no thinking, no reasoning, no explanations
2. Do not show your work or thought process
3. Do not use any special characters, markdown, code, URLs, file paths, or formatting
4. Do not include phrases like "Here's a summary" or "In summary"
5. Just provide clean, speakable text that can be read aloud
6. Stay within the ${maxLength} character limit

Your response should be ready to speak immediately.`;
}

const SUMMARIZE_TIMEOUT_MS = 30_000;

export function sanitizeForTTS(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/[*_~`#]/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/^\s*[$#>]\s*/gm, '')
    .replace(/[|&;<>]/g, ' ')
    .replace(/\\/g, '')
    .replace(/[\[\]{}()]/g, '')
    .replace(/["']/g, '')
    .replace(/https?:\/\/[^\s]+/g, ' a link ')
    .replace(/\/[\w\-./]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeForNotification(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[\t ]*[-*+]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeForNote(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeByMode(text, mode) {
  if (mode === 'topic') return sanitizeForTopic(text);
  if (mode === 'note') return sanitizeForNote(text);
  if (mode === 'notification') return sanitizeForNotification(text);
  return sanitizeForTTS(text);
}

function sanitizeForTopic(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .toLowerCase()
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function clampToMaxLength(text, maxLength) {
  if (!text) return '';
  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : Infinity;
  if (text.length <= limit) return text;
  return text.slice(0, limit).trim();
}

function extractZenOutputText(data) {
  if (!data || typeof data !== 'object') return null;
  const output = data.output;
  if (!Array.isArray(output)) return null;

  const messageItem = output.find((item) => item && typeof item === 'object' && item.type === 'message');
  if (!messageItem) return null;

  const content = messageItem.content;
  if (!Array.isArray(content)) return null;

  const textItem = content.find((item) => item && typeof item === 'object' && item.type === 'output_text');
  const text = typeof textItem?.text === 'string' ? textItem.text.trim() : '';
  return text || null;
}

function extractZenChatCompletionText(data) {
  if (!data || typeof data !== 'object') return null;
  const choices = data.choices;
  if (!Array.isArray(choices)) return null;

  const choice = choices.find((item) => item && typeof item === 'object');
  const content = choice?.message?.content;
  if (typeof content === 'string') {
    const text = content.trim();
    return text || null;
  }
  if (!Array.isArray(content)) return null;

  const text = content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof item.text === 'string') return item.text;
      return '';
    })
    .join('')
    .trim();
  return text || null;
}

function getZenCompletionEndpoint(model) {
  if (typeof model !== 'string') return 'responses';
  if (
    model.startsWith('gpt-')
    || model.startsWith('claude-')
    || model.startsWith('gemini-')
  ) {
    return 'responses';
  }
  return 'chat/completions';
}

function distillNoteFallback(text, maxLength) {
  const sanitized = sanitizeForNote(text);
  if (!sanitized) return '';

  const normalized = sanitized
    .replace(/^In summary[:,]?\s*/i, '')
    .replace(/^Here(?:s| is) (?:a )?note[:,]?\s*/i, '')
    .trim();

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const best = (sentences[0] || normalized)
    .split(/[;:()-]\s+/)[0]
    .split(/,\s+/)[0]
    .trim();
  const idealLimit = Math.min(maxLength, Math.max(32, Math.floor(normalized.length * 0.65)));

  if (best.length <= idealLimit) return best;

  const clipped = best.slice(0, Math.max(0, idealLimit - 1)).trim();
  return clipped ? `${clipped}…` : best.slice(0, idealLimit).trim();
}

function fallbackByMode(text, maxLength, mode) {
  if (mode === 'topic') return sanitizeForTopic(text || '');
  if (mode === 'note') return distillNoteFallback(text, maxLength);
  return sanitizeByMode(text, mode);
}

export async function summarizeText({ text, threshold = 200, maxLength = 500, zenModel, mode = 'tts' }) {
  if (!text || text.length <= threshold) {
    return {
      summary: fallbackByMode(text || '', maxLength, mode),
      summarized: false,
      reason: text ? 'Text under threshold' : 'No text provided',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARIZE_TIMEOUT_MS);

  try {
    const prompt = buildSummarizationPrompt(maxLength, mode);
    const model = zenModel || 'gpt-5-nano';
    const endpoint = getZenCompletionEndpoint(model);
    const response = await fetch(`https://opencode.ai/zen/v1/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint === 'responses'
        ? {
            model,
            input: [{ role: 'user', content: `${prompt}\n\nText to summarize:\n${text}` }],
            stream: false,
            reasoning: { effort: 'low' },
          }
        : {
            model,
            messages: [{ role: 'user', content: `${prompt}\n\nText to summarize:\n${text}` }],
            stream: false,
          }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error('[Summarize] zen API error:', response.status, errorBody);
      return {
        summary: fallbackByMode(text, maxLength, mode),
        summarized: false,
        reason: `zen API returned ${response.status}`,
      };
    }

    const data = await response.json();
    const summary = endpoint === 'responses'
      ? extractZenOutputText(data)
      : extractZenChatCompletionText(data);

    if (summary) {
      const sanitized = sanitizeByMode(summary, mode);
      const finalSummary = mode === 'note'
        ? (sanitized && sanitized !== sanitizeForNote(text) ? sanitized : distillNoteFallback(text, maxLength))
        : sanitized;
      const clippedSummary = clampToMaxLength(finalSummary, maxLength);
      return {
        summary: clippedSummary,
        summarized: true,
        originalLength: text.length,
        summaryLength: clippedSummary.length,
      };
    }

    return {
      summary: fallbackByMode(text, maxLength, mode),
      summarized: false,
      reason: 'No response from model',
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('[Summarize] Request timed out');
      return {
        summary: fallbackByMode(text, maxLength, mode),
        summarized: false,
        reason: 'Request timed out',
      };
    }
    console.error('[Summarize] Error:', error);
    return {
      summary: fallbackByMode(text, maxLength, mode),
      summarized: false,
      reason: error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_SESSION_TITLE_COUNT = 3;
const DEFAULT_SESSION_TITLE_MAX_LENGTH = 60;

function buildSessionTitleCandidatesPrompt(count, maxLength) {
  return `You are generating ${count} concise alternative titles for a chat session. You will receive an excerpt of the conversation.

Rules:
1. Output ONLY a JSON array of exactly ${count} strings. No prose. No markdown. No code fences.
2. Each title must be at most ${maxLength} characters.
3. Each title must be human-readable and natural-language (NOT kebab-case, NOT a filename).
4. Match the dominant language of the conversation (Chinese stays Chinese, English stays English, etc.).
5. Focus on the most recent or dominant topic of the conversation, not stale earlier threads.
6. Titles should be specific and descriptive. Avoid generic words like "conversation", "chat", "help", "discussion".
7. Do NOT wrap titles in quotes.
8. Give three distinct angles: e.g. one focused on the primary action, one on the subject matter, one on the outcome.

Output format example (array of strings):
["First title", "Second title", "Third title"]`;
}

function sanitizeSessionTitleCandidate(raw, maxLength) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  value = value.replace(/^["'`\u201c\u201d\u2018\u2019\u00ab\u00bb\s]+/, '');
  value = value.replace(/["'`\u201c\u201d\u2018\u2019\u00ab\u00bb\s]+$/, '');
  value = value.replace(/\s+/g, ' ');
  value = value.replace(/^\s*[-*\u2022\u2023\u25cb]\s*/, '');
  value = value.replace(/^\s*\d+[.)]\s*/, '');
  if (value.length > maxLength) {
    value = value.slice(0, maxLength).trim();
  }
  return value;
}

function extractCandidatesFromOutput(rawOutput, count, maxLength) {
  if (typeof rawOutput !== 'string') return [];
  const trimmed = rawOutput.trim();
  if (!trimmed) return [];

  const withoutFence = trimmed
    .replace(/^```(?:json|JSON)?\s*/, '')
    .replace(/```$/, '')
    .trim();

  const jsonStart = withoutFence.indexOf('[');
  const jsonEnd = withoutFence.lastIndexOf(']');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const jsonSlice = withoutFence.slice(jsonStart, jsonEnd + 1);
    try {
      const parsed = JSON.parse(jsonSlice);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .map((item) => sanitizeSessionTitleCandidate(item, maxLength))
          .filter((item) => item.length > 0);
        if (cleaned.length > 0) {
          return cleaned.slice(0, count);
        }
      }
    } catch (_error) {
      void _error;
    }
  }

  const lines = withoutFence
    .split(/\r?\n/)
    .map((line) => sanitizeSessionTitleCandidate(line, maxLength))
    .filter((line) => line.length > 0);
  if (lines.length > 0) {
    return lines.slice(0, count);
  }

  return [];
}

export async function generateSessionTitleCandidates({
  text,
  count = DEFAULT_SESSION_TITLE_COUNT,
  maxLength = DEFAULT_SESSION_TITLE_MAX_LENGTH,
  zenModel,
}) {
  const safeCount = Math.max(1, Math.min(5, Number.isFinite(count) ? Number(count) : DEFAULT_SESSION_TITLE_COUNT));
  const safeMaxLength = Math.max(10, Math.min(120, Number.isFinite(maxLength) ? Number(maxLength) : DEFAULT_SESSION_TITLE_MAX_LENGTH));

  if (!text || typeof text !== 'string' || !text.trim()) {
    return {
      candidates: [],
      generated: false,
      reason: 'No text provided',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARIZE_TIMEOUT_MS);

  try {
    const prompt = buildSessionTitleCandidatesPrompt(safeCount, safeMaxLength);
    const model = zenModel || 'gpt-5-nano';
    const endpoint = getZenCompletionEndpoint(model);
    const response = await fetch(`https://opencode.ai/zen/v1/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint === 'responses'
        ? {
            model,
            input: [{ role: 'user', content: `${prompt}\n\nConversation excerpt:\n${text}` }],
            stream: false,
            reasoning: { effort: 'low' },
          }
        : {
            model,
            messages: [{ role: 'user', content: `${prompt}\n\nConversation excerpt:\n${text}` }],
            stream: false,
          }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error('[SessionTitle] zen API error:', response.status, errorBody);
      return {
        candidates: [],
        generated: false,
        reason: `zen API returned ${response.status}`,
      };
    }

    const data = await response.json();
    const rawOutput = endpoint === 'responses'
      ? extractZenOutputText(data)
      : extractZenChatCompletionText(data);

    const candidates = extractCandidatesFromOutput(rawOutput || '', safeCount, safeMaxLength);
    if (candidates.length === 0) {
      return {
        candidates: [],
        generated: false,
        reason: 'No valid candidates parsed from model output',
      };
    }

    return {
      candidates,
      generated: true,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('[SessionTitle] Request timed out');
      return {
        candidates: [],
        generated: false,
        reason: 'Request timed out',
      };
    }
    console.error('[SessionTitle] Error:', error);
    return {
      candidates: [],
      generated: false,
      reason: error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}
