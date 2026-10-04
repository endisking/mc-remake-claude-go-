/**
 * Command sources (vanilla CommandSourceStack), targets (players and entities) and the chat
 * text components used for feedback.
 */
import type { GameServer } from '../server';
import { ServerPlayer } from '../player';
import type { ServerEntity } from '../entity';
import { ENTITIES_BY_NAME, ITEMS_BY_ID } from '@shared/data';

/** Anything a selector can find. */
export type Target = ServerPlayer | ServerEntity;

export function isPlayer(t: Target): t is ServerPlayer {
  return t instanceof ServerPlayer;
}
export function typeOf(t: Target): string {
  return isPlayer(t) ? 'player' : t.type;
}
/** Entity.getName: the player name, else the custom name, else the type's display name. */
export function nameOf(t: Target): string {
  if (isPlayer(t)) return t.name;
  const custom = (t as { customName?: string }).customName;
  if (custom) return custom;
  // ItemEntity.getName: the item's name
  const stack = (t as { stack?: { id: number } }).stack;
  if (t.type === 'item' && stack) return ITEMS_BY_ID[stack.id]?.displayName ?? 'Item';
  return ENTITIES_BY_NAME.get(t.type)?.displayName ?? t.type;
}
export function isAlive(t: Target): boolean {
  return isPlayer(t) ? !t.living.dead : !t.removed;
}
/** Eye height for the "eyes" anchor and facing. */
export function eyeHeightOf(t: Target): number {
  if (isPlayer(t)) return t.pose === 'crouching' ? 1.27 : t.pose === 'swimming' || t.pose === 'fall_flying' ? 0.4 : 1.62;
  return t.height * 0.85;
}

// ------------------------------------------------------------------ text components
export interface TextComponent {
  text: string;
  color?: string;
  italic?: boolean;
  bold?: boolean;
  underlined?: boolean;
  extra?: (TextComponent | string)[];
  /** copy-to-clipboard click (e.g. the seed) */
  clickEvent?: { action: string; value: string };
  hoverEvent?: { action: string; contents: string };
}

export type Message = TextComponent | string;

export function comp(m: Message): TextComponent {
  return typeof m === 'string' ? { text: m } : m;
}

export function colored(text: string, color: string, extra: Partial<TextComponent> = {}): TextComponent {
  return { text, color, ...extra };
}

/** A sink for command output (a player, the console, or a test). */
export interface CommandOutput {
  sendMessage(m: TextComponent): void;
  /** CommandSource.acceptsSuccess / acceptsFailure / shouldInformAdmins */
  acceptsSuccess(): boolean;
  acceptsFailure(): boolean;
  shouldInformAdmins(): boolean;
}

export class CommandSource {
  constructor(
    readonly server: GameServer,
    readonly output: CommandOutput,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly yaw: number,
    readonly pitch: number,
    readonly level: number,
    readonly textName: string,
    readonly entity: Target | null,
    readonly silent = false,
    readonly anchorEyes = false,
  ) {}

  static forPlayer(server: GameServer, p: ServerPlayer, level: number): CommandSource {
    const out: CommandOutput = {
      sendMessage: (m) => server.send(p, { t: 'chat', json: JSON.stringify(m) }),
      acceptsSuccess: () => server.gameRules.sendCommandFeedback,
      acceptsFailure: () => true,
      shouldInformAdmins: () => true,
    };
    return new CommandSource(server, out, p.x, p.y, p.z, p.yaw, p.pitch, level, p.name, p);
  }

  get player(): ServerPlayer | null {
    return this.entity && isPlayer(this.entity) ? this.entity : null;
  }

  /** CommandSourceStack.getPlayerOrException */
  playerOrThrow(): ServerPlayer {
    const p = this.player;
    if (!p) throw new CommandError('A player is required to run this command here');
    return p;
  }
  entityOrThrow(): Target {
    if (!this.entity) throw new CommandError('An entity is required to run this command here');
    return this.entity;
  }

  hasPermission(level: number): boolean {
    return this.level >= level;
  }

  withSilent(): CommandSource {
    return new CommandSource(this.server, this.output, this.x, this.y, this.z, this.yaw, this.pitch, this.level, this.textName, this.entity, true, this.anchorEyes);
  }

  /** CommandSourceStack.sendSuccess: to the source, and to other ops as "[Name: message]" when `log`. */
  sendSuccess(m: Message, log: boolean): void {
    const c = comp(m);
    if (this.output.acceptsSuccess() && !this.silent) this.output.sendMessage(c);
    if (log && this.output.shouldInformAdmins() && !this.silent) this.broadcastToAdmins(c);
  }

  private broadcastToAdmins(c: TextComponent): void {
    const admin: TextComponent = { text: '', color: 'gray', italic: true, extra: ['[', this.textName, ': ', c, ']'] };
    const s = this.server;
    if (s.gameRules.sendCommandFeedback) {
      for (const p of s.players) {
        if (p === this.entity || !s.commands.access.isOp(p)) continue;
        s.send(p, { t: 'chat', json: JSON.stringify(admin) });
      }
    }
    if (this.output !== s.commands.console && s.gameRules.logAdminCommands) s.commands.console.sendMessage(admin);
  }

  sendFailure(m: Message): void {
    if (this.output.acceptsFailure() && !this.silent) this.output.sendMessage({ text: '', color: 'red', extra: [comp(m)] });
  }
}

/** A runtime command failure (vanilla SimpleCommandExceptionType without input context). */
export class CommandError extends Error {}

/** Plain text of a component tree (console output, tests). */
export function plainText(m: Message): string {
  if (typeof m === 'string') return m;
  return m.text + (m.extra ?? []).map(plainText).join('');
}
