"use strict";
/* La Quiniela · app web (Supabase + GitHub Pages) */

const CFG = window.QUINIELA_CONFIG || {};
const app = document.getElementById("app");
const configurada = !!(CFG.supabaseUrl && !CFG.supabaseUrl.includes("XXXX") &&
  CFG.supabaseAnonKey && !CFG.supabaseAnonKey.startsWith("PEGA"));
const sb = configurada && window.supabase
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
    })
  : null;

const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch(e){} }
};

const S = {
  loading: true, error: null, user: null, perfil: null,
  jornadas: [], partidos: [], porJornada: {}, mios: {}, ajenos: {},
  ligas: [], miembros: [], perfiles: {}, entregados: {},
  liga: store.get("liga"), tab: "jornada", sel: null, selFijada: false,
  draft: {}, msg: {}, login: { modo: "nuevo" }, pending: false
};

/* ---------- utilidades ---------- */
function h(tag, props, ...kids){
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})){
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()){
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const ahora = () => Date.now();
const sign = (a, b) => a > b ? "1" : a === b ? "X" : "2";
const toInt = v => { if (v === "" || v == null) return null; const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 30 ? n : null; };
const cerrada = j => ahora() >= new Date(j.cierre).getTime();
const EN_JUEGO = new Set(["IN_PLAY", "PAUSED"]);
const ACABADO = new Set(["FINISHED", "AWARDED"]);
const APLAZADO = new Set(["POSTPONED", "CANCELLED", "SUSPENDED"]);

function fmtFecha(iso){ return new Date(iso).toLocaleString("es-ES", { weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }); }
function fmtDia(iso){ return new Date(iso).toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"short" }); }
function fmtHora(iso){ return new Date(iso).toLocaleTimeString("es-ES", { hour:"2-digit", minute:"2-digit" }); }
function falta(iso){
  let ms = new Date(iso).getTime() - ahora();
  if (ms <= 0) return "";
  const d = Math.floor(ms / 864e5); ms -= d * 864e5;
  const hh = Math.floor(ms / 36e5); ms -= hh * 36e5;
  const m = Math.floor(ms / 6e4);
  if (d > 0) return `faltan ${d} d ${hh} h`;
  if (hh > 0) return `faltan ${hh} h ${m} min`;
  return `faltan ${m} min`;
}

function resultado(p){
  if (p.goles_l == null || p.goles_v == null) return null;
  if (!(ACABADO.has(p.estado) || EN_JUEGO.has(p.estado))) return null;
  return [p.goles_l, p.goles_v];
}
function pts(pick, res){
  if (!pick || !res) return null;
  if (pick[0] === res[0] && pick[1] === res[1]) return 5;
  let s = 0;
  if (sign(pick[0], pick[1]) === sign(res[0], res[1])) s++;
  if (pick[0] === res[0]) s++;
  if (pick[1] === res[1]) s++;
  return s;
}
const ptsClass = s => s === 5 ? "p5" : s === 2 ? "p2" : s === 1 ? "p1" : "";

const nombre = uid => (S.perfiles[uid] && S.perfiles[uid].alias) || "Jugador";
const partidosDe = j => S.porJornada[j.id] || [];
const ligaActual = () => S.ligas.find(l => l.id === S.liga) || S.ligas[0] || null;
const miembrosDe = liga => liga ? S.miembros.filter(m => m.liga_id === liga.id).map(m => m.user_id) : [];
function pickDe(uid, partidoId){
  const src = uid === S.user.id ? S.mios : S.ajenos[uid];
  const p = src && src[partidoId];
  return p ? [p.goles_l, p.goles_v] : null;
}
function linea(uid, j){
  let t = 0, ex = 0, sg = 0, hay = false, jugado = false;
  for (const p of partidosDe(j)){
    const pick = pickDe(uid, p.id);
    if (pick) jugado = true;
    const res = resultado(p);
    const s = pts(pick, res);
    if (s == null) continue;
    hay = true; t += s;
    if (s === 5) ex++;
    else if (sign(pick[0], pick[1]) === sign(res[0], res[1])) sg++;
  }
  return { t, ex, sg, hay, jugado };
}
function siguiente(){ return S.jornadas.find(j => !cerrada(j)) || null; }
function enJuego(j){ return partidosDe(j).some(p => EN_JUEGO.has(p.estado)); }
function terminada(j){ const ps = partidosDe(j); return ps.length > 0 && ps.every(p => ACABADO.has(p.estado)); }

/* ---------- datos ---------- */
async function todo(build){
  const out = [];
  for (let from = 0; ; from += 1000){
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
function ok(r){ if (r.error) throw r.error; return r.data; }

async function cargar(){
  const uid = S.user.id;
  const [perfil, jornadas, partidos, mios, ligas, miembros] = await Promise.all([
    sb.from("perfiles").select("id,alias").eq("id", uid).maybeSingle().then(ok),
    sb.from("jornadas").select("id,num,cierre").eq("temporada", CFG.temporada).order("num").then(ok),
    todo(() => sb.from("partidos").select("id,jornada_id,inicio,local,visitante,goles_l,goles_v,estado")
      .like("jornada_id", CFG.temporada + "-%").order("id")),
    todo(() => sb.from("pronosticos").select("partido_id,goles_l,goles_v,actualizado").eq("user_id", uid).order("partido_id")),
    sb.from("ligas").select("id,nombre,codigo,owner,creado").order("creado").then(ok),
    sb.from("miembros").select("liga_id,user_id").then(ok)
  ]);
  S.perfil = perfil;
  S.jornadas = jornadas;
  S.partidos = partidos;
  S.porJornada = {};
  for (const p of partidos) (S.porJornada[p.jornada_id] ||= []).push(p);
  for (const k in S.porJornada) S.porJornada[k].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id - b.id);
  S.mios = {};
  for (const p of mios) S.mios[p.partido_id] = p;
  S.ligas = ligas;
  S.miembros = miembros;
  if (!S.ligas.find(l => l.id === S.liga)) S.liga = S.ligas[0] ? S.ligas[0].id : null;

  const ids = [...new Set([uid, ...miembros.map(m => m.user_id)])];
  const perfiles = ids.length ? await sb.from("perfiles").select("id,alias").in("id", ids).then(ok) : [];
  S.perfiles = {};
  for (const p of perfiles) S.perfiles[p.id] = p;

  const otros = ids.filter(i => i !== uid);
  S.ajenos = {};
  if (otros.length){
    const filas = await todo(() => sb.from("pronosticos").select("user_id,partido_id,goles_l,goles_v")
      .in("user_id", otros).order("user_id").order("partido_id"));
    for (const f of filas) (S.ajenos[f.user_id] ||= {})[f.partido_id] = f;
  }
  if (!S.selFijada){
    const sig = siguiente();
    S.sel = sig ? sig.num : (S.jornadas.length ? S.jornadas[S.jornadas.length - 1].num : 1);
  }
  S.entregados = {};
}

async function cargarEntregados(j, liga){
  const key = j.id + "|" + liga.id;
  if (S.entregados[key]) return;
  S.entregados[key] = { cargando: true, ids: [] };
  const { data, error } = await sb.rpc("entregados", { p_jornada: j.id, p_liga: liga.id });
  S.entregados[key] = { cargando: false, ids: error ? [] : data.map(x => typeof x === "string" ? x : Object.values(x)[0]) };
  render(true);
}

/* ---------- render ---------- */
/* render(true) = refresco de fondo: si estás escribiendo, espera a que acabes */
function render(suave){
  const a = document.activeElement;
  if (suave && a && (a.tagName === "INPUT" || a.tagName === "SELECT") && app.contains(a)) { S.pending = true; return; }
  S.pending = false;
  app.replaceChildren(...vista());
}
document.addEventListener("focusout", () => setTimeout(() => {
  const a = document.activeElement;
  if (S.pending && !(a && (a.tagName === "INPUT" || a.tagName === "SELECT") && app.contains(a))) render();
}, 0));

function flash(key, k, t){
  S.msg[key] = { k, t }; render();
  if (k === "ok") setTimeout(() => { if (S.msg[key] && S.msg[key].t === t){ S.msg[key] = null; render(); } }, 3500);
}
const msgEl = key => S.msg[key] ? h("div", { class: "msg " + S.msg[key].k, text: S.msg[key].t }) : null;

function vista(){
  if (!configurada) return [cabecera(), h("div", { class: "empty" }, h("strong", { text: "Falta configurar Supabase" }),
    "Abre config.js y pega la URL y la anon key de tu proyecto.")];
  if (S.loading) return [cabecera(), h("div", { class: "empty", text: "Cargando la quiniela…" })];
  if (!S.user) return [cabecera(), pantallaLogin()];
  if (S.error) return [cabecera(), h("div", { class: "empty" }, h("strong", { text: "Algo ha fallado" }), S.error,
    h("div", { style: "margin-top:14px" }, h("button", { class: "btn small", onclick: arrancar }, "Reintentar")))];
  if (!S.perfil) return [cabecera(), pantallaAlias()];
  const tabs = [["jornada", "Jornada"], ["clasif", "Clasificación"], ["ligas", "Ligas"]];
  return [
    cabecera(),
    h("nav", { class: "tabs", role: "tablist" }, tabs.map(([k, l]) =>
      h("button", { role: "tab", "aria-selected": String(S.tab === k), onclick: () => { S.tab = k; render(); } }, l))),
    S.tab === "clasif" ? clasificacion() : S.tab === "ligas" ? vistaLigas() : vistaJornada()
  ];
}

function cabecera(){
  return h("header", { class: "mast" },
    h("div", {}, h("h1", { text: "La Quiniela" }), h("p", { text: "Primera División " + (CFG.temporada || "").replace("-", "/") })),
    S.user && S.perfil ? h("div", { class: "me" }, "Juegas como", h("b", { text: S.perfil.alias }),
      h("button", { class: "linkbtn", onclick: salir }, "Salir")) : null);
}

/* ----- entrada: apodo + PIN, sin correo -----
   Supabase necesita un "correo" por dentro: lo fabricamos con el apodo
   (pep@jugadores.quiniela.app). Nunca se manda nada a esa dirección. */
const DOMINIO = CFG.dominioUsuarios || "jugadores.quiniela.app";
function usuarioDe(apodo){
  return (apodo || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}
const correoDe = u => `${u}@${DOMINIO}`;
const claveDe = pin => `q-${pin}-quiniela`;
const pinValido = p => /^\d{4,6}$/.test(p || "");

function pantallaLogin(){
  const L = S.login;
  const nuevo = L.modo === "nuevo";
  let apodo = L.apodo || "", pin = "", pin2 = "";
  const cambiar = m => () => { S.login = { modo: m, apodo }; S.msg.login = null; render(); };
  const enviar = e => { e.preventDefault(); nuevo ? crearJugador(apodo, pin, pin2) : entrar(apodo, pin); };
  const pinInput = (label, set) => [h("label", { class: "lbl", text: label }),
    h("div", { class: "field" }, h("input", { class: "code-input", type: "password", inputmode: "numeric", maxlength: "6",
      autocomplete: nuevo ? "new-password" : "current-password", placeholder: "••••", "aria-label": label, oninput: e => set(e.target.value) }))];
  return h("section", {},
    h("div", { class: "hero" }, h("div", { class: "ball", text: "1 X 2" }),
      h("p", { text: "Pronostica los 10 partidos de cada jornada y pica a tus amigos en vuestra liga privada." })),
    h("nav", { class: "tabs", role: "tablist" }, [["nuevo", "Soy nuevo"], ["entrar", "Ya juego"]].map(([m, l]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(L.modo === m), onclick: cambiar(m) }, l))),
    h("form", { class: "card", onsubmit: enviar },
      h("h3", { text: nuevo ? "Crea tu jugador" : "Entra en la quiniela" }),
      h("p", { class: "note", style: "margin:0", text: nuevo
        ? "Solo un apodo y un PIN de 4 a 6 cifras. No pedimos correo ni ningún dato personal."
        : "Con el apodo y el PIN que elegiste." }),
      h("label", { class: "lbl", text: "Apodo" }),
      h("div", { class: "field" }, h("input", { type: "text", maxlength: "24", autocomplete: "username", placeholder: "Tu apodo",
        value: apodo, "aria-label": "Apodo", oninput: e => { apodo = e.target.value; } })),
      pinInput("PIN", v => { pin = v; }),
      nuevo ? pinInput("Repite el PIN", v => { pin2 = v; }) : null,
      h("button", { class: "btn wide", style: "margin-top:14px", type: "submit" }, nuevo ? "Crear y entrar" : "Entrar"),
      msgEl("login"),
      h("p", { class: "note", style: "margin:10px 0 0", text: nuevo
        ? "Apunta tu PIN. Si lo olvidas, el organizador te lo puede cambiar."
        : "¿Has olvidado el PIN? Pídele al organizador que te lo cambie." })));
}

async function crearJugador(apodo, pin, pin2){
  apodo = (apodo || "").trim().slice(0, 24);
  const u = usuarioDe(apodo);
  if (u.length < 2) return flash("login", "err", "El apodo necesita al menos 2 letras o números.");
  if (!pinValido(pin)) return flash("login", "err", "El PIN tiene que ser de 4 a 6 cifras.");
  if (pin !== pin2) return flash("login", "err", "Los dos PIN no coinciden.");
  const { data, error } = await sb.auth.signUp({ email: correoDe(u), password: claveDe(pin), options: { data: { alias: apodo } } });
  if (error){
    const t = /registered|exists/i.test(error.message) ? "Ese apodo ya está cogido. Prueba con otro, o entra en «Ya juego» si es tuyo."
      : /rate|many/i.test(error.message) ? "Demasiados intentos seguidos. Espera unos minutos."
      : "No se ha podido crear el jugador. Prueba otra vez.";
    return flash("login", "err", t);
  }
  if (!data.session) return flash("login", "err", "Falta desactivar «Confirm email» en Supabase (paso 2 de la guía).");
}

async function entrar(apodo, pin){
  const u = usuarioDe(apodo);
  if (!u || !pinValido(pin)) return flash("login", "err", "Escribe tu apodo y tu PIN de 4 a 6 cifras.");
  const { error } = await sb.auth.signInWithPassword({ email: correoDe(u), password: claveDe(pin) });
  if (error) flash("login", "err", /rate|many/i.test(error.message) ? "Demasiados intentos. Espera unos minutos." : "Apodo o PIN incorrectos.");
}

function cuentaCard(){
  let p1 = "", p2 = "";
  const cambiar = async e => {
    e.preventDefault();
    if (!pinValido(p1)) return flash("pin", "err", "El PIN tiene que ser de 4 a 6 cifras.");
    if (p1 !== p2) return flash("pin", "err", "Los dos PIN no coinciden.");
    const { error } = await sb.auth.updateUser({ password: claveDe(p1) });
    flash("pin", error ? "err" : "ok", error ? "No se ha podido cambiar el PIN." : "PIN cambiado.");
  };
  const inp = (ph, set) => h("input", { type: "password", inputmode: "numeric", maxlength: "6", autocomplete: "new-password",
    placeholder: ph, "aria-label": ph, oninput: e => set(e.target.value) });
  return h("form", { class: "card", onsubmit: cambiar },
    h("h3", { text: "Tu cuenta" }),
    h("p", { class: "note", style: "margin:0 0 10px" }, "Para entrar en otro móvil escribe tu apodo ", h("b", { text: S.perfil.alias }), " y tu PIN."),
    h("div", { class: "field" }, inp("PIN nuevo", v => { p1 = v; }), inp("Repítelo", v => { p2 = v; }),
      h("button", { class: "btn small", type: "submit" }, "Cambiar PIN")),
    msgEl("pin"));
}

function pantallaAlias(){
  let alias = "";
  const guardar = async e => {
    e.preventDefault();
    const a = alias.trim().slice(0, 24);
    if (!a) return flash("alias", "err", "Escribe un apodo.");
    const { error } = await sb.from("perfiles").upsert({ id: S.user.id, alias: a });
    if (error) return flash("alias", "err", "No se ha podido guardar. Prueba otra vez.");
    await arrancar();
  };
  return h("form", { class: "card", style: "margin-top:20px", onsubmit: guardar },
    h("h3", { text: "¿Cómo te llamamos?" }),
    h("p", { class: "note", style: "margin:0 0 10px", text: "Es el nombre que verán tus amigos en la clasificación." }),
    h("div", { class: "field" }, h("input", { type: "text", maxlength: "24", placeholder: "Tu apodo", "aria-label": "Apodo",
      oninput: e => { alias = e.target.value; } })),
    h("button", { class: "btn wide", style: "margin-top:10px", type: "submit" }, "Empezar a jugar"),
    msgEl("alias"));
}

/* ----- selector de liga ----- */
function selectorLiga(){
  if (S.ligas.length < 2) return null;
  return h("select", { class: "liga", "aria-label": "Liga", onchange: e => { S.liga = e.target.value; store.set("liga", S.liga); render(); } },
    S.ligas.map(l => h("option", { value: l.id, selected: l.id === (ligaActual() || {}).id }, l.nombre)));
}
function avisoSinLiga(){
  return h("div", { class: "card" }, h("h3", { text: "Juega con tus amigos" }),
    h("p", { class: "note", style: "margin:0 0 10px", text: "Crea una liga o únete con el código que te pase un amigo para competir en una clasificación." }),
    h("button", { class: "btn small", onclick: () => { S.tab = "ligas"; render(); } }, "Ir a Ligas"));
}

/* ----- jornada ----- */
function chips(){
  const sig = siguiente();
  const bar = h("div", { class: "chips" });
  for (let n = 1; n <= 38; n++){
    const j = S.jornadas.find(x => x.num === n);
    const cls = "chip" + (!j ? " nodata" : sig && n === sig.num ? " next" : cerrada(j) ? " done" : "");
    bar.append(h("button", { class: cls, "aria-pressed": String(n === S.sel), "aria-label": "Jornada " + n,
      onclick: () => { S.sel = n; S.selFijada = true; render(); } }, "J" + n));
  }
  requestAnimationFrame(() => {
    const el = bar.querySelector('[aria-pressed="true"]');
    if (el) bar.scrollLeft = el.offsetLeft - bar.clientWidth / 2 + el.offsetWidth / 2;
  });
  return bar;
}

function vistaJornada(){
  const out = h("section", {});
  if (!S.ligas.length) out.append(avisoSinLiga());
  out.append(chips());
  if (siguiente()) out.append(h("p", { class: "legend" }, h("i"), "Próxima jornada"));
  const j = S.jornadas.find(x => x.num === S.sel);
  if (!j || !partidosDe(j).length){
    out.append(h("div", { class: "jhead" }, h("h2", { text: "Jornada " + S.sel })),
      h("div", { class: "empty" }, h("strong", { text: "Partidos sin cargar" }), "Aparecerán solos en cuanto LaLiga los publique."));
    return out;
  }
  const cer = cerrada(j), vivo = enJuego(j);
  out.append(h("div", { class: "jhead" },
    h("div", {}, h("h2", { text: "Jornada " + j.num }),
      h("span", { class: "status " + (vivo ? "live" : cer ? "closed" : "open"),
        text: vivo ? "En juego" : cer ? (terminada(j) ? "Terminada" : "Cerrada") : "Abierta" })),
    h("div", { class: "when" }, (cer ? "Cerró el " : "Cierra el ") + fmtFecha(j.cierre),
      cer ? null : h("br"), cer ? null : h("span", { "data-falta": j.cierre, text: falta(j.cierre) }))));
  out.append(cer ? boletoCerrado(j) : boletoAbierto(j));
  const liga = ligaActual();
  if (liga){
    const sel = selectorLiga();
    const card = cer ? fotoCard(j, liga) : entregadosCard(j, liga);
    out.append(h("div", { style: "margin-top:14px" }, sel, card));
  }
  out.append(h("p", { class: "note" }, "Marcador exacto: 5 puntos. Si no, 1 punto por el signo (1, X o 2) y 1 punto por cada equipo al que le aciertes los goles."));
  return out;
}

function porDias(partidos, fila){
  const box = h("div", { class: "boleto" });
  let dia = null;
  for (const p of partidos){
    const d = fmtDia(p.inicio);
    if (d !== dia){ dia = d; box.append(h("div", { class: "day", text: d })); }
    box.append(fila(p));
  }
  return box;
}
function celdaHora(p){
  if (APLAZADO.has(p.estado)) return h("div", { class: "time" }, "Apl.");
  if (EN_JUEGO.has(p.estado)) return h("div", { class: "time" }, h("span", {}, "EN", h("small", { text: "JUEGO" })));
  return h("div", { class: "time", text: fmtHora(p.inicio) });
}

function borrador(j){
  if (S.draft[j.id]) return S.draft[j.id];
  const d = {};
  for (const p of partidosDe(j)){
    const m = S.mios[p.id];
    d[p.id] = m ? [String(m.goles_l), String(m.goles_v)] : ["", ""];
  }
  return S.draft[j.id] = d;
}
function pintarSignos(row, l, v){
  const a = toInt(l), b = toInt(v);
  const s = a != null && b != null ? sign(a, b) : null;
  row.querySelectorAll(".sign").forEach(el => el.classList.toggle("on", el.dataset.s === s));
}
function boletoAbierto(j){
  const d = borrador(j);
  const ps = partidosDe(j);
  const box = porDias(ps, p => {
    const signs = h("div", { class: "signs", "aria-hidden": "true" }, ["1", "X", "2"].map(s => h("span", { class: "sign", "data-s": s, text: s })));
    const inp = k => h("input", { type: "number", inputmode: "numeric", min: "0", max: "30", value: d[p.id][k],
      "aria-label": "Goles " + (k === 0 ? p.local : p.visitante),
      oninput: e => { d[p.id][k] = e.target.value; pintarSignos(row, d[p.id][0], d[p.id][1]); } });
    const row = h("div", { class: "row" }, celdaHora(p),
      h("div", { class: "teams" }, h("div", { class: "team", text: p.local }), h("div", { class: "team", text: p.visitante })),
      h("div", { class: "scores" }, inp(0), inp(1)), signs);
    pintarSignos(row, d[p.id][0], d[p.id][1]);
    return row;
  });
  const hechos = ps.filter(p => S.mios[p.id]).length;
  return h("div", {}, box,
    h("div", { class: "bar" },
      h("span", { class: "note", text: hechos ? `Tienes guardados ${hechos} de ${ps.length} partidos. Puedes cambiarlos hasta el cierre.` : `Rellena los ${ps.length} partidos.` }),
      h("button", { class: "btn", onclick: () => guardar(j) }, hechos ? "Actualizar quiniela" : "Guardar quiniela")),
    msgEl("save_" + j.id));
}
async function guardar(j){
  const key = "save_" + j.id;
  if (cerrada(j)) return flash(key, "err", "La jornada ya está cerrada.");
  const d = S.draft[j.id] || {};
  const filas = [];
  for (const p of partidosDe(j)){
    const [x, y] = d[p.id] || ["", ""];
    const a = toInt(x), b = toInt(y);
    if (x === "" && y === "") continue;
    if (a == null || b == null) return flash(key, "err", `Revisa el marcador del ${p.local} - ${p.visitante}.`);
    filas.push({ user_id: S.user.id, partido_id: p.id, goles_l: a, goles_v: b });
  }
  if (!filas.length) return flash(key, "err", "Pon al menos un resultado.");
  const { error } = await sb.from("pronosticos").upsert(filas, { onConflict: "user_id,partido_id" });
  if (error) return flash(key, "err", /row-level|42501/i.test(error.message + error.code) ? "La jornada ya está cerrada." : "No se ha podido guardar. Prueba otra vez.");
  for (const f of filas) S.mios[f.partido_id] = f;
  const total = partidosDe(j).length;
  for (const k in S.entregados) if (k.startsWith(j.id + "|")) delete S.entregados[k];
  flash(key, "ok", filas.length === total ? "Quiniela guardada." : `Guardados ${filas.length} de ${total}. Te faltan ${total - filas.length}.`);
}

function boletoCerrado(j){
  const box = porDias(partidosDe(j), p => {
    const pick = pickDe(S.user.id, p.id);
    const res = resultado(p);
    const s = pts(pick, res);
    const live = EN_JUEGO.has(p.estado);
    return h("div", { class: "row closed" }, celdaHora(p),
      h("div", { class: "teams" }, h("div", { class: "team", text: p.local }), h("div", { class: "team", text: p.visitante })),
      h("div", { class: "scores" }, h("div", { class: "v", text: pick ? pick[0] : "–" }), h("div", { class: "v", text: pick ? pick[1] : "–" })),
      h("div", { class: "scores" }, h("div", { class: "v real" + (live ? " live" : ""), text: res ? res[0] : "·" }),
        h("div", { class: "v real" + (live ? " live" : ""), text: res ? res[1] : "·" })),
      h("div", { class: "ptscol" }, h("span", { class: "pts " + ptsClass(s), text: s == null ? "–" : "+" + s })));
  });
  const l = linea(S.user.id, j);
  return h("div", {},
    h("div", { class: "colhead" }, h("span"), h("span", { text: "Partido" }), h("span", { text: "Tú" }), h("span", { text: "Real" }), h("span", { text: "Pts" })),
    box,
    h("div", { class: "bar" }, h("span", { class: "note", text: !l.jugado ? "No jugaste esta jornada." :
      l.hay ? `Llevas ${l.t} puntos en esta jornada` + (enJuego(j) ? ", con partidos en juego." : ".") : "Esperando resultados." })));
}

function entregadosCard(j, liga){
  const key = j.id + "|" + liga.id;
  const e = S.entregados[key];
  if (!e) cargarEntregados(j, liga);
  const ids = e ? e.ids : [];
  const nombres = ids.map(nombre);
  const total = miembrosDe(liga).length;
  return h("div", { class: "card" },
    h("h3", { text: !e || e.cargando ? "Quinielas entregadas" : `${ids.length} de ${total} han entregado` }),
    h("p", { class: "note", style: "margin:0", text: "Los pronósticos de cada uno se destapan cuando la jornada se cierra." }),
    nombres.length ? h("div", { class: "who" }, nombres.map(n => h("span", { text: n }))) : null);
}

function fotoCard(j, liga){
  const ps = partidosDe(j);
  const filas = miembrosDe(liga).map(uid => ({ uid, nm: nombre(uid), l: linea(uid, j) }))
    .filter(x => x.l.jugado)
    .sort((a, b) => b.l.t - a.l.t || b.l.ex - a.l.ex || a.nm.localeCompare(b.nm));
  const card = h("div", { class: "card foto" }, h("h3", {}, "La foto", h("span", { class: "note", text: liga.nombre })));
  if (!filas.length){ card.append(h("p", { class: "note", style: "margin:0", text: "Nadie de la liga jugó esta jornada." })); return card; }
  const tbl = h("table", { class: "grid" },
    h("thead", {}, h("tr", {}, h("th", { class: "name", text: "Jugador" }), ps.map((_, i) => h("th", { text: String(i + 1) })), h("th", { text: "Pts" }))),
    h("tbody", {},
      h("tr", { class: "realrow" }, h("td", { class: "name", text: "Real" }), ps.map(p => { const r = resultado(p); return h("td", { text: r ? `${r[0]}-${r[1]}` : "·" }); }), h("td")),
      filas.map(x => h("tr", {}, h("td", { class: "name", text: x.nm }),
        ps.map(p => { const pick = pickDe(x.uid, p.id); const s = pts(pick, resultado(p)); return h("td", { class: ptsClass(s), text: pick ? `${pick[0]}-${pick[1]}` : "–" }); }),
        h("td", { class: "tot", text: x.l.hay ? String(x.l.t) : "·" })))));
  card.append(h("div", { class: "scroll" }, tbl));
  return card;
}

/* ----- clasificación ----- */
function clasificacion(){
  const liga = ligaActual();
  if (!liga) return h("section", {}, avisoSinLiga());
  const tot = {};
  for (const uid of miembrosDe(liga)) tot[uid] = { uid, t: 0, ex: 0, sg: 0, jug: 0, wins: 0, ult: null };
  const cerradas = S.jornadas.filter(cerrada);
  for (const j of cerradas){
    let best = -1; const ls = {};
    for (const uid in tot){
      const l = linea(uid, j); ls[uid] = l;
      if (!l.jugado) continue;
      const r = tot[uid]; r.jug++; r.t += l.t; r.ex += l.ex; r.sg += l.sg;
      if (l.hay) best = Math.max(best, l.t);
    }
    if (terminada(j) && best >= 0) for (const uid in tot) if (ls[uid].jugado && ls[uid].t === best) tot[uid].wins++;
  }
  const ultima = cerradas[cerradas.length - 1];
  if (ultima) for (const uid in tot){ const l = linea(uid, ultima); if (l.jugado) tot[uid].ult = l.t; }
  const lista = Object.values(tot).sort((a, b) => b.t - a.t || b.ex - a.ex || b.wins - a.wins || nombre(a.uid).localeCompare(nombre(b.uid)));
  let prev = null, pos = 0;
  return h("section", {}, selectorLiga(),
    h("div", { class: "rank" }, lista.map((r, i) => {
      if (!prev || r.t !== prev.t || r.ex !== prev.ex) pos = i + 1; prev = r;
      const sub = [`${r.ex} ${r.ex === 1 ? "exacto" : "exactos"}`, `${r.sg} ${r.sg === 1 ? "signo" : "signos"}`, `${r.jug} ${r.jug === 1 ? "jornada" : "jornadas"}`];
      if (r.wins) sub.push(`${r.wins} ${r.wins === 1 ? "victoria" : "victorias"}`);
      if (r.ult != null) sub.push(`J${ultima.num}: +${r.ult}`);
      return h("div", { class: "rk" + (pos === 1 && r.t > 0 ? " lead" : "") + (r.uid === S.user.id ? " mine" : "") },
        h("div", { class: "pos", text: String(pos) }),
        h("div", { style: "min-width:0" }, h("div", { class: "nm", text: nombre(r.uid) }), h("div", { class: "sub", text: sub.join(" · ") })),
        h("div", { class: "big" }, String(r.t), h("small", { text: "puntos" })));
    })),
    h("p", { class: "note" }, "Desempate: más resultados exactos. Ganar una jornada cuenta cuando han acabado todos sus partidos."));
}

/* ----- ligas ----- */
function enlaceInvitacion(l){ return location.origin + location.pathname + "?unirse=" + l.codigo; }
async function copiar(texto, key){
  try { await navigator.clipboard.writeText(texto); flash(key, "ok", "Enlace copiado."); }
  catch(e){ flash(key, "err", "No se ha podido copiar. Comparte el código: " + texto.split("=").pop()); }
}
function vistaLigas(){
  const out = h("section", {});
  for (const l of S.ligas){
    const n = miembrosDe(l).length;
    const key = "liga_" + l.id;
    const texto = `Únete a mi quiniela "${l.nombre}": ${enlaceInvitacion(l)}`;
    out.append(h("div", { class: "card liga-card" },
      h("h3", { text: l.nombre }),
      h("div", { class: "note", text: `${n} ${n === 1 ? "jugador" : "jugadores"} · código` }),
      h("div", { class: "code", text: l.codigo }),
      h("div", { class: "who" }, miembrosDe(l).map(uid => h("span", { text: nombre(uid) }))),
      h("div", { class: "acts" },
        h("a", { class: "btn small", href: "https://wa.me/?text=" + encodeURIComponent(texto), target: "_blank", rel: "noopener", style: "text-decoration:none" }, "Invitar por WhatsApp"),
        h("button", { class: "btn ghost small", onclick: () => copiar(enlaceInvitacion(l), key) }, "Copiar enlace"),
        h("button", { class: "btn ghost small", onclick: () => salirLiga(l) }, S.msg["salir_" + l.id] ? "¿Seguro?" : "Salir")),
      msgEl(key)));
  }
  let nombreNueva = "", codigo = "";
  out.append(h("form", { class: "card", onsubmit: e => { e.preventDefault(); crearLiga(nombreNueva); } },
    h("h3", { text: "Crear una liga" }),
    h("div", { class: "field" },
      h("input", { type: "text", maxlength: "40", placeholder: "Nombre de la liga", "aria-label": "Nombre de la liga", oninput: e => { nombreNueva = e.target.value; } }),
      h("button", { class: "btn small", type: "submit" }, "Crear")),
    msgEl("crear")));
  out.append(h("form", { class: "card", onsubmit: e => { e.preventDefault(); unirse(codigo); } },
    h("h3", { text: "Unirme con un código" }),
    h("div", { class: "field" },
      h("input", { type: "text", maxlength: "6", placeholder: "ABC123", style: "text-transform:uppercase", "aria-label": "Código de liga", oninput: e => { codigo = e.target.value; } }),
      h("button", { class: "btn small", type: "submit" }, "Unirme")),
    msgEl("unirse")));
  out.append(h("p", { class: "note" }, "Tu quiniela es la misma en todas tus ligas: la rellenas una vez y cuenta en todas."));
  out.append(cuentaCard());
  return out;
}
async function crearLiga(n){
  n = (n || "").trim();
  if (!n) return flash("crear", "err", "Ponle un nombre a la liga.");
  const { data, error } = await sb.rpc("crear_liga", { p_nombre: n });
  if (error) return flash("crear", "err", "No se ha podido crear la liga.");
  S.liga = data.id; store.set("liga", S.liga);
  await recargar();
  flash("liga_" + data.id, "ok", "Liga creada. Invita a tus amigos.");
}
async function unirse(codigo, silencioso){
  codigo = (codigo || "").trim().toUpperCase();
  if (!codigo) return flash("unirse", "err", "Escribe el código de la liga.");
  const { data, error } = await sb.rpc("unirse_liga", { p_codigo: codigo });
  if (error){ if (!silencioso) flash("unirse", "err", "No existe ninguna liga con ese código."); return false; }
  S.liga = data.id; store.set("liga", S.liga);
  await recargar();
  flash("liga_" + data.id, "ok", `Ya estás en "${data.nombre}".`);
  return true;
}
async function salirLiga(l){
  const k = "salir_" + l.id;
  if (!S.msg[k]){ S.msg[k] = { k: "err", t: "" }; render(); setTimeout(() => { S.msg[k] = null; render(); }, 4000); return; }
  S.msg[k] = null;
  const { error } = await sb.from("miembros").delete().eq("liga_id", l.id).eq("user_id", S.user.id);
  if (error) return flash("liga_" + l.id, "err", "No se ha podido salir.");
  await recargar();
}

/* ---------- arranque ---------- */
async function recargar(suave){
  try { await cargar(); S.error = null; }
  catch(e){ console.error(e); if (!suave) S.error = "No se han podido cargar los datos. Revisa la conexión."; }
  render(suave);
}
async function arrancar(){
  S.loading = true; render();
  await recargar();
  // Jugador recién creado: su perfil se crea solo con el apodo que eligió
  if (!S.error && !S.perfil && S.user.user_metadata && S.user.user_metadata.alias){
    await sb.from("perfiles").upsert({ id: S.user.id, alias: S.user.user_metadata.alias });
    await recargar();
  }
  S.loading = false;
  const pendiente = store.get("unirse");
  if (pendiente && S.perfil && !S.error){
    store.set("unirse", null);
    const ya = S.ligas.find(l => l.codigo === pendiente);
    if (ya){ S.liga = ya.id; } else if (await unirse(pendiente, true)) { S.tab = "ligas"; }
  }
  render();
}
async function salir(){
  await sb.auth.signOut();
  S.user = null; S.perfil = null; S.login = { modo: "entrar" };
  render();
}

async function boot(){
  if (!sb){ S.loading = false; render(); return; }
  const qs = new URLSearchParams(location.search);
  const cod = qs.get("unirse");
  if (cod) store.set("unirse", cod.trim().toUpperCase());
  const { data } = await sb.auth.getSession();
  if (cod || location.hash.includes("access_token")) history.replaceState(null, "", location.pathname);
  S.user = data.session ? data.session.user : null;
  sb.auth.onAuthStateChange((_ev, session) => {
    const u = session ? session.user : null;
    if ((u && u.id) === (S.user && S.user.id)) return;
    S.user = u;
    if (u) arrancar(); else { S.perfil = null; render(); }
  });
  if (S.user) await arrancar();
  else { S.loading = false; render(); }
}

/* Relojes y refresco: cuenta atrás cada 20 s; datos cada 2 min (cada 45 s si hay partidos en juego) */
let ultimaCarga = ahora(), abiertasAntes = null;
setInterval(() => {
  document.querySelectorAll("[data-falta]").forEach(el => { el.textContent = falta(el.dataset.falta); });
  if (!S.user || !S.perfil || document.hidden) return;
  const abiertas = S.jornadas.filter(j => !cerrada(j)).map(j => j.id).join(",");
  const vivo = S.partidos.some(p => EN_JUEGO.has(p.estado));
  if (abiertasAntes !== null && abiertas !== abiertasAntes){ ultimaCarga = ahora(); recargar(true); }
  else if (ahora() - ultimaCarga > (vivo ? 45e3 : 120e3)){ ultimaCarga = ahora(); recargar(true); }
  abiertasAntes = abiertas;
}, 20000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.user && S.perfil && ahora() - ultimaCarga > 30e3){ ultimaCarga = ahora(); recargar(true); }
});

boot();
