import React from 'react';
import { ink, ink2, line, mono, paper, sans } from './theme';

const FIGURE = /^(\s*)([✓✕▲!])(\s)/u;

export const Terminal: React.FC<{
  title: string;
  lines: string[];
  command?: string;
  width: number;
  fontSize?: number;
  cursor?: boolean;
}> = ({ title, lines, command, width, fontSize = 15, cursor = false }) => (
  <div
    style={{
      width,
      background: paper,
      border: `1px solid ${ink}`,
      fontFamily: mono,
      color: ink,
    }}
  >
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
      <span>Terminal</span>
      <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 400, color: ink2 }}>{title}</span>
    </div>
    <pre
      style={{
        margin: 0,
        padding: '18px 22px 22px',
        fontFamily: mono,
        fontSize,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      {command === undefined ? null : (
        <div>
          <span style={{ color: ink2 }}>$ </span>
          {command}
          {cursor ? <span style={{ background: ink, marginLeft: 2 }}>&nbsp;</span> : null}
        </div>
      )}
      {lines.map((text, index) => {
        const matched = FIGURE.exec(text);
        const bold = matched !== null && matched[2] !== '✓';
        const muted =
          text.startsWith('  loaded') ||
          /^\s+(p50|\d+ tok\/s)/u.test(text) ||
          text.startsWith('Wrote');
        return (
          <div
            key={index}
            style={{
              fontWeight: bold || text.startsWith('Result') ? 500 : 400,
              color: muted ? ink2 : ink,
              minHeight: fontSize * 1.55,
              borderBottom: text === '' ? 'none' : undefined,
              borderTop: text.startsWith('Result') ? `1px solid ${line}` : undefined,
              marginTop: text.startsWith('Result') ? 8 : 0,
              paddingTop: text.startsWith('Result') ? 8 : 0,
            }}
          >
            {text}
          </div>
        );
      })}
    </pre>
  </div>
);
