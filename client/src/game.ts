/**
 * The client game: networking to a (local or remote) server, world mirror, camera,
 * frame loop and renderers.
 */
import { animateFluids } from './world/fluidambience';
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
import { outlineBoxes, type Box } from '@shared/world/shapes';
import { blockNameOf, propsOf, getProp, stateToString, STATE_TO_BLOCK } from '@shared/world/blockstate';
import { PlayerPhysics, POSE_EYE, type MoveInput, type Pose } from '@shared/entity/playerphysics';
import { mat4, perspective, viewRotation, multiply, translate, frustumPlanes, aabbInFrustum, type Mat4 } from './render/math';
import type { TextureManifest } from './render/blockmodels';
import { Gui } from './gui/gui';
import { RemotePlayer, wrapDegrees } from './world/entities';
import { Interaction } from './interaction';
import { ParticleEngine } from './render/particles';
import { BlockItemRenderer } from './render/blockitem';
import { FallingBlocks } from './world/fallingblocks';
import { FULL_COLLISION } from '@shared/world/blockinfo';
import { HandRenderer, attackSpeedOf, type HeldItemModel, type HandSide } from './render/hand';
import { handsToRender, swingDuration, tickHandHeight, type UseAnim } from './render/handpose';
import { Hud, type HudPlayer } from './gui/hud';
import { SpectatorGui, type PlayerInfoEntry } from './gui/spectator';
import { keyName } from './keybinds';
import { DeathScreen } from './gui/deathscreen';
import { InBedScreen } from './gui/inbed';
import { ClientBolt, LightningRenderer } from './render/lightning';
import { OrbRenderer, type OrbView } from './render/orbs';
import { SoundEngine, type SoundCategory } from './audio/engine';
import { soundName, SOUND_SOURCES } from '@shared/sound/events';
import { soundTypeOf } from '@shared/world/soundtype';
import { attackStrengthScale } from '@shared/game/combat';
import { skyDarkenLevel } from '@shared/world/daylight';
import { isRainingAt } from '@shared/world/weather';
import { StepTracker } from '@shared/entity/steps';
import { Button } from './gui/screen';
import { KeyBindings } from './keybinds';
import { blockForItem } from '@shared/game/loot';
import { BLOCKS_BY_NAME, ITEMS_BY_ID, ITEMS_BY_NAME } from '@shared/data';
import { itemName, decodeTag, type ItemStack, type ItemTag } from '@shared/item/stack';
import { EffectsClient } from './effects';
import './gui/enchantmentscreen';
import './gui/brewingscreen';
import './gui/anvilscreen';
import { entityEnchLevel, hasFoil } from '@shared/game/enchantments';
import type { BakeResult } from './models/bake';
import { flatItemTexture } from './models/itemmodels';
import { isViewBlocking, hasMenuProvider } from '@shared/world/blockprops';
import { JavaRandom } from '@shared/util/random';
import { EntityRenderer, recycleHeld, heldItemTransform } from './render/entities/entityrenderer';
import { MobRenderer } from './render/entities/mobrenderer';
import { ClientMobs, isMobType, type ClientMob } from './world/mobs';
import type { Screen } from './gui/screen';
import { LoadingTerrainScreen, type LoadingHost } from './gui/loadingscreen';
import { PauseScreen, type ScreenHost } from './gui/screens';
import { AbstractContainerScreen, InventoryScreen, MerchantScreen, screenForMenu, type ContainerHost } from './gui/containerscreen';
import { CreativeScreen } from './gui/creative';
import { saveHotbar, savedHotbars } from './gui/hotbars';
import { InventoryMenu, createClientMenu, type Menu, type MenuType } from '@shared/menu/menu';
import { InventoryContainer } from '@shared/menu/container';
import { decodeStacks } from '@shared/protocol/packets';
import { saveSettings } from './settings';
import { MusicManager, situationalMusic, MUSICS } from './audio/music';
import { AmbientSounds } from './audio/ambient';
import { ClientItemUse } from './itemuse';
import { renderEffects } from './gui/effects';
import { useDuration } from '@shared/game/items';

import { ClientArrows } from './world/arrows';
import { itemName as itemNameOfId } from '@shared/item/stack';
import { ItemTextures } from './render/itemtextures';
import { setItemIconBackend, spriteLayerFor, drawItemStack, itemAnim } from './gui/itemicons';
import { netherFogColor, netherFogRange, PortalEffect, applyPortalWobble, insidePortal, ambientLight, hasSky, animatePortals, endFogColor } from './world/dimension';
import { EndSkyRenderer } from './render/endsky';
import { CreditsScreen } from './gui/credits';
import { BossOverlay } from './gui/bossbar';
import { isPortal } from '@shared/game/portalshape';
import { ChatScreen, InBedChatScreen, DisconnectedScreen, componentToLegacy, componentClick, renderPlayerList, type ChatHost, type SuggestionReply } from './gui/chat';

export class Game implements ScreenHost, ContainerHost {
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
  private mobRenderer!: MobRenderer;
  private readonly visibleMobs: ClientMob[] = [];
  /** Client-side mobs (addEntity with a mob type), by entity id. */
  readonly mobs = new ClientMobs({
    sound: (ev, cat, x, y, z, vol, pitch) => this.playAt(ev, cat, x, y, z, vol, pitch),
    hasSound: (ev) => this.sound.has(ev),
    blockStep: (x, y, z, category) => {
      const st = this.world.getState(Math.floor(x), Math.floor(y - 0.2), Math.floor(z));
      if (st === 0) return;
      const t = soundTypeOf(st);
      this.playAt(t.step, category, x, y, z, t.volume * 0.15, t.pitch);
    },
    poof: (m) => this.mobRenderer?.poof(m),
    forget: (id) => this.mobRenderer?.forget(id),
  });
  /** Other players (and later all entities), by entity id. */
  readonly players = new Map<number, RemotePlayer>();
  private sentState = { sneaking: false, sprinting: false, flying: false };
  interaction!: Interaction;
  /** item use state (eating/drinking/bow), effects, absorption — read by the HUD and first-person renderer */
  itemUse!: ClientItemUse;
  readonly arrows = new ClientArrows();
  /** eating crumbs / broken tool bits drawn from the item sprite texture */
  private itemParticles!: ParticleEngine;
  /** LocalPlayer.portalTime (nausea / portal screen wobble, 0–1) */
  portalTime = 0;
  oPortalTime = 0;
  private readonly nauseaMat = mat4();
  private readonly nauseaTmp = mat4();
  private texLayers: Map<string, { layer: number }> | null = null;
  private readonly hud = new Hud();
  /** boss bars (bossEvent packets) */
  readonly bossBars = new BossOverlay();
  /** online players (vanilla PlayerInfo list) */
  readonly playerInfo = new Map<number, PlayerInfoEntry>();
  /** operator permission level from the server (vanilla LocalPlayer.permissionLevel); integrated servers start at 4 */
  permissionLevel = 4;
  /** ping per player id (vanilla PlayerInfo latency) */
  readonly playerLatency = new Map<number, number>();
  /** camera position of the last frame (nameplates project from it) */
  private readonly camPos = [0, 0, 0];
  /** entity the camera looks through while spectating (null = ourselves) */
  cameraEntity: number | null = null;
  /** game mode before the last change (F3+N returns to it) */
  previousGameMode = -1;
  private readonly skinImages = new Map<string, ImageBitmap | null>();
  private readonly spectatorGui = new SpectatorGui({
    playerInfo: this.playerInfo,
    skinImage: (name, skin) => {
      const file = this.entityRenderer.skinFor(name, skin);
      if (!this.skinImages.has(file)) {
        this.skinImages.set(file, null);
        void fetch(file.startsWith('data:') ? file : `./textures/skins/${file}.png`).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((img) => this.skinImages.set(file, img));
      }
      return this.skinImages.get(file) ?? null;
    },
    teleportTo: (id) => this.send({ t: 'spectate', target: id }),
    hotbarKeyName: (i) => keyName(this.binds.key(`hotbar.${i + 1}`)),
  });
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
  /** in bed (server pose) and the client-side Player.sleepCounter for the fade */
  sleeping = false;
  private sleepCounter = 0;
  /** Entity.ticksFrozen from the server (140 = fully frozen) */
  ticksFrozen = 0;
  private frostOverlay: ImageBitmap | null = null;
  // ---- dimensions / nether portals ----
  /** Current dimension (login / dimension packets): overworld, the_nether, the_end. */
  dimension = 'overworld';
  /** The End's sky box (created on first use). */
  private endSky: EndSkyRenderer | null = null;
  readonly portalFx = new PortalEffect();
  private readonly portalRand = new JavaRandom(BigInt(Date.now()) ^ 0x5deece66dn);
  private portalOverlay: ImageBitmap | null = null;
  private skyFlashTime = 0;
  readonly bolts = new Map<number, ClientBolt>();
  /** falling sand/gravel/anvils (Phase 4 block behaviours) */
  readonly fallingBlocks = new FallingBlocks();
  private readonly boltRand = new JavaRandom(BigInt(Date.now()));
  private lightning!: LightningRenderer;
  private orbRenderer!: OrbRenderer;
  readonly sound = new SoundEngine();
  /** vanilla MusicManager (one streamed track at a time, 10-20 min apart in game) */
  readonly music = new MusicManager((event) => this.sound.playStream(event, 'music', 1));
  /** cave mood sounds and underwater ambience */
  private readonly ambient = new AmbientSounds({
    playAt: (event, x, y, z, volume, pitch) => this.playAt(event, 'ambient', x, y, z, volume, pitch),
    playRelative: (event, volume, pitch) => this.sound.play(event, 'ambient', volume, pitch),
    playLoop: (event) => this.sound.playStream(event, 'ambient', 0, true),
  });
  private readonly steps = new StepTracker();
  private readonly sfxRand = new JavaRandom(BigInt(Date.now()) ^ 0x5deece66dn);
  private rainSoundTime = 0;
  private wasOnGround = true;
  private hand!: HandRenderer;
  // ItemInHandRenderer / LocalPlayer state for the first-person hand
  private xBob = 0;
  private xBobO = 0;
  private yBob = 0;
  private yBobO = 0;
  private mainHandHeight = 0;
  private oMainHandHeight = 0;
  private handItem: { id: number; count: number; damage: number } | null = null;
  private offHandHeight = 0;
  private oOffHandHeight = 0;
  private offHandItem: { id: number; count: number; damage: number } | null = null;
  attackStrengthTicker = 0;
  particles!: ParticleEngine;
  blockItems!: BlockItemRenderer;
  itemTextures!: ItemTextures;
  /** where the compass points (vanilla: world spawn; approximated by where we first joined) */
  compassTarget: [number, number] | null = null;
  private bake!: BakeResult;
  /** Dropped item entities: id → state for rendering. */
  readonly items = new Map<number, { x: number; y: number; z: number; xo: number; yo: number; zo: number; lx: number; ly: number; lz: number; steps: number; item: number; count: number; age: number; bobOffs: number; pickup?: { collector: number; life: number }; orb?: number; tag?: ItemTag }>();
  entityId = 0;
  /** Other players' digging cracks: player id → position + stage. */
  private otherCracks = new Map<number, { x: number; y: number; z: number; stage: number }>();
  private crack!: CrackRenderer;
  /** Current block-breaking progress stage (-1 none, 0..9). Driven by mining in Phase 2. */
  breakStage = -1;
  /** Block the crosshair points at (reach 5 in creative, 4.5 survival). */
  target: BlockHit | null = null;
  /** entity in the crosshair (GameRenderer.pick), or null */
  targetEntity: number | null = null;
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
  /** vanilla CameraType: 0 first person, 1 third person back, 2 third person front */
  cameraType = 0;
  /** world difficulty (0 peaceful .. 3 hard) */
  difficulty = 2;
  private f3Used = false;
  /** F3+G chunk boundaries */
  showChunkBorders = false;
  /** last text copied by F3+C / F3+I (tests read it; the clipboard may be unavailable) */
  lastClipboard = '';
  private scrollAcc = 0;
  binds!: KeyBindings;
  showHitboxes = false;
  private selfModel: RemotePlayer | null = null;
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
    this.input.debugKeys = new Set(DEBUG_KEYS);
    const q = new URLSearchParams(location.search);
    this.settings = applyQueryOverrides(loadSettings(), q);
    this.binds = new KeyBindings(this.input, () => this.settings);
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
      if (!this.screen) return;
      if (this.screen.mouseButton(this.mouseGX, this.mouseGY, e.button)) return;
      if (e.button === 0) this.screen.mouseDown(this.mouseGX, this.mouseGY);
    });
    guiCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
    guiCanvas.addEventListener('wheel', (e) => {
      toGui(e);
      this.screen?.mouseScrolled(this.mouseGX, this.mouseGY, e.deltaMode === 0 ? e.deltaY / 100 : e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY);
    }, { passive: true });
    guiCanvas.addEventListener('mousemove', (e) => {
      toGui(e);
      this.screen?.mouseMove(this.mouseGX, this.mouseGY);
    });
    window.addEventListener('mouseup', (e) => this.screen?.mouseUp(e.button));
    window.addEventListener('keydown', (e) => {
      if (this.screen) {
        const sc = this.screen;
        if (sc.keyDown(e.code)) e.preventDefault();
        if (this.screen === sc && e.key.length === 1 && !e.ctrlKey && !e.metaKey && sc.charTyped(e.key)) e.preventDefault();
      }
    });
    this.input.onLockChange = (locked) => {
      // losing the pointer (Escape, alt-tab) opens the pause menu like vanilla; F3+Esc pauses without it
      if (!locked && !this.screen && this.loggedIn) {
        const f3 = this.input.unlockedWithF3;
        if (f3) this.f3Used = true;
        this.setScreen(new PauseScreen(this, !f3));
      }
    };
    // Minecraft.setWindowActive(false) with pauseOnLostFocus: the pause menu
    window.addEventListener('blur', () => {
      if (this.settings.pauseOnLostFocus && !this.screen && this.loggedIn && !this.dead) this.setScreen(new PauseScreen(this));
    });
    // clicking the world while no screen is open grabs the mouse again
    canvas.addEventListener('mousedown', () => {
      if (!this.screen && !this.input.locked) this.input.lock();
    });
  }

  // ------------------------------------------------------------------ screens (ScreenHost)
  setScreen(s: Screen | null): void {
    this.screen?.onClose();
    this.screen = s;
    // keys and clicks made while a screen was up don't carry over to the world
    this.input.clearPressed();
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

  private quitting = false;

  /** "Save and Quit to Title": save the world (showing "Saving world"), then back to the launcher. */
  quitToTitle(): void {
    if (this.quitting) return;
    this.quitting = true;
    const leave = () => {
      location.href = location.pathname;
    };
    if (!this.integrated?.worldId) {
      leave();
      return;
    }
    void import('./gui/savingscreen').then(({ MessageScreen }) => this.setScreen(new MessageScreen(this.gui, 'Saving world')));
    this.integrated.saveAndStop().then(leave, (e: unknown) => {
      console.error('saving failed', e);
      alert(`Saving the world failed: ${(e as Error).message}`);
      leave();
    });
  }

  /**
   * Save the single-player world before the window closes (the desktop app calls this from its
   * close handler, like vanilla saving on exit). Resolves once the world is written.
   */
  async saveForExit(): Promise<void> {
    if (this.quitting || !this.integrated?.worldId) return;
    this.quitting = true;
    void import('./gui/savingscreen').then(({ MessageScreen }) => this.setScreen(new MessageScreen(this.gui, 'Saving world')));
    await this.integrated.saveAndStop();
  }

  async start(): Promise<void> {
    const q = new URLSearchParams(location.search);
    this.hud.chatOptions = this.settings;
    // single-player: start the integrated server and join right away, so it generates the spawn
    // chunks while textures and models load (packets are held until the client is ready)
    const integratedP = q.has('server') || q.has('join') ? null : startIntegratedServer(BigInt(q.get('seed') ?? '12345'), q.get('scene') ?? '',
      { survival: 0, creative: 1, adventure: 2, spectator: 3 }[q.get('gamemode') ?? 'survival'] ?? 0, q.get('world')).then((r) => {
      this.preconnect(r.transport);
      return r;
    });
    integratedP?.catch(() => {}); // reported where it is awaited
    await Promise.all([this.gui.load(), this.hud.load(), this.sound.load(), this.spectatorGui.load(), this.effectsClient.load()]);
    void fetch('./textures/block/nether_portal.png').then((r) => r.blob()).then((b) => createImageBitmap(b)).then((bmp) => (this.portalOverlay = bmp)).catch(() => {});
    void fetch('./textures/environment/powder_snow_outline.png').then((r) => r.blob()).then((b) => createImageBitmap(b)).then((bmp) => (this.frostOverlay = bmp));
    for (const [c, v] of Object.entries(this.settings.volumes)) this.sound.volumes[c as SoundCategory] = v;
    // audio may only start after a user gesture
    const unlock = () => this.sound.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    Button.onPress = () => this.playUi('ui.button.click', 1);
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
    await this.entityRenderer.loadArmor();
    this.mobRenderer = new MobRenderer(this.gl);
    await this.mobRenderer.load();
    // items in mobs' hands join the players' held-item queue (drawn after the entities)
    this.mobRenderer.onHeld = (arm, light, item, left) => {
      const info = this.entityRenderer.itemModel(item);
      if (!info) return;
      const out = mat4();
      multiply(out, arm, heldItemTransform(left, info.flat));
      this.entityRenderer.held.push({ matrix: out, light, item, left });
    };
    this.entityRenderer.localSkin = this.settings.skin;
    const mainBake = bakeBlockModels(this.manifest, this.settings.graphics === 'fancy');
    this.bake = mainBake.bake;
    this.texLayers = mainBake.textures;
    this.particles = new ParticleEngine(this.gl, this.world);
    this.itemParticles = new ParticleEngine(this.gl, this.world);
    this.blockItems = new BlockItemRenderer(this.gl, mainBake.bake, () => this.textures.tex, (st) => itemTint(st), (st) => {
      const t = flatItemTexture(blockNameOf(st));
      return t === null ? null : (mainBake.textures.get(t)?.layer ?? mainBake.textures.get('missing')!.layer);
    }, (layer) => this.textures.alpha[layer]);
    // item sprites: extruded 3D models (BlockItemRenderer) and GUI icons (gui/itemicons)
    this.itemTextures = await ItemTextures.load();
    const sprites = this.itemTextures;
    this.blockItems.sprites = {
      texture: () => sprites.texture(this.gl),
      alpha: (l) => sprites.alpha[l],
      layerFor: (id) => spriteLayerFor(sprites, id),
      layerByName: (name) => sprites.layer(name),
      handheld: (l) => sprites.handheld(l),
    };
    this.blockItems.blockOf = (id) => {
      const b = blockForItem(id);
      return b ? BLOCKS_BY_NAME.get(b)!.defaultState : null;
    };
    setItemIconBackend({
      sprites,
      blockIcon: (id) => {
        const st = this.blockItems.blockOf(id);
        const ic = st === null ? null : this.blockItems.icon(st);
        return ic ? [this.blockItems.iconCanvas, ic[0], ic[1], ic[2]] : null;
      },
    });
    this.lightning = new LightningRenderer(this.gl);
    this.orbRenderer = new OrbRenderer(this.gl);
    this.entityRenderer.bedFacing = (rp) => {
      const st = this.world.getState(Math.floor(rp.x), Math.floor(rp.y), Math.floor(rp.z));
      if (!blockNameOf(st).endsWith('_bed')) return null;
      return ({ south: 0, west: 90, north: 180, east: 270 } as Record<string, number>)[getProp(st, 'facing') as string] ?? null;
    };
    this.entityRenderer.itemModel = (item) => {
      const key = this.blockItems.modelKey(item);
      if (key === null) return null;
      const d = this.blockItems.display(key);
      return { flat: d !== 'block', handheld: d === 'handheld' || d === 'handheld_rod' };
    };
    this.heldModels.clear();
    this.hand = new HandRenderer(this.gl, this.entityRenderer, (st) => this.heldItemModel(st), () => this.textures.tex, mainBake.textures.get('fire_1')!.layer);
    this.growthParticleLayer = mainBake.textures.get('snow')?.layer ?? 0;
    this.interaction = new Interaction({
      world: this.world,
      player: this.player,
      get gameMode() { return game.gameMode; },
      get yaw() { return game.yaw; },
      get pitch() { return game.pitch; },
      send: (p) => this.send(p),
      onBlockBroken: (x, y, z, st) => this.blockBroken(x, y, z, st),
      onBlockHit: (x, y, z, face, st) => this.particles.crack(x, y, z, face, st, this.particleLayer(st), this.particleTint(st, x, z)),
      onDigSound: (x, y, z, st) => {
        // MultiPlayerGameMode.continueDestroyBlock hit sound
        const t = soundTypeOf(st);
        this.playAt(t.hit, 'block', x + 0.5, y + 0.5, z + 0.5, (t.volume + 1) / 8, t.pitch * 0.5);
      },
      onBlockPlaced: (x, y, z, st) => {
        const t = soundTypeOf(st);
        this.playAt(t.place, 'block', x + 0.5, y + 0.5, z + 0.5, (t.volume + 1) / 2, t.pitch * 0.8);
      },
      swing: (hand) => this.swingArm(hand ?? 0),
      itemUsed: (hand) => {
        if (hand === 0) this.mainHandHeight = 0;
        else this.offHandHeight = 0;
      },
      onAttack: () => {
        // client-side Player.attack: a charged sprint hit slows us and stops sprinting
        const charged = attackStrengthScale(this.attackStrengthTicker, this.interaction.inventory.selectedStack?.id ?? 0, 0.5, this.attackSpeedMul()) > 0.9;
        if (charged && this.player.sprinting) {
          this.player.vx *= 0.6;
          this.player.vz *= 0.6;
          this.player.sprinting = false;
        }
        this.resetAttackStrength();
      },
      missSwing: () => {
        this.swingArm();
        this.resetAttackStrength();
      },
      useItem: (hand, stack) => this.itemUse.tryUse(hand, stack, this.interaction.inventory),
      miningEffects: () => ({
        haste: Math.max(this.itemUse.amplifier('haste'), this.itemUse.amplifier('conduit_power')) + 1,
        miningFatigue: this.itemUse.amplifier('mining_fatigue') + 1,
      }),
    });
    this.itemUse = new ClientItemUse({
      send: (p) => this.send(p),
      gameMode: () => this.gameMode,
      foodLevel: () => this.food,
      playLocal: (ev, v, pi) => this.playPlayer(ev, v, pi),
      entityView: (id) => {
        if (id === this.entityId) return { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch };
        const rp = this.players.get(id);
        return rp ? { x: rp.x, y: rp.y + (rp.pose === 'crouching' ? 1.27 : 1.62), z: rp.z, yaw: rp.headYaw, pitch: rp.pitch } : null;
      },
      itemParticle: (item, x, y, z, vx, vy, vz) => {
        // block items use the terrain atlas; item sprites live in their own texture array
        const block = blockForItem(item);
        const sprite = block ? -1 : this.itemTextures ? spriteLayerFor(this.itemTextures, item) : -1;
        if (sprite >= 0) this.itemParticles.item(x, y, z, vx, vy, vz, sprite);
        else if (block) this.particles.item(x, y, z, vx, vy, vz, this.itemParticleLayer(item));
      },
      get selfId() { return game.entityId; },
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
        // ?world=<id>: a saved world from the launcher (IndexedDB); otherwise a transient one
        const { server, transport } = await integratedP!;
        // held packets (login → screens) are handled before the first frame: size the GUI now
        this.gui.begin(this.settings.guiScale);
        this.integrated = server;
        if (server.worldId) {
          // best effort: save when the tab is hidden or closed (the worker may not finish on close)
          const flush = () => {
            if (!this.quitting) server.save().catch(() => {});
          };
          window.addEventListener('pagehide', flush);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
          });
        }
        this.connect(transport);
        if (q.has('host')) this.openToLan(q.get('host') || undefined);
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Packets that arrived before the client finished loading (see preconnect). */
  private earlyPackets: ArrayBuffer[] | null = null;

  /** Join early and hold the server's packets until connect() is called with the same transport. */
  private preconnect(t: ClientTransport): void {
    const early: ArrayBuffer[] = [];
    this.earlyPackets = early;
    this.transport = t;
    t.onMessage = (d) => early.push(d);
    t.onClose = (r) => {
      console.warn('disconnected', r);
      this.showDisconnected(r);
    };
    this.send({ t: 'hello', protocol: PROTOCOL_VERSION, name: new URLSearchParams(location.search).get('name') ?? 'Player', viewDistance: this.settings.renderDistance, skin: this.settings.skin });
  }

  connect(t: ClientTransport): void {
    if (this.earlyPackets && this.transport === t) {
      const early = this.earlyPackets;
      this.earlyPackets = null;
      t.onMessage = (d) => this.handle(decodeS2C(d));
      for (const d of early) this.handle(decodeS2C(d));
      return;
    }
    this.transport = t;
    t.onMessage = (d) => this.handle(decodeS2C(d));
    t.onClose = (r) => {
      console.warn('disconnected', r);
      this.showDisconnected(r);
    };
    this.send({ t: 'hello', protocol: PROTOCOL_VERSION, name: new URLSearchParams(location.search).get('name') ?? 'Player', viewDistance: this.settings.renderDistance, skin: this.settings.skin });
  }

  send(p: C2S): void {
    this.transport?.send(encodeC2S(p));
  }

  // ------------------------------------------------------------------ containers (ContainerHost)
  private invMenu: InventoryMenu | null = null;
  /** The always-present player inventory menu (window 0). */
  get inventoryMenu(): InventoryMenu {
    if (!this.invMenu) this.invMenu = new InventoryMenu(new InventoryContainer(this.interaction.inventory));
    return this.invMenu;
  }
  get playerInventory() {
    return this.interaction.inventory;
  }
  isKeyDown(code: string): boolean {
    return this.input.isDown(code);
  }
  /** E: the survival inventory, or the creative inventory in creative mode. */
  openInventory(): void {
    if (this.gameMode === 3) return;
    if (this.gameMode === 1) this.setScreen(new CreativeScreen(this));
    else this.setScreen(new InventoryScreen(this, this.inventoryMenu));
  }
  private previewModel: RemotePlayer | null = null;
  private readonly previewProj = new Float32Array(16);
  /**
   * InventoryScreen.renderEntityInInventory: the local player drawn into the GUI box, body and
   * head turned toward the mouse. Rendered with WebGL into the box's pixels, then copied onto
   * the GUI canvas (which is drawn over the 3D view).
   */
  renderPlayerPreview(x: number, y: number, scale: number, lookX: number, lookY: number, box: [number, number, number, number] = [x - 25, y - 67, 50, 70]): void {
    const sm = this.selfModel;
    if (!sm || !this.entityRenderer) return;
    const gl = this.gl, g = this.gui, k = g.scale;
    const pm = (this.previewModel ??= new RemotePlayer(-1000, sm.name, sm.skin));
    // vanilla: f = atan(lookX / 40) (radians) used directly as degrees ×20 / ×40
    const ya = Math.atan(lookX / 40), pa = Math.atan(lookY / 40);
    const pl = this.player;
    pm.x = pm.xo = pl.x;
    pm.y = pm.yo = pl.y;
    pm.z = pm.zo = pl.z;
    pm.bodyYaw = pm.bodyYawO = ya * 20;
    pm.headYaw = pm.headYawO = ya * 40;
    pm.pitch = pm.pitchO = -pa * 20;
    pm.pose = sm.pose === 'crouching' ? 'crouching' : 'standing';
    pm.tickCount = sm.tickCount;
    pm.flags = 0;
    pm.hurtTime = 0;
    const cw = this.canvas.width, ch = this.canvas.height;
    const GW = cw / k, GH = ch / k;
    const m = this.previewProj;
    m.fill(0);
    m[0] = (2 * scale) / GW;
    m[5] = (2 * scale) / GH;
    m[10] = -0.1;
    m[12] = (2 * x) / GW - 1;
    m[13] = 1 - (2 * y) / GH;
    m[15] = 1;
    const [bx, by, bw, bh] = box;
    const px = Math.round(bx * k), py = Math.round(by * k), pw = Math.round(bw * k), ph = Math.round(bh * k);
    gl.viewport(0, 0, cw, ch);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(px, ch - py - ph, pw, ph);
    gl.clearColor(0, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.entityRenderer.renderPlayers([pm], this.world, m, pl.x, pl.y, pl.z, 1, this.lightmap.tex, [0, 0, 0], 1e6, 1e6);
    gl.disable(gl.SCISSOR_TEST);
    g.ctx.drawImage(this.canvas, px, py, pw, ph, bx, by, bw, bh);
  }

  private loadOrSaveHotbar(row: number, load: boolean): void {
    const inv = this.interaction.inventory;
    if (load) {
      const saved = savedHotbars()[row]!;
      for (let j = 0; j < 9; j++) {
        const st = saved[j] ? { ...saved[j]! } : null;
        inv.set(j, st);
        this.send({ t: 'creativeSlot', slot: j, item: st?.id ?? 0, count: st?.count ?? 0, damage: st?.damage ?? 0 });
      }
    } else {
      saveHotbar(row, inv.slots.slice(0, 9));
      this.hud.setOverlay(`Saved toolbar (restore with ${keyName(this.binds.key('loadToolbarActivator'))}+${keyName(this.binds.key(`hotbar.${row + 1}`))})`);
    }
  }

  /** The menu a window id refers to (0 = inventory). */
  private windowMenu(id: number): Menu | null {
    if (id === 0) return this.inventoryMenu;
    return this.screen instanceof AbstractContainerScreen && this.screen.menu.containerId === id ? this.screen.menu : null;
  }

  private handle(p: S2C): void {
    if (this.itemUse?.handle(p) || this.arrows.handle(p)) return;
    switch (p.t) {
      case 'login':
        this.dimension = p.dimension;
        this.entityId = p.entityId;
        this.mobs.mobs.clear();
        this.world.biomeZoomSeed = p.seed;
        this.selfModel = new RemotePlayer(p.entityId, new URLSearchParams(location.search).get('name') ?? 'Player', this.settings.skin);
        this.selfModel.setPos(p.x, p.y, p.z, p.yaw, p.pitch, p.yaw);
        this.setGameMode(p.gameMode);
        this.placePlayer(p.x, p.y, p.z);
        this.yaw = p.yaw;
        this.pitch = p.pitch;
        this.loggedIn = true;
        this.send({ t: 'settings', viewDistance: this.settings.renderDistance, simulationDistance: this.settings.simulationDistance });
        this.applyTestParams();
        // "Loading terrain…" until the chunks around the player are in and meshed (test scenes and screen shots skip it)
        if (!new URLSearchParams(location.search).has('screen') && !new URLSearchParams(location.search).has('scene')) {
          this.setScreen(new LoadingTerrainScreen(this.loadingHost(), () => {
            this.setScreen(null);
            if (!this.input.locked && new URLSearchParams(location.search).get('nolock') !== '1') this.setScreen(new PauseScreen(this));
          }));
          break;
        }
        if (!this.input.locked && new URLSearchParams(location.search).get('nolock') !== '1') this.setScreen(new PauseScreen(this));
        {
          const sc = new URLSearchParams(location.search).get('screen');
          if (sc === 'video') import('./gui/screens').then((m) => this.setScreen(new m.VideoSettingsScreen(this, new m.PauseScreen(this))));
          else if (sc === 'pause') this.setScreen(new PauseScreen(this));
          else if (sc === 'options') import('./gui/screens').then((m) => this.setScreen(new m.OptionsScreen(this, null)));
          else if (sc === 'chatsettings') import('./gui/screens').then((m) => this.setScreen(new m.ChatOptionsScreen(this, null)));
          else if (sc === 'skin') import('./gui/screens').then((m) => this.setScreen(new m.SkinCustomizationScreen(this, null)));
          else if (sc === 'controls' || sc === 'mouse' || sc === 'sound' || sc === 'access') {
            void import('./gui/controls').then((m) => {
              const scr = sc === 'controls' ? new m.ControlsScreen(this, null) : sc === 'mouse' ? new m.MouseSettingsScreen(this, null)
                : sc === 'sound' ? new m.SoundOptionsScreen(this, null) : new m.AccessibilityScreen(this, null);
              this.setScreen(scr);
            });
          }
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
          this.mobs.remove(id);
          this.items.delete(id);
          this.bolts.delete(id);
          this.fallingBlocks.remove(id);
        }
        break;
      case 'entityMove': {
        this.players.get(p.id)?.lerpTo(p.x, p.y, p.z, p.yaw, p.pitch, p.headYaw);
        this.fallingBlocks.move(p.id, p.x, p.y, p.z);
        this.mobs.move(p.id, p.x, p.y, p.z, p.yaw, p.pitch, p.headYaw, p.onGround);
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
          this.ticksFrozen = p.frozen;
          const sleeping = p.pose === 'sleeping';
          if (sleeping !== this.sleeping) {
            this.sleeping = sleeping;
            if (sleeping) {
              this.interaction.stopDestroy();
              this.setScreen(new InBedChatScreen(this.chatHost(), () => this.send({ t: 'stopSleeping' })));
            } else if (this.screen instanceof InBedScreen || this.screen instanceof InBedChatScreen) this.setScreen(null);
          }
          break;
        }
        const rp = this.players.get(p.id);
        if (rp) {
          rp.flags = p.flags;
          rp.pose = p.pose;
          rp.ticksFrozen = p.frozen;
        }
        const mob = this.mobs.get(p.id);
        if (mob) mob.flags = p.flags;
        break;
      }
      case 'animate':
        if (p.action === 0) this.mobs.get(p.id)?.swing();
        if (p.action === 0 || p.action === 3) this.players.get(p.id)?.swing(p.action === 3 ? 'left' : 'right');
        else if (p.action === 1) {
          const rp = this.players.get(p.id);
          if (rp) rp.hurtTime = 10;
        }
        break;
      case 'gameMode':
        this.setGameMode(p.mode);
        break;
      case 'playerInfo':
        if (p.action === 0) this.playerInfo.set(p.id, { id: p.id, name: p.name, skin: p.skin, gameMode: p.gameMode });
        else if (p.action === 1) {
          const e = this.playerInfo.get(p.id);
          if (e) e.gameMode = p.gameMode;
        } else if (p.action === 4) this.playerInfo.delete(p.id);
        break;
      case 'setCamera':
        this.cameraEntity = p.id === this.entityId ? null : p.id;
        break;
      case 'openWindow': {
        const menu = createClientMenu(p.type as MenuType, p.windowId, new InventoryContainer(this.interaction.inventory));
        this.setScreen(screenForMenu(this, menu, p.title));
        break;
      }
      case 'windowItems': {
        const m = this.windowMenu(p.windowId);
        if (!m) break;
        const list = decodeStacks(p.items);
        for (let i = 0; i < m.slots.length && i < list.length - 1; i++) m.slots[i]!.container.setItem(m.slots[i]!.slot, list[i]!);
        m.carried = list[list.length - 1] ?? null;
        break;
      }
      case 'windowSlot': {
        const st = p.item > 0 && p.count > 0 ? { id: p.item, count: p.count, damage: p.damage } : null;
        if (p.windowId === -1) {
          const sc = this.screen;
          if (sc instanceof AbstractContainerScreen) sc.menu.carried = st;
          break;
        }
        const m = this.windowMenu(p.windowId);
        const sl = m?.slots[p.slot];
        if (sl) sl.container.setItem(sl.slot, st);
        break;
      }
      case 'merchantOffers': {
        const sc = this.screen;
        if (sc instanceof MerchantScreen && sc.menu.containerId === p.windowId) {
          sc.menu.setOffers(JSON.parse(p.offers) as MerchantScreen['menu']['offers']);
          sc.menuLevel = p.level;
          sc.menuXp = p.xp;
          sc.menuShowProgress = p.showProgress;
        }
        break;
      }
      case 'windowSlotTag': {
        const m = this.windowMenu(p.windowId);
        const sl = m?.slots[p.slot];
        const st = sl?.getItem();
        if (st) st.tag = decodeTag(p.tag);
        break;
      }
      case 'windowData': {
        const m = this.windowMenu(p.windowId);
        if (m) m.data[p.property] = p.value;
        break;
      }
      case 'closeWindow': {
        const sc = this.screen;
        if (sc instanceof AbstractContainerScreen && sc.menu.containerId === p.windowId) {
          sc.closedByServer = true;
          this.setScreen(null);
        }
        break;
      }
      case 'entityMotion':
        // LocalPlayer.lerpMotion (knockback)
        if (p.id === this.entityId) {
          this.player.vx = p.vx;
          this.player.vy = p.vy;
          this.player.vz = p.vz;
        }
        break;
      case 'equipment': {
        const mob = this.mobs.get(p.id);
        if (mob) {
          mob.mainHand = p.mainHand;
          mob.offHand = p.offHand;
        }
        const rp = this.players.get(p.id);
        if (rp) {
          rp.mainHand = p.mainHand;
          rp.offHand = p.offHand;
        }
        break;
      }
      case 'armorEquipment': {
        const rp = this.players.get(p.id);
        if (rp) rp.armor = [p.feet, p.legs, p.chest, p.head];
        break;
      }
      case 'actionBar':
        this.hud.setOverlay(p.text);
        break;
      case 'difficulty':
        this.difficulty = p.difficulty;
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
        this.effectsClient.reset();
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
      case 'slotTag': {
        const st = this.interaction.inventory.get(p.slot);
        if (st) {
          const tag = decodeTag(p.tag);
          if (tag) st.tag = tag;
          else delete st.tag;
        }
        break;
      }
      case 'itemEntityTag': {
        const it = this.items.get(p.id) as { tag?: ItemTag } | undefined;
        if (it) it.tag = decodeTag(p.tag);
        break;
      }
      case 'effectParticles':
        this.effectsClient.handle(p);
        break;
      case 'effectCloud': {
        // AreaEffectCloud client tick: swirls scattered over the disc (≈ π r² per 5 ticks here)
        this.ensureFlatParticles();
        const r = ((p.color >> 16) & 255) / 255, g = ((p.color >> 8) & 255) / 255, b = (p.color & 255) / 255;
        const n = Math.ceil(Math.PI * p.radius * p.radius);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * p.radius;
          this.particles.spell(p.x + Math.cos(a) * d, p.y, p.z + Math.sin(a) * d, r, g, b, false);
        }
        break;
      }
      case 'heldSlot':
        this.interaction.inventory.selected = p.slot;
        break;
      case 'addEntity':
        if (p.type === 'lightning_bolt') {
          this.bolts.set(p.id, new ClientBolt(p.x, p.y, p.z, this.boltRand));
          // LightningBolt.tick (client): thunder audible everywhere, impact nearby
          const r = this.sfxRand;
          this.playAt('entity.lightning_bolt.thunder', 'weather', p.x, p.y, p.z, 10000, 0.8 + r.nextFloat() * 0.2);
          this.playAt('entity.lightning_bolt.impact', 'weather', p.x, p.y, p.z, 2, 0.5 + r.nextFloat() * 0.2);
        }
        else if (p.type === 'falling_block') this.fallingBlocks.add(p.id, p.data, p.x, p.y, p.z);
        else if (p.type === 'tnt') this.fallingBlocks.add(p.id, BLOCKS_BY_NAME.get('tnt')!.defaultState, p.x, p.y, p.z);
        else if (isMobType(p.type)) {
          this.mobs.add(p.id, p.type, p.x, p.y, p.z);
        } else if (p.type === 'item' || p.type === 'experience_orb') {
          this.items.set(p.id, { x: p.x, y: p.y, z: p.z, xo: p.x, yo: p.y, zo: p.z, lx: p.x, ly: p.y, lz: p.z, steps: 0, item: 0, count: 1, age: 0, bobOffs: Math.random() * Math.PI * 2, ...(p.type === 'experience_orb' ? { orb: p.data } : {}) });
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
        if (this.arrows.arrows.has(p.itemId)) {
          const a = this.arrows.arrows.get(p.itemId)!, r = this.sfxRand;
          this.playAt('entity.item.pickup', 'player', a.x, a.y, a.z, 0.2, ((r.nextFloat() - r.nextFloat()) * 0.7 + 1) * 2);
          this.arrows.arrows.delete(p.itemId);
          break;
        }
        // vanilla ItemPickupParticle: the item flies into the collector over 3 ticks
        const it = this.items.get(p.itemId);
        if (it) {
          const r = this.sfxRand;
          if (it.orb) this.playAt('entity.experience_orb.pickup', 'player', it.x, it.y, it.z, 0.1, (r.nextFloat() - r.nextFloat()) * 0.35 + 0.9);
          else this.playAt('entity.item.pickup', 'player', it.x, it.y, it.z, 0.2, ((r.nextFloat() - r.nextFloat()) * 0.7 + 1) * 2);
        }
        if (it?.orb && !it.pickup) {
          // a merged orb only gives one of its orbs: a copy flies off, the entity stays until removed
          this.items.set(-1e9 - this.clientTicks * 16 - (p.itemId & 15), { ...it, pickup: { collector: p.collectorId, life: 0 } });
          break;
        }
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
      case 'dimension':
        this.bossBars.clear();
        this.changeDimension(p);
        break;
      case 'bossEvent':
        this.bossBars.handle(p);
        break;
      case 'winGame':
        // ClientboundGameEventPacket WIN_GAME: roll the credits (the first time)
        if (p.showCredits) this.setScreen(new CreditsScreen(this, new URLSearchParams(location.search).get('name') ?? 'Player', () => this.setScreen(null)));
        break;
      case 'levelEvent':
        if (p.event === 1032) this.playUi('block.portal.travel', this.sfxRand.nextFloat() * 0.4 + 0.8);
        if (p.event === 2001) this.blockBroken(p.x, p.y, p.z, p.data);
        else if (p.event === 1505) this.growthParticles(p.x, p.y, p.z, p.data);
        else if (p.event === 2002 || p.event === 2007) {
          // splash potion: a burst of potion-coloured swirls (LevelRenderer.levelEvent 2002/2007)
          this.ensureFlatParticles();
          const r = ((p.data >> 16) & 255) / 255, g = ((p.data >> 8) & 255) / 255, b = (p.data & 255) / 255;
          for (let i = 0; i < 100; i++) this.particles.spell(p.x + 0.5 + (Math.random() - 0.5), p.y + 0.5, p.z + 0.5 + (Math.random() - 0.5), r, g, b, false);
        }
        else if (p.event === 1501) {
          // LevelRenderer.levelEvent LAVA_FIZZ: extinguish hiss (large smoke particles: no smoke particle type yet)
          const r = this.sfxRand;
          this.playAt('block.lava.extinguish', 'block', p.x + 0.5, p.y + 0.5, p.z + 0.5, 0.5, 2.6 + (r.nextFloat() - r.nextFloat()) * 0.8);
        }
        break;
      case 'sound': {
        const name = soundName(p.event);
        if (name) this.playAt(name, SOUND_SOURCES[p.category] ?? 'master', p.x, p.y, p.z, p.volume, p.pitch);
        break;
      }
      case 'entityEvent':
        if (this.mobs.get(p.id)) this.mobs.event(p.id, p.event);
        else this.entityEvent(p.id, p.event);
        break;
      case 'mobData':
        this.mobs.get(p.id)?.setData(p.key, p.value);
        break;
      case 'mobName': {
        const mob = this.mobs.get(p.id);
        if (mob) mob.customName = p.name;
        break;
      }
      case 'blockBreakProgress':
        if (p.stage < 0) this.otherCracks.delete(p.id);
        else this.otherCracks.set(p.id, { x: p.x, y: p.y, z: p.z, stage: p.stage });
        break;
      case 'chat':
        this.hud.addChat(componentToLegacy(p.json), componentClick(p.json));
        break;
      case 'commandSuggestions':
        if (this.screen instanceof ChatScreen) this.screen.receiveSuggestions(p.id, JSON.parse(p.json) as SuggestionReply);
        break;
      case 'keepAlive':
        this.send({ t: 'keepAlive', id: p.id });
        break;
      case 'playerLatency':
        this.playerLatency.set(p.id, p.latency);
        break;
      case 'disconnect':
        this.showDisconnected(p.reason);
        break;
      case 'digAck':
        break;
    }
  }

  /** Kicked, banned or the connection dropped: vanilla DisconnectedScreen. */
  private showDisconnected(reason: string): void {
    if (this.screen instanceof DisconnectedScreen) return;
    this.loggedIn = false;
    this.setScreen(new DisconnectedScreen(this, reason));
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
    if (m !== this.gameMode) this.previousGameMode = this.gameMode;
    this.gameMode = m;
    if (m !== 3) {
      this.spectatorGui.reset();
      this.cameraEntity = null;
    }
    const a = this.player.abilities;
    a.mayFly = m === 1 || m === 3;
    a.noPhysics = m === 3;
    a.flying = m === 3 ? true : m === 1 ? a.flying : false;
    this.reach = m === 1 ? 5 : 4.5;
  }

  /** URL test hooks: ?x=&y=&z=&yaw=&pitch=&time= (used by screenshot checks and the benchmark). */
  /** Bundled skins for Skin Customization. */
  defaultSkins(): string[] {
    return this.entityRenderer?.skinNames() ?? [];
  }

  private loadingHost(): LoadingHost {
    const game = this;
    return {
      gui: this.gui,
      center: () => [Math.floor(this.player.x) >> 4, Math.floor(this.player.z) >> 4],
      received: (cx, cz) => !!this.world.getChunk(cx, cz),
      meshed: (cx, cz) => this.chunks.columnMeshed(cx, cz),
      get renderDistance() {
        return game.settings.renderDistance;
      },
    };
  }

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
    if (q.has('fly')) {
      this.player.abilities.flying = true;
      // again after the game mode / abilities packets that follow a /gamemode in cmd
      for (const ms of [2000, 6000]) setTimeout(() => (this.player.abilities.flying = this.player.abilities.mayFly), ms);
    }
    if (n('camera') !== undefined) this.cameraType = n('camera')!;
    if (q.has('hitboxes')) this.showHitboxes = true;
    for (const g of q.getAll('give')) this.send({ t: 'chat', message: `/give @s ${g.replace(':', ' ')}` });
    if (q.has('weather')) this.send({ t: 'chat', message: `/weather ${q.get('weather')}` });
    // test hooks: chat commands right away (cmd), 3 s later (later) and 7 s later (later2), e.g. after a portal trip
    for (const c of q.getAll('cmd')) this.send({ t: 'chat', message: c });
    for (const [key, ms] of [['later', n('laterms') ?? 3000], ['later2', n('later2ms') ?? 7000]] as const) {
      const cmds = q.getAll(key);
      if (cmds.length) setTimeout(() => cmds.forEach((c) => this.send({ t: 'chat', message: c })), ms);
    }
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
    animateFluids(this.world, this.player.x, this.player.y, this.player.z, this.sfxRand, (e, x, y, z, v, p) => this.playAt(e, 'block', x, y, z, v, p));
    // cooking blocks, fire, candles, portals and bubble columns: blockambience via animateFluids' cells
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.oFov = this.fovModifier;
    const pl = this.player;
    pl.yaw = this.yaw;
    pl.pitch = this.pitch;
    const i = this.input;
    const active = !this.screen && !this.dead && (this.input.locked || new URLSearchParams(location.search).get('nolock') === '1');
    this.binds.tick();
    const k = (id: string) => active && this.binds.down(id);
    const move: MoveInput = {
      forward: (k('forward') ? 1 : 0) - (k('back') ? 1 : 0),
      strafe: (k('left') ? 1 : 0) - (k('right') ? 1 : 0),
      jump: k('jump'),
      sneak: k('sneak'),
      sprint: k('sprint'),
    };
    pl.autoJumpEnabled = this.settings.autoJump;
    const bx = pl.x, by = pl.y, bz = pl.z;
    if (this.sleeping) pl.pose = 'sleeping';
    else if (this.cameraEntity !== null) {
      // looking through another entity: no movement, but sneaking still reaches the server
      pl.shiftDown = move.sneak;
    } else if (this.loggedIn && this.world.isLoaded(Math.floor(pl.x), Math.floor(pl.z))) {
      // LocalPlayer.aiStep: eating/drawing slows movement input to 20%
      pl.usingItem = !!this.itemUse?.isUsing;
      // movement effects (speed, slowness, jump boost, levitation, slow falling, dolphin's grace, blindness)
      if (this.itemUse) {
        const u = this.itemUse, pe = pl.effects;
        pe.speed = u.amplifier('speed') + 1;
        pe.slowness = u.amplifier('slowness') + 1;
        pe.jumpBoost = u.amplifier('jump_boost') + 1;
        pe.levitation = u.amplifier('levitation') + 1;
        pe.slowFalling = u.hasEffect('slow_falling');
        pe.dolphinsGrace = u.hasEffect('dolphins_grace');
        // Depth Strider on the boots (Phase 7)
        pe.depthStrider = entityEnchLevel('depth_strider', this.interaction.inventory);
        pl.blind = u.hasEffect('blindness');
        // leather boots walk on powder snow (PowderSnowBlock.canEntityWalkOnPowderSnow)
        const feet = this.interaction.inventory.get(36);
        pl.walkOnPowderSnow = !!feet && itemName(feet.id) === 'leather_boots';
      }
      pl.tick(move);
      this.tickMovementSounds(pl.x - bx, pl.y - by, pl.z - bz);
    }
    // LocalPlayer.handleNetherPortalClient: overlay fades in while standing in a portal
    if (this.portalFx.tick(this.loggedIn && this.gameMode !== 3 && insidePortal(this.world, pl.x, pl.y, pl.z, pl.pose === 'crouching' ? 1.5 : 1.8, isPortal))) {
      this.playUi('block.portal.trigger', this.sfxRand.nextFloat() * 0.4 + 0.8);
    }
    this.tickRainSound();
    this.tickAudio();
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
    // drawing a bow zooms in up to 15%
    if (this.itemUse?.isUsing && this.itemUse.useAnimOf === 'bow') {
      const t = this.itemUse.ticksUsing / 20;
      fovTarget *= 1 - (t > 1 ? 1 : t * t) * 0.15;
    }
    // FOV Effects accessibility slider scales the change
    fovTarget = 1 + (fovTarget - 1) * this.settings.fovEffectScale;
    this.fovModifier += (fovTarget - this.fovModifier) * 0.5;
    if (this.fovModifier > 1.5) this.fovModifier = 1.5;
    if (this.fovModifier < 0.1) this.fovModifier = 0.1;
    for (const rp of this.players.values()) {
      rp.tick();
      const ru = this.itemUse?.remoteUse(rp.id);
      rp.usingItem = ru?.item ?? 0;
      rp.useTicks = ru?.ticks ?? 0;
    }
    this.mobs.tick();
    this.mobRenderer?.tick();
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
    this.fallingBlocks.tick();
    this.itemParticles?.tick();
    this.effectsClient.tick();
    this.tickEffectParticles();
    this.swingTick();
    this.hud.tick(this.interaction.inventory);
    this.tickHand();
    if (this.selfModel) {
      const sm = this.selfModel, pl2 = this.player;
      sm.follow(pl2.x, pl2.y, pl2.z, this.yaw, this.pitch);
      sm.pose = pl2.pose;
      sm.flags = this.gameMode === 3 ? 32 : 0;
      sm.hurtTime = this.hurtTime;
      sm.mainHand = this.interaction.inventory.selectedStack?.id ?? 0;
      sm.offHand = this.interaction.inventory.get(40)?.id ?? 0;
      const inv = this.interaction.inventory;
      sm.armor = [inv.get(36)?.id ?? 0, inv.get(37)?.id ?? 0, inv.get(38)?.id ?? 0, inv.get(39)?.id ?? 0];
      sm.usingItem = this.itemUse.isUsing ? this.itemUse.useItem : 0;
      sm.useTicks = this.itemUse.ticksUsing;
      sm.tick();
    }
    this.tickLiving();
    this.tickEnvironment();
    // mouse buttons (vanilla handleKeybinds: attack, use, pick block)
    if (active && this.loggedIn) {
      const ia = this.interaction;
      ia.tick();
      const b = this.binds;
      const attackPressed = b.consume('attack');
      const usingItem = this.itemUse.isUsing;
      if (attackPressed && !usingItem) ia.startAttack(this.target, this.targetEntity);
      ia.continueAttack(b.down('attack') && !attackPressed && !usingItem, this.target);
      if (this.itemUse.isUsing) {
        // Minecraft.handleKeybinds while using an item: clicks are swallowed
        b.consume('use');
        b.consume('attack');
      } else ia.use(b.consume('use'), b.down('use'), this.target, this.targetEntity !== null && this.mobs.get(this.targetEntity) ? this.targetEntity : null);
      if (this.gameMode === 3) {
        // MouseHandler: the middle button opens/uses the spectator menu; hotbar keys pick its slots
        const middle = i.consumePress('Mouse1');
        b.consume('pickItem');
        if (middle) this.spectatorGui.onMouseMiddleClick();
        for (let d = 1; d <= 9; d++) if (b.consume(`hotbar.${d}`)) this.spectatorGui.onHotbarSelected(d - 1);
      } else {
        if (b.consume('pickItem')) ia.pickBlock(this.target);
        for (let d = 1; d <= 9; d++) {
          if (!b.consume(`hotbar.${d}`)) continue;
          // creative: C/X + number saves/restores a toolbar (CreativeModeInventoryScreen.handleHotbarLoadOrSave)
          const load = b.down('loadToolbarActivator'), save = b.down('saveToolbarActivator');
          if (this.gameMode !== 1 || (!load && !save)) ia.select(d - 1);
          else this.loadOrSaveHotbar(d - 1, load);
        }
      }
      if (b.consume('inventory')) this.openInventory();
      // vanilla: Ctrl (Screen.hasControlDown) + drop throws the whole stack
      if (b.consume('swapOffhand')) ia.swapOffhand();
      // vanilla handleKeybinds: T opens chat, / opens it with the slash typed
      if (b.consume('chat')) this.openChat('');
      else if (b.consume('command')) this.openChat('/');
      if (b.consume('drop')) ia.drop(i.isDown('ControlLeft') || i.isDown('ControlRight') || i.isDown('MetaLeft'));
    }
    // LivingEntity.updatingUsingItem (local + remote players); releasing the key shoots the bow
    if (this.loggedIn) this.itemUse.tick(active && !this.dead && this.binds.down('use'), this.interaction.inventory);
    // feed the first-person renderer's use state (eat/drink bob, bow draw) and effect map
    {
      const u = this.itemUse;
      this.firstPersonUse = u.isUsing
        ? { hand: u.usedHand, item: itemName(u.useItem), remaining: u.useRemaining, duration: useDuration(u.useItem), anim: u.useAnimOf as UseAnim }
        : null;
      this.localEffects.clear();
      for (const e of u.effects.values()) this.localEffects.set(e.name, e.amplifier);
    }
    // LocalPlayer.handleNetherPortalClient (nausea part): wobble builds up over 7.5 s, fades in 1 s
    this.oPortalTime = this.portalTime;
    if (this.itemUse && [...this.itemUse.effects.values()].some((e) => e.name === 'nausea' && e.duration > 60)) this.portalTime = Math.min(1, this.portalTime + 0.006666667);
    else this.portalTime = Math.max(0, this.portalTime - 0.05);
    this.arrows.tick();
    if (this.loggedIn) {
      const st = this.sentState;
      if (st.sneaking !== pl.shiftDown || st.sprinting !== pl.sprinting || st.flying !== pl.abilities.flying) {
        st.sneaking = pl.shiftDown;
        st.sprinting = pl.sprinting;
        st.flying = pl.abilities.flying;
        this.send({ t: 'playerState', ...st });
      }
      // LocalPlayer.sendPosition: only while we are the camera
      if (this.cameraEntity === null) this.send({ t: 'move', x: pl.x, y: pl.y, z: pl.z, yaw: this.yaw, pitch: this.pitch, onGround: pl.onGround });
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
    this.pitch = Math.max(-90, Math.min(90, this.pitch + i.mouseDY * k * (this.settings.invertYMouse ? -1 : 1)));
    // MouseHandler.onScroll: discrete or smooth, scaled, accumulated into whole slots
    if (i.wheel !== 0 && this.interaction) {
      const d = (this.settings.discreteMouseScroll ? Math.sign(i.wheel) : i.wheel) * this.settings.mouseWheelSensitivity;
      this.scrollAcc += d;
      const whole = Math.trunc(this.scrollAcc);
      if (whole !== 0) {
        this.scrollAcc -= whole;
        if (this.gameMode !== 3) this.interaction.scroll(Math.sign(whole));
        else if (this.spectatorGui.menuActive) this.spectatorGui.onMouseScrolled(Math.sign(whole));
        else {
          // spectators scroll to change their flying speed (0–0.2)
          const a = this.player.abilities;
          a.flySpeed = Math.max(0, Math.min(0.2, a.flySpeed - Math.sign(whole) * 0.005));
        }
      }
    }
    // F3 combos suppress the debug toggle on release, like vanilla
    for (const k of i.debugQueue.splice(0)) if (this.handleDebugKey(k)) this.f3Used = true;
    if (i.consumeRelease('F3')) {
      if (!this.f3Used && !i.f3Combo) this.showDebug = !this.showDebug;
      this.f3Used = false;
    }
    i.consumePress('F3');
    if (this.binds.consume('togglePerspective')) this.cameraType = (this.cameraType + 1) % 3;
    if (i.consumePress('F1')) this.hideHud = !this.hideHud;
    if (this.binds.consume('fullscreen')) {
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
  /** Hand that is swinging (LivingEntity.swingingArm). */
  private swingingHand: 0 | 1 = 0;
  /**
   * Local player's status effects (effect name → amplifier), for the effects that change the
   * first-person hand: haste / conduit_power / mining_fatigue (swing duration).
   */
  readonly localEffects = new Map<string, number>();
  /** Phase 7: synced status effects, attributes, swirl particles and the enchanting window */
  readonly effectsClient: EffectsClient = new EffectsClient(this);

  /**
   * The item the local player is using (LivingEntity.useItem): hand, item name, ticks left
   * (getUseItemRemainingTicks, counted down each tick by the owner of the use), total use
   * duration and its UseAnim. Drives the eat/drink bob, bow draw, trident and crossbow poses.
   */
  firstPersonUse: { hand: 0 | 1; item: string; remaining: number; duration: number; anim: UseAnim; chargeDuration?: number } | null = null;
  /** Riptide spin attack (isAutoSpinAttack) and spyglass scoping (isScoping), when implemented. */
  autoSpinAttack = false;
  scoping = false;

  /** LivingEntity.getCurrentSwingDuration. */
  private currentSwingDuration(): number {
    const h = this.localEffects.get('haste'), c = this.localEffects.get('conduit_power');
    const dig = h === undefined && c === undefined ? null : Math.max(h ?? 0, c ?? 0);
    return swingDuration(dig, this.localEffects.get('mining_fatigue') ?? null);
  }

  swingArm(hand: 0 | 1 = 0): void {
    if (!this.swinging || this.swingTime >= this.currentSwingDuration() / 2 || this.swingTime < 0) {
      this.swingTime = -1;
      this.swinging = true;
      this.swingingHand = hand;
      this.selfModel?.swing(hand === 1 ? 'left' : 'right');
    }
    // LocalPlayer.swing always tells the server
    if (this.loggedIn) this.send({ t: 'swing', hand });
  }
  /** LivingEntity.updateSwingTime. */
  private swingTick(): void {
    this.attackAnimO = this.attackAnim;
    const d = this.currentSwingDuration();
    if (this.swinging) {
      this.swingTime++;
      if (this.swingTime >= d) {
        this.swingTime = 0;
        this.swinging = false;
      }
    } else this.swingTime = 0;
    this.attackAnim = this.swingTime / d;
  }

  // ------------------------------------------------------------------ sounds
  playAt(event: string, category: SoundCategory, x: number, y: number, z: number, volume: number, pitch: number): void {
    this.sound.play(event, category, volume, pitch, x, y, z);
  }

  /** SimpleSoundInstance.forUI: volume 0.25, not positional. */
  playUi(event: string, pitch: number): void {
    this.sound.play(event, 'master', 0.25, pitch);
  }

  /** Local player sound (LocalPlayer.playSound → playLocalSound at the player). */
  private playPlayer(event: string, volume: number, pitch: number): void {
    const p = this.player;
    this.playAt(event, 'player', p.x, p.y, p.z, volume, pitch);
  }

  /** texture layer tinted green for growth sparkles (no dedicated particle sprite sheet yet) */
  private growthParticleLayer = 0;
  /** levelEvent 1505 (BoneMealItem.addGrowthParticles): green sparkles over the grown block. */
  private growthParticles(x: number, y: number, z: number, data: number): void {
    const st = this.world.getState(x, y, z);
    if (st === 0) return;
    let count = data === 0 ? 15 : data;
    let d = 0.5, e: number;
    const name = blockNameOf(st);
    if (name === 'water') {
      count *= 3;
      e = 1;
      d = 3;
    } else if (FULL_COLLISION[st] === 1) {
      y++;
      count *= 3;
      d = 3;
      e = 1;
    } else e = 1;
    const layer = this.growthParticleLayer;
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.02;
    this.particles.happy(x + 0.5, y + 0.5, z + 0.5, 0, 0, 0, layer);
    for (let i = 0; i < count; i++) {
      const k = x + 0.5 - d + Math.random() * d * 2, l = y + Math.random() * e, m = z + 0.5 - d + Math.random() * d * 2;
      if (this.world.getState(Math.floor(k), Math.floor(l) - 1, Math.floor(m)) !== 0) this.particles.happy(k, l, m, g(), g(), g(), layer);
    }
  }

  /** levelEvent 2001: break particles and the block's break sound. */
  private blockBroken(x: number, y: number, z: number, st: number): void {
    this.particles.destroy(x, y, z, st, this.particleLayer(st), this.particleTint(st, x, z));
    if (st !== 0) {
      const t = soundTypeOf(st);
      this.playAt(t.break, 'block', x + 0.5, y + 0.5, z + 0.5, (t.volume + 1) / 2, t.pitch * 0.8);
    }
  }

  /** LivingEntity.handleEntityEvent: hurt animation and the hurt/death sound for the local player. */
  /** Bow model override (models/item/bow.json predicates): pulling_0 / _1 at 0.65 / _2 at 0.9. */
  private bowPullKey(pull: number): number | null {
    return this.blockItems.spriteKey(`bow_pulling_${pull >= 0.9 ? 2 : pull >= 0.65 ? 1 : 0}`);
  }

  /** Texture layer for an item's particles (block items use their block's particle texture). */
  private itemParticleLayer(item: number): number {
    const block = blockForItem(item);
    if (block) return this.particleLayer(BLOCKS_BY_NAME.get(block)!.defaultState);
    const n = itemNameOfId(item);
    return this.texLayers?.get(`item/${n}`)?.layer ?? this.texLayers?.get(n)?.layer ?? -1;
  }

  /** LivingEntity.breakItem (entity events 47–52): the break sound and 5 item particles. */
  private itemBroke(id: number, event: number): void {
    const self = id === this.entityId;
    const inv = this.interaction.inventory;
    const rp = self ? null : this.players.get(id);
    let item = 0;
    if (event === 47) item = self ? inv.selectedStack?.id ?? 0 : rp?.mainHand ?? 0;
    else if (event === 48) item = self ? inv.get(40)?.id ?? 0 : rp?.offHand ?? 0;
    else item = self ? inv.get(36 + (52 - event))?.id ?? 0 : rp?.armor[52 - event] ?? 0;
    const v = self ? { x: this.x, y: this.y - this.player.eyeHeight, z: this.z } : rp;
    if (!v || !item) return;
    const r = this.sfxRand;
    this.playAt('entity.item.break', 'player', v.x, v.y, v.z, 0.8, 0.8 + r.nextFloat() * 0.4);
    this.itemUse.spawnItemParticles(id, item, 5);
  }

  private entityEvent(id: number, event: number): void {
    // 24–28: our operator permission level (vanilla ClientboundEntityEventPacket)
    if (id === this.entityId && event >= 24 && event <= 28) {
      this.permissionLevel = event - 24;
      return;
    }
    if (event >= 47 && event <= 52) return this.itemBroke(id, event);
    if (event === 35) {
      // Totem of Undying: the sound and a burst of totem particles around the saved player
      const v = id === this.entityId ? { x: this.x, y: this.y - this.player.eyeHeight, z: this.z } : this.players.get(id);
      if (v) {
        this.playAt('item.totem.use', 'player', v.x, v.y, v.z, 1, 1);
        const totem = ITEMS_BY_NAME.get('totem_of_undying')!.id;
        this.itemUse.spawnItemParticles(id, totem, 30);
      }
      if (id === this.entityId) this.effectsClient.totemActivated(Math.random);
      return;
    }
    const hurt = event === 2 || event === 33 || event === 36 || event === 37 || event === 44 || event === 57;
    if (id !== this.entityId) {
      const rp = this.players.get(id);
      if (rp && hurt) rp.hurtTime = 10;
      return;
    }
    const r = this.sfxRand;
    const voice = (r.nextFloat() - r.nextFloat()) * 0.2 + 1;
    if (hurt) {
      const ev = event === 37 ? 'entity.player.hurt_on_fire' : event === 36 ? 'entity.player.hurt_drown' : event === 44 ? 'entity.player.hurt_sweet_berry_bush' : event === 57 ? 'entity.player.hurt_freeze' : 'entity.player.hurt';
      this.playPlayer(ev, 1, voice);
    } else if (event === 3) this.playPlayer('entity.player.death', 1, voice);
  }

  /** Texture layer for flat-colour particles (potion swirls, splashes). */
  private ensureFlatParticles(): void {
    if (this.particles.flatLayer) return;
    const white = BLOCKS_BY_NAME.get('white_concrete');
    if (white) this.particles.flatLayer = this.particleLayer(white.defaultState);
  }

  /** Potion swirls around players with effects (DATA_EFFECT_COLOR_ID). */
  private tickEffectParticles(): void {
    const fx = this.effectsClient;
    if (fx.swirl.size === 0) return;
    this.ensureFlatParticles();
    const list: { id: number; x: number; y: number; z: number; width: number; height: number; invisible: boolean }[] = [];
    // vanilla shows the local player's own swirls in every perspective
    list.push({ id: this.entityId, x: this.player.x, y: this.player.y, z: this.player.z, width: 0.6, height: 1.8, invisible: this.localEffects.has('invisibility') });
    for (const rp of this.players.values()) list.push({ id: rp.id, x: rp.x, y: rp.y, z: rp.z, width: 0.6, height: 1.8, invisible: (rp.flags & 32) !== 0 });
    fx.tickParticles(Math.random, list, (x, y, z, r, g, b, ambient) => this.particles.spell(x, y, z, r, g, b, ambient));
  }

  /** Footsteps/swimming (Entity.move) and landing sounds (LivingEntity.causeFallDamage) for the local player. */
  private tickMovementSounds(dx: number, dy: number, dz: number): void {
    const p = this.player;
    const silent = p.abilities.flying || this.gameMode === 3 || (p.onGround && p.shiftDown);
    const ev = this.steps.update(this.world, p.x, p.y, p.z, dx, dy, dz, p.isInWater, silent);
    const r = this.sfxRand;
    if (ev?.kind === 'swim') {
      const v = Math.min(1, Math.sqrt(p.vx * p.vx * 0.2 + p.vy * p.vy + p.vz * p.vz * 0.2) * 0.35);
      this.playPlayer('entity.player.swim', v, 1 + (r.nextFloat() - r.nextFloat()) * 0.4);
    } else if (ev?.kind === 'step') {
      const t = soundTypeOf(ev.state);
      this.playPlayer(t.step, t.volume * 0.15, t.pitch);
    }
    if (p.onGround && !this.wasOnGround && p.lastFallDistance > 0 && !p.abilities.mayFly) {
      const below = this.world.getState(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      const n = blockNameOf(below);
      const mult = n === 'hay_block' || n === 'honey_block' ? 0.2 : n.endsWith('_bed') ? 0.5 : n === 'slime_block' && !p.shiftDown ? 0 : 1;
      const dmg = Math.ceil((p.lastFallDistance - 3) * mult);
      if (dmg > 0) {
        this.playPlayer(dmg > 4 ? 'entity.player.big_fall' : 'entity.player.small_fall', 1, 1);
        if (below !== 0) {
          const t = soundTypeOf(below);
          this.playPlayer(t.fall, t.volume * 0.5, t.pitch * 0.75);
        }
      }
      p.lastFallDistance = 0;
    }
    this.wasOnGround = p.onGround;
  }

  /** Music manager and ambient handlers (Minecraft.tick → musicManager.tick, LocalPlayer ambient handlers). */
  private tickAudio(): void {
    const pl = this.player;
    const bx = Math.floor(pl.x), by = Math.floor(pl.y), bz = Math.floor(pl.z);
    const loaded = this.loggedIn && this.world.isLoaded(bx, bz);
    const biome = loaded ? BIOMES[this.world.getBiome(bx, by, bz)] : undefined;
    const underWater = loaded && pl.isUnderWater;
    this.music.tick(situationalMusic({
      inMenu: !loaded,
      dimension: (this.dimension as 'overworld' | 'the_nether' | 'the_end') ?? 'overworld',
      biome: biome?.name ?? 'plains',
      biomeCategory: biome?.category ?? 'plains',
      underWater,
      creativeFlying: this.gameMode === 1 && pl.abilities.mayFly,
    }, this.music.isPlaying(MUSICS.underWater)));
    if (!loaded) return;
    this.ambient.tick(this.world, {
      x: pl.x, y: pl.y, z: pl.z, eyeY: pl.y + pl.eyeHeight, underWater: underWater && this.gameMode !== 3,
      biome: biome?.name ?? null,
    });
  }

  /** LevelRenderer.tickRain sound part: rain sounds from random exposed blocks near the camera. */
  private tickRainSound(): void {
    const f = this.world.rain / (this.settings.graphics === 'fancy' ? 1 : 2);
    if (f <= 0) return;
    const r = new JavaRandom(BigInt(this.clientTicks) * 312987231n);
    const cx = Math.floor(this.x), cy = Math.floor(this.y), cz = Math.floor(this.z);
    const n = Math.floor(100 * f * f) / (this.settings.particles === 'decreased' ? 2 : 1);
    let hit: [number, number, number] | null = null;
    for (let j = 0; j < n; j++) {
      const x = cx + r.nextInt(21) - 10, z = cz + r.nextInt(21) - 10;
      const c = this.world.getChunk(x >> 4, z >> 4);
      if (!c) continue;
      const y = c.motionBlocking[(z & 15) * 16 + (x & 15)]! - 1;
      if (y > 0 && y <= cy + 10 && y >= cy - 10 && isRainingAt(this.world, true, x, y, z)) {
        hit = [x, y, z];
        if (this.settings.particles === 'minimal') break;
        r.nextDouble();
        r.nextDouble();
      }
    }
    if (hit && r.nextInt(3) < this.rainSoundTime++) {
      this.rainSoundTime = 0;
      const c = this.world.getChunk(cx >> 4, cz >> 4);
      const top = c ? c.motionBlocking[(cz & 15) * 16 + (cx & 15)]! : 0;
      if (hit[1] > cy + 1 && top > cy) this.playAt('weather.rain.above', 'weather', hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5, 0.1, 0.5);
      else this.playAt('weather.rain', 'weather', hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5, 0.2, 1);
    }
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

  // ------------------------------------------------------------------ sound options (host for SoundOptionsScreen)
  volume(c: SoundCategory): number {
    return this.settings.volumes[c] ?? 1;
  }
  setVolume(c: SoundCategory, v: number): void {
    this.settings.volumes[c] = v;
    this.sound.volumes[c] = v;
    this.sound.applyVolumes();
    saveSettings(this.settings);
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
    if (this.sleeping) this.sleepCounter = Math.min(100, this.sleepCounter + 1);
    else if (this.sleepCounter > 0 && ++this.sleepCounter >= 110) this.sleepCounter = 0;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerableTime > 0) this.invulnerableTime--;
    if (this.dead) this.deathTime = Math.min(20, this.deathTime + 1);
    this.screen?.tick();
  }

  private hudState(): HudPlayer {
    return {
      gameMode: this.gameMode,
      health: this.health,
      maxHealth: 20 + 4 * (this.itemUse.amplifier('health_boost') + 1),
      absorption: this.itemUse.absorption,
      armor: this.itemUse.armorPoints(this.interaction.inventory),
      food: this.food,
      saturation: this.saturation,
      air: this.air,
      maxAir: 300,
      eyeInWater: this.player.isUnderWater,
      invulnerableTime: this.invulnerableTime,
      xpProgress: this.xpProgress,
      xpLevel: this.xpLevel,
      inventory: this.interaction.inventory,
      heartType: this.itemUse.hasEffect('poison') ? 'poisoned' : this.itemUse.hasEffect('wither') ? 'withered' : this.ticksFrozen >= 140 ? 'frozen' : 'normal',
      hardcore: false,
      regeneration: this.itemUse.hasEffect('regeneration'),
      hungerEffect: this.itemUse.hasEffect('hunger'),
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

  /** Moved to another dimension: forget the old one's chunks and entities (vanilla handleRespawn). */
  private changeDimension(p: { dimension: string; gameMode: number; x: number; y: number; z: number; yaw: number; pitch: number }): void {
    this.dimension = p.dimension;
    for (const c of [...this.world.chunks.values()]) this.world.unloadChunk(c.x, c.z);
    this.players.clear();
    this.items.clear();
    this.bolts.clear();
    this.world.rain = 0;
    this.world.thunder = 0;
    this.setGameMode(p.gameMode);
    this.placePlayer(p.x, p.y, p.z);
    this.player.vx = this.player.vy = this.player.vz = 0;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.interaction.stopDestroy();
    this.portalFx.time = this.portalFx.old = 0;
  }

  /** Yaw of the bed we sleep in (Direction.toYRot of its facing), or null. */
  private bedFacing(): number | null {
    const p = this.player;
    const st = this.world.getState(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    if (!blockNameOf(st).endsWith('_bed')) return null;
    return ({ south: 0, west: 90, north: 180, east: 270 } as Record<string, number>)[getProp(st, 'facing') as string] ?? null;
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

  /** Item id of the main hand at the last tick (Player.lastItemInMainHand). */
  private lastMainHandId = 0;

  /** LocalPlayer.aiStep xBob/yBob, Player attack strength, ItemInHandRenderer.tick equip height. */
  private tickHand(): void {
    this.xBobO = this.xBob;
    this.yBobO = this.yBob;
    this.xBob += (this.pitch - this.xBob) * 0.5;
    this.yBob += (this.yaw - this.yBob) * 0.5;
    this.attackStrengthTicker++;
    this.oMainHandHeight = this.mainHandHeight;
    const cur = this.interaction.inventory.selectedStack;
    // Player.tick: a different item in the main hand (ignoring durability) restarts the attack cooldown
    const curId = cur?.id ?? 0;
    if (curId !== this.lastMainHandId) {
      this.attackStrengthTicker = 0;
      this.lastMainHandId = curId;
    }
    const h = this.handItem;
    const matches = (!h && !cur) || (!!h && !!cur && h.id === cur.id && h.count === cur.count && h.damage === cur.damage);
    if (matches) this.handItem = cur;
    const delay = 20 / (attackSpeedOf(cur?.id ?? 0) * this.attackSpeedMul());
    const f = Math.min(1, Math.max(0, (this.attackStrengthTicker + 1) / delay));
    const same = this.handItem === cur;
    this.mainHandHeight = tickHandHeight(this.mainHandHeight, same ? f * f * f : 0);
    if (this.mainHandHeight < 0.1) this.handItem = cur;
    // off hand: no attack-strength dip (ItemInHandRenderer.tick)
    this.oOffHandHeight = this.offHandHeight;
    const off = this.interaction.inventory.get(40);
    const ho = this.offHandItem;
    const offMatches = (!ho && !off) || (!!ho && !!off && ho.id === off.id && ho.count === off.count && ho.damage === off.damage);
    if (offMatches) this.offHandItem = off;
    this.offHandHeight = tickHandHeight(this.offHandHeight, this.offHandItem === off ? 1 : 0);
    if (this.offHandHeight < 0.1) this.offHandItem = off;
  }

  /** ATTACK_SPEED effect modifiers: Haste +10% per level, Mining Fatigue −10% per level. */
  private attackSpeedMul(): number {
    const u = this.itemUse;
    if (!u) return 1;
    return (1 + 0.1 * (u.amplifier('haste') + 1)) * (1 - 0.1 * (u.amplifier('mining_fatigue') + 1));
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
    return skyDarkenLevel(this.world.dayTime, this.world.rain, this.world.thunder);
  }

  /**
   * GameRenderer.pick entity part: players within 3 blocks in survival (6 in creative); a nearer
   * entity hides the block behind it, and a farther survival hit becomes a miss.
   */
  private pickEntity(ex: number, ey: number, ez: number, dx: number, dy: number, dz: number, partial: number): void {
    this.targetEntity = null;
    const far = this.gameMode === 1;
    const range = far ? 6 : this.reach;
    let best = this.target ? this.target.distance * this.target.distance : range * range;
    let hit: number | null = null;
    let hitDist2 = Infinity;
    for (const p of this.players.values()) {
      // spectators can't be picked (EntitySelector.NO_SPECTATORS)
      if (p.pose === 'dying' || (p.flags & 32) !== 0) continue;
      const x = p.xo + (p.x - p.xo) * partial, y = p.yo + (p.y - p.yo) * partial, z = p.zo + (p.z - p.zo) * partial;
      const h = p.crouching ? 1.5 : 1.8;
      const t = rayAabb(ex, ey, ez, dx, dy, dz, x - 0.3, y, z - 0.3, x + 0.3, y + h, z + 0.3);
      if (t === null || t > range) continue;
      const d2 = t * t;
      if (d2 < hitDist2) {
        hitDist2 = d2;
        hit = p.id;
      }
    }
    for (const m of this.mobs.mobs.values()) {
      // dying mobs can't be targeted (LivingEntity.isPickable: alive only)
      if (m.deathTime > 0) continue;
      const x = m.xo + (m.x - m.xo) * partial, y = m.yo + (m.y - m.yo) * partial, z = m.zo + (m.z - m.zo) * partial;
      const [w, h] = m.dims();
      // Entity.getPickRadius is 0 for mobs; the hit box is the bounding box
      const t = rayAabb(ex, ey, ez, dx, dy, dz, x - w / 2, y, z - w / 2, x + w / 2, y + h, z + w / 2);
      if (t === null || t > range) continue;
      if (t * t < hitDist2) {
        hitDist2 = t * t;
        hit = m.id;
      }
    }
    if (hit === null) return;
    if (!far && hitDist2 > 9) {
      // survival reach for entities is 3: a farther entity in the way means nothing is targeted
      this.target = null;
      return;
    }
    if (hitDist2 < best || !this.target) {
      best = hitDist2;
      this.targetEntity = hit;
      this.target = null;
    }
  }

  /** Block outline for picking (ScaffoldingBlock.getShape: a full cube while holding scaffolding). */
  private readonly outlineOf = (state: number): Box[] => {
    if (STATE_TO_BLOCK[state] === ID_SCAFFOLDING && this.interaction?.inventory.selectedStack?.id === ITEM_SCAFFOLDING) return FULL_BOX;
    return outlineBoxes(state);
  };

  /**
   * GameRenderer.shouldRenderBlockOutline: players who may not build (adventure, spectator) see
   * the outline only on blocks they could still act on — containers for spectators, blocks
   * their item's CanDestroy/CanPlaceOn tags allow in adventure (no item tags exist yet).
   */
  private shouldRenderBlockOutline(): boolean {
    if (this.gameMode === 0 || this.gameMode === 1) return true;
    if (this.gameMode === 3) return !!this.target && hasMenuProvider(this.target.state);
    return false;
  }

  /** Gui.canRenderCrosshairForSpectator: only over a container block (or a container entity). */
  private spectatorCrosshair(): boolean {
    return !!this.target && hasMenuProvider(this.target.state);
  }

  /** KeyboardHandler.handleDebugKeys (F3 + key); false if the key does nothing. */
  private handleDebugKey(k: string): boolean {
    const s = this.settings;
    const shift = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
    switch (k) {
      case 'KeyA':
        this.chunks.allChanged();
        this.debugFeedback('Reloading all chunks');
        return true;
      case 'KeyB':
        this.showHitboxes = !this.showHitboxes;
        this.debugFeedback(`Hitboxes: ${this.showHitboxes ? 'shown' : 'hidden'}`);
        return true;
      case 'KeyC': {
        const p = this.player;
        this.debugFeedback('Copied location to clipboard');
        this.setClipboard(`/execute in minecraft:${this.dimension} run tp @s ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} ${this.yaw.toFixed(2)} ${this.pitch.toFixed(2)}`);
        return true;
      }
      case 'KeyD':
        this.hud.clearChat();
        return true;
      case 'KeyF':
        s.renderDistance = Math.max(2, Math.min(32, s.renderDistance + (shift ? -1 : 1)));
        this.applySettings(false);
        saveSettings(s);
        this.debugFeedback(`Render Distance: ${s.renderDistance}`);
        return true;
      case 'KeyG':
        this.showChunkBorders = !this.showChunkBorders;
        this.debugFeedback(`Chunk borders: ${this.showChunkBorders ? 'shown' : 'hidden'}`);
        return true;
      case 'KeyH':
        s.advancedItemTooltips = !s.advancedItemTooltips;
        this.debugFeedback(`Advanced tooltips: ${s.advancedItemTooltips ? 'shown' : 'hidden'}`);
        saveSettings(s);
        return true;
      case 'KeyI':
        this.copyRecreateCommand(!shift);
        return true;
      case 'KeyN':
        // operators toggle between spectator and the previous game mode (creative if none)
        if (this.permissionLevel < 2) this.debugFeedback('Unable to switch gamemode; no permission');
        else if (this.gameMode !== 3) this.send({ t: 'chat', message: '/gamemode spectator' });
        else this.send({ t: 'chat', message: `/gamemode ${GAME_MODE_NAMES[this.previousGameMode >= 0 && this.previousGameMode !== 3 ? this.previousGameMode : 1]}` });
        return true;
      case 'KeyP':
        s.pauseOnLostFocus = !s.pauseOnLostFocus;
        saveSettings(s);
        this.debugFeedback(`Pause on lost focus: ${s.pauseOnLostFocus ? 'enabled' : 'disabled'}`);
        return true;
      case 'KeyQ':
        this.debugFeedback('Key bindings:');
        for (const line of DEBUG_HELP) this.hud.addChat(line);
        return true;
      case 'KeyT':
        this.debugFeedback('Reloaded resource packs');
        this.chunks.allChanged();
        return true;
      default:
        return false;
    }
  }

  private setClipboard(text: string): void {
    void navigator.clipboard?.writeText(text).catch(() => {});
    this.lastClipboard = text;
  }

  /** F3+I: the block or entity under the crosshair as a /setblock or /summon command. */
  private copyRecreateCommand(queryServer: boolean): void {
    // block entity and entity NBT come from the server when asked (none exist yet, so the
    // server's answer is the same as the client's)
    const side = queryServer ? 'server' : 'client';
    const mob = this.targetEntity !== null ? this.mobs.get(this.targetEntity) : undefined;
    if (mob) {
      this.setClipboard(`/summon minecraft:${mob.type} ${mob.x.toFixed(2)} ${mob.y.toFixed(2)} ${mob.z.toFixed(2)}`);
      this.debugFeedback(`Copied ${side}-side entity data to clipboard`);
    } else if (this.targetEntity !== null) {
      const e = this.players.get(this.targetEntity);
      if (!e) return;
      this.setClipboard(`/summon minecraft:player ${e.x.toFixed(2)} ${e.y.toFixed(2)} ${e.z.toFixed(2)}`);
      this.debugFeedback(`Copied ${side}-side entity data to clipboard`);
    } else if (this.target) {
      const t = this.target;
      this.setClipboard(`/setblock ${t.x} ${t.y} ${t.z} minecraft:${stateToString(t.state)}`);
      this.debugFeedback(`Copied ${side}-side block data to clipboard`);
    }
  }

  /** Minecraft.debugFeedback: "[Debug]:" prefix in bold yellow. */
  private debugFeedback(msg: string): void {
    this.hud.addChat(`§e§l[Debug]:§r ${msg}`);
  }

  /** Camera.getMaxZoom: pull the third-person camera in front of blocks (8 jittered rays). */
  private maxZoom(x: number, y: number, z: number, fx: number, fy: number, fz: number, start: number): number {
    let d = start;
    for (let i = 0; i < 8; i++) {
      const ox = ((i & 1) * 2 - 1) * 0.1, oy = (((i >> 1) & 1) * 2 - 1) * 0.1, oz = (((i >> 2) & 1) * 2 - 1) * 0.1;
      const ax = x + ox, ay = y + oy, az = z + oz;
      const bx = x - fx * start + ox + oz, by = y - fy * start + oy, bz = z - fz * start + oz;
      const hit = raycastBlocks(this.world, ax, ay, az, bx - ax, by - ay, bz - az, Math.hypot(bx - ax, by - ay, bz - az));
      if (hit) {
        const dist = Math.hypot(hit.px - x, hit.py - y, hit.pz - z);
        if (dist < d) d = dist;
      }
    }
    return d;
  }

  /** F3+B: entity bounding boxes, eye-height plane (red) and view direction (blue). */
  private renderHitboxes(cx: number, cy: number, cz: number, partial: number): void {
    const L = this.lines;
    L.begin();
    const box = (x: number, y: number, z: number, w: number, h: number, r: number, g: number, b: number) =>
      L.box(x - w / 2 - cx, y - cy, z - w / 2 - cz, x + w / 2 - cx, y + h - cy, z + w / 2 - cz, r, g, b, 1);
    const living = (x: number, y: number, z: number, w: number, h: number, eye: number, yaw: number, pitch: number) => {
      box(x, y, z, w, h, 1, 1, 1);
      L.box(x - w / 2 - cx, y + eye - 0.01 - cy, z - w / 2 - cz, x + w / 2 - cx, y + eye + 0.01 - cy, z + w / 2 - cz, 1, 0, 0, 1);
      const yr = (yaw * Math.PI) / 180, pr = (pitch * Math.PI) / 180;
      const vx = -Math.sin(yr) * Math.cos(pr), vy = -Math.sin(pr), vz = Math.cos(yr) * Math.cos(pr);
      L.line(x - cx, y + eye - cy, z - cz, x + vx * 2 - cx, y + eye + vy * 2 - cy, z + vz * 2 - cz, 0, 0, 1, 1);
    };
    for (const p of this.players.values()) {
      const x = p.xo + (p.x - p.xo) * partial, y = p.yo + (p.y - p.yo) * partial, z = p.zo + (p.z - p.zo) * partial;
      const crouch = p.crouching;
      living(x, y, z, 0.6, crouch ? 1.5 : 1.8, crouch ? 1.27 : 1.62, p.headYaw, p.pitch);
    }
    for (const m of this.mobs.mobs.values()) {
      const x = m.xo + (m.x - m.xo) * partial, y = m.yo + (m.y - m.yo) * partial, z = m.zo + (m.z - m.zo) * partial;
      const [w, h] = m.dims();
      living(x, y, z, w, h, h * 0.85, m.headYaw, m.pitch);
    }
    if (this.cameraType !== 0 && this.selfModel) {
      const s = this.selfModel, pl = this.player;
      living(s.xo + (s.x - s.xo) * partial, s.yo + (s.y - s.yo) * partial, s.zo + (s.z - s.zo) * partial, pl.width, pl.height, pl.eyeHeight, this.yaw, this.pitch);
    }
    for (const it of this.items.values()) {
      const x = it.xo + (it.x - it.xo) * partial, y = it.yo + (it.y - it.yo) * partial, z = it.zo + (it.z - it.zo) * partial;
      box(x, y, z, 0.25, 0.25, 1, 1, 1);
    }
    L.flush(this.viewProj, this.canvas.width, this.canvas.height);
  }

  /**
   * F3+G (DebugRenderer.ChunkBorderRenderer): red corner posts of the neighbouring chunks,
   * yellow lines every 2 blocks on the current chunk's sides, blue corners and section rings.
   */
  private renderChunkBorders(cx: number, cy: number, cz: number, entityX: number, entityZ: number): void {
    const L = this.lines;
    const y0 = 0 - cy, y1 = 256 - cy;
    const x0 = (Math.floor(entityX) >> 4) * 16 - cx, z0 = (Math.floor(entityZ) >> 4) * 16 - cz;
    const post = (x: number, z: number, r: number, g: number, b: number, a: number) => L.line(x, y0, z, x, y1, z, r, g, b, a);
    const ring = (y: number, r: number, g: number, b: number) => {
      L.line(x0, y, z0, x0, y, z0 + 16, r, g, b, 1);
      L.line(x0, y, z0 + 16, x0 + 16, y, z0 + 16, r, g, b, 1);
      L.line(x0 + 16, y, z0 + 16, x0 + 16, y, z0, r, g, b, 1);
      L.line(x0 + 16, y, z0, x0, y, z0, r, g, b, 1);
    };
    L.begin();
    for (let i = -16; i <= 32; i += 16) for (let j = -16; j <= 32; j += 16) post(x0 + i, z0 + j, 1, 0, 0, 0.5);
    for (let k = 2; k < 16; k += 2) {
      post(x0 + k, z0, 1, 1, 0, 1);
      post(x0 + k, z0 + 16, 1, 1, 0, 1);
      post(x0, z0 + k, 1, 1, 0, 1);
      post(x0 + 16, z0 + k, 1, 1, 0, 1);
    }
    for (let y = 0; y <= 256; y += 2) ring(y - cy, 1, 1, 0);
    L.flush(this.viewProj, this.canvas.width, this.canvas.height, true, 1);
    L.begin();
    for (let i = 0; i <= 16; i += 16) for (let j = 0; j <= 16; j += 16) post(x0 + i, z0 + j, 0.25, 0.25, 1, 1);
    for (let y = 0; y <= 256; y += 16) ring(y - cy, 0.25, 0.25, 1);
    L.flush(this.viewProj, this.canvas.width, this.canvas.height, true, 2);
  }

  /** Test hook: render the hand at this swing tick (0..6) instead of the live swing. */
  debugSwingFreeze: number | undefined = undefined;
  private readonly handBob = mat4();
  private renderHand(partial: number, medium: string): void {
    const showHand = !this.hideHud && this.gameMode !== 3 && this.cameraType === 0 && !this.sleeping;
    const fire = this.onFire && this.gameMode !== 3 && this.cameraType === 0;
    // bobHurt then bobView (GameRenderer.renderItemInHand)
    const hb = this.handBob;
    hb.set(IDENTITY4);
    this.applyHurtBob(hb, partial);
    if (this.settings.viewBobbing) multiply(hb, hb, this.bobMat);
    const sw = this.attackAnim - this.attackAnimO;
    const swingNow = this.debugSwingFreeze !== undefined ? this.debugSwingFreeze / 6 : this.attackAnimO + (sw < 0 ? sw + 1 : sw) * partial;
    const use = this.firstPersonUse && this.firstPersonUse.remaining > 0 ? this.firstPersonUse : null;
    const main = this.handItem, off = this.offHandItem;
    const mainName = main ? itemName(main.id) : null, offName = off ? itemName(off.id) : null;
    const charged = (n: string | null, st: typeof main) => n === 'crossbow' && !!(st as { tag?: { Charged?: unknown } } | null)?.tag?.Charged;
    const which = handsToRender(mainName, offName, use ? { hand: use.hand, item: use.item } : null, charged(mainName, main), charged(offName, off));
    const side = (hand: 0 | 1, st: typeof main, name: string | null, h: number, hO: number, out: HandSide): HandSide => {
      out.stack = st;
      out.swing = this.swingingHand === hand ? swingNow : 0;
      out.equip = 1 - (hO + (h - hO) * partial);
      out.use = use && use.hand === hand ? use : null;
      out.crossbow = name === 'crossbow' ? { charged: charged(name, st) } : null;
      return out;
    };
    // EntityRenderDispatcher.getPackedLightCoords at the eye (light probe); burning = block light 15
    const eyeX = Math.floor(this.x), eyeY = Math.floor(this.y), eyeZ = Math.floor(this.z);
    let light = this.world.getLight(eyeX, eyeY, eyeZ);
    if (this.onFire) light = (light & 0xf0) | 15;
    this.hand.render({
      main: side(0, main, mainName, this.mainHandHeight, this.oMainHandHeight, this.handMain),
      off: side(1, off, offName, this.offHandHeight, this.oOffHandHeight, this.handOff),
      renderMain: which.main,
      renderOff: which.off,
      leftHanded: this.settings.mainHand === 'left',
      partial,
      autoSpin: this.autoSpinAttack,
      scoping: this.scoping,
      invisible: this.localEffects.has('invisibility'),
      pitch: this.pitch,
      yaw: this.yaw,
      xBob: this.xBobO + (this.xBob - this.xBobO) * partial,
      yBob: this.yBobO + (this.yBob - this.yBobO) * partial,
      light,
      skinName: new URLSearchParams(location.search).get('name') ?? 'Player',
      aspect: this.canvas.width / Math.max(1, this.canvas.height),
      // GameRenderer.getFov(useFOVSetting = false): 70, with the fluid and death modifiers only
      fov: 70 * this.fovEffects(partial, medium),
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

  private readonly handMain: HandSide = { stack: null, swing: 0, equip: 0, use: null, crossbow: null };
  private readonly handOff: HandSide = { stack: null, swing: 0, equip: 0, use: null, crossbow: null };

  /**
   * GameRenderer.getFov multipliers shared by the level and the hand: in water or lava ×
   * lerp(fovEffectScale, 1, 6/7); while dying ÷ ((1 − 500 / (min(deathTime + partial, 20) + 500)) · 2 + 1).
   */
  private fovEffects(partial: number, medium: string): number {
    let k = 1;
    if (medium === 'water' || medium === 'lava') k *= 1 + (0.85714287 - 1) * this.settings.fovEffectScale;
    if (this.dead) {
      const f = Math.min(this.deathTime + partial, 20);
      k /= (1 - 500 / (f + 500)) * 2 + 1;
    }
    return k;
  }

  private readonly heldModels = new Map<number, HeldItemModel | null>();
  /**
   * Held-item models for the first-person hand: the item's own sprite (item atlas, with the
   * vanilla model overrides bow_pulling_0..2 / crossbow_pulling_0..2 / crossbow_arrow /
   * crossbow_firework), else the block it places (3D model or flat block sprite), else the
   * missing sprite. Display types follow the model parents (block, generated, handheld, rod).
   */
  private heldItemModel(stack: ItemStack): HeldItemModel | null {
    const bi = this.blockItems;
    const ov = this.heldOverride(stack);
    const key = (ov !== null ? bi.spriteKey(ov) : null) ?? bi.modelKey(stack.id) ?? bi.spriteKey('missing');
    if (key === null) return null;
    const foil = hasFoil(stack);
    const ck = foil ? key + 0.5 : key; // separate cache entry for the glinting variant
    let m = this.heldModels.get(ck);
    if (m === undefined) {
      m = { display: bi.display(key), draw: (p, mm, l, lm, lights) => { bi.glintNext = foil; bi.draw(key, p, mm, l, lm, undefined, false, lights); } };
      this.heldModels.set(ck, m);
    }
    return m;
  }

  /** Item model override predicates (ItemProperties "pull"/"pulling"/"charged"/"firework") → sprite name. */
  private heldOverride(stack: ItemStack): string | null {
    const name = itemName(stack.id);
    if (name !== 'bow' && name !== 'crossbow') return null;
    const u = this.firstPersonUse;
    const using = !!u && u.remaining > 0 && u.item === name && (u.hand === 0 ? this.handItem : this.offHandItem) === stack;
    if (name === 'bow') {
      if (!using) return null;
      const pull = (u!.duration - u!.remaining) / 20;
      return pull >= 0.9 ? 'bow_pulling_2' : pull >= 0.65 ? 'bow_pulling_1' : 'bow_pulling_0';
    }
    const tag = (stack as { tag?: { Charged?: unknown; ChargedProjectiles?: { id?: string }[] } }).tag;
    if (tag?.Charged) return tag.ChargedProjectiles?.some((p) => p.id?.endsWith('firework_rocket')) ? 'crossbow_firework' : 'crossbow_arrow';
    if (!using) return null;
    const pull = (u!.duration - u!.remaining) / (u!.chargeDuration ?? 25);
    return pull >= 1 ? 'crossbow_pulling_2' : pull >= 0.58 ? 'crossbow_pulling_1' : 'crossbow_pulling_0';
  }

  private readonly itemModel = mat4();
  private readonly itemRand = new JavaRandom(0n);
  /** Dropped items: block items as small spinning, bobbing cubes (vanilla ItemEntityRenderer). */
  private renderItems(cx: number, cy: number, cz: number, partial: number, fog: [number, number, number], fogStart: number, fogEnd: number): void {
    const orbs: OrbView[] = [];
    for (const it of this.items.values()) {
      if (it.orb) {
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
        // orbs: bounding box 0.5 → 32 blocks × entity distance
        const ed = 0.5 * 64 * this.settings.entityDistance;
        if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < ed * ed) {
          orbs.push({ x, y, z, value: it.orb, time: it.age + partial, light: this.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z)) });
        }
        continue;
      }
      if (!it.item) continue;
      // Entity.shouldRenderAtSqrDistance: bounding-box size (0.25) × 64 × entity distance
      const ed = 0.25 * 64 * this.settings.entityDistance;
      if ((it.x - cx) ** 2 + (it.y - cy) ** 2 + (it.z - cz) ** 2 >= ed * ed) continue;
      const state = this.blockItems.modelKey(it.item);
      if (state === null) continue;
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
        this.blockItems.glintNext = !!it.tag && hasFoil({ id: it.item, tag: it.tag });
        this.blockItems.draw(state, this.viewProj, m, light, this.lightmap.tex, { color: fog, start: fogStart, end: fogEnd });
      }
    }
    // camera right/up from the view matrix rows (billboards)
    const v = this.view;
    this.orbRenderer.render(orbs, this.viewProj, cx, cy, cz, v[0]!, v[4]!, v[8]!, v[1]!, v[5]!, v[9]!, this.lightmap.tex);
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

  /** GameRenderer.getNightVisionScale: full strength, flickering out over the last 10 seconds. */
  private nightVisionScale(partial: number): number {
    const e = this.itemUse?.effects.get(16);
    if (!e) return 0;
    return e.duration > 200 ? 1 : 0.7 + Math.sin((e.duration - partial) * Math.PI * 0.2) * 0.3;
  }

  /** GameRenderer.renderLevel portal/nausea distortion: a rotating horizontal squash of the view. */
  private applyNausea(partial: number): void {
    const f = this.oPortalTime + (this.portalTime - this.oPortalTime) * partial;
    if (f <= 0) return;
    const speed = this.itemUse.hasEffect('nausea') ? 7 : 20;
    let f1 = 5 / (f * f + 5) - f * 0.04;
    f1 *= f1;
    const ang = (((this.clientTicks + partial) * speed) % 360) * (Math.PI / 180);
    const axis: [number, number, number] = [0, Math.SQRT1_2, Math.SQRT1_2];
    const rot = (out: Mat4, a: number) => {
      const c = Math.cos(a), sn = Math.sin(a), t = 1 - c, [x, y, z] = axis;
      out.set([
        t * x * x + c, t * x * y + sn * z, t * x * z - sn * y, 0,
        t * x * y - sn * z, t * y * y + c, t * y * z + sn * x, 0,
        t * x * z + sn * y, t * y * z - sn * x, t * z * z + c, 0,
        0, 0, 0, 1,
      ]);
    };
    const m = this.nauseaMat, tmp = this.nauseaTmp;
    rot(m, ang);
    multiply(this.proj, this.proj, m);
    tmp.set([1 / f1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    multiply(this.proj, this.proj, tmp);
    rot(m, -ang);
    multiply(this.proj, this.proj, m);
  }

  private resize(): void {
    // Render Resolution (Video Settings) scales the 3D view; the canvas is stretched pixelated
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * Math.max(0.25, Math.min(1, this.settings.renderScale || 1));
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
    if (this.screen instanceof LoadingTerrainScreen) {
      // the loading screen covers the world: don't draw it, and upload meshes as fast as they come
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const budget = this.chunks.uploadBudgetMs;
      this.chunks.uploadBudgetMs = 25;
      this.chunks.update(this.x, this.y + 1.62, this.z);
      this.chunks.uploadBudgetMs = budget;
      this.gui.begin(this.settings.guiScale);
      this.screen.render();
      return;
    }
    const s = this.settings;
    // eye position (raycasts) and camera position/rotation (detached in third person, vanilla Camera.setup)
    let ex = this.prevX + (this.x - this.prevX) * partial;
    let ey = this.prevY + (this.y - this.prevY) * partial;
    let ez = this.prevZ + (this.z - this.prevZ) * partial;
    let camYaw = this.yaw, camPitch = this.pitch;
    // spectating: the camera sits at the watched entity's eyes and turns with its head
    const camEnt = this.cameraEntity !== null ? this.players.get(this.cameraEntity) ?? null : null;
    if (camEnt) {
      ex = camEnt.xo + (camEnt.x - camEnt.xo) * partial;
      ey = camEnt.yo + (camEnt.y - camEnt.yo) * partial + (POSE_EYE[camEnt.pose as Pose] ?? 1.62);
      ez = camEnt.zo + (camEnt.z - camEnt.zo) * partial;
      camYaw = camEnt.headYawO + wrapDegrees(camEnt.headYaw - camEnt.headYawO) * partial;
      camPitch = camEnt.pitchO + (camEnt.pitch - camEnt.pitchO) * partial;
    }
    const lookYaw = camYaw, lookPitch = camPitch;
    let cx = ex, cy = ey, cz = ez;
    const bedFacing = this.sleeping ? this.bedFacing() : null;
    if (bedFacing !== null) {
      // Camera.setup in bed: look from the pillow toward the foot, nudged back 0.3
      camYaw = bedFacing - 180;
      camPitch = 0;
      const yr0 = (camYaw * Math.PI) / 180;
      cx -= -Math.sin(yr0) * 0.3;
      cz -= Math.cos(yr0) * 0.3;
    }
    if (this.cameraType !== 0) {
      if (this.cameraType === 2) {
        camYaw += 180;
        camPitch = -camPitch;
      }
      const yr0 = (camYaw * Math.PI) / 180, pr0 = (camPitch * Math.PI) / 180;
      const fx = -Math.sin(yr0) * Math.cos(pr0), fy = -Math.sin(pr0), fz = Math.cos(yr0) * Math.cos(pr0);
      const d = this.maxZoom(ex, ey, ez, fx, fy, fz, 4);
      cx = ex - fx * d;
      cy = ey - fy * d;
      cz = ez - fz * d;
    }
    const dayTime = this.world.dayTime + (this.world.doDaylightCycle ? partial : 0);
    const tod = timeOfDay(dayTime);

    // environment colours
    const biome = BIOMES[this.world.getBiome(Math.floor(cx), Math.floor(cy), Math.floor(cz))] ?? BIOMES[1]!;
    const camState = this.world.getState(Math.floor(cx), Math.floor(cy), Math.floor(cz));
    const medium: SkyState['medium'] = FLUID[camState] === 1 ? 'water' : FLUID[camState] === 2 ? 'lava' : 'air';
    const yr = (camYaw * Math.PI) / 180, pr = (camPitch * Math.PI) / 180;
    const lookX = -Math.sin(yr) * Math.cos(pr), lookY = -Math.sin(pr), lookZ = Math.cos(yr) * Math.cos(pr);
    const pyr = (lookYaw * Math.PI) / 180, ppr = (lookPitch * Math.PI) / 180;
    const eyeLookX = -Math.sin(pyr) * Math.cos(ppr), eyeLookY = -Math.sin(ppr), eyeLookZ = Math.cos(pyr) * Math.cos(ppr);
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
    this.sound.setListener(cx, cy, cz, camYaw, camPitch);
    const sky = skyColor(skyState, this.skyRgb);
    const fog = fogColor(skyState, sky, this.fogRgb);
    const renderDist = s.renderDistance * 16;
    let fogStart = renderDist * 0.75, fogEnd = renderDist;
    const nether = this.dimension === 'the_nether';
    if (nether && medium === 'air') {
      netherFogColor(this.world, cx, cy, cz, s.renderDistance, fog);
      [fogStart, fogEnd] = netherFogRange(renderDist);
    } else if (this.dimension === 'the_end' && medium === 'air') {
      endFogColor(cy, s.renderDistance, fog);
    } else if (medium === 'water') {
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
      // FogRenderer: Fire Resistance clears lava fog to 0..3 blocks
      if (this.localEffects.has('fire_resistance')) {
        fogStart = 0;
        fogEnd = 3;
      } else {
        fogStart = 0.25;
        fogEnd = 1;
      }
    }
    // FogRenderer: Night Vision lifts the fog colour to full brightness; Blindness pulls the fog
    // in to 5 blocks over a second and blacks out its colour
    const nv = this.nightVisionScale(partial);
    if (nv > 0 && fog[0] > 0 && fog[1] > 0 && fog[2] > 0) {
      const k = Math.min(1 / fog[0], 1 / fog[1], 1 / fog[2]);
      for (let i = 0; i < 3; i++) fog[i] = fog[i]! * (1 - nv) + fog[i]! * k * nv;
    }
    const blind = this.itemUse?.effects.get(15);
    if (blind && medium !== 'lava') {
      const f1 = fogEnd + (5 - fogEnd) * Math.min(1, blind.duration / 20);
      fogStart = f1 * 0.25;
      fogEnd = f1;
      const d = blind.duration < 20 ? (1 - blind.duration / 20) ** 2 : 0;
      for (let i = 0; i < 3; i++) fog[i] = fog[i]! * d;
    }

    this.lightmap.update({
      skyDarken: hasSky(this.dimension) ? skyDarken(tod, this.world.rain, this.world.thunder) : 0,
      ambient: ambientLight(this.dimension),
      gamma: s.gamma,
      nightVision: this.nightVisionScale(partial),
      flash: this.skyFlashTime > 0,
      end: this.dimension === 'the_end',
    });

    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    let fov = s.fov * (this.oFov + (this.fovModifier - this.oFov) * partial);
    fov *= this.fovEffects(partial, medium);
    perspective(this.proj, (fov * Math.PI) / 180, aspect, 0.05, Math.max(renderDist * 4, 512));
    this.applyHurtBob(this.proj, partial);
    applyPortalWobble(this.proj, this.portalFx.value(partial), this.clientTicks + partial, 1);
    if (s.viewBobbing) this.applyViewBob(partial);
    this.applyNausea(partial);
    viewRotation(this.view, camYaw, camPitch);
    if (hasSky(this.dimension)) this.sky.render(this.proj, this.view, skyState, sky, fog, renderDist);
    else if (this.dimension === 'the_end' && medium === 'air') (this.endSky ??= new EndSkyRenderer(this.gl)).render(this.proj, this.view);

    multiply(this.viewProj, this.proj, this.view);
    this.camPos[0] = cx;
    this.camPos[1] = cy;
    this.camPos[2] = cz;
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
      // (the entity we look through is not drawn in first person)
      const visible = [...this.players.values()].filter((p) => (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2 < ed * ed && (p !== camEnt || this.cameraType !== 0));
      this.entityRenderer.renderPlayers(visible, this.world, this.viewProj, cx, cy, cz, partial, this.lightmap.tex, fog, fogStart, fogEnd);
    }
    {
      // player shadows (radius 0.5; spectators are invisible and cast none)
      const ed = 64 * this.settings.entityDistance;
      for (const p of this.players.values()) {
        if ((p.flags & 32) !== 0 || p === camEnt || (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2 >= ed * ed) continue;
        this.mobRenderer.addShadow(p.xo + (p.x - p.xo) * partial, p.yo + (p.y - p.yo) * partial, p.zo + (p.z - p.zo) * partial, 0.5);
      }
      const sm = this.selfModel;
      if (this.cameraType !== 0 && sm && !camEnt && this.gameMode !== 3) this.mobRenderer.addShadow(sm.xo + (sm.x - sm.xo) * partial, sm.yo + (sm.y - sm.yo) * partial, sm.zo + (sm.z - sm.zo) * partial, 0.5);
    }
    {
      // LivingEntity.shouldRenderAtSqrDistance: bounding-box size × 64 blocks × entity distance
      const visible = this.visibleMobs;
      visible.length = 0;
      for (const m of this.mobs.mobs.values()) {
        const [w, h] = m.dims();
        const d = ((w + w + h) / 3) * 64 * this.settings.entityDistance;
        if ((m.x - cx) ** 2 + (m.y - cy) ** 2 + (m.z - cz) ** 2 >= d * d || m.id === this.cameraEntity) continue;
        // EntityRenderer.shouldRender: frustum test on the culling box (bounding box grown by 0.5)
        const hw = w / 2 + 0.5;
        if (!aabbInFrustum(this.planes, m.x - hw - cx, m.y - 0.5 - cy, m.z - hw - cz, m.x + hw - cx, m.y + h + 0.5 - cy, m.z + hw - cz)) continue;
        visible.push(m);
      }
      this.mobRenderer.shadows = (this.settings as { entityShadows?: boolean }).entityShadows ?? true;
      this.mobRenderer.target = this.targetEntity;
      this.mobRenderer.names = !this.hideHud;
      this.mobRenderer.render(visible, this.world, this.viewProj, cx, cy, cz, camYaw, camPitch, partial, this.lightmap.tex, fog, fogStart, fogEnd, this.skyDarkenLevel());
    }
    // our own body in third person (a spectator's is a faint floating head)
    if (this.cameraType !== 0 && this.selfModel && !camEnt) {
      this.entityRenderer.renderPlayers([this.selfModel], this.world, this.viewProj, cx, cy, cz, partial, this.lightmap.tex, fog, fogStart, fogEnd);
    }
    // items in players' hands (ItemInHandLayer), queued by the entity renderer
    for (const h of this.entityRenderer.held) {
      const key = (h.pull !== undefined ? this.bowPullKey(h.pull) : null) ?? this.blockItems.modelKey(h.item);
      if (key !== null) this.blockItems.draw(key, this.viewProj, h.matrix, h.light, this.lightmap.tex, { color: fog, start: fogStart, end: fogEnd });
    }
    recycleHeld(this.entityRenderer);
    this.renderItems(cx, cy, cz, partial, fog, fogStart, fogEnd);
    this.fallingBlocks.render(this.blockItems, this.world, this.viewProj, cx, cy, cz, partial, this.lightmap.tex, { color: fog, start: fogStart, end: fogEnd });
    // arrows: the arrow sprite laid along the flight path (line fallback without sprites)
    const arrowKey = this.arrows.arrows.size ? this.blockItems.modelKey(ITEMS_BY_NAME.get('arrow')!.id) : null;
    if (arrowKey !== null) {
      this.arrows.matrices(cx, cy, cz, partial, 0.7, (m, bx, by, bz) => {
        this.blockItems.draw(arrowKey, this.viewProj, m, this.world.getLight(bx, by, bz), this.lightmap.tex, { color: fog, start: fogStart, end: fogEnd });
      });
    } else if (this.arrows.render(this.lines, cx, cy, cz, partial)) this.lines.flush(this.viewProj, this.canvas.width, this.canvas.height);
    {
      const v = this.view;
      this.arrows.thrownMatrices(cx, cy, cz, partial, [v[0]!, v[4]!, v[8]!], [v[1]!, v[5]!, v[9]!], (m, item, bx, by, bz) => {
        const key = this.blockItems.modelKey(item);
        if (key !== null) this.blockItems.draw(key, this.viewProj, m, this.world.getLight(bx, by, bz), this.lightmap.tex, { color: fog, start: fogStart, end: fogEnd });
      });
    }
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
      const yr2 = (camYaw * Math.PI) / 180, pr2 = (camPitch * Math.PI) / 180;
      const rx = -Math.cos(yr2), rz = -Math.sin(yr2);
      const ux = -Math.sin(yr2) * Math.sin(pr2) * -1, uy = Math.cos(pr2), uz = Math.cos(yr2) * Math.sin(pr2) * -1;
      this.particles.render(this.viewProj, rx, 0, rz, ux, uy, uz, cx, cy, cz, partial, this.textures.tex, this.lightmap.tex, fog, fogStart, fogEnd);
      if (this.itemParticles && this.itemTextures) this.itemParticles.render(this.viewProj, rx, 0, rz, ux, uy, uz, cx, cy, cz, partial, this.itemTextures.texture(this.gl), this.lightmap.tex, fog, fogStart, fogEnd);
    }
    // targeted block outline (vanilla: black, 40% alpha)
    this.target = raycastBlocks(this.world, ex, ey, ez, eyeLookX, eyeLookY, eyeLookZ, this.reach, false, this.hitScratch, this.outlineOf);
    this.pickEntity(ex, ey, ez, eyeLookX, eyeLookY, eyeLookZ, partial);
    if (this.target && !this.hideHud && this.shouldRenderBlockOutline()) {
      const t = this.target;
      this.lines.begin();
      const e = 0.002;
      for (const b of this.outlineOf(t.state)) {
        this.lines.box(t.x + b[0] - e - cx, t.y + b[1] - e - cy, t.z + b[2] - e - cz, t.x + b[3] + e - cx, t.y + b[4] + e - cy, t.z + b[5] + e - cz, 0, 0, 0, 0.4);
      }
      this.lines.flush(this.viewProj, this.canvas.width, this.canvas.height);
      const stage = this.breakStage >= 0 ? this.breakStage : this.interaction.crackStage;
      const ia = this.interaction;
      if (stage >= 0 && (this.breakStage >= 0 || (ia.destroyX === t.x && ia.destroyY === t.y && ia.destroyZ === t.z))) this.crack.render(this.viewProj, this.textures.tex, t.x, t.y, t.z, t.state, stage, cx, cy, cz);
    }
    if (hasSky(this.dimension)) this.weather.render(this.viewProj, this.world, cx, cy, cz, this.clientTicks, partial, this.world.rain, s.graphics === 'fancy', this.lightmap.tex);
    if (medium === 'air' && hasSky(this.dimension)) {
      this.clouds.render(this.viewProj, cx, cy, cz, this.clientTicks + partial, s.clouds, s.renderDistance, cloudColor(tod, this.world.rain, this.world.thunder), fog);
    }
    if (this.showHitboxes) this.renderHitboxes(cx, cy, cz, partial);
    if (this.showChunkBorders) this.renderChunkBorders(cx, cy, cz, camEnt ? camEnt.x : this.player.x, camEnt ? camEnt.z : this.player.z);
    this.renderHand(partial, medium);
    this.updateItemAnim(partial);
    this.guiPartial = partial;
    this.renderGui(cx, cy, cz);
  }

  private renderGui(x: number, y: number, z: number): void {
    const g = this.gui;
    g.begin(this.settings.guiScale);
    this.hud.chatOpen = this.screen instanceof ChatScreen;
    if (!this.hideHud) this.renderNameplates();
    if (!this.hideHud) {
      if (this.showDebug) this.renderDebug(x, y, z);
      else if (this.cameraType === 0 && (this.gameMode !== 3 || this.spectatorCrosshair())) {
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
      // Gui.renderPortalOverlay: the portal texture over the whole screen while teleporting
      const pa = this.portalFx.overlayAlpha(this.guiPartial);
      if (pa > 0 && this.portalOverlay) {
        const bmp = this.portalOverlay, frames = Math.max(1, Math.floor(bmp.height / bmp.width));
        const fr = Math.floor(this.clientTicks / 2) % frames;
        g.ctx.save();
        g.ctx.globalAlpha = pa;
        g.ctx.imageSmoothingEnabled = false;
        g.ctx.drawImage(bmp, 0, fr * bmp.width, bmp.width, bmp.width, 0, 0, g.width, g.height);
        g.ctx.restore();
      }
      // Gui.renderTextureOverlay: frost creeps in while freezing
      if (this.ticksFrozen > 0 && this.frostOverlay && this.gameMode !== 3) {
        g.ctx.save();
        g.ctx.globalAlpha = Math.min(1, this.ticksFrozen / 140);
        g.ctx.imageSmoothingEnabled = true;
        g.ctx.drawImage(this.frostOverlay, 0, 0, g.width, g.height);
        g.ctx.restore();
      }
      this.hud.render(g, this.hudState(), (id, c, x, y, dmg, pop, tag) => this.renderGuiItem(id, c, x, y, dmg, pop, tag), this.guiPartial);
      this.bossBars.render(g);
      renderEffects(g, this.itemUse.effects.values());
      this.renderItemActivation(g);
      // PlayerTabOverlay: while the key is held, in multiplayer or with company
      if (!this.screen && this.binds.down('playerlist') && (this.playerInfo.size > 1 || this.players.size > 0)) {
        renderPlayerList(g, [...this.playerInfo.values()], (id) => this.playerLatency.get(id) ?? 0, (pi) => this.skinFace(pi));
      }
      if (this.gameMode === 3) {
        this.spectatorGui.renderHotbar(g);
        this.spectatorGui.renderTooltip(g);
      }
      // Gui.render: fade to dark blue while falling asleep
      if (this.sleepCounter > 0) {
        let f1 = this.sleepCounter / 100;
        if (f1 > 1) f1 = 1 - (this.sleepCounter - 100) / 10;
        g.fill(0, 0, g.width, g.height, ((Math.floor(220 * f1) & 255) << 24) | 0x101020);
      }
    }
    if (this.screen) {
      this.screen.render(this.mouseGX, this.mouseGY);
      // EffectRenderingInventoryScreen: active effects listed left of the survival/creative inventory
      const sc = this.screen as unknown as { leftPos?: number; topPos?: number };
      if ((this.screen instanceof InventoryScreen || this.screen instanceof CreativeScreen) && sc.leftPos !== undefined) this.effectsClient.renderInventoryList(this.gui, sc.leftPos, sc.topPos ?? 0, this.itemUse.effects.values());
    }
  }

  // ------------------------------------------------------------------ chat (Phase 9)
  private skinFace(pi: PlayerInfoEntry): ImageBitmap | null {
    const file = this.entityRenderer.skinFor(pi.name, pi.skin);
    if (!this.skinImages.has(file)) {
      this.skinImages.set(file, null);
      void fetch(file.startsWith('data:') ? file : `./textures/skins/${file}.png`).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((img) => this.skinImages.set(file, img));
    }
    return this.skinImages.get(file) ?? null;
  }

  openChat(initial: string): void {
    this.setScreen(new ChatScreen(this.chatHost(), initial));
  }

  private chatHost(): ChatHost {
    return {
      gui: this.gui,
      setScreen: (sc) => {
        this.setScreen(sc);
        this.input.clearPresses();
      },
      sendChat: (m) => this.send({ t: 'chat', message: m }),
      requestSuggestions: (id, text) => this.send({ t: 'commandSuggest', id, text }),
      history: this.hud.sentHistory,
      renderChatFocused: (g) => this.hud.renderChat(g, true),
      scrollChat: (n) => this.hud.scrollChat(n),
      chatClickAt: (mx, my) => this.hud.chatClickAt(mx, my),
      copyToClipboard: (t) => this.setClipboard(t),
    };
  }

  /**
   * Name tags above other players (vanilla EntityRenderer.renderNameTag, drawn on the GUI layer):
   * 0.025 blocks per pixel, 0.5 above the hitbox, within 64 blocks, faint when sneaking or
   * behind blocks, hidden for invisible players.
   */
  private renderNameplates(): void {
    const g = this.gui, m = this.viewProj;
    const [cx, cy, cz] = this.camPos as [number, number, number];
    const camEnt = this.cameraEntity;
    for (const p of this.players.values()) {
      if (p.id === camEnt || (p.flags & 32) !== 0) continue;
      const h = p.pose === 'crouching' ? 1.5 : p.pose === 'swimming' || p.pose === 'fall_flying' ? 0.6 : p.pose === 'sleeping' ? 0.2 : 1.8;
      const x = p.x - cx, y = p.y + h + 0.5 - cy, z = p.z - cz;
      if (x * x + y * y + z * z > 4096) continue;
      const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      if (w <= 0.05) continue;
      const sx = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w;
      const sy = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w;
      if (sx < -1.2 || sx > 1.2 || sy < -1.2 || sy > 1.2) continue;
      const scale = (0.025 * m[5]! * this.canvas.height) / 2 / w / g.scale;
      if (scale < 0.05) continue;
      const gx = ((sx + 1) / 2) * g.width, gy = ((1 - sy) / 2) * g.height;
      const blocked = !!raycastBlocks(this.world, cx, cy, cz, x, y, z, Math.hypot(x, y, z) - 0.3);
      const sneaking = p.pose === 'crouching';
      const tw = g.font.width(p.name);
      const ctx = g.ctx;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.scale(scale, scale);
      g.fill(-tw / 2 - 1, -1, tw + 2, 9, 0x40000000);
      ctx.globalAlpha = sneaking || blocked ? 0.125 : 1;
      g.text(p.name, -tw / 2, 0, 0xffffff, false);
      ctx.restore();
    }
  }

  /** A 16×16 item in the GUI with its stack count (vanilla ItemRenderer.renderGuiItem + decorations). */
  renderGuiItem(id: number, count: number, x: number, y: number, damage = 0, pop = 0, tag?: ItemTag): void {
    drawItemStack(this.gui, tag ? { id, count, damage, tag } : { id, count, damage }, x, y, undefined, pop);
  }

  /** GameRenderer.renderItemActivation: the totem flies up toward the camera and spins (40 ticks). */
  private renderItemActivation(g: Gui): void {
    const fx = this.effectsClient;
    if (fx.itemActivationTicks <= 0) return;
    const totem = ITEMS_BY_NAME.get('totem_of_undying');
    if (!totem) return;
    const i = 40 - fx.itemActivationTicks;
    const f = (i + this.guiPartial) / 40;
    const f1 = f * f, f2 = f * f1;
    const f3 = 10.25 * f2 * f1 - 24.95 * f1 * f1 + 25.5 * f2 - 13.8 * f1 + 4 * f;
    const f4 = f3 * Math.PI;
    const ox = fx.itemActivationOffX * (g.width / 4), oy = fx.itemActivationOffY * (g.height / 4);
    const cx = g.width / 2 + ox * Math.abs(Math.sin(f4 * 2)), cy = g.height / 2 + oy * Math.abs(Math.sin(f4 * 2));
    const size = (50 + 175 * Math.sin(f4)) * (g.height / 240) * 0.5;
    const spin = (900 * Math.abs(Math.sin(f4))) % 360;
    const ctx = g.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    // the 3D Y-spin is drawn as a horizontal squash
    ctx.scale(Math.cos((spin * Math.PI) / 180) || 0.05, 1);
    ctx.scale(size / 16, size / 16);
    drawItemStack(g, { id: totem.id, count: 1, damage: 0 }, -8, -8);
    ctx.restore();
  }

  /** partial tick of the frame being drawn (GUI animations) */
  private guiPartial = 0;

  /** Compass needle and clock dial frames for item icons/models (vanilla item property functions). */
  private updateItemAnim(partial: number): void {
    const dayTime = this.world.dayTime + (this.world.doDaylightCycle ? partial : 0);
    itemAnim.clock = Math.floor(timeOfDay(dayTime) * 64) & 63;
    if (!this.compassTarget) this.compassTarget = [Math.floor(this.x) + 0.5, Math.floor(this.z) + 0.5];
    const dx = this.compassTarget[0] - this.x, dz = this.compassTarget[1] - this.z;
    // bearing in Minecraft yaw degrees (0 = +Z/south, 90 = −X/west), relative to where we look
    const bearing = (Math.atan2(-dx, dz) * 180) / Math.PI;
    const rel = dx * dx + dz * dz < 1e-4 ? (Date.now() / 20) % 360 : bearing - this.yaw;
    itemAnim.compass = Math.round((((rel % 360) + 360) % 360) / 360 * 32) & 31;
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
    const fpsCap = (s.maxFps <= 0 ? 'inf' : String(s.maxFps)) + (s.vsync ? ' vsync' : '');
    const left = [
      'Blockcraft 1.17.1 (1.17.1/blockcraft)',
      `${this.fps} fps T: ${fpsCap} ${s.graphics} ${s.clouds === 'off' ? '' : s.clouds + '-clouds'} B: ${s.biomeBlend}  1%: ${low1.toFixed(0)}`,
      `C: ${st.visible}/${st.sections} (s) D: ${s.renderDistance}, pC: ${String(st.building).padStart(3, '0')}, pU: ${String(st.pending).padStart(2, '0')}, ${st.avgBuildMs.toFixed(1)} ms/build`,
      `Q: ${st.quads}`,
      `Client Chunk Cache: ${this.world.chunks.size}`,
      `minecraft:${this.dimension}`,
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
const ID_SCAFFOLDING = BLOCKS_BY_NAME.get('scaffolding')!.id;
const ITEM_SCAFFOLDING = ITEMS_BY_NAME.get('scaffolding')!.id;
const FULL_BOX: Box[] = [[0, 0, 0, 1, 1, 1]];

/** Keys with an F3 combo (KeyboardHandler.handleDebugKeys). */
const DEBUG_KEYS = ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyN', 'KeyP', 'KeyQ', 'KeyT'];
const DEBUG_HELP = [
  'F3 + A = Reload chunks',
  'F3 + B = Show hitboxes',
  'F3 + C = Copy location as /tp command, hold F3 + C to crash the game',
  'F3 + D = Clear chat',
  'F3 + F = Cycle render distance (Shift to invert)',
  'F3 + G = Show chunk boundaries',
  'F3 + H = Advanced tooltips',
  'F3 + I = Copy entity or block data to clipboard',
  'F3 + L = Start/stop profiling',
  'F3 + N = Cycle previous gamemode <-> spectator',
  'F3 + P = Pause on lost focus',
  'F3 + Q = Show this list',
  'F3 + T = Reload resource packs',
  'F3 + Esc = Pause without pause menu (if pausing is possible)',
  'F3 + F4 = Open game mode switcher',
];
const GAME_MODE_NAMES = ['survival', 'creative', 'adventure', 'spectator'];

/** Ray vs box (slab method); returns the entry distance along the unit direction, or null. */
function rayAabb(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = 0, tmax = Infinity;
  for (const [o, d, a, b] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]] as const) {
    if (Math.abs(d) < 1e-12) {
      if (o < a || o > b) return null;
      continue;
    }
    let t1 = (a - o) / d, t2 = (b - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

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
