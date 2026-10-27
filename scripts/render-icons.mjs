// Renders the SVG sources in design/ to the PNG icons the plugin uses and to the store banner.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { PLUGIN_NAME, ROOT } from './lib/paths.mjs';

const icons = path.join(PLUGIN_NAME, 'assets', 'icons');
const IMAGES = [
  // [source in design/, output relative to the repository root, width in px]
  // The marketplace uses a 1:1 Icon as the cover and recommends 288x288 PNG
  ['icon.svg', path.join(icons, 'plugin.png'), 288],
  ['icon.svg', path.join(icons, 'category.png'), 96],
  ['icon.svg', path.join(icons, 'action.png'), 96],
  ['key-live.svg', path.join(icons, 'key-live.png'), 196],
  ['key-muted.svg', path.join(icons, 'key-muted.png'), 196],
  ['key-unavailable.svg', path.join(icons, 'key-unavailable.png'), 196],
  // Marketplace banners are 3:2
  ['banner.svg', path.join('store', 'banner-1.png'), 1098],
];

for (const [source, output, width] of IMAGES) {
  const svg = readFileSync(path.join(ROOT, 'design', source));
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  mkdirSync(path.dirname(path.join(ROOT, output)), { recursive: true });
  writeFileSync(path.join(ROOT, output), image.asPng());
  console.log(`${output} (${image.width}x${image.height})`);
}
