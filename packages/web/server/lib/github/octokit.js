import { Octokit } from '@octokit/rest';
import { getGitHubAuth, isGhCliActive, isGhCliDisabled } from './auth.js';
import { getGhCliToken } from './gh-cli-credential.js';

const OCTOKIT_REQUEST_TIMEOUT_MS = 8000;

const timeoutFetch = (url, options = {}) => {
  if (options.signal) {
    return fetch(url, options);
  }
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(OCTOKIT_REQUEST_TIMEOUT_MS),
  });
};

export function createOctokit(token) {
  return new Octokit({ auth: token, request: { fetch: timeoutFetch } });
}

export function getOctokitOrNull() {
  const auth = getGitHubAuth();
  const ghToken = !isGhCliDisabled() ? getGhCliToken() : null;
  const token = isGhCliActive() ? ghToken || auth?.accessToken : auth?.accessToken || ghToken;
  if (!token) {
    return null;
  }
  return createOctokit(token);
}
