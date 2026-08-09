# Publicar Mi Prime en GitHub Pages

Objetivo: que la app viva en una URL propia, para instalarla en el celular desde
la pantalla de inicio y que funcione sin conexión.

Todo esto se corre **desde tu compu**, parado en la carpeta `mi-prime`, porque
necesita tus credenciales de GitHub.

---

## Opción A — pegarle esto a Claude Code en VS Code

Abrí la carpeta `mi-prime` en VS Code (Archivo → Abrir carpeta) y pegale a Claude
este pedido tal cual:

> Publicá esta carpeta en GitHub Pages. Es una PWA estática, sin build: los
> archivos van tal cual están, en la raíz del repo.
>
> 1. Verificá que estén `git` y `gh` instalados y que `gh auth status` diga que
>    estoy logueado. Si `gh` no está o no estoy logueado, pará y decime qué me
>    falta antes de seguir.
> 2. `git init`, primer commit con todos los archivos (respetando el
>    `.gitignore`), rama `main`.
> 3. Creá el repo público `mi-prime` en mi cuenta y subí el commit.
> 4. Activá GitHub Pages sobre la rama `main`, carpeta raíz.
> 5. Devolvéme la URL final y avisame que el primer deploy tarda 1-2 minutos.
>
> No toques el contenido de `index.html`, `sw.js` ni `manifest.webmanifest`.

---

## Opción B — a mano

Con [GitHub CLI](https://cli.github.com/) instalado y logueado (`gh auth login`),
desde la terminal de VS Code (`Ctrl+ñ`) parado en la carpeta:

```bash
git init
git add .
git commit -m "Mi Prime: PWA de seguimiento de habitos"
git branch -M main
gh repo create mi-prime --public --source=. --push
gh api -X POST repos/:owner/mi-prime/pages -f "source[branch]=main" -f "source[path]=/"
```

Sin `gh`, hacés el repo desde la web de GitHub y después:

```bash
git remote add origin https://github.com/TU-USUARIO/mi-prime.git
git push -u origin main
```

Y activás Pages en **Settings → Pages → Source: Deploy from a branch → main → /(root)**.

---

## Instalarla en el celular

1. Esperá 1-2 minutos al primer deploy.
2. Abrí en Chrome del celular: `https://TU-USUARIO.github.io/mi-prime/`
3. Menú **⋮ → Instalar app** (o *Agregar a pantalla de inicio*). Si no aparece,
   recargá: el navegador la ofrece recién cuando registró el service worker.
4. Abrila desde el ícono. Va a arrancar en pantalla completa, sin barra de
   navegador, y funciona en modo avión.

**Tus datos viven en el teléfono**, no en GitHub. El repo solo tiene el código.
Si cambiás de teléfono, usá *Más → Exportar respaldo* y lo importás del otro lado.

---

## Actualizar la app más adelante

```bash
git add .
git commit -m "que cambie"
git push
```

Pages republica solo. **Importante:** cada vez que cambie `index.html`, subí
también el número de `CACHE_VERSION` en `sw.js` (`mi-prime-v1` → `v2` → …).
Si no, el service worker te sigue sirviendo la versión vieja desde el caché.

---

## El día que quieras ir a Play Store

Esta misma URL es el cimiento. Una **TWA** (Trusted Web Activity) armada con
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) envuelve la PWA en
un `.aab` que se sube a la Play Console; la app sigue siendo esta.

Lo que hay que saber antes de arrancar por ahí:

- La cuenta de desarrollador cuesta unos **US$25 por única vez**.
- Con cuenta **personal creada después del 13/11/2023**, antes de publicar en
  producción tenés que pasar un *closed testing* con **12 testers dados de alta
  14 días corridos**, y Google mira que esos testers realmente usen la app. Si el
  conteo baja de 12, el reloj se reinicia.
- Con cuenta de **organización** (requiere número D-U-N-S) ese requisito no aplica.
- Además hacen falta política de privacidad, ficha de la tienda, capturas e íconos.

Por eso conviene usar la PWA un par de meses primero: ajustás el producto con uso
real y recién después pagás el peaje de la tienda.
