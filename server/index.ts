import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {A2uiGenerator, CatalogConfig} from '@a2ui/agent';
import {applyScene, type Scene} from './home.js';
import {STUB_NOTICE, chunk, stubAppliedReply, stubCancelledReply, stubSceneReply} from './stub.js';

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.MODEL ?? 'claude-sonnet-5-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const STUB = process.env.STUB === '1' || !API_KEY;

// --- A2UI setup (once, at startup) -----------------------------------------
// The v1.0 basic catalog ships inside @a2ui/web_core.
const webCoreSrc = dirname(fileURLToPath(import.meta.resolve('@a2ui/web_core')));
const CATALOG_PATH = join(webCoreSrc, 'v1_0/schemas/catalogs/basic/catalog.json');
const catalog = CatalogConfig.fromPath(CATALOG_PATH);
const generator = new A2uiGenerator([catalog]);
const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

// Our own renderer (the React app in /web) supports the v1.0 basic catalog.
const rendererCapabilities = {'1.0': {supportedCatalogIds: [BASIC_CATALOG_ID]}};

const SYSTEM = `You are a smart home assistant for one home. Devices are simulated.
The living room has dimmable lights (brightness 0-100 and a color: warm, neutral or cool), a TV and blinds.

When the user asks to change something, do NOT just describe it in text.
Reply with one short sentence and ONE A2UI surface the user can adjust and confirm:
- Use surface id "scene".
- Keep the editable values under /scene with keys: name, room, brightness (number 0-100),
  color (array with one of "warm" | "neutral" | "cool"), tv (boolean), blinds (boolean).
- Confirm with Event("apply_scene", {scene: $/scene}) and cancel with Event("cancel_scene").
- Only include controls that matter for the request.

When you receive an apply_scene result, reply with a short confirmation and a small card
(surface id "result") listing what changed. When the user cancels, reply in one short sentence and no UI.
For questions that need no input from the user, answer in plain text.`;

// --- Conversation store (in memory, per browser tab) ------------------------
type Turn = Anthropic.MessageParam;
const sessions = new Map<string, Turn[]>();

interface ChatBody {
  sessionId?: string;
  text?: string;
  action?: {name: string; surfaceId?: string; context?: Record<string, unknown>};
}

const anthropic = STUB ? null : new Anthropic({apiKey: API_KEY});
const app = express();
app.use(express.json({limit: '1mb'}));

app.get('/api/health', (_req, res) => {
  res.json({ok: true, mode: STUB ? 'stub' : 'claude', model: STUB ? null : MODEL});
});

app.post('/api/chat', async (req, res) => {
  const body = req.body as ChatBody;
  const sessionId = body.sessionId ?? randomUUID();
  const history = sessions.get(sessionId) ?? [];
  sessions.set(sessionId, history);

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (obj: unknown) => res.write(JSON.stringify(obj) + '\n');

  // 1. Turn the request into a user message. UI actions are handled by code
  //    first (the model never touches devices directly), then reported to the model.
  let userContent: string;
  let stubReply: string;

  if (body.action) {
    const {name, context = {}} = body.action;
    if (name === 'apply_scene') {
      const result = applyScene((context.scene ?? {}) as Scene);
      send({type: 'event', name: 'scene_applied', result});
      userContent = `[UI action: apply_scene] Result: ${JSON.stringify(result)}`;
      stubReply = stubAppliedReply(result);
    } else if (name === 'cancel_scene') {
      userContent = '[UI action: cancel_scene] The user cancelled. Nothing was changed.';
      stubReply = stubCancelledReply();
    } else {
      userContent = `[UI action: ${name}] Context: ${JSON.stringify(context)}`;
      stubReply = `Got the "${name}" action.`;
    }
  } else {
    userContent = (body.text ?? '').trim() || 'Hi';
    stubReply = stubSceneReply();
  }
  history.push({role: 'user', content: userContent});

  // 2. Stream the reply through the A2UI parser. Every message it emits has been
  //    validated against the catalog, so the browser only ever renders valid UI.
  const processor = generator.createProcessor(rendererCapabilities);
  const stream = processor.openStream({afterRejectedBlock: 'continue'});
  const forward = (parts: ReturnType<typeof stream.feed>) => {
    for (const part of parts) {
      if (part.type === 'text') send({type: 'text', text: part.text});
      else if (part.type === 'a2ui') send({type: 'a2ui', messages: part.a2ui});
      else if (part.type === 'error') send({type: 'error', message: String(part.error?.message ?? part.error)});
    }
  };

  let full = '';
  try {
    send({type: 'session', sessionId, mode: STUB ? 'stub' : 'claude'});
    if (STUB) {
      send({type: 'notice', text: STUB_NOTICE});
      for (const piece of chunk(stubReply)) {
        full += piece;
        forward(stream.feed(piece));
        await new Promise(r => setTimeout(r, 40)); // feel like a stream
      }
    } else {
      const llm = anthropic!.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        system: `${SYSTEM}\n\n${processor.promptSnippet}`,
        messages: history,
      });
      for await (const event of llm) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          full += event.delta.text;
          forward(stream.feed(event.delta.text));
        }
      }
    }
    forward(stream.close());
    history.push({role: 'assistant', content: full || '(no reply)'});
  } catch (err) {
    const e = err as {message?: string; partialResults?: Parameters<typeof forward>[0]};
    if (e.partialResults) forward(e.partialResults);
    send({type: 'error', message: e.message ?? String(err)});
    history.pop(); // drop the user turn so the conversation stays valid
  } finally {
    send({type: 'done'});
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`A2UI agent on http://localhost:${PORT} (${STUB ? 'stub mode' : `Claude: ${MODEL}`})`);
});
