// Smoke test: every canned reply must pass the A2UI parser and catalog validation,
// and the Home Assistant path must make the right service calls.
// Run with `npm test`.
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {A2uiGenerator, CatalogConfig} from '@a2ui/agent';
import {chunk, stubAppliedReply, stubCancelledReply, stubSceneReply} from './stub.js';
import {applyScene} from './home.js';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';

const webCoreSrc = dirname(fileURLToPath(import.meta.resolve('@a2ui/web_core')));
const catalog = CatalogConfig.fromPath(join(webCoreSrc, 'v1_0/schemas/catalogs/basic/catalog.json'));
const processor = new A2uiGenerator([catalog]).createProcessor({
  '1.0': {supportedCatalogIds: ['https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json']},
});

const cases = {
  scene: stubSceneReply(),
  applied: stubAppliedReply(await applyScene({brightness: 35, color: ['warm'], tv: true, blinds: false})),
  partial: stubAppliedReply({ok: false, appliedAt: '', room: 'living room', target: 'home-assistant', changes: ['TV on: failed (HTTP 500)']}),
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
// Home Assistant path, against a fake HA server on a random local port.
try {
  const calls: {path: string; auth?: string; body: Record<string, unknown>}[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      calls.push({path: req.url ?? '', auth: req.headers.authorization, body: JSON.parse(raw || '{}')});
      res.writeHead(req.url === '/api/services/cover/close_cover' ? 500 : 200, {'Content-Type': 'application/json'});
      res.end('[]');
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    HA_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    HA_TOKEN: 'test-token',
    HA_LIGHT: 'light.living_room',
    HA_BLINDS: 'cover.living_room',
  });
  delete process.env.HA_TV;
  const result = await applyScene({brightness: 35, color: ['warm'], tv: true, blinds: true});
  server.close();

  assert.deepEqual(calls, [
    {path: '/api/services/light/turn_on', auth: 'Bearer test-token', body: {entity_id: 'light.living_room', brightness_pct: 35, color_temp_kelvin: 2700}},
    {path: '/api/services/cover/close_cover', auth: 'Bearer test-token', body: {entity_id: 'cover.living_room'}},
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.target, 'home-assistant');
  assert.deepEqual(result.changes, [
    'Lights at 35%',
    'Warm light',
    'TV on: skipped, HA_TV is not set',
    'Blinds closed: failed (HTTP 500)',
  ]);
  console.log(`ok   home-assistant: ${calls.length} service call(s)`);
} catch (err) {
  failed++;
  console.error(`FAIL home-assistant: ${(err as Error).message}`);
}

process.exit(failed ? 1 : 0);

