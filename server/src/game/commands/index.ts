/**
 * The server's command system (vanilla Commands + the chat half of
 * ServerGamePacketListenerImpl): runs commands with vanilla error reporting, broadcasts chat,
 * answers suggestion requests and enforces bans / the whitelist at login.
 */
import type { GameServer, ServerOptions } from '../server';
import type { C2S } from '@shared/protocol/packets';
import type { ServerPlayer } from '../player';
import { CommandDispatcher } from './dispatcher';
import { CommandSyntaxError } from './reader';
import { AccessControl } from './access';
import { CommandError, CommandSource, plainText, type CommandOutput, type TextComponent } from './source';
import { registerVanillaCommands } from './vanilla';
import { encodeS2C } from '@shared/protocol/packets';

export { commandHooks } from './hooks';
export type { AccessStore } from './access';

export class Commands {
  readonly dispatcher = new CommandDispatcher<CommandSource>();
  readonly access = new AccessControl();
  /** Server console output (the dedicated server prints it; tests capture it). */
  consoleLines: string[] = [];
  onConsoleMessage: ((line: string) => void) | null = null;
  /** /stop on the dedicated server */
  onStop: (() => void) | null = null;
  readonly console: CommandOutput = {
    sendMessage: (m) => {
      const line = plainText(m);
      this.consoleLines.push(line);
      if (this.consoleLines.length > 200) this.consoleLines.shift();
      this.onConsoleMessage?.(line);
    },
    acceptsSuccess: () => true,
    acceptsFailure: () => true,
    shouldInformAdmins: () => this.server.gameRules.logAdminCommands,
  };
  /** server.properties max-players (8 for an integrated server like vanilla) */
  maxPlayers = 8;

  /** keep-alive bookkeeping and measured latency per player (vanilla ServerPlayer.latency) */
  private readonly spam = new WeakMap<ServerPlayer, number>();
  private readonly pings = new WeakMap<ServerPlayer, { pending: number | null; sentAt: number; latency: number }>();

  constructor(readonly server: GameServer) {
    registerVanillaCommands(this.dispatcher);
  }

  configure(opts: ServerOptions): void {
    this.access.cheats = opts.cheats ?? true;
    this.access.dedicated = !!opts.dedicated;
    if (opts.access) this.access.setStore(opts.access);
    if (opts.dedicated) this.maxPlayers = 20;
  }

  /** Command-system packets from a player. */
  handlePacket(p: ServerPlayer, m: C2S): void {
    if (m.t === 'commandSuggest') this.suggest(p, m.id, m.text.slice(0, 32500));
    else if (m.t === 'keepAlive') {
      // ServerGamePacketListenerImpl.handleKeepAlive: latency = (latency * 3 + rtt) / 4
      const st = this.pings.get(p);
      if (st && st.pending === m.id) {
        const rtt = Math.max(0, Date.now() - st.sentAt);
        st.latency = Math.round((st.latency * 3 + rtt) / 4);
        st.pending = null;
      }
    }
  }

  latency(p: ServerPlayer): number {
    return this.pings.get(p)?.latency ?? 0;
  }

  /** Per tick: keep-alives every 15 s, latency broadcast every 600 ticks (PlayerList.tick). */
  tick(): void {
    const s = this.server;
    const now = Date.now();
    for (const p of s.players) {
      const spam = this.spam.get(p);
      if (spam) this.spam.set(p, spam - 1);
      let st = this.pings.get(p);
      if (!st) {
        st = { pending: null, sentAt: 0, latency: 0 };
        this.pings.set(p, st);
      }
      if (st.pending === null && now - st.sentAt >= 15000) {
        st.pending = now;
        st.sentAt = now;
        s.send(p, { t: 'keepAlive', id: now });
      }
    }
    if (s.gameTime % 600 === 0 || s.gameTime === 20) {
      for (const p of s.players) {
        const latency = this.latency(p);
        for (const o of s.players) s.send(o, { t: 'playerLatency', id: p.id, latency });
      }
    }
  }

  sourceFor(p: ServerPlayer): CommandSource {
    return CommandSource.forPlayer(this.server, p, this.access.permissionLevel(p));
  }

  consoleSource(): CommandSource {
    const [x, y, z] = this.server.worldSpawn;
    return new CommandSource(this.server, this.console, x + 0.5, y, z + 0.5, 0, 0, 4, 'Server', null);
  }

  /** Commands.performCommand: run `command` (without the leading slash). Returns the result (0 on failure). */
  perform(src: CommandSource, command: string): number {
    if (command.startsWith('/')) command = command.slice(1);
    try {
      const parse = this.dispatcher.parse(command, src);
      return this.dispatcher.execute(parse, src);
    } catch (e) {
      if (e instanceof CommandSyntaxError) {
        src.sendFailure(e.message);
        if (e.input !== null && e.cursor >= 0) {
          const j = Math.min(e.input.length, e.cursor);
          const ctx: TextComponent = { text: '', color: 'gray', clickEvent: { action: 'suggest_command', value: `/${command}` }, extra: [] };
          if (j > 10) ctx.extra!.push('...');
          ctx.extra!.push(e.input.slice(Math.max(0, j - 10), j));
          if (j < e.input.length) ctx.extra!.push({ text: e.input.slice(j), color: 'red', underlined: true });
          ctx.extra!.push({ text: '<--[HERE]', color: 'red', italic: true });
          src.sendFailure(ctx);
        }
        return 0;
      }
      if (e instanceof CommandError) {
        src.sendFailure(e.message);
        return 0;
      }
      console.error('Command exception:', command, e);
      src.sendFailure({ text: 'An unexpected error occurred trying to execute that command', hoverEvent: { action: 'show_text', contents: String((e as Error).message) } });
      return 0;
    }
  }

  /** Chat packet from a player: a command, or a "<name> message" line for everyone. */
  handleChat(p: ServerPlayer, message: string): void {
    // vanilla: StringUtils.normalizeSpace, 256 characters
    const msg = message.trim().replace(/\s+/g, ' ').slice(0, 256);
    if (!msg) return;
    // ServerGamePacketListenerImpl.chatSpamTickCount: +20 per line, kicked above 200 unless op
    const spam = (this.spam.get(p) ?? 0) + 20;
    this.spam.set(p, spam);
    if (spam > 200 && !this.access.isOp(p)) {
      this.kick(p, 'Kicked for spamming');
      return;
    }
    if (msg.startsWith('/')) {
      this.perform(this.sourceFor(p), msg.slice(1));
      return;
    }
    // § is not allowed in chat (ServerGamePacketListenerImpl: "Illegal characters in chat")
    if (/[\u0000-\u001f\u007f§]/.test(msg)) {
      this.kick(p, 'Illegal characters in chat');
      return;
    }
    this.broadcast({ text: '', extra: [`<${p.name}> `, msg] });
  }

  private disconnectPacket(reason: string): ArrayBuffer {
    return encodeS2C({ t: 'disconnect', reason });
  }

  /** PlayerList.broadcastMessage: every player and the console. */
  broadcast(m: TextComponent): void {
    const json = JSON.stringify(m);
    for (const o of this.server.players) this.server.send(o, { t: 'chat', json });
    this.console.sendMessage(m);
  }

  /** A command suggestion request (vanilla ServerboundCommandSuggestionPacket). */
  suggest(p: ServerPlayer, id: number, text: string): void {
    const src = this.sourceFor(p);
    const input = text.startsWith('/') ? text.slice(1) : text;
    const offset = text.length - input.length;
    const res = this.dispatcher.suggest(input, src);
    let usage: string[] = [];
    if (!res.list.length) {
      // CommandSuggestions.fillNodeUsage: the usage of the node being typed
      const u = this.dispatcher.smartUsage(res.parent, src);
      usage = [...u.values()];
    }
    const parse = this.dispatcher.parse(input, src);
    let error: { message: string; at: number } | null = null;
    if (parse.reader.canRead() && parse.errors.size) {
      const e = [...parse.errors.values()][0]!;
      error = { message: e.message, at: e.cursor + offset };
    }
    // argument ranges and the unparsed tail for the chat box colouring (CommandSuggestions.formatText)
    const args = parse.nodes.filter((n) => n.node.kind === 'argument').map((n) => [n.start + offset, n.end + offset]);
    const unparsed = parse.reader.canRead() ? parse.reader.cursor + offset : -1;
    const json = JSON.stringify({ start: res.start + offset, list: res.list.slice(0, 200), usage: usage.slice(0, 20), error, parsedTo: parse.reader.cursor + offset, args, unparsed });
    this.server.send(p, { t: 'commandSuggestions', id, json });
  }

  /** Login check: the disconnect reason, or null. */
  loginCheck(name: string, address: string | undefined): string | null {
    const r = this.access.loginCheck(name, address);
    if (r) return r;
    if (this.server.players.some((o) => o.name.toLowerCase() === name.toLowerCase())) return null;
    if (this.server.opts.dedicated && this.server.players.length >= this.maxPlayers && !this.access.opEntry(name)?.bypassesPlayerLimit) return 'The server is full!';
    return null;
  }

  joined(p: ServerPlayer): void {
    this.broadcast({ text: `${p.name} joined the game`, color: 'yellow' });
    this.sendOpLevel(p);
  }

  left(p: ServerPlayer): void {
    this.broadcast({ text: `${p.name} left the game`, color: 'yellow' });
  }

  /** ServerPlayer op level entity event (24 + level) so the client knows if it may use F3+N etc. */
  sendOpLevel(p: ServerPlayer): void {
    this.server.send(p, { t: 'entityEvent', id: p.id, event: 24 + Math.min(4, this.access.permissionLevel(p)) });
  }

  /** Disconnect a player with a reason (kick/ban). */
  kick(p: ServerPlayer, reason: string): void {
    p.conn.send(this.disconnectPacket(reason));
    p.conn.close(reason);
    this.server.disconnect(p.conn);
  }
}
