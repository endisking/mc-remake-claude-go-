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
import { mat4, perspective, viewRotation, multiply, translate, frustumPlanes } from './render/math';
import type { TextureManifest } from './render/blockmodels';

export class Game {
  readonly gl: WebGL2RenderingContext;
  readonly world = new ClientWorld();
  readonly input: Input;
  settings: Settings;
  private transport: ClientTransport | null = null;
  chunks!: ChunkRenderer;
  private textures!: BlockTextureArray;
  private lightmap!: Lightmap;
  private sky!: SkyRenderer;
  private biomes = new BiomeColors();
  private manifest!: TextureManifest;

  // camera / player (Phase 1: free flight; Phase 2 adds physics)
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
  private fpsCount = 0;
  private fpsTime = 0;

  private readonly proj = mat4();
  private readonly view = mat4();
  private readonly viewProj = mat4();
  private readonly planes = new Float32Array(24);

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.input = new Input(canvas);
    const q = new URLSearchParams(location.search);
    this.settings = applyQueryOverrides(loadSettings(), q);
    this.showDebug = q.get('debug') === '1';
    const click = document.getElementById('click')!;
    click.addEventListener('click', () => this.input.lock());
    this.input.onLockChange = (l) => click.classList.toggle('hidden', l || q.get('nolock') === '1');
    if (q.get('nolock') === '1') click.classList.add('hidden');
  }

  async start(): Promise<void> {
    const q = new URLSearchParams(location.search);
    this.manifest = await loadManifest();
    const [tex] = await Promise.all([
      BlockTextureArray.load(this.gl, this.manifest, this.settings.mipmapLevels),
      this.biomes.load(),
    ]);
    this.textures = tex;
    this.biomes.blendRadius = this.settings.biomeBlend;
    this.lightmap = new Lightmap(this.gl);
    this.sky = new SkyRenderer(this.gl);
    await this.sky.loadTextures();
    this.chunks = new ChunkRenderer(this.gl, this.world, this.biomes, this.manifest, {
      smoothLighting: this.settings.smoothLighting,
      fancy: this.settings.graphics === 'fancy',
    });
    this.chunks.renderDistance = this.settings.renderDistance;

    const seed = BigInt(q.get('seed') ?? '12345');
    const { transport } = await startIntegratedServer(seed);
    this.connect(transport);
    requestAnimationFrame((t) => this.frame(t));
  }

  connect(t: ClientTransport): void {
    this.transport = t;
    t.onMessage = (d) => this.handle(decodeS2C(d));
    t.onClose = (r) => console.warn('disconnected', r);
    this.send({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'Player', viewDistance: this.settings.renderDistance });
  }

  send(p: C2S): void {
    this.transport?.send(encodeC2S(p));
  }

  private handle(p: S2C): void {
    switch (p.t) {
      case 'login':
        this.x = this.prevX = p.x;
        this.y = this.prevY = p.y + 1.62;
        this.z = this.prevZ = p.z;
        this.yaw = p.yaw;
        this.pitch = p.pitch;
        this.loggedIn = true;
        this.applyTestParams();
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
        this.x = this.prevX = p.x;
        this.y = this.prevY = p.y + 1.62;
        this.z = this.prevZ = p.z;
        break;
      case 'chat':
      case 'disconnect':
        break;
    }
  }

  /** URL test hooks: ?x=&y=&z=&yaw=&pitch=&time= (used by screenshot checks and the benchmark). */
  private applyTestParams(): void {
    const q = new URLSearchParams(location.search);
    const n = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
    if (n('x') !== undefined || n('y') !== undefined || n('z') !== undefined) {
      const x = n('x') ?? this.x, y = n('y') ?? this.y - 1.62, z = n('z') ?? this.z;
      this.send({ t: 'chat', message: `/tp ${x} ${y} ${z}` });
    }
    if (n('yaw') !== undefined) this.yaw = n('yaw')!;
    if (n('pitch') !== undefined) this.pitch = n('pitch')!;
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
    // free flight (temporary until player physics in Phase 2)
    const i = this.input;
    let fwd = 0, strafe = 0, up = 0;
    if (i.down.has('KeyW')) fwd++;
    if (i.down.has('KeyS')) fwd--;
    if (i.down.has('KeyA')) strafe++;
    if (i.down.has('KeyD')) strafe--;
    if (i.down.has('Space')) up++;
    if (i.down.has('ShiftLeft')) up--;
    const speed = (i.down.has('ControlLeft') ? 1.09 : 0.546) * (i.down.has('KeyR') ? 4 : 1);
    const yr = (this.yaw * Math.PI) / 180;
    const len = Math.hypot(fwd, strafe) || 1;
    this.x += ((-Math.sin(yr) * fwd + Math.cos(yr) * strafe) / len) * speed;
    this.z += ((Math.cos(yr) * fwd + Math.sin(yr) * strafe) / len) * speed;
    this.y += up * speed * 0.75;
    if (this.loggedIn && this.clientTicks % 1 === 0) {
      this.send({ t: 'move', x: this.x, y: this.y - 1.62, z: this.z, yaw: this.yaw, pitch: this.pitch, onGround: false });
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
    this.render(partial);
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
    const look = [-Math.sin(yr) * Math.cos(pr), -Math.sin(pr), Math.cos(yr) * Math.cos(pr)];
    const skyState: SkyState = {
      timeOfDay: tod,
      moonPhase: Math.floor(this.world.dayTime / 24000) % 8,
      rain: this.world.rain,
      thunder: this.world.thunder,
      flash: 0,
      biomeSky: skyColorForTemperature(biome.temperature),
      biomeFog: [0xc0 / 255, 0xd8 / 255, 1],
      renderDistanceChunks: s.renderDistance,
      camY: cy,
      lookX: look[0]!,
      lookY: look[1]!,
      lookZ: look[2]!,
      medium,
      waterFog: [0x05 / 255, 0x05 / 255, 0x33 / 255],
    };
    const sky = skyColor(skyState);
    const fog = fogColor(skyState, sky);
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
    perspective(this.proj, (s.fov * Math.PI) / 180, aspect, 0.05, Math.max(renderDist * 4, 512));
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
    this.updateHud(cx, cy, cz);
  }

  private updateHud(x: number, y: number, z: number): void {
    const dbg = document.getElementById('debug')!;
    document.getElementById('crosshair')!.classList.toggle('hidden', this.hideHud);
    if (!this.showDebug || this.hideHud) {
      if (dbg.textContent) dbg.textContent = '';
      return;
    }
    if (this.clientTicks % 2 !== 0 && dbg.textContent) return;
    const st = this.chunks.stats();
    const sorted = [...this.frameTimes].sort((a, b) => b - a);
    const low1 = sorted.length ? 1000 / sorted[Math.max(0, Math.floor(sorted.length * 0.01))]! : 0;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const facing = ['south (Towards positive Z)', 'west (Towards negative X)', 'north (Towards negative Z)', 'east (Towards positive X)'][Math.floor((((this.yaw % 360) + 360) % 360) / 90 + 0.5) & 3];
    const light = this.world.getLight(bx, by, bz);
    const biome = BIOMES[this.world.getBiome(bx, by, bz)];
    const lines = [
      `Blockcraft 1.17.1 (${this.fps} fps, 1% low ${low1.toFixed(0)})`,
      `C: ${st.visible}/${st.sections} sections, ${st.pending} pending, ${st.building} building, ${st.avgBuildMs.toFixed(1)} ms/build`,
      `Quads: ${st.quads}`,
      '',
      `XYZ: ${x.toFixed(3)} / ${(y - 1.62).toFixed(5)} / ${z.toFixed(3)}`,
      `Block: ${bx} ${Math.floor(y - 1.62)} ${bz}`,
      `Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      `Facing: ${facing} (${(((this.yaw + 180) % 360 + 360) % 360 - 180).toFixed(1)} / ${this.pitch.toFixed(1)})`,
      `Light: ${Math.max(light >> 4, light & 15)} (${light >> 4} sky, ${light & 15} block)`,
      `Biome: minecraft:${biome?.name ?? '?'}`,
      `Day ${Math.floor(this.world.dayTime / 24000)}, time ${Math.floor(this.world.dayTime % 24000)}`,
      `Loaded chunks: ${this.world.chunks.size} (key ${chunkKey(bx >> 4, bz >> 4)})`,
    ];
    dbg.innerHTML = lines.map((l) => (l ? `<span>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>` : '')).join('\n');
  }
}
