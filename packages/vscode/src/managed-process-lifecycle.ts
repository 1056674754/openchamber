export type ManagedProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  intentional: boolean;
};

type ManagedReadable = {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
  off(event: 'data', listener: (chunk: unknown) => void): unknown;
};

type ManagedChildProcess = {
  stdout?: ManagedReadable | null;
  stderr?: ManagedReadable | null;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
};

export function observeManagedProcess(child: ManagedChildProcess): {
  exited: Promise<ManagedProcessExit>;
  close: () => void;
} {
  let closeRequested = false;
  const drainOutput = () => {};
  child.stdout?.on('data', drainOutput);
  child.stderr?.on('data', drainOutput);

  const exited = new Promise<ManagedProcessExit>((resolve) => {
    child.once('exit', (code, signal) => {
      child.stdout?.off('data', drainOutput);
      child.stderr?.off('data', drainOutput);
      resolve({ code, signal, intentional: closeRequested });
    });
  });

  return {
    exited,
    close: () => {
      if (closeRequested) return;
      closeRequested = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // The process may already be gone.
      }
    },
  };
}