# Integrar v2 en index.html

> **Histórico.** Esta integración ya está hecha y `mi-prime-v2.js` se borró: la
> lógica vive solo en `index.html`, entre `/* @logica:inicio */` y
> `/* @logica:fin */`. `mi-prime-v2.pruebas.js` la lee de ahí con
> `cargar-logica.mjs`. Queda como registro de los seis enganches.

`mi-prime-v2.js` reemplaza al módulo anterior de import (lo incluye entero). Va antes del `</script>` final. Después hay que tocar seis lugares del código que ya tenés.

## Los seis enganches

**1. Al cargar el estado**, después de leer `localStorage`:

```js
migrate(S, iso(new Date()));
const avisos = evaluarProgresion(S, iso(new Date()));
if(avisos.length) mostrarAvisos(avisos);   // "Inglés sube de 30 a 35 min"
```

**2. En el cierre automático**, donde escribe la marca del día vencido:

```js
setMark(d, h.id, esFinde ? ST.BLUE : ST.YELLOW);
markAutoClosed(S, d, h.id);          // <-- agregar
```

**3. Donde el usuario toca una celda** (vista Hoy y vista Mes):

```js
setMark(date, hid, nuevo);
markManual(S, date, hid);            // <-- agregar: la marca pasa a ser suya
```

Sin 2 y 3 el import queda inofensivo pero inútil: si no sabés quién escribió, todo cuenta como manual y no hay nada que llenar.

**4. En las tarjetas de la pantalla Hoy**, reemplazar el cálculo viejo:

```js
const r = stats(S, primerDiaDelMes, ultimoDiaDelMes);
// r.victorias    -> tarjeta 1  (verde)
// r.reglasRotas  -> tarjeta 2  "REGLAS ROTAS", no "DERROTAS"
// r.mejorRacha   -> tarjeta 3
// r.tropiezos    -> texto gris chico: "15 tropiezos sueltos: no rompen la regla, pero bajan el Prime %"
// r.prime        -> centro de la rueda del mes (sin cambios: 75,7%)
```

**5. Toque largo en un hábito con meta**, para cargar el valor real:

```js
setValor(S, date, hid, minutosOSeries);
```

Un toque normal sigue siendo "cumplí la meta" y guarda el valor objetivo solo. Si el número fuera obligatorio, en dos semanas dejás de marcar.

**6. En la vista Más**, la pantalla de import de pasos (`renderImportUI` del módulo anterior, sin cambios).

## Después de integrar

**Subí `CACHE_VERSION` en `sw.js`.** Si no, el service worker sigue sirviendo la versión vieja y vas a pensar que no funcionó.

## Verificación

`mi-prime-v2.pruebas.js` corre con `node` y no necesita navegador ni dependencias. Son 22 pruebas contra tu export real. Las 45 de Playwright siguen valiendo; estas se suman.

```
node mi-prime-v2.pruebas.js
```

Falta cubrir en Playwright, que node no puede: que el toque largo abra el teclado numérico, que la tarjeta diga "REGLAS ROTAS", que el aviso de progresión se vea al abrir, y el import completo desde el input de archivo.
