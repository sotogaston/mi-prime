import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname, extname, normalize } from 'node:path';
import { cargarLogica } from './cargar-logica.mjs';

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
// Fecha fija: el cartel de riesgo depende del día de la semana, y la suite
// tiene que dar lo mismo corrida un domingo que un miércoles.
const HOY_FIJO = '2026-10-14';   // miércoles
await ctx.clock.setFixedTime(new Date(HOY_FIJO + 'T12:00:00'));
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
ok('banner dice "Ayer" cuando fue ayer', (await page.locator('.alert.risk').innerText()).includes('Ayer'));
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
    const ds = P.iso(d), h = S.habits[0].id;
    (d.getDay() === 0 || d.getDay() === 6 ? res.weekend : res.weekday).push({ leido: P.getMark(ds, h), guardado: P.S.marks[ds][h] });
  }
  const today = P.iso(new Date());
  res.todayUntouched = !P.S.marks[today];
  return res;
});
ok('finde sin marcar -> azul', auto.weekend.length > 0 && auto.weekend.every(v => v.leido === 'blue'));
ok('día de semana sin abrir -> sin dato (guardado como amarillo del cierre automático)',
  auto.weekday.length > 0 && auto.weekday.every(v => v.leido === 'nodata' && v.guardado === 'yellow'));
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

// ---------------------------------------------------------------------------
// Escenarios aislados: cada uno en su propio contexto (localStorage y reloj
// propios), con un estado armado a mano y una fecha fija.
const estado = ({ marks = {}, createdAt = '2026-09-01', lastClosed = '2026-10-13', habits } = {}) => ({
  version: 2, createdAt,
  habits: habits || [{ id: 'hA', name: 'Leer', order: 0 }, { id: 'hB', name: 'Meditar', order: 1 }],
  marks, autoClosed: {}, values: {}, notes: {}, doLess: [], doMore: [],
  settings: { lastClosed, texture: false, theme: 'auto' }
});
async function abrirEn(fecha, st){
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c.clock.setFixedTime(new Date(fecha + 'T12:00:00'));
  await c.addInitScript(s => localStorage.setItem('miPrime.v1', s), JSON.stringify(st));
  const p = await c.newPage();
  p.setDefaultTimeout(5000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL);
  await p.waitForTimeout(250);
  return { p, c, errs };
}
const ir = async (p, tab) => { await p.locator(`nav button[data-tab="${tab}"]`).click(); await p.waitForTimeout(150); };
const statN = (p, i) => p.locator('.stats .stat b').nth(i).innerText();
const centroRueda = p => p.locator('.wheelwrap svg .ctr').first().textContent();

console.log('\n== 14. Día hábil sin abrir = sin dato ==');
{
  // Creada el 01/10 y nunca abierta hasta el 14/10: el cierre automático resuelve del 1 al 13.
  // Leer: verde a mano el 13. Meditar: amarillo a mano el 08 y el 12.
  const { p, c, errs } = await abrirEn(HOY_FIJO, estado({ createdAt: '2026-10-01', lastClosed: null, marks: {
    '2026-10-08': { hB: 'yellow' }, '2026-10-12': { hB: 'yellow' }, '2026-10-13': { hA: 'green' } } }));
  const r = await p.evaluate(() => {
    const P = window.__prime, S = P.S;
    return { guardado: S.marks['2026-10-12'].hA, delRobot: (S.autoClosed['2026-10-12'] || []).includes('hA'),
             leido: P.getMark('2026-10-12', 'hA'), finde: P.getMark('2026-10-11', 'hA') };
  });
  ok('se guarda como amarillo del cierre automático (sin migrar datos)', r.guardado === 'yellow' && r.delRobot);
  ok('se lee como sin dato (obtuvo ' + r.leido + ')', r.leido === 'nodata');
  ok('el fin de semana sigue en azul', r.finde === 'blue');
  ok('Hoy: 0 reglas rotas con 15 huecos de días hábiles (obtuvo ' + await statN(p, 1) + ')', await statN(p, 1) === '0');
  ok('amarillo y después sin dato (ayer) no dispara el cartel', await p.locator('.alert.risk').count() === 0);
  ok('Hoy muestra los sin dato aparte', (await p.locator('#app').innerText()).includes('15 sin dato'));
  await ir(p, 'mes');
  ok('Mes: 0 reglas rotas (obtuvo ' + await statN(p, 2) + ')', await statN(p, 2) === '0');
  ok('Prime % cuenta el sin dato como no hecho: 1 verde de 18 = 6%', await centroRueda(p) === '6%');
  ok('celda sin dato en gris propio', await p.locator('.wheelwrap .cell[data-d="2026-10-12"][data-h="hA"]').getAttribute('fill') === 'var(--nodata)');
  ok('la leyenda del mes explica el sin dato', (await p.locator('.legend').innerText()).includes('Sin dato'));
  await ir(p, 'mas');
  ok('tabla historial: glifo propio "?"', (await p.locator('.tbl tbody tr').nth(11).locator('td').nth(1).innerText()) === '?');

  const prog = await p.evaluate(() => {
    const P = window.__prime, S = P.S;
    // 8 verdes, 4 amarillos a mano y 15 días sin dato desde el 02/09
    S.habits.push({ id: 'hG', name: 'Inglés', order: 2, goal: { unidad: 'min', piso: 15, meta: 30, sube: 5, tope: 60, desde: '2026-09-01' } });
    [...Array(8).fill('g'), ...Array(4).fill('y'), ...Array(15).fill('sd')].forEach((t, i) => {
      const ds = P.iso(new Date(2026, 8, 2 + i));
      (S.marks[ds] ||= {}).hG = t === 'g' ? 'green' : 'yellow';
      if (t === 'sd') P.markAutoClosed(S, ds, 'hG');
    });
    const avisos = P.evaluarProgresion(S, '2026-10-14');
    return { avisos: avisos.map(a => a.tipo), meta: S.habits.find(h => h.id === 'hG').goal.meta };
  });
  ok('evaluarProgresion ignora el sin dato: la meta no baja (avisos ' + JSON.stringify(prog.avisos) + ', meta ' + prog.meta + ')',
    prog.avisos.length === 0 && prog.meta === 30);

  const plan = await p.evaluate(() => {
    const P = window.__prime, S = P.S;
    S.habits.push({ id: 'hP', name: 'Caminar seguido', order: 3, auto: { source: 'steps', threshold: 6000, near: 0.9 } });
    (S.marks['2026-10-12'] ||= {}).hP = 'yellow';
    P.markAutoClosed(S, '2026-10-12', 'hP');
    return P.planStepImport(S, { '2026-10-12': 2000 }, '2026-10-14').map(x => x.action + ':' + x.to);
  });
  ok('el import de pasos puede convertir un sin dato en amarillo real (' + plan.join() + ')', plan.join() === 'proponer:yellow');
  ok('sin errores de consola: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();
}

console.log('\n== 15. Reglas rotas: una sola definición, cruza el mes ==');
{
  // Leer: amarillo el 30/09 y el 01/10 (rompe la regla cruzando el mes).
  // Meditar: amarillo el 06 y el 07/10 (rompe la regla dentro del mes).
  const { p, c } = await abrirEn(HOY_FIJO, estado({ marks: {
    '2026-09-30': { hA: 'yellow' }, '2026-10-01': { hA: 'yellow' },
    '2026-10-06': { hB: 'yellow' }, '2026-10-07': { hB: 'yellow' } } }));
  const hoy = await statN(p, 1);
  await ir(p, 'mes');
  const mes = await statN(p, 2);
  ok(`Hoy y Mes cuentan lo mismo: 2 (Hoy ${hoy} · Mes ${mes})`, hoy === '2' && mes === '2');
  await p.locator('[data-act="prevM"]').click(); await p.waitForTimeout(120);
  await ir(p, 'hoy');
  ok('Hoy cuenta el mes en curso aunque Mes haya quedado en septiembre (obtuvo ' + await statN(p, 1) + ')', await statN(p, 1) === '2');
  await c.close();
}

console.log('\n== 16. Cartel "Hoy no podés fallar" ==');
{
  // Sábado 17/10 con el viernes en amarillo: lo que no se marque hoy queda azul.
  const { p, c } = await abrirEn('2026-10-17', estado({ lastClosed: '2026-10-16', marks: { '2026-10-16': { hA: 'yellow' } } }));
  ok('en fin de semana no hay cartel', await p.locator('.alert.risk').count() === 0);
  ok('ni etiqueta "no podés fallar" en la fila', await p.locator('.hsub .warn').count() === 0);
  await c.close();
}
{
  // Lunes 19/10: viernes amarillo, sábado y domingo azules.
  const { p, c } = await abrirEn('2026-10-19', estado({ lastClosed: '2026-10-18', marks: {
    '2026-10-16': { hA: 'yellow' }, '2026-10-17': { hA: 'blue', hB: 'blue' }, '2026-10-18': { hA: 'blue', hB: 'blue' } } }));
  const t = await p.locator('.alert.risk').innerText().catch(() => '');
  ok('el lunes nombra el viernes, no "ayer": ' + JSON.stringify(t), /el viernes/i.test(t) && !/ayer/i.test(t));
  await c.close();
}
{
  // Lunes con un día distinto por hábito: Leer falló el viernes, Meditar el domingo (marcado a mano).
  const { p, c } = await abrirEn('2026-10-19', estado({ lastClosed: '2026-10-18', marks: {
    '2026-10-16': { hA: 'yellow' }, '2026-10-17': { hA: 'blue', hB: 'blue' }, '2026-10-18': { hA: 'blue', hB: 'yellow' } } }));
  const t = await p.locator('.alert.risk').innerText().catch(() => '');
  ok('con días distintos nombra el de cada hábito: ' + JSON.stringify(t), t.includes('Leer (el viernes)') && t.includes('Meditar (ayer)'));
  await c.close();
}

console.log('\n== 17. Texto de tropiezos ==');
{
  // Leer: verde el 05/10 y un amarillo suelto el 06/10.
  const { p, c } = await abrirEn(HOY_FIJO, estado({ marks: { '2026-10-05': { hA: 'green' }, '2026-10-06': { hA: 'yellow' } } }));
  const t = await p.locator('#app').innerText();
  ok('dice que el tropiezo baja el Prime %', t.includes('1 tropiezo suelto: no rompe la regla, pero baja el Prime %'));
  ok('ya no dice "no descuenta"', !/no descuenta/.test(t));
  await ir(p, 'mes');
  ok('y efectivamente lo baja: Prime 50%', await centroRueda(p) === '50%');
  await c.close();
}

console.log('\n== 18. Importar respaldo: valida antes de guardar ==');
{
  const { p, c } = await abrirEn(HOY_FIJO, estado({ marks: { '2026-10-05': { hA: 'green' } } }));
  await ir(p, 'mas');
  const guardado = () => p.evaluate(() => localStorage.getItem('miPrime.v1'));
  const importar = async contenido => {
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="import"]').click()]);
    await fc.setFiles({ name: 'respaldo.json', mimeType: 'application/json', buffer: Buffer.from(contenido) });
    await p.waitForTimeout(250);
  };
  const antes = await guardado();
  const malos = [
    ['un objeto vacío', '{}', 'No parece un respaldo de Mi Prime'],
    ['algo que no es JSON', 'hola', 'No es un archivo JSON'],
    ['una marca con un estado inventado', JSON.stringify(estado({ marks: { '2026-10-01': { hA: 'rojo' } } })), 'Marca inválida el 2026-10-01'],
  ];
  for (const [que, contenido, motivo] of malos) {
    await importar(contenido);
    const aviso = await p.evaluate(m => document.body.innerText.includes(m), motivo);
    ok(`rechaza ${que}, dice por qué y no toca los datos`, aviso && (await guardado()) === antes);
  }
  const nuevo = JSON.stringify(estado({ habits: [{ id: 'h1', name: 'Uno', order: 0 }, { id: 'h2', name: 'Dos', order: 1 }, { id: 'h3', name: 'Tres', order: 2 }],
                                        marks: { '2026-10-02': { h1: 'green' } } }));
  await importar(nuevo);
  ok('un respaldo válido pide confirmación antes de reemplazar', (await p.locator('.sheet').innerText().catch(() => '')).includes('Reemplazar'));
  await p.locator('[data-x="c"]').click().catch(() => {}); await p.waitForTimeout(120);
  ok('cancelar deja todo como estaba', (await guardado()) === antes);
  await importar(nuevo);
  await p.locator('[data-x="o"]').click().catch(() => {}); await p.waitForTimeout(200);
  const final = await p.evaluate(() => JSON.parse(localStorage.getItem('miPrime.v1')).habits.map(h => h.name).join());
  ok('confirmar reemplaza los datos (' + final + ')', final === 'Uno,Dos,Tres');
  await c.close();
}

console.log('\n== 19. La lógica de index.html corre sola en Node ==');
{
  // Lo mismo que usa mi-prime-v2.pruebas.js: si alguien saca algo del bloque
  // @logica o le mete una dependencia del navegador, falla acá.
  const S = estado({ marks: { '2026-09-30': { hA: 'yellow' }, '2026-10-01': { hA: 'yellow' }, '2026-10-02': { hB: 'yellow' } } });
  S.autoClosed = { '2026-10-02': ['hB'] };
  let L = null, err = '';
  try { L = cargarLogica(S); } catch (e) { err = String(e); }
  ok('el bloque @logica se carga sin navegador ' + err, !!L && typeof L.stats === 'function' && L.ST?.NODATA === 'nodata');
  const r = L?.stats(S, '2026-10-01', '2026-10-31');
  ok('y cuenta igual que la app: 1 regla rota cruzando el mes, 1 sin dato', r?.reglasRotas === 1 && r?.sinDato === 1);
}

console.log('\n== 20. Capturas ==');
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
