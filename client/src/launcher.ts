/**
 * Start page shown when the game is opened without parameters (release builds): pick a name and
 * either a single-player world (seed, game mode), a dedicated server (URL + room) or a LAN game
 * (room code). Choices are remembered and passed to the game as URL parameters.
 */
const KEY = 'blockcraft.launcher';

interface Saved {
  name: string;
  seed: string;
  gamemode: string;
  server: string;
  room: string;
  join: string;
}

function load(): Saved {
  const d: Saved = { name: 'Player', seed: '', gamemode: 'survival', server: '', room: 'default', join: '' };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) };
  } catch {
    return d;
  }
}

/** Java's String.hashCode, used by vanilla for non-numeric seeds. */
function textSeed(s: string): string {
  if (/^-?\d+$/.test(s.trim())) return BigInt.asIntN(64, BigInt(s.trim())).toString();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

export function showLauncher(): void {
  const s = load();
  const root = document.createElement('div');
  root.id = 'launcher';
  root.innerHTML = `
<style>
  #launcher { position: fixed; inset: 0; display: flex; overflow: auto; padding: 16px 0; box-sizing: border-box;
    background: repeating-linear-gradient(45deg, #3b2c22 0 8px, #45342a 8px 16px); font: 16px monospace; color: #fff; z-index: 10; }
  #launcher .panel { margin: auto; background: rgba(0,0,0,0.55); padding: 24px 28px; border: 2px solid #000; box-shadow: inset 0 0 0 2px #555; width: min(440px, calc(100vw - 32px)); }
  #launcher h1 { margin: 0 0 4px; font-size: 40px; letter-spacing: 2px; text-align: center; text-shadow: 3px 3px #3f3f3f; }
  #launcher .sub { text-align: center; color: #ffff55; margin-bottom: 18px; text-shadow: 2px 2px #3f3f15; }
  #launcher fieldset { border: 1px solid #777; margin: 10px 0 0; padding: 10px 12px 12px; }
  #launcher legend { color: #aaa; padding: 0 6px; }
  #launcher label { display: block; margin: 6px 0 2px; color: #ddd; font-size: 13px; }
  #launcher input, #launcher select { width: 100%; box-sizing: border-box; background: #000; color: #fff; border: 2px solid #a0a0a0; padding: 6px; font: 15px monospace; }
  #launcher button { width: 100%; margin-top: 10px; padding: 8px; font: 16px monospace; color: #fff; cursor: pointer;
    background: linear-gradient(#8a8a8a, #6f6f6f); border: 2px solid #000; box-shadow: inset 2px 2px #aaa, inset -2px -2px #555; text-shadow: 2px 2px #3f3f3f; }
  #launcher button:hover { background: linear-gradient(#8c9bd6, #6f7fc0); }
  #launcher .row { display: flex; gap: 8px; } #launcher .row > * { flex: 1; }
  #launcher .note { color: #999; font-size: 12px; margin-top: 10px; text-align: center; }
</style>
<div class="panel">
  <h1>BLOCKCRAFT</h1>
  <div class="sub">Pre-release</div>
  <label for="l-name">Player name</label>
  <input id="l-name" maxlength="16" value="">
  <fieldset><legend>Singleplayer</legend>
    <div class="row">
      <div><label for="l-seed">Seed (blank = random)</label><input id="l-seed"></div>
      <div><label for="l-gm">Game mode</label><select id="l-gm">
        <option value="survival">Survival</option><option value="creative">Creative</option>
        <option value="adventure">Adventure</option><option value="spectator">Spectator</option></select></div>
    </div>
    <button id="l-play">Play Singleplayer</button>
  </fieldset>
  <fieldset><legend>Multiplayer</legend>
    <div class="row">
      <div><label for="l-server">Server address</label><input id="l-server" placeholder="wss://example.com"></div>
      <div><label for="l-room">Room</label><input id="l-room"></div>
    </div>
    <button id="l-connect">Join Server</button>
    <label for="l-join">LAN room code</label><input id="l-join" placeholder="code from the host">
    <button id="l-lan">Join LAN Game</button>
  </fieldset>
  <div class="note">Worlds are not saved yet in this build.</div>
</div>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  $<HTMLInputElement>('l-name').value = s.name;
  $<HTMLInputElement>('l-seed').value = s.seed;
  $<HTMLSelectElement>('l-gm').value = s.gamemode;
  $<HTMLInputElement>('l-server').value = s.server;
  $<HTMLInputElement>('l-room').value = s.room;
  $<HTMLInputElement>('l-join').value = s.join;
  const go = (params: Record<string, string>) => {
    const saved: Saved = {
      name: $<HTMLInputElement>('l-name').value.trim().slice(0, 16) || 'Player', seed: $<HTMLInputElement>('l-seed').value,
      gamemode: $<HTMLSelectElement>('l-gm').value, server: $<HTMLInputElement>('l-server').value.trim(),
      room: $<HTMLInputElement>('l-room').value.trim() || 'default', join: $<HTMLInputElement>('l-join').value.trim(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* private mode */
    }
    const q = new URLSearchParams({ name: saved.name, ...params });
    location.search = q.toString();
  };
  $('l-play').onclick = () => {
    const raw = $<HTMLInputElement>('l-seed').value.trim();
    const seed = raw ? textSeed(raw) : BigInt.asIntN(64, BigInt(Math.floor(Math.random() * 2 ** 52)) * 4093n).toString();
    go({ seed, gamemode: $<HTMLSelectElement>('l-gm').value });
  };
  $('l-connect').onclick = () => {
    const server = $<HTMLInputElement>('l-server').value.trim();
    if (server) go({ server, room: $<HTMLInputElement>('l-room').value.trim() || 'default' });
  };
  $('l-lan').onclick = () => {
    const join = $<HTMLInputElement>('l-join').value.trim();
    if (join) go({ join });
  };
}
