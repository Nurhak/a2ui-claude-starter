// The same home as the web agent, as an MCP server: Claude Desktop / Claude Code can apply
// a scene through narrow tools instead of full Home Assistant access.
// In hosts that support MCP Apps (Claude Desktop, claude.ai) both tools also render the
// A2UI scene card from web/mcp-app inside the chat; elsewhere they return plain text.
// Run with `npm run mcp` (stdio). Devices follow the same HA_* settings as the agent.
import {McpServer, fromJsonSchema} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {toMessages} from './a2ui.js';
import {applyScene, haConfig} from './home.js';
import {stubAppliedReply, stubSceneReply, type SceneCard} from './stub.js';

const UI_URI = 'ui://a2ui-home-scene/scene.html';
const UI_MIME = 'text/html;profile=mcp-app';
const UI_FILE = new URL('../dist/mcp-app/scene.html', import.meta.url);

interface Scene {
  brightness?: number;
  color?: 'warm' | 'neutral' | 'cool';
  tv?: boolean;
  blinds?: boolean;
}

// HA_TOKEN_COMMAND (e.g. `op read op://Home/HA/token`) fetches the token on first use instead
// of at start, so a slow password manager can't hold up Claude's MCP startup.
async function ensureToken() {
  const cmd = process.env.HA_TOKEN_COMMAND;
  if (process.env.HA_TOKEN || !cmd) return;
  // A secret lookup can come back empty when another one runs at the same time: retry.
  for (let attempt = 1; attempt <= 3 && !process.env.HA_TOKEN; attempt++) {
    const {stdout} = await promisify(execFile)('/bin/sh', ['-c', cmd], {timeout: 60_000});
    if (stdout.trim()) process.env.HA_TOKEN = stdout.trim();
  }
  if (!process.env.HA_TOKEN) throw new Error('HA_TOKEN_COMMAND printed no token');
}

const server = new McpServer({name: 'a2ui-home-scene', version: '0.2.0'});

const sceneProperties = {
  brightness: {type: 'integer', minimum: 0, maximum: 100, description: 'Light brightness in percent; 0 turns the lights off'},
  color: {type: 'string', enum: ['warm', 'neutral', 'cool'], description: 'White tone of the lights'},
  tv: {type: 'boolean', description: 'true turns the TV on, false off'},
  blinds: {type: 'boolean', description: 'true closes the blinds, false opens them'},
} as const;

server.registerResource('Living room scene card', UI_URI, {mimeType: UI_MIME}, async () => ({
  contents: [{uri: UI_URI, mimeType: UI_MIME, text: await readFile(UI_FILE, 'utf8')}],
}));

server.registerTool(
  'show_scene',
  {
    title: 'Suggest a living room scene',
    description:
      'Show the user an adjustable scene card (brightness slider, warm/neutral/cool, TV, blinds) with Apply and Cancel. ' +
      'Changes nothing by itself: devices change only when the user presses Apply. Prefer this over apply_scene ' +
      'when the user asks for a mood ("movie night", "cozy") rather than exact values.',
    inputSchema: fromJsonSchema<SceneCard>({
      type: 'object',
      properties: {name: {type: 'string', maxLength: 40, description: 'Short scene name, e.g. "Movie night"'}, ...sceneProperties},
      additionalProperties: false,
    }),
    annotations: {readOnlyHint: true},
    _meta: {ui: {resourceUri: UI_URI}},
  },
  async scene => ({
    content: [{type: 'text', text: `Showing the "${scene.name ?? 'Movie night'}" scene card. Nothing changes until the user presses Apply.`}],
    structuredContent: {messages: toMessages(stubSceneReply(scene))},
  }),
);

server.registerTool(
  'apply_scene',
  {
    title: 'Apply a living room scene',
    description:
      'Set the living room lights (brightness, warm/neutral/cool white), TV and blinds in one go. ' +
      'Only pass what should change. Returns what was applied, skipped or failed.',
    // Plain JSON Schema: the project's zod (3.x, used by A2UI) is older than the SDK wants.
    // applyScene() checks every value again, so nothing unchecked reaches Home Assistant.
    inputSchema: fromJsonSchema<Scene>({type: 'object', properties: sceneProperties, additionalProperties: false}),
    annotations: {destructiveHint: false, idempotentHint: true, openWorldHint: true},
    _meta: {ui: {resourceUri: UI_URI}},
  },
  async ({brightness, color, tv, blinds}) => {
    try {
      await ensureToken();
    } catch (err) {
      // Don't fall back to the simulated home when a real one was configured.
      return {content: [{type: 'text', text: `Could not get the Home Assistant token: ${(err as Error).message}`}], isError: true};
    }
    const result = await applyScene({brightness, color: color ? [color] : undefined, tv, blinds});
    const where = result.target === 'home-assistant' ? 'Home Assistant' : 'the simulated home (HA_URL/HA_TOKEN not set)';
    const lines = result.changes.length ? result.changes.map(c => `- ${c}`).join('\n') : '- nothing to change';
    return {
      content: [{type: 'text', text: `Applied to ${where}:\n${lines}`}],
      structuredContent: {messages: toMessages(stubAppliedReply(result))},
      isError: !result.ok,
    };
  },
);

await server.connect(new StdioServerTransport());
const devices = haConfig() ? 'Home Assistant' : process.env.HA_URL && process.env.HA_TOKEN_COMMAND ? 'Home Assistant (token on first use)' : 'simulated';
console.error(`a2ui-home-scene MCP ready (devices: ${devices})`);
