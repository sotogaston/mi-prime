import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname, extname, normalize } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok  = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

// Servidor estático: el service worker sólo funciona sobre http/https,
// así probamos exactamente lo que va a correr en GitHub Pages.
const MIME = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png',
  '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json', '.json':'application/json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = resolve(HERE, '.' + normalize(p));
  if (!file.startsWith(HERE)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const URL = `http://127.0.0.1:${PORT}/`;
const FILE_URL = pathToFileURL(resolve(HERE, 'index.html')).href;

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(URL);
await page.waitForTimeout(300);

console.log('\n== 1. Carga y pantalla Hoy ==');
ok('sin errores de consola: ' + JSON.stringify(errors), errors.length === 0);
ok('7 hábitos renderizados', (await page.locator('.hrow').count()) === 7);
ok('nav con 4 pestañas', (await page.locator('nav button').count()) === 4);

console.log('\n== 2. Marcado rápido (1 toque = verde) ==');
await page.locator('.dot').first().click();
await page.waitForTimeout(120);
ok('primer hábito queda verde', await page.locator('.dot').first().evaluate(e => e.classList.contains('s-green')));
ok('contador "1 de 7"', (await page.locator('#app').innerText()).includes('1 de 7'));
await page.locator('.dot').first().click();
await page.waitForTimeout(120);
ok('segundo toque desmarca', !(await page.locator('.dot').first().evaluate(e => e.classList.contains('s-green'))));

console.log('\n== 3. Selector de estado (⋯) ==');
await page.locator('.more').first().click();
await page.waitForTimeout(150);
ok('se abre la hoja con 4 opciones', (await page.locator('.opt').count()) === 4);
await page.locator('.opt').nth(2).click();          // azul
await page.waitForTimeout(150);
ok('queda azul', await page.locator('.dot').first().evaluate(e => e.classList.contains('s-blue')));

console.log('\n== 4. Regla: no dos amarillos seguidos ==');
await page.evaluate(() => {
  const P = window.__prime, S = P.S;
  const h = S.habits[0].id;
  const d = new Date(); d.setDate(d.getDate() - 1);
  const y = P.iso(d);
  S.marks[y] = Object.assign(S.marks[y] || {}, { [h]: 'yellow' });
  P.save(); P.render();
});
await page.waitForTimeout(150);
ok('banner de riesgo visible', (await page.locator('.alert.risk').count()) === 1);
ok('banner nombra el hábito', (await page.locator('.alert.risk').innerText()).includes('Levantarme'));
ok('prevIsYellow = true', await page.evaluate(() => window.__prime.prevIsYellow(window.__prime.iso(new Date()), window.__prime.S.habits[0].id)));

// intentar marcar amarillo hoy -> debe pedir confirmación
await page.locator('.more').first().click();
await page.waitForTimeout(150);
await page.locator('.opt').nth(1).click();          // amarillo
await page.waitForTimeout(150);
ok('pide confirmación antes del 2º amarillo', (await page.locator('.sheet').innerText()).includes('romper la regla'));
await page.locator('[data-x="c"]').click();          // cancelar
await page.waitForTimeout(120);
ok('cancelar NO marca amarillo', await page.evaluate(() => {
  const P = window.__prime; return !P.S.marks[P.iso(new Date())] || P.S.marks[P.iso(new Date())][P.S.habits[0].id] !== 'yellow';
}));

await page.locator('.more').first().click();
await page.waitForTimeout(150);
await page.locator('.opt').nth(1).click();
await page.waitForTimeout(150);
await page.locator('[data-x="o"]').click();          // confirmar
await page.waitForTimeout(150);
ok('confirmar sí marca amarillo', await page.locator('.dot').first().evaluate(e => e.classList.contains('s-yellow')));

console.log('\n== 5. Racha ==');
const st = await page.evaluate(() => {
  const P = window.__prime, S = P.S, h = S.habits[1].id;
  const d0 = new Date();
  for (let i = 0; i < 5; i++) {
    const d = new Date(d0); d.setDate(d.getDate() - i);
    (S.marks[P.iso(d)] ||= {})[h] = 'green';
  }
  // el 6º día atrás en azul no debe cortar
  const d6 = new Date(d0); d6.setDate(d6.getDate() - 5);
  (S.marks[P.iso(d6)] ||= {})[h] = 'blue';
  const d7 = new Date(d0); d7.setDate(d7.getDate() - 6);
  (S.marks[P.iso(d7)] ||= {})[h] = 'green';
  P.save();
  return P.streak(h);
});
ok('racha cuenta 6 verdes saltando el azul (obtuvo ' + st + ')', st === 6);

const st2 = await page.evaluate(() => {
  const P = window.__prime, S = P.S, h = S.habits[2].id;
  const d = new Date(); d.setDate(d.getDate() - 1);
  (S.marks[P.iso(d)] ||= {})[h] = 'yellow';
  return P.streak(h);
});
ok('amarillo corta la racha (obtuvo ' + st2 + ')', st2 === 0);

console.log('\n== 6. Cierre automático del día ==');
const auto = await page.evaluate(() => {
  const P = window.__prime;
  // reset limpio, creado hace 8 días, sin marcas
  const S = P.seed();
  const start = new Date(); start.setDate(start.getDate() - 8);
  S.createdAt = P.iso(start);
  S.settings.lastClosed = null;
  P.S = S;
  P.autoCloseDays();
  const res = { weekend: [], weekday: [] };
  for (let i = 1; i <= 8; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = P.iso(d), mk = P.S.marks[ds][S.habits[0].id];
    (d.getDay() === 0 || d.getDay() === 6 ? res.weekend : res.weekday).push(mk);
  }
  const today = P.iso(new Date());
  res.todayUntouched = !P.S.marks[today];
  return res;
});
ok('finde sin marcar -> azul', auto.weekend.length > 0 && auto.weekend.every(v => v === 'blue'));
ok('día de semana sin marcar -> amarillo', auto.weekday.length > 0 && auto.weekday.every(v => v === 'yellow'));
ok('hoy no se auto-cierra', auto.todayUntouched);

console.log('\n== 7. Rueda del mes ==');
await page.locator('nav button[data-tab="mes"]').click();
await page.waitForTimeout(250);
const cells = await page.locator('.wheelwrap .cell').count();
const dim = await page.evaluate(() => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate());
ok(`celdas = días(${dim}) x hábitos(7) = ${dim * 7} (obtuvo ${cells})`, cells === dim * 7);
ok('rueda tiene % en el centro', (await page.locator('.wheelwrap svg').evaluate(e => e.textContent)).includes('%'));
// tocar una celda abre el selector
await page.locator('.wheelwrap .cell').nth(20).click();
await page.waitForTimeout(150);
ok('tocar celda abre el selector', (await page.locator('.opt').count()) === 4);
await page.locator('.opt').first().click();
await page.waitForTimeout(200);
ok('la celda cambió a verde', await page.evaluate(() => {
  const P = window.__prime;
  return Object.values(P.S.marks).some(day => Object.values(day).includes('green'));
}));

console.log('\n== 8. Vista semanal ==');
await page.locator('nav button[data-tab="semana"]').click();
await page.waitForTimeout(250);
const wk = await page.locator('.wk').count();
ok(`5 ruedas semanales para un mes de ${dim} días (obtuvo ${wk})`, dim > 28 ? wk === 5 : wk === 4);
ok('hay chips de hábitos', (await page.locator('.chip').count()) === 7);
await page.locator('.chip').nth(3).click();
await page.waitForTimeout(200);
ok('cambiar de hábito actualiza el título', (await page.locator('.card-t').first().innerText()).toLowerCase().includes('leer'));
ok('muestra VIC/DER', (await page.locator('.vd').first().innerText()).includes('VIC'));

console.log('\n== 9. Más: hábitos, listas, tabla ==');
await page.locator('nav button[data-tab="mas"]').click();
await page.waitForTimeout(250);
await page.fill('#newHabit', 'Tomar agua');
await page.locator('[data-act="addH"]').click();
await page.waitForTimeout(200);
ok('se agregó el hábito', (await page.locator('#app').innerText()).includes('Tomar agua'));
ok('tabla historial con ' + dim + ' filas', (await page.locator('.tbl tbody tr').count()) === dim);
ok('lista Hacer menos tiene items', (await page.locator('.card').nth(1).locator('.li').count()) >= 4);
await page.locator('[data-act="tex"]').click();
await page.waitForTimeout(200);
ok('switch de texturas activado', (await page.locator('[data-act="tex"]').getAttribute('aria-checked')) === 'true');

console.log('\n== 10. Persistencia ==');
await page.reload();
await page.waitForTimeout(400);
ok('el hábito nuevo sobrevive al reload', (await page.locator('.hrow').count()) === 8);
ok('sin errores tras reload: ' + JSON.stringify(errors.slice(-3)), errors.length === 0);

console.log('\n== 11. PWA: manifest, íconos y service worker ==');
const mf = await page.evaluate(async () => {
  const link = document.querySelector('link[rel=manifest]');
  if (!link) return null;
  return await (await fetch(link.href)).json();
});
ok('manifest enlazado y válido', !!mf);
ok('display standalone', mf?.display === 'standalone');
ok('start_url y scope relativos (sirve en subcarpeta de GitHub Pages)', mf?.start_url === './' && mf?.scope === './');
ok('3 íconos declarados, uno maskable', mf?.icons?.length === 3 && mf.icons.some(i => i.purpose === 'maskable'));
for (const i of (mf?.icons || [])) {
  const st = await page.evaluate(u => fetch(u).then(r => r.status), new global.URL(i.src, URL).href);
  ok('ícono existe: ' + i.src, st === 200);
}
const swReady = await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false));
ok('service worker activo', swReady);

console.log('\n== 12. Funciona sin conexión ==');
await ctx.setOffline(true);
await page.reload();
await page.waitForTimeout(600);
ok('la app carga offline', (await page.locator('.hrow').count()) > 0);
ok('los datos siguen ahí offline', (await page.locator('#app').innerText()).includes('Tomar agua'));
await ctx.setOffline(false);

console.log('\n== 13. Sigue andando con doble clic (file://) ==');
const local = await ctx.newPage();
const localErr = [];
local.on('pageerror', e => localErr.push(String(e)));
await local.goto(FILE_URL);
await local.waitForTimeout(400);
ok('renderiza abierta desde el disco', (await local.locator('.hrow').count()) === 7);
ok('sin errores por el service worker ausente: ' + JSON.stringify(localErr), localErr.length === 0);
await local.close();

console.log('\n== 14. Capturas ==');
await page.locator('nav button[data-tab="hoy"]').click(); await page.waitForTimeout(300);
await page.screenshot({ path: resolve(HERE, 'shot-hoy.png') });
await page.locator('nav button[data-tab="mes"]').click(); await page.waitForTimeout(400);
await page.screenshot({ path: resolve(HERE, 'shot-mes.png'), fullPage: true });
await page.emulateMedia({ colorScheme: 'dark' });
await page.locator('nav button[data-tab="hoy"]').click(); await page.waitForTimeout(400);
await page.screenshot({ path: resolve(HERE, 'shot-dark.png') });
console.log('  capturas listas');

console.log(`\n===== ${pass} PASS · ${fail} FAIL =====`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
