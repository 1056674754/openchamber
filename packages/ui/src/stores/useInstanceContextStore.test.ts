import { beforeEach, describe, expect, test } from 'bun:test';

import { useInstanceContextStore, type InstanceDescriptor } from './useInstanceContextStore';

const remoteInstance = (overrides: Partial<InstanceDescriptor> = {}): InstanceDescriptor => ({
  id: 'remote-1',
  type: 'remote',
  label: 'Remote One',
  directory: '',
  sshCommand: 'ssh remote-one',
  instanceLabel: 'Remote One',
  ...overrides,
});

describe('useInstanceContextStore', () => {
  beforeEach(() => {
    useInstanceContextStore.setState({
      instances: [
        {
          id: 'default',
          type: 'default',
          label: 'My Mac',
          directory: '',
        },
      ],
      currentInstanceId: 'default',
      isRemote: false,
      currentInstance: {
        id: 'default',
        type: 'default',
        label: 'My Mac',
        directory: '',
      },
    });
  });

  test('does not notify subscribers when setInstances receives matching descriptors', () => {
    const instance = remoteInstance();

    useInstanceContextStore.getState().setInstances([instance]);

    let notifications = 0;
    const unsubscribe = useInstanceContextStore.subscribe(() => {
      notifications += 1;
    });

    useInstanceContextStore.getState().setInstances([remoteInstance()]);
    unsubscribe();

    expect(notifications).toBe(0);
  });

  test('updates currentInstance when the selected descriptor changes', () => {
    const instance = remoteInstance();
    useInstanceContextStore.getState().setInstances([instance]);
    useInstanceContextStore.getState().setCurrentInstance(instance.id);

    useInstanceContextStore.getState().setInstances([remoteInstance({ label: 'Renamed Remote' })]);

    expect(useInstanceContextStore.getState().currentInstance?.label).toBe('Renamed Remote');
  });
});
