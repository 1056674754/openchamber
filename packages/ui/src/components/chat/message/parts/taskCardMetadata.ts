import { z } from 'zod';

const OpenChamberTaskCardSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(120),
  tldr: z.string().min(1).max(400).optional(),
  prompt: z.string().min(1),
  agent: z.string().min(1).optional(),
  sessionID: z.string().min(1),
  directory: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
});

const TaskCardMetadataSchema = z.object({
  openchamberTaskCard: OpenChamberTaskCardSchema,
});

export type OpenChamberTaskCard = z.infer<typeof OpenChamberTaskCardSchema>;

export function parseOpenChamberTaskCard(metadata: unknown): OpenChamberTaskCard | null {
  const result = TaskCardMetadataSchema.safeParse(metadata);
  return result.success ? result.data.openchamberTaskCard : null;
}

export function parseOfferedTaskToolPart(part: unknown): OpenChamberTaskCard | null {
  if (!part || typeof part !== 'object') return null;

  const candidate = part as {
    type?: unknown;
    tool?: unknown;
    state?: { metadata?: unknown };
  };
  if (candidate.type !== 'tool' || candidate.tool !== 'offer_task') return null;

  return parseOpenChamberTaskCard(candidate.state?.metadata);
}
