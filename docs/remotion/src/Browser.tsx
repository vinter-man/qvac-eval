import React from 'react';
import { Img, staticFile } from 'remotion';
import { ink, ink2, mono, paper, sans } from './theme';

export const Browser: React.FC<{
  file: string;
  title: string;
  width: number;
  height?: number;
  offset?: number;
  scale?: number;
}> = ({ file, title, width, height, offset = 0, scale = 1 }) => (
  <div style={{ width, background: paper, border: `1px solid ${ink}` }}>
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '12px 18px',
        borderBottom: `1px solid ${ink}`,
        fontFamily: sans,
        fontSize: 18,
        fontWeight: 500,
        letterSpacing: '-0.01em',
      }}
    >
      <span>Report</span>
      <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 400, color: ink2 }}>{title}</span>
    </div>
    <div style={{ width: width - 2, height, overflow: 'hidden', position: 'relative' }}>
      <Img
        src={staticFile(`shots/${file}`)}
        style={{
          width: (width - 2) * scale,
          display: 'block',
          transform: `translateY(${-offset}px)`,
        }}
      />
    </div>
  </div>
);
