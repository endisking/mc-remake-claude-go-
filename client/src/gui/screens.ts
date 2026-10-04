/** Pause menu, Options and Video Settings screens. */
import { Button, Screen, Slider } from './screen';
import type { Gui } from './gui';
import type { Settings } from '../settings';
import { ControlsScreen, SoundOptionsScreen, AccessibilityScreen } from './controls';
import { VideoSettingsScreen, ChatOptionsScreen, SkinCustomizationScreen } from './options';

export { VideoSettingsScreen, ChatOptionsScreen, SkinCustomizationScreen };

export interface ScreenHost {
  gui: Gui;
  settings: Settings;
  setScreen(s: Screen | null): void;
  /** Apply and persist settings; `reloadChunks` when meshing options changed. */
  applySettings(reloadChunks: boolean): void;
  quitToTitle(): void;
}

export class PauseScreen extends Screen {
  /** showMenu false: F3+Esc, just "Game Paused" with no buttons and no dimming */
  constructor(private host: ScreenHost, private showMenu = true) {
    super(host.gui, showMenu ? 'Game Menu' : 'Game Paused');
  }
  init(): void {
    if (!this.showMenu) {
      this.widgets = [];
      return;
    }
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
    if (!this.showMenu) {
      this.gui.centeredText(this.title, this.gui.width / 2, 10);
      return;
    }
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
      new Button(cx - 155, y0 + 48 - 6, 150, 20, 'Skin Customization...', () => this.host.setScreen(new SkinCustomizationScreen(this.host, this))),
      new Button(cx + 5, y0 + 48 - 6, 150, 20, 'Music & Sounds...', () => this.host.setScreen(new SoundOptionsScreen(this.host as never, this))),
      new Button(cx - 155, y0 + 72 - 6, 150, 20, 'Video Settings...', () => this.host.setScreen(new VideoSettingsScreen(this.host, this))),
      new Button(cx + 5, y0 + 72 - 6, 150, 20, 'Controls...', () => this.host.setScreen(new ControlsScreen(this.host, this))),
      new Button(cx - 155, y0 + 96 - 6, 150, 20, 'Language...', () => {}),
      new Button(cx + 5, y0 + 96 - 6, 150, 20, 'Chat Settings...', () => this.host.setScreen(new ChatOptionsScreen(this.host, this))),
      new Button(cx - 155, y0 + 120 - 6, 150, 20, 'Resource Packs...', () => {}),
      new Button(cx + 5, y0 + 120 - 6, 150, 20, 'Accessibility Settings...', () => this.host.setScreen(new AccessibilityScreen(this.host, this))),
      new Button(cx - 100, y0 + 168, 200, 20, 'Done', () => this.host.setScreen(this.parent)),
    ];
    // not built yet: languages (English only), resource packs
    for (const i of [6, 8]) this.widgets[i]!.active = false;
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
