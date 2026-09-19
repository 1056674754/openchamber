type ModelVariantResolutionInput = {
  readonly variants: Readonly<Record<string, unknown>> | undefined;
  /** An effort name, `null` for an explicit "Default", or absent for no choice. */
  readonly savedVariant?: string | null;
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
  // An explicit "Default" is a choice: it stops the fallbacks below instead of
  // letting the agent or settings default resurrect an effort the user turned
  // off.
  if (savedVariant === null) return undefined;
  for (const candidate of [savedVariant, agentVariant, defaultVariant]) {
    if (candidate && Object.prototype.hasOwnProperty.call(variants, candidate)) {
      return candidate;
    }
  }
  return undefined;
};
