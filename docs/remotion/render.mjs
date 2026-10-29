import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const OUT = '../assets';
const TMP = 'out';
const data = JSON.parse(readFileSync('src/data/terminals.json', 'utf8'));

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

run('npx', ['remotion', 'still', 'banner', `${OUT}/banner.png`, '--log=error']);
run('npx', ['remotion', 'still', 'pipeline', `${OUT}/pipeline.png`, '--log=error']);
run('npx', ['remotion', 'still', 'phones', `${OUT}/phones.png`, '--log=error']);
for (const name of ['completion', 'hard']) {
  run('npx', [
    'remotion',
    'still',
    `terminal-${name}`,
    `${OUT}/terminal-${name}.png`,
    '--log=error',
  ]);
}
for (const capture of data.captures) {
  run('npx', [
    'remotion',
    'still',
    `shot-${capture.id}`,
    `${OUT}/${capture.id}.png`,
    '--log=error',
  ]);
}

run('npx', [
  'remotion',
  'render',
  'demo',
  `${TMP}/demo.mp4`,
  '--log=error',
  '--codec=h264',
  '--crf=16',
]);
const FILTER = 'fps=10,scale=720:-1:flags=lanczos';
run('ffmpeg', [
  '-y',
  '-v',
  'error',
  '-i',
  `${TMP}/demo.mp4`,
  '-vf',
  `${FILTER},palettegen=max_colors=64:stats_mode=diff`,
  `${TMP}/palette.png`,
]);
run('ffmpeg', [
  '-y',
  '-v',
  'error',
  '-i',
  `${TMP}/demo.mp4`,
  '-i',
  `${TMP}/palette.png`,
  '-lavfi',
  `${FILTER}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
  `${OUT}/demo.gif`,
]);

console.log('\nWrote', OUT);
