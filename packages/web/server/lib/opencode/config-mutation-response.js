export function buildDeferredRestartResponse(message, pendingRestart) {
  return {
    success: true,
    requiresReload: false,
    requiresRestart: true,
    restartDeferred: true,
    pendingRestart,
    message,
  };
}
