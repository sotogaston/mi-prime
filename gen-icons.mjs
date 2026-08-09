import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OK = '#0ca30c', FAIL = '#fab219', FREE = '#2a78d6', EMPTY = '#2f2f2c', BG = '#0d0d0d';

const polar = (c, r, deg) => { const a = (deg - 90) * Math.PI / 180; return [c + r * Math.cos(a), c + r * Math.sin(a)]; };
function sector(c, r0, r1, a0, a1) {
  const [x0, y0] = polar(c, r1, a0), [x1, y1] = polar(c, r1, a1);
  const [x2, y2] = polar(c, r0, a1), [x3, y3] = polar(c, r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3} Z`;
}

// 3 anillos x 12 sectores. Progreso lleno desde arriba en sentido horario,
// con un amarillo y un azul adentro para que se lea el sistema de colores.
const GRID = [
  [OK, OK, OK, FREE, OK, OK, OK, OK, EMPTY, EMPTY, EMPTY, OK],
  [OK, OK, FAIL, OK, OK, OK, OK, OK, EMPTY, EMPTY, EMPTY, OK],
  [OK, OK, OK, OK, OK, FREE, OK, OK, EMPTY, EMPTY, EMPTY, OK]
];

function svg(size, inset) {
  const c = size / 2;
  const R = c * (1 - inset);
  const HOLE = R * 0.30;
  const band = (R - HOLE) / 3;
  const step = 30, gap = 4.2, pad = Math.max(1, size * 0.006);
  let paths = '';
  for (let s = 0; s < 12; s++) {
    for (let r = 0; r < 3; r++) {
      const r0 = HOLE + r * band + pad, r1 = HOLE + (r + 1) * band - pad;
      paths += `<path d="${sector(c, r0, r1, s * step + gap / 2, (s + 1) * step - gap / 2)}" fill="${GRID[r][s]}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${BG}"/>${paths}</svg>`;
}

const b = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const p = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();

async function png(size, inset, name) {
  const s = svg(size, inset);
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<body style="margin:0;background:${BG}">${s}</body>`);
  await p.screenshot({ path: resolve(HERE, 'icons', name), omitBackground: false });
  console.log('  ' + name);
}

await png(192, 0.10, 'icon-192.png');
await png(512, 0.10, 'icon-512.png');
await png(512, 0.22, 'maskable-512.png');   // más margen: la zona segura del maskable es el 80% central
writeFileSync(resolve(HERE, 'icons', 'icon.svg'), svg(512, 0.10));
console.log('  icon.svg');

await b.close();
