/**
 * Minimal SNBT (stringified NBT) parser for command arguments such as
 * `potion{Potion:"minecraft:healing"}` or `diamond_sword{Enchantments:[{id:"sharpness",lvl:5s}]}`.
 * Compounds become objects, lists/arrays become arrays, numbers drop their type suffix.
 */
export function parseSnbt(s: string): unknown {
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const err = (m: string) => new Error(`${m} at position ${i}`);
  const quoted = (): string => {
    const q = s[i++]!;
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') i++;
      out += s[i++];
    }
    if (s[i] !== q) throw err('Unterminated string');
    i++;
    return out;
  };
  const bare = (): string => {
    const st = i;
    while (i < s.length && /[0-9A-Za-z_\-.+]/.test(s[i]!)) i++;
    if (st === i) throw err('Expected value');
    return s.slice(st, i);
  };
  const value = (): unknown => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      const o: Record<string, unknown> = {};
      ws();
      if (s[i] === '}') {
        i++;
        return o;
      }
      for (;;) {
        ws();
        const k = s[i] === '"' || s[i] === "'" ? quoted() : bare();
        ws();
        if (s[i++] !== ':') throw err("Expected ':'");
        o[k] = value();
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i++] !== '}') throw err("Expected '}'");
        return o;
      }
    }
    if (c === '[') {
      i++;
      ws();
      // typed arrays [B; …], [I; …], [L; …]
      if (/[BIL]/.test(s[i] ?? '') && s[i + 1] === ';') i += 2;
      const a: unknown[] = [];
      ws();
      if (s[i] === ']') {
        i++;
        return a;
      }
      for (;;) {
        a.push(value());
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i++] !== ']') throw err("Expected ']'");
        return a;
      }
    }
    if (c === '"' || c === "'") return quoted();
    const b = bare();
    if (b === 'true') return 1;
    if (b === 'false') return 0;
    const m = b.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([bBsSlLfFdD]?)$/);
    if (m) return Number(m[1]);
    return b;
  };
  const v = value();
  ws();
  if (i < s.length) throw err('Trailing data');
  return v;
}

/** Normalise parsed item NBT into Blockcraft's ItemTag shape (namespaces stripped from ids). */
export function itemTagFromSnbt(text: string): Record<string, unknown> | undefined {
  const raw = parseSnbt(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const strip = (v: unknown) => (typeof v === 'string' ? v.replace(/^minecraft:/, '') : v);
  for (const k of ['Enchantments', 'StoredEnchantments']) {
    if (Array.isArray(o[k])) o[k] = (o[k] as Record<string, unknown>[]).filter((e) => e && typeof e === 'object').map((e) => ({ id: strip(e.id), lvl: Number(e.lvl ?? 1) }));
  }
  if (typeof o.Potion === 'string') o.Potion = strip(o.Potion);
  const disp = o.display as Record<string, unknown> | undefined;
  if (disp && typeof disp.Name === 'string') {
    // display.Name is a JSON text component; keep its plain text
    try {
      const j = JSON.parse(disp.Name) as unknown;
      disp.Name = typeof j === 'string' ? j : ((j as { text?: string })?.text ?? disp.Name);
    } catch {
      // leave as is
    }
  }
  return o;
}
