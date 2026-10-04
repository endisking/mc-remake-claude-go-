/** Pause menu, Options and Video Settings screens. */
import { Button, Screen, Slider } from './screen';
import type { Gui } from './gui';
import type { Settings } from '../settings';
import { ControlsScreen, SoundOptionsScreen, AccessibilityScreen } from './controls';

export interface ScreenHost {
  gui: Gui;
  settings: Settings;
  setScreen(s: Screen | null): void;
  /** Apply and persist settings; `reloadChunks` when meshing options changed. */
  applySettings(reloadChunks: boolean): void;
  quitToTitle(): void;
}

export class PauseScreen extends Screen {
  constructor(private host: ScreenHost) {
    super(host.gui, 'Game Menu');
  }
  init(): void {
    const cx = Math.floor(this.gui.width / 2), y = Math.floor(this.gui.height / 4) + 8;
    this.widgets = [
      new Button(cx - 102, y + 24 - 16, 204, 20, 'Back to Game', () => this.host.setScreen(null)),
      new Button(cx - 102, y + 48 - 16, 98, 20, 'Advancements', () => {}),
      new Button(cx + 4, y + 48 - 16, 98, 20, 'Statistics', () => {}),
      new Button(cx - 102, y + 72 - 16, 98, 20, 'Give Feedback', () => {}),
      new Button(cx + 4, y + 72 - 16, 98, 20, 'Report Bugs', () => {}),
      new Button(cx - 102, y + 96 - 16, 98, 20, 'Options...', () => this.host.setScreen(new OptionsScreen(this.host, this))),
      new Button(cx + 4, y + 96 - 16, 98, 20, 'Open to LAN', () => {}),
      new Button(cx - 102, y + 120 - 16, 204, 20, 'Save and Quit to Title', () => this.host.quitToTitle()),
    ];
    // not yet implemented screens are shown disabled rather than doing nothing
    for (const i of [1, 2, 3, 4, 6]) this.widgets[i]!.active = false;
  }
  override render(mx: number, my: number): void {
    super.render(mx, my);
    this.gui.centeredText(this.title, this.gui.width / 2, 40);
  }
  override keyDown(code: string): boolean {
    if (code === 'Escape') {
      this.host.setScreen(null);
      return true;
    }
    return false;
  }
}

export class OptionsScreen extends Screen {
  constructor(private host: ScreenHost, private parent: Screen | null) {
    super(host.gui, 'Options');
  }
  init(): void {
    const s = this.host.settings;
    const cx = Math.floor(this.gui.width / 2), y0 = Math.floor(this.gui.height / 6);
    const DIFF = ['Peaceful', 'Easy', 'Normal', 'Hard'];
    const h = this.host as ScreenHost & { difficulty: number; send(p: unknown): void };
    this.widgets = [
      new Slider(cx - 155, y0 - 12, 150, 20, (s.fov - 30) / 80, (v) => `FOV: ${Math.round(30 + v * 80) === 70 ? 'Normal' : Math.round(30 + v * 80) === 110 ? 'Quake Pro' : Math.round(30 + v * 80)}`, (v) => {
        s.fov = Math.round(30 + v * 80);
        this.host.applySettings(false);
      }),
      new Button(cx + 5, y0 - 12, 150, 20, `Difficulty: ${DIFF[h.difficulty] ?? 'Normal'}`, (b) => {
        const next = (h.difficulty + 1) % 4;
        h.send({ t: 'chat', message: `/difficulty ${DIFF[next]!.toLowerCase()}` });
        h.difficulty = next;
        b.label = `Difficulty: ${DIFF[next]}`;
      }),
      new Button(cx - 155, y0 + 48 - 6, 150, 20, 'Skin Customization...', () => {}),
      new Button(cx + 5, y0 + 48 - 6, 150, 20, 'Music & Sounds...', () => this.host.setScreen(new SoundOptionsScreen(this.host as never, this))),
      new Button(cx - 155, y0 + 72 - 6, 150, 20, 'Video Settings...', () => this.host.setScreen(new VideoSettingsScreen(this.host, this))),
      new Button(cx + 5, y0 + 72 - 6, 150, 20, 'Controls...', () => this.host.setScreen(new ControlsScreen(this.host, this))),
      new Button(cx - 155, y0 + 96 - 6, 150, 20, 'Language...', () => {}),
      new Button(cx + 5, y0 + 96 - 6, 150, 20, 'Chat Settings...', () => {}),
      new Button(cx - 155, y0 + 120 - 6, 150, 20, 'Resource Packs...', () => {}),
      new Button(cx + 5, y0 + 120 - 6, 150, 20, 'Accessibility Settings...', () => this.host.setScreen(new AccessibilityScreen(this.host, this))),
      new Button(cx - 100, y0 + 168, 200, 20, 'Done', () => this.host.setScreen(this.parent)),
    ];
    // not built yet: skins, languages (English only), chat settings, resource packs
    for (const i of [2, 6, 7, 8]) this.widgets[i]!.active = false;
  }
  override renderBackground(): void {
    this.gui.worldBackground();
  }
  override render(mx: number, my: number): void {
    super.render(mx, my);
    this.gui.centeredText(this.title, this.gui.width / 2, 15);
  }
  override keyDown(code: string): boolean {
    if (code === 'Escape') {
      this.host.setScreen(this.parent);
      return true;
    }
    return false;
  }
}

type Opt =
  | { kind: 'cycle'; label: string; get: () => string; next: () => void; reload?: boolean }
  | { kind: 'slider'; label: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void; fmt?: (v: number) => string; reload?: boolean };

export class VideoSettingsScreen extends Screen {
  constructor(private host: ScreenHost, private parent: Screen) {
    super(host.gui, 'Video Settings');
  }
  private options(): Opt[] {
    const s = this.host.settings;
    const cyc = <T>(list: T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length]!;
    return [
      { kind: 'cycle', label: 'Graphics', get: () => (s.graphics === 'fancy' ? 'Fancy' : 'Fast'), next: () => (s.graphics = cyc(['fast', 'fancy'] as const, s.graphics)), reload: true },
      { kind: 'slider', label: 'Render Distance', min: 2, max: 32, step: 1, get: () => s.renderDistance, set: (v) => (s.renderDistance = v), fmt: (v) => `${v} chunks` },
      { kind: 'cycle', label: 'Smooth Lighting', get: () => (s.smoothLighting ? 'ON' : 'OFF'), next: () => (s.smoothLighting = !s.smoothLighting), reload: true },
      { kind: 'slider', label: 'Simulation Distance', min: 5, max: 32, step: 1, get: () => s.simulationDistance, set: (v) => (s.simulationDistance = v), fmt: (v) => `${v} chunks` },
      { kind: 'slider', label: 'Max Framerate', min: 0, max: 5, step: 1, get: () => [-1, 30, 60, 120, 240, 0].indexOf(s.maxFps), set: (v) => (s.maxFps = [-1, 30, 60, 120, 240, 0][v]!), fmt: (v) => (v === 0 ? 'VSync' : v === 5 ? 'Unlimited' : `${[-1, 30, 60, 120, 240, 0][v]} fps`) },
      { kind: 'cycle', label: 'View Bobbing', get: () => (s.viewBobbing ? 'ON' : 'OFF'), next: () => (s.viewBobbing = !s.viewBobbing) },
      { kind: 'slider', label: 'GUI Scale', min: 0, max: 6, step: 1, get: () => s.guiScale, set: (v) => (s.guiScale = v), fmt: (v) => (v === 0 ? 'Auto' : `${v}`) },
      { kind: 'slider', label: 'Brightness', min: 0, max: 100, step: 1, get: () => Math.round(s.gamma * 100), set: (v) => (s.gamma = v / 100), fmt: (v) => (v === 0 ? 'Moody' : v === 100 ? 'Bright' : `+${v}%`) },
      { kind: 'cycle', label: 'Clouds', get: () => ({ off: 'OFF', fast: 'Fast', fancy: 'Fancy' })[s.clouds], next: () => (s.clouds = cyc(['off', 'fast', 'fancy'] as const, s.clouds)) },
      { kind: 'cycle', label: 'Particles', get: () => ({ all: 'All', decreased: 'Decreased', minimal: 'Minimal' })[s.particles], next: () => (s.particles = cyc(['all', 'decreased', 'minimal'] as const, s.particles)) },
      { kind: 'slider', label: 'Mipmap Levels', min: 0, max: 4, step: 1, get: () => s.mipmapLevels, set: (v) => (s.mipmapLevels = v), fmt: (v) => (v === 0 ? 'OFF' : `${v}`), reload: true },
      { kind: 'slider', label: 'Biome Blend', min: 0, max: 7, step: 1, get: () => s.biomeBlend, set: (v) => (s.biomeBlend = v), fmt: (v) => (v === 0 ? 'OFF' : `${v * 2 + 1}x${v * 2 + 1}`), reload: true },
      { kind: 'slider', label: 'Entity Distance', min: 50, max: 500, step: 25, get: () => Math.round(s.entityDistance * 100), set: (v) => (s.entityDistance = v / 100), fmt: (v) => `${v}%` },
      { kind: 'cycle', label: 'Cave Culling', get: () => (s.caveCulling ? 'ON' : 'OFF'), next: () => (s.caveCulling = !s.caveCulling) },
    ];
  }
  init(): void {
    const cx = Math.floor(this.gui.width / 2);
    this.widgets = [];
    this.options().forEach((o, i) => {
      const x = i % 2 === 0 ? cx - 155 : cx + 5;
      const y = 32 + Math.floor(i / 2) * 24;
      if (o.kind === 'cycle') {
        const b = new Button(x, y, 150, 20, `${o.label}: ${o.get()}`, () => {
          o.next();
          b.label = `${o.label}: ${o.get()}`;
          this.host.applySettings(!!o.reload);
        });
        this.widgets.push(b);
      } else {
        const toV = (n: number) => (n - o.min) / (o.max - o.min);
        const fromV = (v: number) => Math.round((o.min + v * (o.max - o.min)) / o.step) * o.step;
        this.widgets.push(new Slider(x, y, 150, 20, toV(o.get()), (v) => `${o.label}: ${(o.fmt ?? String)(fromV(v))}`, (v) => {
          const n = fromV(v);
          if (n !== o.get()) {
            o.set(n);
            this.host.applySettings(!!o.reload);
          }
        }));
      }
    });
    this.widgets.push(new Button(cx - 100, this.gui.height - 27, 200, 20, 'Done', () => this.host.setScreen(this.parent)));
  }
  override renderBackground(): void {
    this.gui.worldBackground();
  }
  override render(mx: number, my: number): void {
    super.render(mx, my);
    this.gui.centeredText(this.title, this.gui.width / 2, 15);
  }
  override keyDown(code: string): boolean {
    if (code === 'Escape') {
      this.host.setScreen(this.parent);
      return true;
    }
    return false;
  }
}
