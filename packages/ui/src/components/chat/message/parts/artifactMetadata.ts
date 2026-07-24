import { z } from 'zod';

const ArtifactIdSchema = z.string().regex(/^[a-f0-9]{64}$/).brand<'ArtifactId'>();

const OpenChamberArtifactSchema = z.object({
  version: z.literal(1),
  id: ArtifactIdSchema,
  name: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  mime: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(['archive', 'document', 'file', 'image']),
  sessionID: z.string().min(1),
  messageID: z.string().min(1),
  createdAt: z.string().datetime(),
});

const ArtifactMetadataSchema = z.object({
  openchamberArtifact: OpenChamberArtifactSchema,
});

export type OpenChamberArtifact = z.infer<typeof OpenChamberArtifactSchema>;

export function parseOpenChamberArtifact(metadata: unknown): OpenChamberArtifact | null {
  const result = ArtifactMetadataSchema.safeParse(metadata);
  return result.success ? result.data.openchamberArtifact : null;
}

export function parsePublishedArtifactToolPart(part: unknown): OpenChamberArtifact | null {
  if (!part || typeof part !== 'object') return null;

  const candidate = part as {
    type?: unknown;
    tool?: unknown;
    state?: { metadata?: unknown };
  };
  if (candidate.type !== 'tool' || candidate.tool !== 'publish_artifact') return null;

  return parseOpenChamberArtifact(candidate.state?.metadata);
}

export function formatArtifactSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
