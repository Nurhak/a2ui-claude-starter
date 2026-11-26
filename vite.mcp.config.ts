// Builds the MCP App view (web/mcp-app) into one self-contained HTML file for server/mcp.ts.
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {viteSingleFile} from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'web/mcp-app',
  plugins: [react(), viteSingleFile()],
  build: {outDir: '../../dist/mcp-app', emptyOutDir: true, rollupOptions: {input: 'web/mcp-app/scene.html'}},
});
