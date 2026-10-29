import type { FontAssets } from './assets.js';

const TOKENS = `
:root{
  --paper:#FAFAF7;--ink:#0E0E0E;--ink-2:#5B5B56;--line:rgba(14,14,14,.16);--on-ink:#FAFAF7;--on-ink-muted:#CFCFCA;
  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:28px;--space-7:40px;--space-8:64px;--space-9:96px;
  --radius-pill:999px;
  --fs-hero:150px;--fs-index:46px;--fs-corner:38px;--fs-lead:22px;--fs-ui:15px;--fs-body:11.5px;--fs-label:10.5px;
  --fs-hero-m:84px;--fs-index-m:34px;--fs-corner-m:22px;
  --op-focus:.14;--dur-focus:350ms;--dur-button:400ms;--ease-out:cubic-bezier(.2,.8,.2,1);
  --btn-h:40px;
  --font-sans:Onest,"Helvetica Neue",Arial,sans-serif;
  --font-mono:"Martian Mono",ui-monospace,Menlo,monospace;
  color-scheme:light;
}
:root[data-theme="night"]{--paper:#121211;--ink:#ECEAE3;--ink-2:#A4A49D;--line:rgba(236,234,227,.16);--on-ink:#121211;--on-ink-muted:#3F3F3B;color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="paper"]){--paper:#121211;--ink:#ECEAE3;--ink-2:#A4A49D;--line:rgba(236,234,227,.16);--on-ink:#121211;--on-ink-muted:#3F3F3B;color-scheme:dark}}
`;

const LAYOUT = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 var(--fs-body)/1.6 var(--font-mono);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit;text-decoration:none}
.mut{color:var(--ink-2)}
.defs{position:absolute}
.page{max-width:1440px;margin:0 auto;padding:var(--space-5) var(--space-6) var(--space-6)}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-5)}
.corner{font:500 var(--fs-corner)/1 var(--font-sans);letter-spacing:-.025em;white-space:nowrap}
.corner a:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:5px}
.top-right{display:flex;align-items:center;gap:var(--space-4)}
.skip{position:absolute;left:-9999px}
.skip:focus{left:var(--space-5);top:var(--space-2);background:var(--ink);color:var(--paper);padding:var(--space-2) var(--space-3);z-index:10}
.label{font:500 var(--fs-label)/1.4 var(--font-mono);letter-spacing:.02em}

.btn{display:inline-flex;align-items:center;gap:var(--space-2);height:var(--btn-h);padding:0 19px;border-radius:var(--radius-pill);border:1px solid var(--ink);background:transparent;color:var(--ink);font:500 var(--fs-ui)/1 var(--font-sans);letter-spacing:-.01em;white-space:nowrap;cursor:pointer;transition:opacity var(--dur-focus) ease}
.btn sup{font:500 var(--fs-label)/1 var(--font-mono);letter-spacing:0;vertical-align:baseline;opacity:.7}
.btn[aria-pressed="true"]{background:var(--ink);color:var(--paper)}
.btn:active{transform:translateY(1px)}
.btn--small{height:32px;padding:0 14px;font-size:13px}
.btn:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid currentColor;outline-offset:4px}
.group:hover .btn:not(:hover){opacity:var(--op-focus)}

.hero{padding-top:var(--space-7)}
.hero-meta{margin:0;color:var(--ink-2)}
.hero-word{margin:var(--space-5) 0 0;font:500 var(--fs-hero)/.85 var(--font-sans);letter-spacing:-.06em;overflow-wrap:anywhere}
.tone{display:block;margin-top:var(--space-5);color:var(--ink)}
.hero-sub{max-width:560px;margin:var(--space-4) 0 0;color:var(--ink-2)}
.tally{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-6);margin:var(--space-5) 0 0;padding:0;list-style:none}
.tally li{display:flex;align-items:center;gap:var(--space-2)}
.tally b{font:500 var(--fs-lead)/1 var(--font-sans);letter-spacing:-.01em}

.layout{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);column-gap:var(--space-7);margin-top:var(--space-8)}
.selector{position:sticky;top:var(--space-5);align-self:start;display:flex;flex-direction:column}
.selector a{font:500 var(--fs-index)/1.06 var(--font-sans);letter-spacing:-.03em;transition:opacity var(--dur-focus) ease}
.selector sup{font:500 var(--fs-label)/1 var(--font-mono);letter-spacing:0;color:var(--ink-2);margin-left:var(--space-1)}
.selector:hover a:not(:hover){opacity:var(--op-focus)}
section{scroll-margin-top:var(--space-5)}
section+section{margin-top:var(--space-8)}
h2{margin:0 0 var(--space-4);font:500 var(--fs-lead)/1.15 var(--font-sans);letter-spacing:-.01em}
h2 sup{font:500 var(--fs-label)/1 var(--font-mono);letter-spacing:0;color:var(--ink-2);margin-left:var(--space-1)}
.lede{margin:0 0 var(--space-5);color:var(--ink-2);max-width:620px}
.empty{padding:var(--space-4) 0;border-top:1px solid var(--ink);border-bottom:1px solid var(--line);color:var(--ink-2)}

.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:var(--fs-body)}
th{font-weight:400;text-align:left;color:var(--ink-2);padding:0 6px var(--space-2);border-bottom:1px solid var(--ink);white-space:nowrap}
td{padding:7px 6px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}
th.num,td.num{text-align:right}
td.model{white-space:normal}
td.model b,.case-id{font:500 var(--fs-ui)/1.25 var(--font-sans);letter-spacing:-.01em}
td small{display:flex;flex-direction:column;align-items:flex-end;color:var(--ink-2);font-size:var(--fs-label)}
td.model small{align-items:flex-start;white-space:normal}
.chg.worse::before{content:"";display:inline-block;border:4px solid transparent;border-bottom:6px solid currentColor;border-top:0;margin-right:4px}

.chart{margin:0 0 var(--space-6)}
.legend{display:flex;flex-wrap:wrap;gap:var(--space-4);margin:0 0 var(--space-3);padding:0;list-style:none;color:var(--ink-2)}
.legend li{display:inline-flex;align-items:center;gap:var(--space-2)}
.swatch{flex:none;color:var(--ink)}
.bars,.trends{display:flex;flex-direction:column;color:var(--ink)}
.bar-row,.trend-row{display:grid;grid-template-columns:minmax(96px,200px) minmax(0,1fr) minmax(86px,128px);column-gap:var(--space-3);align-items:center;min-height:18px}
.bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-value{text-align:right;white-space:nowrap}
.bar-svg,.spark{display:block;overflow:visible}
.grid{stroke:var(--line);stroke-width:1}
.trace{stroke:currentColor;stroke-width:1.6;stroke-linejoin:round}
.axis{display:flex;justify-content:space-between;color:var(--ink-2);font-size:var(--fs-label);padding-top:var(--space-1)}
.axis-row{color:var(--ink-2);font-size:var(--fs-label)}
.trend-row{margin-bottom:var(--space-3)}

.regs{margin:0;padding:0;list-style:none;border-top:1px solid var(--ink)}
.regs li{display:grid;grid-template-columns:minmax(120px,220px) minmax(0,1fr);column-gap:var(--space-4);padding:var(--space-3) 6px;border-bottom:1px solid var(--line)}
.regs .where{font:500 var(--fs-ui)/1.25 var(--font-sans);letter-spacing:-.01em}

.filters{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:0 0 var(--space-3)}
.filters[hidden]{display:none}
.filter-note{margin:0 0 var(--space-3);color:var(--ink-2)}
.cases{border-top:1px solid var(--ink)}
.case{border-bottom:1px solid var(--line)}
.case[hidden]{display:none}
.case>summary{display:grid;grid-template-columns:120px minmax(0,1.3fr) minmax(0,1fr) 90px minmax(0,1.2fr) 14px;column-gap:var(--space-3);align-items:baseline;padding:9px 6px;cursor:pointer;list-style:none}
.case>summary::-webkit-details-marker{display:none}
.case>summary::after{content:"+";justify-self:end;color:var(--ink-2)}
.case[open]>summary::after{content:"−"}
.case>summary:hover{background:color-mix(in srgb,var(--ink) 4%,transparent)}
.status{display:inline-flex;align-items:center;gap:var(--space-2);color:var(--ink)}
.mark{flex:none;display:block}
.case-body{padding:var(--space-3) 6px var(--space-5) calc(120px + var(--space-3) + 6px);display:grid;gap:var(--space-4)}
.checks{margin:0;padding:0;list-style:none}
.checks li{display:grid;grid-template-columns:120px minmax(0,1fr);column-gap:var(--space-3);padding:3px 0}
.checks .fail{font-weight:500}
.diff{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4)}
.diff p{margin:0 0 var(--space-1)}
pre{margin:0;padding:var(--space-3);border:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere;font:400 var(--fs-body)/1.6 var(--font-mono)}
del{text-decoration:line-through;text-decoration-thickness:1px;color:var(--ink-2)}
ins{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;font-weight:500}
.facts{display:grid;grid-template-columns:minmax(120px,200px) minmax(0,1fr);margin:0;border-top:1px solid var(--ink)}
.facts dt,.facts dd{margin:0;padding:7px 6px;border-bottom:1px solid var(--line)}
.facts dt{color:var(--ink-2)}
.facts dd{overflow-wrap:anywhere}

.foot{margin-top:var(--space-9)}
@media (max-width:1100px){
  .layout{grid-template-columns:minmax(0,1fr);row-gap:var(--space-7)}
  .selector{position:static;flex-direction:row;flex-wrap:wrap;column-gap:var(--space-5)}
}
@media (max-width:720px){
  .page{padding:var(--space-4)}
  .corner{font-size:var(--fs-corner-m);white-space:normal}
  .row{gap:var(--space-3)}
  .top-right{flex-direction:column;align-items:flex-end;gap:var(--space-2);text-align:right}
  .foot{flex-direction:column;align-items:flex-start}
  .hero{padding-top:var(--space-6)}
  .hero-word{font-size:min(var(--fs-hero-m),22vw)}
  .selector a{font-size:var(--fs-index-m)}
  .layout{margin-top:var(--space-7)}
  .bar-row,.trend-row{grid-template-columns:minmax(72px,104px) minmax(0,1fr) minmax(70px,96px);column-gap:var(--space-2)}
  .regs li{grid-template-columns:minmax(0,1fr);row-gap:var(--space-1)}
  .case>summary{grid-template-columns:auto minmax(0,1fr) 14px;row-gap:2px}
  .case>summary .case-model,.case>summary .case-metric,.case>summary .case-note{grid-column:2}
  .case>summary::after{grid-column:3;grid-row:1}
  .case-body{padding-left:6px}
  .checks li{grid-template-columns:minmax(0,1fr);row-gap:0}
  .diff{grid-template-columns:minmax(0,1fr)}
  .facts{grid-template-columns:minmax(96px,140px) minmax(0,1fr)}
  .foot{margin-top:var(--space-8)}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media print{.selector,.filters,.btn{display:none}.case-body{display:grid}}
`;

function fontFace(family: string, uri: string): string {
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:400 500;font-display:swap;src:url(${uri}) format("woff2")}`;
}

export function buildStyles(fonts: FontAssets): string {
  return [
    fontFace('Onest', fonts.onest),
    fontFace('Martian Mono', fonts.martianMono),
    TOKENS,
    LAYOUT,
  ].join('\n');
}
