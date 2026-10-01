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

/**
 * v2-track mutation response (spine OC2-S3, upstream `654705f7d`).
 *
 * OpenCode 2 watches every config source it reads — agents, commands, skills,
 * MCP servers, providers, instructions and the plugin list — and rebuilds them
 * when a file changes. A mutation that lands on disk is therefore already live
 * by the time the route answers, so config mutations report plain success and
 * never ask for a restart. Only the v1 track keeps
 * `buildDeferredRestartResponse`; routes pick per protocol mode.
 *
 * `details` carries the file the mutation landed in (`{ path, scope, source }`).
 * OpenChamber never moves an entity between files, so the caller can show the
 * user exactly which config file changed — including a v1 file that was
 * rewritten in place in v2 shape.
 */
export function buildAppliedResponse(message, details) {
  return {
    success: true,
    message,
    ...(details && typeof details === 'object' ? details : {}),
  };
}
