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
import { mat4, perspective, viewRotation, multiply, translate, frustumPlanes, type Mat4 } from './render/math';
import type { TextureManifest } from './render/blockmodels';
import { Gui } from './gui/gui';
import { RemotePlayer } from './world/entities';
import { Interaction } from './interaction';
import { ParticleEngine } from './render/particles';
import { BlockItemRenderer } from './render/blockitem';
import { HandRenderer, attackSpeedOf } from './render/hand';
import { Hud, type HudPlayer } from './gui/hud';
import { DeathScreen } from './gui/deathscreen';
import { ClientBolt, LightningRenderer } from './render/lightning';
import { blockForItem } from '@shared/game/loot';
import { BLOCKS_BY_NAME, ITEMS_BY_ID } from '@shared/data';
import { itemName } from '@shared/item/stack';
import type { BakeResult } from './models/bake';
import { flatItemTexture } from './models/itemmodels';
import { isViewBlocking } from '@shared/world/blockprops';
import { JavaRandom } from '@shared/util/random';
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
  interaction!: Interaction;
  private readonly hud = new Hud();
  // local player survival state (LocalPlayer)
  health = 20;
  food = 20;
  saturation = 5;
  air = 300;
  xpProgress = 0;
  xpLevel = 0;
  xpTotal = 0;
  hurtTime = 0;
  private hurtDuration = 10;
  invulnerableTime = 0;
  deathTime = 0;
  private flashOnSetHealth = false;
  onFire = false;
  private waterVisionTime = 0;
  private skyFlashTime = 0;
  readonly bolts = new Map<number, ClientBolt>();
  private readonly boltRand = new JavaRandom(BigInt(Date.now()));
  private lightning!: LightningRenderer;
  private hand!: HandRenderer;
  // ItemInHandRenderer / LocalPlayer state for the first-person hand
  private xBob = 0;
  private xBobO = 0;
  private yBob = 0;
  private yBobO = 0;
  private mainHandHeight = 0;
  private oMainHandHeight = 0;
  private handItem: { id: number; count: number; damage: number } | null = null;
  attackStrengthTicker = 0;
  particles!: ParticleEngine;
  blockItems!: BlockItemRenderer;
  private bake!: BakeResult;
  /** Dropped item entities: id → state for rendering. */
  readonly items = new Map<number, { x: number; y: number; z: number; xo: number; yo: number; zo: number; lx: number; ly: number; lz: number; steps: number; item: number; count: number; age: number; bobOffs: number; pickup?: { collector: number; life: number } }>();
  entityId = 0;
  /** Other players' digging cracks: player id → position + stage. */
  private otherCracks = new Map<number, { x: number; y: number; z: number; stage: number }>();
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
    if (this.loggedIn) this.send({ t: 'settings', viewDistance: this.settings.renderDistance, simulationDistance: this.settings.simulationDistance });
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
    await Promise.all([this.gui.load(), this.hud.load()]);
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
    this.bake = mainBake.bake;
    this.particles = new ParticleEngine(this.gl, this.world);
    this.blockItems = new BlockItemRenderer(this.gl, mainBake.bake, () => this.textures.tex, (st) => itemTint(st), (st) => {
      const t = flatItemTexture(blockNameOf(st));
      return t === null ? null : (mainBake.textures.get(t)?.layer ?? mainBake.textures.get('missing')!.layer);
    }, (layer) => this.textures.alpha[layer]);
    this.lightning = new LightningRenderer(this.gl);
    this.hand = new HandRenderer(this.gl, this.entityRenderer, this.blockItems, () => this.textures.tex, mainBake.textures.get('fire_1')!.layer);
    this.interaction = new Interaction({
      world: this.world,
      player: this.player,
      get gameMode() { return game.gameMode; },
      get yaw() { return game.yaw; },
      get pitch() { return game.pitch; },
      send: (p) => this.send(p),
      onBlockBroken: (x, y, z, st) => this.particles.destroy(x, y, z, st, this.particleLayer(st), this.particleTint(st, x, z)),
      onBlockHit: (x, y, z, face, st) => this.particles.crack(x, y, z, face, st, this.particleLayer(st), this.particleTint(st, x, z)),
      swing: () => this.swingArm(),
      missSwing: () => {
        this.swingArm();
        this.resetAttackStrength();
      },
    });
    const game = this;
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
        this.entityId = p.entityId;
        this.setGameMode(p.gameMode);
        this.placePlayer(p.x, p.y, p.z);
        this.yaw = p.yaw;
        this.pitch = p.pitch;
        this.loggedIn = true;
        this.send({ t: 'settings', viewDistance: this.settings.renderDistance, simulationDistance: this.settings.simulationDistance });
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
        for (const id of p.ids) {
          this.players.delete(id);
          this.items.delete(id);
          this.bolts.delete(id);
        }
        break;
      case 'entityMove': {
        this.players.get(p.id)?.lerpTo(p.x, p.y, p.z, p.yaw, p.pitch, p.headYaw);
        const it = this.items.get(p.id);
        if (it) {
          it.lx = p.x;
          it.ly = p.y;
          it.lz = p.z;
          it.steps = 2;
        }
        break;
      }
      case 'entityState': {
        if (p.id === this.entityId) {
          this.onFire = (p.flags & 1) !== 0;
          break;
        }
        const rp = this.players.get(p.id);
        if (rp) {
          rp.flags = p.flags;
          rp.pose = p.pose;
        }
        break;
      }
      case 'animate':
        if (p.action === 0 || p.action === 3) this.players.get(p.id)?.swing();
        else if (p.action === 1) {
          const rp = this.players.get(p.id);
          if (rp) rp.hurtTime = 10;
        }
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
        this.hurtTo(p.health);
        this.food = p.food;
        this.saturation = p.saturation;
        this.player.foodLevel = p.food;
        break;
      case 'air':
        this.air = p.air;
        break;
      case 'experience':
        this.xpProgress = p.progress;
        this.xpLevel = p.level;
        this.xpTotal = p.total;
        break;
      case 'playerDied':
        this.interaction.stopDestroy();
        this.setScreen(new DeathScreen(this, p.message, p.score));
        break;
      case 'respawn':
        this.health = 20;
        this.deathTime = 0;
        this.hurtTime = 0;
        this.flashOnSetHealth = false;
        this.air = 300;
        this.onFire = false;
        this.setGameMode(p.gameMode);
        if (this.screen instanceof DeathScreen) this.setScreen(null);
        break;
      case 'setSlot':
        this.interaction.inventory.set(p.slot, p.item > 0 && p.count > 0 ? { id: p.item, count: p.count, damage: p.damage } : null);
        break;
      case 'heldSlot':
        this.interaction.inventory.selected = p.slot;
        break;
      case 'addEntity':
        if (p.type === 'lightning_bolt') this.bolts.set(p.id, new ClientBolt(p.x, p.y, p.z, this.boltRand));
        else if (p.type === 'item') {
          this.items.set(p.id, { x: p.x, y: p.y, z: p.z, xo: p.x, yo: p.y, zo: p.z, lx: p.x, ly: p.y, lz: p.z, steps: 0, item: 0, count: 1, age: 0, bobOffs: Math.random() * Math.PI * 2 });
        }
        break;
      case 'itemStack': {
        const it = this.items.get(p.id);
        if (it) {
          it.item = p.item;
          it.count = p.count;
        }
        break;
      }
      case 'takeItem': {
        // vanilla ItemPickupParticle: the item flies into the collector over 3 ticks
        const it = this.items.get(p.itemId);
        if (it && !it.pickup) {
          const stays = p.count < it.count;
          if (stays) it.count -= p.count;
          const ghost = stays ? { ...it, count: p.count } : it;
          ghost.pickup = { collector: p.collectorId, life: 0 };
          this.items.delete(p.itemId);
          this.items.set(stays ? -1e9 - this.clientTicks * 16 - (p.itemId & 15) : p.itemId, ghost);
          if (stays) this.items.set(p.itemId, it);
        }
        break;
      }
      case 'levelEvent':
        if (p.event === 2001) this.particles.destroy(p.x, p.y, p.z, p.data, this.particleLayer(p.data), this.particleTint(p.data, p.x, p.z));
        break;
      case 'blockBreakProgress':
        if (p.stage < 0) this.otherCracks.delete(p.id);
        else this.otherCracks.set(p.id, { x: p.x, y: p.y, z: p.z, stage: p.stage });
        break;
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
    for (const g of q.getAll('give')) this.send({ t: 'chat', message: `/give @s ${g.replace(':', ' ')}` });
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
    const active = !this.screen && !this.dead && (this.input.locked || new URLSearchParams(location.search).get('nolock') === '1');
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
    for (const [id, it] of this.items) {
      if (it.pickup && ++it.pickup.life > 3) {
        this.items.delete(id);
        continue;
      }
      it.xo = it.x;
      it.yo = it.y;
      it.zo = it.z;
      it.age++;
      if (it.steps > 0) {
        it.x += (it.lx - it.x) / it.steps;
        it.y += (it.ly - it.y) / it.steps;
        it.z += (it.lz - it.z) / it.steps;
        it.steps--;
      }
    }
    this.particles.tick();
    this.swingTick();
    this.hud.tick(this.interaction.inventory);
    this.tickHand();
    this.tickLiving();
    this.tickEnvironment();
    // mouse buttons (vanilla handleKeybinds: attack, use, pick block)
    if (active && this.loggedIn) {
      const ia = this.interaction;
      ia.tick();
      const attackPressed = i.consumeMouse(0);
      if (attackPressed) ia.startAttack(this.target);
      ia.continueAttack(i.mouseButtons.has(0) && !attackPressed, this.target);
      ia.use(i.consumeMouse(2), i.mouseButtons.has(2), this.target);
      if (i.consumeMouse(1)) ia.pickBlock(this.target);
      for (let d = 1; d <= 9; d++) if (i.consumePress(`Digit${d}`)) ia.select(d - 1);
      if (i.consumePress('KeyQ')) ia.drop(i.down.has('ControlLeft'));
    }
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
    if (i.wheel !== 0 && this.interaction) this.interaction.scroll(i.wheel);
    if (i.consumePress('F3')) this.showDebug = !this.showDebug;
    if (i.consumePress('F1')) this.hideHud = !this.hideHud;
    if (i.consumePress('F11')) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    }
  }

  // ------------------------------------------------------------------ helpers
  /** Texture layer used for a block's particles (its bottom face, like most "particle" textures). */
  private particleLayer(state: number): number {
    const q = this.bake.states[state]?.choices[0]?.quads;
    if (!q || !q.length) return 0;
    return (q.find((x) => x.dir === 0) ?? q[0]!).layer;
  }

  private particleTint(state: number, x: number, z: number): [number, number, number] {
    const name = blockNameOf(state);
    if (name === 'grass_block') return [1, 1, 1];
    const q = this.bake.states[state]?.choices[0]?.quads;
    if (!q?.some((x) => x.tint >= 0)) return [1, 1, 1];
    void x;
    void z;
    return itemTint(state);
  }

  private swingTime = 0;
  private swinging = false;
  private attackAnim = 0;
  private attackAnimO = 0;
  swingArm(): void {
    if (!this.swinging || this.swingTime >= 3 || this.swingTime < 0) {
      this.swingTime = -1;
      this.swinging = true;
      if (this.loggedIn) this.send({ t: 'swing', hand: 0 });
    }
  }
  private swingTick(): void {
    this.attackAnimO = this.attackAnim;
    if (this.swinging) {
      this.swingTime++;
      if (this.swingTime >= 6) {
        this.swingTime = 0;
        this.swinging = false;
      }
    } else this.swingTime = 0;
    this.attackAnim = this.swingTime / 6;
  }

  /** LocalPlayer.hurtTo: health from the server; a drop plays the hurt animation. */
  private hurtTo(health: number): void {
    if (this.flashOnSetHealth) {
      const f = this.health - health;
      if (f <= 0) {
        this.health = health;
        if (f < 0) this.invulnerableTime = 10;
      } else {
        this.health = health;
        this.invulnerableTime = 20;
        this.hurtDuration = 10;
        this.hurtTime = this.hurtDuration;
      }
    } else {
      this.health = health;
      this.flashOnSetHealth = true;
    }
  }

  get dead(): boolean {
    return this.health <= 0;
  }

  respawn(): void {
    this.send({ t: 'respawn' });
  }

  /** ClientLevel sky flash + LocalPlayer.waterVisionTime. */
  private tickEnvironment(): void {
    if (this.skyFlashTime > 0) this.skyFlashTime--;
    for (const b of this.bolts.values()) if (b.tick()) this.skyFlashTime = 2;
    if (this.player.isUnderWater) this.waterVisionTime = Math.min(600, this.waterVisionTime + (this.gameMode === 3 ? 10 : 1));
    else if (this.waterVisionTime > 0) this.waterVisionTime = Math.max(0, this.waterVisionTime - 10);
  }

  /** LocalPlayer.getWaterVision: eyes adjust to the water over 30 seconds. */
  private waterVision(): number {
    if (!this.player.isUnderWater) return 0;
    const t = this.waterVisionTime;
    if (t >= 600) return 1;
    const f2 = Math.max(0, Math.min(1, t / 100));
    const f3 = t < 100 ? 0 : Math.max(0, Math.min(1, (t - 100) / 500));
    return f2 * 0.6 + f3 * 0.39999998;
  }

  private tickLiving(): void {
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerableTime > 0) this.invulnerableTime--;
    if (this.dead) this.deathTime = Math.min(20, this.deathTime + 1);
    if (this.screen && 'tick' in this.screen && typeof (this.screen as { tick?: unknown }).tick === 'function') (this.screen as unknown as { tick(): void }).tick();
  }

  private hudState(): HudPlayer {
    return {
      gameMode: this.gameMode,
      health: this.health,
      maxHealth: 20,
      absorption: 0,
      armor: 0,
      food: this.food,
      saturation: this.saturation,
      air: this.air,
      maxAir: 300,
      eyeInWater: this.player.isUnderWater,
      invulnerableTime: this.invulnerableTime,
      xpProgress: this.xpProgress,
      xpLevel: this.xpLevel,
      inventory: this.interaction.inventory,
      heartType: 'normal',
      hardcore: false,
      regeneration: false,
      hungerEffect: false,
    };
  }

  private readonly hurtMat = mat4();
  /** Vanilla GameRenderer.bobHurt: hurt tilt (hurtDir is always 0 in 1.17) and the death roll. */
  private applyHurtBob(target: Mat4, partial: number): void {
    let deg = 0;
    if (this.dead) {
      const f1 = Math.min(this.deathTime + partial, 20);
      deg += 40 - 8000 / (f1 + 200);
    }
    const f = this.hurtTime - partial;
    if (f >= 0) {
      const t = f / this.hurtDuration;
      deg += -Math.sin(t * t * t * t * Math.PI) * 14;
    }
    if (deg === 0) return;
    const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    const m = this.hurtMat;
    m.set([c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    multiply(target, target, m);
  }

  /** Test hook: default state of a block by name. */
  stateOfName(name: string): number {
    return BLOCKS_BY_NAME.get(name)?.defaultState ?? 0;
  }

  /** Feet position of an entity that collects items (the local player or a remote one). */
  private collectorPos(id: number, partial: number): [number, number, number] | null {
    if (id === this.entityId) {
      const eye = this.player.eyeHeight;
      return [this.prevX + (this.x - this.prevX) * partial, this.prevY + (this.y - this.prevY) * partial - eye, this.prevZ + (this.z - this.prevZ) * partial];
    }
    const rp = this.players.get(id);
    return rp ? [rp.xo + (rp.x - rp.xo) * partial, rp.yo + (rp.y - rp.yo) * partial, rp.zo + (rp.z - rp.zo) * partial] : null;
  }

  /** LocalPlayer.aiStep xBob/yBob, Player attack strength, ItemInHandRenderer.tick equip height. */
  private tickHand(): void {
    this.xBobO = this.xBob;
    this.yBobO = this.yBob;
    this.xBob += (this.pitch - this.xBob) * 0.5;
    this.yBob += (this.yaw - this.yBob) * 0.5;
    this.attackStrengthTicker++;
    this.oMainHandHeight = this.mainHandHeight;
    const cur = this.interaction.inventory.selectedStack;
    const h = this.handItem;
    const matches = (!h && !cur) || (!!h && !!cur && h.id === cur.id && h.count === cur.count && h.damage === cur.damage);
    if (matches) this.handItem = cur;
    const delay = 20 / attackSpeedOf(cur?.id ?? 0);
    const f = Math.min(1, Math.max(0, (this.attackStrengthTicker + 1) / delay));
    const same = this.handItem === cur;
    this.mainHandHeight += Math.max(-0.4, Math.min(0.4, (same ? f * f * f : 0) - this.mainHandHeight));
    if (this.mainHandHeight < 0.1) this.handItem = cur;
  }

  /** Called by a swing at nothing (vanilla startAttack on a miss). */
  resetAttackStrength(): void {
    this.attackStrengthTicker = 0;
  }

  /** ScreenEffectRenderer.getViewBlockingState: a view-blocking block around the eye → its texture layer. */
  private viewBlockingLayer(): number {
    if (this.player.abilities.noPhysics) return -1;
    const p = this.player, w = p.width * 0.8, ey = p.y + p.eyeHeight;
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(p.x + ((i & 1) - 0.5) * w);
      const y = Math.floor(ey + (((i >> 1) & 1) - 0.5) * 0.1);
      const z = Math.floor(p.z + (((i >> 2) & 1) - 0.5) * w);
      const st = this.world.getState(x, y, z);
      if (isViewBlocking(st)) return this.particleLayer(st);
    }
    return -1;
  }

  /** LightTexture.getBrightness of the light at the eye (overworld, ambient 0). */
  private eyeBrightness(): number {
    const p = this.player;
    const l = this.world.getLight(Math.floor(p.x), Math.floor(p.y + p.eyeHeight), Math.floor(p.z));
    const sky = Math.max(0, (l >> 4) - this.skyDarkenLevel()), blk = l & 15;
    const f = Math.max(sky, blk) / 15;
    return f / (4 - 3 * f);
  }

  /** Level.getSkyDarken as an integer light reduction (0..11). */
  private skyDarkenLevel(): number {
    const tod = timeOfDay(this.world.dayTime);
    let d = 1 - (Math.cos(tod * Math.PI * 2) * 2 + 0.5);
    d = Math.max(0, Math.min(1, d));
    d = 1 - d;
    d *= 1 - (this.world.rain * 5) / 16;
    d *= 1 - (this.world.thunder * 5) / 16;
    return Math.floor((1 - d) * 11);
  }

  private readonly handBob = mat4();
  private renderHand(partial: number, medium: string): void {
    const showHand = !this.hideHud && this.gameMode !== 3;
    const fire = this.onFire && this.gameMode !== 3;
    // bobHurt then bobView, like the level camera
    const hb = this.handBob;
    hb.set(IDENTITY4);
    this.applyHurtBob(hb, partial);
    if (this.settings.viewBobbing && !this.player.abilities.flying) multiply(hb, hb, this.bobMat);
    const st = this.handItem;
    const block = st ? blockForItem(st.id) : null;
    const sw = this.attackAnim - this.attackAnimO;
    const eyeX = Math.floor(this.x), eyeY = Math.floor(this.y), eyeZ = Math.floor(this.z);
    this.hand.render({
      stack: st,
      blockState: block ? BLOCKS_BY_NAME.get(block)!.defaultState : null,
      swing: this.attackAnimO + (sw < 0 ? sw + 1 : sw) * partial,
      equip: 1 - (this.oMainHandHeight + (this.mainHandHeight - this.oMainHandHeight) * partial),
      pitch: this.pitch,
      yaw: this.yaw,
      xBob: this.xBobO + (this.xBob - this.xBobO) * partial,
      yBob: this.yBobO + (this.yBob - this.yBobO) * partial,
      light: this.world.getLight(eyeX, eyeY, eyeZ),
      skinName: new URLSearchParams(location.search).get('name') ?? 'Player',
      aspect: this.canvas.width / Math.max(1, this.canvas.height),
      fluidFov: medium === 'air' ? 1 : 0.85714287,
      bob: hb,
      viewRot: this.view,
      showHand,
      onFire: fire,
      inWallLayer: this.viewBlockingLayer(),
      underwater: this.gameMode !== 3 && this.player.isUnderWater
        ? { brightness: this.eyeBrightness(), yaw: this.yaw, pitch: this.pitch }
        : null,
    }, this.lightmap.tex);
  }

  private readonly itemModel = mat4();
  private readonly itemRand = new JavaRandom(0n);
  /** Dropped items: block items as small spinning, bobbing cubes (vanilla ItemEntityRenderer). */
  private renderItems(cx: number, cy: number, cz: number, partial: number, fog: [number, number, number], fogStart: number, fogEnd: number): void {
    for (const it of this.items.values()) {
      if (!it.item) continue;
      // Entity.shouldRenderAtSqrDistance: bounding-box size (0.25) × 64 × entity distance
      const ed = 0.25 * 64 * this.settings.entityDistance;
      if ((it.x - cx) ** 2 + (it.y - cy) ** 2 + (it.z - cz) ** 2 >= ed * ed) continue;
      const block = blockForItem(it.item);
      if (!block) continue;
      const state = BLOCKS_BY_NAME.get(block)!.defaultState;
      let x = it.xo + (it.x - it.xo) * partial, y = it.yo + (it.y - it.yo) * partial, z = it.zo + (it.z - it.zo) * partial;
      if (it.pickup) {
        const tgt = this.collectorPos(it.pickup.collector, partial);
        if (tgt) {
          const f = Math.min(1, (it.pickup.life + partial) / 3);
          const f2 = f * f;
          x += (tgt[0] - x) * f2;
          y += (tgt[1] + 0.5 - y) * f2;
          z += (tgt[2] - z) * f2;
        }
      }
      const age = it.age + partial;
      const bob = Math.sin(age / 10 + it.bobOffs) * 0.1 + 0.1;
      const spin = age / 20 + it.bobOffs;
      const copies = it.count > 48 ? 5 : it.count > 32 ? 4 : it.count > 16 ? 3 : it.count > 1 ? 2 : 1;
      const light = this.world.getLight(Math.floor(x), Math.floor(y + 0.25), Math.floor(z));
      // ground transforms (blocks: scale 0.25, raised 3px; generated items: scale 0.5, raised 2px)
      // plus vanilla's 0.25·scale lift
      const flat = this.blockItems.isFlat(state);
      const cs = Math.cos(spin), sn = Math.sin(spin), sc = flat ? 0.5 : 0.25;
      const lift = (flat ? 2 / 16 : 3 / 16) + 0.25 * sc;
      const rand = this.itemRand;
      rand.setSeed(BigInt(it.item));
      let stackZ = 0;
      for (let c = 0; c < copies; c++) {
        // extra copies: random offsets within ±0.15 (3D) or ±0.075 in-plane (flat), in the spun frame
        let ox = 0, oy = 0, oz = 0;
        if (c > 0) {
          ox = (rand.nextFloat() * 2 - 1) * 0.15 * (flat ? 0.5 : 1);
          oy = (rand.nextFloat() * 2 - 1) * 0.15 * (flat ? 0.5 : 1);
          if (!flat) oz = (rand.nextFloat() * 2 - 1) * 0.15;
        }
        oz += stackZ;
        if (flat) stackZ += 0.09375 * sc;
        const wx = cs * ox + sn * oz, wz = -sn * ox + cs * oz;
        const m = this.itemModel;
        m.set([cs * sc, 0, -sn * sc, 0, 0, sc, 0, 0, sn * sc, 0, cs * sc, 0, x - cx + wx, y - cy + bob + lift + oy, z - cz + wz, 1]);
        this.blockItems.draw(state, this.viewProj, m, light, this.lightmap.tex, { color: fog, start: fogStart, end: fogEnd });
      }
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
    skyState.flash = this.skyFlashTime > 0 ? this.skyFlashTime - partial : 0;
    const sky = skyColor(skyState, this.skyRgb);
    const fog = fogColor(skyState, sky, this.fogRgb);
    const renderDist = s.renderDistance * 16;
    let fogStart = renderDist * 0.75, fogEnd = renderDist;
    if (medium === 'water') {
      // FogRenderer: 192 × max(0.25, water vision) × (0.85 in swamps), halved
      const wv = this.waterVision();
      let f = 192 * Math.max(0.25, wv);
      if (biome.category === 'swamp') f *= 0.85;
      fogStart = -8;
      fogEnd = f * 0.5;
      // the fog colour brightens toward full saturation as the eyes adjust
      if (fog[0] > 0 && fog[1] > 0 && fog[2] > 0) {
        const k = Math.min(1 / fog[0], 1 / fog[1], 1 / fog[2]);
        for (let i = 0; i < 3; i++) fog[i] = fog[i]! * (1 - wv) + fog[i]! * k * wv;
      }
    } else if (medium === 'lava') {
      fogStart = 0.25;
      fogEnd = 1;
    }

    this.lightmap.update({
      skyDarken: skyDarken(tod, this.world.rain, this.world.thunder),
      ambient: 0,
      gamma: s.gamma,
      nightVision: 0,
      flash: this.skyFlashTime > 0,
      end: false,
    });

    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    let fov = s.fov * (this.oFov + (this.fovModifier - this.oFov) * partial);
    if (medium === 'water') fov *= 0.85714287;
    perspective(this.proj, (fov * Math.PI) / 180, aspect, 0.05, Math.max(renderDist * 4, 512));
    this.applyHurtBob(this.proj, partial);
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
      // players: bounding-box size 1.0 × 64 blocks × entity distance
      const ed = 64 * this.settings.entityDistance;
      const visible = [...this.players.values()].filter((p) => (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2 < ed * ed);
      this.entityRenderer.renderPlayers(visible, this.world, this.viewProj, cx, cy, cz, partial, this.lightmap.tex, fog, fogStart, fogEnd);
    }
    this.renderItems(cx, cy, cz, partial, fog, fogStart, fogEnd);
    if (this.bolts.size) {
      const ed = 64 * this.settings.entityDistance;
      this.lightning.render([...this.bolts.values()].filter((b) => (b.x - cx) ** 2 + (b.y - cy) ** 2 + (b.z - cz) ** 2 < ed * ed), this.viewProj, cx, cy, cz);
    }
    for (const c of this.otherCracks.values()) {
      const st = this.world.getState(c.x, c.y, c.z);
      if (st) this.crack.render(this.viewProj, this.textures.tex, c.x, c.y, c.z, st, Math.min(9, c.stage), cx, cy, cz);
    }
    this.chunks.renderTranslucent(cx, cy, cz, this.textures.tex, this.lightmap.tex);
    // particles: camera-facing quads
    {
      const yr2 = (this.yaw * Math.PI) / 180, pr2 = (this.pitch * Math.PI) / 180;
      const rx = -Math.cos(yr2), rz = -Math.sin(yr2);
      const ux = -Math.sin(yr2) * Math.sin(pr2) * -1, uy = Math.cos(pr2), uz = Math.cos(yr2) * Math.sin(pr2) * -1;
      this.particles.render(this.viewProj, rx, 0, rz, ux, uy, uz, cx, cy, cz, partial, this.textures.tex, this.lightmap.tex, fog, fogStart, fogEnd);
    }
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
      const stage = this.breakStage >= 0 ? this.breakStage : this.interaction.crackStage;
      const ia = this.interaction;
      if (stage >= 0 && (this.breakStage >= 0 || (ia.destroyX === t.x && ia.destroyY === t.y && ia.destroyZ === t.z))) this.crack.render(this.viewProj, this.textures.tex, t.x, t.y, t.z, t.state, stage, cx, cy, cz);
    }
    this.weather.render(this.viewProj, this.world, cx, cy, cz, this.clientTicks, partial, this.world.rain, s.graphics === 'fancy', this.lightmap.tex);
    if (medium === 'air') {
      this.clouds.render(this.viewProj, cx, cy, cz, this.clientTicks + partial, s.clouds, s.renderDistance, cloudColor(tod, this.world.rain, this.world.thunder), fog);
    }
    this.renderHand(partial, medium);
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
      this.hud.render(g, this.hudState(), (id, c, x, y) => this.renderGuiItem(id, c, x, y));
    }
    if (this.screen) this.screen.render(this.mouseGX, this.mouseGY);
  }

  /** A 16×16 item in the GUI with its stack count (vanilla ItemRenderer.renderGuiItem + decorations). */
  renderGuiItem(id: number, count: number, x: number, y: number): void {
    const g = this.gui;
    const block = blockForItem(id);
    const icon = block ? this.blockItems.icon(BLOCKS_BY_NAME.get(block)!.defaultState) : null;
    if (icon) g.blit(this.blockItems.iconCanvas, icon[0], icon[1], icon[2], icon[2], x, y, 16, 16);
    else {
      // no item texture yet: magenta/black "missing" square like vanilla's missing texture
      g.fill(x, y, 8, 8, 0xfff800f8);
      g.fill(x + 8, y + 8, 8, 8, 0xfff800f8);
      g.fill(x + 8, y, 8, 8, 0xff000000);
      g.fill(x, y + 8, 8, 8, 0xff000000);
    }
    if (count !== 1) {
      const s = String(count);
      g.text(s, x + 19 - 2 - g.font.width(s), y + 6 + 3, 0xffffff, true);
    }
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

const IDENTITY4 = mat4();

/** Default item tints (vanilla ItemColors): grass and leaves in item form. */
function itemTint(state: number): [number, number, number] {
  const n = blockNameOf(state);
  const hex = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  if (n === 'spruce_leaves') return hex(0x619961);
  if (n === 'birch_leaves') return hex(0x80a755);
  if (n.endsWith('_leaves') || n === 'vine') return hex(0x48b518);
  if (n === 'grass_block' || n === 'grass' || n === 'tall_grass' || n === 'fern' || n === 'large_fern') return hex(0x7cbd6b);
  if (n === 'lily_pad') return hex(0x208030);
  return [1, 1, 1];
}
