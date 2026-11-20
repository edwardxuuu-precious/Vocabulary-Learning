import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Assets for the explicit local journey preview. The learning app uses its normal screens and APIs. */
export function loadJourneyControls() {
  const script = readFileSync(new URL('./controls.mjs', import.meta.url));
  const stylesheet = readFileSync(new URL('./controls.css', import.meta.url));
  const tag = createHash('sha256').update(script).update(stylesheet).digest('hex').slice(0, 12);
  const scriptPath = `/assets/learning-journey-${tag}.js`;
  const stylesheetPath = `/assets/learning-journey-${tag}.css`;
  const assets = new Map([
    [scriptPath, { type: 'text/javascript; charset=utf-8', body: script }],
    [stylesheetPath, { type: 'text/css; charset=utf-8', body: stylesheet }],
  ]);
  const tags = `<link rel="stylesheet" href="${stylesheetPath}"><script type="module" src="${scriptPath}"></script>`;
  const attach = (html: string) => html.includes(scriptPath) ? html : html.replace('</head>', `${tags}</head>`);
  return { assets, attach };
}
