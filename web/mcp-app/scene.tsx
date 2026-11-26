// The scene card as an MCP App: Claude Desktop / claude.ai render this page inside the chat
// and hand it the A2UI messages from show_scene / apply_scene. Apply calls apply_scene back.
// The bridge is hand-written (a few lines of JSON-RPC over postMessage) because
// @modelcontextprotocol/ext-apps needs zod 4 and A2UI pins zod 3.
import {StrictMode, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {A2uiSurface, MarkdownContext, type ReactCatalogComponent} from '@a2ui/react';
import {injectStyles} from '@a2ui/react/styles';
import {renderMarkdown} from '@a2ui/markdown-it';
import {MessageProcessor, type SurfaceModel} from '@a2ui/web_core';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import '../styles.css';

type ToolResult = {content?: {type: string; text?: string}[]; structuredContent?: {messages?: unknown[]}; isError?: boolean};

// --- MCP Apps bridge (spec 2026-01-26) ---------------------------------------
let nextId = 1;
const pending = new Map<number, {resolve: (v: any) => void; reject: (e: Error) => void}>();
const post = (msg: object) => window.parent.postMessage({jsonrpc: '2.0', ...msg}, '*');
const request = <T,>(method: string, params: object = {}) =>
  new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {resolve, reject});
    post({id, method, params});
  });
const notify = (method: string, params: object = {}) => post({method, params});
let onToolResult: (r: ToolResult) => void = () => {};

window.addEventListener('message', e => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (m?.jsonrpc !== '2.0') return;
  if (m.id !== undefined && !m.method) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p?.reject(new Error(m.error.message)) : p?.resolve(m.result);
  } else if (m.method === 'ui/notifications/tool-result') {
    onToolResult(m.params);
  } else if (m.id !== undefined) {
    // Host requests we have nothing to do for (ping, ui/resource-teardown): acknowledge.
    post({id: m.id, result: {}});
  }
});

const textOf = (r: ToolResult) => r.content?.find(c => c.type === 'text')?.text ?? '';

function SceneApp() {
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactCatalogComponent>[]>([]);
  const [note, setNote] = useState('Loading the scene…');

  const processor = useMemo(() => {
    const p: MessageProcessor<ReactCatalogComponent> = new MessageProcessor<ReactCatalogComponent>([basicCatalog as never], undefined, {
      version: '1.0',
      unifiedOutbound: true,
      outboundListener: message => {
        if ('action' in message) void onAction(message.action as {name: string; context?: {scene?: Record<string, unknown>}});
      },
    });
    const show = (r: ToolResult) => {
      for (const id of Array.from(p.model.surfacesMap.keys())) p.model.deleteSurface(id);
      const messages = r.structuredContent?.messages;
      if (messages?.length) p.processMessages(messages as never);
      setNote(messages?.length ? '' : textOf(r) || 'No scene to show.');
    };
    const onAction = async (a: {name: string; context?: {scene?: Record<string, unknown>}}) => {
      if (a.name === 'cancel_scene') return show({content: [{type: 'text', text: 'Okay, nothing changed.'}]});
      if (a.name !== 'apply_scene') return;
      const s = a.context?.scene ?? {};
      const args = {brightness: s.brightness, color: (s.color as string[] | undefined)?.[0], tv: s.tv, blinds: s.blinds};
      setNote('Applying…');
      try {
        const r = await request<ToolResult>('tools/call', {name: 'apply_scene', arguments: JSON.parse(JSON.stringify(args))});
        show(r);
        // Let Claude know what happened, so a follow-up question has the answer. Not every host supports it.
        request('ui/update-model-context', {content: [{type: 'text', text: `The user pressed Apply in the scene card. ${textOf(r)}`}]}).catch(() => {});
      } catch (err) {
        setNote(`Could not apply the scene: ${(err as Error).message}`);
      }
    };
    onToolResult = show;
    return p;
  }, []);

  useEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    const a = processor.onSurfaceCreated(sync);
    const b = processor.onSurfaceDeleted(sync);
    return () => (a.unsubscribe(), b.unsubscribe());
  }, [processor]);

  return (
    <main className="mcp-app">
      {note && <div className="turn notice">{note}</div>}
      {surfaces.map(s => (
        <div key={s.id} className="surface">
          <A2uiSurface surface={s} />
        </div>
      ))}
    </main>
  );
}

injectStyles();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MarkdownContext.Provider value={renderMarkdown}>
      <SceneApp />
    </MarkdownContext.Provider>
  </StrictMode>,
);

// Handshake after the listener above is in place, then keep the host's iframe the size of the card.
await request('ui/initialize', {appCapabilities: {}, appInfo: {name: 'a2ui-scene', version: '0.1.0'}, protocolVersion: '2026-01-26'});
notify('ui/notifications/initialized');
// Measure the body, not the document: the document is never smaller than the iframe, so it could only grow.
new ResizeObserver(() => {
  const {width, height} = document.body.getBoundingClientRect();
  notify('ui/notifications/size-changed', {width: Math.ceil(width), height: Math.ceil(height)});
}).observe(document.body);
