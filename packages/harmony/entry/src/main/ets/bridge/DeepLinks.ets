import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'DeepLinks';

// Normalize an incoming deep link to the URL vocabulary the web side expects
// (openchamber://connect?... — parsed by packages/ui/src/apps/deepLinks.ts).
// ArkUI viewData skills deliver want.uri verbatim; anything that is not an
// openchamber:// link is dropped (the shell never hosts web URLs itself).
export function launchUrlFor(raw: string | null | undefined): string {
  if (!raw) return '';
  const value = raw.trim();
  if (!value.toLowerCase().startsWith('openchamber://')) {
    hilog.info(0x0000, TAG, 'ignoring non-openchamber launch uri');
    return '';
  }
  return value;
}
