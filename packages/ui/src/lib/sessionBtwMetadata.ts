import type { Session } from '@opencode-ai/sdk/v2';

import { getSessionMetadata, type SessionMetadataRecord } from '@/lib/sessionReviewMetadata';

type BtwMetadata = {
  kind?: string;
  originalSessionID?: string;
  btwSessionID?: string;
  /** Identity marker only. Consumers locate it in chronological message order. */
  btwBoundaryMessageID?: string;
  btwPromoted?: boolean;
};

const getOpenChamberMetadata = (metadata: SessionMetadataRecord): BtwMetadata => {
  const value = metadata.openchamber;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as BtwMetadata;
};

const nonEmpty = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
);

/** Parent-session link to its one active temporary side conversation. */
export const getBtwSessionID = (session: Session | null | undefined): string | null => (
  nonEmpty(getOpenChamberMetadata(getSessionMetadata(session)).btwSessionID)
);

export const getBtwOriginalSessionID = (session: Session | null | undefined): string | null => {
  const metadata = getOpenChamberMetadata(getSessionMetadata(session));
  return metadata.kind === 'btw' ? nonEmpty(metadata.originalSessionID) : null;
};

export const isBtwSession = (session: Session | null | undefined): boolean => (
  getOpenChamberMetadata(getSessionMetadata(session)).kind === 'btw'
  && getBtwOriginalSessionID(session) !== null
);

export const getBtwBoundaryMessageID = (session: Session | null | undefined): string | null => {
  const metadata = getOpenChamberMetadata(getSessionMetadata(session));
  return metadata.kind === 'btw' ? nonEmpty(metadata.btwBoundaryMessageID) : null;
};

/** Promoted transcripts keep old boundary parts, so later sends need a revocation notice. */
export const wasPromotedBtwSession = (session: Session | null | undefined): boolean => (
  getOpenChamberMetadata(getSessionMetadata(session)).btwPromoted === true
);

export const withBtwSessionLink = (
  metadata: SessionMetadataRecord,
  btwSessionID: string,
): SessionMetadataRecord => ({
  ...metadata,
  openchamber: {
    ...getOpenChamberMetadata(metadata),
    btwSessionID,
  },
});

/**
 * Forked sessions inherit parent metadata wholesale. Replace the OpenChamber
 * namespace so a review link or older btw link cannot leak into the fork.
 */
export const withBtwSessionMarker = (
  metadata: SessionMetadataRecord,
  originalSessionID: string,
  boundaryMessageID: string | null,
): SessionMetadataRecord => ({
  ...metadata,
  openchamber: {
    kind: 'btw',
    originalSessionID,
    ...(boundaryMessageID ? { btwBoundaryMessageID: boundaryMessageID } : {}),
  },
});

export const withoutBtwSessionMarker = (metadata: SessionMetadataRecord): SessionMetadataRecord => {
  const openchamber = getOpenChamberMetadata(metadata);
  if (openchamber.kind !== 'btw') return metadata;
  const nextOpenChamber: BtwMetadata = { ...openchamber, btwPromoted: true };
  delete nextOpenChamber.kind;
  delete nextOpenChamber.originalSessionID;
  delete nextOpenChamber.btwBoundaryMessageID;
  return { ...metadata, openchamber: nextOpenChamber };
};

/** Unlink only the expected fork; a delayed cleanup cannot remove a newer link. */
export const withoutBtwSessionLink = (
  metadata: SessionMetadataRecord,
  btwSessionID: string,
): SessionMetadataRecord => {
  const openchamber = getOpenChamberMetadata(metadata);
  if (openchamber.btwSessionID !== btwSessionID) return metadata;
  const nextOpenChamber: BtwMetadata = { ...openchamber };
  delete nextOpenChamber.btwSessionID;
  const next: SessionMetadataRecord = { ...metadata };
  if (Object.keys(nextOpenChamber).length === 0) delete next.openchamber;
  else next.openchamber = nextOpenChamber;
  return next;
};
