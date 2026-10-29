import React from 'react';
import { Composition, Still } from 'remotion';
import { Banner, BANNER } from './Banner';
import { Demo, DEMO, DEMO_FRAMES, FPS } from './Demo';
import { Pipeline, PIPELINE } from './Pipeline';
import {
  CaptureView,
  captures,
  FRAME_HEADER,
  PHONE_SHOT,
  PhonesView,
  SHOT_WIDTH,
  TerminalShotView,
  terminalHeight,
  terminalShots,
} from './shots';

export const Root: React.FC = () => (
  <>
    <Composition
      id="demo"
      component={Demo}
      durationInFrames={DEMO_FRAMES}
      fps={FPS}
      width={DEMO.width}
      height={DEMO.height}
    />
    <Still id="banner" component={Banner} width={BANNER.width} height={BANNER.height} />
    <Still id="phones" component={PhonesView} width={PHONE_SHOT.width} height={PHONE_SHOT.height} />
    <Still id="pipeline" component={Pipeline} width={PIPELINE.width} height={PIPELINE.height} />
    {terminalShots.map((name) => (
      <Still
        key={name}
        id={`terminal-${name}`}
        component={() => <TerminalShotView name={name} />}
        width={SHOT_WIDTH}
        height={terminalHeight(name)}
      />
    ))}
    {captures.map((capture) => (
      <Still
        key={capture.id}
        id={`shot-${capture.id}`}
        component={() => <CaptureView capture={capture} />}
        width={SHOT_WIDTH}
        height={capture.height + FRAME_HEADER + 2}
      />
    ))}
  </>
);
