/**
 * Rebindable key mappings (vanilla Options.keyMappings): ids, display names, categories and
 * default keys. Keys are KeyboardEvent.code values or "Mouse0".."Mouse4" for mouse buttons.
 */
import type { Input } from './input';

export interface KeyMappingDef {
  id: string;
  name: string;
  category: 'movement' | 'gameplay' | 'inventory' | 'creative' | 'multiplayer' | 'misc';
  key: string;
}

export const CATEGORY_NAMES: Record<KeyMappingDef['category'], string> = {
  movement: 'Movement',
  gameplay: 'Gameplay',
  inventory: 'Inventory',
  creative: 'Creative Mode',
  multiplayer: 'Multiplayer',
  misc: 'Miscellaneous',
};
const CATEGORY_ORDER = ['movement', 'gameplay', 'inventory', 'creative', 'multiplayer', 'misc'];

export const KEY_MAPPINGS: KeyMappingDef[] = [
  { id: 'attack', name: 'Attack/Destroy', category: 'gameplay', key: 'Mouse0' },
  { id: 'use', name: 'Use Item/Place Block', category: 'gameplay', key: 'Mouse2' },
  { id: 'forward', name: 'Walk Forwards', category: 'movement', key: 'KeyW' },
  { id: 'left', name: 'Strafe Left', category: 'movement', key: 'KeyA' },
  { id: 'back', name: 'Walk Backwards', category: 'movement', key: 'KeyS' },
  { id: 'right', name: 'Strafe Right', category: 'movement', key: 'KeyD' },
  { id: 'jump', name: 'Jump', category: 'movement', key: 'Space' },
  { id: 'sneak', name: 'Sneak', category: 'movement', key: 'ShiftLeft' },
  { id: 'sprint', name: 'Sprint', category: 'movement', key: 'ControlLeft' },
  { id: 'drop', name: 'Drop Selected Item', category: 'inventory', key: 'KeyQ' },
  { id: 'inventory', name: 'Open/Close Inventory', category: 'inventory', key: 'KeyE' },
  { id: 'chat', name: 'Open Chat', category: 'multiplayer', key: 'KeyT' },
  { id: 'playerlist', name: 'List Players', category: 'multiplayer', key: 'Tab' },
  { id: 'pickItem', name: 'Pick Block', category: 'gameplay', key: 'Mouse1' },
  { id: 'command', name: 'Open Command', category: 'multiplayer', key: 'Slash' },
  { id: 'socialInteractions', name: 'Social Interactions Screen', category: 'multiplayer', key: 'KeyP' },
  { id: 'screenshot', name: 'Take Screenshot', category: 'misc', key: 'F2' },
  { id: 'togglePerspective', name: 'Toggle Perspective', category: 'misc', key: 'F5' },
  { id: 'smoothCamera', name: 'Toggle Cinematic Camera', category: 'misc', key: '' },
  { id: 'fullscreen', name: 'Toggle Fullscreen', category: 'misc', key: 'F11' },
  { id: 'spectatorOutlines', name: 'Highlight Players (Spectators)', category: 'misc', key: '' },
  { id: 'swapOffhand', name: 'Swap Item With Offhand', category: 'inventory', key: 'KeyF' },
  { id: 'saveToolbarActivator', name: 'Save Toolbar Activator', category: 'creative', key: 'KeyC' },
  { id: 'loadToolbarActivator', name: 'Load Toolbar Activator', category: 'creative', key: 'KeyX' },
  { id: 'advancements', name: 'Advancements', category: 'misc', key: 'KeyL' },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `hotbar.${i + 1}`, name: `Hotbar Slot ${i + 1}`, category: 'inventory' as const, key: `Digit${i + 1}` })),
];

/** Sorted like vanilla KeyBindsList (category order, then name). */
export function sortedMappings(): KeyMappingDef[] {
  return [...KEY_MAPPINGS].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
}

const NAMED: Record<string, string> = {
  Mouse0: 'Left Button', Mouse1: 'Middle Button', Mouse2: 'Right Button', Mouse3: 'Button 4', Mouse4: 'Button 5',
  Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Control', ControlRight: 'Right Control',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Win', MetaRight: 'Right Win', Tab: 'Tab', Enter: 'Enter',
  Backspace: 'Backspace', Escape: 'Escape', CapsLock: 'Caps Lock', Slash: '/', Backslash: '\\', Period: '.', Comma: ',',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow', Insert: 'Insert',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
};

/** Display name of a key code (vanilla InputConstants key names). */
export function keyName(code: string): string {
  if (!code) return 'Not Bound';
  if (NAMED[code]) return NAMED[code]!;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Keypad ${code.slice(6)}`;
  return code;
}

/** Live key state through the user's bindings (incl. toggle sneak/sprint). */
export class KeyBindings {
  private toggled = new Set<string>();
  constructor(
    private input: Input,
    private settings: () => { keys: Record<string, string>; toggleCrouch: boolean; toggleSprint: boolean },
  ) {}

  private get toggles(): { sneak: boolean; sprint: boolean } {
    const s = this.settings();
    return { sneak: s.toggleCrouch, sprint: s.toggleSprint };
  }

  key(id: string): string {
    return this.settings().keys[id] ?? KEY_MAPPINGS.find((k) => k.id === id)?.key ?? '';
  }

  /** Held (or toggled on for toggle-sneak/sprint). */
  down(id: string): boolean {
    if ((id === 'sneak' && this.toggles.sneak) || (id === 'sprint' && this.toggles.sprint)) return this.toggled.has(id);
    const k = this.key(id);
    return !!k && this.input.isDown(k);
  }

  /** Pressed since last check (consumed). */
  consume(id: string): boolean {
    const k = this.key(id);
    return !!k && this.input.consumePress(k);
  }

  /** Per tick: flip toggle keys on press (vanilla ToggleKeyMapping). */
  tick(): void {
    for (const id of ['sneak', 'sprint'] as const) {
      if (!this.toggles[id]) {
        this.toggled.delete(id);
        continue;
      }
      if (this.consume(id)) {
        if (this.toggled.has(id)) this.toggled.delete(id);
        else this.toggled.add(id);
      }
    }
  }

  reset(): void {
    this.toggled.clear();
  }
}
