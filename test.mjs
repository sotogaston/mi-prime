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
ok('nav con 8 pestañas (Hoy, Mes, Semanas, Pasos, Comida, Gastos, Finanzas, Más)', (await page.locator('nav button').count()) === 8);

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
  ok('sin clave, a mano pide las calorías y avisa que con la clave las calcula Claude', (await p.locator('.sheet [data-x="o"]').innerText()) === 'Agregar'
    && /Claude las calcula/.test(await p.locator('.sheet').innerText()));
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
  ok('con una foto ofrece sumar hasta 3 más', await p.locator('.sheet .fotos img').count() === 1 && /hasta 3 fotos más/.test(await p.locator('.sheet').innerText()));
  const [fcMas] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.sheet [data-x="mg"]').click()]);
  await fcMas.setFiles({ name: 'ensalada.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(300);
  ok('se suma la segunda y la aclaración no se pierde', await p.locator('.sheet .fotos img').count() === 2
    && (await p.locator('#aclara').inputValue()) === 'la milanesa es de ternera' && /Analizar 2 fotos/.test(await p.locator('.sheet [data-x="o"]').innerText()));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(1500);
  const q = pedidos.at(-1);
  ok('manda la foto a Claude Opus 5.5 con el SDK oficial, desde el celular y con tu clave', q && q.body.model === 'claude-opus-5-5' && q.headers['x-api-key'] === CLAVE
    && q.headers['anthropic-dangerous-direct-browser-access'] === 'true' && /x-stainless/i.test(Object.keys(q.headers).join(' ')));
  ok('con fallback del servidor y respuesta con JSON schema fijo', q?.body.fallbacks === 'default' && /server-side-fallback-2026-07-01/.test(q.headers['anthropic-beta'])
    && q.body.output_config?.format?.type === 'json_schema' && q.body.output_config.format.schema.required.includes('items'));
  const img = q?.body.messages[0].content.find(b => b.type === 'image'), txt = q?.body.messages[0].content.find(b => b.type === 'text');
  ok('la foto va como JPEG achicado, con tu aclaración y el prompt de nutricionista', img?.source.media_type === 'image/jpeg' && img.source.data.length > 50
    && /ternera/.test(txt?.text) && /nutricionista/.test(q.body.system));
  ok('las dos fotos van juntas en un solo pedido, avisando que son de la misma comida', q.body.messages[0].content.filter(b => b.type === 'image').length === 2
    && /Son 2 fotos de la misma comida/.test(txt?.text) && /no cuentes dos veces/.test(q.body.system));
  ok('muestra lo que vio Claude: 2 platos, 670 kcal, 40 g', await p.locator('.sheet .item input[data-k="kcal"]').count() === 2
    && /670 kcal · 40 g/.test(await p.locator('#totalIA').innerText()) && /aceite/.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet input[data-k="kcal"][data-i="1"]').fill('250');
  ok('se pueden corregir los números antes de guardar', /700 kcal · 40 g/.test(await p.locator('#totalIA').innerText()));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  const hoy = await p.evaluate(d => window.__prime.S.comidas[d], HOY_FIJO);
  ok('se guarda como una comida con su detalle: el día suma 1.300 kcal y 64 g', hoy.length === 2 && hoy[1].kcal === 700 && hoy[1].prot === 40
    && hoy[1].origen === 'foto' && hoy[1].detalle.length === 2 && /1\.300/.test(await p.locator('.hero').innerText())
    && /64 g de 130 g/.test(await p.locator('#view').innerText()));
  // A mano sin calorías: las calcula Claude con lo escrito
  respuesta = { status: 200, body: { ...respuesta.body, content: [{ type: 'text', text: JSON.stringify({ items: [
    { nombre: 'Tostadas con queso untable', porcion: '2 tostadas', kcal: 210, proteina_g: 8 },
    { nombre: 'Café con leche', porcion: '1 taza', kcal: 90, proteina_g: 5 }], nota: '', confianza: 'alta' }) }] } };
  const antes = pedidos.length;
  await p.locator('[data-act="cmano"]').click();
  ok('con clave y sin calorías, el botón es "Calcular"', (await p.locator('.sheet [data-x="o"]').innerText()) === 'Calcular');
  await p.locator('#cKcal').fill('100');
  ok('si ponés las calorías, vuelve a "Agregar"', (await p.locator('.sheet [data-x="o"]').innerText()) === 'Agregar');
  await p.locator('#cKcal').fill('');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('sin nombre no le pregunta nada a Claude', pedidos.length === antes && await p.locator('.sheet #cNombre').count() === 1);
  await p.locator('#cNombre').fill('2 tostadas con queso untable y café con leche');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(1500);
  const qt = pedidos.at(-1), bloques = qt?.body.messages[0].content || [];
  ok('manda solo el texto a Claude Opus 5.5, sin foto', pedidos.length === antes + 1 && qt.body.model === 'claude-opus-5-5'
    && !bloques.some(b => b.type === 'image') && /Comí: 2 tostadas con queso untable y café con leche/.test(bloques[0]?.text)
    && /lo que la persona escribe/.test(qt.body.system));
  ok('muestra lo que calcula Claude: 300 kcal, 13 g, y se puede corregir', /Lo que calcula Claude/.test(await p.locator('.sheet').innerText())
    && /300 kcal · 13 g/.test(await p.locator('#totalIA').innerText()));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  const hoyT = await p.evaluate(d => window.__prime.S.comidas[d], HOY_FIJO);
  ok('se guarda con el nombre que escribiste y su detalle', hoyT.length === 3 && hoyT[2].nombre === '2 tostadas con queso untable y café con leche'
    && hoyT[2].kcal === 300 && hoyT[2].prot === 13 && hoyT[2].origen === 'texto' && hoyT[2].detalle.length === 2);
  // Errores claros
  respuesta = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="cgaleria"]').click()]);
  ok('"Elegir foto" no fuerza la cámara y deja elegir varias', (await fc2.element().getAttribute('capture')) === null && fc2.isMultiple());
  await fc2.setFiles(['a', 'b', 'c'].map(n => ({ name: n + '.png', mimeType: 'image/png', buffer: PNG }))); await p.waitForTimeout(400);
  ok('elegidas de a varias entran juntas', await p.locator('.sheet .fotos img').count() === 3);
  const [fc3] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.sheet [data-x="mg"]').click()]);
  await fc3.setFiles(['d', 'e'].map(n => ({ name: n + '.png', mimeType: 'image/png', buffer: PNG }))); await p.waitForTimeout(400);
  ok('nunca más de 4: la quinta no entra y ya no ofrece sumar', await p.locator('.sheet .fotos img').count() === 4
    && await p.locator('.sheet [data-x="mg"]').count() === 0 && /Hasta 4 fotos/.test(await p.locator('body').innerText()));
  await p.locator('.sheet .fotos [data-q="3"]').click(); await p.waitForTimeout(100);
  ok('una foto se puede sacar, y vuelve a ofrecer sumar', await p.locator('.sheet .fotos img').count() === 3 && await p.locator('.sheet [data-x="mg"]').count() === 1);
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(1200);
  ok('si la clave no sirve, lo dice y deja reintentar', /La clave de Anthropic no es válida/.test(await p.locator('body').innerText())
    && (await p.locator('.sheet [data-x="o"]').innerText()) === 'Reintentar');
  await p.locator('.sheet [data-x="c"]').click();
  await p.locator('[data-act="cborrar"][data-i="0"]').click(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('borrar una comida pide confirmación y la saca', (await p.evaluate(d => window.__prime.S.comidas[d].length, HOY_FIJO)) === 2);
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

console.log('\n== 32. Reflexión de la mañana y de la tarde ==');
{
  const marks = { '2026-09-03': { hA: 'green', hB: 'yellow' }, '2026-10-13': { hA: 'green', hB: 'green' } };
  const L = cargarLogica(estado({ marks }));
  const dias = Array.from({ length: 400 }, (_, i) => L.iso(new Date(2026, 9, 1 + i)));
  const turnos = dias.flatMap(d => [L.fraseDelDia(d), L.fraseDelDia(d, true)]);
  ok('16 frases: las 6 de antes y 10 nuevas sobre la disciplina', L.REFLEXIONES.length === 16 && new Set(L.REFLEXIONES.map(f => f.t)).size === 16);
  ok('cada día la de la mañana y la de la tarde son distintas, y nunca se repite la anterior', turnos.every((f, i) => i === 0 || f !== turnos[i - 1]));
  const inicio = dias.findIndex(d => Math.round(new Date(d + 'T00:00').getTime() / 864e5) * 2 % 16 === 0);
  const mazo = turnos.slice(inicio * 2, inicio * 2 + 16);
  ok('en orden aleatorio y sin repetir hasta pasar por las 16 (8 días)', new Set(mazo).size === 16
    && mazo.map(f => L.REFLEXIONES.indexOf(f)).join() !== [...Array(16).keys()].join());
  ok('es la misma frase si se vuelve a abrir el mismo día', L.fraseDelDia('2026-10-14', true) === L.fraseDelDia('2026-10-14', true));
  ok('siguen la de la disciplina, la de quedarse quieto y la de Aristóteles', L.REFLEXIONES.some(f => /cada año termina igual/.test(f.t))
    && L.REFLEXIONES.some(f => /quedarte en el mismo lugar duele más que avanzar/.test(f.t))
    && L.REFLEXIONES.some(f => /La calidad no es un acto, es un hábito/.test(f.t) && /Aristóteles/.test(f.de)));
  ok('lo que se está cocinando: cuenta los verdes y desde cuándo', JSON.stringify(L.loQueSeCocina(estado({ marks }))) === '{"verdes":3,"desde":"2026-09-03"}'
    && L.loQueSeCocina(estado()).verdes === 0);

  const { p, c: ctx, errs } = await abrirEn(HOY_FIJO, estado({ marks }));
  const [manana, tarde] = await p.evaluate(d => [window.__prime.fraseDelDia(d).t, window.__prime.fraseDelDia(d, true).t], HOY_FIJO);
  ok('a las 12 Hoy muestra la reflexión de la mañana', /Reflexión de la mañana/.test(await p.locator('.reflex').textContent())
    && (await p.locator('.reflex .frase').innerText()) === manana);
  await p.locator('.reflex').click(); await p.waitForTimeout(100);
  ok('tocándola se ven las 16, con las dos de hoy marcadas', await p.locator('.sheet blockquote').count() === 16
    && await p.locator('.sheet blockquote.hoy').count() === 2 && /Hoy a la mañana/.test(await p.locator('.sheet').innerText())
    && /Hoy a la tarde/.test(await p.locator('.sheet').innerText()));
  ok('y lo acumulado: 3 veces en verde desde el 3 de septiembre', /3 veces en verde desde el 3 de septiembre/.test(await p.locator('.sheet .cocina').innerText()));
  await p.locator('.sheet [data-x="c"]').click(); await p.waitForTimeout(100);
  ok('"Seguir" la cierra', await p.locator('.sheet').count() === 0);
  await ctx.clock.setFixedTime(new Date(HOY_FIJO + 'T15:00:00'));
  await p.evaluate(() => window.__prime.render()); await p.waitForTimeout(100);
  ok('desde las 14 cambia a la de la tarde, que es otra', /Reflexión de la tarde/.test(await p.locator('.reflex').textContent())
    && (await p.locator('.reflex .frase').innerText()) === tarde && tarde !== manana);
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await ctx.close();
}

console.log('\n== 33. Comidas: tipo, aviso de las 22, editar, frecuentes e historial ==');
{
  const L = cargarLogica(estado());
  ok('el tipo sale de la hora: desayuno hasta las 11, almuerzo hasta 16:30, merienda hasta 20:30, después cena',
    ['08:30', '10:59', '11:00', '16:29', '16:30', '20:29', '20:30', '02:00'].map(L.tipoPorHora).join() === 'desayuno,desayuno,almuerzo,almuerzo,merienda,merienda,cena,cena'
    && L.tipoPorHora('') === null);
  ok('el tipo elegido manda sobre la hora, y sin hora ni tipo es colación', L.tipoDe({ hora: '13:47', tipo: 'desayuno' }) === 'desayuno'
    && L.tipoDe({ hora: '13:47' }) === 'almuerzo' && L.tipoDe({}) === 'colacion' && L.tipoDe({ hora: '9:00', tipo: 'brunch' }) === 'colacion');
  ok('faltan las que no se cargaron; la colación no cuenta', L.faltanComidas([{ hora: '08:30' }, { hora: '13:40' }, { tipo: 'colacion' }]).join() === 'merienda,cena'
    && L.faltanComidas(undefined).length === 4 && L.nombresComidas(['desayuno', 'merienda', 'cena']) === 'el desayuno, la merienda y la cena');
  const com = { '2026-10-14': [{ hora: '08:30' }, { hora: '13:40' }] };
  const plan = L.planAvisoComidas(com, new Date(2026, 9, 14, 15, 0), 3, '22:00');
  ok('a las 22 avisa qué falta hoy; los días que vienen, que no hay nada cargado', plan.length === 3 && plan[0].id === 500000
    && plan[0].title === 'Falta cargar la merienda y la cena' && plan[0].at.getHours() === 22 && plan[1].title === 'No cargaste ninguna comida hoy'
    && plan.every(a => a.canal === 'comidas'));
  ok('con las cuatro cargadas, o pasada la hora, hoy no avisa', L.planAvisoComidas({ '2026-10-14': ['08:00', '13:00', '18:00', '21:00'].map(hora => ({ hora })) },
      new Date(2026, 9, 14, 21, 30), 1, '22:00').length === 0 && L.planAvisoComidas(com, new Date(2026, 9, 14, 22, 30), 1, '22:00').length === 0
    && L.planAvisoComidas(com, new Date(2026, 9, 14, 8, 0), 14, 'no').length === 0);

  const yo = { sexo: 'h', edad: 39, altura: 164, peso: 72.2, pesoMeta: 70, ritmo: 0.5, actividad: 1.55 };
  const st = { ...estado(), perfil: yo, comidas: {
    [HOY_FIJO]: [{ id: 'a', hora: '08:30', nombre: 'Café con leche y 2 huevos', kcal: 350, prot: 21 },
                 { id: 'b', hora: '13:40', nombre: 'Fideos con pollo', kcal: 535, prot: 28 }],
    '2026-10-13': [{ id: 'c', hora: '08:32', nombre: 'Café', kcal: 350, prot: 21 }, { id: 'd', hora: '13:33', nombre: 'Sanguche', kcal: 402, prot: 27 },
                   { id: 'e', hora: '19:53', nombre: 'Jugo y nueces', kcal: 317, prot: 7 }, { id: 'f', hora: '22:06', nombre: 'Pizza', kcal: 735, prot: 35 }],
    '2026-10-12': [{ id: 'g', hora: '12:19', nombre: 'Tostado', kcal: 366, prot: 15 }] } };
  const { p, c: ctx, errs } = await abrirEn(HOY_FIJO, st);
  const S = () => p.evaluate(() => window.__prime.S);
  ok('a las 12 no hay alerta de comidas', await p.locator('.alerta-comidas').count() === 0);
  await ir(p, 'comida');
  ok('cada comida dice qué es: desayuno y almuerzo', (await p.locator('.comida .hm').allInnerTexts()).map(t => t.split('\n')[0]).join() === 'Desayuno,Almuerzo');
  ok('y abajo cuándo avisa', /A las 22:00|Desde las 22:00/.test(await p.locator('.pie').first().innerText()));
  // Editar
  await p.locator('[data-act="ceditar"][data-i="0"]').click(); await p.waitForTimeout(100);
  ok('tocar una comida la abre para editar', (await p.locator('#eNombre').inputValue()) === 'Café con leche y 2 huevos' && (await p.locator('#eTipo').inputValue()) === 'desayuno');
  await p.locator('#eKcal').fill('380'); await p.locator('#eFrec').check();
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  let s = await S();
  ok('guarda los cambios y la suma a frecuentes como desayuno', s.comidas[HOY_FIJO][0].kcal === 380 && s.comidas[HOY_FIJO][0].tipo === 'desayuno'
    && s.frecuentes.length === 1 && s.frecuentes[0].tipo === 'desayuno' && s.frecuentes[0].kcal === 380);
  ok('a las 12 no muestra el desayuno frecuente (es hora de almuerzo)', await p.locator('#view .frec').count() === 0
    && /Frecuentes \(1\)/.test(await p.locator('[data-act="cfrecs"]').innerText()));
  // Frecuentes: un toque y queda cargada
  await p.locator('[data-act="cfrecs"]').click(); await p.waitForTimeout(100);
  await p.locator('.sheet [data-act="cfrec"]').click(); await p.waitForTimeout(150);
  s = await S();
  ok('una frecuente se carga con un toque, como desayuno aunque sean las 12', s.comidas[HOY_FIJO].length === 3
    && s.comidas[HOY_FIJO][2].tipo === 'desayuno' && s.comidas[HOY_FIJO][2].origen === 'frecuente' && s.comidas[HOY_FIJO][2].kcal === 380);
  await p.locator('[data-act="cfrecs"]').click(); await p.waitForTimeout(100);
  await p.locator('.sheet [data-q]').click(); await p.waitForTimeout(100);
  ok('y se puede sacar de frecuentes', (await S()).frecuentes.length === 0);
  await p.locator('.sheet [data-x="c"]').click(); await p.waitForTimeout(100);
  // A mano con tipo y frecuente
  await p.locator('[data-act="cmano"]').click(); await p.waitForTimeout(100);
  ok('a mano propone el tipo por la hora', (await p.locator('#cTipo').inputValue()) === 'almuerzo');
  await p.locator('#cNombre').fill('Yogur con granola'); await p.locator('#cTipo').selectOption('merienda');
  await p.locator('#cKcal').fill('250'); await p.locator('#cProt').fill('15'); await p.locator('#cFrec').check();
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  s = await S();
  ok('a mano se guarda con el tipo elegido y como frecuente', s.comidas[HOY_FIJO][3].tipo === 'merienda' && s.frecuentes.length === 1 && s.frecuentes[0].nombre === 'Yogur con granola');
  // Historial
  await p.locator('tr[data-d="2026-10-13"]').click(); await p.waitForTimeout(100);
  ok('tocar un día de la tabla muestra lo que comiste ese día', await p.locator('.sheet .comida').count() === 4
    && /1\.804 kcal de 1\.860/.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet [data-x="ant"]').click(); await p.waitForTimeout(100);
  ok('‹ va al día anterior', /lun 12 oct/.test(await p.locator('.sheet .mnav b').textContent()) && await p.locator('.sheet .comida').count() === 1
    && /Sin cargar: el desayuno, la merienda y la cena/.test(await p.locator('.sheet').innerText()));
  ok('y no deja ir antes del primer día con comidas', await p.locator('.sheet [data-x="ant"]').isDisabled());
  await p.locator('.sheet [data-x="sig"]').click(); await p.waitForTimeout(100);
  await p.locator('.sheet [data-x="a"]').click(); await p.waitForTimeout(100);
  ok('se puede agregar algo a un día pasado', /Agregar al mar 13 oct/.test(await p.locator('.sheet h3').innerText()));
  await p.locator('#cNombre').fill('1 mandarina'); await p.locator('#cTipo').selectOption('colacion'); await p.locator('#cKcal').fill('48');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  s = await S();
  const m13 = s.comidas['2026-10-13'][4];
  ok('queda en ese día, sin hora y como colación, y vuelve al día', m13.nombre === '1 mandarina' && m13.tipo === 'colacion' && m13.hora === undefined
    && await p.locator('.sheet .comida').count() === 5);
  await p.locator('.sheet [data-act="ceditar"]').first().click(); await p.waitForTimeout(100);
  ok('desde el historial también se edita', (await p.locator('#eNombre').inputValue()) === 'Café');
  await p.locator('.sheet [data-x="b"]').click(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('y se borra, volviendo al día', (await S()).comidas['2026-10-13'].length === 4 && await p.locator('.sheet .comida').count() === 4);
  await p.locator('.sheet [data-x="c"]').click(); await p.waitForTimeout(100);
  // Aviso de las 22
  await ctx.clock.setFixedTime(new Date(HOY_FIJO + 'T22:30:00'));
  await ir(p, 'hoy');
  ok('a las 22:30 Hoy avisa que falta la cena', /Falta cargar la cena\./.test(await p.locator('.alerta-comidas').innerText()));
  await p.locator('.alerta-comidas [data-act="irComida"]').click(); await p.waitForTimeout(100);
  ok('y lleva a Comida, que también lo muestra', await p.locator('nav button[data-tab="comida"][aria-current="true"]').count() === 1
    && await p.locator('.alerta-comidas').count() === 1);
  await p.locator('[data-act="cmano"]').click();
  ok('a esa hora propone cena', (await p.locator('#cTipo').inputValue()) === 'cena');
  await p.locator('#cNombre').fill('Pollo con ensalada'); await p.locator('#cKcal').fill('500'); await p.locator('#cProt').fill('45');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('con la cena cargada, la alerta se va', await p.locator('.alerta-comidas').count() === 0);
  await p.locator('[data-act="caviso"]').click(); await p.locator('#aHora').fill('23:00'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('la hora del aviso se cambia', (await S()).settings.avisoComidas === '23:00' && /23:00/.test(await p.locator('.pie').first().innerText()));
  await p.locator('[data-act="caviso"]').click(); await p.locator('.sheet [data-x="n"]').click(); await p.waitForTimeout(100);
  ok('y se puede apagar', (await S()).settings.avisoComidas === 'no' && /Sin aviso de comidas/.test(await p.locator('.pie').first().innerText()));
  const resp = await p.evaluate(() => {
    const P = window.__prime, base = JSON.parse(JSON.stringify(P.S)), r = [];
    for (const extra of [{}, { comidas: { '2026-10-14': [{ nombre: 'x', kcal: 1, prot: 0, tipo: 'brunch' }] } }, { frecuentes: [{ nombre: 'x', kcal: 1, prot: 0 }] }, { frecuentes: {} }])
      try { P.prepararRespaldo(JSON.stringify({ ...base, ...extra })); r.push('ok'); } catch (e) { r.push('no'); }
    return r.join();
  });
  ok('el respaldo trae tipos y frecuentes, y rechaza los rotos (' + resp + ')', resp === 'ok,no,no,no');
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await ctx.close();

  // En la app: el aviso de las 22 va como notificación del celular
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c2.clock.setFixedTime(new Date(HOY_FIJO + 'T15:00:00'));
  await c2.addInitScript(s => localStorage.setItem('miPrime.v1', s), JSON.stringify({ ...st, frecuentes: [] }));
  await c2.addInitScript(() => {
    window.__llamadas = [];
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android',
      nativePromise: async (plugin, metodo, op = {}) => {
        window.__llamadas.push({ plugin, metodo, op: JSON.parse(JSON.stringify(op)) });
        if (metodo === 'checkPermissions') return { display: 'granted' };
        if (metodo === 'getPending') return { notifications: [] };
        if (metodo === 'isHealthAvailable') return { available: false };
        return {};
      } };
  });
  const p2 = await c2.newPage(); p2.setDefaultTimeout(5000);
  const errs2 = []; p2.on('pageerror', e => errs2.push(String(e)));
  await p2.goto(URL); await p2.waitForTimeout(1200);
  const ll = await p2.evaluate(() => window.__llamadas);
  const ag = ll.filter(l => l.metodo === 'schedule').at(-1)?.op.notifications || [];
  const hoy22 = ag.find(n => n.id === 500000);
  ok('en la app programa el aviso de hoy a las 22 con lo que falta, en el canal "Comidas"', hoy22?.title === 'Falta cargar la merienda y la cena'
    && hoy22.channelId === 'comidas' && hoy22.schedule.at === await p2.evaluate(() => new Date(2026, 9, 14, 22, 0).toISOString())
    && ll.some(l => l.metodo === 'createChannel' && l.op.id === 'comidas'));
  ok('y uno por día para las dos semanas que vienen', ag.filter(n => n.channelId === 'comidas').length === 14);
  ok('sin errores de página: ' + JSON.stringify(errs2), errs2.length === 0);
  await c2.close();
}

console.log('\n== 34. Hábitos con meta: sí o no ==');
{
  const st = estado({ habits: [{ id: 'hE', name: 'Ejercicio', order: 0, hora: '19:00', goal: { unidad: 'series', piso: 5, meta: 9, sube: 3, tope: 21, desde: '2026-09-28' } },
                               { id: 'hC', name: 'Caminar seguido', order: 1, goal: { unidad: 'min', piso: 6, meta: 10, sube: 5, tope: 45, desde: '2026-09-28' }, auto: { source: 'steps', threshold: 6000, near: 0.9 } }] });
  const { p, c: ctx, errs } = await abrirEn(HOY_FIJO, st);
  ok('con meta, Hoy muestra las series', /9 series/.test(await p.locator('.hrow', { hasText: 'Ejercicio' }).innerText()));
  await ir(p, 'mas');
  await p.locator('[data-act="editH"][data-h="hE"]').click(); await p.waitForTimeout(100);
  ok('Editar hábito ofrece medir con meta, tildado', await p.locator('#eg').isChecked() && /9 series/.test(await p.locator('.sheet').innerText()));
  await p.locator('#eg').uncheck(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  let h = (await p.evaluate(() => window.__prime.S)).habits[0];
  ok('destildado, pasa a sí o no y la meta queda guardada', !h.goal && h.metaGuardada?.meta === 9);
  await ir(p, 'hoy');
  ok('y en Hoy ya no pide series', !/series/.test(await p.locator('.hrow', { hasText: 'Ejercicio' }).innerText()));
  await ir(p, 'mas');
  await p.locator('[data-act="editH"][data-h="hE"]').click(); await p.waitForTimeout(100);
  await p.locator('#eg').check(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  h = (await p.evaluate(() => window.__prime.S)).habits[0];
  ok('volver a tildarlo recupera la meta', h.goal?.meta === 9 && !h.metaGuardada);
  await p.locator('[data-act="editH"][data-h="hC"]').click(); await p.waitForTimeout(100);
  ok('el de pasos no ofrece la opción (se mide en pasos)', await p.locator('#eg').count() === 0);
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await ctx.close();
}

console.log('\n== 35. Cintura ==');
{
  const L = cargarLogica(estado());
  ok('95 cm con 164 de altura: cintura/altura 0,58; lo sano es menos de 82 cm', JSON.stringify(L.cinturaAltura(95, 164)) === '{"ratio":0.58,"sana":82}'
    && L.cinturaAltura(undefined, 164) === null);
  const mc = L.metaCintura({ '2026-10-18': 95 }, 164, 0.5);
  ok('meta de cintura: 82 cm, faltan 13; a 0,45 cm por semana llega el 9 de mayo, con una etapa en 90 cm el 10 de enero: ' + JSON.stringify(mc),
    mc.objetivo === 82 && mc.faltan === 13 && !mc.medido && mc.porSemana === 0.45 && mc.fecha === '2027-05-09'
    && mc.hito.cm === 90 && mc.hito.fecha === '2027-01-10');
  const medida = L.metaCintura({ '2026-09-20': 97, '2026-10-18': 95 }, 164, 0.5);
  ok('con dos semanas de medidas usa lo que viene bajando (0,5 cm por semana)', medida.medido && medida.porSemana === 0.5 && medida.fecha === '2027-04-18');
  ok('si baja demasiado rápido no promete más de 0,75 cm por semana', L.metaCintura({ '2026-10-04': 97, '2026-10-18': 95 }, 164, 0.5).porSemana === 0.75);
  ok('si no bajó, sigue con el ritmo de peso', L.metaCintura({ '2026-09-20': 95, '2026-10-18': 96 }, 164, 0.25).porSemana === 0.23
    && !L.metaCintura({ '2026-09-20': 95, '2026-10-18': 96 }, 164, 0.25).medido);
  ok('debajo de media altura ya llegó', L.metaCintura({ '2026-10-18': 81 }, 164, 0.5).llego === true && L.metaCintura({}, 164, 0.5) === null);
  ok('el cambio se cuenta desde la primera medida', JSON.stringify(L.cambioCintura({ '2026-10-21': 95.5, '2026-10-07': 97, '2026-10-14': 96 })) === '{"desde":"2026-10-07","cambio":-1.5}'
    && L.cambioCintura({ '2026-10-07': 97 }) === null && L.cambioCintura(undefined) === null);

  const yo = { sexo: 'h', edad: 39, altura: 164, peso: 72.2, pesoMeta: 70, ritmo: 0.5, actividad: 1.55 };
  const { p, c: ctx, errs } = await abrirEn(HOY_FIJO, { ...estado(), perfil: yo });
  await ir(p, 'comida');
  ok('sin cintura cargada, Tu meta no la muestra', await p.locator('.cintura').count() === 0
    && /Registrar medidas/.test(await p.locator('[data-act="cpeso"]').innerText()));
  await p.locator('[data-act="cpeso"]').click();
  await p.locator('#pCintura').fill('20'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('una cintura rara no se guarda', await p.locator('.sheet #pCintura').count() === 1);
  await p.locator('#pCintura').fill('95'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  let S = await p.evaluate(() => window.__prime.S);
  ok('se registra con el peso: 95 cm hoy', S.perfil.cintura === 95 && S.cinturas[HOY_FIJO] === 95 && S.pesos[HOY_FIJO] === 72.2);
  const linea = await p.locator('.cintura').innerText();
  ok('Tu meta muestra la cintura y la relación con la altura: ' + JSON.stringify(linea), /Cintura 95 cm/.test(linea) && /0,58/.test(linea) && /menos de 82 cm/.test(linea));
  const meta = await p.locator('.meta-cintura').innerText();
  ok('y la meta de cintura con fecha estimada: ' + JSON.stringify(meta), /Meta de cintura 82 cm · faltan 13 cm/.test(meta) && /mayo de 2027/.test(meta)
    && /próxima etapa 90 cm ≈ 6 de enero/.test(meta) && /Estimado a 0,45 cm por semana por tu ritmo de peso/.test(meta));
  await p.locator('[data-act="cpeso"]').click();
  ok('la próxima vez muestra la última de referencia y arranca vacía', (await p.locator('#pCintura').getAttribute('placeholder')) === 'Última: 95'
    && (await p.locator('#pCintura').inputValue()) === '');
  await p.locator('#pPesoHoy').fill('72'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  S = await p.evaluate(() => window.__prime.S);
  ok('si se deja vacía, solo cambia el peso', S.perfil.peso === 72 && S.perfil.cintura === 95 && Object.keys(S.cinturas).length === 1);
  await p.evaluate(() => { const P = window.__prime; P.S.cinturas['2026-10-07'] = 97; P.save(); P.render(); });
  ok('con una medida anterior, muestra cuánto bajó', /−2 cm desde el 7 de octubre/.test(await p.locator('.cintura').innerText()));
  const resp = await p.evaluate(() => {
    const P = window.__prime, base = JSON.parse(JSON.stringify(P.S)), r = [];
    for (const extra of [{}, { cinturas: { '2026-10-14': -3 } }, { cinturas: { hoy: 90 } }])
      try { P.prepararRespaldo(JSON.stringify({ ...base, ...extra })); r.push('ok'); } catch (e) { r.push('no'); }
    return r.join();
  });
  ok('el respaldo trae las cinturas y rechaza las rotas (' + resp + ')', resp === 'ok,no,no');
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await ctx.close();
}

// Finanzas de prueba (inventadas): el plan arranca en noviembre de 2026
const FIN = {
  inicio: '2026-11', presupuestoAlimentos: 400000,
  ingresos: [{ id: 'i1', nombre: 'Sueldo', monto: 2000000, dia: 30 }, { id: 'i2', nombre: 'Aguinaldo', monto: 1000000, meses: [6, 12] }],
  fijos: [{ id: 'f1', nombre: 'Alquiler', monto: 700000, dia: 5 }, { id: 'f2', nombre: 'Colegio', monto: 100000 }],
  deudas: [
    { id: 'd1', nombre: 'Préstamo caro', saldo: 1200000, cuota: 150000, tna: 60, dia: 10, hasta: '2027-02', plan: { '2026-11': 250000 } },
    { id: 'd2', nombre: 'Tarjeta en cuotas', saldo: 300000, cuota: 0, tna: 0, dia: 25, hasta: '2026-12', plan: { '2026-11': 200000, '2026-12': 100000 } },
    { id: 'd3', nombre: 'Billetera', saldo: 100000, cuota: 100000, dia: 31, hasta: '2026-11' }],
  movimientos: [{ id: 'm1', mes: '2026-11', nombre: 'Descuento del adelanto', monto: -300000 }],
  colchon: [{ id: 'c1', nombre: 'Acciones', monto: 100000 }]
};
const finanzas = () => JSON.parse(JSON.stringify(FIN));

console.log('\n== 36. Finanzas: la cuenta del mes, vencimientos y colchón ==');
{
  const L = cargarLogica(estado()), F = finanzas();
  const nov = L.resumenMes(F, '2026-11', '2026-11-04');
  ok('noviembre: entran 2 M; salen casa 800 mil, alimentos 400 mil, cuotas 550 mil y el descuento de 300 mil; faltan 50 mil',
    nov.entra === 2000000 && nov.casa === 800000 && nov.alimentos === 400000 && nov.cuotas === 550000 && nov.otros === 300000 && nov.sobra === -50000);
  ok('una cuota distinta manda en su mes; después de la última, nada; el aguinaldo solo en junio y diciembre',
    L.cuotaDelMes(F.deudas[0], '2026-11') === 250000 && L.cuotaDelMes(F.deudas[0], '2026-12') === 150000 && L.cuotaDelMes(F.deudas[0], '2027-03') === 0
    && L.resumenMes(F, '2026-12', '2026-11-04').entra === 3000000 && L.resumenMes(F, '2027-01', '2026-11-04').entra === 2000000);
  F.gastos = { '2026-11-02': [{ id: 'g1', comercio: 'Súper', total: 450000 }], '2026-10-20': [{ id: 'g2', comercio: 'Verdulería', total: 30000 }] };
  ok('alimentos: si te pasaste del presupuesto cuenta lo gastado; un mes pasado, solo lo gastado',
    L.resumenMes(F, '2026-11', '2026-11-04').alimentos === 450000 && L.resumenMes(F, '2026-10', '2026-11-04').alimentos === 30000
    && L.gastadoEnMes(F.gastos, '2026-11') === 450000);
  delete F.gastos;
  const p = L.proyeccionFinanzas(F, '2026-11', 8, '2026-11-04');
  ok('la proyección suma lo que sobra al colchón: 50 mil, 1,6 M, 2,25 M… ' + p.map(x => x.colchon).join(),
    p.map(x => x.sobra).join() === '-50000,1550000,650000,650000,800000,800000,800000,1800000'
    && p.map(x => x.colchon).slice(0, 3).join() === '50000,1600000,2250000');
  ok('hitos del colchón (1, 3 y 6 meses de 1,2 M): diciembre 2026, marzo 2027, julio 2027',
    L.hitosColchon(F, '2026-11', '2026-11-04').map(h => h.ya ? 'ya' : h.mes).join() === '2026-12,2027-03,2027-07'
    && L.hitosColchon({ ...F, colchon: [{ id: 'x', nombre: 'x', monto: 2000000 }] }, '2026-11', '2026-11-04')[0].ya);
  const v = L.vencimientos(F, '2026-11');
  ok('vencimientos por día; el 31 en noviembre cae el 30; lo sin fecha al final',
    v.map(x => `${x.nombre}@${x.fecha}`).join() === 'Alquiler@2026-11-05,Préstamo caro@2026-11-10,Tarjeta en cuotas@2026-11-25,Billetera@2026-11-30,Colegio@null'
    && L.vencimientos(F, '2026-12').every(x => x.nombre !== 'Billetera'));
  const avisos = L.planAvisoVencimientos(F, new Date(2026, 9, 30, 8, 0), 14, '10:00');
  ok('avisa el día antes a las 10, solo desde el primer mes del plan: ' + avisos.map(a => a.title).join(' | '),
    avisos.length === 2 && avisos[0].id === 600005 && avisos[0].at.getDate() === 4 && avisos[0].at.getHours() === 10
    && avisos[0].title === 'Mañana vence Alquiler' && avisos[0].body === '$ 700.000 · Tocá para verlo' && avisos[1].title === 'Mañana vence Préstamo caro'
    && avisos.every(a => a.canal === 'finanzas'));
  F.pagos = { '2026-11': ['f:f1'] };
  ok('lo pagado ya no avisa ni cuenta como pendiente', L.planAvisoVencimientos(F, new Date(2026, 9, 30, 8, 0), 14, '10:00').length === 1
    && L.vencimientos(F, '2026-11')[0].pagado && L.vencenEl(F, '2026-11-05').length === 0 && L.vencenEl(F, '2026-11-10').length === 1);
  const d = L.resumenDeudas(F, '2026-11');
  ok('deudas: 1,6 M, 60 mil por mes de intereses; la tasa 0 es sin interés y la que no tiene tasa no se cuenta',
    d.saldo === 1600000 && d.intereses === 60000 && d.sinTasa === 1 && L.cuotasQueFaltan(F.deudas[0], '2026-11') === 4 && L.resumenDeudas(F, '2026-12').activas.length === 2);
  const r = L.ritmoAlimentos(400000, 100000, '2026-11', '2026-11-04');
  ok('alimentos: quedan 300 mil para 27 días, unos 77.800 por semana', r.quedan === 300000 && r.dias === 27 && r.porSemana === 77800
    && L.ritmoAlimentos(400000, 500000, '2026-11', '2026-11-04').porSemana === 0);
  const t = L.normalizarTicket({ comercio: ' Coto ', fecha: '2026-02-31', confianza: 'segura', total: 'x',
    items: [{ nombre: 'Leche', cantidad: 2, precio: 3000.4 }, { nombre: 'Descuento 2x1', cantidad: 1, precio: -500 }, { nombre: '  ' }, null] });
  ok('el ticket se limpia: el descuento queda negativo, sin total se suman los renglones, una fecha imposible queda vacía',
    t.comercio === 'Coto' && t.items.length === 2 && t.items[1].precio === -500 && t.total === 2500 && t.fecha === '' && t.confianza === 'baja'
    && L.normalizarTicket({ fecha: '2026-11-03', total: 9999.6, items: [] }).total === 10000 && L.normalizarTicket(null).items.length === 0);
}

console.log('\n== 37. Finanzas y Gastos en la web: el mes, pagar, gastos y ticket con Claude (simulado) ==');
{
  const { p, c, errs } = await abrirEn('2026-11-04', { ...estado({ lastClosed: '2026-11-03' }), finanzas: finanzas() });
  const S = () => p.evaluate(() => window.__prime.S);
  ok('Hoy avisa lo que vence mañana, con el monto', /Mañana vence: Alquiler · \$ 700\.000/.test(await p.locator('.alerta-venc').innerText())
    && await p.locator('.alerta-venc [data-act="irFinanzas"]').count() === 1);
  await p.locator('.alerta-venc [data-act="irFinanzas"]').click(); await p.waitForTimeout(150);
  const hero = () => p.locator('.fin-mes .hero').innerText();
  ok('Finanzas abre en noviembre: te faltan $ 50.000', /\$ 50\.000\s+te faltan en noviembre/.test(await hero()));
  const cuentas = await p.locator('.fin-mes .cuentas').innerText();
  ok('con lo que entra, la casa, alimentos y cuotas', /Entra\s+\+ \$ 2\.000\.000/.test(cuentas) && /Casa\s+− \$ 800\.000/.test(cuentas)
    && /Alimentos\s+− \$ 400\.000/.test(cuentas) && /Cuotas\s+− \$ 550\.000/.test(cuentas));
  ok('lo de un solo mes aparece aparte, y cuánto falta pagar', /Descuento del adelanto\s+− \$ 300\.000/.test(await p.locator('.fin-mes').innerText())
    && /Falta pagar \$ 1\.350\.000 de cuotas y de la casa, y \$ 400\.000 de alimentos/.test(await p.locator('.fin-mes .pie').innerText()));
  ok('no se puede ir antes del primer mes del plan', await p.locator('[data-act="fmes"][data-n="-1"]').isDisabled());
  const venc = await p.locator('.venc').innerText();
  ok('vencimientos de noviembre en orden, con "vence mañana" y lo sin fecha al final', /0 de 5 pagados/i.test(venc)
    && venc.indexOf('Alquiler') < venc.indexOf('Préstamo caro') && venc.indexOf('Billetera') < venc.indexOf('Colegio') && /vence mañana/.test(venc) && /30\/11/.test(venc));
  await p.locator('[data-act="fpagar"][data-k="f:f1"]').click(); await p.waitForTimeout(150);
  ok('tocar ✓ lo marca pagado: baja lo que falta y se va el aviso', (await S()).finanzas.pagos['2026-11'].join() === 'f:f1'
    && /Falta pagar \$ 650\.000/.test(await p.locator('.fin-mes .pie').innerText()) && await p.locator('.alerta-venc').count() === 0
    && /1 de 5 pagados/i.test(await p.locator('.venc .card-t').innerText()));
  const colchon = await p.locator('.colchon').innerText();
  ok('colchón y sus hitos: diciembre 2026, marzo 2027, julio 2027', /\$ 100\.000/.test(colchon) && /menos de un mes de gastos/.test(colchon)
    && /1 mes de gastos · \$ 1\.200\.000\s+≈ diciembre 2026/.test(colchon) && /≈ marzo 2027/.test(colchon) && /≈ julio 2027/.test(colchon));
  const deudas = await p.locator('.deudas').innerText();
  ok('deudas: total, intereses por mes y la más cara arriba', /\$ 1\.600\.000/.test(deudas) && /≈ \$ 60\.000 por mes/.test(deudas)
    && /sin contar 1 deuda sin la tasa cargada/.test(deudas) && deudas.indexOf('Préstamo caro') < deudas.indexOf('Billetera') && /sin interés/.test(deudas));
  await p.locator('summary', { hasText: 'próximos 12 meses' }).click();
  ok('los próximos 12 meses, en millones', await p.locator('.proximos tr.tap').count() === 12
    && /Nov 26\s+−0,05\s+0,05/.test(await p.locator('.proximos').innerText()) && /Dic 26\s+\+1,55\s+1,6/.test(await p.locator('.proximos').innerText()));
  await p.locator('[data-act="fmes"][data-n="1"]').click(); await p.waitForTimeout(100);
  ok('diciembre, con el aguinaldo: te sobran $ 1.550.000', /\$ 1\.550\.000\s+te sobran en diciembre/.test(await hero()));
  await p.locator('[data-act="fmes"][data-n="-1"]').click(); await p.waitForTimeout(100);
  // Lo que entra: alta desde la lista
  await p.locator('.cuentas [data-k="ingresos"]').click(); await p.waitForTimeout(100);
  ok('la lista de lo que entra explica que el sueldo de fin de mes cuenta para el siguiente', /el del 30 de octubre es plata de noviembre/.test(await p.locator('.sheet').innerText())
    && /Sueldo/.test(await p.locator('.sheet').innerText()) && /junio y diciembre/.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet [data-x="a"]').click();
  await p.locator('#f_nombre').fill('Changa'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('sin monto no guarda', /Revisá «Monto por mes»/.test(await p.locator('body').innerText()) && await p.locator('#f_monto').count() === 1);
  await p.locator('#f_monto').fill('100000'); await p.locator('#f_dia').fill('40'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('un día imposible tampoco', /El día va del 1 al 31/.test(await p.locator('body').innerText()));
  await p.locator('#f_dia').fill(''); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('agregado: vuelve a la lista y el mes da $ 50.000 a favor', /Changa/.test(await p.locator('.sheet').innerText())
    && /\$ 50\.000\s+te sobran en noviembre/.test(await hero()));
  await p.locator('.sheet .fila', { hasText: 'Changa' }).locator('.ce').click();
  await p.locator('.sheet [data-x="b"]').click(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('borrar pide confirmación y vuelve a la lista', !(await S()).finanzas.ingresos.some(i => i.nombre === 'Changa') && /Lo que entra/.test(await p.locator('.sheet h3').innerText()));
  await p.locator('.sheet [data-x="c"]').click();
  // Algo de un solo mes
  await p.locator('[data-act="fmov"]').click();
  await p.locator('#mNombre').fill('Adelanto'); await p.locator('#mMonto').fill('300000'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('un adelanto de 300 mil: te sobran $ 250.000', /\$ 250\.000\s+te sobran/.test(await hero())
    && (await S()).finanzas.movimientos.some(m => m.mes === '2026-11' && m.monto === 300000));
  await p.locator('[data-act="fborrarMov"][aria-label="Sacar Adelanto"]').click(); await p.waitForTimeout(100);
  ok('y se saca con la ✕', /\$ 50\.000\s+te faltan/.test(await hero()));
  // Desde Finanzas, la fila de alimentos lleva a Gastos
  await p.locator('.fin-mes [data-act="irGastos"]').first().click(); await p.waitForTimeout(150);
  const gmes = () => p.locator('.gastos-mes').innerText(), dia = () => p.locator('.diario').innerText(), sob = () => p.locator('.sobres').innerText();
  ok('alimentos en Finanzas lleva a la pestaña Gastos, en noviembre', await p.locator('nav button[data-tab="gastos"]').getAttribute('aria-current') === 'true'
    && /noviembre 2026/i.test(await p.locator('.mnav').innerText()));
  ok('Gastos: $ 0 de $ 400.000, unos $ 103.700 por semana', /Administración de gastos/i.test(await gmes())
    && /\$ 0\s+de \$ 400\.000 · quedan \$ 400\.000/.test(await gmes()) && /Para los 27 días que quedan: unos \$ 103\.700 por semana/.test(await gmes()));
  ok('el presupuesto de alimentos queda repartido por categoría: súper 200 mil, verdulería 100 mil, delivery 66.667, kiosco 33.333',
    /Súper y almacén\s+necesario\s+\$ 0\s+de \$ 200\.000/.test(await sob()) && /Verdulería y carnicería\s+necesario\s+\$ 0\s+de \$ 100\.000/.test(await sob())
    && /Delivery y comida hecha\s+gusto\s+\$ 0\s+de \$ 66\.667/.test(await sob()) && /Kiosco, café y snacks\s+gusto\s+\$ 0\s+de \$ 33\.333/.test(await sob())
    && /Alimentos · \$ 0 de \$ 400\.000/i.test(await sob()));
  ok('sin gastos, el diario y los gráficos lo dicen', /Todavía no cargaste gastos este mes/.test(await dia())
    && /Cuando cargues gastos, acá vas a ver cómo va el mes/.test(await p.locator('.como-vamos').innerText()));
  await p.locator('.cargar [data-act="fmano"]').click();
  ok('a mano arranca en súper y débito', await p.locator('#gCat').inputValue() === 'super' && await p.locator('#gMedio').inputValue() === 'debito');
  await p.locator('#gNombre').fill('Verdulería'); await p.locator('#gTotal').fill('25000'); await p.locator('#gCat').selectOption('fresco');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  let g0 = (await S()).finanzas.gastos['2026-11-04']?.[0];
  ok('agregar a mano: $ 25.000, quedan $ 375.000, con su categoría y con qué pagaste', /\$ 25\.000\s+de \$ 400\.000 · quedan \$ 375\.000/.test(await gmes())
    && g0?.comercio === 'Verdulería' && g0.categoria === 'fresco' && g0.medio === 'debito' && !('deCasa' in g0)
    && /Mié 4 nov · \$ 25\.000\s+Verdulería\s+Verdulería y carnicería · débito o efectivo\s+\$ 25\.000/i.test(await dia()));
  ok('y el sobre de verdulería: $ 25.000 de $ 100.000, quedan $ 75.000', /Verdulería y carnicería\s+necesario\s+\$ 25\.000\s+de \$ 100\.000\s+quedan \$ 75\.000 · 25 % usado/.test(await sob()));
  await p.locator('.diario [data-act="fgasto"]').first().click();
  ok('al editarlo se ve con qué pagaste', await p.locator('#eMedio').inputValue() === 'debito' && await p.locator('#eCat').inputValue() === 'fresco');
  await p.locator('#eTotal').fill('30000'); await p.locator('#eFecha').fill('2026-10-31'); await p.locator('#eMedio').selectOption('');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  g0 = (await S()).finanzas.gastos['2026-10-31']?.[0];
  ok('editar el total y la fecha lo pasa a octubre; "No sé" saca el medio', !(await S()).finanzas.gastos['2026-11-04'] && g0?.total === 30000 && !('medio' in g0)
    && /\$ 0\s+de \$ 400\.000/.test(await gmes()));
  await p.locator('[data-act="gmes"][data-n="-1"]').click(); await p.waitForTimeout(100);
  ok('octubre, antes del plan, queda anotado sin presupuesto', /\$ 30\.000\s+en octubre; el presupuesto arranca en noviembre/.test(await gmes())
    && await p.locator('[data-act="gmes"][data-n="1"]').isEnabled());
  await p.locator('[data-act="fborrarGasto"]').first().click(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('borrar un gasto pide confirmación', !(await S()).finanzas.gastos['2026-10-31'] && /Ese mes no cargaste gastos/.test(await dia()));
  await p.locator('[data-act="gmes"][data-n="1"]').click(); await p.waitForTimeout(100);
  ok('al mes que viene no se puede ir', await p.locator('[data-act="gmes"][data-n="1"]').isDisabled());
  await p.locator('.sobres [data-act="gpres"]').click();
  ok('los presupuestos se cambian por categoría, con el total', await p.locator('#p_super').inputValue() === '200000' && await p.locator('#p_mascotas').inputValue() === ''
    && /Total: \$ 400\.000 por mes/.test(await p.locator('#pTotal').innerText()));
  await p.locator('#p_super').fill('300000');
  ok('el total se actualiza mientras escribís', /Total: \$ 500\.000 por mes/.test(await p.locator('#pTotal').innerText()));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('el presupuesto se cambia', (await S()).finanzas.presupuestos.super === 300000 && !('mascotas' in (await S()).finanzas.presupuestos)
    && /\$ 0\s+de \$ 500\.000/.test(await gmes()) && /Súper y almacén\s+necesario\s+\$ 0\s+de \$ 300\.000/.test(await sob()));
  // Ticket con Claude (simulado)
  const pedidos = [];
  await c.route('https://api.anthropic.com/**', async route => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    pedidos.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({
      id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 2000, output_tokens: 300 }, content: [{ type: 'text', text: JSON.stringify({ comercio: 'Coto', fecha: '2026-11-03', categoria: 'super', medio: 'tarjeta',
        items: [{ nombre: 'Leche entera', cantidad: 2, precio: 3000 }, { nombre: 'Pan', cantidad: 1, precio: 2500 }, { nombre: 'Descuento leche', cantidad: 1, precio: -500 }],
        total: 5000, nota: 'Ningún producto de limpieza.', confianza: 'alta' }) }] }) });
  });
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  ok('sin clave, la tarjeta de cargar dice que falta', /Para leer tickets y comprobantes con Claude falta tu clave/.test(await p.locator('.cargar').innerText()));
  await p.locator('.cargar [data-act="fticket"]').click(); await p.waitForTimeout(100);
  ok('para el ticket primero pide la clave de Anthropic', await p.locator('.sheet #clave').count() === 1);
  await p.locator('.sheet [data-x="c"]').click();
  await p.evaluate(() => localStorage.setItem('miPrime.claveIA', 'sk-ant-api03-' + 'x'.repeat(40)));
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.cargar [data-act="fticket"]').click()]);
  ok('"Foto del ticket" abre la cámara', (await fc.element().getAttribute('capture')) === 'environment');
  await fc.setFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(300);
  ok('la hoja es del ticket: si es largo, se saca en partes', /Ticket o comprobante/.test(await p.locator('.sheet h3').innerText())
    && /del mismo ticket: si es largo, sacalo en partes/.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(1500);
  const q = pedidos.at(-1), img = q?.body.messages[0].content.find(b => b.type === 'image'), txt = q?.body.messages[0].content.find(b => b.type === 'text');
  ok('manda la foto a Claude Opus 5.5 con el prompt de tickets y su JSON schema', q && q.body.model === 'claude-opus-5-5' && img?.source.media_type === 'image/jpeg'
    && /tickets, facturas y comprobantes de pago/.test(q.body.system) && /precio negativo/.test(q.body.system) && /Hoy es 2026-11-04\. Leé este ticket/.test(txt?.text)
    && q.body.output_config?.format?.schema.required.join() === 'comercio,fecha,categoria,medio,items,total,nota,confianza' && q.body.fallbacks === 'default');
  ok('y le pide con qué se pagó: débito, tarjeta en un pago o en cuotas', /medio: cómo se pagó/.test(q.body.system) && /cuotas: tarjeta de crédito en cuotas/.test(q.body.system)
    && /mascotas: alimento, veterinaria/.test(q.body.system));
  const hoja = await p.locator('.sheet').innerText();
  ok('muestra lo que leyó: Coto, $ 5.000, del 3/11, súper, con tarjeta, con los renglones y el descuento', /Lo que leyó Claude/.test(hoja)
    && (await p.locator('#tComercio').inputValue()) === 'Coto' && (await p.locator('#tTotal').inputValue()) === '5000'
    && (await p.locator('#tFecha').inputValue()) === '2026-11-03' && (await p.locator('#tCat').inputValue()) === 'super' && (await p.locator('#tMedio').inputValue()) === 'tarjeta'
    && /Leche entera × 2\s+\$ 3\.000/.test(hoja) && /Descuento leche\s+− \$ 500/.test(hoja));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  const g = (await S()).finanzas.gastos['2026-11-03']?.[0];
  ok('se guarda con todo: comercio, total, categoría, medio, renglones y nota', g?.comercio === 'Coto' && g.total === 5000 && g.origen === 'ticket' && g.items.length === 3 && /limpieza/.test(g.nota)
    && g.categoria === 'super' && g.medio === 'tarjeta'
    && /\$ 5\.000\s+de \$ 500\.000/.test(await gmes()) && /Súper y almacén · tarjeta · 3 renglones del ticket/.test(await dia()));
  await p.locator('.diario [data-act="fgasto"]').first().click();
  ok('y tocándolo se ve el detalle', /leído de la foto del ticket/.test(await p.locator('.sheet').innerText()) && /Pan\s+\$ 2\.500/.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet [data-x="b"]').click(); await p.locator('.sheet [data-x="c"]').click();
  await ir(p, 'finanzas');
  // Importar finanzas
  const archivo = (nombre, data) => ({ name: nombre, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  let [fi] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="fimport"]').click()]);
  await fi.setFiles(archivo('roto.json', { finanzas: { deudas: [{ id: 'x', nombre: 'Mal', saldo: -1, cuota: 0 }] } })); await p.waitForTimeout(200);
  ok('importar un archivo roto no toca nada', /Archivo inválido: En finanzas, "deudas" está roto/.test(await p.locator('body').innerText())
    && (await S()).finanzas.deudas.length === 3);
  [fi] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="fimport"]').click()]);
  await fi.setFiles(archivo('nuevo.json', { finanzas: { inicio: '2026-12', ingresos: [{ id: 'n1', nombre: 'Sueldo nuevo', monto: 3000000 }], fijos: [], deudas: [] } }));
  await p.waitForTimeout(200);
  ok('uno bueno dice qué trae y qué no toca', /Trae 1 ingreso, 0 gastos de la casa, 0 deudas.*desde diciembre 2026.*tus gastos y presupuestos quedan como están/s.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  const F2 = (await S()).finanzas;
  ok('reemplaza lo que trae y deja los gastos', F2.ingresos[0].nombre === 'Sueldo nuevo' && F2.deudas.length === 0 && F2.gastos['2026-11-03'].length === 1
    && F2.colchon.length === 1 && /\$ 2\.500\.000\s+te sobran en diciembre/.test(await hero()));
  const resp = await p.evaluate(() => {
    const P = window.__prime, base = JSON.parse(JSON.stringify(P.S)), r = [];
    for (const extra of [{}, { finanzas: 'x' }, { finanzas: { ingresos: [{ id: 'a', nombre: '', monto: 1 }] } }, { finanzas: { pagos: { '2026-13': [] } } },
                         { finanzas: { gastos: { '2026-11-01': [{ comercio: 'x', total: -5 }] } } }, { finanzas: { inicio: 'noviembre' } }])
      try { P.prepararRespaldo(JSON.stringify({ ...base, ...extra })); r.push('ok'); } catch (e) { r.push('no'); }
    return r.join();
  });
  ok('el respaldo trae las finanzas y rechaza las rotas (' + resp + ')', resp === 'ok,no,no,no,no,no');
  const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem('miPrime.v1')).finanzas);
  ok('todo queda guardado en el celular', guardado.ingresos[0].nombre === 'Sueldo nuevo' && guardado.gastos['2026-11-03'][0].items.length === 3
    && guardado.presupuestos.super === 300000 && guardado.pagos['2026-11'].join() === 'f:f1');
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();
}

console.log('\n== 38. Finanzas en la app de Android: aviso el día antes ==');
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c.clock.setFixedTime(new Date('2026-11-04T08:00:00'));
  await c.addInitScript(s => localStorage.setItem('miPrime.v1', s), JSON.stringify({ ...estado({ lastClosed: '2026-11-03' }), finanzas: finanzas() }));
  await c.addInitScript(() => {
    window.__llamadas = [];
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android',
      nativePromise: async (plugin, metodo, op = {}) => {
        window.__llamadas.push({ metodo, op: JSON.parse(JSON.stringify(op)) });
        if (metodo === 'checkPermissions') return { display: 'granted' };
        if (metodo === 'getPending') return { notifications: [] };
        if (metodo === 'isHealthAvailable') return { available: false };
        return {};
      } };
  });
  const p = await c.newPage(); p.setDefaultTimeout(5000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(1200);
  const agenda = async () => (await p.evaluate(() => window.__llamadas)).filter(l => l.metodo === 'schedule').at(-1)?.op.notifications || [];
  const fin = async () => (await agenda()).filter(n => n.channelId === 'finanzas');
  const ll = await p.evaluate(() => window.__llamadas);
  let ag = await fin();
  ok('crea el canal "Vencimientos" y avisa hoy a las 10 lo de mañana, y el 9 lo del 10',
    ll.some(l => l.metodo === 'createChannel' && l.op.id === 'finanzas') && ag.map(n => n.id).join() === '600000,600005'
    && ag[0].title === 'Mañana vence Alquiler' && ag[0].schedule.at === await p.evaluate(() => new Date(2026, 10, 4, 10, 0).toISOString()));
  await ir(p, 'finanzas');
  await p.locator('[data-act="fpagar"][data-k="f:f1"]').click(); await p.waitForTimeout(1200);
  ag = await fin();
  ok('pagado el alquiler, ese aviso ya no está', ag.map(n => n.id).join() === '600005');
  ok('en la app dice a qué hora avisa', /El día antes, a las 10:00, te avisa lo que vence/.test(await p.locator('.venc').innerText()));
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();
}

console.log('\n== 39. Hábitos de finanzas y a dónde vas ==');
{
  const habito = (id, regla, extra = {}) => ({ id, name: regla, order: 0, auto: { source: 'finanzas', regla, desde: '2026-11-02' }, ...extra });
  const st = { ...estado({ lastClosed: '2026-11-03', habits: [habito('a', 'anotar'), habito('s', 'sinDeuda'), habito('r', 'ritmo'), habito('v', 'vencimientos')] }),
    finanzas: { ...finanzas(), presupuestoAlimentos: 300000, gastos: { '2026-11-02': [{ id: 'g1', comercio: 'Coto', total: 150000 }], '2026-11-03': [{ id: 'g2', comercio: 'Kiosco', total: 20000 }] },
      fijos: [{ id: 'f1', nombre: 'Alquiler', monto: 700000, dia: 3 }], deudas: [{ id: 'd9', nombre: 'Préstamo nuevo', saldo: 1, cuota: 1, alta: '2026-11-03' }] } };
  const L = cargarLogica(st);
  ok('el ritmo de alimentos: lo del mes repartido por día, con una semana de margen y nunca más que el presupuesto',
    L.topeRitmo(600000, '2026-11-04') === 220000 && L.topeRitmo(600000, '2026-11-25') === 600000 && L.topeRitmo(600000, '2026-11-30') === 600000);
  const n = L.marcarPorFinanzas(st, '2026-11-04'), m = d => JSON.stringify(st.marks[d]);
  ok('se marcan solos desde que se sumaron: anotar verde el día con gasto, la deuda nueva amarilla, el ritmo según lo gastado ' + m('2026-11-03'),
    n === 9 && st.marks['2026-11-02'].a === 'green' && st.marks['2026-11-03'].s === 'yellow' && st.marks['2026-11-02'].s === 'green'
    && st.marks['2026-11-02'].r === 'yellow' && !st.marks['2026-11-04'].a && !st.marks['2026-11-01']);
  ok('los vencimientos se miran hoy: el alquiler del 3 sin pagar deja amarillo', st.marks['2026-11-04'].v === 'yellow' && !st.marks['2026-11-03'].v
    && L.estadoFinanzas(st.finanzas, 'vencimientos', '2026-11-03', '2026-11-04') === undefined);
  ok('las marcas de la app se leen en amarillo, no como sin dato', L.getMark('2026-11-03', 's') === 'yellow' && st.marcasFin['2026-11-03'].includes('s')
    && !(st.autoClosed['2026-11-03'] || []).includes('s'));
  ok('si no cambió nada, no vuelve a marcar', L.marcarPorFinanzas(st, '2026-11-04') === 0);
  delete st.finanzas.gastos['2026-11-03'];
  st.finanzas.pagos = { '2026-11': ['f:f1'] };
  L.marcarPorFinanzas(st, '2026-11-04');
  ok('sin el gasto, el día vuelve a como lo deja el cierre (sin dato); pagado el alquiler, vencimientos verde',
    L.getMark('2026-11-03', 'a') === 'nodata' && !(st.marcasFin['2026-11-03'] || []).includes('a') && st.marks['2026-11-04'].v === 'green');
  st.marks['2026-11-02'].r = 'green'; L.markManual(st, '2026-11-02', 'r');
  L.marcarPorFinanzas(st, '2026-11-04');
  ok('lo que marcaste vos manda: no se toca', st.marks['2026-11-02'].r === 'green' && !(st.marcasFin['2026-11-02'] || []).includes('r'));
  const R = cargarLogica(estado()).rumboFinanzas(finanzas(), '2026-11-04');
  ok('a dónde vas: faltan 50 mil, desde diciembre cierra, en noviembre termina la Billetera, la última cuota en febrero, el colchón en diciembre',
    R.sobra === -50000 && R.cierraDesde === '2026-12' && R.terminan.mes === '2026-11' && R.terminan.nombres.join() === 'Billetera' && R.terminan.libera === 100000
    && R.ultima === '2027-02' && R.hito.meses === 1 && R.hito.mes === '2026-12' && R.alimentos.tope === 146667 && R.vencimientos.total === 5);
  ok('las frases de finanzas van en rueda: a la mañana una, a la tarde otra', L.fraseFinanzas('2026-11-04').t !== L.fraseFinanzas('2026-11-04', true).t
    && L.FRASES_FINANZAS.length === 12);

  const { p, c, errs } = await abrirEn('2026-11-04', { ...estado({ lastClosed: '2026-11-03' }), finanzas: finanzas() });
  const S = () => p.evaluate(() => window.__prime.S);
  const fila = nombre => p.locator('.hrow', { hasText: nombre });
  const marca = async nombre => (await fila(nombre).locator('.dot').getAttribute('class')).replace('dot', '').trim();
  const hoyCard = await p.locator('.finanzas-hoy').innerText();
  ok('Hoy muestra una frase de finanzas y un dato tuyo', /Finanzas · a dónde vas/i.test(hoyCard) && hoyCard.split('\n').length >= 3);
  await p.locator('.finanzas-hoy').click();
  const hoja = await p.locator('.sheet').innerText();
  ok('tocándola se ve a dónde vas, con tus números', /Noviembre: te faltan \$ 50\.000\. Desde diciembre 2026, todos los meses cierran solos\./.test(hoja)
    && /En noviembre 2026 terminás Billetera: se liberan \$ 100\.000 por mes\./.test(hoja) && /La última cuota de todas es en febrero 2027/.test(hoja)
    && /En diciembre 2026 llegás a un mes de gastos en el colchón/.test(hoja) && /Alimentos: \$ 0 de \$ 400\.000, vas al ritmo\./.test(hoja)
    && /De noviembre pagaste 0 de 5 vencimientos; falta \$ 1\.350\.000\./.test(hoja) && /Nunca una deuda para pagar otra/.test(hoja));
  await p.locator('.sheet [data-x="f"]').click(); await p.waitForTimeout(150);
  ok('y lleva a Finanzas, que arranca con a dónde vas', /A dónde vas/i.test(await p.locator('.rumbo-card').innerText())
    && await p.locator('.rumbo-card .rumbo').count() >= 5);
  for (const r of ['anotar', 'sinDeuda', 'ritmo', 'vencimientos']) { await p.locator(`[data-act="fhabito"][data-r="${r}"]`).click(); await p.waitForTimeout(80); }
  const hs = (await S()).habits.filter(h => h.auto?.source === 'finanzas');
  ok('los cuatro hábitos se suman a Hoy, desde hoy; anotar con aviso a las 21', hs.length === 4 && hs.every(h => h.auto.desde === '2026-11-04')
    && hs.find(h => h.auto.regla === 'anotar').hora === '21:00' && await p.locator('[data-act="fhabito"][aria-checked="true"]').count() === 4);
  await ir(p, 'hoy');
  ok('en Hoy: sin deuda, al ritmo y al día en verde; anotar espera el gasto',
    await marca('Sin deuda nueva') === 's-green' && await marca('Alimentos al ritmo') === 's-green' && await marca('Vencimientos al día') === 's-green'
    && await marca('Anotar lo que gasto') === '' && /nada anotado hoy/.test(await fila('Anotar lo que gasto').innerText())
    && /\$ 0 de \$ 146\.667 hasta hoy/.test(await fila('Alimentos al ritmo').innerText()) && /al día/.test(await fila('Vencimientos al día').innerText()));
  await ir(p, 'gastos');
  await p.locator('.cargar [data-act="fmano"]').click(); await p.locator('#gNombre').fill('Súper'); await p.locator('#gTotal').fill('200000');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  await ir(p, 'hoy');
  ok('cargado un gasto: anotar en verde; 200 mil se adelanta al ritmo y queda amarillo',
    await marca('Anotar lo que gasto') === 's-green' && await marca('Alimentos al ritmo') === 's-yellow'
    && /\$ 200\.000 anotado hoy/.test(await fila('Anotar lo que gasto').innerText()) && /\$ 200\.000 de \$ 146\.667 hasta hoy/.test(await fila('Alimentos al ritmo').innerText()));
  await ir(p, 'gastos');
  await p.locator('[data-act="fborrarGasto"]').first().click(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  await ir(p, 'finanzas');
  await p.locator('[data-act="fmov"]').click(); await p.locator('#mNombre').fill('Adelanto'); await p.locator('#mMonto').fill('300000');
  await p.locator('#mDeuda').check(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  await ir(p, 'hoy');
  ok('sin el gasto vuelven atrás; un adelanto marcado como deuda nueva deja "Sin deuda nueva" en amarillo',
    await marca('Anotar lo que gasto') === '' && await marca('Alimentos al ritmo') === 's-green' && await marca('Sin deuda nueva') === 's-yellow'
    && (await S()).finanzas.movimientos.some(m => m.deuda && m.alta === '2026-11-04'));
  await fila('Sin deuda nueva').locator('.more').click(); await p.locator('.opt').nth(0).click(); await p.waitForTimeout(150);
  ok('si lo marcás vos, manda', await marca('Sin deuda nueva') === 's-green' && !((await S()).marcasFin['2026-11-04'] || []).includes((await S()).habits.find(h => h.auto?.regla === 'sinDeuda').id));
  await ir(p, 'finanzas');
  const idRitmo = (await S()).habits.find(h => h.auto?.regla === 'ritmo').id;
  ok('antes de sacarlo tiene marcas', JSON.stringify((await S()).marcasFin).includes(idRitmo));
  await p.locator('[data-act="fhabito"][data-r="ritmo"]').click(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('apagarlo pide confirmación y lo saca de Hoy con sus marcas', !(await S()).habits.some(h => h.auto?.regla === 'ritmo')
    && await p.locator('[data-act="fhabito"][data-r="ritmo"]').getAttribute('aria-checked') === 'false'
    && !JSON.stringify((await S()).marcasFin).includes(idRitmo) && !JSON.stringify((await S()).marks).includes(idRitmo));
  const resp = await p.evaluate(() => {
    const P = window.__prime, base = JSON.parse(JSON.stringify(P.S)), r = [];
    for (const extra of [{}, { marcasFin: { '2026-11-04': 'a' } }, { marcasFin: { hoy: [] } }])
      try { P.prepararRespaldo(JSON.stringify({ ...base, ...extra })); r.push('ok'); } catch (e) { r.push('no'); }
    return r.join();
  });
  ok('el respaldo trae las marcas de finanzas y rechaza las rotas (' + resp + ')', resp === 'ok,no,no');
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();

  // Un vencimiento que pasó sin marcar: amarillo hasta que se marca pagado
  const { p: p2, c: c2, errs: e2 } = await abrirEn('2026-11-06', { ...estado({ lastClosed: '2026-11-05', habits: [habito('v', 'vencimientos', { name: 'Vencimientos al día' })] }), finanzas: finanzas() });
  ok('el alquiler del 5 sin marcar deja "Vencimientos al día" en amarillo', (await p2.locator('.hrow .dot').getAttribute('class')).includes('s-yellow')
    && /1 vencido sin marcar/.test(await p2.locator('.hrow').innerText()) && /Venció sin marcar: Alquiler/.test(await p2.locator('.alerta-venc').innerText()));
  await ir(p2, 'finanzas');
  await p2.locator('[data-act="fpagar"][data-k="f:f1"]').click(); await p2.waitForTimeout(150);
  await ir(p2, 'hoy');
  ok('marcado como pagado, vuelve a verde', (await p2.locator('.hrow .dot').getAttribute('class')).includes('s-green') && /al día/.test(await p2.locator('.hrow').innerText()));
  ok('sin errores de página: ' + JSON.stringify(e2), e2.length === 0);
  await c2.close();
}

console.log('\n== 40. Actualizar finanzas con un resumen nuevo ==');
{
  const st = { ...estado({ lastClosed: '2026-11-03', habits: [{ id: 'hs', name: 'Sin deuda nueva', order: 0, auto: { source: 'finanzas', regla: 'sinDeuda', desde: '2026-11-04' } }] }),
    finanzas: { ...finanzas(), gastos: { '2026-11-02': [{ id: 'g1', comercio: 'Coto', total: 5000 }] }, pagos: { '2026-11': ['f:f1'] } } };
  const { p, c, errs } = await abrirEn('2026-11-04', st);
  const S = () => p.evaluate(() => window.__prime.S);
  await ir(p, 'finanzas');
  const archivo = (nombre, data) => ({ name: nombre, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  let [fi] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="fimport"]').click()]);
  await fi.setFiles(archivo('mal.json', { actualizar: { deudas: [{ nombre: 'Sin id', saldo: 1, cuota: 1 }] } })); await p.waitForTimeout(200);
  ok('una actualización rota no toca nada', /Archivo inválido: En "actualizar", "deudas" está roto/.test(await p.locator('body').innerText()) && (await S()).finanzas.deudas.length === 3);
  [fi] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-act="fimport"]').click()]);
  await fi.setFiles(archivo('resumen.json', { actualizar: { deudas: [
    { id: 'd1', nombre: 'Préstamo caro', saldo: 1000000, cuota: 150000, tna: 60, dia: 10, hasta: '2027-02' },
    { id: 'dM', nombre: 'Mastercard', saldo: 500000, cuota: 100000, tna: 35, dia: 2, hasta: '2027-06', plan: { '2026-11': 300000 } }] } }));
  await p.waitForTimeout(200);
  ok('dice qué suma y qué cambia, y que lo demás queda', /¿Actualizar tus finanzas\?/.test(await p.locator('.sheet').innerText())
    && /Suma «Mastercard» y cambia «Préstamo caro»\. Lo demás queda como está\./.test(await p.locator('.sheet').innerText()));
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  const F = (await S()).finanzas;
  ok('suma la nueva, cambia la que estaba por id y no toca lo demás', F.deudas.length === 4 && F.deudas.find(d => d.id === 'd1').saldo === 1000000
    && F.deudas.find(d => d.id === 'dM').plan['2026-11'] === 300000 && F.movimientos.length === 1 && F.gastos['2026-11-02'].length === 1
    && F.pagos['2026-11'].join() === 'f:f1' && F.ingresos.length === 2);
  ok('y el mes ya la cuenta: noviembre suma la Mastercard y el préstamo cambiado (550 − 100 + 300 mil)', /Cuotas\s+− \$ 750\.000/.test(await p.locator('.fin-mes .cuentas').innerText()));
  await p.locator('.deudas [data-act="fitem"][data-k="deudas"]:not([data-id])').click();
  await p.locator('#f_nombre').fill('Tarjeta vieja'); await p.locator('#f_saldo').fill('100000'); await p.locator('#f_cuota').fill('10000');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  await ir(p, 'hoy');
  ok('cargar una deuda que ya tenías no cuenta como deuda nueva', !(await S()).finanzas.deudas.find(d => d.nombre === 'Tarjeta vieja').alta
    && (await p.locator('.hrow .dot').getAttribute('class')).includes('s-green'));
  await ir(p, 'finanzas');
  await p.locator('.deudas [data-act="fitem"][data-k="deudas"]:not([data-id])').click();
  await p.locator('#f_nombre').fill('Préstamo de hoy'); await p.locator('#f_saldo').fill('100000'); await p.locator('#f_cuota').fill('10000');
  await p.locator('#f_nueva').check(); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  await ir(p, 'hoy');
  ok('tildando "la saqué hoy", sí: Sin deuda nueva queda en amarillo', (await S()).finanzas.deudas.find(d => d.nombre === 'Préstamo de hoy').alta === '2026-11-04'
    && (await p.locator('.hrow .dot').getAttribute('class')).includes('s-yellow'));
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();
}

console.log('\n== 41. Administración de gastos: presupuesto por categoría, medio de pago, cierre y cómo vamos ==');
{
  const L = cargarLogica(estado());
  const G = { '2026-11-02': [{ id: 'a', comercio: 'Coto', total: 120000, categoria: 'super' }, { id: 'b', comercio: 'Kiosco', total: 3000, categoria: 'kiosco' }],
              '2026-11-03': [{ id: 'c', comercio: 'Hoyts', total: 26550, categoria: 'salidas' }, { id: 'd', comercio: 'Didi', total: 14000, categoria: 'transporte' },
                             { id: 'e', comercio: 'HBO Max', total: 12265, categoria: 'suscripciones', deCasa: true }, { id: 'f', comercio: 'Didi', total: 9000, categoria: 'transporte' }],
              '2026-10-28': [{ id: 'g', comercio: 'Verdulería', total: 8000 }] };
  ok('cada gasto va a su rubro por su categoría; los viejos, sin categoría, son alimentos',
    L.rubroDe({ categoria: 'salidas' }) === 'gastos' && L.rubroDe({}) === 'alimentos' && L.rubroDe({ categoria: 'xx' }) === 'alimentos');
  const F = { ...finanzas(), gastos: G }, r = L.resumenMes(F, '2026-11', '2026-11-04');
  ok('el mes resta los gastos aparte de alimentos, sin lo que ya está en la casa: faltan 99.550',
    r.gastadoGastos === 49550 && r.gastos === 49550 && r.alimentos === 400000 && r.gastado === 123000 && r.sobra === -99550);
  const conP = { ...F, presupuestoGastos: 100000 };
  ok('con presupuesto de gastos, cuenta el presupuesto hasta que se pase, y entra en un mes de gastos',
    L.resumenMes(conP, '2026-11', '2026-11-04').gastos === 100000 && L.resumenMes(conP, '2026-12', '2026-11-04').gastos === 100000 && L.gastoMensual(conP) === 1300000);
  const a = L.analisisGastos(G, '2026-11-02', '2026-11-08');
  ok('dónde se va la plata: por categoría de mayor a menor, los hormiga y lo que ya estaba en la casa',
    a.total === 184815 && a.n === 6 && a.categorias.map(c => c.categoria).join() === 'super,salidas,transporte,suscripciones,kiosco'
    && a.hormiga.n === 4 && a.hormiga.total === 38265 && a.deCasa === 12265 && a.alimentos === 123000 && a.gastos === 61815);
  ok('y los comercios, con cuántas veces', a.comercios[0].nombre === 'Coto' && a.comercios.find(c => c.nombre === 'Didi').n === 2
    && a.comercios.find(c => c.nombre === 'Didi').total === 23000);
  ok('Claude propone la categoría; si no es una de la lista, queda vacía',
    L.normalizarTicket({ categoria: 'salidas', items: [] }).categoria === 'salidas' && L.normalizarTicket({ categoria: 'joda' }).categoria === '');

  ok('con qué pagaste: si Claude no lo ve o no es de la lista, queda vacío',
    L.normalizarTicket({ medio: 'cuotas' }).medio === 'cuotas' && L.normalizarTicket({ medio: 'cheque' }).medio === '' && L.normalizarTicket({}).medio === '');
  ok('comprar en cuotas es deuda nueva ese día; en un pago, no',
    L.deudaNuevaEl({ gastos: { '2026-11-03': [{ comercio: 'x', total: 1, medio: 'cuotas' }] } }, '2026-11-03')
    && !L.deudaNuevaEl({ gastos: { '2026-11-03': [{ comercio: 'x', total: 1, medio: 'tarjeta' }] } }, '2026-11-03'));
  const Fp = { presupuestos: { super: 300000, salidas: 20000 }, gastos: G };
  const so = L.sobresDelMes(Fp, '2026-11');
  ok('presupuesto por categoría: lo de alimentos y lo de otros gastos sale de sumar sus categorías',
    L.presupuestoAlimentos(Fp) === 300000 && L.presupuestoGastos(Fp) === 20000 && L.gastoMensual(Fp) === 320000);
  ok('cada sobre con lo gastado; lo que ya está en la casa no cuenta',
    so.map(x => `${x.categoria}:${x.gastado}/${x.presupuesto}`).join() === 'super:120000/300000,kiosco:3000/0,salidas:26550/20000,transporte:23000/0');
  ok('el primer reparto sale del presupuesto de alimentos que había',
    JSON.stringify(L.presupuestosIniciales({ presupuestoAlimentos: 600000, presupuestoGastos: 50000 })) === '{"super":300000,"fresco":150000,"delivery":100000,"kiosco":50000,"otros":50000}');
  const e = L.estadisticasGastos({ ...G, '2026-11-03': [...G['2026-11-03'], { id: 'h', comercio: 'Garbarino', total: 90000, categoria: 'casa', medio: 'cuotas' }] }, '2026-11', '2026-11-04');
  ok('estadísticas del mes: por día, por gasto, el día de más gasto, necesidad o gusto, con qué pagaste y lo que llega a fin de mes',
    e.total === 262550 && e.n === 6 && e.dias === 4 && e.porDia === 65638 && e.ticket === 43758 && e.mejorDia.fecha === '2026-11-03' && e.mejorDia.total === 139550
    && e.diaSemana === 2 && e.necesario === 233000 && e.gustos === 29550 && e.medios.cuotas === 90000 && e.medios[''] === 172550 && e.hormiga === 26000
    && e.serie.length === 30 && e.serie[2].acumulado === 262550 && e.serie[4].acumulado === null && e.proyeccion === 1969125);
  ok('lo de cada mes, para comparar', L.totalesPorMes(G, '2026-11', 3).map(m => `${m.mes}:${m.total}`).join() === '2026-09:0,2026-10:8000,2026-11:172550');

  const st41 = { ...estado({ lastClosed: '2026-11-03', habits: [{ id: 'hs', name: 'Sin deuda nueva', order: 0, auto: { source: 'finanzas', regla: 'sinDeuda', desde: '2026-11-02' } }] }),
    finanzas: finanzas() };
  const { p, c, errs } = await abrirEn('2026-11-04', st41);
  const S = () => p.evaluate(() => window.__prime.S);
  const dia = () => p.locator('.diario').innerText(), sob = () => p.locator('.sobres').innerText(), gmes = () => p.locator('.gastos-mes').innerText();
  const cuentas = async () => { await ir(p, 'finanzas'); const t = await p.locator('.fin-mes').innerText(); await ir(p, 'gastos'); return t; };
  await ir(p, 'gastos');
  ok('Gastos tiene todo en una pestaña: el mes, cargar, presupuesto, movimientos, dónde se va la plata, el cierre y cómo vamos',
    await p.locator('#view > .card').evaluateAll(l => l.map(x => x.className.replace('card ', '')).join()) === 'gastos-mes,cargar,sobres,diario,analisis,cierre,como-vamos');
  ok('y Finanzas ya no tiene las tarjetas de gastos', await (async () => { await ir(p, 'finanzas'); const n = await p.locator('.alimentos, .gastos-var, .analisis, .cargar').count(); await ir(p, 'gastos'); return n === 0; })());
  await p.locator('.cargar [data-act="fmano"]').click();
  await p.locator('#gNombre').fill('Didi al cine'); await p.locator('#gTotal').fill('14000'); await p.locator('#gCat').selectOption('transporte');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('un gasto de otro rubro queda en Otros gastos, sin presupuesto', /Didi al cine\s+Transporte · débito o efectivo\s+\$ 14\.000/.test(await dia())
    && /Otros gastos · \$ 14\.000 · sin presupuesto/i.test(await sob()) && /Transporte\s+necesario\s+\$ 14\.000\s+sin presupuesto/.test(await sob()));
  let fm = await cuentas();
  ok('y el mes de Finanzas lo resta: faltan $ 64.000', /Otros gastos\s+− \$ 14\.000/.test(fm) && /\$ 64\.000\s+te faltan/.test(fm));
  await p.locator('.cargar [data-act="fmano"]').click();
  await p.locator('#gNombre').fill('HBO Max'); await p.locator('#gTotal').fill('12265'); await p.locator('#gCat').selectOption('suscripciones');
  await p.locator('#gMedio').selectOption('tarjeta'); await p.locator('#gCasa').check();
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  ok('lo que ya está en la casa se ve, pero no suma de nuevo', /HBO Max\s+Suscripciones y apps · tarjeta · ya está en la casa/.test(await dia())
    && /\$ 14\.000\s+de \$ 400\.000/.test(await gmes()) && /Además, \$ 12\.265 que ya están en los gastos de la casa/.test(await gmes())
    && !/Suscripciones/.test(await sob()) && /Otros gastos\s+− \$ 14\.000/.test(await cuentas()));
  // Un comprobante en cuotas: Claude propone la categoría y con qué se pagó
  const pedidos = [];
  await c.route('https://api.anthropic.com/**', async route => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    pedidos.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({
      id: 'msg_s', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 150 },
      content: [{ type: 'text', text: JSON.stringify({ comercio: 'Hoyts', fecha: '2026-11-03', categoria: 'salidas', medio: 'cuotas',
        items: [{ nombre: 'Entradas de cine', cantidad: 2, precio: 26550 }], total: 26550, nota: '', confianza: 'alta' }) }] }) });
  });
  await p.evaluate(() => localStorage.setItem('miPrime.claveIA', 'sk-ant-api03-' + 'x'.repeat(40)));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.cargar [data-act="fgaleria"]').click()]);
  ok('"Elegir foto" abre la galería', (await fc.element().getAttribute('capture')) === null);
  await fc.setFiles({ name: 'comprobante.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(300);
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(1500);
  const txt = pedidos.at(-1)?.messages[0].content.find(b => b.type === 'text')?.text || '', props = pedidos.at(-1)?.output_config.format.schema.properties || {};
  ok('le dice a Claude la fecha de hoy y pide la categoría y con qué se pagó', /Hoy es 2026-11-04\./.test(txt) && /salidas/.test(JSON.stringify(props.categoria))
    && /cuotas/.test(JSON.stringify(props.medio)) && /categoria: la que mejor describe/.test(pedidos.at(-1).system));
  ok('la categoría y el medio que propone Claude vienen elegidos', (await p.locator('#tCat').inputValue()) === 'salidas' && (await p.locator('#tMedio').inputValue()) === 'cuotas');
  await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(150);
  const hoyts = (await S()).finanzas.gastos['2026-11-03'][0];
  ok('y se guarda con su categoría y en cuotas', hoyts.categoria === 'salidas' && hoyts.medio === 'cuotas' && /Hoyts\s+Salidas y entretenimiento · en cuotas/.test(await dia()));
  ok('comprar en cuotas deja "Sin deuda nueva" en amarillo ese día', (await S()).marks['2026-11-03']?.hs === 'yellow' && (await S()).marks['2026-11-04']?.hs === 'green');
  // El mes
  ok('el mes: necesario 35 %, gustos 65 %, y a este ritmo dónde termina', /Necesario \$ 14\.000 \(35 %\) · Gustos \$ 26\.550 \(65 %\)/.test(await gmes())
    && /A este ritmo terminás el mes en \$ 304\.125, el 76 % del presupuesto/.test(await gmes()));
  // Dónde se va la plata
  let ana = await p.locator('.analisis').innerText();
  ok('la semana: total, por categoría de mayor a menor con su porcentaje, los hormiga y lo que ya estaba en la casa',
    /2 al 8 de noviembre/.test(ana) && /\$ 52\.815\s+en la semana · alimentos \$ 0 · otros \$ 52\.815 · gustos 73 %/.test(ana)
    && ana.indexOf('Salidas') < ana.indexOf('Transporte') && ana.indexOf('Transporte') < ana.indexOf('Suscripciones') && /50 % del total/.test(ana)
    && /Gastos hormiga: 2 de menos de \$ 20\.000 que suman \$ 26\.265, el 50 % de lo gastado/.test(ana)
    && /\$ 12\.265 de esto ya estaba en los gastos de la casa/.test(ana) && await p.locator('.analisis .cat').count() === 3);
  await p.locator('.analisis [data-act="avista"][data-v="mes"]').click(); await p.waitForTimeout(100);
  ana = await p.locator('.analisis').innerText();
  ok('y el mes', /Noviembre 2026/.test(ana) && /\$ 52\.815\s+en el mes/.test(ana) && await p.locator('.analisis [data-act="amov"][data-n="1"]').isDisabled());
  await p.locator('.analisis [data-act="amov"][data-n="-1"]').click(); await p.waitForTimeout(100);
  ok('un mes sin gastos lo dice', /Octubre 2026/.test(await p.locator('.analisis').innerText()) && /No cargaste gastos ese mes/.test(await p.locator('.analisis').innerText()));
  // Presupuesto de una categoría de otros gastos
  await p.locator('.sobres [data-act="gpres"]').click(); await p.locator('#p_salidas').fill('20000'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('pasado de presupuesto: cuánto y en qué porcentaje', /Salidas y entretenimiento\s+gusto\s+\$ 26\.550\s+de \$ 20\.000\s+te pasaste \$ 6\.550 \(\+33 %\)/.test(await sob())
    && await p.locator('.sobres .cat-s.warn').count() === 1 && /Otros gastos · \$ 40\.550 de \$ 20\.000/i.test(await sob()));
  fm = await cuentas();
  ok('y Finanzas cuenta lo gastado de más', /Otros gastos \(te pasaste\)\s+− \$ 40\.550/.test(fm) && (await S()).finanzas.presupuestos.salidas === 20000);
  // Editar la categoría de un gasto
  await p.locator('.diario .fila', { hasText: 'Didi al cine' }).locator('.ce').click();
  await p.locator('#eCat').selectOption('salidas'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  ok('la categoría se cambia desde el gasto', /Didi al cine\s+Salidas y entretenimiento/.test(await dia()));
  await p.locator('.diario .fila', { hasText: 'Didi al cine' }).locator('.ce').click();
  await p.locator('#eCat').selectOption('transporte'); await p.locator('.sheet [data-x="o"]').click(); await p.waitForTimeout(100);
  // Cierre del mes
  let ci = await p.locator('.cierre').innerText();
  ok('el cierre del mes: 0 de 3, se hace a fin de mes, y dice dónde te pasaste', /Cierre de noviembre · 0 de 3/i.test(ci) && /Se hace el último día del mes/.test(ci)
    && /Te pasaste en Salidas y entretenimiento \(\+\$ 6\.550\)/.test(ci));
  for (const k of ['conciliado', 'desvios', 'presupuesto']) { await p.locator(`[data-act="gcierre"][data-k="${k}"]`).click(); await p.waitForTimeout(80); }
  ci = await p.locator('.cierre').innerText();
  ok('con los tres pasos, el mes queda cerrado con su resumen', /3 de 3/i.test(ci) && /Mes cerrado ✓ Gastaste \$ 40\.550 de \$ 420\.000 \(10 %\);\s+gustos 65 %; con tarjeta 65 %/.test(ci)
    && JSON.stringify((await S()).finanzas.cierres) === '{"2026-11":{"conciliado":true,"desvios":true,"presupuesto":true}}');
  await p.locator('[data-act="gcierre"][data-k="desvios"]').click(); await p.waitForTimeout(80);
  ok('un paso se puede desmarcar', /2 de 3/i.test(await p.locator('.cierre').innerText()) && !('desvios' in (await S()).finanzas.cierres['2026-11']));
  // Cómo vamos
  const cv = await p.locator('.como-vamos').innerText();
  ok('cómo vamos: la curva del mes contra el presupuesto y los últimos 6 meses', await p.locator('.como-vamos svg').count() === 2
    && await p.locator('.como-vamos [data-act="gdia"]').count() === 30 && await p.locator('.como-vamos [data-act="gmesbar"]').count() === 6);
  ok('necesidad o gusto y con qué pagaste, en porcentaje y en pesos', /Necesario\s+35 %\s+\$ 14\.000/.test(cv) && /Gustos\s+65 %\s+\$ 26\.550/.test(cv)
    && /Débito o efectivo\s+35 %\s+\$ 14\.000/.test(cv) && /Tarjeta en cuotas\s+65 %\s+\$ 26\.550/.test(cv) && !/Tarjeta en un pago/.test(cv));
  ok('las estadísticas: por día, por gasto, cuántos, el día de más gasto, hormiga, gustos, con tarjeta',
    /\$ 10\.138\s+Por día/i.test(cv) && /\$ 20\.275\s+Por gasto/i.test(cv) && /2\s+Gastos/i.test(cv) && /3\/11\s+Día de más gasto/i.test(cv) && /El día de más gasto, el mar 3 nov, se fueron \$ 26\.550/.test(cv)
    && /mar\s+Día que más gastás/i.test(cv) && /35 %\s+Hormiga/i.test(cv) && /65 %\s+Gustos/i.test(cv) && /65 %\s+Con tarjeta/i.test(cv) && /—\s+Vs\. mes anterior/i.test(cv));
  await p.locator('[data-act="gdia"][data-i="2"]').click(); await p.waitForTimeout(80);
  ok('tocar un día de la curva muestra el detalle', (await p.locator('#gdet').innerText()) === 'Mar 3 nov: gastaste $ 26.550, $ 26.550 en el mes · al ritmo del presupuesto, $ 42.000');
  await p.locator('[data-act="gmesbar"][data-i="5"]').click(); await p.waitForTimeout(80);
  ok('y tocar un mes, el suyo', (await p.locator('#gdet2').innerText()) === 'Noviembre 2026: $ 40.550 · 10 % del presupuesto de hoy');
  const resp = await p.evaluate(() => {
    const P = window.__prime, base = JSON.parse(JSON.stringify(P.S)), r = [], con = f => ({ ...base, finanzas: { ...base.finanzas, ...f } });
    for (const g of [{ comercio: 'x', total: 1, categoria: 'salidas', deCasa: true, medio: 'cuotas' }, { comercio: 'x', total: 1, categoria: 'joda' },
                     { comercio: 'x', total: 1, deCasa: 'si' }, { comercio: 'x', total: 1, medio: 'cheque' }])
      try { P.prepararRespaldo(JSON.stringify(con({ gastos: { '2026-11-01': [g] } }))); r.push('ok'); } catch (e) { r.push('no'); }
    for (const f of [{ presupuestoGastos: -1 }, { presupuestos: { joda: 1 } }, { presupuestos: { salidas: -1 } }, { cierres: { '2026-13': {} } }, { cierres: { '2026-11': { conciliado: 'si' } } }])
      try { P.prepararRespaldo(JSON.stringify(con(f))); r.push('ok'); } catch (e) { r.push('no'); }
    return r.join();
  });
  ok('el respaldo trae categorías, medios, presupuestos y cierres, y rechaza los rotos (' + resp + ')', resp === 'ok,no,no,no,no,no,no,no,no');
  ok('sin errores de página: ' + JSON.stringify(errs), errs.length === 0);
  await c.close();
}

console.log('\n== 42. Capturas ==');
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
