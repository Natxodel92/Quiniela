-- =====================================================================
--  El Porrazo · migración 002: escudo de cada competición
--  El robot lo rellena solo con la URL que da football-data.org.
-- =====================================================================
alter table public.competiciones add column if not exists emblema text;
