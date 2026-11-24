import {FormEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react';
import {MessageProcessor, type SurfaceModel} from '@a2ui/web_core';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';

type Turn = {role: 'user' | 'assistant' | 'notice' | 'error'; text: string};
type Outbound = {text?: string; action?: {name: string; surfaceId?: string; context?: unknown}};

const SUGGESTIONS = ['Set up movie night', 'Make the living room cozy', 'Bright light for cleaning'];

export function App() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactCatalogComponent>[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<string>('');
  const sessionId = useRef<string | undefined>(undefined);
  const sendRef = useRef<(msg: Outbound) => void>(() => {});

  // One processor for the page. Actions the user takes inside a surface
  // (button presses) come out of outboundListener and go back to the agent.
  const processor = useMemo(
    () =>
      new MessageProcessor<ReactCatalogComponent>([basicCatalog as never], undefined, {
        version: '1.0',
        unifiedOutbound: true,
        outboundListener: message => {
          if ('action' in message) {
            const a = message.action as {name: string; surfaceId?: string; context?: unknown};
            sendRef.current({action: {name: a.name, surfaceId: a.surfaceId, context: a.context}});
          }
        },
      }),
    [],
  );

  useEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    const a = processor.onSurfaceCreated(sync);
    const b = processor.onSurfaceDeleted(sync);
    return () => {
      a.unsubscribe();
      b.unsubscribe();
    };
  }, [processor]);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(h =>
        setMode(
          `${h.mode === 'stub' ? 'Stub mode (no API key)' : `Claude · ${h.model}`} · ${h.devices === 'home-assistant' ? 'Home Assistant' : 'simulated devices'}`,
        ),
      )
      .catch(() => setMode('Agent offline'));
  }, []);

  const send = useCallback(
    async (msg: Outbound) => {
      if (busy) return;
      setBusy(true);
      if (msg.text) setTurns(t => [...t, {role: 'user', text: msg.text!}]);
      if (msg.action) setTurns(t => [...t, {role: 'user', text: `▸ ${msg.action!.name.replace('_', ' ')}`}]);

      // Chat mode: each answer brings its own UI, so clear the previous one.
      for (const id of Array.from(processor.model.surfacesMap.keys())) processor.model.deleteSurface(id);

      let assistant = '';
      setTurns(t => [...t, {role: 'assistant', text: ''}]);
      const setAssistant = (text: string) =>
        setTurns(t => {
          const copy = [...t];
          for (let i = copy.length - 1; i >= 0; i--) if (copy[i].role === 'assistant') return (copy[i] = {role: 'assistant', text}), copy;
          return copy;
        });

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({sessionId: sessionId.current, ...msg}),
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, {stream: true});
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const part = JSON.parse(line);
            if (part.type === 'session') sessionId.current = part.sessionId;
            else if (part.type === 'text') setAssistant((assistant += part.text));
            else if (part.type === 'a2ui') processor.processMessages(part.messages);
            else if (part.type === 'notice') setTurns(t => [...t.slice(0, -1), {role: 'notice', text: part.text}, t[t.length - 1]]);
            else if (part.type === 'error') setTurns(t => [...t, {role: 'error', text: part.message}]);
          }
        }
      } catch (err) {
        setTurns(t => [...t, {role: 'error', text: String(err)}]);
      } finally {
        setTurns(t => t.filter(x => !(x.role === 'assistant' && !x.text.trim())));
        setBusy(false);
      }
    },
    [busy, processor],
  );
  sendRef.current = send;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    void send({text});
  };

  return (
    <div className="page">
      <header>
        <h1>Claude × A2UI</h1>
        <p>The agent answers with real UI, not paragraphs.</p>
        <span className="mode">{mode}</span>
      </header>

      <main>
        {turns.length === 0 && (
          <div className="empty">
            <p>Ask the home agent something.</p>
            <div className="chips">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => void send({text: s})} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`turn ${t.role}`}>
            {t.text}
          </div>
        ))}
        {surfaces.map(s => (
          <div key={s.id} className="surface">
            <A2uiSurface surface={s} />
          </div>
        ))}
        {busy && <div className="turn typing">…</div>}
      </main>

      <form onSubmit={submit}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. set up movie night" disabled={busy} />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
