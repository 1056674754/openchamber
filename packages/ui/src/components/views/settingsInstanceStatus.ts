import { phaseDotClass, type DesktopSshPhase } from '@/lib/desktopSsh';
import type { InstanceDescriptor } from '@/stores/useInstanceContextStore';

export function settingsInstanceStatusDotClass(
  instance: Pick<InstanceDescriptor, 'type'>,
  phase?: DesktopSshPhase,
): string {
  if (instance.type === 'default') {
    return 'bg-[var(--status-success)]';
  }
  return phaseDotClass(phase);
}
