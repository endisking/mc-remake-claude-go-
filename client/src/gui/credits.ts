/**
 * The end-of-game screen (vanilla WinScreen): after leaving the End through the exit portal for
 * the first time, an original two-voice poem and then the credits scroll up over a dark starry
 * background at 0.5 GUI pixels per tick. Escape skips; reaching the end closes it.
 * The text is Blockcraft's own (written for this project), not the vanilla poem or credits.
 */
import { Screen } from './screen';
import type { ScreenHost } from './screens';

/** Lines of the poem; `A:` / `B:` mark the two speakers (drawn in two colours), PLAYERNAME is replaced. */
export const END_POEM: readonly string[] = [
  'A: There it goes. The long one, the one with wings, is quiet now.',
  'B: Then the player has done it. I watched them do it.',
  'A: PLAYERNAME. That is the name it wears in this place.',
  'B: A small name for something that built so much.',
  'A: It began with a fist against a tree.',
  'B: Everything begins like that. Wood, and then a table, and then a door against the dark.',
  'A: It learned that the night was loud, and that a roof was a kind of promise.',
  'B: It learned that the ground goes down further than it looks.',
  'A: And that light, carried far enough, turns a cave into a hallway.',
  'B: It dug. It fell. It got up and went back for its things.',
  'A: Does it know we were watching?',
  'B: It sometimes felt it. In the hum of a cave. In the hush before rain.',
  'A: It thought the world was made of blocks.',
  'B: The world is made of blocks. It is also made of the hours spent placing them.',
  'A: Of the friends who logged in late and stayed until morning.',
  'B: Of the house that was never finished, and the farm that fed everyone anyway.',
  'A: It walked through fire to reach the cold stars at the edge of everything.',
  'B: And at the edge, it found an island, and a dragon, and a door home.',
  'A: Should we tell it what comes next?',
  'B: Nothing comes next. That is the gift. The world is still there, exactly where it was left.',
  'A: Unfinished.',
  'B: Waiting.',
  'A: Wake up, PLAYERNAME.',
  'B: The sun is rising, and there is so much left to build.',
];

export const CREDITS: readonly (readonly [string, readonly string[]])[] = [
  ['Blockcraft', ['A sandbox made by a few friends, for a few friends']],
  ['Design and Code', ['Written in TypeScript, one checkbox at a time', 'With a great deal of help from Claude']],
  ['Art', ['Every texture drawn in code by /tools/texgen', 'Pixel by pixel, top-left light, no tracing']],
  ['Sound and Music', ['Recorded and composed by the generous people', 'of the CC0 and Creative Commons community', 'See ASSET_SOURCES.md for every name']],
  ['Game Data', ['PrismarineJS minecraft-data (MIT)', 'and the contributors of the Minecraft Wiki']],
  ['Playtesting', ['Everyone who fell in lava so others would not have to']],
  ['Special Thanks', ['School laptops that ran it anyway', 'Late nights, early mornings', 'And you, for playing']],
];

const SPEED = 0.5;

export class CreditsScreen extends Screen {
  private time = 0;
  private lines: { text: string; color: number; center: boolean }[] = [];
  private total = 0;

  constructor(
    host: ScreenHost,
    private readonly playerName: string,
    private readonly onDone: () => void,
  ) {
    super(host.gui, 'Credits');
  }

  init(): void {
    const width = 274;
    const wrap = (s: string): string[] => {
      const out: string[] = [];
      let line = '';
      for (const word of s.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (this.gui.font.width(next) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      if (line) out.push(line);
      return out;
    };
    this.lines = [];
    for (const raw of END_POEM) {
      const speakerA = raw.startsWith('A:');
      const text = raw.slice(2).trim().replaceAll('PLAYERNAME', this.playerName);
      for (const l of wrap(text)) this.lines.push({ text: l, color: speakerA ? 0x55ffff : 0x55ff55, center: false });
      this.lines.push({ text: '', color: 0, center: false });
    }
    for (let i = 0; i < 6; i++) this.lines.push({ text: '', color: 0, center: false });
    for (const [title, names] of CREDITS) {
      this.lines.push({ text: title, color: 0xffff55, center: true });
      for (const n of names) this.lines.push({ text: n, color: 0xffffff, center: true });
      this.lines.push({ text: '', color: 0, center: false });
      this.lines.push({ text: '', color: 0, center: false });
    }
    this.total = this.lines.length * 12 + 100;
  }

  override tick(): void {
    this.time++;
    if (this.time * SPEED > this.total + this.gui.height + 24) this.finish();
  }

  private finished = false;
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.onDone();
  }

  override renderBackground(): void {
    const ctx = this.gui.ctx;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.gui.width, this.gui.height);
  }

  override render(): void {
    this.renderBackground();
    const ctx = this.gui.ctx;
    const scroll = this.time * SPEED;
    const left = Math.floor(this.gui.width / 2 - 137);
    let y = this.gui.height + 50 - scroll;
    // title block
    ctx.save();
    ctx.scale(3, 3);
    this.gui.centeredText('BLOCKCRAFT', this.gui.width / 2 / 3, y / 3, 0xffffff);
    ctx.restore();
    y += 100;
    for (const l of this.lines) {
      if (y > -12 && y < this.gui.height + 12 && l.text) {
        if (l.center) this.gui.centeredText(l.text, this.gui.width / 2, y, l.color);
        else this.gui.text(l.text, left, y, l.color);
      }
      y += 12;
    }
    // vanilla fades the edges with a vignette; a soft gradient at top and bottom
    const g = ctx.createLinearGradient(0, 0, 0, this.gui.height);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.12, 'rgba(0,0,0,0)');
    g.addColorStop(0.88, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.gui.width, this.gui.height);
  }

  /** Escape skips the credits (WinScreen.onClose → respawn). */
  override keyDown(code: string): boolean {
    if (code === 'Escape') {
      this.finish();
      return true;
    }
    return false;
  }
}
