/**
 * Fullscreen that keeps browser shortcuts away from the game. Ctrl is the sprint key, so
 * "sprint forward" is Ctrl+W, which closes the tab. In fullscreen, Chrome and Edge let a page
 * claim the keyboard (Keyboard Lock API): Ctrl+W, Ctrl+T, Ctrl+N and Escape then reach the game
 * instead of the browser, and leaving fullscreen takes holding Escape. Other browsers simply go
 * fullscreen; the game's "Leave site?" prompt (game.ts) still guards against an accidental close.
 */
interface KeyboardLock {
  lock(keys?: string[]): Promise<void>;
  unlock(): void;
}
const keyboard = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

export async function enterFullscreen(): Promise<void> {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  await keyboard()?.lock?.().catch(() => {});
}

export function exitFullscreen(): void {
  keyboard()?.unlock?.();
  if (document.fullscreenElement) void document.exitFullscreen();
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) exitFullscreen();
  else void enterFullscreen().catch(() => {});
}

// leaving fullscreen any other way (holding Escape, F11) releases the keyboard too
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) keyboard()?.unlock?.();
});
