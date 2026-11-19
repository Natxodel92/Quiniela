"""
Robot de El Porrazo: baja jornadas, horarios y resultados de varias
competiciones (LaLiga, Premier, Bundesliga, Serie A y Champions) de
football-data.org y los guarda en Supabase.

Lo ejecuta GitHub Actions (.github/workflows/sync.yml). GitHub lanza las
tareas programadas cuando le va bien (a veces con horas de retraso), así que
los días de partido el robot no se va: se queda vigilando y vuelve a bajar los
resultados cada 2 minutos mientras haya partidos en juego, hasta que acaban
todos los del día. Si se le acaba el tiempo (GitHub corta a las 6 h), antes de
irse lanza otra pasada que le toma el relevo.
Necesita tres secretos en el repositorio:
  FOOTBALL_DATA_TOKEN   tu token gratuito de football-data.org
  SUPABASE_URL          https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  la clave "service_role" (secreta, nunca en la web)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

FD_TOKEN = os.environ["FOOTBALL_DATA_TOKEN"].strip()
SB_URL = os.environ["SUPABASE_URL"].strip().rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"].strip()
SEASON = int(os.environ.get("SEASON", "2026"))           # año en que empieza la temporada
TEMPORADA = f"{SEASON}-{str(SEASON + 1)[2:]}"            # '2026-27'
# Competiciones a bajar (códigos de football-data.org). Todas entran en el plan gratis.
COMPETICIONES = [c.strip() for c in os.environ.get("COMPETICIONES", "PD,PL,BL1,SA,FL1,CL,PPL,DED,ELC").split(",") if c.strip()]
# Nombres en castellano solo para equipos españoles: LaLiga y Champions
CON_NOMBRES_ES = {"PD", "CL"}
# Segundos entre competición y competición: así nunca pasamos de ~9 llamadas
# por minuto aunque el robot de la web buena use el mismo token a la vez.
PAUSA = float(os.environ.get("PAUSA", "7"))
# LaLiga se actualiza en cada pasada (y se vigila en directo). El resto, como
# mucho una vez cada INTERVALO_RESTO segundos, para ahorrar llamadas a la API.
FRECUENTES = {c.strip() for c in os.environ.get("FRECUENTES", "PD").split(",") if c.strip()}
INTERVALO_RESTO = float(os.environ.get("INTERVALO_RESTO", str(2 * 3600)))
# FORZAR=1 (al lanzarlo a mano o al subir cambios): baja todas, toque o no
FORZAR = os.environ.get("FORZAR", "").lower() in {"1", "si", "true"}
# Champions: la fase de liga son las jornadas 1-8; las eliminatorias van
# después con número fijo, para que no cambie cuando se sortee la siguiente.
FASES_CL = {
    "PLAYOFFS": (9, "Playoff"), "LAST_16": (11, "Octavos"), "QUARTER_FINALS": (13, "Cuartos"),
    "SEMI_FINALS": (15, "Semifinales"), "FINAL": (17, "Final"),
}

MADRID = ZoneInfo("Europe/Madrid")
CADA = 120                       # segundos entre pasadas con partidos en juego
ANTES = timedelta(minutes=10)    # empieza a vigilar 10 min antes del pitido
LIMITE = 5.5 * 3600              # GitHub corta el trabajo a las 6 h
ACABADO = {"FINISHED", "AWARDED"}
EN_JUEGO = {"IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT"}

CON_MARCADOR = EN_JUEGO | {"FINISHED", "AWARDED"}
SIN_JUGAR = {"POSTPONED", "CANCELLED", "SUSPENDED"}

# Nombres en castellano, buscando por trozos del nombre oficial
NOMBRES = [
    ("alav", "Alavés"), ("athletic", "Athletic Club"), ("atlético", "Atlético de Madrid"),
    ("atletico", "Atlético de Madrid"), ("espanyol", "Espanyol"), ("barcelona", "FC Barcelona"), ("betis", "Real Betis"),
    ("celta", "Celta de Vigo"), ("deportivo", "Deportivo"), ("coruña", "Deportivo"),
    ("elche", "Elche"), ("espanyol", "Espanyol"), ("getafe", "Getafe"), ("girona", "Girona"),
    ("levante", "Levante"), ("málaga", "Málaga"), ("malaga", "Málaga"), ("mallorca", "Mallorca"),
    ("osasuna", "Osasuna"), ("racing", "Racing Santander"), ("rayo", "Rayo Vallecano"),
    ("real madrid", "Real Madrid"), ("sociedad", "Real Sociedad"), ("sevilla", "Sevilla"),
    ("valencia", "Valencia"), ("villarreal", "Villarreal"), ("oviedo", "Real Oviedo"),
    ("valladolid", "Real Valladolid"), ("las palmas", "Las Palmas"), ("legan", "Leganés"),
    ("granada", "Granada"), ("cádiz", "Cádiz"), ("almería", "Almería"),
]


def nombre(team, comp="PD"):
    if comp not in CON_NOMBRES_ES:
        return team.get("shortName") or team.get("name") or "?"
    # Primero el nombre corto ("Espanyol"), luego el oficial ("RCD Espanyol de Barcelona")
    for campo in ("shortName", "name"):
        texto = (team.get(campo) or "").lower()
        for trozo, bonito in NOMBRES:
            if trozo in texto:
                return bonito
    return team.get("shortName") or team.get("name") or "?"


def pedir(url, method="GET", headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        print(f"Error {e.code} en {method} {url}:\n{e.read().decode()[:500]}", file=sys.stderr)
        raise


def supabase(method, path, body=None, prefer=None):
    headers = {"apikey": SB_KEY, "Content-Type": "application/json"}
    if SB_KEY.startswith("eyJ"):          # clave "service_role" clásica (JWT)
        headers["Authorization"] = f"Bearer {SB_KEY}"
    if prefer:
        headers["Prefer"] = prefer
    return pedir(f"{SB_URL}/rest/v1/{path}", method, headers, body)


def fecha(txt):
    return datetime.fromisoformat(txt.replace("Z", "+00:00"))


def marcador(m):
    """Goles a los 90 minutos (más el descuento). En una eliminatoria con
    prórroga o penaltis, la quiniela cuenta el resultado del tiempo reglamentario."""
    score = m.get("score") or {}
    if score.get("duration") in ("EXTRA_TIME", "PENALTY_SHOOTOUT"):
        rt = score.get("regularTime") or {}
        if rt.get("home") is not None:
            return rt
    return score.get("fullTime") or {}


def agrupar(comp, matches):
    """Devuelve {num: (nombre_o_None, [partidos])}."""
    grupos = {}
    if comp != "CL":
        for m in matches:
            if m.get("matchday"):
                grupos.setdefault(m["matchday"], (None, []))[1].append(m)
        return grupos
    vistos = set()
    for m in sorted(matches, key=lambda x: x["utcDate"]):
        if not (m["homeTeam"].get("id") and m["awayTeam"].get("id")):
            continue                     # eliminatoria aún sin sortear
        fase = m.get("stage")
        if fase == "LEAGUE_STAGE" and m.get("matchday"):
            grupos.setdefault(m["matchday"], (None, []))[1].append(m)
        elif fase in FASES_CL:
            base, txt = FASES_CL[fase]
            if fase == "FINAL":
                num, etiqueta = base, txt
            else:
                pareja = (fase, frozenset((m["homeTeam"]["id"], m["awayTeam"]["id"])))
                vuelta = pareja in vistos
                vistos.add(pareja)
                num, etiqueta = base + vuelta, f"{txt} · {'vuelta' if vuelta else 'ida'}"
            grupos.setdefault(num, (etiqueta, []))[1].append(m)
    return grupos


def sincronizar_comp(comp, ahora):
    datos = pedir(
        f"https://api.football-data.org/v4/competitions/{comp}/matches?season={SEASON}",
        headers={"X-Auth-Token": FD_TOKEN},
    )
    grupos = agrupar(comp, datos.get("matches", []))
    if not grupos:
        print(f"{comp}: la API no ha devuelto partidos; no toco nada.")
        return []

    previas = {
        j["id"]: j["cierre"]
        for j in supabase("GET", f"jornadas?competicion=eq.{comp}&temporada=eq.{TEMPORADA}&select=id,cierre") or []
    }

    jornadas, partidos = [], []
    for num, (etiqueta, lista) in sorted(grupos.items()):
        jid = f"{comp}-{TEMPORADA}-{num:02d}"
        validos = [m for m in lista if m["status"] not in SIN_JUGAR] or lista
        cierre = min(m["utcDate"] for m in validos)
        anterior = previas.get(jid)
        if anterior and fecha(anterior) <= ahora:
            cierre = anterior          # una jornada cerrada no se vuelve a abrir
        jornadas.append({"id": jid, "competicion": comp, "temporada": TEMPORADA, "num": num,
                         "nombre": etiqueta, "cierre": cierre})

        for m in lista:
            goles = marcador(m)
            con = m["status"] in CON_MARCADOR and goles.get("home") is not None
            partidos.append({
                "id": m["id"],
                "jornada_id": jid,
                "inicio": m["utcDate"],
                "local": nombre(m["homeTeam"], comp),
                "visitante": nombre(m["awayTeam"], comp),
                "goles_l": goles.get("home") if con else None,
                "goles_v": goles.get("away") if con else None,
                "estado": m["status"],
            })

    supabase("POST", "jornadas?on_conflict=id", jornadas, "resolution=merge-duplicates,return=minimal")
    for i in range(0, len(partidos), 200):
        supabase("POST", "partidos?on_conflict=id", partidos[i:i + 200],
                 "resolution=merge-duplicates,return=minimal")

    jugando = sum(1 for p in partidos if p["estado"] in EN_JUEGO)
    acabados = sum(1 for p in partidos if p["estado"] in ACABADO)
    hora = datetime.now(MADRID).strftime("%H:%M")
    print(f"[{hora}] OK {comp} {TEMPORADA}: {len(jornadas)} jornadas, {len(partidos)} partidos "
          f"({acabados} acabados, {jugando} en juego).", flush=True)
    return partidos


def toca(forzar):
    """Competiciones que tocan en esta pasada: siempre las frecuentes; el
    resto solo si hace al menos INTERVALO_RESTO que no se actualizan."""
    if forzar:
        return list(COMPETICIONES)
    ultima = {}
    try:
        for c in supabase("GET", "competiciones?select=codigo,sincronizado") or []:
            if c.get("sincronizado"):
                ultima[c["codigo"]] = fecha(c["sincronizado"])
    except Exception as e:
        print(f"No he podido leer cuándo se actualizó cada competición ({e}); bajo solo las frecuentes.")
        return [c for c in COMPETICIONES if c in FRECUENTES]
    ahora = datetime.now(timezone.utc)
    lista = []
    for c in COMPETICIONES:
        if c in FRECUENTES or c not in ultima or (ahora - ultima[c]).total_seconds() >= INTERVALO_RESTO:
            lista.append(c)
        else:
            falta = INTERVALO_RESTO - (ahora - ultima[c]).total_seconds()
            print(f"{c}: actualizada hace poco; la siguiente, en {int(falta // 60)} min.")
    return lista


def sincronizar(forzar=False):
    """Baja las competiciones que tocan. Si una falla, sigue con las demás."""
    ahora = datetime.now(timezone.utc)
    todos, fallos = [], []
    comps = toca(forzar)
    for i, comp in enumerate(comps):
        if i:
            time.sleep(PAUSA)            # el plan gratis deja 10 llamadas por minuto
        try:
            try:
                todos += sincronizar_comp(comp, ahora)
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    raise
                print(f"{comp}: demasiadas llamadas seguidas; espero un minuto y repito.", flush=True)
                time.sleep(61)
                todos += sincronizar_comp(comp, ahora)
            try:
                supabase("PATCH", f"competiciones?codigo=eq.{comp}",
                         {"sincronizado": datetime.now(timezone.utc).isoformat()}, "return=minimal")
            except Exception as e:
                print(f"{comp}: no he podido apuntar la hora de actualización ({e}).", file=sys.stderr)
        except Exception as e:
            fallos.append(comp)
            print(f"{comp}: fallo ({e}); sigo con las demás.", file=sys.stderr, flush=True)
    if fallos and len(fallos) == len(comps):
        raise RuntimeError("No se ha podido bajar ninguna competición.")
    return todos


def pendientes(partidos):
    """Partidos de hoy (hora de Madrid) que aún no han acabado, más cualquiera
    que siga en juego o que ya debería haber empezado hace poco."""
    ahora = datetime.now(timezone.utc)
    hoy = ahora.astimezone(MADRID).date()
    lista = []
    for p in partidos:
        if p["jornada_id"].split("-")[0] not in FRECUENTES:
            continue                     # solo se vigilan en directo las frecuentes
        if p["estado"] in ACABADO or p["estado"] in SIN_JUGAR:
            continue
        inicio = fecha(p["inicio"])
        if (p["estado"] in EN_JUEGO
                or inicio.astimezone(MADRID).date() == hoy
                or ahora - timedelta(hours=4) <= inicio <= ahora):
            lista.append(inicio)
    return sorted(lista)


def relevo():
    """Lanza otra pasada del robot para que siga vigilando."""
    repo, token = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
    if not (repo and token):
        print("Sin GITHUB_TOKEN: no puedo pedir relevo.")
        return
    pedir(f"https://api.github.com/repos/{repo}/actions/workflows/{os.environ.get('WORKFLOW', 'sync.yml')}/dispatches",
          "POST", {"Authorization": f"Bearer {token}",
                   "Accept": "application/vnd.github+json"}, {"ref": "main"})
    print("Pido relevo: sale otra pasada para seguir vigilando.")


def main():
    empiezo = time.monotonic()
    partidos = sincronizar(FORZAR)
    if os.environ.get("VIGILAR", "si").lower() in {"no", "0", "false"}:
        print("Modo pruebas: una pasada y listo, sin quedarme vigilando.")
        return
    while True:
        quedan = pendientes(partidos)
        if not quedan:
            print("No quedan partidos hoy. Hasta la próxima.")
            return
        restante = LIMITE - (time.monotonic() - empiezo)
        if restante < CADA:
            relevo()
            return
        ahora = datetime.now(timezone.utc)
        if quedan[0] - ANTES <= ahora:
            espera = CADA                                   # hay partido: cada 2 min
        else:
            espera = (quedan[0] - ANTES - ahora).total_seconds()
            print(f"Próximo partido a las {quedan[0].astimezone(MADRID):%H:%M}; "
                  f"espero hasta 10 min antes.", flush=True)
        time.sleep(max(30, min(espera, restante - 60)))
        try:
            partidos = sincronizar()
        except Exception as e:               # un fallo puntual no tumba la vigilancia
            print(f"Fallo en esta pasada ({e}); reintento en la siguiente.", flush=True)


if __name__ == "__main__":
    main()
