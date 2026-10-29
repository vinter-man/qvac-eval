import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Fonts } from './Fonts';
import { ink, ink2, mono, paper, sans } from './theme';

export const PIPELINE = { width: 1200, height: 640 };

const steps = [
  {
    name: 'Plan',
    lines: [
      'qvac-eval matrix',
      'models × SDK versions × runners',
      '"latest" becomes 0.22.0',
      'models without cases drop out',
    ],
  },
  {
    name: 'Eval',
    lines: [
      'one job per model and runner',
      'SDK versions in turn, one machine',
      'weights cached per model',
      'JSON + HTML artifact',
    ],
  },
  {
    name: 'Report',
    lines: [
      'merge the jobs',
      'compare the two SDK versions',
      'or compare with the last green main run',
      'Job Summary, exit 1 on a regression',
    ],
  },
  {
    name: 'Pages',
    lines: [
      'latest run',
      'a page for every run',
      'history.json carried forward',
      'tokens per second over time',
    ],
  },
];

export const Pipeline: React.FC = () => (
  <Fonts>
    <AbsoluteFill style={{ background: paper, color: ink, fontFamily: sans, padding: '40px 44px' }}>
      <div style={{ fontSize: 46, fontWeight: 500, letterSpacing: '-0.03em' }}>Run workflow</div>
      <div style={{ fontFamily: mono, fontSize: 16, color: ink2, marginTop: 8 }}>
        suite · models · sdk_version · compare_sdk_version · repeat · runner
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 0,
          marginTop: 52,
          borderTop: `1px solid ${ink}`,
        }}
      >
        {steps.map((step, index) => (
          <div
            key={step.name}
            style={{
              padding: '22px 22px 0 0',
              borderRight: index < 3 ? '1px solid rgba(14,14,14,.16)' : 'none',
              paddingLeft: index === 0 ? 0 : 22,
            }}
          >
            <div style={{ fontFamily: mono, fontSize: 14, color: ink2 }}>{index + 1}</div>
            <div
              style={{
                fontSize: 54,
                fontWeight: 500,
                letterSpacing: '-0.04em',
                lineHeight: 1.05,
                marginBottom: 20,
              }}
            >
              {step.name}
            </div>
            {step.lines.map((text) => (
              <div
                key={text}
                style={{
                  fontFamily: mono,
                  fontSize: 15,
                  lineHeight: 1.5,
                  padding: '7px 0',
                  borderTop: '1px solid rgba(14,14,14,.16)',
                }}
              >
                {text}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 44,
          right: 44,
          bottom: 40,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.025em' }}>
          Green or red job
        </div>
        <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.025em' }}>
          Report on Pages →
        </div>
      </div>
    </AbsoluteFill>
  </Fonts>
);
