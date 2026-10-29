import React from 'react';
import { AbsoluteFill } from 'remotion';
import chart from './data/chart.json';
import { Fonts } from './Fonts';
import { ink, ink2, line, mono, paper, sans } from './theme';

export const BANNER = { width: 1600, height: 800 };

type Row = { model: string; older: number; newer: number };
const rows = chart.rows as Row[];
const ceiling = Math.max(...rows.flatMap((row) => [row.older, row.newer])) * 1.08;

const Bar: React.FC<{ value: number; hatch: boolean; width: number }> = ({
  value,
  hatch,
  width,
}) => (
  <svg width={width} height={24} style={{ display: 'block' }}>
    {[0.25, 0.5, 0.75, 1].map((tick) => (
      <line key={tick} x1={width * tick} x2={width * tick} y1={0} y2={24} stroke={line} />
    ))}
    <rect
      x={1}
      y={3}
      width={Math.max(2, (value / ceiling) * width)}
      height={18}
      fill={hatch ? 'url(#hatch)' : ink}
      stroke={ink}
      strokeWidth={1.6}
    />
  </svg>
);

export const Banner: React.FC = () => (
  <Fonts>
    <AbsoluteFill style={{ background: paper, color: ink, fontFamily: sans, padding: '44px 56px' }}>
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          <pattern
            id="hatch"
            width={5}
            height={5}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={2.2} height={5} fill={ink} />
          </pattern>
        </defs>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 56, fontWeight: 500, letterSpacing: '-0.025em' }}>qvac-eval</div>
        <div style={{ fontSize: 56, fontWeight: 500, letterSpacing: '-0.025em' }}>
          SDK {chart.older} → {chart.newer}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 72, marginTop: 56 }}>
        <div style={{ flex: '0 0 640px' }}>
          <div
            style={{
              fontSize: 100,
              lineHeight: 0.92,
              fontWeight: 500,
              letterSpacing: '-0.055em',
            }}
          >
            Did the model still answer?
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 21,
              lineHeight: 1.6,
              color: ink2,
              marginTop: 32,
              maxWidth: 600,
            }}
          >
            Regression tests for local models on @qvac/sdk. YAML cases, golden outputs, tokens per
            second and one HTML report that works offline.
          </div>
        </div>
        <div style={{ flex: 1, paddingTop: 12 }}>
          <div style={{ fontFamily: mono, fontSize: 17, color: ink2, marginBottom: 20 }}>
            Generation speed on CPU, tokens per second
          </div>
          {rows.map((row) => (
            <div
              key={row.model}
              style={{
                display: 'grid',
                gridTemplateColumns: '190px 440px 90px',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <div style={{ fontFamily: mono, fontSize: 18, gridRow: 'span 2' }}>{row.model}</div>
              <Bar value={row.older} hatch width={440} />
              <div style={{ fontFamily: mono, fontSize: 18, textAlign: 'right' }}>
                {Math.round(row.older)}
              </div>
              <Bar value={row.newer} hatch={false} width={440} />
              <div style={{ fontFamily: mono, fontSize: 18, textAlign: 'right' }}>
                {Math.round(row.newer)}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 28, fontFamily: mono, fontSize: 17, marginTop: 26 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <svg width={22} height={14}>
                <rect
                  x={1}
                  y={1}
                  width={20}
                  height={12}
                  fill="url(#hatch)"
                  stroke={ink}
                  strokeWidth={1.6}
                />
              </svg>
              SDK {chart.older}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <svg width={22} height={14}>
                <rect
                  x={1}
                  y={1}
                  width={20}
                  height={12}
                  fill={ink}
                  stroke={ink}
                  strokeWidth={1.6}
                />
              </svg>
              SDK {chart.newer}
            </span>
          </div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 56,
          right: 56,
          bottom: 44,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <div style={{ fontSize: 56, fontWeight: 500, letterSpacing: '-0.025em' }}>Run workflow</div>
        <div style={{ fontSize: 56, fontWeight: 500, letterSpacing: '-0.025em' }}>
          Read the report →
        </div>
      </div>
    </AbsoluteFill>
  </Fonts>
);
