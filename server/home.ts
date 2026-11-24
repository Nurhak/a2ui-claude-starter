// Where an applied scene goes: Home Assistant when HA_URL and HA_TOKEN are set,
// otherwise a tiny simulated home. Only this file touches devices.

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
  target: 'home-assistant' | 'simulated';
  changes: string[];
}

const KELVIN: Record<string, number> = {warm: 2700, neutral: 4000, cool: 6500};

const state = {
  living: {brightness: 80, color: 'neutral', tv: false, blinds: false},
};

// Read on every call, so a changed .env (or a test) takes effect without a restart.
export function haConfig() {
  const url = process.env.HA_URL?.trim().replace(/\/+$/, '');
  const token = process.env.HA_TOKEN?.trim();
  if (!url || !token) return null;
  return {url, token, light: process.env.HA_LIGHT, tv: process.env.HA_TV, blinds: process.env.HA_BLINDS};
}

interface Step {
  labels: string[];
  envName: string;
  entity: string | undefined;
  domain: string;
  service: string;
  data?: Record<string, unknown>;
}

export async function applyScene(scene: Scene): Promise<ApplyResult> {
  const room = scene.room ?? 'living room';
  // The scene comes from the browser: keep only values we understand.
  const brightness =
    typeof scene.brightness === 'number' && Number.isFinite(scene.brightness)
      ? Math.max(0, Math.min(100, Math.round(scene.brightness)))
      : undefined;
  const color = scene.color?.[0] && scene.color[0] in KELVIN ? scene.color[0] : undefined;
  const tv = typeof scene.tv === 'boolean' ? scene.tv : undefined;
  const blinds = typeof scene.blinds === 'boolean' ? scene.blinds : undefined;

  const lightLabels = [
    ...(brightness === undefined ? [] : [brightness === 0 ? 'Lights off' : `Lights at ${brightness}%`]),
    ...(color ? [`${color[0].toUpperCase()}${color.slice(1)} light`] : []),
  ];
  const tvLabel = tv === undefined ? undefined : tv ? 'TV on' : 'TV off';
  const blindsLabel = blinds === undefined ? undefined : blinds ? 'Blinds closed' : 'Blinds open';
  const appliedAt = () => new Date().toISOString();

  const ha = haConfig();
  if (!ha) {
    const s = state.living;
    if (brightness !== undefined) s.brightness = brightness;
    if (color) s.color = color;
    if (tv !== undefined) s.tv = tv;
    if (blinds !== undefined) s.blinds = blinds;
    const changes = [...lightLabels, tvLabel, blindsLabel].filter((c): c is string => !!c);
    return {ok: true, appliedAt: appliedAt(), room, target: 'simulated', changes};
  }

  const steps: Step[] = [];
  if (lightLabels.length) {
    const on = brightness !== 0;
    const data = on
      ? {
          ...(brightness !== undefined && {brightness_pct: brightness}),
          ...(color && {color_temp_kelvin: KELVIN[color]}),
        }
      : undefined;
    steps.push({labels: on ? lightLabels : ['Lights off'], envName: 'HA_LIGHT', entity: ha.light, domain: 'light', service: on ? 'turn_on' : 'turn_off', data});
  }
  if (tvLabel) {
    // A TV can be a media_player, switch or remote: use the entity's own domain.
    const domain = ha.tv?.split('.')[0] ?? 'media_player';
    steps.push({labels: [tvLabel], envName: 'HA_TV', entity: ha.tv, domain, service: tv ? 'turn_on' : 'turn_off'});
  }
  if (blindsLabel) {
    steps.push({labels: [blindsLabel], envName: 'HA_BLINDS', entity: ha.blinds, domain: 'cover', service: blinds ? 'close_cover' : 'open_cover'});
  }

  const changes: string[] = [];
  let ok = true;
  for (const step of steps) {
    const what = step.labels.join(', ');
    if (!step.entity) {
      changes.push(`${what}: skipped, ${step.envName} is not set`);
      continue;
    }
    try {
      const res = await fetch(`${ha.url}/api/services/${step.domain}/${step.service}`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${ha.token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({entity_id: step.entity, ...step.data}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      changes.push(...step.labels);
    } catch (err) {
      ok = false;
      changes.push(`${what}: failed (${(err as Error).message})`);
    }
  }
  return {ok, appliedAt: appliedAt(), room, target: 'home-assistant', changes};
}

export function homeSnapshot() {
  return structuredClone(state);
}
