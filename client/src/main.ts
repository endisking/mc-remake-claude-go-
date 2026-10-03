/**
 * Client entry: boots the integrated server (single-player), connects to it, and runs
 * the render loop.
 */
import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
(window as unknown as { game: Game }).game = game;
game.start().catch((e) => {
  console.error(e);
  document.getElementById('click')!.textContent = `Failed to start: ${(e as Error).message}`;
});
