/**
 * Enchanting table window (vanilla EnchantmentScreen): item and lapis slots, the three offers
 * with their level costs, the "clue" tooltip, and the player inventory. Until the shared
 * container framework lands, slots move items by plain clicks (inventory → table slot and
 * back, like shift-clicking) through the enchantAction packet; the server is authoritative.
 */
import { Screen } from './screen';
import type { Gui } from './gui';
import type { EffectsClient } from '../effects';
import type { Inventory, ItemStack } from '@shared/item/stack';
import { ENCH_BY_ID, enchantmentLine } from '@shared/game/enchantments';
import { ITEMS_BY_NAME } from '@shared/data';
import { drawItemStack } from './itemicons';
import { JavaRandom } from '@shared/util/random';

export interface EnchantHost {
  gui: Gui;
  inventory: Inventory;
  xpLevel(): number;
  creative(): boolean;
  sendEnchantAction(action: number, button: number, slot: number): void;
  setScreen(s: Screen | null): void;
}

const LAPIS = ITEMS_BY_NAME.get('lapis_lazuli')?.id ?? -1;

/** Original made-up words for the offer labels (vanilla draws random words in an alien script). */
const WORDS = 'thar vel orun kesh ama dru zin ulo fey mor quil brax ein soth vay runa dal ixi pem gol tov sae ny kru elm zah obi faro lin ceth wyn ur dask hollo mire pyr quen tal vosh yrr aum bel cin drae'.split(' ');

/** EnchantmentNames.getRandomName: 3–5 random words cut to the offer width. */
function randomName(r: JavaRandom, g: Gui, width: number): string {
  const n = r.nextInt(2) + 3;
  let s = '';
  for (let i = 0; i < n; i++) {
    if (i > 0) s += ' ';
    s += WORDS[r.nextInt(WORDS.length)];
  }
  while (s.length > 0 && g.font.width(s) > width) s = s.slice(0, -1);
  return s;
}

export class EnchantScreen extends Screen {
  private tex: ImageBitmap | null = null;
  private left = 0;
  private top = 0;

  constructor(private readonly host: EnchantHost, private readonly fx: EffectsClient) {
    super(host.gui, 'Enchant');
    void fetch('./textures/gui/enchanting_table.png').then((r) => r.blob()).then((b) => createImageBitmap(b)).then((b) => (this.tex = b)).catch(() => {});
  }

  init(): void {
    this.left = Math.floor((this.gui.width - 176) / 2);
    this.top = Math.floor((this.gui.height - 166) / 2);
  }

  override onClose(): void {
    this.host.sendEnchantAction(3, 0, 0);
  }

  override keyDown(code: string): boolean {
    if (code === 'Escape' || code === 'KeyE') {
      this.host.setScreen(null);
      return true;
    }
    return false;
  }

  /** inventory slot under the mouse (0–35), or −1 */
  private invSlotAt(mx: number, my: number): number {
    for (let i = 0; i < 36; i++) {
      const [x, y] = this.invSlotPos(i);
      if (mx >= x - 1 && my >= y - 1 && mx < x + 17 && my < y + 17) return i;
    }
    return -1;
  }

  private invSlotPos(i: number): [number, number] {
    if (i < 9) return [this.left + 8 + i * 18, this.top + 142];
    const r = Math.floor((i - 9) / 9), c = (i - 9) % 9;
    return [this.left + 8 + c * 18, this.top + 84 + r * 18];
  }

  private inBox(mx: number, my: number, x: number, y: number, w: number, h: number): boolean {
    return mx >= x && my >= y && mx < x + w && my < y + h;
  }

  override mouseDown(mx: number, my: number): void {
    const st = this.fx.enchant;
    if (!st) return;
    const L = this.left, T = this.top;
    for (let l = 0; l < 3; l++) {
      if (this.inBox(mx, my, L + 60, T + 14 + 19 * l, 108, 19)) {
        if (this.enabled(l)) this.host.sendEnchantAction(0, l, 0);
        return;
      }
    }
    if (this.inBox(mx, my, L + 15, T + 47, 16, 16)) return this.host.sendEnchantAction(1, 0, -1);
    if (this.inBox(mx, my, L + 35, T + 47, 16, 16)) return this.host.sendEnchantAction(2, 0, -1);
    const slot = this.invSlotAt(mx, my);
    if (slot >= 0) {
      const s = this.host.inventory.get(slot);
      if (!s) return;
      this.host.sendEnchantAction(s.id === LAPIS ? 2 : 1, 0, slot);
    }
  }

  private enabled(l: number): boolean {
    const st = this.fx.enchant!;
    const cost = st.costs[l] ?? 0;
    if (cost <= 0) return false;
    if (this.host.creative()) return true;
    return st.lapis >= l + 1 && this.host.xpLevel() >= cost;
  }

  override render(mx: number, my: number): void {
    const g = this.gui;
    g.fill(0, 0, g.width, g.height, 0xc0101010);
    const st = this.fx.enchant;
    const L = this.left, T = this.top;
    if (this.tex) g.blit(this.tex, 0, 0, 176, 166, L, T);
    g.text('Enchant', L + 12, T + 5, 0x404040, false);
    g.text('Inventory', L + 8, T + 166 - 94, 0x404040, false);
    if (!st) return;
    // offers
    const r = new JavaRandom(BigInt(st.seed));
    let hover = -1;
    for (let l = 0; l < 3; l++) {
      const x = L + 60, y = T + 14 + 19 * l;
      const cost = st.costs[l] ?? 0;
      const over = this.inBox(mx, my, x, y, 108, 19);
      if (over) hover = l;
      if (cost === 0) {
        if (this.tex) g.blit(this.tex, 0, 204, 108, 19, x, y);
        continue;
      }
      const label = String(cost);
      const words = randomName(r, g, 86 - g.font.width(label));
      const ok = this.enabled(l);
      if (this.tex) g.blit(this.tex, 0, ok ? (over ? 185 : 166) : 204, 108, 19, x, y);
      if (this.tex) g.blit(this.tex, l * 16 + (ok ? 0 : 48), 223, 16, 16, x + 1, y + 1);
      g.text(words, x + 20, y + 2, ok ? (over ? 0xffff80 : 0x685e4a) : 0x342f25, false);
      g.text(label, x + 106 - g.font.width(label), y + 9, ok ? 0x80ff20 : 0x407f10, true);
    }
    // slots
    const item: ItemStack | null = st.item;
    if (item) drawItemStack(g, item, L + 15, T + 47);
    if (st.lapis > 0) drawItemStack(g, { id: LAPIS, count: st.lapis, damage: 0 }, L + 35, T + 47);
    for (let i = 0; i < 36; i++) {
      const s = this.host.inventory.get(i);
      const [x, y] = this.invSlotPos(i);
      if (s) drawItemStack(g, s, x, y);
    }
    const hs = this.invSlotAt(mx, my);
    if (hs >= 0) {
      const [x, y] = this.invSlotPos(hs);
      g.fill(x, y, 16, 16, 0x80ffffff);
    }
    // clue tooltip
    if (hover >= 0 && (st.costs[hover] ?? 0) > 0) {
      const lines: [string, number][] = [];
      const e = ENCH_BY_ID[st.clues[hover] ?? -1];
      if (e && (st.levels[hover] ?? -1) >= 0) lines.push([`${enchantmentLine(e.name, st.levels[hover]!)} . . . ?`, 0xffffff]);
      if (!this.host.creative()) {
        if (lines.length) lines.push(['', 0xffffff]);
        const cost = st.costs[hover]!;
        const n = hover + 1;
        if (this.host.xpLevel() < cost) lines.push([`Level Requirement: ${cost}`, 0xff5555]);
        else {
          lines.push([n === 1 ? '1 Lapis Lazuli' : `${n} Lapis Lazuli`, st.lapis >= n ? 0xaaaaaa : 0xff5555]);
          lines.push([n === 1 ? '1 Enchantment Level' : `${n} Enchantment Levels`, 0xaaaaaa]);
        }
      }
      if (lines.length) {
        const w = Math.max(...lines.map(([t]) => g.font.width(t)));
        const x = mx + 12, y = my - 12, h = lines.length * 10 - 2;
        g.fill(x - 3, y - 4, w + 6, h + 8, 0xf0100010);
        g.fill(x - 3, y - 4, w + 6, 1, 0x505000ff);
        g.fill(x - 3, y + h + 3, w + 6, 1, 0x5028007f);
        lines.forEach(([t, c], i) => g.text(t, x, y + i * 10, c));
      }
    }
  }
}
