import { createContext } from 'react';

type OverlayScrollbarVisibility = {
  alwaysVisible: boolean;
  suppressVisibility: boolean;
  visible: boolean;
};

export const OverlayScrollbarVisibilityContext = createContext(false);

export const resolveOverlayScrollbarOpacity = ({
  alwaysVisible,
  suppressVisibility,
  visible,
}: OverlayScrollbarVisibility): 0 | 1 => (
  !suppressVisibility && (alwaysVisible || visible) ? 1 : 0
);
