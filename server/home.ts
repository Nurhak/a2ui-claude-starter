// A tiny simulated home. Swap applyScene() for a real call
// (Home Assistant, Hue, Matter, ...) to drive actual devices.

export interface Scene {
  name?: string;
  room?: string;
  brightness?: number;
  color?: string[];
  tv?: boolean;
  blinds?: boolean;
}

export interface ApplyResult {
  ok: boolean;
  appliedAt: string;
  room: string;
  changes: string[];
}

const state = {
  living: {brightness: 80, color: 'neutral', tv: false, blinds: false},
};

export function applyScene(scene: Scene): ApplyResult {
  const room = scene.room ?? 'living room';
  const changes: string[] = [];

  if (typeof scene.brightness === 'number') {
    const b = Math.max(0, Math.min(100, Math.round(scene.brightness)));
    state.living.brightness = b;
    changes.push(b === 0 ? 'Lights off' : `Lights at ${b}%`);
  }
  const color = scene.color?.[0];
  if (color) {
    state.living.color = color;
    changes.push(`${color[0].toUpperCase()}${color.slice(1)} light`);
  }
  if (typeof scene.tv === 'boolean') {
    state.living.tv = scene.tv;
    changes.push(scene.tv ? 'TV on' : 'TV off');
  }
  if (typeof scene.blinds === 'boolean') {
    state.living.blinds = scene.blinds;
    changes.push(scene.blinds ? 'Blinds closed' : 'Blinds open');
  }

  return {ok: true, appliedAt: new Date().toISOString(), room, changes};
}

export function homeSnapshot() {
  return structuredClone(state);
}
