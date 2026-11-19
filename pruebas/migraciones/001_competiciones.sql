-- =====================================================================
--  El Porrazo · migración 001: varias competiciones
--  Se puede ejecutar en una base que ya tiene datos (la de pruebas o la
--  buena). No borra nada: los pronósticos van por partido y no se tocan.
--  Se puede repetir sin romper nada.
-- =====================================================================

-- ---------- Competiciones disponibles ----------
create table if not exists public.competiciones (
  codigo  text primary key,             -- código de football-data.org
  nombre  text not null,                -- 'LaLiga'
  corto   text not null,                -- 'Liga' (para chips y desgloses)
  orden   int  not null default 99
);
insert into public.competiciones (codigo, nombre, corto, orden) values
  ('PD',  'LaLiga',           'LaLiga',     1),
  ('PL',  'Premier League',   'Premier',    2),
  ('BL1', 'Bundesliga',       'Bundesliga', 3),
  ('SA',  'Serie A',          'Serie A',    4),
  ('CL',  'Champions League', 'Champions',  5)
on conflict (codigo) do update
  set nombre = excluded.nombre, corto = excluded.corto, orden = excluded.orden;

alter table public.competiciones enable row level security;
drop policy if exists "ver competiciones" on public.competiciones;
create policy "ver competiciones" on public.competiciones for select to authenticated using (true);

-- ---------- Jornadas: de qué competición son ----------
alter table public.jornadas add column if not exists competicion text not null default 'PD'
  references public.competiciones;
alter table public.jornadas add column if not exists nombre text;   -- p. ej. 'Octavos · ida' (Champions)

alter table public.jornadas drop constraint if exists jornadas_temporada_num_key;
alter table public.jornadas drop constraint if exists jornadas_comp_temporada_num_key;
alter table public.jornadas add constraint jornadas_comp_temporada_num_key unique (competicion, temporada, num);

-- Los ids pasan de '2026-27-10' a 'PD-2026-27-10'. Para poder renombrarlos,
-- los partidos siguen a su jornada (on update cascade).
alter table public.partidos drop constraint if exists partidos_jornada_id_fkey;
alter table public.partidos add constraint partidos_jornada_id_fkey
  foreign key (jornada_id) references public.jornadas(id) on update cascade on delete cascade;

update public.jornadas set id = competicion || '-' || id
where id !~ '^[A-Z][A-Z0-9]*-';

create index if not exists jornadas_competicion_idx on public.jornadas (competicion, temporada, num);

-- ---------- Ligas: qué competiciones juegan ----------
alter table public.ligas add column if not exists competiciones text[] not null default '{PD}';
alter table public.ligas drop constraint if exists ligas_competiciones_check;
alter table public.ligas add constraint ligas_competiciones_check check (cardinality(competiciones) >= 1);

-- crear_liga ahora recibe las competiciones (por defecto, solo LaLiga)
drop function if exists public.crear_liga(text);
create or replace function public.crear_liga(p_nombre text, p_competiciones text[] default '{PD}')
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_codigo text;
  v_id uuid;
  v_comps text[];
begin
  if auth.uid() is null then raise exception 'Necesitas iniciar sesión'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Ponle un nombre a la liga'; end if;

  select array_agg(c.codigo order by c.orden) into v_comps
  from competiciones c where c.codigo = any(coalesce(p_competiciones, '{}'));
  if v_comps is null then raise exception 'Elige al menos una competición'; end if;
  if cardinality(v_comps) <> cardinality(array(select distinct unnest(p_competiciones))) then
    raise exception 'Alguna competición no existe';
  end if;

  loop
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random() * 31) + 1)::int, 1), '')
      into v_codigo from generate_series(1, 6);
    exit when not exists (select 1 from ligas where codigo = v_codigo);
  end loop;
  insert into ligas (nombre, codigo, owner, competiciones)
    values (left(trim(p_nombre), 40), v_codigo, auth.uid(), v_comps)
    returning id into v_id;
  insert into miembros (liga_id, user_id) values (v_id, auth.uid());
  return json_build_object('id', v_id, 'codigo', v_codigo);
end $$;

revoke execute on function public.crear_liga(text, text[]) from anon;
grant  execute on function public.crear_liga(text, text[]) to authenticated;
