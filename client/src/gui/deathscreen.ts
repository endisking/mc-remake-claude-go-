/** Vanilla DeathScreen: "You died!", the death message, score and respawn after one second. */
import { Button, Screen } from './screen';
import type { ScreenHost } from './screens';

export interface DeathHost extends ScreenHost {
  respawn(): void;
}

export class DeathScreen extends Screen {
  private delayTicker = 0;
  constructor(
    private host: DeathHost,
    private message: string,
    private score: number,
  ) {
    super(host.gui, 'You died!');
    this.pausesGame = false;
  }

  init(): void {
    const cx = Math.floor(this.gui.width / 2), y = Math.floor(this.gui.height / 4);
    this.widgets = [
      new Button(cx - 100, y + 72, 200, 20, 'Respawn', (b) => {
        b.active = false;
        this.host.respawn();
      }),
      new Button(cx - 100, y + 96, 200, 20, 'Title Screen', () => this.host.quitToTitle()),
    ];
    for (const w of this.widgets) w.active = this.delayTicker >= 20;
  }

  /** Buttons unlock after 20 ticks. */
  tick(): void {
    if (++this.delayTicker === 20) for (const w of this.widgets) w.active = true;
  }

  override renderBackground(): void {
    const g = this.gui.ctx.createLinearGradient(0, 0, 0, this.gui.height);
    g.addColorStop(0, 'rgba(80,0,0,0.376)');
    g.addColorStop(1, 'rgba(128,48,48,0.627)');
    this.gui.ctx.fillStyle = g;
    this.gui.ctx.fillRect(0, 0, this.gui.width, this.gui.height);
  }

  override render(mx: number, my: number): void {
    this.renderBackground();
    const ctx = this.gui.ctx;
    ctx.save();
    ctx.scale(2, 2);
    this.gui.centeredText(this.title, this.gui.width / 2 / 2, 30, 0xffffff);
    ctx.restore();
    if (this.message) this.gui.centeredText(this.message, this.gui.width / 2, 85, 0xffffff);
    this.gui.centeredText(`Score: §e${this.score}`, this.gui.width / 2, 100, 0xffffff);
    for (const w of this.widgets) if (w.visible) w.render(this.gui, mx, my);
  }

  // Escape does not close the death screen
  override keyDown(code: string): boolean {
    return code === 'Escape';
  }
}
