import { create } from 'zustand';

/**
 * InstanceType distinguishes the kind of OpenChamber instance currently active.
 *
 * - 'default': The local machine. Settings nav shows all pages (Appearance,
 *   Chat, OpenCode config, Projects, Remote Instances management).
 * - 'remote':  A remote machine connected via SSH. Settings nav replaces
 *   Projects/Remote Instances with instance-specific pages such as Connection,
 *   Port Forwarding, and Remote Projects.
 */
export type InstanceType = 'default' | 'remote';

/**
 * InstanceDescriptor is the unified representation of an OpenChamber instance,
 * wrapping the OpenCode directory context that drives config loading and
 * session routing.
 *
 * For the default instance, `directory` is the local project path.
 * For remote instances, `directory` is the path on the remote machine used as
 * the OpenCode working directory.
 */
export interface InstanceDescriptor {
  id: string;
  type: InstanceType;
  label: string;
  /** Remote transport, used only for transport-specific presentation. */
  transport?: 'ssh' | 'url';
  /** Working directory used as OpenCode context (local or remote path). */
  directory: string;
  /** remote-only: SSH connection command. */
  sshCommand?: string;
  /** remote-only: user-facing display label for the remote server. */
  instanceLabel?: string;
}

interface InstanceContextState {
  /** All known instances (default + remote). */
  instances: InstanceDescriptor[];

  /** Currently active instance ID. "'default'" when no remote selected. */
  currentInstanceId: string;

  /** Convenience: whether the current instance is remote. */
  isRemote: boolean;

  /** The active instance descriptor (derived). */
  currentInstance: InstanceDescriptor | null;

  /** Rebuild instance list from stores. */
  setInstances: (instances: InstanceDescriptor[]) => void;

  /** Switch active instance by ID. */
  setCurrentInstance: (id: string) => void;

  /** Update a single instance descriptor. */
  upsertInstance: (instance: InstanceDescriptor) => void;

  /** Remove an instance by ID. Falls back to default if current is removed. */
  removeInstance: (id: string) => void;
}

const DEFAULT_INSTANCE: InstanceDescriptor = {
  id: 'default',
  type: 'default',
  label: 'My Mac',
  directory: '',
};

function sameInstanceDescriptor(
  left: InstanceDescriptor | null,
  right: InstanceDescriptor | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.id === right.id
    && left.type === right.type
    && left.label === right.label
    && left.transport === right.transport
    && left.directory === right.directory
    && left.sshCommand === right.sshCommand
    && left.instanceLabel === right.instanceLabel;
}

function sameInstanceList(left: InstanceDescriptor[], right: InstanceDescriptor[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((instance, index) => sameInstanceDescriptor(instance, right[index] ?? null));
}

function ensureDefaultInstance(instances: InstanceDescriptor[]): InstanceDescriptor[] {
  if (instances.some((instance) => instance.id === DEFAULT_INSTANCE.id)) {
    return instances;
  }
  return [DEFAULT_INSTANCE, ...instances];
}

export const useInstanceContextStore = create<InstanceContextState>((set, get) => ({
  instances: [DEFAULT_INSTANCE],
  currentInstanceId: 'default',
  isRemote: false,
  currentInstance: DEFAULT_INSTANCE,

  refreshInstances: () => {
    // Will be called by consumers after stores load.
    // For now, ensure default is always present.
    const existing = get().instances;
    const hasDefault = existing.some((i) => i.id === 'default');
    if (!hasDefault) {
      set({ instances: [DEFAULT_INSTANCE, ...existing] });
    }
  },

  setInstances: (instances) => {
    const list = ensureDefaultInstance(instances);
    const state = get();
    const defaultInstance = list.find((instance) => instance.id === DEFAULT_INSTANCE.id) ?? DEFAULT_INSTANCE;
    const nextCurrentInstance = list.find((instance) => instance.id === state.currentInstanceId) ?? defaultInstance;
    const instancesChanged = !sameInstanceList(state.instances, list);
    const currentChanged = state.currentInstanceId !== nextCurrentInstance.id
      || state.isRemote !== (nextCurrentInstance.type === 'remote')
      || !sameInstanceDescriptor(state.currentInstance, nextCurrentInstance);

    if (!instancesChanged && !currentChanged) {
      return;
    }

    set({
      instances: instancesChanged ? list : state.instances,
      currentInstanceId: nextCurrentInstance.id,
      isRemote: nextCurrentInstance.type === 'remote',
      currentInstance: nextCurrentInstance,
    });
  },

  setCurrentInstance: (id: string) => {
    const instance = get().instances.find((i) => i.id === id) ?? DEFAULT_INSTANCE;
    set({
      currentInstanceId: instance.id,
      isRemote: instance.type === 'remote',
      currentInstance: instance,
    });
  },

  upsertInstance: (instance: InstanceDescriptor) => {
    const existing = get().instances;
    const idx = existing.findIndex((i) => i.id === instance.id);
    let next: InstanceDescriptor[];
    if (idx >= 0) {
      next = [...existing];
      next[idx] = instance;
    } else {
      next = [...existing, instance];
    }
    set({ instances: next });
    // If this is the current instance, update currentInstance too.
    if (get().currentInstanceId === instance.id) {
      set({
        isRemote: instance.type === 'remote',
        currentInstance: instance,
      });
    }
  },

  removeInstance: (id: string) => {
    if (id === 'default') return; // Never remove default.
    const next = get().instances.filter((i) => i.id !== id);
    const isCurrent = get().currentInstanceId === id;
    set({
      instances: next,
      ...(isCurrent
        ? {
            currentInstanceId: 'default',
            isRemote: false,
            currentInstance: DEFAULT_INSTANCE,
          }
        : {}),
    });
  },
}));
