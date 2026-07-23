/**
 * Detect environment variables that may override a provider's non-environment credential.
 * @param {{env?: string[], source?: string, auth?: {configured?: boolean, source?: string}}} provider
 * @param {Record<string, string|undefined>} processEnv
 * @returns {Array<{type: 'env-override', message: string}>}
 */
export const detectConflicts = (provider, processEnv) => {
  const source = provider?.auth?.source ?? provider?.source ?? 'none';
  const configured = provider?.auth ? provider.auth.configured === true : source !== 'none';
  if (!configured || source === 'env' || source === 'none') return [];

  const envVars = Array.isArray(provider?.env) ? provider.env : [];
  return envVars
    .filter((name) => typeof name === 'string' && name.length > 0 && processEnv[name] !== undefined)
    .map((name) => ({
      type: 'env-override',
      message: `${name} is set and may take precedence over stored credentials`,
    }));
};
