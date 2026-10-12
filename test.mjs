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
ok('nav con 6 pestañas (Hoy, Mes, Semanas, Pasos, Comida, Más)', (await page.locator('nav button').count()) === 6);

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
    (P.esLibre(ds) ? res.weekend : res.weekday).push({ leido: P.getMark(ds, h), guardado: P.S.marks[ds][h] });
  }
  const today = P.iso(new Date());
  res.todayUntouched = !P.S.marks[today];
  return res;
});
ok('finde o feriado sin marcar -> azul', auto.weekend.length > 0 && auto.weekend.every(v => v.leido === 'blue'));
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
    return { guardado: S.marks['2026-10-09'].hA, delRobot: (S.autoClosed['2026-10-09'] || []).includes('hA'),
             leido: P.getMark('2026-10-09', 'hA'), finde: P.getMark('2026-10-11', 'hA'), feriado: P.getMark('2026-10-12', 'hA') };
  });
  ok('se guarda como amarillo del cierre automático (sin migrar datos)', r.guardado === 'yellow' && r.delRobot);
  ok('se lee como sin dato (obtuvo ' + r.leido + ')', r.leido === 'nodata');
  ok('el fin de semana sigue en azul', r.finde === 'blue');
  ok('el feriado del 12/10 se cierra en azul, no en sin dato', r.feriado === 'blue');
  ok('Hoy: 0 reglas rotas con 14 huecos de días hábiles (obtuvo ' + await statN(p, 1) + ')', await statN(p, 1) === '0');
  ok('amarillo y después sin dato (ayer) no dispara el cartel', await p.locator('.alert.risk').count() === 0);
  ok('Hoy muestra los sin dato aparte', (await p.locator('#app').innerText()).includes('14 sin dato'));
  await ir(p, 'mes');
  ok('Mes: 0 reglas rotas (obtuvo ' + await statN(p, 2) + ')', await statN(p, 2) === '0');
  ok('Prime % cuenta el sin dato como no hecho: 1 verde de 17 = 6%', await centroRueda(p) === '6%');
  ok('celda sin dato en gris propio', await p.locator('.wheelwrap .cell[data-d="2026-10-09"][data-h="hA"]').getAttribute('fill') === 'var(--nodata)');
  ok('la leyenda del mes explica el sin dato', (await p.locator('.legend').innerText()).includes('Sin dato'));
  await ir(p, 'mas');
  ok('tabla historial: glifo propio "?"', (await p.locator('.tbl tbody tr').nth(8).locator('td').nth(1).innerText()) === '?');

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
    (S.marks['2026-10-13'] ||= {}).hP = 'yellow';
    P.markAutoClosed(S, '2026-10-13', 'hP');
    return P.planStepImport(S, { '2026-10-13': 2000 }, '2026-10-14').map(x => x.action + ':' + x.to);
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
    ['un horario imposible', JSON.stringify(estado({ habits: [{ id: 'hA', name: 'Leer', order: 0, hora: '25:00' }] })), 'Hay un horario mal escrito'],
    ['un horario que no es texto', JSON.stringify(estado({ habits: [{ id: 'hA', name: 'Leer', order: 0, hora: ['07:00'] }] })), 'Hay un horario mal escrito'],
    ['un id con comillas', JSON.stringify(estado({ habits: [{ id: 'a"b', name: 'Leer', order: 0 }] })), 'Hay un hábito con un id inválido'],
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
  // Un nombre con HTML se muestra como texto, no se ejecuta
  const trampa = '"><img src=x onerror="window.__xss=1">';
  await importar(JSON.stringify(estado({ habits: [{ id: 'hX', name: trampa, order: 0 }] })));
  await p.locator('[data-x="o"]').click().catch(() => {}); await p.waitForTimeout(200);
  await ir(p, 'hoy'); await ir(p, 'mes');
  ok('un nombre con HTML no se ejecuta en Hoy ni en Mes', await p.evaluate(() => window.__xss === undefined)
    && (await p.locator('.wheelwrap svg title').first().textContent()).includes('<img'));
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

console.log('\n== 20. Horarios: editar, ordenar el día y "ahora" ==');
{
  const { p, c } = await abrirEn(HOY_FIJO, estado());          // miércoles 12:00
  await ir(p, 'mas');
  const editar = async (hid, campos) => {
    await p.locator(`[data-act="editH"][data-h="${hid}"]`).click();
    for (const [sel, v] of Object.entries(campos)) await p.fill(sel, v);
    await p.locator('[data-x="o"]').click(); await p.waitForTimeout(150);
  };
  await editar('hB', { '#en': 'Meditar caminando', '#eh': '07:15', '#ef': '08:00' });
  await editar('hA', { '#eh': '11:30', '#ef': '12:30' });
  const hs = await p.evaluate(() => window.__prime.S.habits.map(h => [h.name, h.hora, h.hasta].join('|')));
  ok('guarda nombre y horario: ' + hs.join(' / '), hs.includes('Meditar caminando|07:15|08:00') && hs.includes('Leer|11:30|12:30'));
  ok('Más muestra el horario', (await p.locator('#app').innerText()).includes('07:15–08:00'));
  await ir(p, 'hoy');
  const nombres = await p.locator('.hname').allInnerTexts();
  ok('Hoy ordena por horario: ' + nombres.join(' → '), nombres[0] === 'Meditar caminando' && nombres[1] === 'Leer');
  ok('marca el bloque de ahora (12:00 cae en 11:30–12:30)', (await p.locator('.now').count()) === 1 && (await p.locator('.hrow').nth(1).locator('.now').count()) === 1);
  await ir(p, 'mas');
  await p.locator('[data-act="editH"][data-h="hA"]').click();
  await p.fill('#eh', ''); await p.fill('#ef', '09:00');
  await p.locator('[data-x="o"]').click(); await p.waitForTimeout(150);
  ok('no acepta un "hasta" sin "desde"', (await p.evaluate(() => window.__prime.S.habits[0].hora)) === '11:30'
    && (await p.evaluate(() => document.body.innerText.includes('Poné primero la hora de inicio'))));
  await p.fill('#eh', '10:00'); await p.fill('#ef', '10:00');
  await p.locator('#ef').press('Enter'); await p.waitForTimeout(150);
  ok('no acepta un fin igual al inicio (y Enter guarda)', (await p.evaluate(() => window.__prime.S.habits[0].hasta)) === '12:30'
    && (await p.evaluate(() => document.body.innerText.includes('El fin tiene que ser distinto del inicio'))));
  ok('un bloque con fin igual al inicio dura 15 minutos, no el día entero',
    await p.evaluate(() => { const P = window.__prime, h = { hora: '10:00', hasta: '10:00' }; return P.esAhora(h, 600) && !P.esAhora(h, 18 * 60); }));
  await c.close();
}

console.log('\n== 21. Feriados ==');
{
  // Martes 13/10, último cierre el viernes 9: el lunes 12 fue feriado.
  const { p, c } = await abrirEn('2026-10-13', estado({ lastClosed: '2026-10-09' }));
  const r = await p.evaluate(() => { const P = window.__prime; return [P.getMark('2026-10-12', 'hA'), P.getMark('2026-10-11', 'hA')]; });
  ok('el feriado del lunes 12/10 se cierra en azul, como el finde (obtuvo ' + r + ')', r[0] === 'blue' && r[1] === 'blue');
  await c.close();
}
{
  // El mismo lunes 12/10, abierto ese día, con el viernes en amarillo (el finde se cierra en azul al abrir)
  const { p, c } = await abrirEn('2026-10-12', estado({ lastClosed: '2026-10-09', marks: { '2026-10-09': { hA: 'yellow' } } }));
  const cab = await p.locator('.card').first().innerText();
  ok('el feriado se anuncia como día libre: ' + JSON.stringify(cab.split('\n')[0]), /feriado/i.test(cab.split('\n')[0]) && cab.includes('queda en azul'));
  ok('y no hay cartel de riesgo', await p.locator('.alert.risk').count() === 0);
  await p.locator('[data-act="feriado"]').click(); await p.waitForTimeout(150);
  ok('"me toca trabajar" lo vuelve día hábil, y vuelve el cartel',
    await p.locator('.alert.risk').count() === 1 && await p.evaluate(() => !window.__prime.esLibre('2026-10-12')));
  await c.close();
}
{
  // Un miércoles común que el usuario declara feriado
  const { p, c } = await abrirEn(HOY_FIJO, estado());
  await p.locator('[data-act="feriado"]').click(); await p.waitForTimeout(150);
  ok('"hoy es feriado" lo toma como día libre', await p.evaluate(() => window.__prime.esLibre('2026-10-14'))
    && (await p.locator('.card').first().innerText()).includes('queda en azul'));
  await c.close();
}

console.log('\n== 22. Lo de anoche se confirma a la mañana ==');
{
  // Miércoles 14/10: el martes se marcó Meditar y quedaron sin marcar Leer (23:30) y Magnesio (22:30).
  const st = estado({ lastClosed: '2026-10-12', marks: { '2026-10-13': { hB: 'green' } }, habits: [
    { id: 'hA', name: 'Leer', order: 0, hora: '23:30' }, { id: 'hB', name: 'Meditar', order: 1, hora: '07:15' },
    { id: 'hC', name: 'Magnesio', order: 2, hora: '22:30' }] });
  const { p, c } = await abrirEn(HOY_FIJO, st);
  const card = p.locator('.card', { has: p.locator('.pq') });
  const txt = await card.innerText().catch(() => '');
  ok('aparece "Ayer quedó sin marcar"', /ayer quedó sin marcar/i.test(txt));
  ok('con lo pendiente en orden de horario y sin lo ya marcado', /Magnesio[\s\S]*Leer/.test(txt) && !txt.includes('Meditar'));
  await p.locator('[data-act="pend"][data-h="hC"][data-st="green"]').click(); await p.waitForTimeout(150);
  await p.locator('[data-act="pend"][data-h="hA"][data-st="yellow"]').click(); await p.waitForTimeout(150);
  const r = await p.evaluate(() => { const P = window.__prime;
    return [P.getMark('2026-10-13', 'hC'), P.getMark('2026-10-13', 'hA'), P.originOf(P.S, '2026-10-13', 'hC')]; });
  ok('✓ y ✕ lo pasan a verde y amarillo, como marca tuya (' + r + ')', r.join() === 'green,yellow,manual');
  ok('y la tarjeta desaparece', await p.locator('.pq').count() === 0);
  await c.close();
}
{
  // Martes 13/10 después del lunes feriado: el viernes quedó 4 días atrás, ya no se pregunta.
  const { p, c } = await abrirEn('2026-10-13', estado({ lastClosed: '2026-10-08' }));
  ok('después de un finde largo no pregunta por el viernes', await p.locator('.pq').count() === 0);
  await c.close();
}

console.log('\n== 23. Recordatorios en el calendario (.ics) ==');
{
  const st = estado({ habits: [
    { id: 'h1', name: 'Levantarme 07:00', order: 0, hora: '07:00' },
    { id: 'h2', name: 'Tomar creatina', order: 1, hora: '07:00' },
    { id: 'h3', name: 'Inglés', order: 2, hora: '21:30', hasta: '22:00' },
    { id: 'h4', name: 'Leer en la cama', order: 3, hora: '23:30', hasta: '23:45' },
    { id: 'h5', name: 'Elegir bien con el azúcar', order: 4 }] });
  const { p, c } = await abrirEn(HOY_FIJO, st);
  await ir(p, 'mas');
  const apk = p.locator('#bajarApk');
  ok('en la web, Más ofrece bajar la app de Android', await apk.count() === 1
    && await apk.getAttribute('href') === 'https://github.com/sotogaston/mi-prime/releases/download/android/mi-prime.apk');
  ok('en la web no aparece la tarjeta de avisos del celular', await p.locator('#avisosEstado').count() === 0);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-act="ics"]').click()]);
  const ics = await readFile(await dl.path(), 'utf8');
  const plano = ics.replace(/\r\n /g, '');                   // deshace el plegado de líneas
  ok('se descarga mi-prime-recordatorios.ics', dl.suggestedFilename() === 'mi-prime-recordatorios.ics');
  ok('un evento por horario: 3 (07:00 junta dos hábitos)', (ics.match(/BEGIN:VEVENT/g) || []).length === 3);
  ok('07:00 agrupa levantarse y creatina', plano.includes('SUMMARY:Levantarme 07:00 · Tomar creatina'));
  ok('de lunes a viernes', (ics.match(/RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/g) || []).length === 3);
  ok('arranca el miércoles 14/10, con zona horaria explícita', /DTSTART;TZID=[^:]+:20261014T070000/.test(plano));
  ok('saltea los feriados (9/11 y 23/11)', /EXDATE;TZID=[^:]+:[^\r]*20261109T213000/.test(plano) && plano.includes('20261123T213000'));
  ok('avisa al empezar cada evento', (ics.match(/TRIGGER:PT0S/g) || []).length === 3);
  ok('líneas de 75 octetos como máximo y fin de línea CRLF',
    ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75) && !/[^\r]\n/.test(ics));
  ok('el hábito sin horario no genera aviso', !plano.includes('azúcar'));
  ok('explica cómo importarlo', (await p.locator('.sheet').innerText()).includes('Google Calendar'));
  await c.close();
  const L = cargarLogica(estado());
  const cruza = L.generarICS([{ id: 'x', name: 'Tarde', hora: '23:30', hasta: '00:15' }], HOY_FIJO, 'u', [], new Date(), 'America/Argentina/Buenos_Aires');
  ok('un bloque que cruza la medianoche termina al día siguiente', cruza.includes(':20261015T001500') && cruza.includes('TZOFFSETTO:-0300'));
}

console.log('\n== 24. La app abierta de un día para el otro ==');
{
  // Se marca a la noche, el teléfono se bloquea y la app se retoma a la mañana sin recargar.
  const st = estado({ lastClosed: '2026-10-13', habits: [{ id: 'hA', name: 'Leer', order: 0, hora: '23:30' }] });
  const { p, c } = await abrirEn(HOY_FIJO, st);
  await c.clock.setFixedTime(new Date('2026-10-15T07:10:00'));      // jueves a la mañana
  await Promise.all([p.waitForEvent('load'), p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))]);
  await p.waitForTimeout(250);
  const cab = (await p.locator('.card').first().innerText()).split('\n')[0];
  ok('al volver a la app con otra fecha, se recarga en el día nuevo: ' + JSON.stringify(cab), /jue 15/i.test(cab));
  ok('y pregunta por lo que quedó sin marcar ayer', await p.locator('.pq').count() === 2);
  await c.close();
}

console.log('\n== 25. Plan de avisos de la app de Android ==');
{
  const S = estado({ habits: [
    { id: 'h1', name: 'Levantarme 07:00', order: 0, hora: '07:00' },
    { id: 'h2', name: 'Tomar creatina', order: 1, hora: '07:00' },
    { id: 'h3', name: 'Inglés', order: 2, hora: '21:30', hasta: '22:00' },
    { id: 'h4', name: 'Dormir 7 hs', order: 3 }] });
  const L = cargarLogica(S);
  const fecha = a => L.iso(a.at), dia = a => a.at.getDay();
  // Viernes 6/11 a las 06:00: el lunes 9/11 es feriado
  const plan = L.planAvisos(S.habits, new Date(2026, 10, 6, 6, 0), 14, new Set());
  ok('solo días hábiles: ni sábados ni domingos', plan.length > 0 && plan.every(a => dia(a) >= 1 && dia(a) <= 5));
  ok('saltea los feriados (9/11 y 23/11 no avisan)', !plan.some(a => ['2026-11-09', '2026-11-23'].includes(fecha(a))));
  ok('los hábitos a la misma hora van en un solo aviso', plan.filter(a => fecha(a) === '2026-11-06' && a.at.getHours() === 7)
    .map(a => a.title).join() === 'Levantarme 07:00 · Tomar creatina');
  ok('el hábito sin horario no avisa', !plan.some(a => a.title.includes('Dormir')));
  ok('ids únicos y de 32 bits', new Set(plan.map(a => a.id)).size === plan.length && plan.every(a => Number.isInteger(a.id) && a.id < 2 ** 31));
  ok('el texto dice el horario y qué hacer', plan.find(a => a.title === 'Inglés').body === '21:30–22:00 · Tocá para marcarlo');
  // Hoy a las 08:00, con la creatina ya marcada: no avisa lo pasado ni lo hecho
  const hoy = L.planAvisos(S.habits, new Date(2026, 9, 14, 8, 0), 1, new Set(['h3']));
  ok('de hoy no avisa lo que ya pasó ni lo que ya marcaste', hoy.length === 0);
  const hoy2 = L.planAvisos(S.habits, new Date(2026, 9, 14, 6, 0), 1, new Set(['h2']));
  ok('si en un horario queda algo sin marcar, avisa solo eso', hoy2.find(a => a.at.getHours() === 7)?.title === 'Levantarme 07:00');
}

console.log('\n== 26. App de Android: avisos y respaldo ==');
{
  // Capacitor simulado: registra cada llamada a los plugins nativos
  const capacitorFalso = () => {
    window.__llamadas = []; window.__pendientes = [];
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android',
      nativePromise: async (plugin, metodo, op = {}) => {
        window.__llamadas.push({ plugin, metodo, op: JSON.parse(JSON.stringify(op)) });
        if (metodo === 'checkPermissions') return { display: 'granted' };
        if (metodo === 'getPending') return { notifications: window.__pendientes.map(id => ({ id })) };
        if (metodo === 'cancel') { window.__pendientes = []; return {}; }
        if (metodo === 'schedule') { window.__pendientes.push(...op.notifications.map(n => n.id)); return { notifications: op.notifications.map(n => ({ id: n.id })) }; }
        if (metodo === 'writeFile') return { uri: 'file:///data/cache/' + op.path };
        return {};
      }
    };
  };
  const st = estado({ lastClosed: '2026-10-12', habits: [
    { id: 'h1', name: 'Levantarme 07:00', order: 0, hora: '07:00' },
    { id: 'h2', name: 'Meditar caminando', order: 1, hora: '07:15', hasta: '08:00' },
    { id: 'h3', name: 'Magnesio', order: 2, hora: '22:30' },
    { id: 'h4', name: 'Leer', order: 3, hora: '23:30' }] });
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c.clock.setFixedTime(new Date('2026-10-13T07:05:00'));          // martes 07:05
  await c.addInitScript(s => localStorage.setItem('miPrime.v1', s), JSON.stringify(st));
  await c.addInitScript(capacitorFalso);
  const p = await c.newPage(); p.setDefaultTimeout(5000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(1200);
  const llamadas = () => p.evaluate(() => window.__llamadas);
  const ultimaAgenda = async () => (await llamadas()).filter(l => l.metodo === 'schedule').at(-1)?.op.notifications || [];
  let ag = await ultimaAgenda();
  const ll = await llamadas();
  ok('pide permiso y crea el canal "Hábitos"', ll.some(l => l.metodo === 'checkPermissions') && ll.some(l => l.metodo === 'createChannel' && l.op.id === 'habitos' && l.op.importance === 4));
  ok(`programa 14 días hábiles × 4 horarios, menos el de las 07:00 de hoy que ya pasó: 39 (obtuvo ${ag.length})`, ag.length === 39);
  const primero = ag.slice().sort((a, b) => a.schedule.at.localeCompare(b.schedule.at))[0];
  ok('el primero es hoy a las 07:15, en UTC exacto como lo lee Android', primero.title === 'Meditar caminando'
    && primero.schedule.at === await p.evaluate(() => new Date(2026, 9, 13, 7, 15).toISOString()) && /\.\d{3}Z$/.test(primero.schedule.at));
  ok('con alarma exacta aunque el celular esté en reposo, en el canal "Hábitos"', ag.every(n => n.schedule.allowWhileIdle && n.channelId === 'habitos'));
  // Marcar Meditar: deja de avisar hoy a las 07:15 y se reprograma todo
  await p.locator('.hrow', { hasText: 'Meditar caminando' }).locator('.dot').click(); await p.waitForTimeout(1200);
  ag = await ultimaAgenda();
  ok('al marcar un hábito, hoy ya no avisa (38)', ag.length === 38 && !ag.some(n => n.id === 715));
  ok('y antes de reprogramar cancela los avisos anteriores', (await llamadas()).some(l => l.metodo === 'cancel' && l.op.notifications.length === 39));
  await p.locator('nav button[data-tab="mas"]').click(); await p.waitForTimeout(1200);
  const estadoAvisos = await p.locator('#avisosEstado').innerText();
  ok('Más muestra cuántos avisos hay y cuándo es el próximo: ' + JSON.stringify(estadoAvisos), /38 avisos programados\. El próximo: hoy a las 22:30/.test(estadoAvisos));
  ok('en la app no aparece el botón del calendario', await p.locator('[data-act="ics"]').count() === 0);
  ok('en la app no se ofrece bajar la app', await p.locator('#bajarApk').count() === 0);
  await p.locator('[data-act="probarAviso"]').click(); await p.waitForTimeout(200);
  ok('"Probar un aviso" programa uno en 5 segundos', (await llamadas()).some(l => l.metodo === 'schedule' && l.op.notifications[0].id === 999999));
  await p.locator('[data-act="export"]').click(); await p.waitForTimeout(300);
  const ll2 = await llamadas();
  const w = ll2.find(l => l.metodo === 'writeFile'), sh = ll2.find(l => l.metodo === 'share');
  ok('exportar guarda el respaldo y abre "Compartir" (el WebView no baja archivos)',
    w?.op.path === 'mi-prime-2026-10-13.json' && JSON.parse(w.op.data).habits.length === 4 && sh?.op.files?.[0] === 'file:///data/cache/mi-prime-2026-10-13.json');
  ok('en la app no se registra el service worker', (await p.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length))) === 0);
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();
}

// Pasos de prueba: miércoles 14/10 es HOY_FIJO (el día en curso)
const PASOS = { '2026-10-05': 8000, '2026-10-06': 4000, '2026-10-07': 6500, '2026-10-08': 7000, '2026-10-09': 3000,
  '2026-10-10': 12000, '2026-10-11': 5000, '2026-10-12': 9000, '2026-10-13': 5800, '2026-10-14': 2500 };
const CAMINAR = { id: 'hP', name: 'Caminar seguido', order: 0, auto: { source: 'steps', threshold: 6000, near: 0.9 } };

console.log('\n== 27. Pasos: totales y promedios ==');
{
  const S = { habits: [CAMINAR], marks: {}, settings: {} };
  const L = cargarLogica(S);
  ok('la meta de pasos es 8000 si no se cambió, y la de Ajustes si se cambió', L.metaPasos(S) === 8000 && L.metaPasos({ habits: [], settings: { metaPasos: 10000 } }) === 10000);
  const plan = metaPasos => { const T = { habits: [CAMINAR], marks: {}, settings: { metaPasos }, createdAt: '2026-09-01' };
    return cargarLogica(T).planStepImport(T, { '2026-10-09': 9000, '2026-10-12': 9000, '2026-10-13': 7500 }, '2026-10-14').map(x => x.to + (x.ask ? '?' : '')).join(); };
  ok('"Caminar seguido" se marca con la misma meta: con 8000, 9.000 verde y 7.500 verde a confirmar; el 12/10 es feriado y no se mide (' + plan(8000) + ')', plan(8000) === 'green,green?');
  ok('y con 10000, 9.000 (90 %) verde a confirmar y 7.500 amarillo (' + plan(10000) + ')', plan(10000) === 'green?,yellow');
  const reg = L.pasosDeRegistros([
    { startDate: new Date(2026, 9, 12, 9).toISOString(), value: 3000, sourceBundleId: 'com.sec.android.app.shealth' },
    { startDate: new Date(2026, 9, 12, 23, 30).toISOString(), value: 1000, sourceBundleId: 'com.sec.android.app.shealth' },
    { startDate: new Date(2026, 9, 13, 0, 10).toISOString(), value: 500, sourceBundleId: 'com.sec.android.app.shealth' },
    { startDate: new Date(2026, 9, 12, 9).toISOString(), value: 2900, sourceBundleId: 'com.google.android.apps.fitness' },
    { startDate: 'basura', value: 10 }, { startDate: new Date(2026, 9, 12).toISOString(), value: 'x' }]);
  ok('plan B: suma registros por día local, de una sola app (la de más pasos), sin contar dos veces',
    JSON.stringify(reg.porDia) === '{"2026-10-12":4000,"2026-10-13":500}' && reg.app === 'com.sec.android.app.shealth' && reg.apps.length === 2);
  ok('Health Connect guarda los días válidos y descarta basura', L.mezclarPasos(S, { '2026-10-12': 7000.4, '2026-10-13': 3000, x: 5, '2026-10-14': -1 }, 'hc') === 2
    && S.pasos['2026-10-12'] === 7000 && !('x' in S.pasos) && !('2026-10-14' in S.pasos));
  L.mezclarPasos(S, { '2026-10-12': 6900 }, 'hc');
  ok('Health Connect manda: si recalculó un día, lo pisa', S.pasos['2026-10-12'] === 6900);
  L.mezclarPasos(S, { '2026-10-12': 100, '2026-10-11': 8000 }, 'csv');
  ok('el CSV de Samsung solo completa o sube, nunca baja', S.pasos['2026-10-12'] === 6900 && S.pasos['2026-10-11'] === 8000);
  const r = (v, d) => JSON.stringify(L.rangoPasos(v, d));
  ok('la semana va de lunes a domingo, aunque cruce el mes', r('semana', '2026-10-14') === '{"desde":"2026-10-12","hasta":"2026-10-18"}'
    && r('semana', '2026-10-01') === '{"desde":"2026-09-28","hasta":"2026-10-04"}' && r('semana', '2026-10-18') === '{"desde":"2026-10-12","hasta":"2026-10-18"}');
  ok('mes y año completos', r('mes', '2026-02-10') === '{"desde":"2026-02-01","hasta":"2026-02-28"}' && r('anio', '2026-10-14') === '{"desde":"2026-01-01","hasta":"2026-12-31"}');
  ok('avanzar un mes desde el 31 cae en el mes siguiente', L.moverPasos('mes', '2026-01-31', 1) === '2026-02-01' && L.moverPasos('semana', '2026-10-14', -1) === '2026-10-07');
  const sem = L.resumenPasos(PASOS, '2026-10-12', '2026-10-18', 6000, '2026-10-14');
  ok(`semana: total con hoy (17.300), promedio sin hoy que sigue sumando (7.400) → ${sem.total} / ${sem.promedio}`,
    sem.total === 17300 && sem.promedio === 7400 && sem.diasPromedio === 2 && sem.dias === 3);
  ok('semana: 1 de 3 días con meta, mejor el lunes 12', sem.conMeta === 1 && sem.mejor.fecha === '2026-10-12' && sem.mejor.pasos === 9000);
  ok('los días que no llegaron no tienen dato', sem.serie.length === 7 && sem.serie.slice(3).every(x => x.pasos === null));
  const mes = L.resumenPasos(PASOS, '2026-10-01', '2026-10-31', 6000, '2026-10-14');
  ok(`octubre: 62.800 pasos, 6.700 por día, 5 de 10 días con meta → ${mes.total} / ${mes.promedio} / ${mes.conMeta}`, mes.total === 62800 && mes.promedio === 6700 && mes.conMeta === 5);
  const solo = L.resumenPasos({ '2026-10-14': 2500 }, '2026-10-12', '2026-10-18', 6000, '2026-10-14');
  ok('si hoy es el único día con dato, el promedio es hoy', solo.promedio === 2500);
  ok('un día sin registro no cuenta como 0 en el promedio', L.resumenPasos({ '2026-10-12': 8000 }, '2026-10-12', '2026-10-13', 6000, '2026-10-14').promedio === 8000);
  const libre = L.esLibre;
  const semL = L.resumenPasos(PASOS, '2026-10-05', '2026-10-11', 6000, '2026-10-14', libre);
  ok(`la meta solo cuenta de lunes a viernes: semana del 5, 3 de 5 hábiles (el sábado de 12.000 no suma) → ${semL.conMeta}/${semL.habiles}`,
    semL.conMeta === 3 && semL.habiles === 5 && semL.total === 45500 && semL.serie[5].libre && !semL.serie[0].libre);
  ok('un feriado tampoco tiene meta (lunes 12/10)', L.resumenPasos(PASOS, '2026-10-12', '2026-10-12', 6000, '2026-10-14', libre).habiles === 0);
  {
    const T = { habits: [{ ...CAMINAR, goal: { unidad: 'min', piso: 6, meta: 10, sube: 5, tope: 45, desde: '2026-09-01' } }],
      marks: { '2026-10-07': { hP: 'yellow' }, '2026-10-08': { hP: 'yellow' } }, autoClosed: { '2026-10-07': ['hP'] },
      settings: { metaPasos: 8000 }, createdAt: '2026-09-01',
      pasos: { '2026-08-20': 9000, '2026-10-06': 9000, '2026-10-07': 8500, '2026-10-08': 9000, '2026-10-09': 7999,
               '2026-10-10': 12000, '2026-10-12': 9000, '2026-10-14': 8100, '2026-10-15': 9000 } };
    const M = cargarLogica(T);
    const marcados = M.marcarPorPasos(T, '2026-10-14');
    ok('llegar a 8.000 en día hábil marca "Caminar seguido" en verde solo: ' + marcados.join(), marcados.join() === '2026-10-06,2026-10-07,2026-10-14');
    ok('como marca de la app (si la tocás, pasa a ser tuya)', M.originOf(T, '2026-10-06', 'hP') === 'auto' && M.getMark('2026-10-07', 'hP') === 'green');
    ok('no toca lo que marcaste vos, ni el finde, ni el feriado, ni 7.999, ni el futuro, ni antes de empezar',
      T.marks['2026-10-08'].hP === 'yellow' && !T.marks['2026-10-10'] && !T.marks['2026-10-12'] && !T.marks['2026-10-09']
      && !T.marks['2026-10-15'] && !T.marks['2026-08-20']);
    ok('marcar dos veces no cambia nada', M.marcarPorPasos(T, '2026-10-14').length === 0);
    for (let i = 1; i <= 30; i++) (T.marks[M.iso(new Date(2026, 8, i))] ||= {}).hP = 'green';
    M.evaluarProgresion(T, '2026-10-14');
    ok('la meta en minutos del hábito de pasos ya no sube ni baja (se mide en pasos)', T.habits[0].goal.meta === 10);
  }
  const anio = L.resumenAnual(PASOS, 2026, 6000, '2026-10-14');
  ok('año: un resumen por mes, octubre con su promedio y los demás vacíos', anio.length === 12 && anio[9].promedio === 6700 && anio[8].dias === 0);
}

console.log('\n== 28. Pasos en la web ==');
{
  const st = { ...estado({ habits: [CAMINAR, { id: 'hA', name: 'Leer', order: 1 }] }), pasos: PASOS };
  st.settings.metaPasos = 6000;
  const { p, c, errs } = await abrirEn(HOY_FIJO, st);
  const fila = p.locator('.hrow', { hasText: 'Caminar seguido' });
  ok('en Hoy, "Caminar seguido" muestra los pasos de hoy contra la meta: ' + await fila.locator('.hsub').innerText(),
    (await fila.locator('.hsub').innerText()).includes('2.500/6.000 pasos') && await fila.locator('.dot[data-goal]').count() === 0);
  await ir(p, 'pasos');
  const hero = async () => (await p.locator('.hero').first().innerText()).split('\n')[0];
  const stats = async () => (await p.locator('.stats .stat b').allInnerTexts()).join(' | ');
  ok('arranca en la semana actual: ' + await p.locator('.mnav b').innerText(), (await p.locator('.mnav b').innerText()) === '12 al 18 de octubre');
  ok('total de la semana 17.300: ' + await hero(), await hero() === '17.300');
  ok('promedio 7.400; días hábiles con meta 0/2 (el lunes 12 es feriado); mejor 9K: ' + await stats(), await stats() === '7.400 | 0/2 | 9K');
  ok('no deja ir al futuro', await p.locator('[data-act="pmover"][data-n="1"]').isDisabled());
  ok('7 barras para tocar, la línea de meta en 6K', await p.locator('rect[data-act="pbar"]').count() === 7 && (await p.locator('svg').last().innerHTML()).includes('Meta 6K'));
  await p.locator('rect[data-act="pbar"][data-i="0"]').click();
  ok('tocar una barra muestra el día: ' + await p.locator('#pdet').innerText(), (await p.locator('#pdet').innerText()) === 'Lun 12 oct: 9.000 pasos · día libre');
  ok('los días libres van en azul, sin meta (el feriado 12)', (await p.locator('svg path[fill="var(--free)"]').count()) === 1);
  await p.locator('[data-act="pmover"][data-n="-1"]').click(); await p.waitForTimeout(100);
  ok('la semana anterior: 45.500 y 6.500 por día', (await p.locator('.mnav b').innerText()) === '5 al 11 de octubre' && await hero() === '45.500' && (await stats()).startsWith('6.500'));
  await p.locator('[data-act="pvista"][data-v="mes"]').click(); await p.waitForTimeout(100);
  ok('mes: octubre, 62.800 pasos, 6.700 por día, 3/7 hábiles con meta (sin finde ni feriado), mejor 12K: ' + await stats(), (await p.locator('.mnav b').innerText()) === 'Octubre 2026'
    && await hero() === '62.800' && await stats() === '6.700 | 3/7 | 12K' && await p.locator('rect[data-act="pbar"]').count() === 31
    && await p.locator('svg path[fill="var(--free)"]').count() === 3);
  await p.locator('summary').click();
  ok('"Ver los números" lista los 10 días con pasos', await p.locator('details tr').count() === 11);
  await p.locator('[data-act="pvista"][data-v="anio"]').click(); await p.waitForTimeout(100);
  ok('año: 12 barras (promedio de cada mes) y el total', (await p.locator('.mnav b').innerText()) === '2026' && await p.locator('rect[data-act="pbar"]').count() === 12 && await hero() === '62.800');
  await p.locator('rect[data-act="pbar"][data-i="9"]').click();
  ok('tocar octubre: ' + await p.locator('#pdet').innerText(), (await p.locator('#pdet').innerText()) === 'Octubre: 6.700 pasos por día · 62.800 en total');
  await p.locator('[data-act="pvista"][data-v="dia"]').click(); await p.waitForTimeout(100);
  ok('al cambiar de vista sigue en la fecha que venías mirando (mié 7)', (await p.locator('.mnav b').innerText()) === 'Mié 7 oct');
  ok('día cumplido: 6.500 pasos, 108 % (no se corta en 100)', await hero() === '6.500' && (await p.locator('.hero').innerText()).includes('108 % de la meta'));
  ok('vs. los 7 días anteriores (solo 2 con dato, promedio 6.000): ' + await stats(), await stats() === '6.000 | 6.000 | +500');
  await p.locator('[data-act="pmover"][data-n="1"]').click(); await p.locator('[data-act="pmover"][data-n="1"]').click(); await p.locator('[data-act="pmover"][data-n="1"]').click();
  ok('un sábado es día libre: sin meta ni barra de avance', (await p.locator('.mnav b').innerText()) === 'Sáb 10 oct'
    && (await p.locator('.hero').innerText()).includes('día libre, sin meta') && await p.locator('.meter').count() === 0
    && (await stats()).startsWith('Libre'));
  for (let i = 0; i < 4; i++) await p.locator('[data-act="pmover"][data-n="1"]').click();
  ok('día: hoy, 2.500 pasos, 42 % de la meta', (await p.locator('.mnav b').innerText()) === 'Hoy' && (await p.locator('.hero').innerText()).includes('42 % de la meta'));
  ok('día: meta, promedio de los 7 días anteriores y diferencia: ' + await stats(), await stats() === '6.000 | 6.900 | −4.400');
  ok('día: la semana de ese día con hoy resaltado', await p.locator('svg path[opacity]').count() === 2);
  ok('en la web ofrece importar el CSV', await p.locator('[data-act="importPasos"]').count() === 1 && await p.locator('[data-act="hcConectar"]').count() === 0);
  await p.locator('[data-act="pmeta"]').click(); await p.waitForTimeout(100);
  await p.locator('#metaPasos').fill('500'); await p.locator('.sheet [data-x="o"]').click();
  ok('la meta no acepta menos de 1.000', (await p.evaluate(() => window.__prime.S.settings.metaPasos)) === 6000 && await p.locator('#metaPasos').count() === 1);
  await p.locator('#metaPasos').fill('8000'); await p.locator('#metaPasos').press('Enter'); await p.waitForTimeout(150);
  ok('cambiar la meta a 8.000 mueve la línea y los días con meta', (await p.evaluate(() => window.__prime.S.settings.metaPasos)) === 8000
    && (await p.locator('svg').last().innerHTML()).includes('Meta 8K') && /Meta de lunes a viernes: 8\.000 pasos/.test(await p.locator('#view').innerText())
    && (await stats()).startsWith('8.000'));
  await p.evaluate(() => { window.__prime.S.settings.metaPasos = 6000; window.__prime.save(); window.__prime.render(); });
  ok('avisa que hay 6 días hábiles de "Caminar seguido" para revisar (sin finde ni feriado)', /6 días/.test(await p.locator('.alert.good').innerText()));
  await p.locator('[data-act="pmarcar"]').click(); await p.waitForTimeout(150);
  ok('"Revisar" abre la misma hoja que el import', (await p.locator('.sheet h3').innerText()) === 'Importar pasos' && await p.locator('.sheet input[type=checkbox]').count() === 6);
  await p.locator('.sheet [data-x="c"]').click();
  // CSV de Samsung Health: suma días y nunca baja uno que ya estaba
  const csv = ['com.samsung.shealth.step_daily_trend,6313002,1', 'update_time,source_pkg_name,count,distance,day_time,',
    '2026-10-04 23:00:00.000,com.sec.android.app.shealth,7777,5000,2026-10-04 00:00:00.000,',
    '2026-10-12 23:00:00.000,com.sec.android.app.shealth,100,80,2026-10-12 00:00:00.000,'].join('\n');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="importPasos"]').click()]);
  await fc.setFiles({ name: 'com.samsung.shealth.step_daily_trend.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await p.waitForTimeout(300);
  const pasos = await p.evaluate(() => window.__prime.S.pasos);
  ok('el CSV suma el 04/10 (7.777) y no baja el 12/10', pasos['2026-10-04'] === 7777 && pasos['2026-10-12'] === 9000);
  ok('avisa cuántos días cargó', /1 día de pasos cargado/.test(await p.locator('body').innerText()));
  await p.waitForTimeout(1400);
  ok('y después propone marcar "Caminar seguido"', (await p.locator('.sheet h3').innerText().catch(() => '')) === 'Importar pasos');
  const resp = await p.evaluate(() => {
    const P = window.__prime, base = JSON.parse(JSON.stringify(P.S)), r = [];
    for (const pasos of [{ '2026-10-12': 9000 }, { '2026-10-12': -5 }, { '2026-10-12': 1.5 }, { hoy: 3 }])
      try { P.prepararRespaldo(JSON.stringify({ ...base, pasos })); r.push('ok'); } catch (e) { r.push('no'); }
    return r.join();
  });
  ok('el respaldo trae los pasos y rechaza pasos rotos (' + resp + ')', resp === 'ok,no,no,no');
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();
}

console.log('\n== 29. App de Android: pasos desde Health Connect ==');
{
  // Health Connect simulado: disponible, con permiso o no, y los pasos por día como los devuelve capacitor-health
  const capacitorPasos = cfg => {
    window.__llamadas = []; window.__hc = cfg;
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android',
      nativePromise: async (plugin, metodo, op = {}) => {
        window.__llamadas.push({ plugin, metodo, op: JSON.parse(JSON.stringify(op)) });
        const hc = window.__hc;
        if (plugin !== 'HealthPlugin') return metodo === 'checkPermissions' ? { display: 'granted' } : metodo === 'getPending' ? { notifications: [] } : {};
        if (metodo === 'isHealthAvailable') return { available: hc.disponible };
        if (metodo === 'checkHealthPermissions') return { permissions: { READ_STEPS: hc.permiso } };
        if (metodo === 'requestHealthPermissions') { hc.permiso = hc.otorga; return { permissions: { READ_STEPS: hc.permiso } }; }
        if (metodo === 'queryAggregated') {
          if (hc.limite && op.startDate < hc.limite) throw new Error('Requested time range is outside the history window');
          return { aggregatedData: hc.datos };
        }
        if (metodo === 'queryRecords') return { records: hc.registros || [] };
        return {};
      }
    };
  };
  const abrirApp = async (cfg, ajustes = {}) => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c.clock.setFixedTime(new Date('2026-10-14T09:00:00'));
    const st = estado({ habits: [CAMINAR] }); Object.assign(st.settings, { metaPasos: 6000 }, ajustes);
    await c.addInitScript(s => localStorage.setItem('miPrime.v1', s), JSON.stringify(st));
    await c.addInitScript(capacitorPasos, cfg);
    const p = await c.newPage(); p.setDefaultTimeout(5000);
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(URL); await p.waitForTimeout(400);
    return { c, p, errs, llamadas: () => p.evaluate(() => window.__llamadas.filter(l => l.plugin === 'HealthPlugin')) };
  };
  const datos = [
    { startDate: '2026-10-11T00:00', endDate: '2026-10-12T00:00', value: null },
    { startDate: '2026-10-12T00:00', endDate: '2026-10-13T00:00', value: 9000 },
    { startDate: '2026-10-13T00:00', endDate: '2026-10-14T00:00', value: 5800 },
    { startDate: '2026-10-14T00:00', endDate: '2026-10-14T09:00', value: 2500 }];
  let { c, p, errs, llamadas } = await abrirApp({ disponible: true, permiso: false, otorga: true, datos });
  ok('al abrir mira Health Connect pero no pide permiso de sorpresa',
    (await llamadas()).some(l => l.metodo === 'checkHealthPermissions') && !(await llamadas()).some(l => l.metodo === 'requestHealthPermissions'));
  await ir(p, 'pasos');
  ok('sin permiso, Pasos ofrece conectar', await p.locator('[data-act="hcConectar"]').count() === 1 && await p.locator('[data-act="importPasos"]').count() === 0);
  await p.locator('[data-act="hcConectar"]').click(); await p.waitForTimeout(300);
  const pedido = (await llamadas()).find(l => l.metodo === 'requestHealthPermissions');
  const q1 = (await llamadas()).filter(l => l.metodo === 'queryAggregated').at(-1);
  ok('el botón pide solo leer pasos', JSON.stringify(pedido?.op) === '{"permissions":["READ_STEPS"]}');
  const diasAtras = (new Date('2026-10-14T09:00:00') - new Date(q1?.op.startDate)) / 864e5;
  ok(`la primera vez lee desde la medianoche de hace 29 días, dentro de los 30 que deja Health Connect sin permiso de historial (${diasAtras})`,
    q1?.op.dataType === 'steps' && q1.op.bucket === 'day' && q1.op.startDate === await p.evaluate(() => new Date(2026, 8, 15).toISOString()) && diasAtras < 30);
  const S1 = await p.evaluate(() => window.__prime.S);
  ok('guarda los pasos por día y saltea los días sin dato', JSON.stringify(S1.pasos) === '{"2026-10-12":9000,"2026-10-13":5800,"2026-10-14":2500}'
    && S1.settings.pasosHasta === '2026-10-14');
  ok('Pasos ya muestra la semana: 17.300', (await p.locator('.hero').first().innerText()).startsWith('17.300') && await p.locator('[data-act="hcConectar"]').count() === 0);
  ok('dice cuándo se actualizó', /Health Connect · actualizado a las 09:00/.test(await p.locator('#view').innerText()));
  await p.evaluate(() => { window.__hc.datos = [{ startDate: '2026-10-13T00:00', endDate: '2026-10-14T00:00', value: 6100 }]; });
  await p.locator('[data-act="hcActualizar"]').click(); await p.waitForTimeout(300);
  const q2 = (await llamadas()).filter(l => l.metodo === 'queryAggregated').at(-1);
  ok('después lee desde 3 días antes del último leído', q2.op.startDate === await p.evaluate(() => new Date(2026, 9, 11).toISOString()));
  ok('y si Samsung Health recalculó un día, se corrige', (await p.evaluate(() => window.__prime.S.pasos['2026-10-13'])) === 6100);
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();

  // Si la última lectura quedó muy atrás y Health Connect corta, se vuelve a los últimos 29 días
  ({ c, p, errs, llamadas } = await abrirApp({ disponible: true, permiso: true, datos, limite: new Date(2026, 8, 14).toISOString() }, { pasosHasta: '2026-08-01' }));
  await ir(p, 'pasos'); await p.waitForTimeout(300);
  const qs = (await llamadas()).filter(l => l.metodo === 'queryAggregated');
  ok('si Health Connect corta por el historial, reintenta con los últimos 29 días y lee igual',
    qs.length >= 2 && qs[0].op.startDate === await p.evaluate(() => new Date(2026, 6, 29).toISOString())
    && (await p.evaluate(() => window.__prime.S.pasos['2026-10-12'])) === 9000 && await p.locator('[data-act="hcConectar"]').count() === 0);
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();

  // Plan B: sin suma por día, pero con registros sueltos de dos apps
  const registros = [
    { startDate: '2026-10-13T12:00:00.000Z', endDate: '2026-10-13T12:30:00.000Z', value: 4000, sourceBundleId: 'com.sec.android.app.shealth' },
    { startDate: '2026-10-13T20:00:00.000Z', endDate: '2026-10-13T20:30:00.000Z', value: 3500, sourceBundleId: 'com.sec.android.app.shealth' },
    { startDate: '2026-10-13T12:00:00.000Z', endDate: '2026-10-13T12:30:00.000Z', value: 3900, sourceBundleId: 'otra.app' }];
  ({ c, p, llamadas } = await abrirApp({ disponible: true, permiso: true, datos: [], registros }));
  await ir(p, 'pasos'); await p.waitForTimeout(300);
  ok('si Health Connect no suma por día, la app suma los registros de Samsung Health (7.500, sin la otra app)',
    (await p.evaluate(() => JSON.stringify(window.__prime.S.pasos))) === '{"2026-10-13":7500}');
  await c.close();

  // Health Connect sin pasos: lo dice y deja abrir Health Connect para revisar
  ({ c, p, llamadas } = await abrirApp({ disponible: true, permiso: true, datos: [], registros: [] }));
  await ir(p, 'pasos'); await p.waitForTimeout(300);
  ok('con permiso pero sin pasos en Health Connect, explica qué revisar: ' + (await p.locator('#view').innerText()).slice(0, 120).replace(/\n/g, ' '), /Health Connect no tiene pasos todavía/i.test(await p.locator('#view').innerText()));
  await p.locator('[data-act="hcAbrir"]').click(); await p.waitForTimeout(150);
  ok('y "Abrir Health Connect" lo abre', (await llamadas()).some(l => l.metodo === 'openHealthConnectSettings'));
  ok('no da por leído un día sin pasos (la próxima vez vuelve a mirar 29 días)', (await p.evaluate(() => window.__prime.S.settings.pasosHasta)) === undefined);
  await c.close();

  // Llegar a la meta en día hábil marca "Caminar seguido" solo, sin entrar a Pasos
  ({ c, p, errs } = await abrirApp({ disponible: true, permiso: true, datos: [
    { startDate: '2026-10-12T00:00', endDate: '2026-10-13T00:00', value: 9000 },
    { startDate: '2026-10-13T00:00', endDate: '2026-10-14T00:00', value: 7000 },
    { startDate: '2026-10-14T00:00', endDate: '2026-10-14T09:00', value: 6500 }] }));
  await p.waitForTimeout(300);
  const marcas = await p.evaluate(() => ({ hoy: window.__prime.getMark('2026-10-14', 'hP'), ayer: window.__prime.getMark('2026-10-13', 'hP'),
    feriado: window.__prime.getMark('2026-10-12', 'hP') }));
  ok('al abrir la app, los días hábiles que llegaron a la meta quedan en verde (hoy y ayer); el feriado no: ' + JSON.stringify(marcas),
    marcas.hoy === 'green' && marcas.ayer === 'green' && marcas.feriado === null);
  ok('Hoy ya muestra el hábito en verde y avisa', await p.locator('.hrow', { hasText: 'Caminar seguido' }).locator('.dot.s-green').count() === 1
    && /en verde: llegaste a 6\.000 pasos/.test(await p.locator('body').innerText()));
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();

  ({ c, p, llamadas } = await abrirApp({ disponible: true, permiso: false, otorga: false, datos }));
  await ir(p, 'pasos');
  await p.locator('[data-act="hcConectar"]').click(); await p.waitForTimeout(300);
  ok('si no da el permiso, sigue ofreciendo conectar y no lee nada', await p.locator('[data-act="hcConectar"]').count() === 1
    && !(await llamadas()).some(l => l.metodo === 'queryAggregated'));
  await c.close();

  ({ c, p, llamadas } = await abrirApp({ disponible: false, permiso: false, otorga: false, datos }));
  await ir(p, 'pasos');
  await p.locator('[data-act="hcInstalar"]').click(); await p.waitForTimeout(200);
  ok('sin Health Connect, ofrece instalarlo', (await llamadas()).some(l => l.metodo === 'showHealthConnectInPlayStore'));
  await c.close();
}

console.log('\n== 30. Comida: metas de calorías y proteína ==');
{
  const L = cargarLogica(estado());
  const yo = { sexo: 'h', edad: 39, altura: 164, peso: 73.2, pesoMeta: 70, ritmo: 0.5, actividad: 1.55 };
  const m = L.metasNutricion(yo);
  ok(`Mifflin-St Jeor: base 1.567, gasto 2.429, −550 para 0,5 kg/semana → 1.880 kcal y 130 g, ~7 semanas: ${JSON.stringify(m)}`,
    m.tmb === 1567 && m.gasto === 2429 && m.deficit === 550 && m.kcal === 1880 && m.prot === 130 && m.semanas === 7 && m.faltan === 3.2);
  ok('con la fórmula de mujer el gasto base baja 166 kcal', L.metasNutricion({ ...yo, sexo: 'm' }).tmb === 1401);
  ok('en el peso meta no hay déficit: es mantener', L.metasNutricion({ ...yo, peso: 70 }).deficit === 0 && L.metasNutricion({ ...yo, peso: 70 }).semanas === 0);
  ok('nunca por debajo del piso de seguridad (1.500 hombre)', L.metasNutricion({ ...yo, peso: 45, altura: 150, edad: 80, actividad: 1.2, ritmo: 0.75, pesoMeta: 40 }).kcal === 1500);
  ok('perfil incompleto: no inventa una meta', L.metasNutricion({ ...yo, edad: undefined }) === null && L.metasNutricion(undefined) === null);
  ok('suma las comidas del día', JSON.stringify(L.totalComidas([{ kcal: 600, prot: 24 }, { kcal: 700, prot: 40 }])) === '{"kcal":1300,"prot":64}');
  const n = L.normalizarAnalisis({ items: [{ nombre: ' Milanesa ', porcion: '1', kcal: 450.6, proteina_g: 30 }, { nombre: '', kcal: 5 },
    { nombre: 'x', kcal: -3, proteina_g: '9' }, { nombre: 'y', kcal: 1e9, proteina_g: 1e9 }], nota: 'ok', confianza: 'rara' });
  ok('lo que dice Claude se limpia: sin nombres vacíos, sin negativos ni números absurdos',
    n.items.length === 3 && n.items[0].nombre === 'Milanesa' && n.items[0].kcal === 451 && n.items[1].kcal === 0 && n.items[1].prot === 9
    && n.items[2].kcal === 5000 && n.confianza === 'baja');
}

console.log('\n== 31. Comida en la web: perfil, a mano y foto con Claude (simulado) ==');
{
  const { p, c, errs } = await abrirEn(HOY_FIJO, estado());
  const pedidos = [];
  let respuesta = { status: 200, body: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 1300, output_tokens: 400 }, content: [{ type: 'text', text: JSON.stringify({ items: [
      { nombre: 'Milanesa de carne', porcion: '1 grande (180 g)', kcal: 450, proteina_g: 35 },
      { nombre: 'Puré de papas', porcion: '1 taza', kcal: 220, proteina_g: 5 }], nota: 'Sumé una cucharada de aceite.', confianza: 'media' }) }] } };
  await c.route('https://api.anthropic.com/**', async route => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    pedidos.push({ headers: route.request().headers(), body: route.request().postDataJSON(), url: route.request().url() });
    await route.fulfill({ status: respuesta.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(respuesta.body) });
  });
  await ir(p, 'comida');
  ok('sin perfil, pide completarlo', await p.locator('[data-act="cperfil"]').count() === 1 && /Completá tu perfil/.test(await p.locator('#view').innerText()));
  await p.locator('[data-act="cperfil"]').first().click();
  for (const [id, v] of [['#pEdad', '39'], ['#pAltura', '164'], ['#pPeso', '73.2'], ['#pMeta', '70']]) await p.locator(id).fill(v);
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  const S1 = await p.evaluate(() => window.__prime.S);
  ok('el perfil calcula 1.880 kcal y 130 g por día', /de 1\.880 kcal · quedan 1\.880/.test(await p.locator('.hero').innerText())
    && /0 g de 130 g de proteína/.test(await p.locator('#view').innerText()));
  ok('y guarda el perfil y el peso de hoy', S1.perfil.sexo === 'h' && S1.perfil.ritmo === 0.5 && S1.perfil.actividad === 1.55 && S1.pesos[HOY_FIJO] === 73.2);
  ok('dice cuánto falta: 3,2 kg, unas 7 semanas', /faltan 3,2 kg \(≈ 7 semanas a 0,5 kg por semana\)/.test(await p.locator('#view').innerText()));
  await p.locator('[data-act="cmano"]').click();
  await p.locator('#cNombre').fill('2 empanadas de carne'); await p.locator('#cKcal').fill('600'); await p.locator('#cProt').fill('24');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('agregar a mano suma al día: 600 kcal, quedan 1.280', /600/.test(await p.locator('.hero').innerText()) && /quedan 1\.280/.test(await p.locator('.hero').innerText())
    && await p.locator('.comida').count() === 1);
  // Foto: sin clave, primero pide la clave
  await p.locator('[data-act="cfoto"]').click(); await p.waitForTimeout(100);
  ok('para la foto primero pide la clave de Anthropic', await p.locator('.sheet #clave').count() === 1);
  await p.locator('#clave').fill('no-es-clave'); await p.locator('.sheet [data-x="o"]').click();
  ok('rechaza algo que no es una clave', await p.locator('.sheet #clave').count() === 1 && (await p.evaluate(() => localStorage.getItem('miPrime.claveIA'))) === null);
  const CLAVE = 'sk-ant-api03-' + 'x'.repeat(40);
  await p.locator('#clave').fill(CLAVE); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('la clave queda en el celular pero NO en tus datos ni en el respaldo', (await p.evaluate(() => localStorage.getItem('miPrime.claveIA'))) === CLAVE
    && !(await p.evaluate(() => JSON.stringify(window.__prime.S))).includes('sk-ant'));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="cfoto"]').click()]);
  ok('"Sacar foto" abre la cámara (capture) y "Elegir foto" la galería', (await fc.element().getAttribute('capture')) === 'environment');
  await fc.setFiles({ name: 'plato.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(300);
  await p.locator('#aclara').fill('la milanesa es de ternera');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(1500);
  const q = pedidos.at(-1);
  ok('manda la foto a Claude Opus 5.5 con el SDK oficial, desde el celular y con tu clave', q && q.body.model === 'claude-opus-5-5' && q.headers['x-api-key'] === CLAVE
    && q.headers['anthropic-dangerous-direct-browser-access'] === 'true' && /x-stainless/i.test(Object.keys(q.headers).join(' ')));
  ok('con fallback del servidor y respuesta con JSON schema fijo', q?.body.fallbacks === 'default' && /server-side-fallback-2026-07-01/.test(q.headers['anthropic-beta'])
    && q.body.output_config?.format?.type === 'json_schema' && q.body.output_config.format.schema.required.includes('items'));
  const img = q?.body.messages[0].content.find(b => b.type === 'image'), txt = q?.body.messages[0].content.find(b => b.type === 'text');
  ok('la foto va como JPEG achicado, con tu aclaración y el prompt de nutricionista', img?.source.media_type === 'image/jpeg' && img.source.data.length > 50
    && /ternera/.test(txt?.text) && /nutricionista/.test(q.body.system));
  ok('muestra lo que vio Claude: 2 platos, 670 kcal, 40 g', await p.locator('.sheet .item input[data-k="kcal"]').count() === 2
    && /670 kcal · 40 g/.test(await p.locator('#totalIA').innerText()) && /aceite/.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet input[data-k="kcal"][data-i="1"]').fill('250');
  ok('se pueden corregir los números antes de guardar', /700 kcal · 40 g/.test(await p.locator('#totalIA').innerText()));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  const hoy = await p.evaluate(d => window.__prime.S.comidas[d], HOY_FIJO);
  ok('se guarda como una comida con su detalle: el día suma 1.300 kcal y 64 g', hoy.length === 2 && hoy[1].kcal === 700 && hoy[1].prot === 40
    && hoy[1].origen === 'foto' && hoy[1].detalle.length === 2 && /1\.300/.test(await p.locator('.hero').innerText())
    && /64 g de 130 g/.test(await p.locator('#view').innerText()));
  // Errores claros
  respuesta = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="cgaleria"]').click()]);
  ok('"Elegir foto" no fuerza la cámara', (await fc2.element().getAttribute('capture')) === null);
  await fc2.setFiles({ name: 'plato.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(300);
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(1200);
  ok('si la clave no sirve, lo dice y deja reintentar', /La clave de Anthropic no es válida/.test(await p.locator('body').innerText())
    && (await p.locator('.sheet [data-x="o"]').innerText()) === 'Reintentar');
  await p.locator('.sheet [data-x="c"]').click();
  await p.locator('[data-act="cborrar"][data-i="0"]').click(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('borrar una comida pide confirmación y la saca', (await p.evaluate(d => window.__prime.S.comidas[d].length, HOY_FIJO)) === 1);
  await p.locator('[data-act="cpeso"]').click(); await p.locator('#pPesoHoy').fill('72.8'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  const S2 = await p.evaluate(() => window.__prime.S);
  ok('registrar el peso recalcula la meta', S2.perfil.peso === 72.8 && S2.pesos[HOY_FIJO] === 72.8 && /de 1\.870 kcal/.test(await p.locator('.hero').innerText()));
  const resp = await p.evaluate(() => {
    const P = window.__prime, base = JSON.parse(JSON.stringify(P.S)), r = [];
    for (const extra of [{}, { comidas: { '2026-10-14': [{ nombre: 'x', kcal: -1, prot: 0 }] } }, { pesos: { hoy: 70 } }, { perfil: 'yo' }])
      try { P.prepararRespaldo(JSON.stringify({ ...base, ...extra })); r.push('ok'); } catch (e) { r.push('no'); }
    return r.join();
  });
  ok('el respaldo trae comidas, pesos y perfil, y rechaza los rotos (' + resp + ')', resp === 'ok,no,no,no');
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();
}

console.log('\n== 32. Capturas ==');
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
