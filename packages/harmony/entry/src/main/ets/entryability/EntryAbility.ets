import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { KeyboardAvoidMode } from '@ohos.arkui.UIContext';
import { launchUrlFor } from '../bridge/DeepLinks';
import { ShellHooks } from '../bridge/ShellHooks';

const TAG = 'EntryAbility';
const DOMAIN = 0x0000;

// Index.ets assigns the ShellHooks implementations once its Web component is
// ready. The ability pushes events through them; before the page is up, a
// cold-start deep link waits in AppStorage and Index drains it on onPageEnd.
export default class EntryAbility extends UIAbility {
  private mainWindow: window.Window | null = null;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onCreate');
    const link = launchUrlFor(want?.uri ?? '');
    if (link) {
      AppStorage.setOrCreate('openchamber.pendingLaunchUrl', link);
    }
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onNewWant');
    const link = launchUrlFor(want?.uri ?? '');
    if (!link) return;
    const dispatch = ShellHooks.dispatchLaunchUrl;
    if (dispatch) {
      dispatch(link);
    } else {
      // Page not attached yet (warm process, cold page) — queue for onPageEnd.
      AppStorage.setOrCreate('openchamber.pendingLaunchUrl', link);
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageCreate');
    windowStage.loadContent('pages/Index', (error) => {
      if (error.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(error));
        return;
      }
      this.mainWindow = windowStage.getMainWindowSync();
      this.configureMainWindow();
    });
  }

  private configureMainWindow(): void {
    const win = this.mainWindow;
    if (!win) return;
    // NOT fullscreen: with setWindowLayoutFullScreen(true) the Web starts at
    // y=0 and env(safe-area-inset-top) never populates inside ArkWeb, so the
    // page header draws under the system status bar. The default (avoid-area)
    // layout puts the Web below the status bar — Android-Capacitor behavior.
    try {
      // The chat composer owns the keyboard lift via --oc-keyboard-inset; RESIZE
      // shrinks the ArkWeb viewport so visualViewport math works like on Capacitor.
      win.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'keyboard avoid mode failed: %{public}s', String(error));
    }
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, 'onForeground');
    this.emitShellEvent('appstate', '{"isActive":true}');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'onBackground');
    this.emitShellEvent('appstate', '{"isActive":false}');
  }

  private emitShellEvent(name: string, detailJson: string): void {
    try {
      ShellHooks.emitShellEvent?.(name, detailJson);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'shell event %{public}s dispatch failed: %{public}s', name, String(error));
    }
  }

  onBackPress(): boolean {
    // Let the web app own back navigation (connect screen, drawers, QR scan).
    // The page resolves this synchronously from controller.accessBackward();
    // false falls back to the default exit behavior.
    try {
      return ShellHooks.handleBackPress?.() === true;
    } catch {
      return false;
    }
  }
}
