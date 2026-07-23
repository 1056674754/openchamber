type ModelVariantResolutionInput = {
  readonly variants: Readonly<Record<string, unknown>> | undefined;
  readonly savedVariant?: string;
  readonly agentVariant?: string;
  readonly defaultVariant?: string;
};

export const resolveModelVariant = ({
  variants,
  savedVariant,
  agentVariant,
  defaultVariant,
}: ModelVariantResolutionInput): string | undefined => {
  if (!variants) return undefined;
  for (const candidate of [savedVariant, agentVariant, defaultVariant]) {
    if (candidate && Object.prototype.hasOwnProperty.call(variants, candidate)) {
      return candidate;
    }
  }
  return undefined;
};
