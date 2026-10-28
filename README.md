# La Quiniela

Quiniela de Primera División para jugar con amigos: cada uno entra con un apodo
y un PIN (sin correo ni datos personales), rellena los 10 partidos de cada jornada y compite en ligas
privadas con código. Los horarios y resultados entran solos.

- **Web**: GitHub Pages (gratis)
- **Base de datos y login**: Supabase (plan gratis)
- **Resultados automáticos**: GitHub Actions + football-data.org (gratis)

Todo se monta desde el navegador, sin instalar nada. Calcula una hora.

---

## Paso 1 · Crear la base de datos en Supabase

1. Entra en <https://supabase.com>, crea una cuenta (puedes usar la de GitHub) y pulsa **New project**.
   - Nombre: `quiniela`. Región: **West EU (Ireland)** o **Central EU (Frankfurt)**.
   - Apunta la contraseña de la base de datos en algún sitio, aunque no la usaremos.
2. Cuando termine de crearse, ve a **SQL Editor → New query**.
3. Abre el archivo `supabase/schema.sql`, copia todo, pégalo y pulsa **Run**.
   Debe acabar en *Success. No rows returned*.

## Paso 2 · Configurar el acceso con apodo y PIN

En **Authentication → Sign In / Providers → Email**:

- Deja **Enable Email provider** activado (por dentro se usa, aunque nadie ponga su correo).
- **Desactiva "Confirm email"** y guarda.

Así, cada amigo crea su jugador con un apodo y un PIN de 4 a 6 cifras y entra al momento.

## Paso 3 · Copiar las claves

En **Project Settings → API** (o **API Keys**) verás:

- **Project URL** → `https://algo.supabase.co`
- **anon / publishable key** → es pública, va en la web.
- **service_role / secret key** → es secreta, solo para el robot (paso 5). **Nunca en la web.**

Abre `config.js` y sustituye los dos valores:

```js
supabaseUrl: "https://algo.supabase.co",
supabaseAnonKey: "tu anon o publishable key",
```

## Paso 4 · Publicar la web en GitHub Pages

1. En GitHub, **New repository** → nombre `quiniela` → **Public** → Create.
2. **Add file → Upload files** y arrastra: `index.html`, `app.js`, `config.js`,
   `manifest.webmanifest`, `sw.js`, `README.md` y las carpetas `icons`, `scripts` y `supabase`.
   Pulsa **Commit changes**.
3. La carpeta `.github` suele estar oculta, así que créala a mano:
   **Add file → Create new file**, escribe como nombre `.github/workflows/sync.yml`,
   pega el contenido de ese archivo y **Commit changes**.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → rama `main`, carpeta `/ (root)` → Save.
   En un par de minutos la web estará en `https://natxodel92.github.io/quiniela/`.

## Paso 5 · Activar los resultados automáticos

1. Regístrate gratis en <https://www.football-data.org/client/register>. Te llega un token por correo.
2. En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**.
   Crea estos tres:

   | Nombre | Valor |
   | --- | --- |
   | `FOOTBALL_DATA_TOKEN` | el token de football-data.org |
   | `SUPABASE_URL` | la Project URL |
   | `SUPABASE_SERVICE_KEY` | la service_role / secret key |

3. Pestaña **Actions** → si lo pide, pulsa *I understand… enable them* →
   **Sincronizar LaLiga** → **Run workflow**.
4. Tras unos segundos debe salir en verde con algo como
   `OK 2026-27: 38 jornadas, 380 partidos`. En Supabase, **Table Editor → partidos**
   ya verás toda la temporada.

A partir de aquí se ejecuta solo cada 20 minutos: horarios, cambios de fecha,
marcadores en directo y resultados finales.

## Paso 6 · Jugar

1. Abre la web en el móvil, pulsa **Soy nuevo** y crea tu jugador con apodo y PIN.
2. **Ligas → Crear una liga** y pulsa **Invitar por WhatsApp**.
3. Tus amigos abren el enlace, crean su jugador y quedan dentro de la liga.
4. Para tenerla como app: en Android, menú de Chrome → *Instalar aplicación*;
   en iPhone, Safari → Compartir → *Añadir a pantalla de inicio*.

---

## Cómo funciona

- **Cierre**: cada jornada cierra a la hora del primer partido. Desde ese momento la
  base de datos no deja poner ni cambiar pronósticos, aunque alguien lo intente a mano.
- **La foto**: antes del cierre solo ves quién ha entregado. Después se destapan los
  pronósticos de tus compañeros de liga (nunca los de gente que no está en tus ligas).
- **Puntos**: marcador exacto 5. Si no, 1 por el signo y 1 por cada equipo al que
  aciertes los goles. Con partidos en juego, los puntos se van actualizando.
- **Aplazados**: no puntúan hasta que se jueguen; cuando acaban, cuentan solos.
- **Varias ligas**: rellenas la quiniela una vez y cuenta en todas tus ligas.

## Límites del plan gratis (a tener en cuenta)

- **PIN corto**: un PIN de 4 cifras es cómodo pero no muy seguro. Para una prueba entre
  amigos va bien (Supabase frena los intentos repetidos). Si la app crece, conviene
  pedir PIN de 6 cifras o añadir un correo opcional para recuperar la cuenta.
- **Datos personales**: no se pide correo. Por dentro, Supabase guarda cada jugador como
  `apodo@jugadores.quiniela.app`, una dirección inventada a la que nunca se envía nada.
- **Pausa por inactividad**: Supabase pausa los proyectos gratis sin uso durante una
  semana. El robot de resultados ya lo mantiene despierto.
- **GitHub Actions**: si el repositorio pasa 60 días sin cambios, GitHub desactiva las
  tareas programadas y te avisa por correo. Basta con volver a activarlas en **Actions**.

## Arreglos a mano

**Alguien ha olvidado su PIN.** Como organizador lo arreglas desde la propia web, sin
tocar SQL: ve a la pestaña **Ligas** y, en la tarjeta de tu liga, cada jugador tiene un
botón **Resetear PIN**. Le pones un PIN temporal, se lo pasas, entra con él y luego se
cambia al suyo desde **Ligas → Tu cuenta**. (Solo el dueño de la liga ve ese botón.)

Si prefieres hacerlo a mano en Supabase → **SQL Editor**, cambia `pep` por su apodo
en minúsculas, sin acentos y con guiones en vez de espacios (Àlex Pérez → `alex-perez`),
y `1234` por el PIN nuevo:

```sql
update auth.users
set encrypted_password = extensions.crypt('q-1234-quiniela', extensions.gen_salt('bf'))
where email = 'pep@jugadores.quiniela.app';
```

**Un resultado viene mal.**

En Supabase → **Table Editor → partidos** puedes
editar `goles_l`, `goles_v` y `estado` (`FINISHED`). Ojo: el robot lo volverá a
sobrescribir con lo que diga la API en su siguiente pasada.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html`, `app.js` | La app |
| `config.js` | Tus claves públicas de Supabase |
| `manifest.webmanifest`, `sw.js`, `icons/` | Para instalarla en el móvil |
| `supabase/schema.sql` | Tablas y permisos de la base de datos |
| `scripts/sync_laliga.py` | Robot que baja jornadas y resultados |
| `.github/workflows/sync.yml` | Lanza el robot cada 20 minutos |
