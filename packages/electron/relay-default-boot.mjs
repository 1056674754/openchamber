export const shouldRetryDefaultHostProbe = (status, relayCapable) => (
  status === 'unreachable' && relayCapable !== true
);

export const shouldUseLocalSubstrateForDefaultHost = (status, relayCapable) => (
  relayCapable === true && status !== 'ok'
);

export const resolveDefaultHostBootStatus = (status, relayCapable) => {
  if (relayCapable === true && status && status !== 'ok') return 'ok';
  if (status === 'unreachable') return 'unreachable';
  if (status === 'wrong-service') return 'wrong-service';
  return 'ok';
};
