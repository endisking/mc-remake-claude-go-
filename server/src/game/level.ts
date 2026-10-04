/**
 * One dimension on the server (vanilla ServerLevel): its blocks, light, generator, entities, fluid
 * ticks and chunk-storage bookkeeping. GameServer keeps one per dimension and switches its
 * "current level" (GameServer.level) while it ticks a dimension or handles a player's packet, so
 * the world/entity code reads `server.world`, `server.entities`, … of the right dimension.
 */
import { BlockWorld } from '@shared/world/world';
import { LightEngine } from '@shared/world/light';
import type { DevGenerator } from '@shared/worldgen/devgen';
import type { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import type { NetherGenerator } from '@shared/worldgen/nether/generator';
import type { WorldStorage } from '../storage/types';
import type { ServerEntity } from './entity';
import type { ServerPlayer } from './player';
import type { FluidTicks } from './fluidticks';

export type DimensionId = 'overworld' | 'the_nether' | 'the_end';

/** Vanilla dimension type properties that the server and client need. */
export interface DimensionType {
  id: DimensionId;
  /** resource name sent to clients */
  name: string;
  /** save folder (vanilla DIM-1 / DIM1), '' for the overworld */
  folder: string;
  hasSkyLight: boolean;
  hasCeiling: boolean;
  ultraWarm: boolean;
  natural: boolean;
  /** coordinate_scale */
  coordinateScale: number;
  /** logical_height */
  logicalHeight: number;
  ambientLight: number;
  fixedTime: number | null;
  bedWorks: boolean;
  respawnAnchorWorks: boolean;
}

export const DIMENSION_TYPES: Record<DimensionId, DimensionType> = {
  overworld: {
    id: 'overworld', name: 'minecraft:overworld', folder: '', hasSkyLight: true, hasCeiling: false, ultraWarm: false, natural: true,
    coordinateScale: 1, logicalHeight: 256, ambientLight: 0, fixedTime: null, bedWorks: true, respawnAnchorWorks: false,
  },
  the_nether: {
    id: 'the_nether', name: 'minecraft:the_nether', folder: 'DIM-1', hasSkyLight: false, hasCeiling: true, ultraWarm: true, natural: false,
    coordinateScale: 8, logicalHeight: 128, ambientLight: 0.1, fixedTime: 18000, bedWorks: false, respawnAnchorWorks: true,
  },
  the_end: {
    id: 'the_end', name: 'minecraft:the_end', folder: 'DIM1', hasSkyLight: false, hasCeiling: false, ultraWarm: false, natural: false,
    coordinateScale: 1, logicalHeight: 256, ambientLight: 0, fixedTime: 6000, bedWorks: false, respawnAnchorWorks: false,
  },
};

export type LevelGenerator = DevGenerator | OverworldGenerator | NetherGenerator;

export class ServerLevel {
  readonly world = new BlockWorld();
  readonly light: LightEngine;
  readonly players: ServerPlayer[] = [];
  readonly entities = new Map<number, ServerEntity>();
  fluids!: FluidTicks;
  /** Sections whose light changed this tick: key -> [cx, sy, cz] */
  lightDirty = new Map<number, [number, number, number]>();

  // ---- chunk storage bookkeeping (see GameServer "world access") ----
  readonly stored = new Map<number, { raw: Uint8Array; unsaved: boolean; writing?: boolean }>();
  writeChain: Promise<void> = Promise.resolve();
  readonly savedKeys = new Set<number>();
  readonly loading = new Set<number>();
  readonly savedSig = new Map<number, number>();
  readonly saveDirty = new Set<number>();
  readonly shadowed = new Set<number>();
  trickling = false;

  constructor(
    readonly type: DimensionType,
    readonly generator: LevelGenerator,
    /** chunk storage for this dimension (its own namespace), undefined = memory only */
    readonly storage: WorldStorage | undefined,
    biomeZoomSeed: bigint,
  ) {
    this.world.biomeZoomSeed = biomeZoomSeed;
    this.light = new LightEngine(this.world);
    this.light.hasSkyLight = type.hasSkyLight;
  }

  get id(): DimensionId {
    return this.type.id;
  }
}
