/**
 * Controls, Mouse Settings, Music & Sounds and Accessibility screens (vanilla 1.17 layouts):
 * a scrolling key-binding list with categories, per-key Reset and conflict highlighting.
 */
import { Button, Screen, Slider } from './screen';
import type { ScreenHost } from './screens';
import { CATEGORY_NAMES, KEY_MAPPINGS, keyName, sortedMappings, type KeyMappingDef } from '../keybinds';
import type { SoundCategory } from '../audio/engine';

const onOff = (b: boolean) => (b ? 'ON' : 'OFF');

/** Common options-sub-screen behaviour: title, Escape returns to the parent. */
abstract class SubScreen extends Screen {
  constructor(protected host: ScreenHost, protected parent: Screen | null, title: string) {
    super(host.gui, title);
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

type Row = { kind: 'category'; label: string } | { kind: 'key'; def: KeyMappingDef; change: Button; reset: Button };

export class ControlsScreen extends SubScreen {
  private rows: Row[] = [];
  private scroll = 0;
  private selected: KeyMappingDef | null = null;
  private resetAll!: Button;
  private readonly top = 43;

  constructor(host: ScreenHost, parent: Screen | null) {
    super(host, parent, 'Controls');
  }

  private get keys(): Record<string, string> {
    return this.host.settings.keys;
  }
  private keyOf(d: KeyMappingDef): string {
    return this.keys[d.id] ?? d.key;
  }

  init(): void {
    const s = this.host.settings;
    const cx = Math.floor(this.gui.width / 2);
    this.widgets = [
      new Button(cx - 155, 18, 150, 20, 'Mouse Settings...', () => this.host.setScreen(new MouseSettingsScreen(this.host, this))),
      new Button(cx - 155 + 160, 18, 150, 20, `Auto-Jump: ${onOff(s.autoJump)}`, (b) => {
        s.autoJump = !s.autoJump;
        b.label = `Auto-Jump: ${onOff(s.autoJump)}`;
        this.host.applySettings(false);
      }),
    ];
    this.resetAll = new Button(cx - 155, this.gui.height - 29, 150, 20, 'Reset Keys', () => {
      for (const k of Object.keys(this.keys)) delete this.keys[k];
      this.host.applySettings(false);
      this.refresh();
    });
    this.widgets.push(this.resetAll, new Button(cx - 155 + 160, this.gui.height - 29, 150, 20, 'Done', () => this.host.setScreen(this.parent)));
    this.rows = [];
    let cat = '';
    for (const def of sortedMappings()) {
      if (def.category !== cat) {
        cat = def.category;
        this.rows.push({ kind: 'category', label: CATEGORY_NAMES[def.category] });
      }
      const change = new Button(0, 0, 75, 20, '', () => {
        this.selected = def;
        this.refresh();
      });
      const reset = new Button(0, 0, 50, 20, 'Reset', () => {
        delete this.keys[def.id];
        this.host.applySettings(false);
        this.refresh();
      });
      this.rows.push({ kind: 'key', def, change, reset });
    }
    this.refresh();
  }

  private refresh(): void {
    let anyChanged = false;
    for (const r of this.rows) {
      if (r.kind !== 'key') continue;
      const key = this.keyOf(r.def);
      const conflict = !!key && KEY_MAPPINGS.some((o) => o.id !== r.def.id && this.keyOf(o) === key);
      const name = keyName(key);
      r.change.label = this.selected === r.def ? `§f> §e${name}§f <` : conflict ? `§c${name}` : name;
      r.reset.active = key !== r.def.key;
      if (key !== r.def.key) anyChanged = true;
    }
    this.resetAll.active = anyChanged;
  }

  private bottom(): number {
    return this.gui.height - 32;
  }
  private contentHeight(): number {
    return this.rows.length * 20 + 4;
  }
  private clampScroll(): void {
    const max = Math.max(0, this.contentHeight() - (this.bottom() - this.top - 4));
    this.scroll = Math.max(0, Math.min(max, this.scroll));
  }

  /** Lay out visible rows (and position their buttons). */
  private layout(): { row: Row; y: number }[] {
    this.clampScroll();
    const left = Math.floor(this.gui.width / 2) - 155 + 45;
    const out: { row: Row; y: number }[] = [];
    this.rows.forEach((row, i) => {
      const y = this.top + 4 + i * 20 - this.scroll;
      if (row.kind === 'key') {
        row.change.x = left + 105;
        row.change.y = y;
        row.reset.x = left + 190;
        row.reset.y = y;
        const visible = y + 20 > this.top && y < this.bottom();
        row.change.visible = row.reset.visible = visible;
      }
      if (y + 20 > this.top && y < this.bottom()) out.push({ row, y });
    });
    return out;
  }

  override render(mx: number, my: number): void {
    const g = this.gui;
    this.renderBackground();
    const rows = this.layout();
    // list area with darker background, header/footer bands like vanilla AbstractSelectionList
    g.ctx.save();
    g.ctx.beginPath();
    g.ctx.rect(0, this.top, g.width, this.bottom() - this.top);
    g.ctx.clip();
    g.fill(0, this.top, g.width, this.bottom() - this.top, 0x60000000);
    const labelRight = Math.floor(g.width / 2) - 155 + 45 + 90;
    for (const { row, y } of rows) {
      if (row.kind === 'category') g.centeredText(row.label, g.width / 2, y + 20 - 9 - 1, 0xffffff);
      else {
        g.text(row.def.name, labelRight - g.font.width(row.def.name), y + 6, 0xffffff);
        row.change.render(g, mx, my);
        row.reset.render(g, mx, my);
      }
    }
    g.ctx.restore();
    for (const w of this.widgets) if (w.visible) w.render(g, mx, my);
    g.centeredText(this.title, g.width / 2, 8);
  }

  override mouseButton(mx: number, my: number, button: number): boolean {
    if (this.selected) {
      // binding a mouse button
      this.bind(`Mouse${button}`);
      return true;
    }
    if (button !== 0) return false;
    if (my >= this.top && my < this.bottom()) {
      for (const r of this.rows) {
        if (r.kind !== 'key') continue;
        for (const b of [r.change, r.reset]) {
          if (b.visible && b.contains(mx, my) && b.active) {
            b.onClick();
            return true;
          }
        }
      }
    }
    return false;
  }

  private bind(code: string): void {
    const d = this.selected!;
    if (code === d.key) delete this.keys[d.id];
    else this.keys[d.id] = code;
    this.selected = null;
    this.host.applySettings(false);
    this.refresh();
  }

  override mouseScrolled(_mx: number, _my: number, delta: number): void {
    this.scroll += delta * 20;
    this.clampScroll();
  }

  override keyDown(code: string): boolean {
    if (this.selected) {
      // Escape unbinds (vanilla InputConstants.UNKNOWN)
      this.bind(code === 'Escape' ? '' : code);
      return true;
    }
    return super.keyDown(code);
  }
}

export class MouseSettingsScreen extends SubScreen {
  constructor(host: ScreenHost, parent: Screen | null) {
    super(host, parent, 'Mouse Settings');
  }
  init(): void {
    const s = this.host.settings;
    const cx = Math.floor(this.gui.width / 2);
    const col = (i: number) => (i % 2 === 0 ? cx - 155 : cx + 5);
    const row = (i: number) => 32 + Math.floor(i / 2) * 24;
    const sens = (v: number) => (v === 0 ? 'Sensitivity: *yawn*' : v === 1 ? 'Sensitivity: HYPERSPEED!!!' : `Sensitivity: ${Math.round(v * 200)}%`);
    this.widgets = [
      new Slider(col(0), row(0), 150, 20, s.mouseSensitivity, sens, (v) => {
        s.mouseSensitivity = v;
        this.host.applySettings(false);
      }),
      new Button(col(1), row(1), 150, 20, `Invert Mouse: ${onOff(s.invertYMouse)}`, (b) => {
        s.invertYMouse = !s.invertYMouse;
        b.label = `Invert Mouse: ${onOff(s.invertYMouse)}`;
        this.host.applySettings(false);
      }),
      new Slider(col(2), row(2), 150, 20, (s.mouseWheelSensitivity - 0.01) / (10 - 0.01), (v) => `Scroll Sensitivity: ${(0.01 + v * (10 - 0.01)).toFixed(2)}`, (v) => {
        s.mouseWheelSensitivity = Math.round((0.01 + v * (10 - 0.01)) * 100) / 100;
        this.host.applySettings(false);
      }),
      new Button(col(3), row(3), 150, 20, `Discrete Scrolling: ${onOff(s.discreteMouseScroll)}`, (b) => {
        s.discreteMouseScroll = !s.discreteMouseScroll;
        b.label = `Discrete Scrolling: ${onOff(s.discreteMouseScroll)}`;
        this.host.applySettings(false);
      }),
      new Button(cx - 100, this.gui.height - 27, 200, 20, 'Done', () => this.host.setScreen(this.parent)),
    ];
  }
}

const SOUND_SLIDERS: [SoundCategory, string][] = [
  ['music', 'Music'], ['record', 'Jukebox/Note Blocks'], ['weather', 'Weather'], ['block', 'Blocks'], ['hostile', 'Hostile Creatures'],
  ['neutral', 'Friendly Creatures'], ['player', 'Players'], ['ambient', 'Ambient/Environment'], ['voice', 'Voice/Speech'],
];

export class SoundOptionsScreen extends SubScreen {
  constructor(host: ScreenHost & { setVolume(c: SoundCategory, v: number): void; volume(c: SoundCategory): number }, parent: Screen | null) {
    super(host, parent, 'Music & Sound Options');
  }
  init(): void {
    const h = this.host as ScreenHost & { setVolume(c: SoundCategory, v: number): void; volume(c: SoundCategory): number };
    const cx = Math.floor(this.gui.width / 2);
    const y0 = Math.floor(this.gui.height / 6) - 12;
    const pct = (label: string) => (v: number) => `${label}: ${v === 0 ? 'OFF' : `${Math.round(v * 100)}%`}`;
    this.widgets = [new Slider(cx - 155, y0, 310, 20, h.volume('master'), pct('Master Volume'), (v) => h.setVolume('master', v))];
    SOUND_SLIDERS.forEach(([c, label], i) => {
      const x = i % 2 === 0 ? cx - 155 : cx + 5;
      this.widgets.push(new Slider(x, y0 + 24 * (1 + Math.floor(i / 2)), 150, 20, h.volume(c), pct(label), (v) => h.setVolume(c, v)));
    });
    this.widgets.push(new Button(cx - 100, Math.floor(this.gui.height / 6) + 168, 200, 20, 'Done', () => this.host.setScreen(this.parent)));
  }
}

export class AccessibilityScreen extends SubScreen {
  constructor(host: ScreenHost, parent: Screen | null) {
    super(host, parent, 'Accessibility Settings');
  }
  init(): void {
    const s = this.host.settings;
    const cx = Math.floor(this.gui.width / 2);
    const col = (i: number) => (i % 2 === 0 ? cx - 155 : cx + 5);
    const row = (i: number) => Math.floor(this.gui.height / 6) - 12 + Math.floor(i / 2) * 24;
    const holdToggle = (b: boolean) => (b ? 'Toggle' : 'Hold');
    this.widgets = [
      new Button(col(0), row(0), 150, 20, `Auto-Jump: ${onOff(s.autoJump)}`, (b) => {
        s.autoJump = !s.autoJump;
        b.label = `Auto-Jump: ${onOff(s.autoJump)}`;
        this.host.applySettings(false);
      }),
      new Button(col(1), row(1), 150, 20, `Sneak: ${holdToggle(s.toggleCrouch)}`, (b) => {
        s.toggleCrouch = !s.toggleCrouch;
        b.label = `Sneak: ${holdToggle(s.toggleCrouch)}`;
        this.host.applySettings(false);
      }),
      new Button(col(2), row(2), 150, 20, `Sprint: ${holdToggle(s.toggleSprint)}`, (b) => {
        s.toggleSprint = !s.toggleSprint;
        b.label = `Sprint: ${holdToggle(s.toggleSprint)}`;
        this.host.applySettings(false);
      }),
      new Slider(col(3), row(3), 150, 20, s.fovEffectScale, (v) => `FOV Effects: ${v === 0 ? 'OFF' : `${Math.round(v * 100)}%`}`, (v) => {
        s.fovEffectScale = v;
        this.host.applySettings(false);
      }),
      new Button(cx - 100, Math.floor(this.gui.height / 6) + 168, 200, 20, 'Done', () => this.host.setScreen(this.parent)),
    ];
  }
}
