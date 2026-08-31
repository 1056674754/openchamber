import { plugin, tool } from "@opencode-ai/plugin"
import { spawn } from "child_process"
import os from "os"
import path from "path"
import { z } from "zod"

// Namespace roots must stay in sync with packages/vscode/src/remoteNamespace.ts
const namespacePattern = new RegExp(
  "^(/remote|" +
    os.homedir().replace(/\\/g, "/").replace(/[.*+?^${}()|[\]]/g, "\\$&") +
    "/.openchamber/remote)/([A-Za-z0-9._-]+)(/|$)",
)

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 512 * 1024

const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"

export const RemoteNamespace = plugin("remote-namespace", {
  tool: {
    bash: tool({
      description: [
        "Executes a given Bash command on the REMOTE host over SSH.",
        "This session maps to a remote machine; the command runs there, in the remote working directory",
        "that corresponds to the session directory, so relative paths work as-is.",
        "Execution is non-interactive: stdin is closed. Long output is truncated.",
      ].join("\n"),
      args: z.object({
        command: z.string().describe("The Bash command to run on the remote host"),
        workdir: z
          .string()
          .optional()
          .describe(
            "Optional namespace directory to run the command in; defaults to the session directory. Must stay inside the session namespace.",
          ),
        timeout: z.number().optional().describe("Optional timeout in milliseconds (default 120000, max 600000)"),
      }),
      execute: async (args, ctx) => {
        const match = namespacePattern.exec(ctx.directory)
        if (!match) {
          throw new Error("remote-namespace: session directory is not inside a /remote/<host>/ namespace")
        }
        const host = match[2]
        const namespaceRoot = match[1] + "/" + host

        const requested = args.workdir
          ? path.isAbsolute(args.workdir)
            ? args.workdir
            : path.resolve(ctx.directory, args.workdir)
          : ctx.directory
        const resolved = path.resolve(requested)
        if (resolved !== namespaceRoot && !resolved.startsWith(namespaceRoot + "/")) {
          throw new Error("remote-namespace: workdir must stay under " + namespaceRoot)
        }
        const remoteCwd = resolved.slice(namespaceRoot.length) || "/"
        const timeout = Math.min(Math.max(args.timeout ?? DEFAULT_TIMEOUT_MS, 1000), 600_000)

        return await new Promise((resolvePromise) => {
          const child = spawn(
            "ssh",
            ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, "cd " + shellQuote(remoteCwd) + " && " + args.command],
            { stdio: ["ignore", "pipe", "pipe"] },
          )

          let output = ""
          let truncated = false
          let settled = false
          let timedOut = false

          const append = (chunk: Buffer) => {
            if (output.length < MAX_OUTPUT_BYTES) {
              output += chunk.toString("utf-8")
              if (output.length >= MAX_OUTPUT_BYTES) {
                truncated = true
                output = output.slice(0, MAX_OUTPUT_BYTES) + "\n... [remote-namespace] output truncated]"
              }
            }
          }
          const finish = (exit: number | null) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            ctx.abort?.removeEventListener("abort", onAbort)
            if (timedOut) output += "\n... [remote-namespace] killed after " + timeout + "ms"
            resolvePromise({
              title: args.command.slice(0, 200),
              metadata: { output: output.slice(-2000), exit: exit ?? -1, remoteHost: host, remoteCwd },
              output,
            })
          }
          const onAbort = () => child.kill("SIGKILL")
          const timer = setTimeout(() => {
            timedOut = true
            child.kill("SIGKILL")
          }, timeout)

          ctx.abort?.addEventListener("abort", onAbort, { once: true })
          child.stdout?.on("data", append)
          child.stderr?.on("data", append)
          child.on("error", (error) => {
            output += "\n[remote-namespace] ssh failed: " + error.message
            finish(-1)
          })
          child.on("close", (code) => finish(code))
        })
      },
    }),
  },
})
