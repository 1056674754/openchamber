import { Icon } from '@/components/icon/Icon';
import type { PermissionRequest } from '@/types/permission';

const getToolIcon = (toolName: string) => {
  const iconClass = "h-3 w-3";
  const tool = toolName.toLowerCase();

  if (tool === 'edit' || tool === 'multiedit' || tool === 'str_replace' || tool === 'str_replace_based_edit_tool') {
    return <Icon name="pencil-ai" className={iconClass} />;
  }

  if (tool === 'write' || tool === 'create' || tool === 'file_write') {
    return <Icon name="file-edit" className={iconClass} />;
  }

  if (tool === 'bash' || tool === 'shell' || tool === 'cmd' || tool === 'terminal' || tool === 'shell_command') {
    return <Icon name="terminal-box" className={iconClass} />;
  }

  if (tool === 'webfetch' || tool === 'fetch' || tool === 'curl' || tool === 'wget') {
    return <Icon name="global" className={iconClass} />;
  }

  return <Icon name="tools" className={iconClass} />;
};

export const getToolDisplayName = (toolName: string): string => {
  const tool = toolName.toLowerCase();

  if (tool === 'edit' || tool === 'multiedit' || tool === 'str_replace' || tool === 'str_replace_based_edit_tool') {
    return 'edit';
  }
  if (tool === 'write' || tool === 'create' || tool === 'file_write') {
    return 'write';
  }
  if (tool === 'bash' || tool === 'shell' || tool === 'cmd' || tool === 'terminal' || tool === 'shell_command') {
    return 'bash';
  }
  if (tool === 'webfetch' || tool === 'fetch' || tool === 'curl' || tool === 'wget') {
    return 'webfetch';
  }

  return toolName;
};

/** Icon and short name of the capability a request asks for, for headers. */
export const getPermissionToolPresentation = (permission: PermissionRequest) => {
  const toolName = permission.permission || 'unknown';
  return { icon: getToolIcon(toolName), name: getToolDisplayName(toolName) };
};
