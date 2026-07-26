import React from 'react';

type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const getMobileInstancesSheetOpen = (): boolean => open;

export const setMobileInstancesSheetOpen = (next: boolean): void => {
  if (open === next) return;
  open = next;
  notify();
};

export const openMobileInstancesSheet = (): void => {
  setMobileInstancesSheetOpen(true);
};

export const closeMobileInstancesSheet = (): void => {
  setMobileInstancesSheetOpen(false);
};

export const subscribeMobileInstancesSheet = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useMobileInstancesSheetOpen = (): boolean => {
  const [value, setValue] = React.useState(getMobileInstancesSheetOpen);
  React.useEffect(() => subscribeMobileInstancesSheet(() => {
    setValue(getMobileInstancesSheetOpen());
  }), []);
  return value;
};
