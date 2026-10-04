/** Keyboard/mouse input with pointer lock. Key names are KeyboardEvent.code values. */
export class Input {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** keys that have an F3 combo, and combos pressed since the last frame */
  debugKeys = new Set<string>();
  readonly debugQueue: string[] = [];
  /** a debug combo was used during the current F3 hold (F3 release then does not toggle the screen) */
  f3Combo = false;
  /** whether F3 was held when the pointer lock was last lost */
  unlockedWithF3 = false;
  readonly mouseButtons = new Set<number>();
  private mousePressed = new Set<number>();
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (this.locked && (e.code.startsWith('F') || e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.press(`Mouse${e.button}`);
    });
    document.addEventListener('mouseup', (e) => this.release(`Mouse${e.button}`));
    document.addEventListener('wheel', (e) => {
      // in wheel notches, positive = scrolling down
      if (this.locked) this.wheel += e.deltaMode === 0 ? e.deltaY / 100 : e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY;
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      // F3 held when the pointer is released by Escape: pause without the menu (F3+Esc)
      this.unlockedWithF3 = !this.locked && this.down.has('F3');
      if (!this.locked) {
        this.down.clear();
        this.mouseButtons.clear();
      }
      this.onLockChange?.(this.locked);
    });
  }

  lock(): void {
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }

  /** Key or mouse button ("Mouse0".."Mouse4") pressed (also used by tests). */
  press(code: string): void {
    // KeyboardHandler.keyPress: with F3 held, a debug key goes to the debug handler (queued at
    // press time so fast taps between frames are not lost) instead of its key mapping
    if (code === 'F3' && !this.down.has('F3')) this.f3Combo = false;
    else if (this.down.has('F3') && this.debugKeys.has(code)) {
      if (!this.down.has(code)) this.debugQueue.push(code);
      this.f3Combo = true;
      return;
    }
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
    if (code.startsWith('Mouse')) {
      const b = Number(code.slice(5));
      this.mouseButtons.add(b);
      this.mousePressed.add(b);
    }
  }

  release(code: string): void {
    this.down.delete(code);
    this.released.add(code);
    if (code.startsWith('Mouse')) this.mouseButtons.delete(Number(code.slice(5)));
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per key press (consumed). */
  consumePress(code: string): boolean {
    if (code.startsWith('Mouse')) this.mousePressed.delete(Number(code.slice(5)));
    return this.pressed.delete(code);
  }

  /** True once per key release (consumed). */
  consumeRelease(code: string): boolean {
    return this.released.delete(code);
  }

  consumeMouse(button: number): boolean {
    this.pressed.delete(`Mouse${button}`);
    return this.mousePressed.delete(button);
  }

  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
