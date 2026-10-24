/* La lógica de Mi Prime vive en un solo lugar: el bloque de index.html entre
   los marcadores @logica:inicio y @logica:fin. Esto lo recorta y lo corre en
   Node, con S y save() provistos desde afuera, para probarla sin navegador.
   Devuelve el contexto: sus funciones y constantes (ST, ORIGIN, TODAY, FERIADOS_AR, REFLEXIONES, TIPOS_COMIDA, COMIDAS_DEL_DIA,
   PRESUPUESTO_ALIMENTOS, HITOS_COLCHON, HABITOS_FINANZAS, FRASES_FINANZAS). */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function cargarLogica(S, save = () => {}){
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const m = html.match(/\/\* @logica:inicio \*\/([\s\S]*?)\/\* @logica:fin \*\//);
  if(!m) throw new Error('index.html no tiene los marcadores /* @logica:inicio */ y /* @logica:fin */');
  const ctx = vm.createContext({ S, save, console });
  vm.runInContext(m[1] + '\n;Object.assign(globalThis, { ST, ORIGIN, TODAY, FERIADOS_AR, REFLEXIONES, TIPOS_COMIDA, COMIDAS_DEL_DIA, PRESUPUESTO_ALIMENTOS, HITOS_COLCHON, HABITOS_FINANZAS, FRASES_FINANZAS });', ctx, { filename: 'index.html#logica' });
  return ctx;
}
