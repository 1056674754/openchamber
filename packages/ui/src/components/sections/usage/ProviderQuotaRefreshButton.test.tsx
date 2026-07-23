import React from "react";
import { beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n";
import { useQuotaStore } from "@/stores/useQuotaStore";
import { ProviderQuotaRefreshButton } from "./ProviderQuotaRefreshButton";

const findButton = (markup: string, label: string): string => {
	const buttons = markup.match(/<button[^>]*>.*?<\/button>/g) ?? [];
	const button = buttons.find((candidate) =>
		candidate.includes(`aria-label="${label}"`),
	);
	if (!button) {
		throw new Error(`Expected button with aria-label "${label}"`);
	}
	return button;
};

describe("ProviderQuotaRefreshButton", () => {
	beforeEach(() => {
		useQuotaStore.setState({ isFetchingProvider: {} });
	});

	test("renders provider-specific accessible text", () => {
		// Given
		const expectedLabel = "Refresh Codex quota";

		// When
		const markup = renderToStaticMarkup(
			<I18nProvider>
				<ProviderQuotaRefreshButton providerId="codex" providerName="Codex" />
			</I18nProvider>,
		);

		// Then
		const button = findButton(markup, expectedLabel);
		expect(button).toContain(`title="${expectedLabel}"`);
	});

	test("disables and spins only the fetching provider", () => {
		// Given
		useQuotaStore.setState({
			isFetchingProvider: { codex: true, claude: false },
		});

		// When
		const markup = renderToStaticMarkup(
			<I18nProvider>
				<ProviderQuotaRefreshButton providerId="codex" providerName="Codex" />
				<ProviderQuotaRefreshButton providerId="claude" providerName="Claude" />
			</I18nProvider>,
		);

		// Then
		const codexButton = findButton(markup, "Refresh Codex quota");
		const claudeButton = findButton(markup, "Refresh Claude quota");
		expect(codexButton).toContain("disabled=\"\"");
		expect(codexButton).toContain("animate-spin");
		expect(claudeButton).not.toContain("disabled=\"\"");
		expect(claudeButton).not.toContain("animate-spin");
	});

	test("disables without spinning when externally disabled", () => {
		// Given
		useQuotaStore.setState({
			isFetchingProvider: { codex: false },
		});

		// When
		const markup = renderToStaticMarkup(
			<I18nProvider>
				<ProviderQuotaRefreshButton
					providerId="codex"
					providerName="Codex"
					disabled
				/>
			</I18nProvider>,
		);

		// Then
		const button = findButton(markup, "Refresh Codex quota");
		expect(button).toContain("disabled=\"\"");
		expect(button).not.toContain("animate-spin");
	});
});
