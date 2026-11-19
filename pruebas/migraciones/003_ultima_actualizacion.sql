-- =====================================================================
--  El Porrazo · migración 003: cuándo se actualizó cada competición
--  El robot lo usa para bajar LaLiga siempre y el resto cada 2 h como mucho.
-- =====================================================================
alter table public.competiciones add column if not exists sincronizado timestamptz;
