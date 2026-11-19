# El Porrazo · entorno de pruebas

Copia de El Porrazo, en la carpeta `pruebas/`, para probar cambios sin tocar
la web de verdad (los archivos de la raíz del repo). Tiene su propia base de datos en Supabase,
su propia web en GitHub Pages y su propio robot de resultados.

## En qué se diferencia de la web buena

- Banda negra arriba: "ENTORNO DE PRUEBAS", para no confundirse.
- `config.js` apunta al proyecto de Supabase **de pruebas**.
- Lo que guarda en el navegador lleva el prefijo `pruebas:` y usa su propia
  caché, así no pisa la sesión ni la liga elegida de la web buena
  (las dos viven en `natxodel92.github.io`).
- El robot pasa una vez por hora y **no se queda vigilando** los partidos
  en directo (`VIGILAR: "no"` en `.github/workflows/sync-pruebas.yml`). Así no gasta
  las llamadas a football-data.org que necesita el robot de la web buena,
  que comparte el mismo token.
- Los iconos están en la carpeta `icons/`, que es donde los busca la web.

## Dónde está cada cosa

- **Web**: `https://natxodel92.github.io/Quiniela/pruebas/`
- **Base de datos**: proyecto `porrazo-pruebas` en Supabase
  (`https://qsxxpnypqupkaacdvtsf.supabase.co`), ya con `schema.sql` aplicado.
- **Robot**: `.github/workflows/sync-pruebas.yml` (en la raíz del repo, porque
  GitHub solo mira ahí), que ejecuta `pruebas/scripts/sync_laliga.py`.

## Lo que hay que hacer a mano una vez

1. Supabase → `porrazo-pruebas` → Authentication → Sign In / Providers → Email:
   desactivar **"Confirm email"**.
2. GitHub → repo Quiniela → Settings → Secrets and variables → Actions →
   New repository secret: `SUPABASE_SERVICE_KEY_PRUEBAS` con la secret key
   (service_role) del proyecto **de pruebas**. El token de football-data es el
   mismo secreto `FOOTBALL_DATA_TOKEN` de siempre.
3. Actions → Sincronizar LaLiga (PRUEBAS) → Run workflow.

## Cambios de base de datos

- `schema.sql`: la base de partida (igual que la web buena hoy).
- `migraciones/001_competiciones.sql`: varias competiciones (LaLiga, Premier,
  Bundesliga, Serie A, Champions). **Aplicada en pruebas** el 19/11/2026.
  Pendiente de aplicar en la buena junto con el código nuevo.
- `migraciones/002_mas_competiciones.sql`: Ligue 1, Liga Portugal, Eredivisie y
  Championship. **Aplicada en pruebas** el 19/11/2026.
- `migraciones/003_ultima_actualizacion.sql`: hora de la última actualización de
  cada competición (LaLiga siempre, el resto cada 2 h). **Aplicada en pruebas** el 19/11/2026.

## Pasar un cambio a la web buena

Nunca se vuelve a ejecutar `schema.sql` entero en el proyecto bueno: se prepara
un script de cambios, se prueba aquí primero y luego se aplica allí.
