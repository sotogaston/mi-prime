# Mi Prime — 31 días para mi prime

PWA de seguimiento de hábitos diarios. Sin backend, sin cuentas, sin base de
datos: la app es un HTML y los datos viven en el propio teléfono. Reemplaza las
planillas de papel **"31 días para mi prime"** y **"Planificación semanal"**.

---

## Cómo usarla

**En el celular (la forma pensada):** publicala una vez siguiendo
[`PUBLICAR.md`](PUBLICAR.md), abrí la URL en Chrome y usá **⋮ → Instalar app**.
Queda con ícono propio en la pantalla de inicio, abre en pantalla completa y
funciona en modo avión.

**En la compu:** doble clic en `index.html`. Se abre en el navegador y funciona
igual, solo que sin caché offline (el service worker necesita http/https).

Los datos se guardan en el dispositivo donde marcás. Cada uno tiene su historial
por separado: para moverlo, **Más → Exportar respaldo** genera un `.json` que
importás del otro lado.

---

## Las reglas del sistema

| Color | Significado | Cuenta como |
|---|---|---|
| 🟢 Verde | Lo hice | Victoria (VIC) |
| 🟡 Amarillo | No lo hice | Derrota (DER) |
| 🔵 Azul | Libre: fin de semana, feriado o día que no era obligatorio | Neutro |
| ⚪ Gris `?` | Sin dato: día hábil que quedó sin marcar | No hecho en el Prime %, pero no rompe la regla |

1. **Cierre automático del día.** Todo día ya pasado que quedó sin marcar se
   resuelve solo al abrir la app: fin de semana o feriado → azul (no descuenta),
   día hábil → **sin dato**. El día en curso nunca se auto-cierra. En el respaldo
   el sin dato se guarda como un amarillo anotado en `autoClosed` (lo puso la
   app, no vos); tocar la celda lo convierte en una marca tuya.
2. **Nunca dos amarillos seguidos.** Es la regla dura. Al intentar marcar el 2º
   amarillo consecutivo en un mismo hábito la app pide confirmación explícita y lo
   suma al contador de *reglas rotas* del mes. Los azules no cortan la secuencia:
   se saltean, también de un mes al otro. Un día vacío o sin dato sí la corta.
   El cartel "Hoy no podés fallar" nombra el día en que quedó el amarillo y no
   aparece en fin de semana.
3. **Racha.** Verdes consecutivos. El azul no suma pero tampoco corta; el amarillo
   y el sin dato cortan a cero.
4. **Prime %** = verdes ÷ (verdes + amarillos + sin dato) del mes. Los azules
   quedan fuera del denominador porque no eran obligatorios. Los amarillos
   sueltos (*tropiezos*) no rompen la regla, pero sí bajan el Prime %.
5. **Metas.** La progresión automática ignora los días sin dato: no hay un valor
   real que medir.
6. **Feriados.** Los nacionales de Argentina vienen cargados (2026 oficiales; los
   de 2027 calculados por la Ley 27.399, a confirmar con el calendario oficial).
   En Hoy, un botón toma el día como feriado o, si es feriado y te toca trabajar,
   como día hábil.

## Horarios y recordatorios

Cada hábito puede tener horario de lunes a viernes (**Más → ✎**: desde y hasta).
Con horario, **Hoy** se ordena por hora y marca el bloque de *ahora*.

Una PWA sin servidor no puede programar notificaciones con la app cerrada, así
que los avisos los da la **app de Android** (ver abajo): a la hora de cada
hábito, de lunes a viernes, sin feriados, y no avisa lo que ya marcaste hoy.
Los hábitos a la misma hora van en un solo aviso. Desde la web, **Más →
Recordatorios en el calendario** sigue bajando un `.ics` para quien prefiera
el calendario.

Lo de la noche se confirma a la mañana: si el último día hábil (hasta 3 días
atrás) quedó con hábitos sin marcar, Hoy los muestra con ✓ / ✕ antes de que
queden en gris.

## App de Android

Es la misma `index.html` dentro de una app de [Capacitor](https://capacitorjs.com)
(`android/`), con tres agregados que en la web no existen: **avisos programados**
(plugin Local Notifications, alarmas exactas, 14 días hacia adelante que se
reprograman cada vez que marcás algo), **pasos de Health Connect** (plugin
capacitor-health, ver *Pasos*) y **exportar respaldo** con el menú de compartir
(Drive, WhatsApp, mail). Necesita Android 8.0 o más.

Instalarla:

1. En la web: **Más → Exportar respaldo**.
2. **Más → Bajar la app de Android** (la release
   [`android`](https://github.com/sotogaston/mi-prime/releases/tag/android)) y
   abrir el archivo. Android pide permiso para instalar apps de esa fuente: se
   da una vez.
3. En la app: **Más → Importar respaldo**, aceptar las notificaciones y
   **Probar un aviso**. Si un aviso llega tarde: Ajustes → Apps → Mi Prime →
   Batería → Sin restricciones.

Los datos de la app y los de la web son independientes: se pasan con el
respaldo. Las versiones nuevas se instalan encima sin perder nada.

Cómo se arma: el workflow **App de Android** (`.github/workflows/android.yml`)
corre las pruebas en cada push y después compila el APK. El número de versión
es la cantidad de commits, así cada una es mayor que la anterior. Con los
secretos del repo `ANDROID_FIRMA` (la llave `mi-prime.p12` en base64) y
`ANDROID_CLAVE` lo firma; en `main` además lo publica en la release `android`,
que es el link de la web.

La llave **nunca va al repo** (`.gitignore` la bloquea). Está guardada en
Google Drive, en *Mi Prime — llave de la app de Android*: es lo único que hace
falta para volver a cargar los secretos. Si se pierde, la versión siguiente no
se instala encima: hay que exportar, desinstalar, instalar y volver a importar.
En una compu con el SDK de Android también se compila firmado con
`npm run android:apk`, con `android/keystore.properties` apuntando a la llave.

---

## Pasos

La pestaña **Pasos** muestra los pasos por día, semana (lunes a domingo), mes y
año, como Samsung Health: el total, el promedio diario, los días que llegaste a
la meta y el mejor día, con un gráfico de barras (verde = llegó a la meta) y la
tabla de números. La meta es una sola (8.000 si no se cambió; *Cambiar*
debajo del gráfico) y vale **de lunes a viernes**: sábados, domingos y feriados
son días libres (barra azul), suman al total y al promedio pero no a *días
hábiles con meta*. *Caminar seguido* es llegar a esa meta: en un día hábil, al
llegar se marca solo en verde (como marca de la app; lo que marcaste vos no se
toca) y Hoy muestra los pasos del día contra la meta. Quedarse corto no marca
nada solo: esos días se revisan con *Revisar*.

- **En la app de Android** se leen solos de **Health Connect**, donde Samsung
  Health comparte los pasos (Samsung Health → Ajustes → Health Connect → que
  pueda escribir *Pasos*). La primera vez se toca **Conectar con Health
  Connect** y se da el permiso, que es solo de pasos. Se actualizan al abrir la
  app, al volver a ella, al entrar a Pasos y cada 2 minutos con Pasos en
  pantalla. Health Connect deja traer hasta 30 días anteriores al permiso (pedir
  más atrás es un error), así que la primera lectura es de 29 días; si no
  devuelve la suma por día, la app suma los registros de la app que más pasos
  tiene. Si no hay nada, Pasos dice qué revisar y abre Health Connect.
- **En la web** se carga el CSV de Samsung Health (`…step_daily_trend…csv`,
  de Samsung Health → Ajustes → Descargar datos personales). En la app sirve
  para traer el historial de antes de esos 30 días.

Los pasos se guardan por día en el teléfono y viajan en el respaldo. Health
Connect manda (si Samsung Health recalcula un día, se corrige); el CSV solo
completa o sube. El promedio cuenta los días con dato y deja afuera el día en
curso, que todavía suma. Con los pasos guardados, la app propone marcar
*Caminar seguido* en los días que falten, con la misma hoja de revisión del
import. Qué datos lee y dónde quedan: [`privacidad.html`](privacidad.html).

---

## Comida

La pestaña **Comida** suma las calorías y proteínas del día contra una meta
calculada con tu perfil (sexo, edad, altura, peso, peso meta, ritmo y
actividad, en *Completar perfil*):

- **Gasto diario**: Mifflin-St Jeor (base) × actividad (1,2 a 1,9; *moderada*
  1,55 si no se cambia).
- **Calorías meta**: gasto − déficit del ritmo elegido (0,5 kg por semana =
  550 kcal menos por día, a 7.700 kcal por kilo), nunca debajo de 1.500 kcal
  (hombre) o 1.200 (mujer).
- **Proteína**: 1,8 g por kilo de peso actual.

Con 73,2 kg, 164 cm, 39 años, hombre, moderado y 0,5 kg por semana da unas
**1.880 kcal y 130 g de proteína**, y faltan unas 7 semanas para los 70 kg.
*Registrar medidas* guarda el peso, que recalcula todo, y la cintura (opcional,
una vez por semana alcanza): *Tu meta* muestra cuánto cambió desde la primera
medida y la relación cintura/altura, que es sana por debajo de 0,5 (con 164 cm,
menos de 82 cm de cintura). Debajo, la **meta de cintura** con fecha estimada y
la próxima etapa (0,55 y 0,525 de la altura): al principio sale del ritmo de
peso (~0,9 cm por kilo) y, con dos semanas de medidas, de lo que viene bajando,
entre 0,15 y 0,75 cm por semana.

Lo que comés se carga de tres formas: **Sacar foto**, **Elegir foto** o
**Agregar a mano**. Se pueden mandar **hasta 4 fotos de la misma comida**
(otro plato, otro ángulo, la etiqueta): la primera abre la hoja y desde ahí se
suman las otras, de la cámara o de a varias desde la galería, y van juntas en
un solo pedido. Las fotos (achicadas a 1024 px) van a **Claude Opus 5.5** con
la API de Anthropic, que devuelve cada plato con su porción, calorías y
proteína; antes de guardar se puede corregir cada número, y una aclaración
("era media porción", "sin aceite") cambia la estimación. La foto no se guarda.
En *Agregar a mano*, si no sabés las calorías, las dejás vacías y el botón pasa
a **Calcular**: Claude estima a partir de lo que escribiste ("2 empanadas de
carne"), con la misma hoja para corregir, y se guarda con tu texto como nombre.
Cada cálculo cuesta unos 2 a 3 centavos de dólar (algo menos con texto) en tu
cuenta de Anthropic, o sale de los créditos de API del plan Max: la clave
(*platform.claude.com → Claves de API*) se carga en *Calorías con Claude*,
queda solo en el teléfono y **no viaja en el respaldo**. Los últimos 7 días se
ven en una tabla (verde: dentro de la meta o proteína alcanzada; amarillo: te
pasaste de calorías).

Cada comida es **desayuno, almuerzo, merienda, cena o colación**: se propone
por la hora (hasta las 11 desayuno, hasta las 16:30 almuerzo, hasta las 20:30
merienda, después cena) y se puede cambiar. Tocando una comida se edita (nombre,
tipo, hora, calorías, proteína) o se borra. Con *Guardar en frecuentes* queda
en **Frecuentes**: las del tipo que toca a esa hora aparecen arriba y se cargan
con un toque. La tabla de los últimos 7 días se toca para ver **qué se comió
cada día**, con ‹ › para ir y volver, y para agregar algo a un día pasado.

**Aviso de comidas:** a las 22:00 (se cambia o se apaga debajo de la lista de
hoy), si falta alguna de las cuatro, la app de Android avisa cuáles faltan, y
Hoy y Comida lo muestran desde esa hora. Se programa para los próximos 14 días
y se reprograma con cada comida que se carga.

El SDK de Anthropic va empaquetado en `vendor/anthropic-sdk.js` (se regenera
con `npm run vendor` a partir de `ia-entrada.mjs`) y se carga recién al
analizar la primera foto.

---

## Finanzas

La pestaña **Finanzas** lleva la plata del mes con la misma idea que los
hábitos: cargás lo que pasa y la app hace las cuentas.

- **El mes** (arriba, con ‹ › para ver otros): lo que entra, la casa, alimentos
  y cuotas, y cuánto **sobra o falta**. Lo que pasa una sola vez (un adelanto
  de sueldo, su descuento, un saldo a favor de la tarjeta) se carga como *algo
  de este mes*. Un sueldo cuenta para el mes que paga: el que se cobra el 30 de
  octubre es plata de noviembre. El aguinaldo es un ingreso que entra solo en
  junio y diciembre.
- **Vencimientos**: cada cuota y cada gasto de la casa del mes, por día, con ✓
  para marcarlo pagado, y cuánto falta pagar. Hoy muestra lo que vence hoy y
  mañana, y lo que venció sin marcar; la app de Android avisa el día antes a
  las 10. Un día 31 en un mes de 30 cae el 30.
- **Alimentos** y **Gastos**, en dos tarjetas: alimentos tiene su presupuesto
  (600.000 si no se cambia) y cuánto queda por semana para lo que falta; gastos
  es lo que no es comida ni está en la casa (salidas, transporte, suscripciones,
  regalos, gustos) y arranca sin presupuesto, para medir primero. Cada gasto
  lleva una **categoría** (súper, verdulería y carnicería, delivery, kiosco,
  salidas, transporte, suscripciones, familia y regalos, gustos personales,
  casa, salud, otros) y de ahí sale en qué tarjeta va; los viejos, sin
  categoría, son alimentos. Se carga **a mano** o con **la foto del ticket o
  del comprobante** (también los de Mercado Pago): Claude Opus 5.5 lee el
  comercio, la fecha, la categoría, cada renglón (los descuentos en negativo) y
  el total, y antes de guardar se corrige. Se guarda todo menos la foto. Un
  ticket largo va en hasta 4 fotos, a 2048 px para que se lea la letra chica,
  con la misma clave de Anthropic que Comida (unos 2 a 4 centavos de dólar por
  ticket). *Ya está en un gasto de la casa* marca lo que ya se cuenta en Casa
  (una suscripción, los gastos de Tizi): se ve en la lista y en el análisis,
  pero no se suma de nuevo al mes ni al presupuesto.
- **Dónde se va la plata**: por semana (de lunes a domingo) o por mes, el total
  dividido en alimentos y gastos, cada categoría de mayor a menor con su
  porcentaje y lo del período anterior, los **gastos hormiga** (los de menos de
  $ 20.000: cuántos y cuánto suman) y los comercios donde más se gastó. Es la
  base para el análisis de cada sábado y para comparar mes a mes.
- **Colchón**: lo ahorrado y los hitos de 1, 3 y 6 meses de gastos (la casa,
  alimentos y el presupuesto de gastos), con el mes en que se llega guardando
  lo que sobra.
- **Deudas**: lo que se debe, la tasa, la cuota y cuándo termina cada una, con
  la más cara arriba; el total y cuánto se va por mes en intereses (más IVA).
  Una deuda puede tener cuotas distintas algunos meses (`plan`): la primera de
  un préstamo, las compras en cuotas de la tarjeta.
- **Los próximos 12 meses**: lo que sobra y cómo quedaría el colchón.
- **A dónde vas**: frases con tus números que se actualizan solas: cuánto
  falta o sobra este mes y desde cuándo cierran solos, qué deuda termina y
  cuánto libera, cómo bajan las cuotas, la última cuota, cuándo llegás al
  colchón, cómo vas con alimentos, los días sin deuda nueva y lo que falta
  pagar. En Hoy aparece una tarjeta como la reflexión: una frase de finanzas a
  la mañana y otra a la tarde (un mazo de 12, en rueda) y uno de tus datos, que
  cambia cada día.
- **Hábitos de finanzas**: cuatro hábitos para sumar a Hoy que se marcan solos
  con lo que cargás, como *Caminar seguido* con los pasos. *Anotar lo que
  gasto* queda verde el día que cargás un gasto de alimentos (si no gastaste,
  lo marcás vos; a las 21 avisa). *Sin deuda nueva* es verde cada día y
  amarillo el día que cargás una deuda tildando *La saqué hoy* o un adelanto
  marcado como deuda nueva (cargar una deuda que ya tenías no cuenta).
  *Alimentos al ritmo* es verde mientras lo gastado en el mes no se adelanta
  más de una semana al presupuesto. *Vencimientos al día* es verde si no hay
  nada vencido sin marcar como pagado (se mira cada día, el de hoy). Lo que
  marcás vos manda y no se toca; lo que marcó la app queda en `marcasFin` y se
  corrige si cambian los datos (un ticket de ayer, un pago marcado tarde). La
  plata no tiene fin de semana: se miran todos los días.

Se carga todo desde la app o de una vez con **Importar finanzas**: un `.json`
con `{ "finanzas": { ... } }`, o un respaldo entero, del que toma solo las
finanzas. Se valida entero antes de tocar nada, reemplaza lo que trae y deja lo
demás (por ejemplo, los gastos de alimentos ya cargados). Con
`{ "actualizar": { "deudas": [ ... ] } }` cambia por `id` lo que ya está y suma
lo nuevo, sin tocar el resto: sirve para cargar un resumen nuevo de la tarjeta
sin pisar lo cargado en el celular. `inicio` es el primer
mes del plan: antes no se cuenta ni se avisa. Los datos viven en el teléfono y
viajan en el respaldo, como el resto; nunca van al repo.

---

## Las siete pantallas

- **Hoy** — checklist en orden de horario, con un toque = verde. El `⋯` abre el
  selector de los tres colores. Banner de alerta cuando un hábito viene de
  amarillo y hoy no puede fallar (nunca en fin de semana ni feriado). Lo que
  quedó sin marcar el último día hábil, para confirmarlo. **Reflexión**: una
  frase a la mañana y otra distinta desde las 14, de un mazo de 16 sobre la
  disciplina mezclado al azar, sin repetir hasta pasar por todas (la maldición
  de la disciplina, quedarse quieto duele más que avanzar, "la calidad no es un
  acto, es un hábito"…); tocándola se ven todas y cuántas veces marcaste verde
  desde que empezaste. Nota del día.
- **Mes** — la rueda de 31 días: un anillo por hábito del centro hacia afuera, un
  sector por día, el día de hoy con contorno, Prime % en el centro. Las celdas se
  tocan para cambiarlas.
- **Semanas** — la planilla semanal: un hábito por vez en bloques 1-7 / 8-14 /
  15-21 / 22-28 / últimos días, cada uno con su VIC y DER, más el total del mes.
- **Pasos** — pasos por día, semana, mes y año, con totales y promedios.
- **Comida** — calorías y proteínas del día contra la meta, por foto o escribiendo lo que comiste.
- **Finanzas** — el mes con lo que sobra o falta, los vencimientos para marcar,
  alimentos y gastos por separado (a mano o con la foto del ticket), dónde se va
  la plata, colchón y deudas.
- **Más** — hábitos (alta, edición, orden; los que tienen meta de series o minutos
  pueden pasar a sí o no y volver), listas *Hacer menos* y *Hacer más*,
  tabla historial del mes, ajustes y respaldo.

---

## Estructura

```
mi-prime/
├── index.html              la app entera: HTML + CSS + JS en un archivo
├── manifest.webmanifest    nombre, íconos y modo standalone
├── sw.js                   service worker: caché offline
├── icons/                  192, 512 y maskable
├── android/                la app de Android (Capacitor); android:sync copia la web adentro
├── capacitor.config.json   id de la app y color del ícono de los avisos
├── .github/workflows/      pruebas y APK firmado en cada push
├── privacidad.html         qué datos lee la app (Health Connect la enlaza)
├── test.mjs                424 pruebas automatizadas (Playwright)
├── cargar-logica.mjs       recorta la lógica de index.html para probarla en Node
├── mi-prime-v2.pruebas.js  pruebas de la lógica contra tus datos reales (fuera del repo)
├── ia-entrada.mjs          entrada para empaquetar el SDK de Anthropic (npm run vendor)
├── vendor/                 SDK de Anthropic empaquetado, para las fotos de Comida y los tickets
├── gen-icons.mjs           regenera los íconos (web y Android)
├── PUBLICAR.md             cómo subirla a GitHub Pages
├── package.json
└── README.md
```

Todo el código de la app vive en `index.html`, dividido en 7 secciones
comentadas: estado y persistencia, reglas del sistema, arranque, geometría de las
ruedas, vistas, interacción, y PWA.

La lógica pura (fechas, reglas, estadísticas, metas e import de pasos) está entre
los marcadores `/* @logica:inicio */` y `/* @logica:fin */`. Es la **única copia**:
las pruebas en Node la recortan de ahí con `cargar-logica.mjs`, así que prueban
exactamente lo que se publica. Ese bloque solo puede usar `S` y `save()` de
afuera; `test.mjs` falla si alguien le mete una dependencia del navegador.

## Correr las pruebas

```bash
npm install
npx playwright install chromium
npm test
```

Levantan un servidor estático propio y prueban lo mismo que va a correr en
producción: las reglas de color, la confirmación del 2º amarillo, el cálculo de
rachas, el cierre automático de días pasados, la geometría de las dos ruedas, el
alta de hábitos, la persistencia entre recargas, el manifest y los íconos, que el
service worker quede activo, **que la app cargue con la red cortada**, y que
abierta con doble clic desde el disco siga andando.

La suite corre con la fecha fija en un miércoles (`HOY_FIJO` en `test.mjs`), así
da lo mismo correrla un domingo. Si ya tenés un Chromium instalado:
`PW_CHROME=/ruta/a/chrome npm test`.

Las pruebas de la lógica contra tus datos reales (respaldo + export de pasos de
Samsung Health, que nunca van al repo) corren con Node, sin navegador:

```bash
PRIME_DATA=/ruta/a/mis-datos node mi-prime-v2.pruebas.js
```

Para verla en local sobre http (con service worker): `npm run serve`.

---

## Decisiones de diseño

- **Sin dependencias.** Ni frameworks ni CDNs: el archivo funciona abierto desde
  el sistema de archivos, en avión, para siempre.
- **Paleta validada para daltonismo.** Verde `#0ca30c`, amarillo `#fab219`, azul
  `#2a78d6` (claro) / `#3987e5` (oscuro). Separación CVD ΔE 11.3 en el peor par.
  El amarillo queda por debajo de 3:1 de contraste en modo claro, así que **nunca
  va solo**: siempre lo acompañan glifo (✓ ✕ – ?), etiqueta de texto, leyenda y la
  tabla historial. Hay además un modo texturas (rayado diagonal) en Ajustes para
  daltonismo severo o impresión.
- **Modo claro y oscuro**, automático según el sistema, con toggle manual.
- **Degradación**: si el navegador bloquea el almacenamiento local, la app avisa
  ("solo en memoria") en lugar de fallar en silencio.
- **Importar respaldo nunca pisa a ciegas.** El archivo se valida entero antes de
  tocar nada; si está mal, dice por qué y tus datos quedan intactos. Si está
  bien, muestra qué trae y qué reemplaza, y pide confirmación.

- **Sin dependencias también en runtime.** El service worker cachea seis archivos
  y nada más. No hay CDN que pueda caerse, y la web no tiene build: Capacitor
  solo envuelve la misma `index.html` para Android. La única excepción es el SDK
  de Anthropic para las fotos de Comida y de los tickets, que va copiado en
  `vendor/` (no de un CDN) y se carga solo al analizar una foto.

## Próximos pasos

- Sincronización real entre dispositivos en lugar del export manual.
- Multi-usuario y plantillas de hábitos, para que sirva a otras personas.
- Vista anual y comparación mes contra mes.
- Play Store vía TWA/Bubblewrap sobre esta misma URL — los requisitos y el costo
  están detallados al final de [`PUBLICAR.md`](PUBLICAR.md).
