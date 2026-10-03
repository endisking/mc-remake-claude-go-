/**
 * In-game HUD (vanilla Gui): hotbar with item icons and the selected-item name, health with
 * blink/regeneration/low-health shake, armour, hunger with the saturation shake, air bubbles
 * and the experience bar with level number.
 */
import type { Gui } from './gui';
import { JavaRandom } from '@shared/util/random';
import { ITEMS_BY_ID } from '@shared/data';
import { itemName, type Inventory } from '@shared/item/stack';

export interface HudPlayer {
  gameMode: number;
  health: number;
  maxHealth: number;
  absorption: number;
  armor: number;
  food: number;
  saturation: number;
  air: number;
  maxAir: number;
  eyeInWater: boolean;
  invulnerableTime: number;
  xpProgress: number;
  xpLevel: number;
  inventory: Inventory;
  /** heart style: normal, poisoned, withered, frozen */
  heartType: 'normal' | 'poisoned' | 'withered' | 'frozen';
  hardcore: boolean;
  regeneration: boolean;
  hungerEffect: boolean;
}

const HEART_INDEX = { container: 0, normal: 2, poisoned: 4, withered: 6, absorbing: 8, frozen: 9 } as const;
const HEART_BLINKS = { container: true, normal: true, poisoned: true, withered: true, absorbing: false, frozen: false } as const;

function heartU(type: keyof typeof HEART_INDEX, half: boolean, blinking: boolean): number {
  let i: number;
  if (type === 'container') i = blinking ? 1 : 0;
  else i = (half ? 1 : 0) + (HEART_BLINKS[type] && blinking ? 2 : 0);
  return 16 + (HEART_INDEX[type] * 2 + i) * 9;
}

export class Hud {
  icons!: ImageBitmap;
  private tickCount = 0;
  private readonly random = new JavaRandom(0n);
  // health display state (Gui.lastHealth / displayHealth / healthBlinkTime)
  private lastHealth = 0;
  private displayHealth = 0;
  private lastHealthTime = 0;
  private healthBlinkTime = 0;
  // selected item name (Gui.toolHighlightTimer)
  private highlightTimer = 0;
  private highlightName = '';
  private lastHighlight = '';

  async load(): Promise<void> {
    this.icons = await createImageBitmap(await (await fetch('./textures/gui/icons.png')).blob());
  }

  tick(inv: Inventory): void {
    this.tickCount++;
    const st = inv.selectedStack;
    const key = st ? String(st.id) : '';
    if (!st) this.highlightTimer = 0;
    else if (key !== this.lastHighlight) {
      this.highlightName = ITEMS_BY_ID[st.id]?.displayName ?? itemName(st.id);
      this.highlightTimer = 40;
    } else if (this.highlightTimer > 0) this.highlightTimer--;
    this.lastHighlight = key;
  }

  render(g: Gui, p: HudPlayer, item: (id: number, count: number, x: number, y: number) => void): void {
    if (p.gameMode === 3) return; // spectators get the spectator menu instead (not yet)
    const mid = Math.floor(g.width / 2);
    // hotbar
    const inv = p.inventory;
    g.blit(g.widgets, 0, 80, 182, 22, mid - 91, g.height - 22);
    g.blit(g.widgets, 0, 104, 24, 22, mid - 91 - 1 + inv.selected * 20, g.height - 22 - 1);
    for (let i = 0; i < 9; i++) {
      const st = inv.get(i);
      if (st) item(st.id, st.count, mid - 90 + i * 20 + 2, g.height - 16 - 3);
    }
    const survival = p.gameMode === 0 || p.gameMode === 2;
    if (survival) {
      this.renderPlayerHealth(g, p);
      this.renderExperienceBar(g, p);
    }
    // selected item name
    if (this.highlightTimer > 0 && this.highlightName) {
      const k = g.height - 59 + (survival ? 0 : 14);
      const alpha = Math.min(255, Math.floor((this.highlightTimer * 256) / 10));
      if (alpha > 0) {
        g.ctx.save();
        g.ctx.globalAlpha = alpha / 255;
        g.centeredText(this.highlightName, mid, k, 0xffffff);
        g.ctx.restore();
      }
    }
  }

  private icon(g: Gui, x: number, y: number, u: number, v: number, w = 9, h = 9): void {
    g.blit(this.icons, u, v, w, h, x, y);
  }

  private renderPlayerHealth(g: Gui, p: HudPlayer): void {
    const i = Math.ceil(p.health);
    const blink = this.healthBlinkTime > this.tickCount && Math.floor((this.healthBlinkTime - this.tickCount) / 3) % 2 === 1;
    const now = performance.now();
    if (i < this.lastHealth && p.invulnerableTime > 0) {
      this.lastHealthTime = now;
      this.healthBlinkTime = this.tickCount + 20;
    } else if (i > this.lastHealth && p.invulnerableTime > 0) {
      this.lastHealthTime = now;
      this.healthBlinkTime = this.tickCount + 10;
    }
    if (now - this.lastHealthTime > 1000) {
      this.lastHealth = i;
      this.displayHealth = i;
      this.lastHealthTime = now;
    }
    this.lastHealth = i;
    const k = this.displayHealth;
    this.random.setSeed(BigInt(this.tickCount * 312871));
    const l = p.food;
    const i1 = Math.floor(g.width / 2) - 91, j1 = Math.floor(g.width / 2) + 91;
    const k1 = g.height - 39;
    const f = Math.max(p.maxHealth, Math.max(k, i));
    const l1 = Math.ceil(p.absorption);
    const i2 = Math.ceil((f + l1) / 2 / 10);
    const j2 = Math.max(10 - (i2 - 2), 3);
    const k2 = k1 - (i2 - 1) * j2 - 10;
    let l2 = k1 - 10;
    const i3 = p.armor;
    const j3 = p.regeneration ? this.tickCount % Math.ceil(f + 5) : -1;
    // armour
    for (let k3 = 0; k3 < 10; k3++) {
      if (i3 <= 0) break;
      const l3 = i1 + k3 * 8;
      if (k3 * 2 + 1 < i3) this.icon(g, l3, k2, 34, 9);
      if (k3 * 2 + 1 === i3) this.icon(g, l3, k2, 25, 9);
      if (k3 * 2 + 1 > i3) this.icon(g, l3, k2, 16, 9);
    }
    this.renderHearts(g, p, i1, k1, j2, j3, f, i, k, l1, blink);
    // food
    for (let l6 = 0; l6 < 10; l6++) {
      let j7 = k1;
      let l7 = 16, j8 = 0;
      if (p.hungerEffect) {
        l7 += 36;
        j8 = 13;
      }
      if (p.saturation <= 0 && this.tickCount % (l * 3 + 1) === 0) j7 = k1 + (this.random.nextInt(3) - 1);
      const l8 = j1 - l6 * 8 - 9;
      this.icon(g, l8, j7, 16 + j8 * 9, 27);
      if (l6 * 2 + 1 < l) this.icon(g, l8, j7, l7 + 36, 27);
      if (l6 * 2 + 1 === l) this.icon(g, l8, j7, l7 + 45, 27);
    }
    l2 -= 10;
    // air
    const k7 = Math.min(p.air, p.maxAir);
    if (p.eyeInWater || k7 < p.maxAir) {
      const k8 = Math.ceil(((k7 - 2) * 10) / p.maxAir);
      const i9 = Math.ceil((k7 * 10) / p.maxAir) - k8;
      for (let k9 = 0; k9 < k8 + i9; k9++) this.icon(g, j1 - k9 * 8 - 9, l2, k9 < k8 ? 16 : 25, 18);
    }
  }

  private renderHearts(g: Gui, p: HudPlayer, x: number, y: number, rowHeight: number, regenHeart: number, maxHealth: number, health: number, displayHealth: number, absorption: number, blink: boolean): void {
    const type = p.heartType;
    const v = p.hardcore ? 45 : 0;
    const j = Math.ceil(maxHealth / 2);
    const k = Math.ceil(absorption / 2);
    const l = j * 2;
    for (let i1 = j + k - 1; i1 >= 0; i1--) {
      const j1 = Math.floor(i1 / 10), k1 = i1 % 10;
      const l1 = x + k1 * 8;
      let i2 = y - j1 * rowHeight;
      if (health + absorption <= 4) i2 += this.random.nextInt(2);
      if (i1 < j && i1 === regenHeart) i2 -= 2;
      this.icon(g, l1, i2, heartU('container', false, blink), v);
      const j2 = i1 * 2;
      if (i1 >= j) {
        const k2 = j2 - l;
        if (k2 < absorption) this.icon(g, l1, i2, heartU(type === 'withered' ? type : 'absorbing', k2 + 1 === absorption, false), v);
      }
      if (blink && j2 < displayHealth) this.icon(g, l1, i2, heartU(type, j2 + 1 === displayHealth, true), v);
      if (j2 < health) this.icon(g, l1, i2, heartU(type, j2 + 1 === health, false), v);
    }
  }

  private renderExperienceBar(g: Gui, p: HudPlayer): void {
    const x = Math.floor(g.width / 2) - 91;
    const k = Math.floor(p.xpProgress * 183);
    const l = g.height - 32 + 3;
    this.icon(g, x, l, 0, 64, 182, 5);
    if (k > 0) this.icon(g, x, l, 0, 69, k, 5);
    if (p.xpLevel > 0) {
      const s = String(p.xpLevel);
      const i1 = Math.floor((g.width - g.font.width(s)) / 2);
      const j1 = g.height - 31 - 4;
      g.text(s, i1 + 1, j1, 0, false);
      g.text(s, i1 - 1, j1, 0, false);
      g.text(s, i1, j1 + 1, 0, false);
      g.text(s, i1, j1 - 1, 0, false);
      g.text(s, i1, j1, 0x80ff20, false);
    }
  }
}
