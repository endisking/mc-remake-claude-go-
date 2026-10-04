/**
 * Start page shown when the game is opened without parameters (release builds): pick a name and
 * either a saved single-player world (list, create, delete, export/import as .zip), a dedicated
 * server (URL + room) or a LAN game (room code). Choices are remembered and passed to the game as
 * URL parameters (?world=<id> for a saved world).
 */
import { listWorlds, newWorldId, deleteWorld, exportWorldZip, importWorldZip, IdbStorage, type WorldSummary } from '@server/storage/idb';
import { safeFolderName } from '@server/storage/archive';
import { SAVE_FORMAT_VERSION, type LevelMeta } from '@server/storage/types';

const KEY = 'blockcraft.launcher';

interface Saved {
  name: string;
  seed: string;
  gamemode: string;
  server: string;
  room: string;
  join: string;
  selected: string;
}

function load(): Saved {
  const d: Saved = { name: 'Player', seed: '', gamemode: 'survival', server: '', room: 'default', join: '', selected: '' };
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

const MODES = ['Survival', 'Creative', 'Adventure', 'Spectator'];
const MODE_IDS: Record<string, number> = { survival: 0, creative: 1, adventure: 2, spectator: 3 };

/** Level data for a brand-new world; the server fills in the rest on first save. */
export function newLevelMeta(name: string, seed: string, gameMode: number): LevelMeta {
  const now = Date.now();
  return {
    version: SAVE_FORMAT_VERSION, name, seed, defaultGameMode: gameMode, gameTime: 0, dayTime: 0,
    doDaylightCycle: true, doWeatherCycle: true, raining: false, thundering: false, rainTime: 0, thunderTime: 0,
    clearWeatherTime: 0, rainLevel: 0, thunderLevel: 0, worldSpawn: null, gameRules: {} as LevelMeta['gameRules'],
    difficulty: 2, playersSleepingPercentage: 100, spawnRadius: 10, pvp: true, lastPlayed: now, createdAt: now,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function showLauncher(): void {
  const s = load();
  const root = document.createElement('div');
  root.id = 'launcher';
  root.innerHTML = `
<style>
  #launcher { position: fixed; inset: 0; display: flex; overflow: auto; padding: 16px 0; box-sizing: border-box;
    background: repeating-linear-gradient(45deg, #3b2c22 0 8px, #45342a 8px 16px); font: 16px monospace; color: #fff; z-index: 10; }
  #launcher .panel { margin: auto; background: rgba(0,0,0,0.55); padding: 24px 28px; border: 2px solid #000; box-shadow: inset 0 0 0 2px #555; width: min(480px, calc(100vw - 32px)); box-sizing: border-box; }
  #launcher h1 { margin: 0 0 4px; font-size: 40px; letter-spacing: 2px; text-align: center; text-shadow: 3px 3px #3f3f3f; }
  #launcher .sub { text-align: center; color: #ffff55; margin-bottom: 18px; text-shadow: 2px 2px #3f3f15; }
  #launcher fieldset { border: 1px solid #777; margin: 10px 0 0; padding: 10px 12px 12px; min-width: 0; }
  #launcher legend { color: #aaa; padding: 0 6px; }
  #launcher label { display: block; margin: 6px 0 2px; color: #ddd; font-size: 13px; }
  #launcher input, #launcher select { width: 100%; box-sizing: border-box; background: #000; color: #fff; border: 2px solid #a0a0a0; padding: 6px; font: 15px monospace; }
  #launcher button { width: 100%; margin-top: 10px; padding: 8px; font: 16px monospace; color: #fff; cursor: pointer;
    background: linear-gradient(#8a8a8a, #6f6f6f); border: 2px solid #000; box-shadow: inset 2px 2px #aaa, inset -2px -2px #555; text-shadow: 2px 2px #3f3f3f; }
  #launcher button:hover:not(:disabled) { background: linear-gradient(#8c9bd6, #6f7fc0); }
  #launcher button:disabled { color: #a0a0a0; cursor: default; background: #2c2c2c; box-shadow: none; text-shadow: none; }
  #launcher .row { display: flex; gap: 8px; } #launcher .row > * { flex: 1; min-width: 0; }
  #launcher .note { color: #999; font-size: 12px; margin-top: 10px; text-align: center; }
  #launcher .worlds { background: rgba(0,0,0,0.6); border: 2px solid #000; box-shadow: inset 0 0 0 1px #444; height: 168px; overflow-y: auto; }
  #launcher .world { padding: 5px 8px; border: 2px solid transparent; cursor: pointer; user-select: none; }
  #launcher .world.sel { border-color: #c0c0c0; background: rgba(255,255,255,0.06); }
  #launcher .world .wn { color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #launcher .world .wd { color: #808080; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #launcher .empty { color: #808080; padding: 10px; text-align: center; font-size: 13px; }
  #launcher .status { min-height: 16px; color: #ff5555; font-size: 12px; margin-top: 6px; text-align: center; }
  #launcher .modal { position: fixed; inset: 0; display: none; background: rgba(16,10,6,0.85); z-index: 11; }
  #launcher .modal.open { display: flex; }
  #launcher .modal .box { margin: auto; text-align: center; width: min(420px, calc(100vw - 32px)); background: rgba(0,0,0,0.92); }
  #launcher #l-open { flex: 2; }
  #launcher .modal .box p { margin: 8px 0; } #launcher .modal .box .warn { color: #a0a0a0; }
  #launcher details summary { cursor: pointer; color: #ddd; margin-top: 10px; }
</style>
<div class="panel">
  <h1>BLOCKCRAFT</h1>
  <div class="sub">Pre-release</div>
  <label for="l-name">Player name</label>
  <input id="l-name" maxlength="16" value="">
  <fieldset><legend>Singleplayer</legend>
    <div class="worlds" id="l-worlds"><div class="empty">Loading worlds...</div></div>
    <div class="row">
      <button id="l-open" disabled>Play Selected World</button>
      <button id="l-delete" disabled>Delete</button>
    </div>
    <div class="row">
      <button id="l-export" disabled>Export (.zip)</button>
      <button id="l-import">Import (.zip)</button>
    </div>
    <input id="l-import-file" type="file" accept=".zip,application/zip" hidden>
    <div class="status" id="l-status"></div>
    <details id="l-create" open><summary>Create New World</summary>
      <label for="l-wname">World name</label><input id="l-wname" maxlength="32" placeholder="New World">
      <div class="row">
        <div><label for="l-seed">Seed (blank = random)</label><input id="l-seed"></div>
        <div><label for="l-gm">Game mode</label><select id="l-gm">
          <option value="survival">Survival</option><option value="creative">Creative</option>
          <option value="adventure">Adventure</option><option value="spectator">Spectator</option></select></div>
      </div>
      <button id="l-play">Create New World</button>
    </details>
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
  <div class="note">Worlds are saved in this browser. Export them to back them up or move them to another computer.</div>
</div>
<div class="modal" id="l-confirm"><div class="box panel">
  <p>Are you sure you want to delete this world?</p>
  <p class="warn" id="l-confirm-text"></p>
  <div class="row"><button id="l-confirm-yes">Delete</button><button id="l-confirm-no">Cancel</button></div>
</div></div>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  $<HTMLInputElement>('l-name').value = s.name;
  $<HTMLInputElement>('l-seed').value = s.seed;
  $<HTMLSelectElement>('l-gm').value = s.gamemode;
  $<HTMLInputElement>('l-server').value = s.server;
  $<HTMLInputElement>('l-room').value = s.room;
  $<HTMLInputElement>('l-join').value = s.join;

  let worlds: WorldSummary[] = [];
  let selected: string | null = s.selected || null;
  let storageOk = true;
  const status = (msg: string, ok = false) => {
    const el = $('l-status');
    el.textContent = msg;
    el.style.color = ok ? '#55ff55' : '#ff5555';
  };

  const remember = (extra: Partial<Saved> = {}): Saved => {
    const saved: Saved = {
      name: $<HTMLInputElement>('l-name').value.trim().slice(0, 16) || 'Player', seed: $<HTMLInputElement>('l-seed').value,
      gamemode: $<HTMLSelectElement>('l-gm').value, server: $<HTMLInputElement>('l-server').value.trim(),
      room: $<HTMLInputElement>('l-room').value.trim() || 'default', join: $<HTMLInputElement>('l-join').value.trim(),
      selected: selected ?? '', ...extra,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* private mode */
    }
    return saved;
  };
  const go = (params: Record<string, string>, extra: Partial<Saved> = {}) => {
    const saved = remember(extra);
    location.search = new URLSearchParams({ name: saved.name, ...params }).toString();
  };

  const updateButtons = () => {
    const has = !!selected && worlds.some((w) => w.id === selected);
    $<HTMLButtonElement>('l-open').disabled = !has;
    $<HTMLButtonElement>('l-delete').disabled = !has;
    $<HTMLButtonElement>('l-export').disabled = !has;
    $<HTMLButtonElement>('l-import').disabled = !storageOk;
  };

  const render = () => {
    const list = $('l-worlds');
    if (!storageOk) {
      list.innerHTML = '<div class="empty">Worlds cannot be saved in this browser (storage is blocked).<br>New worlds will not be kept.</div>';
    } else if (!worlds.length) {
      list.innerHTML = '<div class="empty">No worlds yet. Create one below.</div>';
    } else {
      list.innerHTML = worlds
        .map((w) => {
          const m = w.meta;
          const detail = `${formatDate(m.lastPlayed ?? m.createdAt ?? 0)} · ${MODES[m.defaultGameMode] ?? 'Survival'} Mode`;
          return `<div class="world${w.id === selected ? ' sel' : ''}" data-id="${escapeHtml(w.id)}"><div class="wn">${escapeHtml(m.name || 'World')}</div><div class="wd">${escapeHtml(safeFolderName(m.name || 'World'))} · ${escapeHtml(detail)}</div></div>`;
        })
        .join('');
      for (const el of list.querySelectorAll<HTMLElement>('.world')) {
        el.onclick = () => {
          selected = el.dataset.id!;
          for (const o of list.querySelectorAll('.world')) o.classList.toggle('sel', o === el);
          updateButtons();
        };
        el.ondblclick = () => {
          selected = el.dataset.id!;
          play();
        };
      }
      list.querySelector('.world.sel')?.scrollIntoView({ block: 'nearest' });
    }
    updateButtons();
  };

  const refresh = async () => {
    try {
      worlds = await listWorlds();
      storageOk = true;
    } catch (e) {
      console.warn('world storage unavailable', e);
      worlds = [];
      storageOk = false;
    }
    if (selected && !worlds.some((w) => w.id === selected)) selected = null;
    if (!selected && worlds.length) selected = worlds[0]!.id;
    render();
  };

  const play = () => {
    if (!selected || !worlds.some((w) => w.id === selected)) return;
    go({ world: selected });
  };

  $('l-open').onclick = play;

  $('l-play').onclick = async () => {
    const raw = $<HTMLInputElement>('l-seed').value.trim();
    const seed = raw ? textSeed(raw) : BigInt.asIntN(64, BigInt(Math.floor(Math.random() * 2 ** 52)) * 4093n).toString();
    const gmName = $<HTMLSelectElement>('l-gm').value;
    const gm = MODE_IDS[gmName] ?? 0;
    if (!storageOk) {
      go({ seed, gamemode: gmName });
      return;
    }
    const base = $<HTMLInputElement>('l-wname').value.trim() || 'New World';
    // vanilla avoids folder clashes by appending (n); do the same for display names
    const names = new Set(worlds.map((w) => w.meta.name));
    let name = base;
    for (let n = 1; names.has(name); n++) name = `${base} (${n})`;
    const id = newWorldId();
    $<HTMLButtonElement>('l-play').disabled = true;
    try {
      await new IdbStorage(id).putMeta(newLevelMeta(name, seed, gm));
      selected = id;
      go({ world: id }, { selected: id });
    } catch (e) {
      $<HTMLButtonElement>('l-play').disabled = false;
      status(`Could not create the world: ${(e as Error).message}`);
    }
  };

  // delete with confirmation (vanilla: "'World' will be lost forever! (A long time!)")
  const modal = $('l-confirm');
  $('l-delete').onclick = () => {
    const w = worlds.find((x) => x.id === selected);
    if (!w) return;
    $('l-confirm-text').textContent = `'${w.meta.name}' will be lost forever! (A long time!)`;
    modal.classList.add('open');
  };
  $('l-confirm-no').onclick = () => modal.classList.remove('open');
  $('l-confirm-yes').onclick = async () => {
    modal.classList.remove('open');
    if (!selected) return;
    try {
      await deleteWorld(selected);
      selected = null;
      status('');
    } catch (e) {
      status(`Could not delete the world: ${(e as Error).message}`);
    }
    await refresh();
  };

  $('l-export').onclick = async () => {
    const w = worlds.find((x) => x.id === selected);
    if (!w) return;
    const btn = $<HTMLButtonElement>('l-export');
    btn.disabled = true;
    status('Exporting...', true);
    try {
      const zip = await exportWorldZip(w.id);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFolderName(w.meta.name)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      status(`Exported ${a.download} (${Math.ceil(zip.length / 1024)} KB)`, true);
    } catch (e) {
      status(`Export failed: ${(e as Error).message}`);
    }
    updateButtons();
  };

  const fileInput = $<HTMLInputElement>('l-import-file');
  $('l-import').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    status('Importing...', true);
    try {
      selected = await importWorldZip(new Uint8Array(await f.arrayBuffer()));
      status(`Imported ${f.name}`, true);
    } catch (e) {
      status(`Import failed: ${(e as Error).message}`);
    }
    await refresh();
  };

  $('l-connect').onclick = () => {
    const server = $<HTMLInputElement>('l-server').value.trim();
    if (server) go({ server, room: $<HTMLInputElement>('l-room').value.trim() || 'default' });
  };
  $('l-lan').onclick = () => {
    const join = $<HTMLInputElement>('l-join').value.trim();
    if (join) go({ join });
  };
  void refresh();
}
