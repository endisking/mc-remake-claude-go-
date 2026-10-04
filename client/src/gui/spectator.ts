/**
 * Spectator hotbar menu (vanilla SpectatorGui / SpectatorMenu): number keys, the scroll wheel
 * and middle click pick a slot, pressing the selected slot again uses it. The root page offers
 * "Teleport to Player" (every non-spectator online, by face) and "Teleport to Team Member".
 */
import type { Gui } from './gui';

export interface PlayerInfoEntry {
  id: number;
  name: string;
  skin: string;
  gameMode: number;
}

export interface SpectatorHost {
  playerInfo: Map<number, PlayerInfoEntry>;
  /** skin image for a player's face (null while loading) */
  skinImage(name: string, skin: string): ImageBitmap | null;
  teleportTo(id: number): void;
  hotbarKeyName(slot: number): string;
}

interface MenuItem {
  name: string;
  enabled: boolean;
  icon(g: Gui, x: number, y: number, tex: ImageBitmap): void;
  select(menu: SpectatorMenu): void;
}

interface Category {
  prompt: string;
  items: MenuItem[];
}

const EMPTY: MenuItem = { name: '', enabled: false, icon: () => {}, select: () => {} };

class SpectatorMenu {
  page = 0;
  selectedSlot = -1;
  category: Category;
  constructor(
    readonly host: SpectatorHost,
    readonly onClose: () => void,
  ) {
    this.category = rootCategory(host);
  }

  private readonly close: MenuItem = {
    name: 'Close Menu', enabled: true,
    icon: (g, x, y, t) => g.blit(t, 128, 0, 16, 16, x, y),
    select: (m) => m.exit(),
  };
  private scroll(dir: number, enabled: boolean): MenuItem {
    return {
      name: dir < 0 ? 'Previous Page' : 'Next Page', enabled,
      icon: (g, x, y, t) => g.blit(t, dir < 0 ? 144 : 160, 0, 16, 16, x, y),
      select: (m) => {
        m.page += dir;
      },
    };
  }

  /** SpectatorMenu.getItem: 7 items per page, arrows in slots 0 and 7, close in slot 8. */
  getItem(slot: number): MenuItem {
    const i = slot + this.page * 6;
    if (this.page > 0 && slot === 0) return this.scroll(-1, true);
    if (slot === 7) return this.scroll(1, i < this.category.items.length);
    if (slot === 8) return this.close;
    return i >= 0 && i < this.category.items.length ? this.category.items[i]! : EMPTY;
  }

  get selectedItem(): MenuItem {
    return this.selectedSlot >= 0 ? this.getItem(this.selectedSlot) : EMPTY;
  }

  selectSlot(slot: number): void {
    const item = this.getItem(slot);
    if (item === EMPTY) return;
    if (this.selectedSlot === slot && item.enabled) item.select(this);
    else this.selectedSlot = slot;
  }

  selectCategory(c: Category): void {
    this.category = c;
    this.selectedSlot = -1;
    this.page = 0;
  }

  exit(): void {
    this.onClose();
  }
}

function rootCategory(host: SpectatorHost): Category {
  const players = [...host.playerInfo.values()].filter((p) => p.gameMode !== 3).sort((a, b) => a.id - b.id);
  const teleport: Category = {
    prompt: 'Select a player to teleport to',
    items: players.map((p) => ({
      name: p.name, enabled: true,
      icon: (g: Gui, x: number, y: number) => {
        // PlayerMenuItem: the face and hat layer at 12×12
        const skin = host.skinImage(p.name, p.skin);
        if (!skin) return;
        g.blit(skin, 8, 8, 8, 8, x + 2, y + 2, 12, 12);
        g.blit(skin, 40, 8, 8, 8, x + 2, y + 2, 12, 12);
      },
      select: () => host.teleportTo(p.id),
    })),
  };
  const team: Category = { prompt: 'Select a team to teleport to', items: [] };
  return {
    prompt: 'Press a key to select a command, and again to use it.',
    items: [
      { name: 'Teleport to Player', enabled: teleport.items.length > 0, icon: (g, x, y, t) => g.blit(t, 0, 0, 16, 16, x, y), select: (m) => m.selectCategory(teleport) },
      // scoreboard teams with members (none until teams exist)
      { name: 'Teleport to Team Member', enabled: team.items.length > 0, icon: (g, x, y, t) => g.blit(t, 16, 0, 16, 16, x, y), select: (m) => m.selectCategory(team) },
    ],
  };
}

export class SpectatorGui {
  private menu: SpectatorMenu | null = null;
  private lastSelectionTime = 0;
  tex: ImageBitmap | null = null;

  constructor(private host: SpectatorHost) {}

  async load(): Promise<void> {
    this.tex = await createImageBitmap(await (await fetch('./textures/gui/spectator_widgets.png')).blob());
  }

  get menuActive(): boolean {
    return this.menu !== null;
  }

  private alpha(): number {
    const i = this.lastSelectionTime - performance.now() + 5000;
    return Math.max(0, Math.min(1, i / 2000));
  }

  onHotbarSelected(slot: number): void {
    this.lastSelectionTime = performance.now();
    if (this.menu) this.menu.selectSlot(slot);
    else this.menu = new SpectatorMenu(this.host, () => (this.menu = null));
  }

  onMouseScrolled(dir: number): void {
    if (!this.menu) return;
    let j = this.menu.selectedSlot + dir;
    while (j >= 0 && j <= 8 && (this.menu.getItem(j) === EMPTY || !this.menu.getItem(j).enabled)) j += dir;
    if (j >= 0 && j <= 8) {
      this.menu.selectSlot(j);
      this.lastSelectionTime = performance.now();
    }
  }

  onMouseMiddleClick(): void {
    this.lastSelectionTime = performance.now();
    if (this.menu) {
      const i = this.menu.selectedSlot;
      if (i !== -1) this.menu.selectSlot(i);
    } else this.menu = new SpectatorMenu(this.host, () => (this.menu = null));
  }

  /** Closes when leaving spectator mode. */
  reset(): void {
    this.menu = null;
  }

  renderHotbar(g: Gui): void {
    if (!this.menu || !this.tex) return;
    const a = this.alpha();
    if (a <= 0) {
      this.menu.exit();
      return;
    }
    const mid = Math.floor(g.width / 2), y = g.height - 22;
    const ctx = g.ctx;
    ctx.save();
    ctx.globalAlpha = a;
    g.blit(g.widgets, 0, 80, 182, 22, mid - 91, y);
    if (this.menu.selectedSlot >= 0) g.blit(g.widgets, 0, 104, 24, 22, mid - 91 - 1 + this.menu.selectedSlot * 20, y - 1);
    for (let i = 0; i < 9; i++) {
      const item = this.menu.getItem(i);
      if (item === EMPTY) continue;
      const x = mid - 90 + i * 20 + 2, iy = y + 3;
      // disabled entries are drawn at a quarter brightness
      ctx.save();
      if (!item.enabled) ctx.filter = 'brightness(25%)';
      item.icon(g, x, iy, this.tex);
      ctx.restore();
      if (item.enabled) {
        const key = this.host.hotbarKeyName(i);
        g.text(key, x + 19 - 2 - g.font.width(key), iy + 6 + 3, 0xffffff, true);
      }
    }
    ctx.restore();
  }

  /** Item name or the category prompt above the hotbar. */
  renderTooltip(g: Gui): void {
    const a = Math.floor(this.alpha() * 255);
    if (a <= 3 || !this.menu) return;
    const item = this.menu.selectedItem;
    const text = item === EMPTY ? this.menu.category.prompt : item.name;
    if (!text) return;
    g.ctx.save();
    g.ctx.globalAlpha = a / 255;
    g.text(text, Math.floor((g.width - g.font.width(text)) / 2), g.height - 35, 0xffffff, true);
    g.ctx.restore();
  }
}
