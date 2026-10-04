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
  /** Max Framerate: 10–250, 0 = unlimited (legacy -1 = vsync, migrated on load) */
  maxFps: number;
  /** Use VSync (the browser always presents on vsync; this caps rendering to rAF) */
  vsync: boolean;
  biomeBlend: number;
  mouseSensitivity: number;
  caveCulling: boolean;
  /** key mapping id → key code (only changed bindings are stored) */
  keys: Record<string, string>;
  toggleCrouch: boolean;
  toggleSprint: boolean;
  autoJump: boolean;
  invertYMouse: boolean;
  mouseWheelSensitivity: number;
  discreteMouseScroll: boolean;
  fovEffectScale: number;
  /** sound category volumes 0..1 */
  volumes: Record<string, number>;
  /** F3+P: open the pause menu when the window loses focus */
  pauseOnLostFocus: boolean;
  /** F3+H: item ids and durability in tooltips */
  advancedItemTooltips: boolean;
  // Chat Settings (vanilla Options chat*)
  chatVisibility: 'shown' | 'commands' | 'hidden';
  chatColors: boolean;
  chatLinks: boolean;
  chatLinksPrompt: boolean;
  chatOpacity: number;
  textBackgroundOpacity: number;
  chatScale: number;
  chatLineSpacing: number;
  /** seconds */
  chatDelay: number;
  /** 0..1 → floor(v*280+40) px */
  chatWidth: number;
  /** 0..1 → floor(v*160+20) px */
  chatHeightFocused: number;
  chatHeightUnfocused: number;
  autoSuggestions: boolean;
  hideMatchedNames: boolean;
  reducedDebugInfo: boolean;
  // Skin Customization
  modelParts: { cape: boolean; jacket: boolean; left_sleeve: boolean; right_sleeve: boolean; left_pants_leg: boolean; right_pants_leg: boolean; hat: boolean };
  mainHand: 'right' | 'left';
  /** '' = default for your name, a bundled skin name, or a custom skin as a PNG data URL */
  skin: string;
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
  maxFps: 0,
  vsync: true,
  biomeBlend: 2,
  mouseSensitivity: 0.5,
  caveCulling: true,
  keys: {},
  toggleCrouch: false,
  toggleSprint: false,
  autoJump: false,
  invertYMouse: false,
  mouseWheelSensitivity: 1,
  discreteMouseScroll: false,
  fovEffectScale: 1,
  volumes: {},
  pauseOnLostFocus: true,
  advancedItemTooltips: false,
  chatVisibility: 'shown',
  chatColors: true,
  chatLinks: true,
  chatLinksPrompt: true,
  chatOpacity: 1,
  textBackgroundOpacity: 0.5,
  chatScale: 1,
  chatLineSpacing: 0,
  chatDelay: 0,
  chatWidth: 1,
  chatHeightFocused: 1,
  chatHeightUnfocused: 0.44366196,
  autoSuggestions: true,
  hideMatchedNames: true,
  reducedDebugInfo: false,
  modelParts: { cape: true, jacket: true, left_sleeve: true, right_sleeve: true, left_pants_leg: true, right_pants_leg: true, hat: true },
  mainHand: 'right',
  skin: '',
};

const KEY = 'blockcraft.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
      // older saves: maxFps -1 meant VSync
      if (s.maxFps < 0) {
        s.maxFps = 0;
        s.vsync = true;
      }
      return { ...s, keys: { ...s.keys }, volumes: { ...s.volumes }, modelParts: { ...DEFAULT_SETTINGS.modelParts, ...s.modelParts } };
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS, keys: {}, volumes: {}, modelParts: { ...DEFAULT_SETTINGS.modelParts } };
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
  if (n('fps') !== undefined) {
    // ?fps=-1: VSync (the old encoding); ?fps=0: unlimited
    out.maxFps = Math.max(0, n('fps')!);
    out.vsync = n('fps')! < 0;
  }
  if (q.has('cave')) out.caveCulling = q.get('cave') !== '0';
  return out;
}
