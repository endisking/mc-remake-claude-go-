/** Vanilla GenericDirtMessageScreen: a dirt background with one centred line ("Saving world"). */
import { Screen } from './screen';
import type { Gui } from './gui';

export class MessageScreen extends Screen {
  constructor(gui: Gui, title: string) {
    super(gui, title);
  }

  init(): void {
    this.widgets = [];
  }

  override renderBackground(): void {
    this.gui.dirtBackground();
  }

  override render(): void {
    this.renderBackground();
    this.gui.centeredText(this.title, this.gui.width / 2, 70, 0xffffff);
  }

  // nothing closes it; the page navigates away when the save is done
  override keyDown(): boolean {
    return true;
  }
}
