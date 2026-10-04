/**
 * Touch controls for phones and tablets, laid out like the touch controls of the mobile edition:
 * a joystick on the left to walk (pushed all the way forward it sprints), drag anywhere else to
 * look, tap to use / place (or hit the mob under the crosshair), hold to break a block (or, with
 * food, a bow, a shield… in hand, to use it), buttons for jump, sneak, inventory, drop, chat,
 * camera, fullscreen and pause, and tapping a hotbar slot selects it. Everything is turned into
 * the same key and mouse-button presses the keyboard produces, so the game logic is unchanged.
 * While a menu is open only a close button is shown; taps on the menu act as mouse clicks.
 */
import type { Input } from '../input';

/**
 * Phones and tablets (Android, iPhone, iPad, including iPadOS that reports itself as a Mac). Not
 * touchscreen laptops or Chromebooks: those have a keyboard and trackpad and keep mouse controls.
 */
export function isMobileDevice(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { userAgentData?: { mobile?: boolean } } = navigator): boolean {
  const ua = nav.userAgent;
  if (/CrOS/.test(ua)) return false;
  if (nav.userAgentData?.mobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  // iPadOS asks for desktop sites and reports a Mac; real Macs have no touch points
  return /Macintosh/.test(ua) && nav.maxTouchPoints > 1;
}
import type { Gui } from './gui';

export interface TouchHost {
  readonly input: Input;
  readonly gui: Gui;
  /** a menu / screen is open */
  screenOpen(): boolean;
  /** close the open screen the way Escape would */
  closeScreen(): void;
  openPauseMenu(): void;
  /** key bound to a mapping id ("jump", "hotbar.3", …) */
  key(id: string): string;
  /** the crosshair is on a mob or another entity (a tap hits it instead of using the item) */
  targetIsEntity(): boolean;
  /** the selected item is used by holding (food, potions, bows, crossbows, tridents, shields, spyglass) */
  holdToUse(): boolean;
  sendChat(message: string): void;
  toggleFullscreen(): void;
}

const STYLE = `
.bc-touch { position: fixed; inset: 0; z-index: 20; pointer-events: none; user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none; touch-action: none; font: bold 13px monospace; color: #fff; }
.bc-touch .look { position: absolute; inset: 0; pointer-events: auto; touch-action: none; }
.bc-touch .btn { position: absolute; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center;
  width: var(--b); height: var(--b); box-sizing: border-box; border: 2px solid rgba(0,0,0,0.75); background: rgba(120,120,120,0.38);
  box-shadow: inset 2px 2px rgba(255,255,255,0.28), inset -2px -2px rgba(0,0,0,0.3); text-shadow: 1px 1px #3f3f3f; border-radius: 4px; }
.bc-touch .btn.small { width: calc(var(--b) * 0.72); height: calc(var(--b) * 0.72); font-size: 11px; }
.bc-touch .btn.on, .bc-touch .btn.held { background: rgba(140,155,214,0.6); }
.bc-touch .btn svg { width: 55%; height: 55%; fill: #fff; filter: drop-shadow(1px 1px 0 #3f3f3f); }
.bc-touch .stick { position: absolute; width: calc(var(--b) * 2); height: calc(var(--b) * 2); margin: calc(var(--b) * -1) 0 0 calc(var(--b) * -1);
  border-radius: 50%; border: 2px solid rgba(255,255,255,0.35); background: rgba(0,0,0,0.18); display: none; }
.bc-touch .stick .knob { position: absolute; left: 50%; top: 50%; width: 42%; height: 42%; margin: -21% 0 0 -21%; border-radius: 50%;
  background: rgba(255,255,255,0.45); border: 2px solid rgba(0,0,0,0.4); }
.bc-touch .stick.sprint { border-color: rgba(140,200,255,0.8); }
.bc-touch .hint { position: absolute; left: 0; bottom: 0; width: 35%; height: 70%; pointer-events: none; }
.bc-touch .hint::after { content: ''; position: absolute; left: calc(var(--b) * 0.5); bottom: calc(var(--b) * 0.5); width: calc(var(--b) * 1.6);
  height: calc(var(--b) * 1.6); border-radius: 50%; border: 2px dashed rgba(255,255,255,0.18); }
`;

const ICON: Record<string, string> = {
  // simple pixel-style glyphs (original)
  jump: '<svg viewBox="0 0 8 8"><path d="M4 1 7 4H5v3H3V4H1z"/></svg>',
  sneak: '<svg viewBox="0 0 8 8"><path d="M1 1h1l2 2 2-2h1v1L4 5 1 2zM1 4h1l2 2 2-2h1v1L4 8 1 5z"/></svg>',
  inventory: '<svg viewBox="0 0 8 8"><path d="M1 3h6v4H1zM3 1h2v1H3zM2 2h1v1H2zM5 2h1v1H5z"/></svg>',
  pause: '<svg viewBox="0 0 8 8"><path d="M2 1h1.5v6H2zM4.5 1H6v6H4.5z"/></svg>',
  close: '<svg viewBox="0 0 8 8"><path d="M1 2l1-1 2 2 2-2 1 1-2 2 2 2-1 1-2-2-2 2-1-1 2-2z"/></svg>',
  chat: '<svg viewBox="0 0 8 8"><path d="M1 1h6v4H4L2 7V5H1z"/></svg>',
  drop: '<svg viewBox="0 0 8 8"><path d="M1 1h3v3H1zM4 5l1-1 1 1 1-1v3H4l1-1z"/></svg>',
  view: '<svg viewBox="0 0 8 8"><path d="M0 4q4-4 8 0-4 4-8 0zm4-1.5a1.5 1.5 0 100 3 1.5 1.5 0 100-3z"/></svg>',
  full: '<svg viewBox="0 0 8 8"><path d="M1 1h3v1H2v2H1zM7 1v3H6V2H4V1zM1 7V4h1v2h2v1zM7 7H4V6h2V4h1z"/></svg>',
};

/** finger travel (CSS px) under which a touch counts as a tap / hold rather than a look drag */
const TAP_SLOP = 12;
/** hold time (ms) before a still finger starts breaking / using */
const HOLD_MS = 280;
/** camera turn per CSS pixel of drag, relative to one mouse count */
const LOOK_GAIN = 2.2;

interface Look {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  t0: number;
  moved: boolean;
  holding: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private look: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private hint: HTMLDivElement;
  private playing: HTMLElement[] = [];
  private closeBtn: HTMLDivElement;
  private sneakBtn!: HTMLDivElement;
  private stickId: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private moveKeys = new Set<string>();
  private looks = new Map<number, Look>();
  private sneakOn = false;
  private wasScreen = false;

  constructor(private host: TouchHost) {
    if (!document.getElementById('bc-touch-style')) {
      const st = document.createElement('style');
      st.id = 'bc-touch-style';
      st.textContent = STYLE;
      document.head.append(st);
    }
    const root = (this.root = document.createElement('div'));
    root.className = 'bc-touch';
    this.look = this.div('look');
    this.hint = this.div('hint');
    this.stick = this.div('stick');
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.stick.append(this.knob);
    root.append(this.look, this.hint, this.stick);
    this.playing.push(this.look, this.hint);

    // right thumb: jump (big) with sneak to its left
    const jump = this.button('jump', { right: 1.2, bottom: 1.1 }, false, () => this.hold(host.key('jump'), jump, true), () => this.hold(host.key('jump'), jump, false));
    this.sneakBtn = this.button('sneak', { right: 2.45, bottom: 0.55 }, false, () => this.toggleSneak(), null);
    // top right: menus and camera
    this.button('pause', { right: 0.25, top: 0.25 }, true, () => host.openPauseMenu(), null);
    this.button('chat', { right: 1.05, top: 0.25 }, true, () => this.chat(), null);
    this.button('view', { right: 1.85, top: 0.25 }, true, () => this.tapKey(host.key('togglePerspective')), null);
    this.button('full', { right: 2.65, top: 0.25 }, true, () => host.toggleFullscreen(), null);
    // next to the hotbar: inventory and drop
    this.button('inventory', { right: 0.25, bottom: 2.5 }, true, () => this.tapKey(host.key('inventory')), null);
    this.button('drop', { right: 1.05, bottom: 2.5 }, true, () => this.tapKey(host.key('drop')), null);
    this.closeBtn = this.button('close', { left: 0.25, top: 0.25 }, true, () => host.closeScreen(), null, false);
    this.closeBtn.style.display = 'none';

    this.look.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
    this.look.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    this.look.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
    this.look.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });
    window.addEventListener('resize', () => this.layout());
    this.layout();
    document.body.append(root);
  }

  private div(cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    return d;
  }

  /** a button positioned in units of the button size from a screen edge */
  private button(name: string, pos: { left?: number; right?: number; top?: number; bottom?: number }, small: boolean,
    down: () => void, up: (() => void) | null, playing = true): HTMLDivElement {
    const b = this.div(small ? 'btn small' : 'btn');
    b.innerHTML = ICON[name] ?? name;
    b.dataset.touch = name;
    for (const [side, v] of Object.entries(pos)) b.style[side as 'left'] = `calc(var(--b) * ${v})`;
    b.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!small) b.classList.add('held');
      down();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      e.preventDefault();
      b.classList.remove('held');
      up?.();
    };
    b.addEventListener('touchend', end, { passive: false });
    b.addEventListener('touchcancel', end, { passive: false });
    this.root.append(b);
    if (playing) this.playing.push(b);
    return b;
  }

  private layout(): void {
    const b = Math.round(Math.max(44, Math.min(78, Math.min(window.innerWidth, window.innerHeight) * 0.14)));
    this.root.style.setProperty('--b', `${b}px`);
  }

  private hold(code: string, _el: HTMLElement, down: boolean): void {
    if (!code) return;
    if (down) this.host.input.press(code);
    else this.host.input.release(code);
  }

  private tapKey(code: string): void {
    if (!code) return;
    this.host.input.press(code);
    this.host.input.release(code);
  }

  private toggleSneak(): void {
    this.sneakOn = !this.sneakOn;
    this.sneakBtn.classList.toggle('on', this.sneakOn);
    this.hold(this.host.key('sneak'), this.sneakBtn, this.sneakOn);
  }

  private chat(): void {
    // a text box the phone's keyboard can type into (the in-game chat reads physical key presses)
    const text = window.prompt('Chat (start with / for a command)');
    if (text?.trim()) this.host.sendChat(text.trim().slice(0, 256));
  }

  // ---------------------------------------------------------------- joystick, look and actions
  private cssToGui(x: number, y: number): [number, number] {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return [(x * dpr) / this.host.gui.scale, (y * dpr) / this.host.gui.scale];
  }

  /** the hotbar slot (0-8) under a screen point, or -1 */
  hotbarSlotAt(x: number, y: number): number {
    const [gx, gy] = this.cssToGui(x, y);
    const g = this.host.gui;
    const left = Math.floor(g.width / 2) - 91;
    if (gy < g.height - 23 || gx < left || gx >= left + 182) return -1;
    return Math.min(8, Math.floor((gx - left - 1) / 20));
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const slot = this.hotbarSlotAt(t.clientX, t.clientY);
      if (slot >= 0) {
        this.tapKey(this.host.key(`hotbar.${slot + 1}`));
        continue;
      }
      // left part of the screen: a joystick appears under the thumb
      if (this.stickId === null && t.clientX < window.innerWidth * 0.35 && t.clientY > window.innerHeight * 0.3) {
        this.stickId = t.identifier;
        this.stickX = t.clientX;
        this.stickY = t.clientY;
        this.stick.style.left = `${t.clientX}px`;
        this.stick.style.top = `${t.clientY}px`;
        this.stick.style.display = 'block';
        this.hint.style.display = 'none';
        this.knob.style.transform = '';
        continue;
      }
      const l: Look = { id: t.identifier, x: t.clientX, y: t.clientY, startX: t.clientX, startY: t.clientY, t0: performance.now(), moved: false, holding: null, timer: null };
      l.timer = setTimeout(() => this.startHold(l), HOLD_MS);
      this.looks.set(t.identifier, l);
    }
  }

  private startHold(l: Look): void {
    l.timer = null;
    // a finger already dragging is turning the camera; once holding, dragging keeps breaking
    if (l.moved) return;
    l.holding = this.host.holdToUse() ? this.host.key('use') : this.host.key('attack');
    if (l.holding) this.host.input.press(l.holding);
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.moveStick(t.clientX, t.clientY);
        continue;
      }
      const l = this.looks.get(t.identifier);
      if (!l) continue;
      const dx = t.clientX - l.x, dy = t.clientY - l.y;
      l.x = t.clientX;
      l.y = t.clientY;
      if (!l.moved && Math.hypot(t.clientX - l.startX, t.clientY - l.startY) > TAP_SLOP) l.moved = true;
      if (l.moved) {
        // the game applies the mouse sensitivity option on top
        this.host.input.mouseDX += dx * LOOK_GAIN;
        this.host.input.mouseDY += dy * LOOK_GAIN;
      }
    }
  }

  private moveStick(x: number, y: number): void {
    const r = (parseFloat(this.root.style.getPropertyValue('--b')) || 60);
    let dx = (x - this.stickX) / r, dy = (y - this.stickY) / r;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    this.knob.style.transform = `translate(${dx * r * 0.62}px, ${dy * r * 0.62}px)`;
    const k = this.host.key.bind(this.host);
    const want = new Set<string>();
    if (dy < -0.35) want.add(k('forward'));
    if (dy > 0.35) want.add(k('back'));
    if (dx < -0.35) want.add(k('left'));
    if (dx > 0.35) want.add(k('right'));
    // pushed (almost) all the way forward: sprint
    const sprint = m > 0.92 && dy < -0.75;
    if (sprint) want.add(k('sprint'));
    this.stick.classList.toggle('sprint', sprint);
    this.setMoveKeys(want);
  }

  private setMoveKeys(want: Set<string>): void {
    for (const c of this.moveKeys) if (!want.has(c)) this.host.input.release(c);
    for (const c of want) if (c && !this.moveKeys.has(c)) this.host.input.press(c);
    this.moveKeys = want;
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.stick.style.display = 'none';
        this.hint.style.display = '';
        this.setMoveKeys(new Set());
        continue;
      }
      const l = this.looks.get(t.identifier);
      if (!l) continue;
      this.looks.delete(t.identifier);
      if (l.timer) clearTimeout(l.timer);
      if (l.holding) this.host.input.release(l.holding);
      else if (!l.moved && e.type === 'touchend') {
        // tap: hit the mob under the crosshair, otherwise use the item / place a block
        this.tapKey(this.host.key(this.host.targetIsEntity() ? 'attack' : 'use'));
      }
    }
  }

  /** let go of everything (a menu opened, the page was hidden) */
  reset(): void {
    for (const l of this.looks.values()) {
      if (l.timer) clearTimeout(l.timer);
      if (l.holding) this.host.input.release(l.holding);
    }
    this.looks.clear();
    this.stickId = null;
    this.stick.style.display = 'none';
    this.setMoveKeys(new Set());
    const jump = this.host.key('jump');
    if (jump) this.host.input.release(jump);
    for (const b of this.root.querySelectorAll('.held')) b.classList.remove('held');
  }

  /** hide everything (mouse and keyboard in use) or show it again */
  setVisible(on: boolean): void {
    this.reset();
    if (!on && this.sneakOn) this.toggleSneak();
    this.root.style.display = on ? '' : 'none';
  }

  /** per frame: show the playing controls or just the close button */
  update(): void {
    if (this.root.style.display === 'none') return;
    const screen = this.host.screenOpen();
    if (screen !== this.wasScreen) {
      this.wasScreen = screen;
      if (screen) this.reset();
      for (const el of this.playing) el.style.display = screen ? 'none' : '';
      this.closeBtn.style.display = screen ? '' : 'none';
      if (!screen && this.sneakOn) this.hold(this.host.key('sneak'), this.sneakBtn, true);
    }
  }
}
