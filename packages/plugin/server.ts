// OpenCode v2 plugin entrypoint: Host.resolve looks for <plugin>/server.* at
// the package root. Re-exports the dual-shape default (v1 `server` + v2 `setup`).
export { default } from "./src/index.js"
