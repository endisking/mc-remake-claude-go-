import { decode, RATE } from './soundgen/audio';
const ids = process.argv.slice(2);
for (const id of ids) {
  const s = decode(`/home/user/mc-remake-claude-go-/.claude/worktrees/agent-a2bb308e9f2214fd4/tools/soundgen/cache/fs_${id}.ogg`);
  let peakAt = 0;
  for (let i = 0; i < s.length; i++) if (Math.abs(s[i]!) > Math.abs(s[peakAt]!)) peakAt = i;
  const start = Math.min(peakAt + 900, s.length - 8192);
  const N = 8192;
  const res: [number, number][] = [];
  for (let f = 40; f <= 4000; f += 1) {
    let re = 0, im = 0;
    const w = (2 * Math.PI * f) / RATE;
    for (let i = 0; i < N; i++) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      const v = s[start + i]! * win;
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
    }
    res.push([f, Math.hypot(re, im)]);
  }
  // local maxima, top 5
  const peaks = res.filter((r, i) => i > 0 && i < res.length - 1 && r[1] > res[i - 1]![1] && r[1] >= res[i + 1]![1]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const top = peaks[0]![1];
  console.log(id, peaks.map(([f, m]) => `${f}Hz(${(m / top).toFixed(2)})`).join(' '));
}
