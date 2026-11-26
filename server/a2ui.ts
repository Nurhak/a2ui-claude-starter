// A2UI setup shared by the web agent and the MCP server (once, at startup).
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {A2uiGenerator, CatalogConfig} from '@a2ui/agent';

// The v1.0 basic catalog ships inside @a2ui/web_core.
const webCoreSrc = dirname(fileURLToPath(import.meta.resolve('@a2ui/web_core')));
const catalog = CatalogConfig.fromPath(join(webCoreSrc, 'v1_0/schemas/catalogs/basic/catalog.json'));
export const generator = new A2uiGenerator([catalog]);
const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

// Both renderers (the React app in /web and the MCP App view) support the v1.0 basic catalog.
export const rendererCapabilities = {'1.0': {supportedCatalogIds: [BASIC_CATALOG_ID]}};

// Parse a complete A2UI Express reply into validated A2UI messages.
export function toMessages(text: string): unknown[] {
  const stream = generator.createProcessor(rendererCapabilities).openStream({afterRejectedBlock: 'continue'});
  const parts = [...stream.feed(text), ...stream.close()];
  const bad = parts.find(p => p.type === 'error');
  if (bad) throw new Error(String((bad as {error?: {message?: string}}).error?.message ?? 'invalid A2UI'));
  return parts.flatMap(p => (p.type === 'a2ui' ? (p.a2ui as unknown[]) : []));
}
