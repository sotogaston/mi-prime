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
| 🔵 Azul | Libre, no era obligatorio | Neutro |
| ⚪ Gris `?` | Sin dato: día hábil en que no se abrió la app | No hecho en el Prime %, pero no rompe la regla |

1. **Cierre automático del día.** Todo día ya pasado que quedó sin marcar se
   resuelve solo al abrir la app: fin de semana → azul (no descuenta), día de
   semana → **sin dato**. El día en curso nunca se auto-cierra. En el respaldo
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

---

## Las cuatro pantallas

- **Hoy** — checklist con un toque = verde. El `⋯` abre el selector de los tres
  colores. Banner de alerta cuando un hábito viene de amarillo y hoy no puede
  fallar (nunca en fin de semana). Nota del día.
- **Mes** — la rueda de 31 días: un anillo por hábito del centro hacia afuera, un
  sector por día, el día de hoy con contorno, Prime % en el centro. Las celdas se
  tocan para cambiarlas.
- **Semanas** — la planilla semanal: un hábito por vez en bloques 1-7 / 8-14 /
  15-21 / 22-28 / últimos días, cada uno con su VIC y DER, más el total del mes.
- **Más** — hábitos (alta, edición, orden), listas *Hacer menos* y *Hacer más*,
  tabla historial del mes, ajustes y respaldo.

---

## Estructura

```
mi-prime/
├── index.html              la app entera: HTML + CSS + JS en un archivo
├── manifest.webmanifest    nombre, íconos y modo standalone
├── sw.js                   service worker: caché offline
├── icons/                  192, 512 y maskable
├── test.mjs                75 pruebas automatizadas (Playwright)
├── gen-icons.mjs           regenera los íconos
├── PUBLICAR.md             cómo subirla a GitHub Pages
├── package.json
└── README.md
```

Todo el código de la app vive en `index.html`, dividido en 7 secciones
comentadas: estado y persistencia, reglas del sistema, arranque, geometría de las
ruedas, vistas, interacción, y PWA.

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
  y nada más. No hay CDN que pueda caerse ni build que pueda romperse.

## Próximos pasos

- Recordatorio a hora fija — lo más importante para no dejar de marcar. En PWA se
  hace con Notifications + Push API; en Android anda bien, en iOS solo con la app
  ya instalada en la pantalla de inicio.
- Sincronización real entre dispositivos en lugar del export manual.
- Multi-usuario y plantillas de hábitos, para que sirva a otras personas.
- Vista anual y comparación mes contra mes.
- Play Store vía TWA/Bubblewrap sobre esta misma URL — los requisitos y el costo
  están detallados al final de [`PUBLICAR.md`](PUBLICAR.md).
