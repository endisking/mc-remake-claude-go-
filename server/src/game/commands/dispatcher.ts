/**
 * A Brigadier-like command dispatcher: a tree of literal and typed argument nodes, parsed
 * greedily the way Mojang's Brigadier does it (a matching literal wins over arguments; the
 * parse that consumes the most input with the fewest errors is used), with suggestions and
 * "smart usage" strings for /help and the chat suggestion box.
 */
import { CommandSyntaxError, StringReader } from './reader';

export interface Suggestion {
  text: string;
  tooltip?: string;
}

/** Collects suggestions for the token starting at `start` (vanilla SuggestionsBuilder). */
export class SuggestionsBuilder {
  readonly list: Suggestion[] = [];
  constructor(
    readonly input: string,
    readonly start: number,
  ) {}
  /** The text typed so far for this token. */
  get remaining(): string {
    return this.input.slice(this.start);
  }
  get remainingLower(): string {
    return this.remaining.toLowerCase();
  }
  suggest(text: string, tooltip?: string): this {
    if (text !== this.remaining) this.list.push(tooltip ? { text, tooltip } : { text });
    return this;
  }
  /** SharedSuggestionProvider.suggest: candidates starting with what was typed. */
  suggestMatching(candidates: Iterable<string>): this {
    const rem = this.remainingLower;
    for (const c of candidates) if (c.toLowerCase().startsWith(rem)) this.suggest(c);
    return this;
  }
  /** SharedSuggestionProvider.suggestResource: ids with or without the minecraft: namespace. */
  suggestResources(paths: Iterable<string>): this {
    const rem = this.remainingLower;
    const ns = rem.includes(':');
    for (const p of paths) {
      const full = `minecraft:${p}`;
      if (ns ? full.startsWith(rem) : p.startsWith(rem) || full.startsWith(rem)) this.suggest(full);
    }
    return this;
  }
}

export interface ArgumentType<T, S> {
  parse(reader: StringReader): T;
  suggest?(builder: SuggestionsBuilder, source: S): void;
  examples?: string[];
}

export class CommandContext<S> {
  constructor(
    readonly source: S,
    readonly input: string,
    readonly args: Map<string, unknown>,
  ) {}
  get<T>(name: string): T {
    if (!this.args.has(name)) throw new Error(`No such argument '${name}' exists on this command`);
    return this.args.get(name) as T;
  }
  has(name: string): boolean {
    return this.args.has(name);
  }
}

export type Command<S> = (ctx: CommandContext<S>) => number;

export class CommandNode<S> {
  children: CommandNode<S>[] = [];
  command: Command<S> | null = null;
  requirement: (s: S) => boolean = () => true;

  constructor(
    readonly kind: 'root' | 'literal' | 'argument',
    readonly name: string,
    readonly type: ArgumentType<unknown, S> | null = null,
  ) {}

  then(child: CommandNode<S>): this {
    // merging same-named literals like Brigadier's addChild
    const existing = this.children.find((c) => c.name === child.name && c.kind === child.kind);
    if (existing) {
      if (child.command) existing.command = child.command;
      for (const g of child.children) existing.then(g);
    } else this.children.push(child);
    return this;
  }
  executes(cmd: Command<S>): this {
    this.command = cmd;
    return this;
  }
  requires(r: (s: S) => boolean): this {
    this.requirement = r;
    return this;
  }
  canUse(s: S): boolean {
    return this.requirement(s);
  }
  get usageText(): string {
    return this.kind === 'literal' ? this.name : `<${this.name}>`;
  }
}

export function literal<S>(name: string): CommandNode<S> {
  return new CommandNode<S>('literal', name);
}
export function argument<S, T>(name: string, type: ArgumentType<T, S>): CommandNode<S> {
  return new CommandNode<S>('argument', name, type as ArgumentType<unknown, S>);
}

interface ParsedNode<S> {
  node: CommandNode<S>;
  start: number;
  end: number;
}

export interface ParseResults<S> {
  input: string;
  nodes: ParsedNode<S>[];
  args: Map<string, unknown>;
  command: Command<S> | null;
  reader: StringReader;
  errors: Map<CommandNode<S>, CommandSyntaxError>;
}

export class CommandDispatcher<S> {
  readonly root = new CommandNode<S>('root', '');

  register(node: CommandNode<S>): CommandNode<S> {
    this.root.then(node);
    return this.root.children.find((c) => c.name === node.name)!;
  }

  /** A literal alias sharing the target's children and command (vanilla .redirect for /tell, /tp, /xp). */
  alias(name: string, target: CommandNode<S>): void {
    const n = literal<S>(name);
    n.children = target.children;
    n.command = target.command;
    n.requirement = target.requirement;
    this.root.children.push(n);
  }

  parse(input: string, source: S): ParseResults<S> {
    const reader = new StringReader(input);
    return this.parseNodes(this.root, reader, source, { input, nodes: [], args: new Map(), command: null, reader, errors: new Map() });
  }

  private parseNodes(node: CommandNode<S>, original: StringReader, source: S, ctx: ParseResults<S>): ParseResults<S> {
    const errors = new Map<CommandNode<S>, CommandSyntaxError>();
    const potentials: ParseResults<S>[] = [];
    const cursor = original.cursor;
    for (const child of this.relevantNodes(node, original)) {
      if (!child.canUse(source)) continue;
      const reader = original.clone();
      const args = new Map(ctx.args);
      try {
        const start = reader.cursor;
        if (child.kind === 'literal') {
          const end = start + child.name.length;
          if (reader.string.slice(start, end) !== child.name || (end < reader.string.length && reader.string[end] !== ' ')) {
            throw reader.error(`Expected literal ${child.name}`);
          }
          reader.cursor = end;
        } else {
          args.set(child.name, child.type!.parse(reader));
        }
        if (reader.canRead() && reader.peek() !== ' ') throw reader.error('Expected whitespace to end one argument, but found trailing data');
        const nodes = [...ctx.nodes, { node: child, start, end: reader.cursor }];
        const here: ParseResults<S> = { input: ctx.input, nodes, args, command: child.command, reader, errors: new Map() };
        if (reader.canRead(2)) {
          reader.skip();
          const sub = this.parseNodes(child, reader, source, here);
          potentials.push(sub);
        } else potentials.push(here);
      } catch (e) {
        if (!(e instanceof CommandSyntaxError)) throw e;
        errors.set(child, e);
        original.cursor = cursor;
      }
    }
    if (!potentials.length) return { ...ctx, reader: original, errors, command: ctx.command };
    potentials.sort((a, b) => {
      const ar = a.reader.canRead(), br = b.reader.canRead();
      if (!ar && br) return -1;
      if (ar && !br) return 1;
      if (!a.errors.size && b.errors.size) return -1;
      if (a.errors.size && !b.errors.size) return 1;
      return 0;
    });
    return potentials[0]!;
  }

  /** Brigadier getRelevantNodes: a literal matching the next word excludes the others. */
  private relevantNodes(node: CommandNode<S>, reader: StringReader): CommandNode<S>[] {
    const rest = reader.remaining;
    const sp = rest.indexOf(' ');
    const word = sp < 0 ? rest : rest.slice(0, sp);
    const lit = node.children.filter((c) => c.kind === 'literal' && c.name === word);
    if (lit.length) return lit;
    return node.children.filter((c) => c.kind === 'argument');
  }

  /** Run a parsed command; throws CommandSyntaxError with vanilla wording when it can't. */
  execute(parse: ParseResults<S>, source: S): number {
    if (parse.reader.canRead()) {
      if (parse.errors.size === 1) throw parse.errors.values().next().value!;
      if (!parse.nodes.length) throw parse.reader.error('Unknown or incomplete command, see below for error');
      throw parse.reader.error('Incorrect argument for command');
    }
    if (!parse.command) throw parse.reader.error('Unknown or incomplete command, see below for error');
    return parse.command(new CommandContext(source, parse.input, parse.args));
  }

  /** Suggestions for the token under the cursor (Brigadier getCompletionSuggestions). */
  suggest(input: string, source: S, cursor = input.length): { start: number; list: Suggestion[]; parent: CommandNode<S> } {
    const parse = this.parse(input.slice(0, cursor), source);
    let parent: CommandNode<S> = this.root, start = 0;
    let found = false;
    let prev: CommandNode<S> = this.root;
    for (const n of parse.nodes) {
      if (n.start <= cursor && cursor <= n.end) {
        parent = prev;
        start = n.start;
        found = true;
        break;
      }
      prev = n.node;
    }
    if (!found && parse.nodes.length) {
      const last = parse.nodes[parse.nodes.length - 1]!;
      parent = last.node;
      start = last.end + 1;
    }
    if (start > cursor) return { start: cursor, list: [], parent };
    const b = new SuggestionsBuilder(input.slice(0, cursor), start);
    for (const c of parent.children) {
      if (!c.canUse(source)) continue;
      if (c.kind === 'literal') {
        if (c.name.toLowerCase().startsWith(b.remainingLower)) b.suggest(c.name);
      } else c.type?.suggest?.(b, source);
    }
    const seen = new Set<string>();
    const list = b.list.filter((s) => !seen.has(s.text) && (seen.add(s.text), true));
    list.sort((a, b2) => (a.text < b2.text ? -1 : a.text > b2.text ? 1 : 0));
    return { start, list, parent };
  }

  /** Brigadier getSmartUsage for each usable child of `node`. */
  smartUsage(node: CommandNode<S>, source: S): Map<CommandNode<S>, string> {
    const out = new Map<CommandNode<S>, string>();
    const optional = !!node.command;
    for (const c of node.children) {
      if (!c.canUse(source)) continue;
      const u = this.usageOf(c, source, optional, false);
      if (u) out.set(c, u);
    }
    return out;
  }

  private usageOf(node: CommandNode<S>, source: S, optional: boolean, deep: boolean): string {
    if (!node.canUse(source)) return '';
    const self = optional ? `[${node.usageText}]` : node.usageText;
    const childOptional = !!node.command;
    const open = childOptional ? '[' : '(', close = childOptional ? ']' : ')';
    if (!deep) {
      const children = node.children.filter((c) => c.canUse(source));
      if (children.length === 1) {
        const u = this.usageOf(children[0]!, source, childOptional, childOptional);
        if (u) return `${self} ${u}`;
      } else if (children.length > 1) {
        const set = new Set<string>();
        for (const c of children) {
          const u = this.usageOf(c, source, childOptional, true);
          if (u) set.add(u);
        }
        if (set.size === 1) {
          const u = [...set][0]!;
          return `${self} ${childOptional ? `[${u}]` : u}`;
        }
        if (set.size > 1) return `${self} ${open}${children.map((c) => c.usageText).join('|')}${close}`;
      }
    }
    return self;
  }
}
