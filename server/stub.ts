// Canned replies used when no ANTHROPIC_API_KEY is set.
// They are written in A2UI Express, exactly as the model would write them,
// and go through the same streaming parser and validation as a live reply.

import type {ApplyResult} from './home.js';

export interface SceneCard {
  name?: string;
  brightness?: number;
  color?: 'warm' | 'neutral' | 'cool';
  tv?: boolean;
  blinds?: boolean;
}
const MOVIE_NIGHT: Required<SceneCard> = {name: 'Movie night', brightness: 20, color: 'warm', tv: true, blinds: true};

export const STUB_NOTICE = '(Stub mode: no model was called. Set ANTHROPIC_API_KEY to use Claude.)';

// Also the MCP App's scene card, filled with the values Claude suggests.
export function stubSceneReply(scene: SceneCard = MOVIE_NIGHT): string {
  const {name, brightness, color, tv, blinds} = {...MOVIE_NIGHT, ...scene};
  const values = JSON.stringify({name, room: 'living room', brightness, color: [color], tv, blinds});
  return `Here's a ${name.toLowerCase()} scene for the living room. Tweak it, then press Apply.
<a2ui>
surface("scene")
$/scene = ${values}
root = Card(body)
body = Column([title, hint, dim, color, tvBox, blindsBox, actions])
title = Text(${JSON.stringify(`**${name}**`)})
hint = Text("Living room. Nothing changes until you press Apply.", "caption")
dim = Slider("Brightness", 0, 100, $/scene/brightness)
color = ChoicePicker("Light color", "mutuallyExclusive", [{label: "Warm", value: "warm"}, {label: "Neutral", value: "neutral"}, {label: "Cool", value: "cool"}], $/scene/color, "chips")
tvBox = CheckBox("Turn on the TV", $/scene/tv)
blindsBox = CheckBox("Close the blinds", $/scene/blinds)
actions = Row([cancel, apply], "end")
cancel = Button(cancelLabel, "borderless", Event("cancel_scene"))
cancelLabel = Text("Cancel")
apply = Button(applyLabel, "primary", Event("apply_scene", {scene: $/scene}))
applyLabel = Text("Apply scene")
</a2ui>`;
}

export function stubAppliedReply(result: ApplyResult): string {
  const items = result.changes.map(c => JSON.stringify(c)).join(', ');
  const all = result.ok && !result.changes.some(c => c.includes(': skipped'));
  return `${all ? 'Done. Your scene is on.' : 'Some of it did not go through, see below.'}
<a2ui>
surface("result")
$/changes = [${items}]
root = Card(body)
body = Column([title, list])
title = Text("**${all ? 'Scene applied' : 'Scene partly applied'}** in the ${result.room}")
list = List(_template($/changes, item))
item = Text($)
</a2ui>`;
}

export function stubCancelledReply(): string {
  return 'Okay, nothing changed.';
}

export function chunk(text: string, size = 80): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
