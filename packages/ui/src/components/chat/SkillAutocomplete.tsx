import React from 'react';
import { cn, fuzzyMatch } from '@/lib/utils';
import { useSkillsStore } from '@/stores/useSkillsStore';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { Icon } from '@/components/icon/Icon';

interface SkillInfo {
  name: string;
  scope: string;
  source?: string;
  description?: string;
}

export interface SkillAutocompleteHandle {
  handleKeyDown: (key: string) => void;
}

interface SkillAutocompleteProps {
  searchQuery: string;
  onSkillSelect: (skillName: string) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

const SKILL_BADGE_CLASS = 'text-[10px] leading-none uppercase font-bold tracking-tight px-1.5 py-1 rounded border flex-shrink-0';

export const SkillAutocomplete = React.forwardRef<SkillAutocompleteHandle, SkillAutocompleteProps>(({
  searchQuery,
  onSkillSelect,
  onClose,
  style,
}, ref) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const selectedIndexRef = React.useRef(0);
  const keyboardNavigationRef = React.useRef(false);
  const [filteredSkills, setFilteredSkills] = React.useState<SkillInfo[]>([]);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const skills = useSkillsStore((s) => s.skills);
  const loadSkills = useSkillsStore((s) => s.loadSkills);

  React.useEffect(() => {
    // Always trigger loadSkills when autocomplete opens to ensure project context is fresh
    void loadSkills();
  }, [loadSkills]);

  React.useEffect(() => {
    const normalizedQuery = searchQuery.trim();
    const matches = normalizedQuery.length
      ? skills.filter((skill) => fuzzyMatch(skill.name, normalizedQuery))
      : skills;

    const sorted = [...matches].sort((a, b) => {
      // Sort by project scope first, then name
      if (a.scope === 'project' && b.scope !== 'project') return -1;
      if (a.scope !== 'project' && b.scope === 'project') return 1;
      return a.name.localeCompare(b.name);
    });

    setFilteredSkills(sorted);
    setSelectedIndex(0);
  }, [skills, searchQuery]);

  React.useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  React.useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedIndex]);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !containerRef.current) {
        return;
      }
      if (!containerRef.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  React.useImperativeHandle(ref, () => ({
    handleKeyDown: (key: string) => {
      if (key === 'Escape') {
        onClose();
        return;
      }

      if (!filteredSkills.length) {
        return;
      }

      if (key === 'ArrowDown') {
        keyboardNavigationRef.current = true;
        setSelectedIndex((prev) => (prev + 1) % filteredSkills.length);
        return;
      }

      if (key === 'ArrowUp') {
        keyboardNavigationRef.current = true;
        setSelectedIndex((prev) => (prev - 1 + filteredSkills.length) % filteredSkills.length);
        return;
      }

      if (key === 'Enter' || key === 'Tab') {
        const safeIndex = ((selectedIndexRef.current % filteredSkills.length) + filteredSkills.length) % filteredSkills.length;
        const skill = filteredSkills[safeIndex];
        if (skill) {
          onSkillSelect(skill.name);
        }
      }
    },
  }), [filteredSkills, onSkillSelect, onClose]);

  const renderSkill = (skill: SkillInfo, index: number) => {
    const isProject = skill.scope === 'project';
    const source = skill.source || 'opencode';
    return (
      <div
        key={`${skill.name}-${skill.scope}`}
        ref={(el) => {
          itemRefs.current[index] = el;
        }}
        role="option"
        aria-selected={index === selectedIndex}
        className={cn(
          'flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5',
          index === selectedIndex && 'bg-interactive-selection'
        )}
        onClick={() => onSkillSelect(skill.name)}
        onMouseMove={() => {
          keyboardNavigationRef.current = false;
          setSelectedIndex(index);
        }}
      >
        <Icon name="stack" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="typography-meta min-w-0 shrink-0 truncate font-medium text-foreground">
            {skill.name}
          </span>
          <span className="typography-meta min-w-0 truncate text-muted-foreground">
            {skill.description || 'Skill'}
          </span>
          <span className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
            <span className={cn(
              SKILL_BADGE_CLASS,
              isProject
                ? 'bg-[var(--status-info-background)] text-[var(--status-info)] border-[var(--status-info-border)]'
                : 'bg-[var(--status-success-background)] text-[var(--status-success)] border-[var(--status-success-border)]'
            )}>
              {skill.scope}
            </span>
            <span className="text-[10px] leading-none uppercase font-bold tracking-tight px-1.5 py-1 rounded border flex-shrink-0 bg-[var(--surface-muted)] text-muted-foreground border-[var(--interactive-border)]/60">
              {source}
            </span>
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="absolute z-[100] min-w-0 w-full max-w-none max-h-[min(420px,calc(100dvh-12rem))] bg-background border-2 border-border/60 rounded-xl shadow-none bottom-full mb-2 left-0 flex flex-col"
      style={style}
    >
      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="px-0 pb-1.5" fillContainer={false}>
        {filteredSkills.length ? (
          <div role="listbox" aria-label="Skills">
            {filteredSkills.map((skill, index) => renderSkill(skill, index))}
          </div>
        ) : (
          <div className="px-3 py-2 typography-ui-label text-muted-foreground">
            No skills found
          </div>
        )}
      </ScrollableOverlay>
      <div className="px-3 pt-1 pb-1.5 border-t typography-meta text-muted-foreground">
        ↑↓ navigate • Enter select • Esc close
      </div>
    </div>
  );
});

SkillAutocomplete.displayName = 'SkillAutocomplete';
