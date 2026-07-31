import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n";
import { ConfigCard } from "./ConfigCard";
import type { ConfigCardProps } from "./types";

const noop = () => {};

const baseProps = {
  isDesktop: true,
  sshCommand: "ssh user@example.test",
  onSshCommandChange: noop,
  nickname: "External server",
  onNicknameChange: noop,
  connectionTimeoutSec: 60,
  onConnectionTimeoutChange: noop,
  enabled: true,
  onEnabledChange: noop,
  remoteMode: "external",
  onRemoteModeChange: noop,
  preferredRemotePort: 41234,
  onPreferredRemotePortChange: noop,
  authType: "none",
  onAuthTypeChange: noop,
  authValue: "",
  onAuthValueChange: noop,
  webUrl: "",
  onWebUrlChange: noop,
} satisfies ConfigCardProps;

describe("ConfigCard", () => {
  test("renders the remote port input when remote mode is external", () => {
    // Given an external desktop instance with its required remote port.
    // When the configuration card is rendered.
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <ConfigCard {...baseProps} />
      </I18nProvider>,
    );

    // Then the configured port remains editable in the rendered form.
    expect(markup).toContain('value="41234"');
  });
});
