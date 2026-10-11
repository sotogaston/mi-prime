import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
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

function svg(size, inset, { fondo = 'cuadrado' } = {}) {
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
  const base = fondo === 'cuadrado' ? `<rect width="${size}" height="${size}" fill="${BG}"/>`
             : fondo === 'circulo' ? `<circle cx="${c}" cy="${c}" r="${c}" fill="${BG}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${base}${paths}</svg>`;
}

const b = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const p = await (await b.newContext({ deviceScaleFactor: 1 })).newPage();

async function png(size, inset, name, { fondo = 'cuadrado', ruta = resolve(HERE, 'icons', name) } = {}) {
  const s = svg(size, inset, { fondo });
  const transparente = fondo !== 'cuadrado';
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<body style="margin:0;background:${transparente ? 'transparent' : BG}">${s}</body>`);
  await p.screenshot({ path: ruta, omitBackground: transparente });
  console.log('  ' + name);
}

await png(192, 0.10, 'icon-192.png');
await png(512, 0.10, 'icon-512.png');
await png(512, 0.22, 'maskable-512.png');   // más margen: la zona segura del maskable es el 80% central
writeFileSync(resolve(HERE, 'icons', 'icon.svg'), svg(512, 0.10));
console.log('  icon.svg');

// App de Android (Capacitor): lanzador por densidad, ícono adaptable y pantalla de inicio
const RES = resolve(HERE, 'android', 'app', 'src', 'main', 'res');
if (existsSync(RES)) {
  const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(DENS)) {
    const dir = resolve(RES, 'mipmap-' + d);
    await png(48 * k, 0.10, `mipmap-${d}/ic_launcher.png`, { ruta: resolve(dir, 'ic_launcher.png') });
    await png(48 * k, 0.12, `mipmap-${d}/ic_launcher_round.png`, { fondo: 'circulo', ruta: resolve(dir, 'ic_launcher_round.png') });
    // adaptable: 108 dp, el dibujo dentro del 66 % central; el fondo es un color
    await png(108 * k, 0.24, `mipmap-${d}/ic_launcher_foreground.png`, { fondo: 'ninguno', ruta: resolve(dir, 'ic_launcher_foreground.png') });
  }
  writeFileSync(resolve(RES, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
  // pantallas de inicio: fondo oscuro y la rueda al centro, al tamaño de cada splash.png
  for (const d of readdirSync(RES).filter(d => d.startsWith('drawable') && existsSync(resolve(RES, d, 'splash.png')))) {
    const f = resolve(RES, d, 'splash.png'), b = readFileSync(f);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), lado = Math.round(Math.min(w, h) * 0.42);
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<body style="margin:0;background:${BG};display:grid;place-items:center;height:100vh">${svg(lado, 0, { fondo: 'ninguno' })}</body>`);
    await p.screenshot({ path: f });
    console.log(`  ${d}/splash.png ${w}x${h}`);
  }
}

await b.close();
