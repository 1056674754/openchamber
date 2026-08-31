import * as vscode from 'vscode';
import { execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const SSH_AUTH_PREFIX = 'ssh-remote+';
const LABEL_PATTERN = /^[A-Za-z0-9._-]+$/;

export type RemoteNamespaceSession = {
  label: string;
  namespaceRoot: string;
  directory: string;
};

export type NamespaceMapping = {
  label: string;
  nsPath: string;
};

export const namespaceRoots = (): string[] => [
  '/remote',
  path.join(os.homedir(), '.openchamber', 'remote'),
];

export const remoteLabelForUri = (uri: vscode.Uri): string | null => {
  if (uri.scheme !== 'vscode-remote') return null;
  if (!uri.authority.startsWith(SSH_AUTH_PREFIX)) return null;
  const label = uri.authority.slice(SSH_AUTH_PREFIX.length);
  return LABEL_PATTERN.test(label) ? label : null;
};

export const namespacePathForUri = (uri: vscode.Uri): NamespaceMapping | null => {
  const label = remoteLabelForUri(uri);
  if (!label) return null;
  const remotePath = uri.path.replace(/\/+$/, '') || '/';
  return { label, nsPath: `${namespaceRoots()[1]}/${label}${remotePath === '/' ? '' : remotePath}` };
};

export const remoteSessionForWorkspace = (): RemoteNamespaceSession | null => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return null;
  const mapped = namespacePathForUri(folder.uri);
  if (!mapped) return null;
  return { label: mapped.label, namespaceRoot: `${namespaceRoots()[1]}/${mapped.label}`, directory: mapped.nsPath };
};

export const isUnsupportedRemoteWorkspace = (): boolean => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'vscode-remote') return false;
  return remoteLabelForUri(folder.uri) === null;
};

let managedConfigDir: string | null = null;

export const initRemoteConfigDir = async (context: vscode.ExtensionContext): Promise<string> => {
  const target = path.join(context.globalStorageUri.fsPath, 'remote-opencode-config');
  const pluginDir = path.join(target, 'plugin');
  await fs.mkdir(pluginDir, { recursive: true });
  const sourceRoot = path.join(context.extensionPath, 'remote-config');
  await fs.copyFile(path.join(sourceRoot, 'opencode.json'), path.join(target, 'opencode.json'));
  await fs.copyFile(
    path.join(sourceRoot, 'plugin', 'remote-namespace.ts'),
    path.join(pluginDir, 'remote-namespace.ts'),
  );
  managedConfigDir = target;
  return target;
};

export const getRemoteConfigDir = (): string | null => managedConfigDir;

const exec = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

const isNamespaceMounted = async (session: RemoteNamespaceSession): Promise<boolean> => {
  const mounts = await exec('mount', []);
  return mounts.split('\n').some((line) => line.includes(` on ${session.namespaceRoot} (`));
};

type SshResolved = { hostname: string; user?: string; port?: number; identityFile?: string };

const resolveSshTarget = async (label: string): Promise<SshResolved> => {
  const dump = await exec('ssh', ['-G', label]);
  const lines = dump.split('\n');
  const pick = (key: string) =>
    lines.find((line) => line.startsWith(`${key} `))?.slice(key.length + 1).trim();
  const hostname = pick('hostname');
  if (!hostname) throw new Error(`Could not resolve SSH host for "${label}" (ssh -G returned no hostname)`);
  const portRaw = pick('port');
  const parsedPort = portRaw ? Number.parseInt(portRaw, 10) : Number.NaN;
  const identity = pick('identityfile');
  return {
    hostname,
    user: pick('user') || undefined,
    port: Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort !== 22 ? parsedPort : undefined,
    identityFile: identity && identity !== 'none' && !identity.startsWith('~') ? identity : undefined,
  };
};

const fuseAvailable = async (): Promise<boolean> => {
  for (const fsRoot of ['/Library/Filesystems/FUSE-T.fs', '/Library/Filesystems/macfuse.fs']) {
    try {
      await fs.access(fsRoot);
      return true;
    } catch {
      // try next
    }
  }
  return false;
};

const rcloneAvailable = async (): Promise<boolean> => {
  try {
    await exec('rclone', ['version']);
    return true;
  } catch {
    return false;
  }
};

export const ensureNamespaceMounted = async (session: RemoteNamespaceSession): Promise<void> => {
  if (await isNamespaceMounted(session)) return;

  if (!(await fuseAvailable())) {
    throw new Error(
      'OpenChamber remote namespace needs FUSE on this Mac. Install once:\n' +
        '  brew install --cask fuse-t\n' +
        'then approve it in System Settings and reload this window.',
    );
  }
  if (!(await rcloneAvailable())) {
    throw new Error(
      'OpenChamber remote namespace needs rclone. Install once:\n' +
        '  brew install rclone\n' +
        'then reload this window.',
    );
  }

  const target = await resolveSshTarget(session.label);
  const parts = [`host=${target.hostname}`];
  if (target.user) parts.push(`user=${target.user}`);
  if (target.port) parts.push(`port=${target.port}`);
  if (target.identityFile) parts.push(`key_file=${target.identityFile}`);
  const remoteSpec = `:sftp,${parts.join(',')}:`;

  await fs.mkdir(session.namespaceRoot, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('rclone', [
      'mount',
      remoteSpec,
      session.namespaceRoot,
      '--daemon',
      '--vfs-cache-mode',
      'writes',
      '--dir-cache-time',
      '10s',
      '--sftp-idle-timeout',
      '0',
    ]);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`rclone mount exited with code ${code} (remote: ${remoteSpec})`));
    });
  });

  for (let attempt = 0; attempt < 20; attempt++) {
    if (await isNamespaceMounted(session)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`rclone mount for ${session.namespaceRoot} did not come up (check: rclone ls "${remoteSpec}")`);
};
