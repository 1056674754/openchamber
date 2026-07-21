export const createSingleFlight = (start) => {
  let current = null;

  return (...args) => {
    if (current) return current;

    const pending = Promise.resolve().then(() => start(...args));
    current = pending;
    void pending.catch(() => {
      if (current === pending) current = null;
    });
    return pending;
  };
};
