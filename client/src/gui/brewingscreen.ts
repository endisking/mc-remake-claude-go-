/**
 * BrewingStandScreen (vanilla 1.17.1): three bottle slots, ingredient, blaze powder fuel bar
 * (fuel/20 of 18 px), the brewing arrow (28 px tall, filling over 400 ticks) and the bubbles
 * (BUBBLELENGTHS, cycling every 12 frames).
 */
import { AbstractContainerScreen, EXTRA_SCREENS, type ContainerHost } from './containerscreen';
import { BrewingStandMenu } from '@shared/menu/brewing';
import { panel, inset } from './containerart';

const BUBBLE_LENGTHS = [29, 24, 20, 16, 11, 6, 0];

export class BrewingStandScreen extends AbstractContainerScreen<BrewingStandMenu> {
  constructor(host: ContainerHost, menu: BrewingStandMenu, title: string) {
    super(host, menu, title);
  }

  protected renderBg(): void {
    const g = this.gui, L = this.leftPos, T = this.topPos;
    panel(g, L, T, this.imageWidth, this.imageHeight);
    this.renderSlotWells();
    // fuel bar under the blaze powder slot
    const fuel = Math.max(0, Math.min(18, Math.floor((18 * this.menu.fuel + 20 - 1) / 20)));
    inset(g, L + 60, T + 44, 20, 6, 0xff2a2a2a);
    if (fuel > 0) g.fill(L + 61, T + 45, fuel, 4, 0xffe0a020);
    // tubes from the ingredient to the bottles
    g.fill(L + 63, T + 26, 2, 16, 0xff6b6b6b);
    g.fill(L + 111, T + 26, 2, 16, 0xff6b6b6b);
    g.fill(L + 87, T + 37, 2, 14, 0xff6b6b6b);
    const bt = this.menu.brewTime;
    if (bt > 0) {
      // brewing arrow (down, 9×28) and bubbles (12×29)
      const len = Math.floor(28 * (1 - bt / 400));
      inset(g, L + 97, T + 16, 9, 28, 0xff3c3c3c);
      if (len > 0) g.fill(L + 98, T + 17, 7, len, 0xffffffff);
      const b = BUBBLE_LENGTHS[Math.floor(bt / 2) % 7]!;
      if (b > 0) {
        for (let i = 0; i < 4; i++) {
          const yy = T + 14 + 29 - b + i * 7;
          if (yy < T + 14 + 29) g.fill(L + 65 + (i % 2) * 4, yy, 3, 3, 0xffd8f0ff);
        }
      }
    }
  }
}

EXTRA_SCREENS.push((host, menu, title) => (menu instanceof BrewingStandMenu ? new BrewingStandScreen(host, menu, title) : null));
