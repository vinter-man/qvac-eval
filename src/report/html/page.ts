import type { FontAssets } from './assets.js';
import { patternDefs } from './chart.js';
import { CLIENT_SCRIPT } from './client.js';
import { html, raw, type Safe } from './escape.js';
import { buildStyles } from './styles.js';

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230E0E0E'/%3E%3Ccircle cx='15' cy='15' r='7' fill='none' stroke='%23FAFAF7' stroke-width='3'/%3E%3Cpath d='M19 19l6 6' stroke='%23FAFAF7' stroke-width='3'/%3E%3C/svg%3E";

export interface PageInput {
  title: string;
  headerRight: string;
  body: Safe;
  footerLeft: Safe | null;
  footerRight: Safe | null;
  fonts: FontAssets;
}

export function renderPage(input: PageInput): string {
  const page = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${input.title}</title>
<link rel="icon" href="${raw(FAVICON)}">
<style>${raw(buildStyles(input.fonts))}</style>
</head>
<body>
${patternDefs()}
<a class="skip" href="#main">Skip to the results</a>
<div class="page">
<header class="row">
<div class="corner">qvac-eval</div>
<div class="top-right"><div class="corner">${input.headerRight}</div><button class="btn btn--small" id="theme" type="button" hidden>Night</button></div>
</header>
<main id="main">
${input.body}
</main>
<footer class="row foot">
<div class="corner">${input.footerLeft}</div>
<div class="corner">${input.footerRight}</div>
</footer>
</div>
<script>${raw(CLIENT_SCRIPT)}</script>
</body>
</html>
`;
  return page.value;
}
