/**
 * Chat: the open chat screen (vanilla ChatScreen + EditBox), command tab completion
 * (vanilla CommandSuggestions: suggestion list, usage hints and parse errors, answered by the
 * server), sent-message history, JSON text components → §-formatted strings, and the
 * player list shown while Tab is held (vanilla PlayerTabOverlay).
 */
import { Button, Screen } from './screen';
import type { Gui } from './gui';
import type { PlayerInfoEntry } from './spectator';

// ------------------------------------------------------------------ text components
const COLOR_CODES: Record<string, string> = {
  black: '0', dark_blue: '1', dark_green: '2', dark_aqua: '3', dark_red: '4', dark_purple: '5', gold: '6', gray: '7',
  dark_gray: '8', blue: '9', green: 'a', aqua: 'b', red: 'c', light_purple: 'd', yellow: 'e', white: 'f',
};

interface Component {
  clickEvent?: { action: string; value: string };
  text?: string;
  color?: string;
  extra?: (Component | string)[];
  translate?: string;
  with?: (Component | string)[];
}

/** A chat JSON text component (or plain text) as a §-formatted line; colours inherit like vanilla Style. */
export function componentToLegacy(json: string): string {
  let root: Component | string;
  try {
    root = JSON.parse(json) as Component | string;
  } catch {
    return json;
  }
  const walk = (c: Component | string, color: string): string => {
    if (typeof c === 'string') return `§${color}${c}`;
    const col = c.color && COLOR_CODES[c.color] ? COLOR_CODES[c.color]! : color;
    let out = c.text ? `§${col}${c.text}` : '';
    if (c.translate) {
      let i = 0;
      out += `§${col}` + c.translate.replace(/%s/g, () => (c.with?.[i] !== undefined ? walk(c.with[i++]!, col) + `§${col}` : ''));
    }
    for (const e of c.extra ?? []) out += walk(e, col);
    return out;
  };
  return walk(root, 'f').replace(/§f(?=§)/g, '').replace(/^§f/, '');
}

/** The first click event in a component tree (vanilla clicks the exact component; lines here). */
export function componentClick(json: string): { action: string; value: string } | undefined {
  let root: Component | string;
  try {
    root = JSON.parse(json) as Component | string;
  } catch {
    return undefined;
  }
  const find = (c: Component | string): { action: string; value: string } | undefined => {
    if (typeof c === 'string') return undefined;
    if (c.clickEvent && typeof c.clickEvent.action === 'string' && typeof c.clickEvent.value === 'string') return c.clickEvent;
    for (const e of c.extra ?? []) {
      const r = find(e);
      if (r) return r;
    }
    return undefined;
  };
  return find(root);
}

// ------------------------------------------------------------------ chat screen
export interface ChatHost {
  gui: Gui;
  setScreen(s: Screen | null): void;
  /** send a chat line / command to the server */
  sendChat(message: string): void;
  /** ask the server for suggestions (id echoes back) */
  requestSuggestions(id: number, text: string): void;
  /** sent-message history (ChatComponent.getRecentChat), newest last */
  history: string[];
  /** draw the chat lines in focused (open) mode */
  renderChatFocused(g: Gui): void;
  /** scroll the open chat (lines) */
  scrollChat(lines: number): void;
  /** click action of the chat line at a GUI position */
  chatClickAt?(mx: number, my: number): { action: string; value: string } | undefined;
  copyToClipboard?(text: string): void;
}

export interface SuggestionReply {
  start: number;
  list: { text: string; tooltip?: string }[];
  usage: string[];
  error: { message: string; at: number } | null;
  parsedTo: number;
  /** [start, end) of each parsed argument */
  args?: [number, number][];
  /** where unparsable input starts, −1 if none */
  unparsed?: number;
}

/** CommandSuggestions argument colours: aqua, yellow, green, light purple, gold; literals grey; unparsed red. */
const ARG_COLORS = [0x55ffff, 0xffff55, 0x55ff55, 0xff55ff, 0xffaa00];
const LITERAL = 0xaaaaaa, UNPARSED = 0xff5555;

/** Coloured runs of a command line (CommandSuggestions.formatText). */
export function formatCommand(text: string, args: [number, number][], unparsed: number): { text: string; color: number }[] {
  const out: { text: string; color: number }[] = [];
  let i = 0, j = -1;
  for (const [start, end] of args) {
    j = (j + 1) % ARG_COLORS.length;
    const k = Math.max(start, 0);
    if (k >= text.length) break;
    const l = Math.min(end, text.length);
    if (l > 0 && k >= i) {
      out.push({ text: text.slice(i, k), color: LITERAL });
      out.push({ text: text.slice(k, l), color: ARG_COLORS[j]! });
      i = l;
    }
  }
  if (unparsed >= 0 && unparsed < text.length && unparsed >= i) {
    out.push({ text: text.slice(i, unparsed), color: LITERAL });
    out.push({ text: text.slice(unparsed), color: UNPARSED });
    i = text.length;
  }
  out.push({ text: text.slice(i), color: LITERAL });
  return out.filter((r) => r.text);
}

export class ChatScreen extends Screen {
  value: string;
  cursor: number;
  private historyPos: number;
  private historyDraft = '';
  private frame = 0;
  private reqId = 0;
  private reply: SuggestionReply | null = null;
  private selected = 0;
  /** suggestions hidden by Escape until the text changes */
  private hidden = false;
  /** text when a suggestion was last applied by Tab (cycling keeps the list) */
  private cycleText: string | null = null;
  private cycleStart = 0;
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);
  private readonly onPaste = (e: ClipboardEvent) => {
    const t = e.clipboardData?.getData('text') ?? '';
    if (t) {
      this.insert(t.replace(/[\r\n]+/g, ' '));
      e.preventDefault();
    }
  };
  private listening = false;

  constructor(protected host: ChatHost, initial = '') {
    super(host.gui, 'Chat screen');
    this.pausesGame = false;
    this.value = initial;
    this.cursor = initial.length;
    this.historyPos = host.history.length;
  }

  init(): void {
    if (!this.listening) {
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('paste', this.onPaste);
      this.listening = true;
    }
    this.widgets = [];
    this.changed();
  }

  override onClose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('paste', this.onPaste);
    this.listening = false;
  }

  /** every key is ours while chat is open (Ctrl+V must keep its default so the paste event fires) */
  override keyDown(code: string): boolean {
    return code !== 'KeyV';
  }

  override renderBackground(): void {}

  override tick(): void {
    this.frame++;
  }

  override mouseScrolled(_mx: number, _my: number, delta: number): void {
    if (this.suggestionsVisible()) {
      const n = this.reply!.list.length;
      this.selected = (((this.selected + Math.sign(delta)) % n) + n) % n;
    } else this.host.scrollChat(-Math.sign(delta) * 7);
  }

  override mouseDown(mx: number, my: number): void {
    const box = this.suggestionBox();
    if (box && mx >= box.x && mx < box.x + box.w && my >= box.y && my < box.y + box.h) {
      const i = box.first + Math.floor((my - box.y) / 12);
      if (i < this.reply!.list.length) {
        this.selected = i;
        this.apply(i);
      }
      return;
    }
    // Screen.handleComponentClicked
    const click = this.host.chatClickAt?.(mx, my);
    if (!click) return;
    if (click.action === 'suggest_command') this.setValue(click.value);
    else if (click.action === 'copy_to_clipboard') this.host.copyToClipboard?.(click.value);
    else if (click.action === 'run_command') {
      this.host.sendChat(click.value);
      this.host.setScreen(null);
    }
  }

  // ---------------------------------------------------------------- editing
  private setValue(v: string, cursor = v.length): void {
    this.value = v.slice(0, 256);
    this.cursor = Math.max(0, Math.min(this.value.length, cursor));
    this.changed();
  }

  private insert(t: string): void {
    this.setValue(this.value.slice(0, this.cursor) + t + this.value.slice(this.cursor), this.cursor + t.length);
  }

  /** text changed: ask for new suggestions (vanilla CommandSuggestions.updateCommandInfo) */
  private changed(): void {
    this.hidden = false;
    if (this.cycleText !== null && this.value === this.cycleText) return;
    this.cycleText = null;
    if (this.value.startsWith('/')) {
      this.host.requestSuggestions(++this.reqId, this.value.slice(0, this.cursor));
    } else this.reply = null;
  }

  /** Server answer to a suggestion request. */
  receiveSuggestions(id: number, reply: SuggestionReply): void {
    if (id !== this.reqId) return;
    this.reply = reply;
    this.selected = 0;
  }

  private suggestionsVisible(): boolean {
    return !this.hidden && !!this.reply && this.reply.list.length > 0 && this.value.startsWith('/');
  }

  /** Tab: put the selected suggestion into the box, keeping the list for cycling. */
  private apply(i: number): void {
    const r = this.reply!;
    const s = r.list[i]!;
    const start = this.cycleText !== null ? this.cycleStart : r.start;
    const before = this.value.slice(0, start);
    const after = this.value.slice(this.cursor);
    this.cycleStart = start;
    this.value = (before + s.text + after).slice(0, 256);
    this.cursor = Math.min(this.value.length, before.length + s.text.length);
    this.cycleText = this.value;
  }

  /** Send the typed line (history + server); returns whether anything was sent. */
  protected sendLine(): boolean {
    const msg = this.value.trim().replace(/\s+/g, ' ');
    if (!msg) return false;
    const h = this.host.history;
    if (h[h.length - 1] !== msg) h.push(msg);
    if (h.length > 100) h.shift();
    this.host.sendChat(msg);
    this.historyPos = h.length;
    return true;
  }

  /** Enter: send and close (InBedChatScreen keeps the screen open). */
  protected onEnter(): void {
    this.sendLine();
    this.host.setScreen(null);
  }

  /** Escape with no suggestion list showing. */
  protected onEscape(): void {
    this.host.setScreen(null);
  }

  protected clearInput(): void {
    this.setValue('');
  }

  private moveHistory(dir: number): void {
    const h = this.host.history;
    const pos = Math.max(0, Math.min(h.length, this.historyPos + dir));
    if (pos === this.historyPos) return;
    if (this.historyPos === h.length) this.historyDraft = this.value;
    this.historyPos = pos;
    this.setValue(pos === h.length ? this.historyDraft : h[pos]!);
  }

  private wordLeft(): number {
    let i = this.cursor;
    while (i > 0 && this.value[i - 1] === ' ') i--;
    while (i > 0 && this.value[i - 1] !== ' ') i--;
    return i;
  }
  private wordRight(): number {
    let i = this.cursor;
    while (i < this.value.length && this.value[i] !== ' ') i++;
    while (i < this.value.length && this.value[i] === ' ') i++;
    return i;
  }

  private handleKey(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey;
    const sugg = this.suggestionsVisible();
    switch (e.key) {
      case 'Escape':
        if (sugg) this.hidden = true;
        else this.onEscape();
        break;
      case 'Enter':
      case 'NumpadEnter':
        this.onEnter();
        break;
      case 'Tab':
        if (this.reply && this.reply.list.length) {
          const n = this.reply.list.length;
          if (this.cycleText !== null) this.selected = (this.selected + (e.shiftKey ? n - 1 : 1)) % n;
          this.hidden = false;
          this.apply(this.selected);
        }
        break;
      case 'ArrowUp':
        if (sugg) this.selected = (this.selected + this.reply!.list.length - 1) % this.reply!.list.length;
        else this.moveHistory(-1);
        break;
      case 'ArrowDown':
        if (sugg) this.selected = (this.selected + 1) % this.reply!.list.length;
        else this.moveHistory(1);
        break;
      case 'ArrowLeft':
        this.cursor = ctrl ? this.wordLeft() : Math.max(0, this.cursor - 1);
        this.changedCursor();
        break;
      case 'ArrowRight':
        this.cursor = ctrl ? this.wordRight() : Math.min(this.value.length, this.cursor + 1);
        this.changedCursor();
        break;
      case 'Home':
        this.cursor = 0;
        this.changedCursor();
        break;
      case 'End':
        this.cursor = this.value.length;
        this.changedCursor();
        break;
      case 'Backspace': {
        if (this.cursor === 0) break;
        const from = ctrl ? this.wordLeft() : this.cursor - 1;
        this.setValue(this.value.slice(0, from) + this.value.slice(this.cursor), from);
        break;
      }
      case 'Delete': {
        if (this.cursor >= this.value.length) break;
        const to = ctrl ? this.wordRight() : this.cursor + 1;
        this.setValue(this.value.slice(0, this.cursor) + this.value.slice(to), this.cursor);
        break;
      }
      case 'PageUp':
        this.host.scrollChat(9);
        break;
      case 'PageDown':
        this.host.scrollChat(-9);
        break;
      default:
        if (ctrl && e.key.toLowerCase() === 'a') {
          this.cursor = this.value.length;
          break;
        }
        if (ctrl && e.key.toLowerCase() === 'v') return; // the paste event inserts it
        if (e.key.length === 1 && !ctrl && e.key !== '§') this.insert(e.key);
        else return;
    }
    e.preventDefault();
  }

  private changedCursor(): void {
    this.cycleText = null;
    if (this.value.startsWith('/')) this.host.requestSuggestions(++this.reqId, this.value.slice(0, this.cursor));
  }

  // ---------------------------------------------------------------- rendering
  private suggestionBox(): { x: number; y: number; w: number; h: number; first: number; count: number } | null {
    if (!this.suggestionsVisible()) return null;
    const g = this.gui;
    const r = this.reply!;
    const count = Math.min(r.list.length, 10);
    const first = Math.max(0, Math.min(this.selected - 9, r.list.length - count));
    let w = 0;
    for (const s of r.list) w = Math.max(w, g.font.width(s.text));
    const start = this.cycleText !== null ? this.cycleStart : r.start;
    const x = Math.max(0, Math.min(4 + g.font.width(this.value.slice(0, start)), g.width - w - 1)) - 1;
    const h = count * 12;
    return { x, y: g.height - 12 - h - 3, w: w + 1, h, first, count };
  }

  override render(mx = 0, my = 0): void {
    const g = this.gui;
    this.host.renderChatFocused(g);
    for (const w of this.widgets) if (w.visible) w.render(g, mx, my);
    // input box (vanilla: fill(2, h-14, w-2, h-2, background) + EditBox at (4, h-12))
    g.fill(2, g.height - 14, g.width - 4, 12, 0x80000000);
    const y = g.height - 12;
    const err = this.reply?.error && this.value.startsWith('/') ? this.reply.error : null;
    if (this.value.startsWith('/') && this.reply) {
      // the reply describes the text up to the cursor; whatever follows stays literal grey
      let x = 4;
      for (const r of formatCommand(this.value, this.reply.args ?? [], this.reply.unparsed ?? -1)) x = g.text(r.text, x, y, r.color, true);
    } else g.text(this.value, 4, y, 0xe0e0e0, true);
    // cursor: blinks every 6 ticks; "_" at the end, "|" inside
    if (Math.floor(this.frame / 6) % 2 === 0) {
      const cx = 4 + g.font.width(this.value.slice(0, this.cursor));
      if (this.cursor >= this.value.length) g.text('_', cx, y, 0xe0e0e0, true);
      else g.fill(cx, y - 1, 1, 10, 0xffd0d0d0);
    }
    const box = this.suggestionBox();
    if (box) {
      const r = this.reply!;
      g.fill(box.x, box.y, box.w + 1, box.h, 0xd0000000);
      for (let i = 0; i < box.count; i++) {
        const k = box.first + i;
        g.text(r.list[k]!.text, box.x + 1, box.y + 2 + i * 12, k === this.selected ? 0xffff00 : 0xaaaaaa, true);
      }
      const tip = r.list[this.selected]?.tooltip;
      if (tip) {
        const tw = g.font.width(tip);
        g.fill(box.x + box.w + 3, box.y + (this.selected - box.first) * 12, tw + 4, 12, 0xd0000000);
        g.text(tip, box.x + box.w + 5, box.y + 2 + (this.selected - box.first) * 12, 0xffffff, true);
      }
    } else if (this.value.startsWith('/') && this.reply && !this.hidden) {
      // usage hint or the parse error, above the input (CommandSuggestions.renderUsage)
      const lines: { text: string; color: number }[] = [];
      if (err) lines.push({ text: err.message, color: 0xff5555 });
      else for (const u of this.reply.usage) lines.push({ text: u, color: 0xaaaaaa });
      const x = err ? 3 : Math.max(3, 4 + g.font.width(this.value.slice(0, this.reply.parsedTo)) - 1);
      lines.forEach((l, i) => {
        const ly = g.height - 14 - 12 * (lines.length - i);
        g.fill(x - 1, ly, g.font.width(l.text) + 2, 12, 0xd0000000);
        g.text(l.text, x, ly + 2, l.color, true);
      });
    }
  }
}

// ------------------------------------------------------------------ player list
/** Ping bars (vanilla icons.png rows at v=176): 5 bars, fewer and redder with latency. */
function pingBars(g: Gui, x: number, y: number, latency: number): void {
  const level = latency < 0 ? -1 : latency < 150 ? 5 : latency < 300 ? 4 : latency < 600 ? 3 : latency < 1000 ? 2 : 1;
  for (let i = 0; i < 5; i++) {
    const h = 2 + i * 1.5;
    const on = level < 0 ? false : i < level;
    const col = level < 0 ? 0xff555555 : on ? (level >= 4 ? 0xff00ff21 : level >= 3 ? 0xffd8d800 : 0xffd82121) : 0xff2e2e2e;
    g.fill(x + i * 2, y + 7 - Math.round(h), 1, Math.round(h), col);
  }
}

/** PlayerTabOverlay.render: columns of up to 20 names with heads and ping, spectators greyed last. */
export function renderPlayerList(
  g: Gui,
  players: PlayerInfoEntry[],
  latency: (id: number) => number,
  face: (p: PlayerInfoEntry) => ImageBitmap | null,
): void {
  // vanilla PlayerInfo ordering: spectators last, then by name
  const list = [...players].sort((a, b) => (a.gameMode === 3 ? 1 : 0) - (b.gameMode === 3 ? 1 : 0) || a.name.toLowerCase().localeCompare(b.name.toLowerCase())).slice(0, 80);
  if (!list.length) return;
  let nameW = 0;
  for (const p of list) nameW = Math.max(nameW, g.font.width(p.name));
  const n = list.length;
  let rows = n, cols = 1;
  while (rows > 20) {
    cols++;
    rows = Math.ceil(n / cols);
  }
  const slotW = Math.min(cols * (9 + nameW + 13), g.width - 50) / cols;
  const width = slotW * cols + (cols - 1) * 5;
  const x0 = Math.floor(g.width / 2 - width / 2);
  const y0 = 10;
  g.fill(x0 - 1, y0 - 1, width + 2, rows * 9 + 1, 0x80000000);
  for (let i = 0; i < n; i++) {
    const col = Math.floor(i / rows), row = i % rows;
    const x = Math.floor(x0 + col * slotW + col * 5), y = y0 + row * 9;
    g.fill(x, y, slotW, 8, 0x20ffffff);
    const p = list[i]!;
    const img = face(p);
    const spectator = p.gameMode === 3;
    if (img) {
      g.ctx.save();
      if (spectator) g.ctx.globalAlpha = 0.5;
      g.blit(img, 8, 8, 8, 8, x, y, 8, 8);
      g.blit(img, 40, 8, 8, 8, x, y, 8, 8);
      g.ctx.restore();
    }
    g.ctx.save();
    if (spectator) g.ctx.globalAlpha = 0.56;
    g.text(p.name, x + 9, y, spectator ? 0xffffff : 0xffffff, true);
    g.ctx.restore();
    pingBars(g, x + slotW - 11, y, latency(p.id));
  }
}

// ------------------------------------------------------------------ disconnected
/** Vanilla DisconnectedScreen: "Connection Lost", the (kick/ban) reason, back to the title screen. */
export class DisconnectedScreen extends Screen {
  constructor(private host: { gui: Gui; quitToTitle(): void }, private reason: string) {
    super(host.gui, 'Connection Lost');
    this.pausesGame = false;
  }
  init(): void {
    const g = this.gui;
    const lines = this.reason.split('\n').length;
    this.widgets = [new Button(Math.floor(g.width / 2) - 100, Math.min(Math.floor(g.height / 2 + (lines * 9) / 2 + 9), g.height - 30), 200, 20, 'Back to Title Screen', () => this.host.quitToTitle())];
  }
  override renderBackground(): void {
    this.gui.dirtBackground();
  }
  override render(mx: number, my: number): void {
    this.renderBackground();
    const g = this.gui;
    const lines = this.reason.split('\n');
    const top = Math.floor(g.height / 2 - (lines.length * 9) / 2);
    g.centeredText(this.title, g.width / 2, top - 9 * 2, 0xaaaaaa);
    lines.forEach((l, i) => g.centeredText(l, g.width / 2, top + i * 9, 0xffffff));
    for (const w of this.widgets) if (w.visible) w.render(g, mx, my);
  }
  override keyDown(code: string): boolean {
    return code === 'Escape';
  }
}

// ------------------------------------------------------------------ in bed
/** Vanilla InBedChatScreen: the chat box stays open while sleeping, with "Leave Bed" below it. */
export class InBedChatScreen extends ChatScreen {
  constructor(host: ChatHost, private wake: () => void) {
    super(host, '');
    this.title = 'Leave Bed';
  }
  override init(): void {
    super.init();
    this.widgets = [new Button(Math.floor(this.gui.width / 2) - 100, this.gui.height - 40, 200, 20, 'Leave Bed', () => this.wake())];
  }
  override mouseDown(mx: number, my: number): void {
    for (const w of this.widgets) if (w.contains(mx, my) && w.active) return w.onClick(mx, my);
    super.mouseDown(mx, my);
  }
  protected override onEnter(): void {
    this.sendLine();
    this.clearInput();
    this.host.scrollChat(-1e9);
  }
  protected override onEscape(): void {
    this.wake();
  }
}
