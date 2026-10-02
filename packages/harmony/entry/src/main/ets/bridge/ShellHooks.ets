// Cross-component hooks connecting EntryAbility to the Index page's Web
// component, without globalThis (banned by ArkTS strict mode). Index assigns
// implementations in aboutToAppear; EntryAbility invokes them optionally.
export class ShellHooks {
  static emitShellEvent?: (name: string, detailJson: string) => void;
  static dispatchLaunchUrl?: (url: string) => void;
  static handleBackPress?: () => boolean;
}
