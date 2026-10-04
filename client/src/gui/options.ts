/**
 * Vanilla OptionsList-style screens: two columns of option buttons/sliders in a scrolling list
 * (itemHeight 25, between the title band and the Done button), used by Video Settings, Chat
 * Settings and Skin Customization.
 */
import { Button, Screen, Slider, type Widget } from './screen';
import { toggleFullscreen } from '../fullscreen';
import type { ScreenHost } from './screens';

export type Opt =
  | { kind: 'cycle'; label: string; get: () => string; next: () => void; reload?: boolean; active?: () => boolean }
  | {
      kind: 'slider';
      label: string;
      min: number;
      max: number;
      step: number;
      get: () => number;
      set: (v: number) => void;
      fmt?: (v: number) => string;
      reload?: boolean;
    }
  | { kind: 'button'; label: string; press: () => void; active?: () => boolean };

export abstract class OptionsListScreen extends Screen {
  private scroll = 0;
  private rows: Widget[] = [];
  private done!: Button;
  protected readonly top = 32;

  constructor(protected host: ScreenHost, protected parent: Screen | null, title: string) {
    super(host.gui, title);
  }

  protected abstract options(): Opt[];
  /** Extra text drawn by subclasses (e.g. a skin preview) */
  protected renderExtra(_mx: number, _my: number): void {}

  private bottom(): number {
    return this.gui.height - 32;
  }

  init(): void {
    const cx = Math.floor(this.gui.width / 2);
    this.rows = [];
    for (const o of this.options()) {
      let w: Widget;
      if (o.kind === 'cycle') {
        const b = new Button(0, 0, 150, 20, `${o.label}: ${o.get()}`, () => {
          o.next();
          b.label = `${o.label}: ${o.get()}`;
          this.host.applySettings(!!o.reload);
        });
        if (o.active) b.active = o.active();
        w = b;
      } else if (o.kind === 'button') {
        const b = new Button(0, 0, 150, 20, o.label, () => o.press());
        if (o.active) b.active = o.active();
        w = b;
      } else {
        const toV = (n: number) => (n - o.min) / (o.max - o.min);
        const fromV = (v: number) => Math.min(o.max, Math.max(o.min, Math.round((o.min + v * (o.max - o.min)) / o.step) * o.step));
        w = new Slider(0, 0, 150, 20, toV(o.get()), (v) => `${o.label}: ${(o.fmt ?? String)(fromV(v))}`, (v) => {
          const n = fromV(v);
          if (n !== o.get()) {
            o.set(n);
            this.host.applySettings(!!o.reload);
          }
        });
      }
      this.rows.push(w);
    }
    this.done = new Button(cx - 100, this.gui.height - 27, 200, 20, 'Done', () => this.host.setScreen(this.parent));
    this.widgets = [...this.rows, this.done];
    this.layout();
  }

  private contentHeight(): number {
    return Math.ceil(this.rows.length / 2) * 25 + 4;
  }

  private layout(): void {
    const max = Math.max(0, this.contentHeight() - (this.bottom() - this.top - 4));
    this.scroll = Math.max(0, Math.min(max, this.scroll));
    const cx = Math.floor(this.gui.width / 2);
    this.rows.forEach((w, i) => {
      w.x = i % 2 === 0 ? cx - 155 : cx + 5;
      w.y = this.top + 4 + Math.floor(i / 2) * 25 - this.scroll;
      // only rows fully inside the list take clicks
      w.visible = w.y >= this.top && w.y + w.h <= this.bottom();
    });
  }

  override mouseScrolled(_mx: number, _my: number, delta: number): void {
    this.scroll += delta * 25 / 2;
    this.layout();
  }

  override render(mx: number, my: number): void {
    const g = this.gui;
    this.renderBackground();
    this.layout();
    g.fill(0, this.top, g.width, this.bottom() - this.top, 0x60000000);
    g.ctx.save();
    g.ctx.beginPath();
    g.ctx.rect(0, this.top, g.width, this.bottom() - this.top);
    g.ctx.clip();
    // partially visible rows are drawn (clipped) but not clickable
    for (const w of this.rows) {
      if (w.y + w.h <= this.top || w.y >= this.bottom()) continue;
      const vis = w.visible;
      w.visible = true;
      w.render(g, w.contains(mx, my) && my >= this.top && my < this.bottom() ? mx : -1, my);
      w.visible = vis;
    }
    g.ctx.restore();
    // scroll bar (AbstractSelectionList.renderScrollBar) when the list overflows
    const content = this.contentHeight(), view = this.bottom() - this.top;
    if (content > view - 4) {
      const x = Math.floor(g.width / 2) + 124 + 40;
      const barH = Math.max(32, Math.floor((view * view) / content));
      const max = content - (view - 4);
      const y = this.top + Math.floor(((view - barH) * this.scroll) / Math.max(1, max));
      g.fill(x, this.top, 6, view, 0xff000000);
      g.fill(x, y, 6, barH, 0xff808080);
      g.fill(x, y, 5, barH - 1, 0xffc0c0c0);
    }
    this.done.render(g, mx, my);
    g.centeredText(this.title, g.width / 2, 15);
    this.renderExtra(mx, my);
  }

  override renderBackground(): void {
    this.gui.worldBackground();
  }

  override keyDown(code: string): boolean {
    if (code === 'Escape') {
      this.host.setScreen(this.parent);
      return true;
    }
    return false;
  }
}

const onOff = (b: boolean) => (b ? 'ON' : 'OFF');
const pct = (v: number) => `${Math.round(v)}%`;

/** Vanilla 1.17 VideoSettingsScreen options (plus simulation distance and cave culling). */
export class VideoSettingsScreen extends OptionsListScreen {
  constructor(host: ScreenHost, parent: Screen | null) {
    super(host, parent, 'Video Settings');
  }
  protected options(): Opt[] {
    const s = this.host.settings;
    const cyc = <T>(list: readonly T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length]!;
    return [
      { kind: 'cycle', label: 'Graphics', get: () => (s.graphics === 'fancy' ? 'Fancy' : 'Fast'), next: () => (s.graphics = cyc(['fast', 'fancy'] as const, s.graphics)), reload: true },
      { kind: 'slider', label: 'Render Distance', min: 2, max: 32, step: 1, get: () => s.renderDistance, set: (v) => (s.renderDistance = v), fmt: (v) => `${v} chunks` },
      { kind: 'cycle', label: 'Smooth Lighting', get: () => (s.smoothLighting ? 'Maximum' : 'OFF'), next: () => (s.smoothLighting = !s.smoothLighting), reload: true },
      { kind: 'slider', label: 'Simulation Distance', min: 5, max: 32, step: 1, get: () => s.simulationDistance, set: (v) => (s.simulationDistance = v), fmt: (v) => `${v} chunks` },
      // Option.FRAMERATE_LIMIT: 10–260 in steps of 10, 260 = Unlimited
      { kind: 'slider', label: 'Max Framerate', min: 10, max: 260, step: 10, get: () => (s.maxFps <= 0 ? 260 : s.maxFps), set: (v) => (s.maxFps = v >= 260 ? 0 : v), fmt: (v) => (v >= 260 ? 'Unlimited' : `${v} fps`) },
      { kind: 'cycle', label: 'Use VSync', get: () => onOff(s.vsync), next: () => (s.vsync = !s.vsync) },
      { kind: 'cycle', label: 'View Bobbing', get: () => onOff(s.viewBobbing), next: () => (s.viewBobbing = !s.viewBobbing) },
      { kind: 'slider', label: 'GUI Scale', min: 0, max: 6, step: 1, get: () => s.guiScale, set: (v) => (s.guiScale = v), fmt: (v) => (v === 0 ? 'Auto' : `${v}`) },
      { kind: 'slider', label: 'Brightness', min: 0, max: 100, step: 1, get: () => Math.round(s.gamma * 100), set: (v) => (s.gamma = v / 100), fmt: (v) => (v === 0 ? 'Moody' : v === 100 ? 'Bright' : `+${v}%`) },
      { kind: 'cycle', label: 'Clouds', get: () => ({ off: 'OFF', fast: 'Fast', fancy: 'Fancy' })[s.clouds], next: () => (s.clouds = cyc(['fancy', 'fast', 'off'] as const, s.clouds)) },
      {
        kind: 'cycle', label: 'Fullscreen', get: () => onOff(!!document.fullscreenElement), next: () => {
          toggleFullscreen();
        },
      },
      { kind: 'cycle', label: 'Particles', get: () => ({ all: 'All', decreased: 'Decreased', minimal: 'Minimal' })[s.particles], next: () => (s.particles = cyc(['all', 'decreased', 'minimal'] as const, s.particles)) },
      { kind: 'slider', label: 'Mipmap Levels', min: 0, max: 4, step: 1, get: () => s.mipmapLevels, set: (v) => (s.mipmapLevels = v), fmt: (v) => (v === 0 ? 'OFF' : `${v}`), reload: true },
      { kind: 'slider', label: 'Entity Distance', min: 50, max: 500, step: 25, get: () => Math.round(s.entityDistance * 100), set: (v) => (s.entityDistance = v / 100), fmt: pct },
      { kind: 'slider', label: 'FOV Effects', min: 0, max: 100, step: 1, get: () => Math.round(s.fovEffectScale * 100), set: (v) => (s.fovEffectScale = v / 100), fmt: (v) => (v === 0 ? 'OFF' : pct(v)) },
      { kind: 'slider', label: 'Biome Blend', min: 0, max: 7, step: 1, get: () => s.biomeBlend, set: (v) => (s.biomeBlend = v), fmt: (v) => (v === 0 ? 'OFF' : `${v * 2 + 1}x${v * 2 + 1}`), reload: true },
      { kind: 'cycle', label: 'Cave Culling', get: () => onOff(s.caveCulling), next: () => (s.caveCulling = !s.caveCulling) },
      // not in vanilla: fewer pixels to fill on low-end GPUs (school Chromebooks)
      { kind: 'slider', label: 'Render Resolution', min: 25, max: 100, step: 5, get: () => Math.round(s.renderScale * 100), set: (v) => (s.renderScale = v / 100), fmt: pct },
    ];
  }
}

/** Vanilla ChatOptionsScreen. */
export class ChatOptionsScreen extends OptionsListScreen {
  constructor(host: ScreenHost, parent: Screen | null) {
    super(host, parent, 'Chat Settings');
  }
  protected options(): Opt[] {
    const s = this.host.settings;
    const VIS = { shown: 'Shown', commands: 'Commands Only', hidden: 'Hidden' } as const;
    const order = ['shown', 'commands', 'hidden'] as const;
    // ChatComponent.getWidth/getHeight pixel values shown on the sliders
    const px = (v: number) => `${v}px`;
    return [
      { kind: 'cycle', label: 'Chat', get: () => VIS[s.chatVisibility], next: () => (s.chatVisibility = order[(order.indexOf(s.chatVisibility) + 1) % 3]!) },
      { kind: 'cycle', label: 'Colors', get: () => onOff(s.chatColors), next: () => (s.chatColors = !s.chatColors) },
      { kind: 'cycle', label: 'Web Links', get: () => onOff(s.chatLinks), next: () => (s.chatLinks = !s.chatLinks) },
      { kind: 'cycle', label: 'Prompt on Links', get: () => onOff(s.chatLinksPrompt), next: () => (s.chatLinksPrompt = !s.chatLinksPrompt) },
      { kind: 'slider', label: 'Chat Text Opacity', min: 0, max: 100, step: 1, get: () => Math.round(s.chatOpacity * 100), set: (v) => (s.chatOpacity = v / 100), fmt: pct },
      { kind: 'slider', label: 'Text Background Opacity', min: 0, max: 100, step: 1, get: () => Math.round(s.textBackgroundOpacity * 100), set: (v) => (s.textBackgroundOpacity = v / 100), fmt: pct },
      { kind: 'slider', label: 'Text Size', min: 0, max: 100, step: 1, get: () => Math.round(s.chatScale * 100), set: (v) => (s.chatScale = v / 100), fmt: (v) => (v === 0 ? 'OFF' : pct(v)) },
      { kind: 'slider', label: 'Line Spacing', min: 0, max: 100, step: 1, get: () => Math.round(s.chatLineSpacing * 100), set: (v) => (s.chatLineSpacing = v / 100), fmt: pct },
      { kind: 'slider', label: 'Chat Delay', min: 0, max: 60, step: 1, get: () => Math.round(s.chatDelay * 10), set: (v) => (s.chatDelay = v / 10), fmt: (v) => (v === 0 ? 'None' : `${(v / 10).toFixed(1)} seconds`) },
      { kind: 'slider', label: 'Width', min: 40, max: 320, step: 1, get: () => Math.floor(s.chatWidth * 280 + 40), set: (v) => (s.chatWidth = (v - 40) / 280), fmt: px },
      { kind: 'slider', label: 'Focused Height', min: 20, max: 180, step: 1, get: () => Math.floor(s.chatHeightFocused * 160 + 20), set: (v) => (s.chatHeightFocused = (v - 20) / 160), fmt: px },
      { kind: 'slider', label: 'Unfocused Height', min: 20, max: 180, step: 1, get: () => Math.floor(s.chatHeightUnfocused * 160 + 20), set: (v) => (s.chatHeightUnfocused = (v - 20) / 160), fmt: px },
      // no text-to-speech narrator: shown disabled like vanilla when the narrator is unavailable
      { kind: 'cycle', label: 'Narrator', get: () => 'OFF', next: () => {}, active: () => false },
      { kind: 'cycle', label: 'Command Suggestions', get: () => onOff(s.autoSuggestions), next: () => (s.autoSuggestions = !s.autoSuggestions) },
      { kind: 'cycle', label: 'Hide Matched Names', get: () => onOff(s.hideMatchedNames), next: () => (s.hideMatchedNames = !s.hideMatchedNames) },
      { kind: 'cycle', label: 'Reduced Debug Info', get: () => onOff(s.reducedDebugInfo), next: () => (s.reducedDebugInfo = !s.reducedDebugInfo) },
    ];
  }
}

/** Vanilla SkinCustomizationScreen, plus choosing a bundled skin or uploading your own (64×64 PNG). */
export class SkinCustomizationScreen extends OptionsListScreen {
  constructor(host: ScreenHost & { defaultSkins?: () => string[] }, parent: Screen | null) {
    super(host, parent, 'Skin Customization');
  }
  private message = '';
  protected options(): Opt[] {
    const s = this.host.settings;
    const parts: [keyof typeof s.modelParts, string][] = [
      ['cape', 'Cape'], ['jacket', 'Jacket'], ['left_sleeve', 'Left Sleeve'], ['right_sleeve', 'Right Sleeve'],
      ['left_pants_leg', 'Left Pants Leg'], ['right_pants_leg', 'Right Pants Leg'], ['hat', 'Hat'],
    ];
    const skins = (this.host as { defaultSkins?: () => string[] }).defaultSkins?.() ?? [];
    const skinLabel = () => (s.skin.startsWith('data:') ? 'Custom' : s.skin || 'Default');
    const opts: Opt[] = parts.map(([k, label]) => ({ kind: 'cycle', label, get: () => onOff(s.modelParts[k]), next: () => (s.modelParts[k] = !s.modelParts[k]) }) as Opt);
    opts.push({ kind: 'cycle', label: 'Main Hand', get: () => (s.mainHand === 'right' ? 'Right' : 'Left'), next: () => (s.mainHand = s.mainHand === 'right' ? 'left' : 'right') });
    opts.push({
      kind: 'cycle', label: 'Skin', get: skinLabel, next: () => {
        // Default (from your name) → each bundled skin → back to Default
        const list = ['', ...skins];
        const i = list.indexOf(s.skin.startsWith('data:') ? '' : s.skin);
        s.skin = list[(i + 1) % list.length]!;
        this.message = 'Applies the next time you join a world';
      },
    });
    opts.push({ kind: 'button', label: 'Upload Skin...', press: () => this.upload() });
    return opts;
  }

  /** Pick a 64×64 (or legacy 64×32) PNG skin; it is sent to the server as a data URL when joining. */
  private upload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void readSkinFile(file).then(
        (url) => {
          this.host.settings.skin = url;
          this.host.applySettings(false);
          this.message = 'Skin uploaded: applies the next time you join a world';
          this.init();
        },
        (e: Error) => (this.message = `§c${e.message}`),
      );
    };
    input.click();
  }

  protected override renderExtra(): void {
    if (this.message) this.gui.centeredText(this.message, this.gui.width / 2, this.gui.height - 42, 0xa0a0a0);
  }
}

/** Largest custom skin accepted (data URL characters); 64×64 PNGs are usually 1–5 KB. */
export const MAX_SKIN_URL = 24000;

export async function readSkinFile(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('Not a PNG image');
  });
  if (bmp.width !== 64 || (bmp.height !== 64 && bmp.height !== 32)) throw new Error('Skins must be 64×64 (or 64×32) pixels');
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
  if (!url.startsWith('data:image/png;base64,')) throw new Error('Not a PNG image');
  if (url.length > MAX_SKIN_URL) throw new Error('Skin file too large');
  return url;
}
