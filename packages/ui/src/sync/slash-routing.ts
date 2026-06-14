export type SlashRouteEntry = {
  readonly name: string
}

export type SlashInvocation = {
  readonly name: string
  readonly arguments: string
}

export type SlashRouteTarget = SlashInvocation

const SLASH_INVOCATION_PATTERN = /^\/(\S+)(?:\s+([\s\S]*))?$/

export function parseSlashInvocation(content: string): SlashInvocation | null {
  const match = SLASH_INVOCATION_PATTERN.exec(content)
  const name = match?.[1]
  if (!name) return null
  return {
    name,
    arguments: match[2] ?? "",
  }
}

function resolveCanonicalName(name: string, sources: readonly (readonly SlashRouteEntry[])[]): string | null {
  for (const entries of sources) {
    const exact = entries.find((entry) => entry.name === name)
    if (exact) return exact.name
  }

  const normalizedName = name.toLowerCase()
  for (const entries of sources) {
    const caseInsensitive = entries.find((entry) => entry.name.toLowerCase() === normalizedName)
    if (caseInsensitive) return caseInsensitive.name
  }

  return null
}

export function resolveSlashRouteTarget(
  content: string,
  sources: readonly (readonly SlashRouteEntry[])[],
): SlashRouteTarget | null {
  const invocation = parseSlashInvocation(content)
  if (!invocation) return null

  const name = resolveCanonicalName(invocation.name, sources)
  if (!name) return null

  return {
    name,
    arguments: invocation.arguments,
  }
}
