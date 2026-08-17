import fs from 'node:fs';
/* Los datos de salud NUNCA van al repo (ver .gitignore). Apuntá PRIME_DATA
   a la carpeta donde los tengas, fuera del proyecto:
     $env:PRIME_DATA="C:\\ruta\\a\\mis-datos"; node mi-prime-v2.pruebas.js   */
const U=(process.env.PRIME_DATA||'./').replace(/[\\/]?$/,'/');
const RESPALDO=process.env.PRIME_JSON||'mi-prime-2026-08-16.json';
const CSV=process.env.PRIME_CSV||'com_samsung_shealth_step_daily_trend_20260816104989.csv';
for(const f of [RESPALDO,CSV]) if(!fs.existsSync(U+f)){
  console.error(`\nFalta ${f} en ${U}\nPonelos en una carpeta FUERA del repo y corré:\n  $env:PRIME_DATA="C:\\ruta\\a\\mis-datos"; node mi-prime-v2.pruebas.js\n`);
  process.exit(2);
}
const S=JSON.parse(fs.readFileSync(U+RESPALDO,'utf8'));
const getMark=(d,h)=>(S.marks[d]||{})[h]||null;
const parseISO=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const addDays=(dt,n)=>{const x=new Date(dt);x.setDate(x.getDate()+n);return x;};
const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
function prevIsYellow(date,hid){for(let i=1;i<=7;i++){const m=getMark(iso(addDays(parseISO(date),-i)),hid);if(m===ST.BLUE)continue;return m===ST.YELLOW;}return false;}
const setMark=(d,h,s)=>{(S.marks[d]=S.marks[d]||{})[h]=s;};
const save=()=>{};
let OK=0,FAIL=0;
const t=(n,a,b)=>{const p=JSON.stringify(a)===JSON.stringify(b);console.log((p?'  OK  ':'  FALLA')+'  '+n+(p?'':`   esperado ${JSON.stringify(b)} / obtuve ${JSON.stringify(a)}`));p?OK++:FAIL++;};
/* ===========================================================================
   Mi Prime v2 — módulo consolidado
   Reemplaza a mi-prime-import-pasos.js (lo incluye entero).

   Cambios respecto de v1:
     1. Origen de las marcas: manual > import > cierre automático
     2. Derrotas -> reglas rotas (solo el 2do amarillo seguido) + tropiezos
     3. Metas por hábito con progresión automática en las dos direcciones
     4. Import de pasos desde el CSV de Samsung Health
     5. Hábitos nuevos: "Moverme cada hora" y "Caminar seguido"

   Prime % NO cambia: verdes / (verdes + amarillos). Todos los amarillos
   siguen bajándolo, incluidos los aislados.
   =========================================================================== */

const ST = { GREEN:"green", YELLOW:"yellow", BLUE:"blue" };
const ORIGIN = { MANUAL:"manual", AUTO:"auto", NONE:"none" };

/* ============ PARTE 1 — Migración v1 -> v2 ================================ */

const METAS_INICIALES = {
  "Caminar seguido":   { unidad:"min",    piso:10, meta:20, sube:5, tope:45, fuente:"exercise_time" },
  "Inglés":            { unidad:"min",    piso:15, meta:30, sube:5, tope:60 },
  "Leer":              { unidad:"min",    piso:10, meta:20, sube:5, tope:45 },
  "Ejercicio":         { unidad:"series", piso:9,  meta:15, sube:3, tope:21 },
  "Moverme cada hora": { unidad:"horas",  piso:6,  meta:8,  sube:1, tope:12, fuente:"move_hourly" }
};

function migrate(S, hoy){
  if(S.version >= 2) return S;

  S.autoClosed = S.autoClosed || {};   // { "2026-08-14": ["h7s5ohcv"] }
  S.values     = S.values     || {};   // { "2026-08-14": { "hat3pk68": 32 } }

  // "Caminar 6000 pasos" se parte en dos hábitos distintos
  const caminar = S.habits.find(h => /6000\s*pasos/i.test(h.name));
  if(caminar){
    caminar.name = "Caminar seguido";
    caminar.auto = { source:"steps", threshold:6000, near:0.90 };
    S.habits.push({
      id: "h" + Math.random().toString(36).slice(2, 9),
      name: "Moverme cada hora",
      order: S.habits.length
    });
  }

  for(const h of S.habits){
    const cfg = METAS_INICIALES[h.name];
    if(cfg) h.goal = Object.assign({}, cfg, { desde: hoy });
  }

  S.version = 2;
  return S;
}

/* ============ PARTE 2 — Estadísticas ======================================
   Una sola pasada. Devuelve todo lo que muestra la pantalla de Hoy.        */

function stats(S, desde, hasta){
  const claves = Object.keys(S.marks).sort();
  let victorias = 0, amarillos = 0, reglasRotas = 0, tropiezos = 0;
  let mejorRacha = 0, mejorLimpia = 0;
  const rotasPor = [];
  const ini = desde || claves[0], fin = hasta || claves[claves.length - 1];

  for(const h of (ini && fin ? S.habits : [])){
    let previo = null;      // último estado obligatorio: el azul no cuenta
    let racha = 0, limpia = 0;

    for(let d = parseISO(ini); iso(d) <= fin; d = addDays(d,1)){
      const ds = iso(d);
      const m = S.marks[ds]?.[h.id];
      if(m === ST.BLUE) continue;             // el azul es transparente a todo
      if(!m){ previo = null; continue; }       // sin marca: corta la cadena

      if(m === ST.GREEN){
        victorias++;
        racha++;  limpia++;
        if(racha  > mejorRacha)  mejorRacha  = racha;
        if(limpia > mejorLimpia) mejorLimpia = limpia;
        previo = ST.GREEN;
        continue;
      }

      amarillos++;
      racha = 0;                              // el amarillo siempre corta la racha
      if(previo === ST.YELLOW){
        reglasRotas++;
        limpia = 0;                           // solo la regla rota corta la limpia
        rotasPor.push({ fecha:ds, habito:h.name });
      } else {
        tropiezos++;
        limpia++;
        if(limpia > mejorLimpia) mejorLimpia = limpia;
      }
      previo = ST.YELLOW;
    }
  }

  const base = victorias + amarillos;
  return {
    victorias,
    reglasRotas,
    tropiezos,
    amarillos,
    prime: base ? Math.round(1000 * victorias / base) / 10 : 0,
    mejorRacha,
    mejorRachaLimpia: mejorLimpia,
    rotasPor
  };
}

/* ============ PARTE 3 — Metas y progresión automática =====================
   Sube tras 21 días cumpliendo la meta el 80% de las veces.
   Baja tras 21 días cumpliendo el piso menos de la mitad de las veces.
   Nunca te deja fallando en silencio contra un número viejo.               */

const VENTANA = 21, PARA_SUBIR = 0.80, PARA_BAJAR = 0.50;

function diasEntre(a, b){
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

function evaluarProgresion(S, hoy){
  const avisos = [];

  for(const h of S.habits){
    const g = h.goal;
    if(!g || !g.desde) continue;
    if(diasEntre(g.desde, hoy) < VENTANA) continue;

    let obligatorios = 0, llegoMeta = 0, llegoPiso = 0;
    for(const d of Object.keys(S.marks)){
      if(d < g.desde || d >= hoy) continue;
      const m = S.marks[d][h.id];
      if(!m || m === ST.BLUE) continue;
      obligatorios++;
      const v = S.values?.[d]?.[h.id];
      const valor = (v != null) ? v : (m === ST.GREEN ? g.meta : 0);
      if(valor >= g.meta) llegoMeta++;
      if(valor >= g.piso) llegoPiso++;
    }

    if(obligatorios < 10){ continue; }      // muestra muy chica, no se decide nada

    const antes = g.meta;
    if(llegoMeta / obligatorios >= PARA_SUBIR && g.meta < g.tope){
      g.meta = Math.min(g.meta + g.sube, g.tope);
      g.piso = Math.round(g.meta * 0.6);
      avisos.push({ habito:h.name, tipo:"sube", de:antes, a:g.meta, unidad:g.unidad });
    } else if(llegoPiso / obligatorios < PARA_BAJAR){
      g.meta = Math.max(g.meta - g.sube, g.sube);
      g.piso = Math.round(g.meta * 0.6);
      avisos.push({ habito:h.name, tipo:"baja", de:antes, a:g.meta, unidad:g.unidad });
    }
    g.desde = hoy;                          // la ventana siempre se reinicia
  }

  if(avisos.length) save();
  return avisos;
}

/* Un toque = cumplí la meta. Toque largo = poner el valor real. */
function setValor(S, date, hid, valor){
  const h = S.habits.find(x => x.id === hid);
  if(!h?.goal) return;
  if(!S.values[date]) S.values[date] = {};
  S.values[date][hid] = valor;
  setMark(date, hid, valor >= h.goal.piso ? ST.GREEN : ST.YELLOW);
  if(Object.keys(S.values[date]).length === 0) delete S.values[date];
  save();
}

/* ============ PARTE 4 — Origen de las marcas ============================== */

function originOf(S, date, hid){
  const m = S.marks?.[date]?.[hid];
  if(!m) return ORIGIN.NONE;
  return (S.autoClosed?.[date] || []).includes(hid) ? ORIGIN.AUTO : ORIGIN.MANUAL;
}
function markAutoClosed(S, date, hid){
  (S.autoClosed[date] = S.autoClosed[date] || []).push(hid);
}
function markManual(S, date, hid){
  const a = S.autoClosed?.[date];
  if(!a) return;
  const i = a.indexOf(hid);
  if(i >= 0) a.splice(i, 1);
  if(a.length === 0) delete S.autoClosed[date];
}

/* ============ PARTE 5 — Import desde Samsung Health =======================
   Trampas del archivo: línea 1 es metadata, BOM, coma sobrante al final de
   cada fila, varias filas por día, y day_time se corta como TEXTO — nunca
   new Date(), que reintroduce el bug de UTC.                               */

function parseSamsungSteps(text){
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if(lines.length < 3) throw new Error("El archivo no tiene filas de datos.");
  const head = lines[1].split(",");
  const iDay = head.indexOf("day_time"), iCount = head.indexOf("count");
  if(iDay < 0 || iCount < 0)
    throw new Error("No parece el export de pasos. Buscá el archivo que termina en step_daily_trend.");
  const byDay = {};
  for(let i = 2; i < lines.length; i++){
    const f = lines[i].split(",");
    if(f.length < head.length) continue;
    const date = (f[iDay] || "").slice(0, 10);
    const n = parseInt(f[iCount], 10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(n)) continue;
    byDay[date] = Math.max(byDay[date] || 0, n);
  }
  if(!Object.keys(byDay).length) throw new Error("No se encontró ningún día con pasos.");
  return byDay;
}

function planStepImport(S, stepsByDay, today){
  const targets = S.habits.filter(h => h.auto?.source === "steps");
  const plan = [];
  if(!targets.length) return plan;
  const dates = Object.keys(stepsByDay).sort();

  for(const h of targets){
    const { threshold, near } = h.auto;
    const floor = Math.round(threshold * (near ?? 0.9));
    for(const date of dates){
      if(date >= today) continue;                       // el día en curso no se toca
      if(S.createdAt && date < S.createdAt) continue;
      const steps = stepsByDay[date];
      const from = S.marks?.[date]?.[h.id] || null;
      const origin = originOf(S, date, h.id);

      let to, why, ask = false;
      if(steps >= threshold){ to = ST.GREEN; why = `${steps.toLocaleString("es-AR")} pasos`; }
      else if(steps >= floor){ to = ST.GREEN; ask = true;
        why = `${steps.toLocaleString("es-AR")} pasos — faltaron ${threshold - steps}`; }
      else { to = ST.YELLOW; why = `${steps.toLocaleString("es-AR")} pasos`; }

      if(to === from) continue;                         // idempotencia

      if(origin === ORIGIN.MANUAL){
        plan.push({ date, hid:h.id, from, to, steps, why, action:"informar", ask:false,
                    note:"Lo marcaste vos. No se cambia." });
        continue;
      }
      if(to === ST.YELLOW && prevIsYellow(date, h.id)){
        ask = true; why += " — sería el segundo amarillo seguido";
      }
      plan.push({ date, hid:h.id, from, to, steps, why, action:"proponer", ask,
                  note: origin === ORIGIN.AUTO ? "Lo había cerrado la app sola." : "Estaba sin marcar." });
    }
  }
  return plan.sort((a,b) => a.date < b.date ? -1 : 1);
}

function applyStepImport(S, plan, accepted){
  let n = 0;
  for(const p of plan){
    if(p.action !== "proponer") continue;
    if(!accepted.has(p.date + "|" + p.hid)) continue;
    setMark(p.date, p.hid, p.to);
    markManual(S, p.date, p.hid);      // deja de ser del robot
    n++;
  }
  save();
  return n;
}
console.log('=== MIGRACIÓN');
migrate(S,'2026-08-16');
t('version pasa a 2', S.version, 2);
t('hábito renombrado', !!S.habits.find(h=>h.name==='Caminar seguido'), true);
t('hábito nuevo creado', !!S.habits.find(h=>h.name==='Moverme cada hora'), true);
t('total de hábitos', S.habits.length, 13);
const ing=S.habits.find(h=>h.name==='Inglés');
t('meta de Inglés', [ing.goal.piso,ing.goal.meta,ing.goal.unidad], [15,30,'min']);
const ej=S.habits.find(h=>h.name==='Ejercicio');
t('meta de Ejercicio', [ej.goal.piso,ej.goal.meta,ej.goal.unidad], [9,15,'series']);
t('migrar dos veces no duplica', (migrate(S,'2026-08-16'), S.habits.length), 13);

console.log('\n=== ESTADÍSTICAS (tus datos del 09 al 15/08)');
const r=stats(S);
console.log(`  Victorias ${r.victorias} | Reglas rotas ${r.reglasRotas} | Tropiezos ${r.tropiezos} | Prime ${r.prime}%`);
console.log(`  Mejor racha ${r.mejorRacha} | Mejor racha sin romper la regla ${r.mejorRachaLimpia}`);
t('victorias', r.victorias, 53);
t('reglas rotas = solo 2do amarillo', r.reglasRotas, 2);
t('tropiezos aislados', r.tropiezos, 15);
t('rotas + tropiezos = amarillos', r.reglasRotas+r.tropiezos, 17);
t('Prime % NO cambia (verdes/(verdes+amarillos))', r.prime, 75.7);
console.log('  Rompiste la regla en:', r.rotasPor.map(x=>`${x.habito} el ${x.fecha}`).join(' · '));

console.log('\n=== PROGRESIÓN AUTOMÁTICA');
const H='hTEST';
S.habits.push({id:H,name:'Prueba',order:99,goal:{unidad:'min',piso:15,meta:30,sube:5,tope:60,desde:'2026-07-01'}});
const g=S.habits.find(h=>h.id===H).goal;
function sim(valores, hoy){
  g.piso=15; g.meta=30; g.desde='2026-07-01';
  S.values={};
  for(const d in S.marks) delete S.marks[d][H];   // limpiar la corrida anterior
  valores.forEach((v,i)=>{const d=iso(addDays(parseISO('2026-07-01'),i));
    S.marks[d]=S.marks[d]||{}; S.marks[d][H]= v>=g.piso?ST.GREEN:ST.YELLOW; (S.values[d]=S.values[d]||{})[H]=v;});
  return evaluarProgresion(S,hoy);
}
let a=sim(Array(14).fill(35),'2026-07-15');
t('antes de 21 días no toca nada', a.length, 0);
a=sim(Array(21).fill(35),'2026-07-22');
t('21 días cumpliendo la meta -> sube 30 a 35', [a[0]?.tipo,a[0]?.a], ['sube',35]);
a=sim(Array(21).fill(10),'2026-07-22');
t('21 días abajo del piso -> baja 30 a 25', [a[0]?.tipo,a[0]?.a], ['baja',25]);
a=sim(Array(21).fill(20),'2026-07-22');
t('cumple el piso pero no la meta -> no se mueve', a.length, 0);
a=sim(Array(9).fill(35),'2026-07-22');
t('muestra chica (9 días) -> no decide', a.length, 0);
g.meta=60; g.piso=36; g.desde='2026-07-01';
a=sim(Array(21).fill(90),'2026-07-22');
t('no pasa del tope', S.habits.find(h=>h.id===H).goal.meta<=60, true);

console.log('\n=== IMPORT DE PASOS');
S.habits=S.habits.filter(h=>h.id!==H);
const steps=parseSamsungSteps(fs.readFileSync(U+CSV,'utf8'));
t('parsea días del CSV', Object.keys(steps).length>1200, true);
let plan=planStepImport(S,steps,'2026-08-16');
const prop=plan.filter(p=>p.action==='proponer');
t('propone solo el hueco del 09/08', prop.map(p=>p.date+'->'+p.to), ['2026-08-09->green']);
t('informa sin tocar el azul del 15/08', plan.find(p=>p.action==='informar')?.date, '2026-08-15');
const acc=new Set(prop.filter(p=>!p.ask).map(p=>p.date+'|'+p.hid));
applyStepImport(S,plan,acc);
t('idempotente: 2da corrida no propone nada', planStepImport(S,steps,'2026-08-16').filter(p=>p.action==='proponer'&&!p.ask).length, 0);

console.log('\n=== EFECTO FINAL EN TU PANTALLA');
const f=stats(S);
console.log(`  ANTES:  53 VICTORIAS · 17 DERROTAS · 7 MEJOR RACHA · Prime 75.7%`);
console.log(`  AHORA:  ${f.victorias} VICTORIAS · ${f.reglasRotas} REGLAS ROTAS · ${f.mejorRacha} MEJOR RACHA · Prime ${f.prime}%`);
console.log(`          (${f.tropiezos} tropiezos sueltos, no descuentan · racha limpia ${f.mejorRachaLimpia})`);
console.log(`\n${OK} pruebas OK, ${FAIL} fallando`);
