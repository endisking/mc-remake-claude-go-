/**
 * The client game: networking to a (local or remote) server, world mirror, camera,
 * frame loop and renderers.
 */
import { decodeS2C, encodeC2S, PROTOCOL_VERSION, type C2S, type S2C } from '@shared/protocol/packets';
import { BIOMES } from '@shared/data';
import { chunkKey } from '@shared/world/chunk';
import { FLUID } from '@shared/world/blockinfo';
import { ClientWorld } from './world/clientworld';
import { startIntegratedServer, type ClientTransport } from './net/connection';
import { Input } from './input';
import { loadSettings, applyQueryOverrides, type Settings } from './settings';
import { ChunkRenderer } from './render/chunkrenderer';
import { BlockTextureArray, loadManifest } from './render/textures';
import { BiomeColors } from './render/biomecolors';
import { Lightmap, skyDarken, timeOfDay } from './render/lightmap';
import { SkyRenderer, skyColor, fogColor, skyColorForTemperature, type SkyState } from './render/sky';
import { CloudRenderer, cloudColor } from './render/clouds';
import { WeatherRenderer } from './render/weather';
import { LineRenderer } from './render/lines';
import { CrackRenderer } from './render/overlay';
import { bakeBlockModels } from './render/blockmodels';
import { raycastBlocks, type BlockHit } from '@shared/world/raycast';
import { outlineBoxes } from '@shared/world/shapes';
import { blockNameOf, propsOf } from '@shared/world/blockstate';
import { PlayerPhysics, type MoveInput } from '@shared/entity/playerphysics';
import { mat4, perspective, viewRotation, multiply, translate, frustumPlanes } from './render/math';
import type { TextureManifest } from './render/blockmodels';
import { Gui } from './gui/gui';
import { RemotePlayer } from './world/entities';
import { EntityRenderer } from './render/entities/entityrenderer';
import type { Screen } from './gui/screen';
import { PauseScreen, type ScreenHost } from './gui/screens';
import { saveSettings } from './settings';

export class Game implements ScreenHost {
  readonly gl: WebGL2RenderingContext;
  readonly world = new ClientWorld();
  readonly input: Input;
  settings: Settings;
  private transport: ClientTransport | null = null;
  chunks!: ChunkRenderer;
  private textures!: BlockTextureArray;
  private lightmap!: Lightmap;
  private sky!: SkyRenderer;
  private clouds!: CloudRenderer;
  private weather!: WeatherRenderer;
  private lines!: LineRenderer;
  private entityRenderer!: EntityRenderer;
  /** Other players (and later all entities), by entity id. */
  readonly players = new Map<number, RemotePlayer>();
  private sentState = { sneaking: false, sprinting: false, flying: false };
  health = 20;
  food = 20;
  saturation = 5;
  private crack!: CrackRenderer;
  /** Current block-breaking progress stage (-1 none, 0..9). Driven by mining in Phase 2. */
  breakStage = -1;
  /** Block the crosshair points at (reach 5 in creative, 4.5 survival). */
  target: BlockHit | null = null;
  private readonly hitScratch = {} as BlockHit;
  reach = 5;
  readonly gui: Gui;
  integrated: import('./net/connection').IntegratedServer | null = null;
  lanHost: import('./net/lan').LanHost | null = null;
  lanStatus = '';
  screen: Screen | null = null;
  private mouseGX = 0;
  private mouseGY = 0;
  private biomes = new BiomeColors();
  private manifest!: TextureManifest;

  /** The local player's movement simulation (client-side prediction). */
  readonly player: PlayerPhysics;
  private eyeHeight = 1.62;
  private eyeHeightOld = 1.62;
  private fovModifier = 1;
  private oFov = 1;
  // camera (eye) position, updated each tick from the player; prev* for interpolation
  x = 0;
  y = 80;
  z = 0;
  prevX = 0;
  prevY = 80;
  prevZ = 0;
  yaw = 0;
  pitch = 0;
  loggedIn = false;
  showDebug = false;
  hideHud = false;

  // timing
  private clientTicks = 0;
  private tickAccum = 0;
  private lastFrame = 0;
  private lastRender = 0;
  private frameTimes: number[] = [];
  fps = 0;
  cpuFrameMs = 0;
  private fpsCount = 0;
  private fpsTime = 0;

  private readonly proj = mat4();
  private readonly view = mat4();
  private readonly viewProj = mat4();
  private readonly planes = new Float32Array(24);
  private readonly skyRgb: [number, number, number] = [0, 0, 0];
  private readonly fogRgb: [number, number, number] = [0, 0, 0];
  private skyBiome: unknown = null;
  private readonly skyState: SkyState = {
    timeOfDay: 0, moonPhase: 0, rain: 0, thunder: 0, flash: 0, biomeSky: [0.47, 0.65, 1], biomeFog: [0xc0 / 255, 0xd8 / 255, 1],
    renderDistanceChunks: 8, camY: 64, lookX: 0, lookY: 0, lookZ: 1, medium: 'air', waterFog: [0x05 / 255, 0x05 / 255, 0x33 / 255],
  };

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.player = new PlayerPhysics(this.world);
    this.player.loadedAt = (x, z) => this.world.isLoaded(x, z);
    this.input = new Input(canvas);
    const q = new URLSearchParams(location.search);
    this.settings = applyQueryOverrides(loadSettings(), q);
    this.showDebug = q.get('debug') === '1';
    const guiCanvas = document.getElementById('gui') as HTMLCanvasElement;
    this.gui = new Gui(guiCanvas);
    const toGui = (e: MouseEvent) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.mouseGX = (e.clientX * dpr) / this.gui.scale;
      this.mouseGY = (e.clientY * dpr) / this.gui.scale;
    };
    guiCanvas.addEventListener('mousedown', (e) => {
      toGui(e);
      if (e.button === 0) this.screen?.mouseDown(this.mouseGX, this.mouseGY);
    });
    guiCanvas.addEventListener('mousemove', (e) => {
      toGui(e);
      this.screen?.mouseMove(this.mouseGX, this.mouseGY);
    });
    window.addEventListener('mouseup', () => this.screen?.mouseUp());
    window.addEventListener('keydown', (e) => {
      if (this.screen) {
        if (this.screen.keyDown(e.code)) e.preventDefault();
      }
    });
    this.input.onLockChange = (locked) => {
      // losing the pointer (Escape, alt-tab) opens the pause menu like vanilla
      if (!locked && !this.screen && this.loggedIn) this.setScreen(new PauseScreen(this));
    };
    // clicking the world while no screen is open grabs the mouse again
    canvas.addEventListener('mousedown', () => {
      if (!this.screen && !this.input.locked) this.input.lock();
    });
  }

  // ------------------------------------------------------------------ screens (ScreenHost)
  setScreen(s: Screen | null): void {
    this.screen?.onClose();
    this.screen = s;
    if (s) {
      s.init();
      this.gui.canvas.classList.add('interactive');
      if (this.input.locked) document.exitPointerLock();
    } else {
      this.gui.canvas.classList.remove('interactive');
      if (new URLSearchParams(location.search).get('nolock') !== '1') this.input.lock();
    }
  }

  private loadedMipLevels = -1;

  applySettings(reloadChunks: boolean): void {
    saveSettings(this.settings);
    if (this.textures && this.settings.mipmapLevels !== this.loadedMipLevels) {
      const levels = this.settings.mipmapLevels;
      this.loadedMipLevels = levels;
      void BlockTextureArray.load(this.gl, this.manifest, levels).then((t) => {
        this.gl.deleteTexture(this.textures.tex);
        this.textures = t;
      });
    }
    this.biomes.blendRadius = this.settings.biomeBlend;
    if (this.loggedIn) this.send({ t: 'settings', viewDistance: this.settings.renderDistance });
    if (reloadChunks) {
      this.chunks.setMesherOptions({ smoothLighting: this.settings.smoothLighting, fancy: this.settings.graphics === 'fancy' }, this.manifest);
    }
  }

  /** Open the integrated world to other players (WebRTC); returns the room code. */
  async openToLan(code?: string): Promise<string | null> {
    if (!this.integrated) return null;
    if (this.lanHost) return this.lanHost.code;
    const { LanHost, randomRoomCode, signalingUrl } = await import('./net/lan');
    const c = code ?? randomRoomCode();
    this.lanHost = new LanHost(this.integrated, c, signalingUrl(new URLSearchParams(location.search).get('signal')));
    this.lanHost.onStatus = (msg) => {
      this.lanStatus = msg;
      console.info('[LAN]', msg);
    };
    return c;
  }

  quitToTitle(): void {
    location.reload();
  }

  async start(): Promise<void> {
    const q = new URLSearchParams(location.search);
    await this.gui.load();
    this.manifest = await loadManifest();
    const [tex] = await Promise.all([
      BlockTextureArray.load(this.gl, this.manifest, this.settings.mipmapLevels),
      this.biomes.load(),
    ]);
    this.textures = tex;
    this.loadedMipLevels = this.settings.mipmapLevels;
    this.biomes.blendRadius = this.settings.biomeBlend;
    this.lightmap = new Lightmap(this.gl);
    this.sky = new SkyRenderer(this.gl);
    await this.sky.loadTextures();
    this.clouds = new CloudRenderer(this.gl);
    await this.clouds.load();
    this.weather = new WeatherRenderer(this.gl);
    await this.weather.load();
    this.lines = new LineRenderer(this.gl);
    this.entityRenderer = new EntityRenderer(this.gl);
    await this.entityRenderer.loadSkins();
    const mainBake = bakeBlockModels(this.manifest, this.settings.graphics === 'fancy');
    this.crack = new CrackRenderer(this.gl, mainBake.bake, Array.from({ length: 10 }, (_, i) => mainBake.textures.get(`destroy_stage_${i}`)!.layer));
    if (q.has('crack')) this.breakStage = Number(q.get('crack'));
    this.chunks = new ChunkRenderer(this.gl, this.world, this.biomes, this.manifest, {
      smoothLighting: this.settings.smoothLighting,
      fancy: this.settings.graphics === 'fancy',
    });
    this.chunks.renderDistance = this.settings.renderDistance;

    if (q.has('server')) {
      // multiplayer: dedicated server over WebSocket
      const { WebSocketTransport, playUrl } = await import('./net/websocket');
      this.connect(new WebSocketTransport(playUrl(q.get('server')!, q.get('room') ?? 'default')));
    } else {
      if (q.has('join')) {
        // LAN guest: join a browser-hosted world by room code
        const { LanGuestTransport, signalingUrl } = await import('./net/lan');
        this.connect(new LanGuestTransport(q.get('join')!, signalingUrl(q.get('signal'))));
      } else {
        const seed = BigInt(q.get('seed') ?? '12345');
        const gm = { survival: 0, creative: 1, adventure: 2, spectator: 3 }[q.get('gamemode') ?? 'survival'] ?? 0;
        const { server, transport } = await startIntegratedServer(seed, q.get('scene') ?? '', gm);
        this.integrated = server;
        this.connect(transport);
        if (q.has('host')) this.openToLan(q.get('host') || undefined);
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  connect(t: ClientTransport): void {
    this.transport = t;
    t.onMessage = (d) => this.handle(decodeS2C(d));
    t.onClose = (r) => console.warn('disconnected', r);
    this.send({ t: 'hello', protocol: PROTOCOL_VERSION, name: new URLSearchParams(location.search).get('name') ?? 'Player', viewDistance: this.settings.renderDistance, skin: '' });
  }

  send(p: C2S): void {
    this.transport?.send(encodeC2S(p));
  }

  private handle(p: S2C): void {
    switch (p.t) {
      case 'login':
        this.setGameMode(p.gameMode);
        this.placePlayer(p.x, p.y, p.z);
        this.yaw = p.yaw;
        this.pitch = p.pitch;
        this.loggedIn = true;
        this.applyTestParams();
        if (!this.input.locked && new URLSearchParams(location.search).get('nolock') !== '1') this.setScreen(new PauseScreen(this));
        {
          const sc = new URLSearchParams(location.search).get('screen');
          if (sc === 'video') import('./gui/screens').then((m) => this.setScreen(new m.VideoSettingsScreen(this, new m.PauseScreen(this))));
          else if (sc === 'pause') this.setScreen(new PauseScreen(this));
        }
        break;
      case 'chunk':
        this.world.loadChunk(p.chunk);
        break;
      case 'unloadChunk':
        this.world.unloadChunk(p.cx, p.cz);
        break;
      case 'blockChange':
        this.world.setStateRaw(p.x, p.y, p.z, p.state);
        this.world.markBlockDirty(p.x, p.y, p.z);
        break;
      case 'sectionLight': {
        const c = this.world.getChunk(p.cx, p.cz);
        if (!c) break;
        const sec = c.sections[p.sy]!;
        sec.light = p.section.light;
        sec.uniformLight = p.section.uniformLight;
        this.chunks.markDirty(p.cx, p.sy, p.cz, false);
        break;
      }
      case 'time':
        this.world.gameTime = p.gameTime;
        this.world.dayTime = p.dayTime;
        this.world.doDaylightCycle = p.doDaylightCycle;
        break;
      case 'teleport':
        this.placePlayer(p.x, p.y, p.z);
        this.player.vx = this.player.vy = this.player.vz = 0;
        break;
      case 'weather':
        this.world.rain = p.rain;
        this.world.thunder = p.thunder;
        break;
      case 'addPlayer': {
        const rp = new RemotePlayer(p.id, p.name, p.skin);
        rp.setPos(p.x, p.y, p.z, p.yaw, p.pitch, p.headYaw);
        this.players.set(p.id, rp);
        break;
      }
      case 'removeEntities':
        for (const id of p.ids) this.players.delete(id);
        break;
      case 'entityMove':
        this.players.get(p.id)?.lerpTo(p.x, p.y, p.z, p.yaw, p.pitch, p.headYaw);
        break;
      case 'entityState': {
        const rp = this.players.get(p.id);
        if (rp) {
          rp.flags = p.flags;
          rp.pose = p.pose;
        }
        break;
      }
      case 'animate':
        if (p.action === 0 || p.action === 3) this.players.get(p.id)?.swing();
        break;
      case 'gameMode':
        this.setGameMode(p.mode);
        break;
      case 'abilities':
        this.player.abilities.flying = p.flying;
        this.player.abilities.mayFly = p.mayFly;
        this.player.abilities.flySpeed = p.flySpeed;
        break;
      case 'health':
        this.health = p.health;
        this.food = p.food;
        this.saturation = p.saturation;
        this.player.foodLevel = p.food;
        break;
      case 'blockBreakProgress':
      case 'levelEvent':
      case 'digAck':
      case 'chat':
      case 'disconnect':
        break;
    }
  }

  /** Move the camera directly (benchmark / tests); position is the eye. */
  setCamera(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.placePlayer(x, y - this.player.eyeHeight, z);
    this.player.vx = this.player.vy = this.player.vz = 0;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Put the local player's feet at a position (no interpolation). */
  private placePlayer(x: number, y: number, z: number): void {
    const pl = this.player;
    pl.x = x;
    pl.y = y;
    pl.z = z;
    this.eyeHeight = this.eyeHeightOld = pl.eyeHeight;
    this.x = this.prevX = x;
    this.y = this.prevY = y + pl.eyeHeight;
    this.z = this.prevZ = z;
  }

  /** 0 survival, 1 creative, 2 adventure, 3 spectator. */
  gameMode = 0;
  setGameMode(m: number): void {
    this.gameMode = m;
    const a = this.player.abilities;
    a.mayFly = m === 1 || m === 3;
    a.noPhysics = m === 3;
    a.flying = m === 3 ? true : m === 1 ? a.flying : false;
    this.reach = m === 1 ? 5 : 4.5;
  }

  /** URL test hooks: ?x=&y=&z=&yaw=&pitch=&time= (used by screenshot checks and the benchmark). */
  private applyTestParams(): void {
    const q = new URLSearchParams(location.search);
    const n = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
    if (n('x') !== undefined || n('y') !== undefined || n('z') !== undefined) {
      const x = n('x') ?? this.player.x, y = n('y') ?? this.player.y, z = n('z') ?? this.player.z;
      this.send({ t: 'chat', message: `/tp ${x} ${y} ${z}` });
    }
    if (n('yaw') !== undefined) this.yaw = n('yaw')!;
    if (n('pitch') !== undefined) this.pitch = n('pitch')!;
    if (q.has('lookat')) {
      // aim the eye (feet position + 1.62) at a world point
      const [tx, ty, tz] = q.get('lookat')!.split(',').map(Number) as [number, number, number];
      const ex = n('x') ?? this.player.x, ey = (n('y') ?? this.player.y) + 1.62, ez = n('z') ?? this.player.z;
      const dx = tx - ex, dy = ty - ey, dz = tz - ez;
      this.yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
      this.pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    }
    if (q.has('fly')) this.player.abilities.flying = true;
    if (q.has('weather')) this.send({ t: 'chat', message: `/weather ${q.get('weather')}` });
    if (n('time') !== undefined) {
      this.send({ t: 'chat', message: '/gamerule doDaylightCycle false' });
      this.send({ t: 'chat', message: `/time set ${n('time')}` });
    }
  }

  // ------------------------------------------------------------------ simulation
  private tick(): void {
    this.clientTicks++;
    this.textures.tick(this.clientTicks);
    this.lightmap.tick();
    if (this.world.doDaylightCycle) this.world.dayTime++;
    this.world.gameTime++;
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.oFov = this.fovModifier;
    const pl = this.player;
    pl.yaw = this.yaw;
    pl.pitch = this.pitch;
    const i = this.input;
    const active = !this.screen && (this.input.locked || new URLSearchParams(location.search).get('nolock') === '1');
    const k = (code: string) => active && i.down.has(code);
    const move: MoveInput = {
      forward: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
      strafe: (k('KeyA') ? 1 : 0) - (k('KeyD') ? 1 : 0),
      jump: k('Space'),
      sneak: k('ShiftLeft') || k('ShiftRight'),
      sprint: k('ControlLeft'),
    };
    if (this.loggedIn && this.world.isLoaded(Math.floor(pl.x), Math.floor(pl.z))) pl.tick(move);
    // camera eye height eases toward the pose's eye height (vanilla Camera.tick)
    this.eyeHeightOld = this.eyeHeight;
    this.eyeHeight += (pl.eyeHeight - this.eyeHeight) * 0.5;
    this.x = pl.x;
    this.y = pl.y + this.eyeHeight;
    this.z = pl.z;
    // FOV modifier (AbstractClientPlayer.getFieldOfViewModifier), eased 50% per tick
    let fovTarget = 1;
    if (pl.abilities.flying) fovTarget *= 1.1;
    fovTarget *= (pl.movementSpeed() / 0.1 + 1) / 2;
    this.fovModifier += (fovTarget - this.fovModifier) * 0.5;
    if (this.fovModifier > 1.5) this.fovModifier = 1.5;
    if (this.fovModifier < 0.1) this.fovModifier = 0.1;
    for (const rp of this.players.values()) rp.tick();
    if (this.loggedIn) {
      const st = this.sentState;
      if (st.sneaking !== pl.shiftDown || st.sprinting !== pl.sprinting || st.flying !== pl.abilities.flying) {
        st.sneaking = pl.shiftDown;
        st.sprinting = pl.sprinting;
        st.flying = pl.abilities.flying;
        this.send({ t: 'playerState', ...st });
      }
      this.send({ t: 'move', x: pl.x, y: pl.y, z: pl.z, yaw: this.yaw, pitch: this.pitch, onGround: pl.onGround });
    }
  }

  // ------------------------------------------------------------------ frame
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const s = this.settings;
    // frame limiter (vsync = every rAF)
    if (s.maxFps > 0 && now - this.lastRender < 1000 / s.maxFps - 0.5) return;
    const dt = this.lastFrame ? Math.min(250, now - this.lastFrame) : 0;
    this.lastFrame = now;
    this.lastRender = now;
    this.tickAccum += dt;
    while (this.tickAccum >= 50) {
      this.tickAccum -= 50;
      this.tick();
    }
    const partial = this.tickAccum / 50;
    this.handleFrameInput();
    const c0 = performance.now();
    this.render(partial);
    // CPU time spent issuing the frame (excludes GPU work); tracked for the benchmark
    this.cpuFrameMs = this.cpuFrameMs * 0.95 + (performance.now() - c0) * 0.05;
    this.input.endFrame();
    // fps
    this.fpsCount++;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsTime));
      this.fpsCount = 0;
      this.fpsTime = now;
    }
  }

  private handleFrameInput(): void {
    const i = this.input;
    if (this.screen) return;
    const sens = this.settings.mouseSensitivity * 0.6 + 0.2;
    const k = sens * sens * sens * 8 * 0.15;
    this.yaw += i.mouseDX * k;
    this.pitch = Math.max(-90, Math.min(90, this.pitch + i.mouseDY * k));
    if (i.consumePress('F3')) this.showDebug = !this.showDebug;
    if (i.consumePress('F1')) this.hideHud = !this.hideHud;
    if (i.consumePress('F11')) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    }
  }

  private readonly bobMat = mat4();
  /** Vanilla GameRenderer.bobView, applied to the projection side of the camera. */
  private applyViewBob(partial: number): void {
    const p = this.player;
    const f = p.walkDist - p.walkDistO;
    const g = -(p.walkDist + f * partial);
    const h = p.oBob + (p.bob - p.oBob) * partial;
    const m = this.bobMat;
    // translate(sin(g·π)·h·0.5, −|cos(g·π)·h|, 0) · rotZ(sin(g·π)·h·3) · rotX(|cos(g·π − 0.2)·h|·5)
    const tx = Math.sin(g * Math.PI) * h * 0.5, ty = -Math.abs(Math.cos(g * Math.PI) * h);
    const az = (Math.sin(g * Math.PI) * h * 3 * Math.PI) / 180;
    const ax = (Math.abs(Math.cos(g * Math.PI - 0.2) * h) * 5 * Math.PI) / 180;
    const cz = Math.cos(az), sz = Math.sin(az), cx = Math.cos(ax), sx = Math.sin(ax);
    // R = Rz * Rx (column-major), then translation
    m[0] = cz; m[1] = sz; m[2] = 0; m[3] = 0;
    m[4] = -sz * cx; m[5] = cz * cx; m[6] = sx; m[7] = 0;
    m[8] = sz * sx; m[9] = -cz * sx; m[10] = cx; m[11] = 0;
    m[12] = tx; m[13] = ty; m[14] = 0; m[15] = 1;
    multiply(this.proj, this.proj, m);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private render(partial: number): void {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const s = this.settings;
    const cx = this.prevX + (this.x - this.prevX) * partial;
    const cy = this.prevY + (this.y - this.prevY) * partial;
    const cz = this.prevZ + (this.z - this.prevZ) * partial;
    const dayTime = this.world.dayTime + (this.world.doDaylightCycle ? partial : 0);
    const tod = timeOfDay(dayTime);

    // environment colours
    const biome = BIOMES[this.world.getBiome(Math.floor(cx), Math.floor(cy), Math.floor(cz))] ?? BIOMES[1]!;
    const camState = this.world.getState(Math.floor(cx), Math.floor(cy), Math.floor(cz));
    const medium: SkyState['medium'] = FLUID[camState] === 1 ? 'water' : FLUID[camState] === 2 ? 'lava' : 'air';
    const yr = (this.yaw * Math.PI) / 180, pr = (this.pitch * Math.PI) / 180;
    const lookX = -Math.sin(yr) * Math.cos(pr), lookY = -Math.sin(pr), lookZ = Math.cos(yr) * Math.cos(pr);
    const skyState = this.skyState;
    skyState.timeOfDay = tod;
    skyState.moonPhase = Math.floor(this.world.dayTime / 24000) % 8;
    skyState.rain = this.world.rain;
    skyState.thunder = this.world.thunder;
    if (biome !== this.skyBiome) {
      this.skyBiome = biome;
      skyState.biomeSky = skyColorForTemperature(biome.temperature);
    }
    skyState.renderDistanceChunks = s.renderDistance;
    skyState.camY = cy;
    skyState.lookX = lookX;
    skyState.lookY = lookY;
    skyState.lookZ = lookZ;
    skyState.medium = medium;
    const sky = skyColor(skyState, this.skyRgb);
    const fog = fogColor(skyState, sky, this.fogRgb);
    const renderDist = s.renderDistance * 16;
    let fogStart = renderDist * 0.75, fogEnd = renderDist;
    if (medium === 'water') {
      fogStart = -8;
      fogEnd = 96;
    } else if (medium === 'lava') {
      fogStart = 0.25;
      fogEnd = 1;
    }

    this.lightmap.update({
      skyDarken: skyDarken(tod, this.world.rain, this.world.thunder),
      ambient: 0,
      gamma: s.gamma,
      nightVision: 0,
      flash: false,
      end: false,
    });

    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    let fov = s.fov * (this.oFov + (this.fovModifier - this.oFov) * partial);
    if (medium === 'water') fov *= 0.85714287;
    perspective(this.proj, (fov * Math.PI) / 180, aspect, 0.05, Math.max(renderDist * 4, 512));
    if (s.viewBobbing && !this.player.abilities.flying) this.applyViewBob(partial);
    viewRotation(this.view, this.yaw, this.pitch);
    this.sky.render(this.proj, this.view, skyState, sky, fog, renderDist);

    multiply(this.viewProj, this.proj, this.view);
    frustumPlanes(this.planes, this.viewProj);
    this.chunks.renderDistance = s.renderDistance;
    this.chunks.update(cx, cy, cz);
    this.chunks.render(this.viewProj, this.planes, cx, cy, cz, this.textures.tex, this.lightmap.tex, fog, fogStart, fogEnd, {
      smoothLighting: s.smoothLighting,
      caveCulling: s.caveCulling,
    });
    if (this.players.size) {
      this.entityRenderer.renderPlayers(this.players.values(), this.world, this.viewProj, cx, cy, cz, partial, this.lightmap.tex, fog, fogStart, fogEnd);
    }
    this.chunks.renderTranslucent(cx, cy, cz, this.textures.tex, this.lightmap.tex);
    // targeted block outline (vanilla: black, 40% alpha)
    this.target = raycastBlocks(this.world, cx, cy, cz, lookX, lookY, lookZ, this.reach, false, this.hitScratch);
    if (this.target && !this.hideHud) {
      const t = this.target;
      this.lines.begin();
      const e = 0.002;
      for (const b of outlineBoxes(t.state)) {
        this.lines.box(t.x + b[0] - e - cx, t.y + b[1] - e - cy, t.z + b[2] - e - cz, t.x + b[3] + e - cx, t.y + b[4] + e - cy, t.z + b[5] + e - cz, 0, 0, 0, 0.4);
      }
      this.lines.flush(this.viewProj, this.canvas.width, this.canvas.height);
      if (this.breakStage >= 0) this.crack.render(this.viewProj, this.textures.tex, t.x, t.y, t.z, t.state, this.breakStage, cx, cy, cz);
    }
    this.weather.render(this.viewProj, this.world, cx, cy, cz, this.clientTicks, partial, this.world.rain, s.graphics === 'fancy', this.lightmap.tex);
    if (medium === 'air') {
      this.clouds.render(this.viewProj, cx, cy, cz, this.clientTicks + partial, s.clouds, s.renderDistance, cloudColor(tod, this.world.rain, this.world.thunder), fog);
    }
    this.renderGui(cx, cy, cz);
  }

  private renderGui(x: number, y: number, z: number): void {
    const g = this.gui;
    g.begin(this.settings.guiScale);
    if (!this.hideHud) {
      if (this.showDebug) this.renderDebug(x, y, z);
      else {
        // crosshair: inverted colours like vanilla
        const ctx = g.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = '#fff';
        const cx = Math.floor(g.width / 2), cy = Math.floor(g.height / 2);
        ctx.fillRect(cx - 7, cy, 15, 1);
        ctx.fillRect(cx, cy - 7, 1, 7);
        ctx.fillRect(cx, cy + 1, 1, 7);
        ctx.restore();
      }
    }
    if (this.screen) this.screen.render(this.mouseGX, this.mouseGY);
  }

  private debugLines(x: number, y: number, z: number): { left: string[]; right: string[] } {
    const st = this.chunks.stats();
    const sorted = [...this.frameTimes].sort((a, b) => b - a);
    const low1 = sorted.length ? 1000 / sorted[Math.max(0, Math.floor(sorted.length * 0.01))]! : 0;
    const feetY = y - 1.62;
    const bx = Math.floor(x), by = Math.floor(feetY), bz = Math.floor(z);
    const yawN = (((this.yaw + 180) % 360) + 360) % 360 - 180;
    const dirIdx = Math.floor((((this.yaw % 360) + 360) % 360) / 90 + 0.5) & 3;
    const facing = ['south (Towards positive Z)', 'west (Towards negative X)', 'north (Towards negative Z)', 'east (Towards positive X)'][dirIdx];
    const light = this.world.getLight(bx, Math.floor(y), bz);
    const biome = BIOMES[this.world.getBiome(bx, by, bz)];
    const chunk = this.world.getChunk(bx >> 4, bz >> 4);
    const s = this.settings;
    const fpsCap = s.maxFps === -1 ? 'vsync' : s.maxFps === 0 ? 'inf' : String(s.maxFps);
    const left = [
      'Blockcraft 1.17.1 (1.17.1/blockcraft)',
      `${this.fps} fps T: ${fpsCap} ${s.graphics} ${s.clouds === 'off' ? '' : s.clouds + '-clouds'} B: ${s.biomeBlend}  1%: ${low1.toFixed(0)}`,
      `C: ${st.visible}/${st.sections} (s) D: ${s.renderDistance}, pC: ${String(st.building).padStart(3, '0')}, pU: ${String(st.pending).padStart(2, '0')}, ${st.avgBuildMs.toFixed(1)} ms/build`,
      `Q: ${st.quads}`,
      `Client Chunk Cache: ${this.world.chunks.size}`,
      'minecraft:overworld',
      '',
      `XYZ: ${x.toFixed(3)} / ${feetY.toFixed(5)} / ${z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}`,
      `Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      `Facing: ${facing} (${yawN.toFixed(1)} / ${this.pitch.toFixed(1)})`,
      `Client Light: ${Math.max(light >> 4, light & 15)} (${light >> 4} sky, ${light & 15} block)`,
      chunk ? `CH M: ${chunk.motionBlocking[(bz & 15) * 16 + (bx & 15)]}` : 'Waiting for chunk...',
      `Biome: minecraft:${biome?.name ?? '?'}`,
      `Day ${Math.floor(this.world.dayTime / 24000)} (${Math.floor(((this.world.dayTime % 24000) + 24000) % 24000)})`,
    ];
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const right = [
      'JS: browser',
      mem ? `Mem: ${Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100)}% ${Math.round(mem.usedJSHeapSize / 1048576)}/${Math.round(mem.jsHeapSizeLimit / 1048576)}MB` : 'Mem: n/a',
      `CPU: ${navigator.hardwareConcurrency || '?'}x`,
      '',
      `Display: ${this.canvas.width}x${this.canvas.height} (WebGL2)`,
    ];
    if (this.target) {
      const t = this.target;
      right.push('', `§nTargeted Block: ${t.x}, ${t.y}, ${t.z}`, `minecraft:${blockNameOf(t.state)}`);
      const props = propsOf(t.state);
      for (const [k, v] of Object.entries(props)) {
        const val = String(v);
        right.push(`${k}: ${val === 'true' ? '§a' : val === 'false' ? '§c' : ''}${val}`);
      }
    }
    return { left, right };
  }

  private renderDebug(x: number, y: number, z: number): void {
    const g = this.gui;
    const { left, right } = this.debugLines(x, y, z);
    left.forEach((l, i) => {
      if (!l) return;
      const w = g.font.width(l);
      g.fill(1, 2 + i * 9 - 1, w + 1, 9, 0x90505050);
      g.text(l, 2, 2 + i * 9, 0xe0e0e0, false);
    });
    right.forEach((l, i) => {
      if (!l) return;
      const w = g.font.width(l);
      const rx = g.width - 2 - w;
      g.fill(rx - 1, 2 + i * 9 - 1, w + 1, 9, 0x90505050);
      g.text(l, rx, 2 + i * 9, 0xe0e0e0, false);
    });
  }
}
