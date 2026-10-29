import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Browser } from './Browser';
import terminals from './data/terminals.json';
import { Fonts } from './Fonts';
import { Terminal } from './Terminal';
import { ink, paper, sans } from './theme';

export const SHOT_WIDTH = 1100;
export const FRAME_HEADER = 50;

export type Capture = { id: string; file: string; title: string; offset: number; height: number };

export const captures: Capture[] = terminals.captures;

export const terminalShots = ['completion', 'hard'] as const;
export type TerminalShot = (typeof terminalShots)[number];

export const terminalHeight = (name: TerminalShot): number =>
  Math.ceil(terminals[name].lines.length * 14.5 * 1.55 + 130);

export const TerminalShotView: React.FC<{ name: TerminalShot }> = ({ name }) => (
  <Fonts>
    <AbsoluteFill style={{ background: paper }}>
      <Terminal
        title={terminals[name].title}
        width={SHOT_WIDTH}
        fontSize={14.5}
        command={terminals[name].command}
        lines={terminals[name].lines}
      />
    </AbsoluteFill>
  </Fonts>
);

export const CaptureView: React.FC<{ capture: Capture }> = ({ capture }) => (
  <Fonts>
    <AbsoluteFill style={{ background: paper }}>
      <Browser
        file={capture.file}
        title={capture.title}
        width={SHOT_WIDTH}
        height={capture.height}
        offset={capture.offset}
      />
    </AbsoluteFill>
  </Fonts>
);

export const PHONE_SHOT = { width: 1100, height: 830 };
const phones = [
  { file: 'phone-1.png', caption: 'The verdict' },
  { file: 'phone-2.png', caption: 'A failure and its diff' },
  { file: 'phone-3.png', caption: 'Night, two SDKs' },
];

export const PhonesView: React.FC = () => (
  <Fonts>
    <AbsoluteFill
      style={{
        background: paper,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        padding: '0 4px',
      }}
    >
      {phones.map((phone) => (
        <div key={phone.file} style={{ width: 348 }}>
          <div style={{ border: `1px solid ${ink}`, width: 348, height: 752, overflow: 'hidden' }}>
            <Img src={staticFile(`shots/${phone.file}`)} style={{ width: 346, display: 'block' }} />
          </div>
          <div
            style={{
              fontFamily: sans,
              fontSize: 26,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              marginTop: 16,
            }}
          >
            {phone.caption}
          </div>
        </div>
      ))}
    </AbsoluteFill>
  </Fonts>
);
