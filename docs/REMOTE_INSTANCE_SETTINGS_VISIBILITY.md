# Remote Instance Settings Visibility

Settings has two different scopes:

- `default`: the local OpenChamber runtime and local OpenCode configuration.
- `remote`: the currently selected remote instance in the Settings instance selector.

The remote scope should hide local UI-only preferences and remote-instance maintenance controls. It may show server/config-oriented pages that a remote OpenCode server plausibly needs, while selected-instance data binding is tightened page by page.

## Current Visibility Matrix

| Page | Remote instance needs it? | Decision |
| --- | --- | --- |
| Appearance | No | Default only. These are local UI, theme, PWA, font, and terminal display preferences. |
| Chat | No | Default only. These are local chat rendering and interaction preferences. |
| Notifications | No | Default only. These are browser and desktop notification preferences. |
| Sessions | Yes | Show in both scopes. This is a server/config-oriented settings area, even though mixed local-only fields still need follow-up cleanup. |
| Shortcuts | No | Default only. Keyboard shortcuts are local UI preferences. |
| Git | Yes | Show in both scopes. Git identity/credential settings are relevant to remote work, but selected-instance binding still needs auditing. |
| Magic Prompts | Yes | Show in both scopes. Prompt templates are workflow configuration rather than local UI chrome. |
| Snippets | Yes | Show in both scopes. Snippets are workflow configuration rather than local UI chrome. |
| Remote Instances | No in remote scope | Default only. This is the management list for creating and editing remote instances. |
| Connection | No in settings nav | Hidden. Connection status and restart/log controls belong inside Remote Instances management, not the remote settings nav. |
| Port Forwarding | No in settings nav | Hidden. Port forwards belong inside Remote Instances management, not the remote settings nav. |
| Remote Projects | Yes | Remote only. Project browsing should be bound to the selected remote instance when implemented. |
| Config Sync | Future | Hidden for now. It is a useful remote concept, but the current store still calls local `/api/config/*` endpoints and ignores source/target instance IDs. |
| Agents | Yes | Show in both scopes. Agent configuration is relevant to remote OpenCode servers. |
| Behavior | Yes | Show in both scopes. Behavior and instruction settings are server/config-oriented. |
| Commands | Yes | Show in both scopes. Slash command configuration is relevant to remote OpenCode servers. |
| MCP | Yes | Show in both scopes. MCP server configuration is relevant to remote OpenCode servers. |
| Plugins | Yes | Show in both scopes. Plugin configuration is relevant to remote OpenCode servers. |
| Permissions | Yes | Show in both scopes. Tool permission configuration is relevant to remote OpenCode servers. |
| Presets | Yes | Show in both scopes. Presets are configuration workflows, not local UI chrome. |
| Providers | Yes | Show in both scopes. Provider/model configuration is relevant to remote OpenCode servers. |
| Usage | Yes | Show in both scopes. Usage/quota views are relevant to remote OpenCode servers. |
| Skills | Yes | Show in both scopes. Installed skills are server/workflow configuration. |
| Skills Catalog | Yes | Show in both scopes. Skill installation is server/workflow configuration. |
| Voice | No | Default only. Voice settings are local browser/audio/TTS preferences. |
| Remote Tunnel | No | Default only. Tunnel settings manage the local OpenChamber sharing tunnel. |

## Implementation Rules

- Navigation and content rendering must use the same visibility rule. A stale settings slug must not render a page that is hidden for the selected instance scope.
- When switching from default to remote, hidden default pages should redirect to the first visible remote-capable page in the settings order.
- When switching from remote to default, hidden remote pages should redirect to the first default page in the settings order.
- `remote-instances` stays default-only and uses the split layout so the instance list remains visible on the left.
- SSH connection and port-forward controls should stay inside Remote Instances management instead of the remote settings nav.
