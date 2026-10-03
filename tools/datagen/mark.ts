/** Mark FEATURES.md items done by id prefix match: tsx tools/datagen/mark.ts <id> [<id>...] */
import { readFileSync, writeFileSync } from 'node:fs';
const ids = process.argv.slice(2);
const file = new URL('../../FEATURES.md', import.meta.url);
let text = readFileSync(file, 'utf8');
let n = 0;
for (const id of ids) {
  const re = new RegExp(`^- \\[ \\] (.*<!--${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*-->)$`, 'gm');
  text = text.replace(re, (_m, rest) => {
    n++;
    return `- [x] ${rest}`;
  });
}
const total = (text.match(/^- \[[ x]\] /gm) ?? []).length, done = (text.match(/^- \[x\] /gm) ?? []).length;
text = text.replace(/\*\*Progress: \d+ \/ \d+\*\*/, `**Progress: ${done} / ${total}**`);
writeFileSync(file, text);
console.log(`marked ${n}; progress ${done}/${total}`);
