import { phaseDotClass, type DesktopSshPhase } from '@/lib/desktopSsh';
import type { RemoteInstancePhase } from '@/lib/remote-instances/types';
import type { InstanceDescriptor } from '@/stores/useInstanceContextStore';

export function settingsInstanceStatusDotClass(
  instance: Pick<InstanceDescriptor, 'type'>,
  phase?: DesktopSshPhase | RemoteInstancePhase,
): string {
  if (instance.type === 'default') {
    return 'bg-[var(--status-success)]';
  }
  if (phase === 'connected') {
    return 'bg-[var(--status-success)] animate-pulse';
  }
  if (phase === 'connecting') {
    return 'bg-[var(--status-warning)] animate-pulse';
  }
  if (phase === 'disconnected') {
    return 'bg-muted-foreground/40';
  }
  return phaseDotClass(phase as DesktopSshPhase | undefined);
}
