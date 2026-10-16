"""
Robot de La Quiniela: baja jornadas, horarios y resultados de Primera
División de football-data.org y los guarda en Supabase.

Lo ejecuta GitHub Actions cada 20 minutos (.github/workflows/sync.yml).
Necesita tres secretos en el repositorio:
  FOOTBALL_DATA_TOKEN   tu token gratuito de football-data.org
  SUPABASE_URL          https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  la clave "service_role" (secreta, nunca en la web)
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

FD_TOKEN = os.environ["FOOTBALL_DATA_TOKEN"].strip()
SB_URL = os.environ["SUPABASE_URL"].strip().rstrip("/")
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"].strip()
SEASON = int(os.environ.get("SEASON", "2026"))           # año en que empieza la temporada
TEMPORADA = f"{SEASON}-{str(SEASON + 1)[2:]}"            # '2026-27'

CON_MARCADOR = {"IN_PLAY", "PAUSED", "FINISHED", "AWARDED"}
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


def nombre(team):
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


def main():
    datos = pedir(
        f"https://api.football-data.org/v4/competitions/PD/matches?season={SEASON}",
        headers={"X-Auth-Token": FD_TOKEN},
    )
    partidos_api = [m for m in datos.get("matches", []) if m.get("matchday")]
    if not partidos_api:
        print("La API no ha devuelto partidos; no toco nada.")
        return

    ahora = datetime.now(timezone.utc)
    previas = {
        j["id"]: j["cierre"]
        for j in supabase("GET", f"jornadas?temporada=eq.{TEMPORADA}&select=id,cierre") or []
    }

    por_jornada = {}
    for m in partidos_api:
        por_jornada.setdefault(m["matchday"], []).append(m)

    jornadas, partidos = [], []
    for num, lista in sorted(por_jornada.items()):
        jid = f"{TEMPORADA}-{num:02d}"
        validos = [m for m in lista if m["status"] not in SIN_JUGAR] or lista
        cierre = min(m["utcDate"] for m in validos)
        anterior = previas.get(jid)
        if anterior and fecha(anterior) <= ahora:
            cierre = anterior          # una jornada cerrada no se vuelve a abrir
        jornadas.append({"id": jid, "temporada": TEMPORADA, "num": num, "cierre": cierre})

        for m in lista:
            marcador = (m.get("score") or {}).get("fullTime") or {}
            con = m["status"] in CON_MARCADOR and marcador.get("home") is not None
            partidos.append({
                "id": m["id"],
                "jornada_id": jid,
                "inicio": m["utcDate"],
                "local": nombre(m["homeTeam"]),
                "visitante": nombre(m["awayTeam"]),
                "goles_l": marcador.get("home") if con else None,
                "goles_v": marcador.get("away") if con else None,
                "estado": m["status"],
            })

    supabase("POST", "jornadas?on_conflict=id", jornadas, "resolution=merge-duplicates,return=minimal")
    for i in range(0, len(partidos), 200):
        supabase("POST", "partidos?on_conflict=id", partidos[i:i + 200],
                 "resolution=merge-duplicates,return=minimal")

    jugando = sum(1 for p in partidos if p["estado"] in {"IN_PLAY", "PAUSED"})
    acabados = sum(1 for p in partidos if p["estado"] in {"FINISHED", "AWARDED"})
    print(f"OK {TEMPORADA}: {len(jornadas)} jornadas, {len(partidos)} partidos "
          f"({acabados} acabados, {jugando} en juego).")


if __name__ == "__main__":
    main()
