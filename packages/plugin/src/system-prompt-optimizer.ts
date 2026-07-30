type AgentRegistryClient = {
  app: {
    agents(options: { query: { directory: string } }): Promise<{ data?: unknown }>
  }
}

type ChatMessageInput = {
  sessionID: string
  agent?: string
}

type ChatMessageOutput = {
  message?: {
    agent?: string
  }
}

type SystemTransformOutput = {
  system: string[]
}

const PROVIDER_PROMPT_BOUNDARY = "You are powered by the model named"
const MINIMAL_IDENTITY = "You are OpenCode, a coding agent."
const OPTIMIZABLE_AGENT_NAMES = new Set(["build", "plan"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function createSystemPromptOptimizer(options: {
  client: AgentRegistryClient
  directory: string
  enabled: boolean
}) {
  const optimizedSessions = new Set<string>()
  let eligibleAgentsPromise: Promise<Set<string>> | null = null

  const loadEligibleAgents = (): Promise<Set<string>> => {
    if (!options.enabled) return Promise.resolve(new Set())
    if (!eligibleAgentsPromise) {
      eligibleAgentsPromise = options.client.app.agents({
        query: { directory: options.directory },
      }).then((response) => {
        const agents = Array.isArray(response.data) ? response.data : []
        const eligible = new Set<string>()
        for (const candidate of agents) {
          if (!isRecord(candidate) || typeof candidate.name !== "string") continue
          const isBuiltIn = candidate.builtIn === true || candidate.native === true
          if (isBuiltIn && OPTIMIZABLE_AGENT_NAMES.has(candidate.name)) {
            eligible.add(candidate.name)
          }
        }
        return eligible
      }).catch(() => new Set())
    }
    return eligibleAgentsPromise
  }

  const chatMessage = async (input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
    if (!options.enabled || !input.sessionID) return
    const agent = output.message?.agent ?? input.agent
    const eligibleAgents = await loadEligibleAgents()
    if (agent && eligibleAgents.has(agent)) {
      optimizedSessions.add(input.sessionID)
      return
    }
    optimizedSessions.delete(input.sessionID)
  }

  const event = async ({ event }: { event: unknown }): Promise<void> => {
    if (!isRecord(event) || event.type !== "session.deleted" || !isRecord(event.properties)) return
    const info = event.properties.info
    if (isRecord(info) && typeof info.id === "string") {
      optimizedSessions.delete(info.id)
    }
  }

  const transform = async (
    input: { sessionID?: string },
    output: SystemTransformOutput,
  ): Promise<void> => {
    if (!input.sessionID || !optimizedSessions.has(input.sessionID)) return
    const prompt = output.system.join("\n")
    const boundary = prompt.indexOf(PROVIDER_PROMPT_BOUNDARY)
    if (boundary < 0) return
    output.system.length = 0
    output.system.push(`${MINIMAL_IDENTITY}\n\n${prompt.slice(boundary)}`)
  }

  return { chatMessage, event, transform }
}
