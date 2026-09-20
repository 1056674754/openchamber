import React from "react";
import { Icon } from "@/components/icon/Icon";
import { GuestIcon } from '@/components/layout/GuestRailIcon';
import { resolveGuestToolIcon } from '@/lib/guests/icon';
import type { GuestToolRule } from '@/lib/guests/tool-presentation';
import { getRuntimeUrlResolver } from '@/lib/runtime-url';

export const getToolIcon = (toolName: string, presentation?: GuestToolRule | null) => {
    const iconClass = 'h-3.5 w-3.5 flex-shrink-0';
    // An extension rule with an icon wins: a package SVG drawn as a
    // currentColor mask, or a Remixicon the sprite knows. (upstream 5181bcd33)
    const guestIcon = presentation
        ? resolveGuestToolIcon(presentation.guestId, presentation.icon, getRuntimeUrlResolver().authenticatedAsset)
        : null;
    if (guestIcon) {
        return <GuestIcon icon={guestIcon.icon} iconSrc={guestIcon.iconSrc} className={iconClass} />;
    }
    const tool = toolName.toLowerCase();

    if (tool === 'edit' || tool === 'multiedit' || tool === 'apply_patch' || tool === 'str_replace' || tool === 'str_replace_based_edit_tool') {
        return <Icon name="pencil" className={iconClass} />;
    }
    if (tool === 'write' || tool === 'create' || tool === 'file_write') {
        return <Icon name="file-edit" className={iconClass} />;
    }
    if (tool === 'publish_artifact') {
        return <Icon name="archive-stack" className={iconClass} />;
    }
    if (tool === 'read' || tool === 'view' || tool === 'file_read' || tool === 'cat') {
        return <Icon name="file-text" className={iconClass} />;
    }
    if (tool === 'bash' || tool === 'shell' || tool === 'cmd' || tool === 'terminal') {
        return <Icon name="terminal-box" className={iconClass} />;
    }
    if (tool === 'list' || tool === 'ls' || tool === 'dir' || tool === 'list_files') {
        return <Icon name="folder-6" className={iconClass} />;
    }
    if (tool === 'search' || tool === 'grep' || tool === 'find' || tool === 'ripgrep') {
        return <Icon name="menu-search" className={iconClass} />;
    }
    if (tool === 'glob') {
        return <Icon name="file-search" className={iconClass} />;
    }
    if (tool === 'fetch' || tool === 'curl' || tool === 'wget' || tool === 'webfetch') {
        return <Icon name="global" className={iconClass} />;
    }
    if (
        tool === 'web-search' ||
        tool === 'websearch' ||
        tool === 'search_web' ||
        tool === 'codesearch' ||
        tool === 'google' ||
        tool === 'bing' ||
        tool === 'duckduckgo' ||
        tool === 'perplexity'
    ) {
        return <Icon name="global" className={iconClass} />;
    }
    if (tool === 'todowrite' || tool === 'todoread') {
        return <Icon name="list-check-3" className={iconClass} />;
    }
    if (tool === 'structuredoutput' || tool === 'structured_output') {
        return <Icon name="list-check-2" className={iconClass} />;
    }
    if (tool === 'skill') {
        return <Icon name="book" className={iconClass} />;
    }
    if (tool === 'task') {
        return <Icon name="ai-agent" className={iconClass} />;
    }
    if (tool.includes('memory')) {
        return <Icon name="database-2" className={iconClass} />;
    }
    if (tool.includes('search') || tool.includes('query')) {
        return <Icon name="menu-search" className={iconClass} />;
    }
    if (tool.includes('extract_text')) {
        return <Icon name="file-text" className={iconClass} />;
    }
    if (tool === 'look_at' || tool.includes('analyze_image') || tool.includes('screenshot')) {
        return <Icon name="file-image" className={iconClass} />;
    }
    if (tool === 'question') {
        return <Icon name="survey" className={iconClass} />;
    }
    if (tool === 'plan_enter') {
        return <Icon name="file-list-2" className={iconClass} />;
    }
    if (tool === 'plan_exit') {
        return <Icon name="task" className={iconClass} />;
    }
    if (tool.startsWith('git')) {
        return <Icon name="git-branch" className={iconClass} />;
    }
    return <Icon name="tools" className={iconClass} />;
};
