/** Screens and widgets (vanilla-style buttons, sliders and option cycles). */
import type { Gui } from './gui';

export abstract class Widget {
  hovered = false;
  active = true;
  visible = true;
  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number,
  ) {}
  contains(mx: number, my: number): boolean {
    return this.visible && mx >= this.x && my >= this.y && mx < this.x + this.w && my < this.y + this.h;
  }
  abstract render(gui: Gui, mx: number, my: number): void;
  onClick(_mx: number, _my: number): void {}
  onDrag(_mx: number, _my: number): void {}
  onRelease(): void {}
}

export class Button extends Widget {
  constructor(
    x: number, y: number, w: number, h: number,
    public label: string,
    private action: (b: Button) => void,
  ) {
    super(x, y, w, h);
  }
  render(gui: Gui, mx: number, my: number): void {
    this.hovered = this.contains(mx, my);
    gui.button(this.x, this.y, this.w, this.h, !this.active ? 2 : this.hovered ? 1 : 0);
    gui.centeredText(this.label, this.x + this.w / 2, this.y + (this.h - 8) / 2, !this.active ? 0xa0a0a0 : this.hovered ? 0xffffa0 : 0xe0e0e0);
  }
  override onClick(): void {
    if (this.active) this.action(this);
  }
}

export class Slider extends Widget {
  private dragging = false;
  constructor(
    x: number, y: number, w: number, h: number,
    /** 0..1 */
    public value: number,
    private label: (v: number) => string,
    private onChange: (v: number) => void,
  ) {
    super(x, y, w, h);
  }
  render(gui: Gui, mx: number, my: number): void {
    this.hovered = this.contains(mx, my) || this.dragging;
    gui.button(this.x, this.y, this.w, this.h, 2);
    const hx = this.x + Math.round(this.value * (this.w - 8));
    gui.blit(gui.widgets, this.hovered ? 8 : 0, 60, 8, 20, hx, this.y);
    gui.centeredText(this.label(this.value), this.x + this.w / 2, this.y + (this.h - 8) / 2, this.hovered ? 0xffffa0 : 0xe0e0e0);
  }
  private set(mx: number): void {
    const v = Math.max(0, Math.min(1, (mx - (this.x + 4)) / (this.w - 8)));
    if (v !== this.value) {
      this.value = v;
      this.onChange(v);
    }
  }
  override onClick(mx: number): void {
    this.dragging = true;
    this.set(mx);
  }
  override onDrag(mx: number): void {
    if (this.dragging) this.set(mx);
  }
  override onRelease(): void {
    this.dragging = false;
  }
}

export abstract class Screen {
  widgets: Widget[] = [];
  /** Screens shown over the world pause single-player (vanilla isPauseScreen). */
  pausesGame = true;
  private pressed: Widget | null = null;
  constructor(
    protected gui: Gui,
    public title: string,
  ) {}

  /** (Re)build widgets for the current GUI size. */
  abstract init(): void;

  renderBackground(): void {
    this.gui.worldBackground();
  }

  render(mx: number, my: number): void {
    this.renderBackground();
    for (const w of this.widgets) if (w.visible) w.render(this.gui, mx, my);
  }

  mouseDown(mx: number, my: number): void {
    for (const w of this.widgets) {
      if (w.contains(mx, my) && w.active) {
        this.pressed = w;
        w.onClick(mx, my);
        return;
      }
    }
  }
  mouseMove(mx: number, my: number): void {
    this.pressed?.onDrag(mx, my);
  }
  mouseUp(): void {
    this.pressed?.onRelease();
    this.pressed = null;
  }
  /** Return true if the key was handled. */
  keyDown(_code: string): boolean {
    return false;
  }
  onClose(): void {}
}
