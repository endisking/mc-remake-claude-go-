/**
 * AnvilScreen (vanilla 1.17.1): two inputs, the result, the rename box (50 characters, sent to
 * the server on every change) and the level cost line ("Enchantment Cost: N" green/red, or
 * "Too Expensive!" at 40+ outside creative).
 */
import { AbstractContainerScreen, EXTRA_SCREENS, displayName, type ContainerHost } from './containerscreen';
import { AnvilMenu } from '@shared/menu/anvil';
import { panel, inset, arrow } from './containerart';
import { encodeTag } from '@shared/item/stack';

export class AnvilScreen extends AbstractContainerScreen<AnvilMenu> {
  private name = '';
  private editable = false;
  private lastLeft = '';
  private caret = 0;

  constructor(host: ContainerHost, menu: AnvilMenu, title: string) {
    super(host, menu, title);
  }

  private level(): number {
    return (this.host as unknown as { xpLevel?: number }).xpLevel ?? 0;
  }

  /** AnvilScreen.slotChanged: a new left item resets the box to its name. */
  private syncName(): void {
    const left = this.menu.inputs.getItem(0);
    const key = left ? `${left.id}:${encodeTag(left.tag)}` : '';
    if (key === this.lastLeft) return;
    this.lastLeft = key;
    this.editable = !!left;
    this.name = left ? (left.tag?.display?.Name ?? displayName(left.id)) : '';
    if (left) this.send();
  }

  private send(): void {
    this.host.send({ t: 'renameItem', name: this.name });
  }

  override charTyped(ch: string): boolean {
    if (!this.editable || ch.length !== 1 || ch.charCodeAt(0) < 32 || ch === '§') return false;
    if (this.name.length >= 50) return true;
    this.name += ch;
    this.send();
    return true;
  }

  override keyDown(code: string): boolean {
    if (this.editable && code === 'Backspace') {
      this.name = this.name.slice(0, -1);
      this.send();
      return true;
    }
    // the inventory key types into the box instead of closing it
    if (this.editable && code === 'KeyE') return true;
    return super.keyDown(code);
  }

  protected renderBg(): void {
    this.syncName();
    const g = this.gui, L = this.leftPos, T = this.topPos;
    panel(g, L, T, this.imageWidth, this.imageHeight);
    this.renderSlotWells();
    // "+" between the inputs and the arrow to the result
    g.fill(L + 53, T + 52, 13, 3, 0xff8b8b8b);
    g.fill(L + 58, T + 47, 3, 13, 0xff8b8b8b);
    arrow(g, L + 99, T + 45, 22, 15);
    // rename box
    inset(g, L + 59, T + 20, 110, 16, this.editable ? 0xff000000 : 0xff3a3a3a);
    if (this.editable) {
      this.caret++;
      const shown = this.name;
      g.text(shown, L + 62, T + 24, 0xffffff, true);
      if ((this.caret >> 4) % 2 === 0) g.fill(L + 62 + g.font.width(shown), T + 23, 1, 10, 0xffd0d0d0);
    }
    // cost line
    const cost = this.menu.data[0] ?? 0;
    if (cost > 0) {
      const creative = this.host.gameMode === 1;
      let text: string, color: number;
      if (cost >= 40 && !creative) {
        text = 'Too Expensive!';
        color = 0xff6060;
      } else if (!this.menu.result.items[0]) {
        text = '';
        color = 0;
      } else {
        text = `Enchantment Cost: ${cost}`;
        color = !creative && this.level() < cost ? 0xff6060 : 0x80ff20;
      }
      if (text) {
        const w = g.font.width(text), x = L + this.imageWidth - 8 - w - 2;
        g.fill(x - 2, T + 67, w + 4, 12, 0x4f000000);
        g.text(text, x, T + 69, color, true);
      }
    }
  }
}

EXTRA_SCREENS.push((host, menu, title) => (menu instanceof AnvilMenu ? new AnvilScreen(host, menu, title) : null));
