import { useSyncExternalStore } from "react";

import { Icon } from "@/components/icon/Icon";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useQuotaStore } from "@/stores/useQuotaStore";
import type { QuotaProviderId } from "@/types";

type ProviderQuotaRefreshButtonProps = {
	readonly providerId: QuotaProviderId;
	readonly providerName: string;
	readonly serverBaseUrl?: string;
	readonly disabled?: boolean;
};

export function ProviderQuotaRefreshButton({
	providerId,
	providerName,
	serverBaseUrl,
	disabled = false,
}: ProviderQuotaRefreshButtonProps) {
	const { t } = useI18n();
	const fetchProviderQuota = useQuotaStore((state) => state.fetchProviderQuota);
	const isFetchingProvider = useSyncExternalStore(
		useQuotaStore.subscribe,
		() => useQuotaStore.getState().isFetchingProvider[providerId] === true,
		() => useQuotaStore.getState().isFetchingProvider[providerId] === true,
	);
	const label = t("quota.actions.refreshProviderAria", {
		provider: providerName,
	});

	return (
		<Button
			type="button"
			variant="ghost"
			size="xs"
			className="shrink-0"
			onClick={() => void fetchProviderQuota(providerId, serverBaseUrl)}
			disabled={disabled || isFetchingProvider}
			aria-label={label}
			title={label}
		>
			<Icon
				name="refresh"
				className={cn("size-3.5", isFetchingProvider && "animate-spin")}
			/>
		</Button>
	);
}
