import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const resolveCredentialsPath = (dataDir) => path.join(
  dataDir
    ? path.resolve(dataDir)
    : process.env.OPENCHAMBER_DATA_DIR
      ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
      : path.join(os.homedir(), '.config', 'openchamber'),
  'quota',
  'opencode-go.json',
);

export const normalizeOpenCodeGoCredential = (value) => {
  const workspaceId = typeof value?.workspaceId === 'string' ? value.workspaceId.trim() : '';
  let authCookie = typeof value?.authCookie === 'string' ? value.authCookie.trim() : '';
  if (authCookie.startsWith('auth=')) authCookie = authCookie.slice(5).trim();
  if (!workspaceId || !authCookie || /[\r\n]/.test(workspaceId) || /[\r\n]/.test(authCookie)) {
    return null;
  }
  return { workspaceId, authCookie };
};

export const createOpenCodeGoCredentialStore = ({ dataDir } = {}) => {
  const credentialsPath = () => resolveCredentialsPath(dataDir);

  const read = () => {
    try {
      return normalizeOpenCodeGoCredential(JSON.parse(fs.readFileSync(credentialsPath(), 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('Failed to read OpenCode Go credentials');
      return null;
    }
  };

  const getStatus = () => {
    const credential = read();
    return credential
      ? { configured: true, workspaceId: credential.workspaceId, secretMasked: '********' }
      : { configured: false };
  };

  const write = (value) => {
    const credential = normalizeOpenCodeGoCredential(value);
    if (!credential) throw new Error('Workspace ID and auth cookie are required');

    const target = credentialsPath();
    const directory = path.dirname(target);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(credential, null, 2)}\n`, { mode: 0o600 });
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {
      }
    }
    return getStatus();
  };

  const remove = () => {
    try {
      fs.unlinkSync(credentialsPath());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };

  return Object.freeze({ read, getStatus, write, remove });
};

export const openCodeGoCredentialStore = createOpenCodeGoCredentialStore();

export const readOpenCodeGoCredential = () => openCodeGoCredentialStore.read();
export const getOpenCodeGoCredentialStatus = () => openCodeGoCredentialStore.getStatus();
export const writeOpenCodeGoCredential = (value) => openCodeGoCredentialStore.write(value);
export const deleteOpenCodeGoCredential = () => openCodeGoCredentialStore.remove();
export const deleteLegacyOpenCodeGoCredential = deleteOpenCodeGoCredential;
