import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Locally built VSIXs get reinstalled in place over the same versioned
// directory, but the webview service worker caches vscode-webview://
// resources by URL. Without content hashes in filenames, a rebuilt bundle
// keeps the same URLs and the worker happily serves stale chunks to the new
// html forever (microsoft/vscode#325767). Hashed names make every rebuild
// load fresh; the extension host resolves the hashed entry via the emitted
// build-manifest.json.
const writeEntryManifest = (): Plugin => ({
  name: 'write-webview-entry-manifest',
  apply: 'build',
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      // chunk.fileName already carries the `assets/` output prefix; pick the
      // html entry explicitly because hashed names also appear on other
      // `index-*` chunks (e.g. worker-factory entries).
      if (chunk.type === 'chunk' && chunk.isEntry && chunk.name === 'index') {
        this.emitFile({
          type: 'asset',
          fileName: 'build-manifest.json',
          source: JSON.stringify({ entry: chunk.fileName }),
        });
        return;
      }
    }
  },
});

export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname, 'webview'),
  base: './',  // Use relative paths for VS Code webview
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    writeEntryManifest(),
  ],
  resolve: {
    alias: [
      { find: '@opencode-ai/sdk/v2', replacement: path.resolve(__dirname, '../../node_modules/@opencode-ai/sdk/dist/v2/client.js') },
      { find: '@openchamber/ui', replacement: path.resolve(__dirname, '../ui/src') },
      { find: '@vscode', replacement: path.resolve(__dirname, './webview') },
      { find: '@', replacement: path.resolve(__dirname, '../ui/src') },
    ],
  },
  worker: {
    format: 'es',
    // VS Code webviews cannot load module imports from inside a web worker.
    // Keep the Shiki worker self-contained instead of emitting grammar chunks.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    'global': 'globalThis',
    '__OPENCHAMBER_WEBVIEW_BUILD_TIME__': JSON.stringify(new Date().toISOString()),
  },
  envPrefix: ['VITE_'],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    hmr: {
      host: 'localhost',
      protocol: 'ws',
      port: 5173,
    },
  },
  optimizeDeps: {
    include: ['@opencode-ai/sdk/v2', '@opencode/client'],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    // Webview resource loads funnel through the VS Code service worker; a
    // dynamic-import burst fanning out hundreds of modulepreload links trips
    // its concurrency cap and every subsequent fetch fails permanently
    // (microsoft/vscode#326500, same failure as the Codex extension). Let
    // JS chunks load on demand instead; CSS preloads stay.
    modulePreload: {
      polyfill: false,
      resolveDependencies: (_filename, deps) => deps.filter((dep) => !dep.endsWith('.js')),
    },
    rollupOptions: {
      input: path.resolve(__dirname, 'webview/index.html'),
      external: ['node:child_process', 'node:fs', 'node:path', 'node:url'],
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
}));
