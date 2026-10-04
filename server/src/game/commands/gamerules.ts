/**
 * Every 1.17.1 game rule with its vanilla default (GameRules.java, 1.17.1). The server keeps
 * them in `GameServer.gameRules` (a superset of survival.ts's GameRules); a few legacy fields
 * on the server (doDaylightCycle, doWeatherCycle, playersSleepingPercentage, spawnRadius) are
 * kept in sync when a rule changes.
 */
import type { GameRules } from '../survival';

export interface AllGameRules extends GameRules {
  announceAdvancements: boolean;
  commandBlockOutput: boolean;
  disableElytraMovementCheck: boolean;
  disableRaids: boolean;
  doDaylightCycle: boolean;
  doEntityDrops: boolean;
  doFireTick: boolean;
  doImmediateRespawn: boolean;
  doInsomnia: boolean;
  doLimitedCrafting: boolean;
  doMobLoot: boolean;
  doMobSpawning: boolean;
  doPatrolSpawning: boolean;
  doTileDrops: boolean;
  doTraderSpawning: boolean;
  doWeatherCycle: boolean;
  drowningDamage: boolean;
  fallDamage: boolean;
  fireDamage: boolean;
  forgiveDeadPlayers: boolean;
  freezeDamage: boolean;
  keepInventory: boolean;
  logAdminCommands: boolean;
  maxCommandChainLength: number;
  maxEntityCramming: number;
  mobGriefing: boolean;
  naturalRegeneration: boolean;
  playersSleepingPercentage: number;
  randomTickSpeed: number;
  reducedDebugInfo: boolean;
  sendCommandFeedback: boolean;
  showDeathMessages: boolean;
  spawnRadius: number;
  spectatorsGenerateChunks: boolean;
  universalAnger: boolean;
}

export const DEFAULT_ALL_GAME_RULES: AllGameRules = {
  announceAdvancements: true,
  commandBlockOutput: true,
  disableElytraMovementCheck: false,
  disableRaids: false,
  doDaylightCycle: true,
  doEntityDrops: true,
  doFireTick: true,
  doImmediateRespawn: false,
  doInsomnia: true,
  doLimitedCrafting: false,
  doMobLoot: true,
  doMobSpawning: true,
  doPatrolSpawning: true,
  doTileDrops: true,
  doTraderSpawning: true,
  doWeatherCycle: true,
  drowningDamage: true,
  fallDamage: true,
  fireDamage: true,
  forgiveDeadPlayers: true,
  freezeDamage: true,
  keepInventory: false,
  logAdminCommands: true,
  maxCommandChainLength: 65536,
  maxEntityCramming: 24,
  mobGriefing: true,
  naturalRegeneration: true,
  playersSleepingPercentage: 100,
  randomTickSpeed: 3,
  reducedDebugInfo: false,
  sendCommandFeedback: true,
  showDeathMessages: true,
  spawnRadius: 10,
  spectatorsGenerateChunks: true,
  universalAnger: false,
};

export type GameRuleName = keyof AllGameRules;

/** Rule names in vanilla registration order is irrelevant for the command; sorted for /gamerule. */
export const GAME_RULE_NAMES = Object.keys(DEFAULT_ALL_GAME_RULES).sort() as GameRuleName[];

export function isIntRule(name: GameRuleName): boolean {
  return typeof DEFAULT_ALL_GAME_RULES[name] === 'number';
}
