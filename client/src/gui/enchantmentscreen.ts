/**
 * EnchantmentScreen (vanilla 1.17.1) on the container framework: item and lapis slots, the
 * three offers with level orbs, costs and made-up "enchanting words", and the clue tooltip.
 */
import { AbstractContainerScreen, EXTRA_SCREENS, type ContainerHost } from './containerscreen';
import { EnchantmentMenu } from '@shared/menu/enchanting';
import { panel, inset, tooltip } from './containerart';
import { ENCH_BY_ID, enchantmentLine } from '@shared/game/enchantments';
import { JavaRandom } from '@shared/util/random';
import type { Gui } from './gui';

/** Original word list (vanilla draws random words in an alien script; ours are made up). */
const WORDS = 'thar vel orun kesh ama dru zin ulo fey mor quil brax ein soth vay runa dal ixi pem gol tov sae ny kru elm zah obi faro lin ceth wyn ur dask hollo mire pyr quen tal vosh yrr aum bel cin drae'.split(' ');

/** EnchantmentNames.getRandomName: 3–4 random words cut to the offer width. */
export function enchantingWords(r: JavaRandom, g: Gui, width: number): string {
  const n = r.nextInt(2) + 3;
  let s = '';
  for (let i = 0; i < n; i++) {
    if (i > 0) s += ' ';
    s += WORDS[r.nextInt(WORDS.length)];
  }
  while (s.length > 0 && g.font.width(s) > width) s = s.slice(0, -1);
  return s;
}

let tex: ImageBitmap | null = null;
let loading = false;
function texture(): ImageBitmap | null {
  if (!tex && !loading && typeof fetch !== 'undefined') {
    loading = true;
    void fetch('./textures/gui/enchanting_table.png').then((r) => r.blob()).then((b) => createImageBitmap(b)).then((b) => (tex = b)).catch(() => {});
  }
  return tex;
}

export class EnchantmentScreen extends AbstractContainerScreen<EnchantmentMenu> {
  constructor(host: ContainerHost, menu: EnchantmentMenu, title: string) {
    super(host, menu, title);
    texture();
  }

  private level(): number {
    return (this.host as unknown as { xpLevel?: number }).xpLevel ?? 0;
  }

  private lapis(): number {
    return this.menu.enchantSlots.getItem(1)?.count ?? 0;
  }

  private enabled(l: number): boolean {
    const cost = this.menu.data[l] ?? 0;
    if (cost <= 0) return false;
    if (this.host.gameMode === 1) return true;
    return this.lapis() >= l + 1 && this.level() >= cost;
  }

  protected renderBg(mx: number, my: number): void {
    const g = this.gui, L = this.leftPos, T = this.topPos;
    panel(g, L, T, this.imageWidth, this.imageHeight);
    this.renderSlotWells();
    inset(g, L + 59, T + 13, 110, 59, 0xff8b8b8b);
    const t = texture();
    const r = new JavaRandom(BigInt(this.menu.data[3] ?? 0));
    for (let l = 0; l < 3; l++) {
      const x = L + 60, y = T + 14 + 19 * l;
      const cost = this.menu.data[l] ?? 0;
      const over = mx >= x && my >= y && mx < x + 108 && my < y + 19;
      if (cost === 0) {
        if (t) g.blit(t, 0, 204, 108, 19, x, y);
        else g.fill(x, y, 108, 19, 0xff6c6658);
        continue;
      }
      const label = String(cost);
      const words = enchantingWords(r, g, 86 - g.font.width(label));
      const ok = this.enabled(l);
      if (t) {
        g.blit(t, 0, ok ? (over ? 185 : 166) : 204, 108, 19, x, y);
        g.blit(t, l * 16 + (ok ? 0 : 48), 223, 16, 16, x + 1, y + 1);
      } else g.fill(x, y, 108, 19, ok ? 0xffb9a77f : 0xff6c6658);
      g.text(words, x + 20, y + 2, ok ? (over ? 0xffff80 : 0x685e4a) : 0x342f25, false);
      g.text(label, x + 106 - g.font.width(label), y + 9, ok ? 0x80ff20 : 0x407f10, true);
    }
  }

  protected override renderExtra(mx: number, my: number): void {
    const L = this.leftPos, T = this.topPos;
    const creative = this.host.gameMode === 1;
    for (let l = 0; l < 3; l++) {
      const x = L + 60, y = T + 14 + 19 * l;
      if (!(mx >= x && my >= y && mx < x + 108 && my < y + 19)) continue;
      const cost = this.menu.data[l] ?? 0;
      const e = ENCH_BY_ID[this.menu.data[4 + l] ?? -1];
      const lvl = this.menu.data[7 + l] ?? -1;
      if (cost <= 0 || !e || lvl < 0) return;
      const lines = [`§f${enchantmentLine(e.name, lvl)} . . . ?`];
      if (!creative) {
        lines.push('');
        const n = l + 1;
        if (this.level() < cost) lines.push(`§cLevel Requirement: ${cost}`);
        else {
          lines.push(`${this.lapis() >= n ? '§7' : '§c'}${n === 1 ? '1 Lapis Lazuli' : `${n} Lapis Lazuli`}`);
          lines.push(`§7${n === 1 ? '1 Enchantment Level' : `${n} Enchantment Levels`}`);
        }
      }
      tooltip(this.gui, lines, mx, my);
      return;
    }
  }

  protected override mouseClickedExtra(mx: number, my: number, button: number): boolean {
    if (button !== 0) return false;
    for (let l = 0; l < 3; l++) {
      const x = this.leftPos + 60, y = this.topPos + 14 + 19 * l;
      if (mx >= x && my >= y && mx < x + 108 && my < y + 19) {
        if (this.enabled(l)) this.host.send({ t: 'menuButton', windowId: this.menu.containerId, button: l });
        return true;
      }
    }
    return false;
  }
}

EXTRA_SCREENS.push((host, menu, title) => (menu instanceof EnchantmentMenu ? new EnchantmentScreen(host, menu, title) : null));
