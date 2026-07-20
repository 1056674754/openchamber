import { isSensitiveToolInputKey } from '@/lib/toolHelpers';

export interface ToolInputField {
  key: string;
  kind: 'command' | 'path' | 'text' | 'url';
  label: string;
  value: string;
}

export interface ToolInputMedia {
  label: string;
  source: string;
}

export interface ToolInputPresentation {
  fields: ToolInputField[];
  media: ToolInputMedia[];
  summary: string;
  summaryKey: string;
  summaryLabel: string;
}

const FIELD_PRIORITY = [
  'goal',
  'query',
  'search_query',
  'prompt',
  'instructions',
  'description',
  'pattern',
  'command',
  'url',
  'uri',
  'file_path',
  'file_paths',
  'image_path',
  'image_paths',
  'image_source',
  'image_sources',
  'screenshot_path',
  'screenshot_paths',
  'path',
  'paths',
] as const;

const SUMMARY_KEYS = new Set([
  'goal',
  'query',
  'search_query',
  'prompt',
  'instructions',
  'description',
  'pattern',
  'command',
  'url',
  'uri',
]);

const MEDIA_KEYS = new Set([
  'file_path',
  'file_paths',
  'image',
  'images',
  'image_data',
  'image_path',
  'image_paths',
  'image_source',
  'image_sources',
  'screenshot',
  'screenshot_path',
  'screenshot_paths',
]);

const IMAGE_FILE_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const MAX_FIELDS = 6;
const MAX_FIELD_LENGTH = 240;
const MAX_SUMMARY_LENGTH = 160;
const MAX_RESULT_SUMMARY_LENGTH = 180;

function normalizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s.-]+/g, '_').toLowerCase();
}

function humanizeKey(key: string): string {
  const normalized = normalizeKey(key);
  const knownLabels: Record<string, string> = {
    command: 'Command',
    description: 'Description',
    file_path: 'File',
    file_paths: 'Files',
    goal: 'Goal',
    image_data: 'Image',
    image_path: 'Image',
    image_paths: 'Images',
    image_source: 'Image',
    image_sources: 'Images',
    instructions: 'Instructions',
    pattern: 'Pattern',
    prompt: 'Prompt',
    query: 'Query',
    screenshot: 'Screenshot',
    screenshot_path: 'Screenshot',
    screenshot_paths: 'Screenshots',
    search_query: 'Query',
    uri: 'URL',
    url: 'URL',
  };

  return knownLabels[normalized]
    ?? normalized.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

function compactText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function scalarStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => (
    typeof item === 'string' && item.trim()
      ? [item]
      : typeof item === 'number' || typeof item === 'boolean'
        ? [String(item)]
        : []
  ));
}

function mediaLabel(source: string): string {
  if (source.startsWith('data:image/')) return 'Image input';

  const cleanSource = source.replace(/[?#].*$/, '').replace(/\\/g, '/');
  const lastSegment = cleanSource.split('/').filter(Boolean).at(-1);
  if (!lastSegment) return 'Image input';

  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

function isMediaSource(key: string, source: string, toolName: string): boolean {
  if (source.startsWith('data:image/')) return true;
  if (MEDIA_KEYS.has(key) && (key !== 'file_path' && key !== 'file_paths')) return true;
  if (IMAGE_FILE_PATTERN.test(source)) return true;
  return normalizeKey(toolName) === 'look_at' && (key === 'file_path' || key === 'file_paths');
}

function fieldKind(key: string, value: string): ToolInputField['kind'] {
  if (key === 'command') return 'command';
  if (key === 'url' || key === 'uri' || /^https?:\/\//i.test(value)) return 'url';
  if (key.includes('path') || key === 'file' || key === 'files') return 'path';
  return 'text';
}

export function buildToolInputPresentation(
  toolName: string,
  input: Record<string, unknown> | undefined,
): ToolInputPresentation {
  if (!input) return { fields: [], media: [], summary: '', summaryKey: '', summaryLabel: '' };

  const orderedEntries = Object.entries(input)
    .map(([key, value], inputIndex) => ({ inputIndex, key, normalizedKey: normalizeKey(key), value }))
    .filter(({ key }) => !isSensitiveToolInputKey(key))
    .sort((left, right) => {
      const leftPriority = FIELD_PRIORITY.indexOf(left.normalizedKey as (typeof FIELD_PRIORITY)[number]);
      const rightPriority = FIELD_PRIORITY.indexOf(right.normalizedKey as (typeof FIELD_PRIORITY)[number]);
      const normalizedLeftPriority = leftPriority === -1 ? FIELD_PRIORITY.length : leftPriority;
      const normalizedRightPriority = rightPriority === -1 ? FIELD_PRIORITY.length : rightPriority;
      return normalizedLeftPriority - normalizedRightPriority || left.inputIndex - right.inputIndex;
    });

  const media: ToolInputMedia[] = [];
  const fields: ToolInputField[] = [];
  let summary = '';
  let summaryKey = '';
  let summaryLabel = '';

  for (const { key, normalizedKey, value } of orderedEntries) {
    const values = scalarStrings(value);
    if (values.length === 0) continue;

    for (const source of values) {
      if (!isMediaSource(normalizedKey, source, toolName)) continue;
      media.push({ label: mediaLabel(source), source });
    }

    if (!summary && SUMMARY_KEYS.has(normalizedKey)) {
      summary = compactText(values[0], MAX_SUMMARY_LENGTH);
      summaryKey = key;
      summaryLabel = humanizeKey(key);
    }

    if (fields.length >= MAX_FIELDS) continue;
    const displayValue = normalizedKey === 'image_data'
      ? 'Embedded image data'
      : values.length === 1
        ? values[0]
        : values.join(', ');
    fields.push({
      key,
      kind: fieldKind(normalizedKey, displayValue),
      label: humanizeKey(key),
      value: compactText(displayValue, MAX_FIELD_LENGTH),
    });
  }

  if (!summary && media.length === 1) {
    summary = media[0].label;
    summaryLabel = 'Image';
  }
  if (!summary && media.length > 1) {
    summary = `${media.length} images`;
    summaryLabel = 'Images';
  }
  if (!summary && fields.length > 0) {
    summary = compactText(fields[0].value, MAX_SUMMARY_LENGTH);
    summaryKey = fields[0].key;
    summaryLabel = fields[0].label;
  }

  return { fields, media, summary, summaryKey, summaryLabel };
}

export function matchesToolInputSummary(
  value: string | null | undefined,
  input: Record<string, unknown> | undefined,
  presentation: ToolInputPresentation,
): boolean {
  if (!value || !input || !presentation.summaryKey) return false;

  const normalizedValue = value.replace(/\s+/g, ' ').trim();
  return scalarStrings(input[presentation.summaryKey]).some(
    (source) => source.replace(/\s+/g, ' ').trim() === normalizedValue,
  );
}

export function buildToolResultSummary(output: string | undefined): string {
  if (!output) return '';

  const withoutTaskMetadata = output
    .replace(/\n*<task_metadata>[\s\S]*?<\/task_metadata>\s*$/i, '')
    .trim();
  if (!withoutTaskMetadata) return '';

  const readableText = withoutTaskMetadata
    .replace(/^\s*(?:[-*+]\s+|#{1,6}\s+|>\s*)/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

  return compactText(readableText, MAX_RESULT_SUMMARY_LENGTH);
}
