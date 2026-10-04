import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { blockNameOf } from '@shared/world/blockstate';
const g = new OverworldGenerator(20211n);
const n = 8, size = n * 16, Y = Number(process.argv[2] ?? 31);
const png = new PNG({ width: size, height: size });
for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
  const c = g.generate(cx - 2, cz - 2);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const nm = blockNameOf(c.getState(x, Y, z));
    const col = nm === 'cave_air' ? [255, 255, 255] : nm === 'air' ? [200, 200, 255] : nm === 'water' ? [40, 60, 200] : nm === 'lava' ? [255, 120, 0] : nm === 'stone' ? [90, 90, 90] : [150, 100, 60];
    const i = ((cz * 16 + z) * size + cx * 16 + x) * 4;
    png.data.set([...col, 255], i);
  }
}
writeFileSync('/tmp/claude-0/-home-user-mc-remake-claude-go-/5cfbaffb-14dd-591a-bbd7-1fade5b49b91/scratchpad/slice.png', PNG.sync.write(png));
