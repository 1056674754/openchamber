import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import React from 'react';

import { isCapacitorApp } from '@/lib/platform';
import {
  applyCapacitorRootClass,
  setKeyboardInsetCssVar,
} from '@/hooks/nativeMobileChrome';

/**
 * Capacitor-only chrome: StatusBar overlay + Keyboard inset CSS var.
 * Sole owner of `--oc-keyboard-inset` / `oc-keyboard-open` on Capacitor
 * (visualViewport is a fallback when the Keyboard plugin never fires).
 */
export function useNativeMobileChrome(): void {
  React.useEffect(() => {
    if (typeof document === 'undefined' || !isCapacitorApp()) {
      return;
    }

    const root = document.documentElement;
    applyCapacitorRootClass(root, true);
    setKeyboardInsetCssVar(root, 0);

    let disposed = false;
    let pluginOwnsInset = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const clearBodyResizeArtifacts = () => {
      // Capacitor Keyboard.resize=body may leave inline heights after hide.
      const body = document.body;
      if (!body) return;
      if (body.style.height) body.style.height = '';
      if (body.style.minHeight) body.style.minHeight = '';
      if (body.style.maxHeight) body.style.maxHeight = '';
    };

    const onShow = (info: { keyboardHeight?: number }) => {
      pluginOwnsInset = true;
      setKeyboardInsetCssVar(root, info.keyboardHeight ?? 0);
      root.classList.add('oc-keyboard-open');
    };
    const onHide = () => {
      pluginOwnsInset = false;
      setKeyboardInsetCssVar(root, 0);
      root.classList.remove('oc-keyboard-open');
      clearBodyResizeArtifacts();
    };

    const onVisualViewport = () => {
      if (pluginOwnsInset || disposed) return;
      const vv = window.visualViewport;
      if (!vv) return;
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (keyboardHeight > 0) {
        setKeyboardInsetCssVar(root, keyboardHeight);
        root.classList.add('oc-keyboard-open');
      } else {
        setKeyboardInsetCssVar(root, 0);
        root.classList.remove('oc-keyboard-open');
        clearBodyResizeArtifacts();
      }
    };

    const boot = async () => {
      try {
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: Style.Default });
      } catch {
        // Plugin may be unavailable in some WebView shells; CSS env() still applies.
      }

      if (disposed) return;

      try {
        // Disable scroll-assist — it fought fixed composer positioning and
        // left the flex chat column at height 0 after IME dismiss.
        await Keyboard.setScroll({ isDisabled: true });
      } catch {
        // Older plugin builds may omit setScroll.
      }

      try {
        handles.push(await Keyboard.addListener('keyboardWillShow', onShow));
        handles.push(await Keyboard.addListener('keyboardDidShow', onShow));
        handles.push(await Keyboard.addListener('keyboardWillHide', onHide));
        handles.push(await Keyboard.addListener('keyboardDidHide', onHide));
      } catch {
        // Keyboard plugin unavailable — visualViewport fallback below.
      }

      if (disposed) return;
      window.visualViewport?.addEventListener('resize', onVisualViewport);
      window.visualViewport?.addEventListener('scroll', onVisualViewport);
    };

    void boot();

    return () => {
      disposed = true;
      applyCapacitorRootClass(root, false);
      setKeyboardInsetCssVar(root, 0);
      root.classList.remove('oc-keyboard-open');
      window.visualViewport?.removeEventListener('resize', onVisualViewport);
      window.visualViewport?.removeEventListener('scroll', onVisualViewport);
      for (const handle of handles) {
        void handle.remove();
      }
    };
  }, []);
}
