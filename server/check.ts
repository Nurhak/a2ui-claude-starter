// Smoke test: every canned reply must pass the A2UI parser and catalog validation.
// Run with `npm test`.
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {A2uiGenerator, CatalogConfig} from '@a2ui/agent';
import {chunk, stubAppliedReply, stubCancelledReply, stubSceneReply} from './stub.js';
import {applyScene} from './home.js';

const webCoreSrc = dirname(fileURLToPath(import.meta.resolve('@a2ui/web_core')));
const catalog = CatalogConfig.fromPath(join(webCoreSrc, 'v1_0/schemas/catalogs/basic/catalog.json'));
const processor = new A2uiGenerator([catalog]).createProcessor({
  '1.0': {supportedCatalogIds: ['https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json']},
});

const cases = {
  scene: stubSceneReply(),
  applied: stubAppliedReply(applyScene({brightness: 35, color: ['warm'], tv: true, blinds: false})),
  cancelled: stubCancelledReply(),
};

let failed = 0;
for (const [name, reply] of Object.entries(cases)) {
  try {
    const stream = processor.openStream();
    const parts = chunk(reply, 37).flatMap(c => stream.feed(c));
    parts.push(...stream.close());
    const messages = parts.filter(p => p.type === 'a2ui').flatMap(p => (p.type === 'a2ui' ? p.a2ui : []));
    console.log(`ok   ${name}: ${messages.length} A2UI message(s)`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}: ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
