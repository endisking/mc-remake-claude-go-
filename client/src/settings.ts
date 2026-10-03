/** Player options (vanilla Options equivalents), persisted to localStorage. */
export interface Settings {
  renderDistance: number;
  simulationDistance: number;
  entityDistance: number;
  fov: number;
  gamma: number;
  guiScale: number;
  viewBobbing: boolean;
  graphics: 'fast' | 'fancy';
  smoothLighting: boolean;
  clouds: 'off' | 'fast' | 'fancy';
  particles: 'all' | 'decreased' | 'minimal';
  mipmapLevels: number;
  maxFps: number; // 0 = unlimited, -1 = vsync
  biomeBlend: number;
  mouseSensitivity: number;
  caveCulling: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 8,
  simulationDistance: 8,
  entityDistance: 1,
  fov: 70,
  gamma: 0.5,
  guiScale: 0,
  viewBobbing: true,
  graphics: 'fancy',
  smoothLighting: true,
  clouds: 'fancy',
  particles: 'all',
  mipmapLevels: 4,
  maxFps: -1,
  biomeBlend: 2,
  mouseSensitivity: 0.5,
  caveCulling: true,
};

const KEY = 'blockcraft.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Apply URL query overrides (?rd=12&fov=90&smooth=0), used by tests and the benchmark. */
export function applyQueryOverrides(s: Settings, q: URLSearchParams): Settings {
  const n = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const out = { ...s };
  if (n('rd') !== undefined) out.renderDistance = n('rd')!;
  if (n('fov') !== undefined) out.fov = n('fov')!;
  if (q.has('smooth')) out.smoothLighting = q.get('smooth') !== '0';
  if (q.has('graphics')) out.graphics = q.get('graphics') === 'fast' ? 'fast' : 'fancy';
  if (n('fps') !== undefined) out.maxFps = n('fps')!;
  if (q.has('cave')) out.caveCulling = q.get('cave') !== '0';
  return out;
}
