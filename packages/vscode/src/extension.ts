import * as vscode from 'vscode';
import { ChatViewProvider, type SelectionAttachmentPayload } from './ChatViewProvider';
import { AgentManagerPanelProvider } from './AgentManagerPanelProvider';
import { SessionEditorPanelProvider } from './SessionEditorPanelProvider';
import { createOpenCodeManager, type OpenCodeManager } from './opencode';
import { startGlobalEventWatcher, stopGlobalEventWatcher, setChatViewProvider } from './sessionActivityWatcher';
import { initRemoteConfigDir, namespacePathForUri } from './remoteNamespace';
import { resolveWorkspaceFolders } from './workspaceResolver';
import { registerOpenChamberChatParticipant } from './chatParticipant';
import { applyConnectAttemptTimeout } from './networkDefaults';
import { stopGitProcesses } from './bridge-git-process-runtime';

let chatViewProvider: ChatViewProvider | undefined;
let agentManagerProvider: AgentManagerPanelProvider | undefined;
let sessionEditorProvider: SessionEditorPanelProvider | undefined;
let openCodeManager: OpenCodeManager | undefined;
let outputChannel: vscode.OutputChannel | undefined;

let activeSessionId: string | null = null;
let activeSessionTitle: string | null = null;

const SETTINGS_KEY = 'openchamber.settings';
const CHAT_VIEW_BOOTSTRAP_DELAY_MS = 80;

const waitForChatViewBootstrap = () => new Promise<void>((resolve) => setTimeout(resolve, CHAT_VIEW_BOOTSTRAP_DELAY_MS));

const buildSelectionTarget = (editor: vscode.TextEditor): SelectionAttachmentPayload | null => {
  if (editor.selection.isEmpty) {
    return null;
  }
  const namespace = namespacePathForUri(editor.document.uri);
  const filePath = namespace ? namespace.nsPath : (editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : null);
  if (!filePath) {
    return null;
  }
  const startLine = editor.selection.start.line + 1;
  const endLine = editor.selection.end.line + 1;
  const lineRange = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
  const baseName = filePath.split(/[\\/]/).pop() ?? filePath;
  return {
    path: filePath,
    fileName: `${baseName}:${lineRange}`,
    startLine,
    endLine,
  };
};

const formatIso = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '(none)';
  try {
    return new Date(value).toISOString();
  } catch {
    return String(value);
  }
};

const formatDurationMs = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '(none)';
  const seconds = Math.round(value / 100) / 10;
  return `${seconds}s`;
};

export async function activate(context: vscode.ExtensionContext) {
  applyConnectAttemptTimeout();
  outputChannel = vscode.window.createOutputChannel('OpenChamber');

  try {
    await initRemoteConfigDir(context);
  } catch (error) {
    outputChannel?.appendLine(`[OpenChamber] Failed to stage remote namespace config: ${error instanceof Error ? error.message : String(error)}`);
  }

  let moveToRightSidebarScheduled = false;

  const isCursorLikeHost = () => /\bcursor\b/i.test(vscode.env.appName);

  const findMoveToRightSidebarCommandId = async (): Promise<string | null> => {
    const commands = await vscode.commands.getCommands(true);

    const preferred = [
      // Newer VS Code naming
      'workbench.action.moveViewToSecondarySideBar',
      'workbench.action.moveViewToSecondarySidebar',
      'workbench.action.moveFocusedViewToSecondarySideBar',
      'workbench.action.moveFocusedViewToSecondarySidebar',

      // Some builds use "Auxiliary Bar" naming
      'workbench.action.moveViewToAuxiliaryBar',
      'workbench.action.moveFocusedViewToAuxiliaryBar',
    ];

    for (const commandId of preferred) {
      if (commands.includes(commandId)) return commandId;
    }

    const fuzzy = commands.find((commandId) => {
      const id = commandId.toLowerCase();
      const looksLikeMoveView = id.includes('workbench.action') && id.includes('move') && id.includes('view');
      if (!looksLikeMoveView) return false;

      // Support both "secondary sidebar" and "auxiliary bar" naming.
      return (id.includes('secondary') && id.includes('side') && id.includes('bar')) || (id.includes('auxiliary') && id.includes('bar'));
    });

    return fuzzy || null;
  };

  const attemptMoveChatToRightSidebar = async (): Promise<'moved' | 'unsupported' | 'failed'> => {
    const moveCommandId = await findMoveToRightSidebarCommandId();
    if (!moveCommandId) return 'unsupported';

    try {
      await vscode.commands.executeCommand('openchamber.chatView.focus');
      await vscode.commands.executeCommand(moveCommandId);
      return 'moved';
    } catch (error) {
      outputChannel?.appendLine(
        `[OpenChamber] Failed moving chat view to right sidebar (command=${moveCommandId}): ${error instanceof Error ? error.message : String(error)}`
      );
      return 'failed';
    }
  };

  const maybeMoveChatToRightSidebarOnStartup = async () => {
    if (isCursorLikeHost()) return;

    const attempted = context.globalState.get<boolean>('openchamber.sidebarAutoMoveAttempted') || false;
    if (attempted) return;
    await context.globalState.update('openchamber.sidebarAutoMoveAttempted', true);

    if (moveToRightSidebarScheduled) return;
    moveToRightSidebarScheduled = true;

    // Defer until after activation to avoid stealing focus during startup.
    setTimeout(() => {
      void (async () => {
        try {
          await attemptMoveChatToRightSidebar();
        } finally {
          moveToRightSidebarScheduled = false;
        }
      })();
    }, 800);
  };


  // Migration: clear legacy auto-set API URLs (ports 47680-47689 were auto-assigned by older extension versions)
  const config = vscode.workspace.getConfiguration('openchamber');
  const legacyApiUrl = config.get<string>('apiUrl') || '';
  if (/^https?:\/\/localhost:4768\d\/?$/.test(legacyApiUrl.trim())) {
    await config.update('apiUrl', '', vscode.ConfigurationTarget.Global);
  }

  // Create OpenCode manager first
  openCodeManager = createOpenCodeManager(context);

  // Create chat view provider with manager reference
  // The webview will show a loading state until OpenCode is ready
  chatViewProvider = new ChatViewProvider(context, context.extensionUri, openCodeManager);

  // Re-registrable so ChatViewProvider can force a full view teardown when
  // the webview renderer wedges: html reassignment does not recreate a
  // frozen iframe, but disposing the provider registration does (VS Code
  // then re-resolves the visible view against the fresh registration).
  const provider = chatViewProvider;
  const registerChatView = () => vscode.window.registerWebviewViewProvider(
    ChatViewProvider.viewType,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );
  let chatViewRegistration = registerChatView();
  provider.setRecreateView(() => {
    chatViewRegistration.dispose();
    // Re-register on a later tick: disposing and re-registering in the same
    // tick raced VS Code's view-descriptor removal and left the view
    // unresolved (observed live: no resolve after recovery at 23:51:53).
    setTimeout(() => {
      chatViewRegistration = registerChatView();
    }, 250);
  });
  context.subscriptions.push({ dispose: () => chatViewRegistration.dispose() });

  // Native chat participant (@openchamber): routes prompts and integrated-
  // browser element attachments into the active OpenChamber conversation (#200).
  const participantManager = openCodeManager;
  if (participantManager) {
    registerOpenChamberChatParticipant({
      context,
      manager: participantManager,
      getCurrentSessionId: () => chatViewProvider?.getCurrentSessionId() ?? null,
      getWorkingDirectory: () => participantManager.getWorkingDirectory(),
    });
  }

  // Receives element payloads from the patched integrated browser (VS Code
  // binary patch injects this call into _attachElementDataToChat) and drops
  // the element into the OpenChamber composer as markdown context.
  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.nativeElement', (data: {
      outerHTML?: string;
      innerText?: string;
      url?: string;
      ancestors?: Array<{ tag?: string; id?: string; className?: string; selectorPart?: string }>;
      attributes?: Record<string, string>;
      computedStyles?: Record<string, string>;
      dimensions?: { width?: number; height?: number };
    }) => {
      if (!data || typeof data !== 'object') {
        return;
      }
      // Mirror VS Code's own element displayName: ancestors entries are
      // { tagName, id?, classNames?: string[] } with an optional trailing
      // '::pseudo' entry.
      const ancestors = Array.isArray(data.ancestors)
        ? data.ancestors as Array<{ tagName?: unknown; id?: unknown; classNames?: unknown }>
        : [];
      let last = ancestors.length > 0 ? ancestors[ancestors.length - 1] : undefined;
      let pseudo = '';
      if (last && typeof last.tagName === 'string' && last.tagName.startsWith('::') && ancestors.length > 1) {
        pseudo = last.tagName;
        last = ancestors[ancestors.length - 2];
      }
      let elementName = '';
      if (last && typeof last.tagName === 'string') {
        elementName = last.tagName.toLowerCase()
          + (typeof last.id === 'string' && last.id ? `#${last.id}` : '')
          + (Array.isArray(last.classNames) && last.classNames.length > 0
            ? `.${last.classNames.map(String).join('.')}`
            : '')
          + pseudo;
      }
      if (!elementName && typeof data.outerHTML === 'string') {
        const tagMatch = /^\s*<([a-zA-Z][\w-]*)/.exec(data.outerHTML);
        if (tagMatch) elementName = tagMatch[1].toLowerCase();
      }
      elementName = (elementName || 'element').slice(0, 120);
      const parts: string[] = [];
      const path = Array.isArray(data.ancestors)
        ? data.ancestors.map((a) => a?.selectorPart ?? a?.tag ?? '').filter(Boolean).join(' > ')
        : '';
      if (data.url) parts.push(`Page: ${data.url}`);
      if (path) parts.push(`Selector: \`${path}\``);
      if (data.dimensions?.width) {
        parts.push(`Size: ${Math.round(data.dimensions.width)} x ${Math.round(data.dimensions.height ?? 0)}`);
      }
      const attrs = data.attributes ?? {};
      const attrLines = Object.entries(attrs).slice(0, 12).map(([k, v]) => `${k}="${String(v).slice(0, 120)}"`);
      if (attrLines.length > 0) parts.push(`Attributes: ${attrLines.join(' ')}`);
      if (data.computedStyles && Object.keys(data.computedStyles).length > 0) {
        const css = Object.entries(data.computedStyles).map(([k, v]) => `${k}: ${v};`).join(' ');
        parts.push(`CSS:\n\`\`\`css\n${css.slice(0, 2000)}\n\`\`\``);
      }
      if (data.outerHTML) {
        parts.push(`HTML:\n\`\`\`html\n${data.outerHTML.slice(0, 50_000)}\n\`\`\``);
      }
      if (data.innerText) {
        parts.push(`Text: ${data.innerText.slice(0, 2000)}`);
      }
      const md = ['**Element context (integrated browser)**', ...parts].join('\n\n');
      if (chatViewProvider?.hasResolvedView()) {
        chatViewProvider.addNativeElementContext({ fileLabel: elementName, code: md, language: 'markdown' });
      } else {
        vscode.window.showInformationMessage('OpenChamber: open the sidebar to receive element context');
      }
      outputChannel?.appendLine(`[OpenChamber] native element context delivered (${md.length} chars)`);
    })
  );

  // VS Code resolves a language model for EVERY participant request in THIS
  // extension host, and each host's model cache only contains vendors this
  // extension has explicitly queried — an unwarmed cache throws "Language
  // model unavailable" before our handler runs. Warm the known vendors at
  // startup, with delayed retries for providers that register late or load
  // their model lists asynchronously.
  const warmLanguageModelCache = async () => {
    for (const vendor of ['copilot', 'glm', 'codex-for-copilot', 'customendpoint']) {
      try {
        await vscode.lm.selectChatModels({ vendor });
      } catch {
        // Vendor absent in this setup; ignore.
      }
    }
  };
  void warmLanguageModelCache();
  const warmTimers = [10_000, 30_000].map((delay) =>
    setTimeout(() => void warmLanguageModelCache(), delay)
  );
  context.subscriptions.push({ dispose: () => warmTimers.forEach(clearTimeout) });

  // Register sidebar/focus commands AFTER the webview view provider is registered
  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openSidebar', async () => {
      // Best-effort: open the container (if available), then focus the chat view.
      try {
        await vscode.commands.executeCommand('workbench.view.extension.openchamber');
      } catch (e) {
        outputChannel?.appendLine(`[OpenChamber] workbench.view.extension.openchamber failed: ${e}`);
      }

      try {
        await vscode.commands.executeCommand('openchamber.chatView.focus');
      } catch (e) {
        outputChannel?.appendLine(`[OpenChamber] openchamber.chatView.focus failed: ${e}`);
        vscode.window.showErrorMessage(`OpenChamber: Failed to open sidebar - ${e}`);
        return false;
      }

      if (!chatViewProvider?.hasResolvedView()) {
        outputChannel?.appendLine('[OpenChamber] Chat sidebar focus completed before the webview was resolved');
        vscode.window.showWarningMessage('OpenChamber: Chat sidebar is not ready');
        return false;
      }

      return true;
    })
  );

  const revealChatViewForPayload = async () => {
    const opened = await vscode.commands.executeCommand<boolean>('openchamber.openSidebar');
    if (!opened) {
      return false;
    }

    await waitForChatViewBootstrap();
    if (!chatViewProvider?.hasResolvedView()) {
      outputChannel?.appendLine('[OpenChamber] Chat sidebar webview was disposed before payload delivery');
      vscode.window.showWarningMessage('OpenChamber: Chat sidebar is not ready');
      return false;
    }

    return true;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.focusChat', async () => {
      await vscode.commands.executeCommand('openchamber.chatView.focus');
    })
  );

  void maybeMoveChatToRightSidebarOnStartup();

  // Create Agent Manager panel provider
  agentManagerProvider = new AgentManagerPanelProvider(context, context.extensionUri, openCodeManager);
  sessionEditorProvider = new SessionEditorPanelProvider(context, context.extensionUri, openCodeManager);

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.internal.settingsSynced', (settings: unknown) => {
      chatViewProvider?.notifySettingsSynced(settings);
      sessionEditorProvider?.notifySettingsSynced(settings);
      agentManagerProvider?.notifySettingsSynced(settings);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.internal.permissionAutoAcceptSynced', (snapshot: unknown) => {
      chatViewProvider?.notifyPermissionAutoAcceptSynced(snapshot);
      sessionEditorProvider?.notifyPermissionAutoAcceptSynced(snapshot);
      agentManagerProvider?.notifyPermissionAutoAcceptSynced(snapshot);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(() => {
      chatViewProvider?.notifyViewerStateChanged();
      sessionEditorProvider?.notifyViewerStateChanged();
      agentManagerProvider?.notifyViewerStateChanged();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openAgentManager', () => {
      agentManagerProvider?.createOrShow();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.setActiveSession', (sessionId: unknown, title?: unknown) => {
      if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
        activeSessionId = sessionId.trim();
        activeSessionTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : null;
        return;
      }

      activeSessionId = null;
      activeSessionTitle = null;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openActiveSessionInEditor', () => {
      if (!activeSessionId) {
        vscode.window.showInformationMessage('OpenChamber: No active session');
        return;
      }
      sessionEditorProvider?.createOrShow(activeSessionId, activeSessionTitle ?? undefined);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openSessionInEditor', (sessionId: string, title?: string) => {
      if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        return;
      }
      sessionEditorProvider?.createOrShow(sessionId.trim(), title);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openNewSessionInEditor', () => {
      sessionEditorProvider?.createOrShowNewSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.openCurrentOrNewSessionInEditor', () => {
      if (activeSessionId) {
        sessionEditorProvider?.createOrShow(activeSessionId, activeSessionTitle ?? undefined);
      } else {
        sessionEditorProvider?.createOrShowNewSession();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.restartApi', async () => {
      try {
        await openCodeManager?.restart();
        vscode.window.showInformationMessage('OpenChamber: API connection restarted');
      } catch (e) {
        vscode.window.showErrorMessage(`OpenChamber: Failed to restart API - ${e}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.addSelectionToChat', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('OpenChamber [Add Selection]: No active editor');
        return;
      }

      const target = buildSelectionTarget(editor);

      if (target) {
        if (!sessionEditorProvider?.addSelectionToActivePanel(target)) {
          if (!(await revealChatViewForPayload())) {
            return;
          }
          chatViewProvider?.addSelectionAttachment(target);
        }
        return;
      }

      // No selection: attach the whole file instead
      const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/').trim();
      if (!relativePath) {
        vscode.window.showWarningMessage('OpenChamber [Add Selection]: Nothing to attach');
        return;
      }
      const baseName = editor.document.uri.fsPath.replace(/\\/g, '/').split('/').pop() || relativePath;
      const filePayload = [{ filePath: editor.document.uri.fsPath, fileName: baseName, fileSize: null }];
      if (!sessionEditorProvider?.addFileAttachmentsToActivePanel(filePayload)) {
        if (!(await revealChatViewForPayload())) {
          return;
        }
        chatViewProvider?.addFileAttachments(filePayload);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.addToContext', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('OpenChamber [Add to Context]:No active editor');
        return;
      }

      const docName = editor.document.uri.path.split('/').pop() ?? '';
      if (docName.startsWith('.web-lens-ref-')) {
        // Web Lens (collectiveai.web-lens) delivers browser context by writing
        // @-file references to a temp ".web-lens-ref-*" file, selecting all,
        // and invoking this command. The references must land as input text so
        // @-mention parsing attaches the real context files as chips.
        const refs = editor.document.getText(editor.selection).trim();
        if (refs) {
          if (!(await revealChatViewForPayload())) {
            return;
          }
          chatViewProvider?.addTextToInput(refs);
        }
        return;
      }

      const target = buildSelectionTarget(editor);

      if (target) {
        if (!sessionEditorProvider?.addSelectionToActivePanel(target)) {
          if (!(await revealChatViewForPayload())) {
            return;
          }
          chatViewProvider?.addSelectionAttachment(target);
        }
        return;
      }

      if (editor.document.uri.scheme === 'file') {
        const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/').trim();
        if (!relativePath) {
          vscode.window.showWarningMessage('OpenChamber [Add to Context]: No text selected');
          return;
        }
        const baseName = editor.document.uri.fsPath.replace(/\\/g, '/').split('/').pop() || relativePath;
        const filePayload = [{ filePath: editor.document.uri.fsPath, fileName: baseName, fileSize: null }];
        if (!sessionEditorProvider?.addFileAttachmentsToActivePanel(filePayload)) {
          if (!(await revealChatViewForPayload())) {
            return;
          }
          chatViewProvider?.addFileAttachments(filePayload);
        }
        return;
      }

      // Non-file documents (untitled, output, ...): embed the text directly
      const selectedText = editor.document.getText(editor.selection);
      if (!selectedText) {
        vscode.window.showWarningMessage('OpenChamber [Add to Context]: No text selected');
        return;
      }
      if (!(await revealChatViewForPayload())) {
        return;
      }
      const contextText = `${editor.document.languageId}\n\`\`\`\n${selectedText}\n\`\`\``;
      chatViewProvider?.addTextToInput(contextText);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.attachExplorerToChat', async (resource?: vscode.Uri, resources?: vscode.Uri[]) => {
      const uriCandidates: vscode.Uri[] = [];
      if (Array.isArray(resources)) {
        uriCandidates.push(...resources.filter((entry): entry is vscode.Uri => entry instanceof vscode.Uri));
      }
      if (resource instanceof vscode.Uri) {
        uriCandidates.push(resource);
      }
      if (uriCandidates.length === 0) {
        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        if (activeEditorUri) {
          uriCandidates.push(activeEditorUri);
        }
      }

      const uniqueUris = Array.from(new Map(uriCandidates.map((uri) => [uri.toString(), uri])).values());
      const attachedFiles: Array<{ filePath: string; fileName: string; fileSize: number | null }> = [];
      const skippedEntries: string[] = [];

      for (const uri of uniqueUris) {
        const namespace = namespacePathForUri(uri);
        if (uri.scheme !== 'file' && !namespace) {
          skippedEntries.push(uri.toString());
          continue;
        }

        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if ((stat.type & vscode.FileType.Directory) !== 0) {
            skippedEntries.push(vscode.workspace.asRelativePath(uri, false));
            continue;
          }
        } catch {
          skippedEntries.push(vscode.workspace.asRelativePath(uri, false));
          continue;
        }

        const filePath = (namespace ? namespace.nsPath : uri.fsPath).trim();
        const fileName = uri.fsPath.replace(/\\/g, '/').split('/').pop() || vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/').trim();
        if (!filePath || !fileName) {
          skippedEntries.push(uri.fsPath || uri.toString());
          continue;
        }
        let fileSize: number | null = null;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          fileSize = stat.size;
        } catch {
          fileSize = null;
        }
        attachedFiles.push({ filePath, fileName, fileSize });
      }

      if (attachedFiles.length === 0) {
        vscode.window.showWarningMessage('OpenChamber: No file selected to mention');
        return;
      }

      if (!sessionEditorProvider?.addFileAttachmentsToActivePanel(attachedFiles)) {
        if (!(await revealChatViewForPayload())) {
          return;
        }
        chatViewProvider?.addFileAttachments(attachedFiles);
      }

      if (skippedEntries.length > 0) {
        vscode.window.showInformationMessage('OpenChamber: Some selected entries were skipped (folders or unsupported resources)');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.explain', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('OpenChamber [Explain]: No active editor');
        return;
      }

      const target = buildSelectionTarget(editor);
      let prompt: string;

      if (target) {
        prompt = 'Explain the selected code.';
      } else if (editor.selection.isEmpty && editor.document.uri.scheme === 'file') {
        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        prompt = `Explain the following Code / Text:\n\n${filePath}`;
      } else {
        const selectedText = editor.document.getText(editor.selection);
        const languageId = editor.document.languageId;
        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        prompt = `Explain the following Code / Text:\n\n${filePath}\n\`\`\`${languageId}\n${selectedText}\n\`\`\``;
      }

      if (!sessionEditorProvider?.createSessionWithPromptInActivePanel(prompt, target ?? undefined)) {
        if (!(await revealChatViewForPayload())) {
          return;
        }
        chatViewProvider?.createNewSessionWithPrompt(prompt, target ?? undefined);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.improveCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('OpenChamber [Improve Code]: No active editor');
        return;
      }

      if (editor.selection.isEmpty) {
        vscode.window.showWarningMessage('OpenChamber [Improve Code]: No text selected');
        return;
      }

      const target = buildSelectionTarget(editor);
      let prompt: string;

      if (target) {
        prompt = 'Improve the selected code.';
      } else {
        const selectedText = editor.document.getText(editor.selection);
        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        const languageId = editor.document.languageId;
        prompt = `Improve the following Code:\n\n${filePath}\n\`\`\`${languageId}\n${selectedText}\n\`\`\``;
      }

      if (!sessionEditorProvider?.createSessionWithPromptInActivePanel(prompt, target ?? undefined)) {
        if (!(await revealChatViewForPayload())) {
          return;
        }
        chatViewProvider?.createNewSessionWithPrompt(prompt, target ?? undefined);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.newSession', () => {
      chatViewProvider?.createNewSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.showSettings', () => {
      chatViewProvider?.showSettings();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      chatViewProvider?.syncWorkspaceFolders(resolveWorkspaceFolders(vscode.workspace.workspaceFolders ?? []));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openchamber.showOpenCodeStatus', async () => {
      const config = vscode.workspace.getConfiguration('openchamber');
      const configuredApiUrl = (config.get<string>('apiUrl') || '').trim();

      const extensionVersion = String(context.extension?.packageJSON?.version || '');
      const workspaceFolders = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
      const primaryWorkspace = workspaceFolders[0] || '';

      const debug = openCodeManager?.getDebugInfo();
      const resolvedApiUrl = openCodeManager?.getApiUrl();
      const workingDirectory = openCodeManager?.getWorkingDirectory() ?? '';
      const workingDirectoryMatchesWorkspace = Boolean(primaryWorkspace && workingDirectory === primaryWorkspace);
      let resolvedApiPath = '';
      if (resolvedApiUrl) {
        try {
          resolvedApiPath = new URL(resolvedApiUrl).pathname || '/';
        } catch {
          resolvedApiPath = '(invalid url)';
        }
      }

      const safeFetch = async (input: string, timeoutMs = 6000) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = Date.now();
        const openCodeAuthHeaders = openCodeManager?.getOpenCodeAuthHeaders() || {};
        try {
          const resp = await fetch(input, {
            method: 'GET',
            headers: { Accept: 'application/json', ...openCodeAuthHeaders },
            signal: controller.signal,
          });
          const elapsedMs = Date.now() - startedAt;
          const contentType = resp.headers.get('content-type') || '';
          const isJson = contentType.toLowerCase().includes('json') && !contentType.toLowerCase().includes('text/html');

          let summary = '';
          if (isJson) {
            const json = await resp.json().catch(() => null);
            if (Array.isArray(json)) {
              summary = `json[array] len=${json.length}`;
            } else if (json && typeof json === 'object') {
              const keys = Object.keys(json).slice(0, 8);
              summary = `json[object] keys=${keys.join(',')}${Object.keys(json).length > keys.length ? ',…' : ''}`;
            } else {
              summary = `json[${typeof json}]`;
            }
          } else {
            summary = contentType ? `content-type=${contentType}` : 'no content-type';
          }

          return { ok: resp.ok && isJson, status: resp.status, elapsedMs, summary };
        } catch (error) {
          const elapsedMs = Date.now() - startedAt;
          const isAbort =
            controller.signal.aborted ||
            (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted')));
          const message = isAbort
            ? `timeout after ${timeoutMs}ms`
            : error instanceof Error
              ? error.message
              : String(error);
          return { ok: false, status: 0, elapsedMs, summary: `error=${message}` };
        } finally {
          clearTimeout(timeout);
        }
      };

      const buildProbeUrl = (pathname: string, includeDirectory = true) => {
        if (!resolvedApiUrl) return null;
        const base = `${resolvedApiUrl.replace(/\/+$/, '')}/`;
        const url = new URL(pathname.replace(/^\/+/, ''), base);
        if (includeDirectory && workingDirectory) {
          url.searchParams.set('directory', workingDirectory);
        }
        return url.toString();
      };

      const probeTargets: Array<{ label: string; path: string; includeDirectory?: boolean; timeoutMs?: number }> = [
        { label: 'health', path: '/global/health', includeDirectory: false },
        { label: 'config', path: '/config', includeDirectory: true },
        { label: 'providers', path: '/config/providers', includeDirectory: true },
        // Can be slower on large configs; keep the probe from producing false negatives.
        { label: 'agents', path: '/agent', includeDirectory: true, timeoutMs: 12000 },
        { label: 'commands', path: '/command', includeDirectory: true, timeoutMs: 10000 },
        { label: 'project', path: '/project/current', includeDirectory: true },
        { label: 'path', path: '/path', includeDirectory: true },
        // Session listing is what powers the sidebar. This helps diagnose "no sessions shown" bugs.
        { label: 'sessions', path: '/session', includeDirectory: true, timeoutMs: 12000 },
        { label: 'sessionStatus', path: '/session/status', includeDirectory: true },
      ];

      const probes = resolvedApiUrl
        ? await Promise.all(
            probeTargets.map(async (entry) => {
              const url = buildProbeUrl(entry.path, entry.includeDirectory !== false);
              if (!url) {
                return { label: entry.label, url: '(none)', result: null as null };
              }
              const result = await safeFetch(url, typeof entry.timeoutMs === 'number' ? entry.timeoutMs : undefined);
              return { label: entry.label, url, result };
            })
          )
        : [];
      const [sidebarDiagnostics, sessionEditorDiagnostics, agentManagerDiagnostics] = await Promise.all([
        chatViewProvider
          ? chatViewProvider.requestDiagnostics()
          : Promise.resolve({ available: false, reason: 'chat_view_provider_unavailable' }),
        sessionEditorProvider?.requestDiagnostics() ?? Promise.resolve([]),
        agentManagerProvider?.requestDiagnostics()
          ?? Promise.resolve({ surface: 'agentManager', available: false, reason: 'provider_unavailable' }),
      ]);
      const webviewDiagnostics = {
        sidebar: sidebarDiagnostics,
        sessionEditors: sessionEditorDiagnostics,
        agentManager: agentManagerDiagnostics,
      };

      const storedSettings = context.globalState.get<Record<string, unknown>>(SETTINGS_KEY) || {};
      const settingsKeys = Object.keys(storedSettings).filter((key) => key !== 'lastDirectory');

      const lines = [
        `Time: ${new Date().toISOString()}`,
        `OpenChamber version: ${extensionVersion || '(unknown)'}`,
        `OpenCode Version: ${debug?.version ?? '(unknown)'}`,
        `VS Code version: ${vscode.version}`,
        `Platform: ${process.platform} ${process.arch}`,
        `Workspace folders: ${workspaceFolders.length}${workspaceFolders.length ? ` (${workspaceFolders.join(', ')})` : ''}`,
        `Status: ${openCodeManager?.getStatus() ?? 'unknown'}`,
        `Working directory: ${workingDirectory}`,
        `Working dir matches workspace: ${workingDirectoryMatchesWorkspace ? 'yes' : 'no'}`,
        `API URL (configured): ${configuredApiUrl || '(none)'}`,
        `OpenCode binary (configured): ${(vscode.workspace.getConfiguration('openchamber').get<string>('opencodeBinary') || '').trim() || '(none)'}`,
        `API URL (resolved): ${openCodeManager?.getApiUrl() ?? '(none)'}`,
        `API URL path: ${resolvedApiPath || '(none)'}`,
        debug
          ? `OpenCode server URL: ${debug.serverUrl ?? '(none)'}`
          : `OpenCode server URL: (unknown)`,
        debug
          ? `OpenCode mode: ${debug.mode} (starts=${debug.startCount}, restarts=${debug.restartCount})`
          : `OpenCode mode: (unknown)`,
        debug
          ? `Secure OpenCode connection: ${debug.secureConnection ? 'true' : 'false'}`
          : `Secure OpenCode connection: (unknown)`,
        debug
          ? `OpenCode auth source: ${debug.authSource ?? '(none)'}`
          : `OpenCode auth source: (unknown)`,
        debug
          ? `OpenCode CLI path: ${debug.cliPath || '(not found)'}`
          : `OpenCode CLI path: (unknown)`,
        debug
          ? `OpenCode detected port: ${debug.detectedPort ?? '(none)'}`
          : `OpenCode detected port: (unknown)`,
        debug
          ? `OpenCode API prefix: ${debug.apiPrefixDetected ? (debug.apiPrefix || '(root)') : '(unknown)'}`
          : `OpenCode API prefix: (unknown)`,
        debug
          ? `Last start: ${formatIso(debug.lastStartAt)}`
          : `Last start: (unknown)`,
        debug
          ? `Last ready: ${debug.lastReadyElapsedMs !== null ? `${debug.lastReadyElapsedMs}ms` : '(unknown)'}`
          : `Last ready: (unknown)`,
        debug
          ? `Ready attempts: ${debug.lastReadyAttempts ?? '(unknown)'}`
          : `Ready attempts: (unknown)`,
        debug
          ? `Start attempts: ${debug.lastStartAttempts ?? '(unknown)'}`
          : `Start attempts: (unknown)`,
        debug
          ? `Last connected: ${formatIso(debug.lastConnectedAt)}`
          : `Last connected: (unknown)`,
        debug && debug.lastConnectedAt ? `Connected for: ${formatDurationMs(Date.now() - debug.lastConnectedAt)}` : `Connected for: (n/a)`,
        debug && debug.lastExitCode !== null ? `Last exit code: ${debug.lastExitCode}` : `Last exit code: (none)`,
        debug?.lastError ? `Last error: ${debug.lastError}` : `Last error: (none)`,
        `Settings keys (stored): ${settingsKeys.length ? settingsKeys.join(', ') : '(none)'}`,
        probes.length ? '' : '',
        ...(probes.length
          ? [
              'OpenCode API probes:',
              ...probes.map((probe) => {
                if (!probe.result) return `- ${probe.label}: (no url)`;
                const { ok, status, elapsedMs, summary } = probe.result;
                const suffix = ok ? '' : ` url=${probe.url}`;
                return `- ${probe.label}: ${ok ? 'ok' : 'fail'} status=${status} time=${elapsedMs}ms ${summary}${suffix}`;
              }),
            ]
          : []),
        '',
        'OpenChamber webview diagnostics:',
        JSON.stringify(webviewDiagnostics, null, 2),
        '',
      ];

      outputChannel?.appendLine(lines.join('\n'));
      outputChannel?.show(true);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      chatViewProvider?.updateTheme(theme.kind);
      agentManagerProvider?.updateTheme(theme.kind);
      sessionEditorProvider?.updateTheme(theme.kind);
    })
  );

  // Theme changes can update the `workbench.colorTheme` setting slightly after the
  // `activeColorTheme` event. Listen for config changes too so we can re-resolve
  // the contributed theme JSON and update Shiki themes in the webview.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('workbench.colorTheme') ||
        event.affectsConfiguration('workbench.preferredLightColorTheme') ||
        event.affectsConfiguration('workbench.preferredDarkColorTheme')
      ) {
        chatViewProvider?.updateTheme(vscode.window.activeColorTheme.kind);
        agentManagerProvider?.updateTheme(vscode.window.activeColorTheme.kind);
        sessionEditorProvider?.updateTheme(vscode.window.activeColorTheme.kind);
      }
    })
  );

  // Subscribe to status changes - this broadcasts to webview
  context.subscriptions.push(
    openCodeManager.onStatusChange((status, error) => {
      chatViewProvider?.updateConnectionStatus(status, error);
      agentManagerProvider?.updateConnectionStatus(status, error);
      sessionEditorProvider?.updateConnectionStatus(status, error);

      // Start/stop global event watcher based on connection status
      // Mirrors web server and desktop behavior
      if (status === 'connected' && chatViewProvider && openCodeManager) {
        setChatViewProvider(chatViewProvider);
        void startGlobalEventWatcher(openCodeManager, chatViewProvider);
      } else if (status === 'disconnected' || status === 'error') {
        stopGlobalEventWatcher();
      }
    })
  );

  // Start OpenCode API without blocking activation.
  // Blocking here delays webview resolution and causes a blank panel until startup completes.
  void openCodeManager.start();
}

export async function deactivate() {
  stopGlobalEventWatcher();
  await Promise.all([openCodeManager?.stop(), stopGitProcesses()]);
  openCodeManager = undefined;
  chatViewProvider = undefined;
  agentManagerProvider = undefined;
  sessionEditorProvider = undefined;
  outputChannel?.dispose();
  outputChannel = undefined;
}
