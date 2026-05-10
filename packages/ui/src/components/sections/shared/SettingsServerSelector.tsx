import React, { useMemo } from 'react';
import { RiServerLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { useActiveServerId } from '@/hooks/useActiveServerId';
import { useUIStore } from '@/stores/useUIStore';

interface SettingsServerSelectorProps {
  className?: string;
}

export const SettingsServerSelector: React.FC<SettingsServerSelectorProps> = React.memo(function SettingsServerSelector({ className }) {
  const activeServerId = useActiveServerId();
  const selectedServerId = useUIStore((s) => s.settingsSelectedServerId);
  const setSelectedServerId = useUIStore((s) => s.setSettingsSelectedServerId);

  const effectiveServerId = selectedServerId ?? activeServerId;
  const connections = useMemo(() => serverRegistry.getAll(), []);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setSelectedServerId(value || null);
    },
    [setSelectedServerId],
  );

  if (connections.length <= 1) {
    return null;
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <RiServerLine className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <select
        value={effectiveServerId}
        onChange={handleChange}
        className="h-6 min-w-0 max-w-[180px] rounded border border-[var(--interactive-border)] bg-[var(--surface-raised)] px-1.5 typography-micro text-foreground truncate focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
      >
        {connections.map((conn) => (
          <option key={conn.config.id} value={conn.config.id}>
            {conn.config.label || conn.config.id}
          </option>
        ))}
      </select>
    </div>
  );
});
