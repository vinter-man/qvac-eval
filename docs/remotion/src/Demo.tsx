import React from 'react';
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from 'remotion';
import { Browser } from './Browser';
import terminals from './data/terminals.json';
import { Fonts } from './Fonts';
import { Terminal } from './Terminal';
import { paper } from './theme';

export const FPS = 30;
export const DEMO = { width: 1000, height: 640 };

const run = terminals.completion;
const COMMAND = run.command;
const TYPE_FROM = 12;
const TYPE_TO = TYPE_FROM + 36;
const OUTPUT_FROM = TYPE_TO + 12;
const PER_LINE = 2;
const OUTPUT_END = OUTPUT_FROM + run.lines.length * PER_LINE;
const REPORT_FROM = OUTPUT_END + 36;
const REPORT_LENGTH = Math.round(4.2 * FPS);
const COMPARE_FROM = REPORT_FROM + REPORT_LENGTH;
const COMPARE_LENGTH = Math.round(4.2 * FPS);
export const DEMO_FRAMES = COMPARE_FROM + COMPARE_LENGTH + 12;

const fade = (frame: number, start: number, length = 8) =>
  interpolate(frame, [start, start + length], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const TerminalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = COMMAND.slice(
    0,
    Math.floor(
      interpolate(frame, [TYPE_FROM, TYPE_TO], [0, COMMAND.length], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    ),
  );
  const shown = Math.max(0, Math.floor((frame - OUTPUT_FROM) / PER_LINE));
  const visible = run.lines.slice(0, shown);
  const rows = 22;
  const hidden = Math.max(0, visible.length - rows);
  return (
    <AbsoluteFill style={{ background: paper, padding: 28 }}>
      <div
        style={{ height: DEMO.height - 56, overflow: 'hidden', border: '1px solid transparent' }}
      >
        <Terminal
          title={run.title}
          width={DEMO.width - 56}
          fontSize={14}
          command={typed}
          cursor={frame < OUTPUT_FROM}
          lines={visible.slice(hidden)}
        />
      </div>
    </AbsoluteFill>
  );
};

const PanScene: React.FC<{ file: string; title: string; travel: number }> = ({
  file,
  title,
  travel,
}) => {
  const frame = useCurrentFrame();
  const offset = interpolate(frame, [24, REPORT_LENGTH - 8], [0, travel], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => t * t * (3 - 2 * t),
  });
  return (
    <AbsoluteFill style={{ background: paper, padding: 28, opacity: fade(frame, 0) }}>
      <Browser
        file={file}
        title={title}
        width={DEMO.width - 56}
        height={DEMO.height - 56 - 50}
        offset={offset}
      />
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => (
  <Fonts>
    <AbsoluteFill style={{ background: paper }}>
      <Sequence from={0} durationInFrames={REPORT_FROM}>
        <TerminalScene />
      </Sequence>
      <Sequence from={REPORT_FROM} durationInFrames={REPORT_LENGTH}>
        <PanScene
          file="report-full.png"
          title="completion.0.22.0.html"
          travel={Math.min(terminals.travel.report, 560)}
        />
      </Sequence>
      <Sequence from={COMPARE_FROM} durationInFrames={COMPARE_LENGTH + 12}>
        <PanScene
          file="compare-full.png"
          title="SDK 0.21.1 to 0.22.0"
          travel={Math.min(terminals.travel.compare, 520)}
        />
      </Sequence>
    </AbsoluteFill>
  </Fonts>
);
