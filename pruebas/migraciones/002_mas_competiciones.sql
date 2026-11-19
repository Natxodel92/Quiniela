-- =====================================================================
--  El Porrazo · migración 002: Ligue 1, Liga Portugal, Eredivisie y
--  Championship (todas en el plan gratis de football-data.org).
--  Orden de la barra: LaLiga, Champions, Premier, Bundesliga, Serie A,
--  Ligue 1, Portugal, Eredivisie y Championship.
--  Se puede repetir sin romper nada.
-- =====================================================================
insert into public.competiciones (codigo, nombre, corto, orden) values
  ('PD',  'LaLiga',           'LaLiga',       1),
  ('CL',  'Champions League', 'Champions',    2),
  ('PL',  'Premier League',   'Premier',      3),
  ('BL1', 'Bundesliga',       'Bundesliga',   4),
  ('SA',  'Serie A',          'Serie A',      5),
  ('FL1', 'Ligue 1',          'Ligue 1',      6),
  ('PPL', 'Liga Portugal',    'Portugal',     7),
  ('DED', 'Eredivisie',       'Eredivisie',   8),
  ('ELC', 'Championship',     'Championship', 9)
on conflict (codigo) do update
  set nombre = excluded.nombre, corto = excluded.corto, orden = excluded.orden;
