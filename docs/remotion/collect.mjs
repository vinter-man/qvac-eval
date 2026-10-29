import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TXT = 'out';
const REPORTS = '../../reports/demo';
const SHOTS = 'public/shots';

const lines = (name) =>
  readFileSync(join(TXT, `${name}.txt`), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .filter((line, index, all) => !(line === '' && index === all.length - 1));

const terminal = (name, title, command) => {
  const body = lines(name);
  const start = body.findIndex((line) => line.startsWith('qvac-eval'));
  return { title, command, lines: body.slice(start) };
};

const reports = readdirSync(REPORTS)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(REPORTS, file), 'utf8')));
const bySdk = (version) =>
  reports.find(
    (report) => report.suite.name === 'completion' && report.environment.sdk.version === version,
  );
const older = bySdk('0.21.1');
const newer = bySdk('0.22.0');
const rows = newer.models
  .filter((run) => run.perf?.tokensPerSecond !== undefined)
  .map((run) => ({
    model: run.model.id,
    older: older.models.find((candidate) => candidate.model.id === run.model.id).perf
      .tokensPerSecond,
    newer: run.perf.tokensPerSecond,
  }));

const sizes = JSON.parse(readFileSync(join(TXT, 'sizes.json'), 'utf8'));
const DEMO_SCALE = (1000 - 56 - 2) / 1440;
const travel = (file) => Math.max(0, Math.round(sizes[file].height * DEMO_SCALE - (640 - 56 - 50)));

const data = {
  completion: terminal(
    'completion',
    'cases/completion.yaml',
    'qvac-eval run cases/completion.yaml --sdk-version 0.22.0 --repeat 3 --out reports/demo',
  ),
  hard: terminal(
    'hard',
    'cases/hard.yaml',
    'qvac-eval run cases/hard.yaml --sdk-version 0.22.0 --out reports/demo-hard',
  ),
  travel: { report: travel('report-full.png'), compare: travel('compare-full.png') },
  captures: JSON.parse(readFileSync(join(TXT, 'captures.json'), 'utf8')),
};

writeFileSync('src/data/terminals.json', `${JSON.stringify(data, null, 2)}\n`);
writeFileSync(
  'src/data/chart.json',
  `${JSON.stringify({ older: '0.21.1', newer: '0.22.0', rows }, null, 2)}\n`,
);
console.log('collected', Object.keys(data).join(', '), 'and', rows.length, 'chart rows');
