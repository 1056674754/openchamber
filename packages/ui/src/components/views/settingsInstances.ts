import {
  resolveInstanceLabel,
  type DesktopSshInstance,
  type DesktopSshInstanceStatus,
  type DesktopSshPhase,
} from '@/lib/desktopSsh';
import {
  resolveRemoteLabel,
  type RemoteInstance,
  type RemoteInstancePhase,
  type RemoteInstanceStatus,
} from '@/lib/remote-instances/types';
import type { InstanceDescriptor } from '@/stores/useInstanceContextStore';

export type SettingsInstancePhase = DesktopSshPhase | RemoteInstancePhase;

interface SettingsInstanceSources {
  desktopInvokeAvailable: boolean;
  sshInstances: DesktopSshInstance[];
  webInstances: RemoteInstance[];
}

export function buildSettingsInstanceDescriptors({
  desktopInvokeAvailable,
  sshInstances,
  webInstances,
}: SettingsInstanceSources): InstanceDescriptor[] {
  if (desktopInvokeAvailable) {
    return sshInstances.map((instance) => ({
      id: instance.id,
      type: 'remote',
      transport: 'ssh',
      label: resolveInstanceLabel(instance),
      directory: '',
      sshCommand: instance.sshCommand,
      instanceLabel: resolveInstanceLabel(instance),
    }));
  }

  return webInstances.map((instance) => ({
    id: instance.id,
    type: 'remote',
    transport: instance.source === 'ssh' ? 'ssh' : 'url',
    label: resolveRemoteLabel(instance),
    directory: '',
    instanceLabel: resolveRemoteLabel(instance),
  }));
}

export function resolveSettingsInstancePhase(
  instanceId: string,
  desktopInvokeAvailable: boolean,
  sshStatusesById: Record<string, DesktopSshInstanceStatus>,
  webStatusesById: Record<string, RemoteInstanceStatus>,
): SettingsInstancePhase | undefined {
  return desktopInvokeAvailable
    ? sshStatusesById[instanceId]?.phase
    : webStatusesById[instanceId]?.phase;
}
