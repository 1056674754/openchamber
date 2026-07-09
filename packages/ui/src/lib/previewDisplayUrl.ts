type PreviewHeaderDisplayUrlInput = {
  readonly rawUrl: string;
  readonly directSrc: string;
  readonly effectiveSrc: string;
};

export const resolvePreviewHeaderDisplayUrl = ({
  rawUrl,
  directSrc,
  effectiveSrc,
}: PreviewHeaderDisplayUrlInput): string => {
  const direct = directSrc.trim();
  if (direct) {
    return direct;
  }

  const raw = rawUrl.trim();
  if (raw) {
    return raw;
  }

  return effectiveSrc.startsWith('/api/preview/proxy/') ? '' : effectiveSrc.trim();
};
