/** Vanilla InBedChatScreen (without chat input yet): just the "Leave Bed" button. */
import { Button, Screen } from './screen';
import type { ScreenHost } from './screens';

export class InBedScreen extends Screen {
  constructor(private host: ScreenHost & { send(p: unknown): void }) {
    super(host.gui, 'Leave Bed');
    this.pausesGame = false;
  }
  init(): void {
    this.widgets = [new Button(Math.floor(this.gui.width / 2) - 100, this.gui.height - 40, 200, 20, 'Leave Bed', () => this.wake())];
  }
  private wake(): void {
    this.host.send({ t: 'stopSleeping' });
  }
  // the world (and the sleep fade) stays visible
  override renderBackground(): void {}
  override keyDown(code: string): boolean {
    if (code === 'Escape') {
      this.wake();
      return true;
    }
    return false;
  }
}
