-- =====================================================================
--  La Quiniela · base de datos (Supabase)
--  Pega TODO este archivo en Supabase > SQL Editor > New query > Run.
-- =====================================================================

-- ---------- Tablas ----------

create table if not exists public.perfiles (
  id      uuid primary key references auth.users on delete cascade,
  alias   text not null check (char_length(alias) between 1 and 24),
  creado  timestamptz not null default now()
);

create table if not exists public.ligas (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null check (char_length(nombre) between 1 and 40),
  codigo  text not null unique,
  owner   uuid not null references auth.users on delete cascade,
  creado  timestamptz not null default now()
);

create table if not exists public.miembros (
  liga_id uuid not null references public.ligas on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  unido   timestamptz not null default now(),
  primary key (liga_id, user_id)
);

-- Jornadas y partidos los rellena el robot de GitHub (sync_laliga.py)
create table if not exists public.jornadas (
  id         text primary key,          -- p. ej. '2026-27-10'
  temporada  text not null,             -- '2026-27'
  num        int  not null,
  cierre     timestamptz not null,      -- hora del primer partido
  unique (temporada, num)
);

create table if not exists public.partidos (
  id          bigint primary key,       -- id de football-data.org
  jornada_id  text not null references public.jornadas on delete cascade,
  inicio      timestamptz not null,
  local       text not null,
  visitante   text not null,
  goles_l     int,
  goles_v     int,
  estado      text not null default 'SCHEDULED'
);
create index if not exists partidos_jornada_idx on public.partidos (jornada_id);

create table if not exists public.pronosticos (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  partido_id  bigint not null references public.partidos on delete cascade,
  goles_l     int not null check (goles_l between 0 and 30),
  goles_v     int not null check (goles_v between 0 and 30),
  actualizado timestamptz not null default now(),
  primary key (user_id, partido_id)
);

create or replace function public.tocar_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado := now();
  return new;
end $$;

drop trigger if exists pronosticos_actualizado on public.pronosticos;
create trigger pronosticos_actualizado before update on public.pronosticos
  for each row execute function public.tocar_actualizado();

-- ---------- Funciones de ayuda para los permisos ----------

create or replace function public.mis_ligas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select liga_id from miembros where user_id = auth.uid()
$$;

create or replace function public.comparte_liga(otro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from miembros a
    join miembros b on b.liga_id = a.liga_id
    where a.user_id = auth.uid() and b.user_id = otro
  )
$$;

-- La jornada de un partido está cerrada cuando ha llegado su hora de cierre
create or replace function public.jornada_cerrada(p_partido bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select now() >= j.cierre
    from partidos pa join jornadas j on j.id = pa.jornada_id
    where pa.id = p_partido
  ), true)
$$;

-- ---------- Permisos (Row Level Security) ----------

alter table public.perfiles    enable row level security;
alter table public.ligas       enable row level security;
alter table public.miembros    enable row level security;
alter table public.jornadas    enable row level security;
alter table public.partidos    enable row level security;
alter table public.pronosticos enable row level security;

drop policy if exists "ver perfiles"      on public.perfiles;
drop policy if exists "crear mi perfil"   on public.perfiles;
drop policy if exists "editar mi perfil"  on public.perfiles;
create policy "ver perfiles"     on public.perfiles for select to authenticated using (true);
create policy "crear mi perfil"  on public.perfiles for insert to authenticated with check (id = auth.uid());
create policy "editar mi perfil" on public.perfiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "ver mis ligas" on public.ligas;
create policy "ver mis ligas" on public.ligas for select to authenticated
  using (id in (select public.mis_ligas()));

drop policy if exists "ver miembros de mis ligas" on public.miembros;
drop policy if exists "salir de una liga"         on public.miembros;
create policy "ver miembros de mis ligas" on public.miembros for select to authenticated
  using (liga_id in (select public.mis_ligas()));
create policy "salir de una liga" on public.miembros for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "ver jornadas" on public.jornadas;
drop policy if exists "ver partidos" on public.partidos;
create policy "ver jornadas" on public.jornadas for select to authenticated using (true);
create policy "ver partidos" on public.partidos for select to authenticated using (true);

-- Tus pronósticos los ves siempre. Los de tus compañeros de liga, solo
-- cuando la jornada ya ha cerrado (esa es "la foto").
-- Nadie puede poner ni cambiar un pronóstico después del cierre.
drop policy if exists "ver pronosticos"    on public.pronosticos;
drop policy if exists "poner pronostico"   on public.pronosticos;
drop policy if exists "cambiar pronostico" on public.pronosticos;
create policy "ver pronosticos" on public.pronosticos for select to authenticated
  using (user_id = auth.uid() or (public.jornada_cerrada(partido_id) and public.comparte_liga(user_id)));
create policy "poner pronostico" on public.pronosticos for insert to authenticated
  with check (user_id = auth.uid() and not public.jornada_cerrada(partido_id));
create policy "cambiar pronostico" on public.pronosticos for update to authenticated
  using (user_id = auth.uid() and not public.jornada_cerrada(partido_id))
  with check (user_id = auth.uid() and not public.jornada_cerrada(partido_id));

-- ---------- Acciones de la app ----------

create or replace function public.crear_liga(p_nombre text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_codigo text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Necesitas iniciar sesión'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Ponle un nombre a la liga'; end if;
  loop
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random() * 31) + 1)::int, 1), '')
      into v_codigo from generate_series(1, 6);
    exit when not exists (select 1 from ligas where codigo = v_codigo);
  end loop;
  insert into ligas (nombre, codigo, owner) values (left(trim(p_nombre), 40), v_codigo, auth.uid())
    returning id into v_id;
  insert into miembros (liga_id, user_id) values (v_id, auth.uid());
  return json_build_object('id', v_id, 'codigo', v_codigo);
end $$;

create or replace function public.unirse_liga(p_codigo text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v ligas;
begin
  if auth.uid() is null then raise exception 'Necesitas iniciar sesión'; end if;
  select * into v from ligas where codigo = upper(trim(p_codigo));
  if not found then raise exception 'No existe ninguna liga con ese código'; end if;
  insert into miembros (liga_id, user_id) values (v.id, auth.uid()) on conflict do nothing;
  return json_build_object('id', v.id, 'nombre', v.nombre, 'codigo', v.codigo);
end $$;

-- Quién de tu liga ha entregado ya la quiniela (sin enseñar qué ha puesto)
create or replace function public.entregados(p_jornada text, p_liga uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct p.user_id
  from pronosticos p
  join partidos pa on pa.id = p.partido_id
  join miembros m on m.user_id = p.user_id and m.liga_id = p_liga
  where pa.jornada_id = p_jornada
    and p_liga in (select public.mis_ligas())
$$;

revoke execute on function public.crear_liga(text)           from anon;
revoke execute on function public.unirse_liga(text)          from anon;
revoke execute on function public.entregados(text, uuid)     from anon;
grant  execute on function public.crear_liga(text)           to authenticated;
grant  execute on function public.unirse_liga(text)          to authenticated;
grant  execute on function public.entregados(text, uuid)     to authenticated;
