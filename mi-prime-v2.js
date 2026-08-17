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
