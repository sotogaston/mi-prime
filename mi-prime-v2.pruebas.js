import fs from 'node:fs';
import { cargarLogica } from './cargar-logica.mjs';
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
/* La lógica sale de index.html (bloque @logica): la misma que se publica,
   sin copias. Si cambia la app, estas pruebas prueban lo nuevo. */
const { ST, iso, parseISO, addDays, migrateV2, stats, evaluarProgresion,
        parseSamsungSteps, planStepImport, applyStepImport } = cargarLogica(S);
let OK=0,FAIL=0;
const t=(n,a,b)=>{const p=JSON.stringify(a)===JSON.stringify(b);console.log((p?'  OK  ':'  FALLA')+'  '+n+(p?'':`   esperado ${JSON.stringify(b)} / obtuve ${JSON.stringify(a)}`));p?OK++:FAIL++;};
console.log('=== MIGRACIÓN');
migrateV2(S,'2026-08-16');
t('version pasa a 2', S.version, 2);
t('hábito renombrado', !!S.habits.find(h=>h.name==='Caminar seguido'), true);
t('hábito nuevo creado', !!S.habits.find(h=>h.name==='Moverme cada hora'), true);
t('total de hábitos', S.habits.length, 13);
const ing=S.habits.find(h=>h.name==='Inglés');
t('meta de Inglés', [ing.goal.piso,ing.goal.meta,ing.goal.unidad], [15,30,'min']);
const ej=S.habits.find(h=>h.name==='Ejercicio');
t('meta de Ejercicio', [ej.goal.piso,ej.goal.meta,ej.goal.unidad], [9,15,'series']);
t('migrar dos veces no duplica', (migrateV2(S,'2026-08-16'), S.habits.length), 13);

console.log('\n=== ESTADÍSTICAS (tus datos del 09 al 15/08)');
const r=stats(S);
console.log(`  Victorias ${r.victorias} | Reglas rotas ${r.reglasRotas} | Tropiezos ${r.tropiezos} | Prime ${r.prime}%`);
console.log(`  Mejor racha ${r.mejorRacha} | Mejor racha sin romper la regla ${r.mejorRachaLimpia}`);
t('victorias', r.victorias, 53);
t('reglas rotas = solo 2do amarillo', r.reglasRotas, 2);
t('tropiezos aislados', r.tropiezos, 15);
t('rotas + tropiezos = amarillos', r.reglasRotas+r.tropiezos, 17);
t('respaldo v1: no trae días sin dato', r.sinDato, 0);
t('Prime % = verdes/(verdes+amarillos+sin dato)', r.prime, 75.7);
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
console.log(`          (${f.tropiezos} tropiezos sueltos: no rompen la regla, pero bajan el Prime % · racha limpia ${f.mejorRachaLimpia})`);
console.log(`\n${OK} pruebas OK, ${FAIL} fallando`);
process.exitCode = FAIL ? 1 : 0;
