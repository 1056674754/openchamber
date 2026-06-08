import type { RemoteInstance } from '@/lib/remote-instances/types';

const WEB_REMOTE_INSTANCE_DRAFT_ID_PREFIX = 'web-draft:';

export const makeWebRemoteDraftSelectionId = (id: string): string =>
  `${WEB_REMOTE_INSTANCE_DRAFT_ID_PREFIX}${id}`;

export const parseWebRemoteDraftSelectionId = (selectedId?: string | null): string | null => {
  if (!selectedId?.startsWith(WEB_REMOTE_INSTANCE_DRAFT_ID_PREFIX)) {
    return null;
  }
  const id = selectedId.slice(WEB_REMOTE_INSTANCE_DRAFT_ID_PREFIX.length);
  return id.length > 0 ? id : null;
};

export const createWebRemoteDraft = (id: string, label: string): RemoteInstance => ({
  id,
  label,
  enabled: true,
  url: '',
});
