const BACKGROUND_NETWORK_CONCURRENCY = 3;

let activeTasks = 0;
const waiters: Array<() => void> = [];

const acquire = (): Promise<void> => {
  if (activeTasks < BACKGROUND_NETWORK_CONCURRENCY) {
    activeTasks += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
};

const release = (): void => {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  activeTasks = Math.max(0, activeTasks - 1);
};

export const runBackgroundNetworkTask = async <T>(task: () => Promise<T>): Promise<T> => {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
};

export const getBackgroundNetworkState = () => ({
  active: activeTasks,
  waiting: waiters.length,
  limit: BACKGROUND_NETWORK_CONCURRENCY,
});
