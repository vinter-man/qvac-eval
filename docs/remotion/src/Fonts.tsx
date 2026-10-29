import React, { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

const faces = [
  { family: 'Onest', file: 'fonts/onest-latin.woff2' },
  { family: 'Martian Mono', file: 'fonts/martian-mono-latin.woff2' },
];

export const Fonts: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('fonts'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all(
      faces.map(async ({ family, file }) => {
        const face = new FontFace(family, `url(${staticFile(file)})`, { weight: '400 500' });
        (document.fonts as unknown as { add(font: FontFace): void }).add(await face.load());
      }),
    ).then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);

  return ready ? <>{children}</> : null;
};
