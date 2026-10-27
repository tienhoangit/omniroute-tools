// OmniRoute CLI Tools — front-end. Plain DOM, hash routing (#/ and #/tool/<id>).
// Every dynamic value goes through textContent/createElement, never innerHTML,
// so strings from config files or the router cannot inject markup.
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};

// Static, trusted SVG only (no user data ever reaches this).
const ICONS = {
  chev: '<path d="m9 6 6 6-6 6"/>', back: '<path d="M19 12H5m6-6-6 6 6 6"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>', reset: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><path d="M12 8v4l3 2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>', plus: '<path d="M12 5v14M5 12h14"/>', layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m8 10 3 2-3 2M13 15h3"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name, size = 18) => {
  const t = document.createElement("template");
  t.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstChild;
};

async function call(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function toast(msg, kind = "", detail = "") {
  const t = el("div", { className: `toast ${kind}` }, msg, detail ? el("span", { className: "mono" }, detail) : null);
  $("#toasts").append(t); setTimeout(() => t.remove(), kind === "err" ? 8000 : 4500);
}
async function busy(btn, fn) {
  btn.disabled = true; btn.classList.add("busy");
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove("busy"); }
}
async function copy(text, what = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(what, "ok"); } catch { toast("Clipboard blocked by the browser", "err"); }
}

// ── settings: URL persists, API key lives only for this tab ──
const DEFAULT_URL = "http://127.0.0.1:20128";
const norm = (u) => String(u || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
const S = {
  get url() { return norm(localStorage.getItem("ort.url") || DEFAULT_URL); },
  set url(v) { localStorage.setItem("ort.url", norm(v)); },
  get key() { return sessionStorage.getItem("ort.key") || ""; },
  set key(v) { sessionStorage.setItem("ort.key", v.trim()); },
};

// ── model catalog + picker ──
let modelCache = { url: null, items: null };
async function loadModels(force = false) {
  if (!force && modelCache.url === S.url && modelCache.items) return modelCache.items;
  const { items } = await call("/api/models", { baseUrl: S.url, apiKey: S.key });
  modelCache = { url: S.url, items }; return items;
}

function matcher(query) {
  const rules = String(query).toLowerCase().split(/\s+/).filter(Boolean).map((tok) => {
    const neg = tok[0] === "-" || tok[0] === "!"; const body = neg ? tok.slice(1) : tok;
    if (!body) return null;
    let test;
    if (body.length > 2 && body.startsWith("/") && body.endsWith("/")) {
      try { const re = new RegExp(body.slice(1, -1), "i"); test = (s) => re.test(s); } catch { return null; }
    } else test = (s) => s.includes(body);
    return { neg, test };
  }).filter(Boolean);
  return (id) => { const s = id.toLowerCase(); return rules.every((r) => (r.neg ? !r.test(s) : r.test(s))); };
}

function openModal(title, bodyNode) {
  const root = $("#modalRoot");
  const close = () => { root.replaceChildren(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  const x = el("button", { type: "button", ariaLabel: "Close" }); x.onclick = close;
  const modal = el("div", { className: "modal", role: "dialog", ariaModal: "true", ariaLabel: title },
    el("div", { className: "modal-head" }, el("div", { className: "lights" }, x, el("i"), el("i")), el("h2", {}, title)),
    el("div", { className: "modal-body" }, bodyNode));
  const ov = el("div", { className: "overlay" }, modal);
  ov.addEventListener("mousedown", (e) => e.target === ov && close());
  root.replaceChildren(ov); return close;
}

function pickModel(forTool, current, onPick) {
  const status = el("div", { className: "empty" }, "Loading models…");
  const results = el("div");
  const input = el("input", { className: "input", placeholder: "Search models (e.g. claude -haiku, !embed, /regex/)…", spellcheck: false });
  let items = [];
  const render = () => {
    const ok = matcher(input.value);
    const filtered = items.filter((i) => ok(i.id) || (i.name && ok(i.name)));
    if (!filtered.length) return results.replaceChildren(el("div", { className: "empty" }, items.length ? "No models match your search." : ""));
    const groups = new Map();
    for (const i of filtered) (groups.get(i.group) || groups.set(i.group, []).get(i.group)).push(i);
    results.replaceChildren(...[...groups].sort((a, b) => (/combo/i.test(b[0]) - /combo/i.test(a[0])) || a[0].localeCompare(b[0])).map(([g, list]) =>
      el("div", { className: "group" },
        el("h4", {}, /combo/i.test(g) ? icon("layers", 15) : null, g, el("em", {}, `(${list.length})`)),
        el("div", { className: "chips" }, list.map((m) => {
          const title = m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id;
          const c = el("button", { type: "button", className: `chip${m.id === current ? " sel" : ""}`, title }, m.id);
          c.onclick = () => { onPick(m.id); close(); }; return c;
        })))));
  };
  const body = el("div", {},
    el("div", { className: "tip" }, icon("info", 16), el("span", {}, "Click a model to select it. Search supports exclusions (claude -haiku) and RegExp (/pattern/).")),
    el("div", { className: "search" }, icon("search", 16), input), status, results);
  const close = openModal(`Select Model for ${forTool}`, body);
  input.addEventListener("input", render); input.focus();
  loadModels().then((it) => { items = it; status.remove(); if (!it.length) results.replaceChildren(el("div", { className: "empty" }, "The router returned no models.")); else render(); })
    .catch((e) => { status.className = "note err"; status.textContent = `${e.message}. You can also type a model id directly in the field.`; });
}

// ── components ──
const LABEL = { connected: "Connected", ready: "Not connected", missing: "Not installed", guide: "Guide", routed: "Routed" };
const badge = (status) => el("span", { className: `badge b-${status}` }, LABEL[status] || status);
const avatar = (t, lg) => { const a = el("div", { className: `avatar${lg ? " lg" : ""}` }, t.letter || t.title[0]); a.style.background = t.color || "#444"; a.style.color = t.fg || "#fff"; return a; };

function row(label, ...ctl) {
  return el("div", { className: "rrow" }, el("div", { className: "rlabel" }, label, el("span", { className: "arrow" }, icon("arrow", 16))), el("div", { className: "rctl" }, ...ctl));
}
function modelField(forTool, init, placeholder = "provider/model-id", onSelect = null) {
  const input = el("input", { className: "input mono", value: init || "", placeholder, spellcheck: false });
  const x = el("button", { type: "button", className: "x", ariaLabel: "Clear" }, "×");
  x.onclick = () => { input.value = ""; input.focus(); if (onSelect) onSelect(""); };
  const pick = el("button", { type: "button", className: "btn sm" }, "Select Model");
  pick.onclick = () => pickModel(forTool, input.value, (id) => {
    input.value = id;
    if (onSelect) onSelect(id);
  });
  return { input, node: el("div", { className: "inline" }, el("div", { className: "clearable" }, input, x), pick) };
}

// ── pages ──
let STATE = [];
let DISCOVERED_KEY = "";
async function refreshState() {
  const res = await call("/api/state");
  STATE = res.tools;
  DISCOVERED_KEY = res.discoveredApiKey || "";
  if ((!S.key || S.key.startsWith("sk-f385f19b")) && DISCOVERED_KEY) {
    S.key = DISCOVERED_KEY;
  }
  return STATE;
}

async function listPage() {
  const view = $("#view"); view.replaceChildren(el("div", { className: "empty" }, "Loading tools…"));
  const tools = await refreshState();
  view.replaceChildren(el("div", { className: "list" }, tools.map((t, i) => {
    const status = t.kind === "guide" ? "guide" : t.status === "missing" ? "missing" : t.status;
    const a = el("a", { className: "tile", href: `#/tool/${t.id}`, id: `tile-${t.id}` },
      avatar(t), el("div", { className: "tile-body" }, el("div", { className: "tile-title" }, t.title), badge(status)),
      el("span", { className: "chev" }, icon("chev")));
    a.style.animationDelay = `${i * 25}ms`; return a;
  })));
}

async function detailPage(id) {
  const view = $("#view");
  if (!STATE.length) await refreshState();
  const t = STATE.find((x) => x.id === id);
  if (!t) return view.replaceChildren(el("div", { className: "note err" }, `Unknown tool "${id}".`), el("a", { className: "back", href: "#/" }, "Back to CLI Tools"));
  const cur = t.models || {};
  const status = t.kind === "guide" ? "guide" : t.status;

  const head = el("div", { className: "panel-head" }, avatar(t, true),
    el("div", { className: "t" }, el("b", {}, t.title, badge(status)), el("span", {}, t.sub)));

  // endpoint
  const custom = el("input", { className: "input mono", value: S.url + "/v1", spellcheck: false, ariaLabel: "Endpoint URL" });
  custom.addEventListener("input", () => { S.url = custom.value; modelCache = { url: null, items: null }; });
  if ((!S.key || S.key.startsWith("sk-f385f19b")) && DISCOVERED_KEY) S.key = DISCOVERED_KEY;
  const initialKey = S.key || DISCOVERED_KEY || "";
  const apiKey = el("input", { className: "input mono", type: "password", placeholder: "OmniRoute API key (sk-99d637...)", value: initialKey, autocomplete: "off", spellcheck: false, ariaLabel: "API key" });
  apiKey.addEventListener("input", () => { S.key = apiKey.value; modelCache = { url: null, items: null }; });
  const eye = el("button", { type: "button", className: "btn sm", ariaLabel: "Show or hide key" }, icon("eye", 16)); eye.onclick = () => (apiKey.type = apiKey.type === "password" ? "text" : "password");

  const currentDisplay = t.activeProvider
    ? `${t.activeProviderName || t.activeProvider} (${t.baseUrl || "—"})`
    : (t.baseUrl || "—");

  const rows = el("div", { className: "rows" },
    row("Provider", el("div", { className: "cur" }, el("b", { className: "badge " + (t.active ? "b-connected" : "b-ready") }, t.active ? "OmniRoute (Active)" : `${t.activeProvider || "OpenAI default"} (Active)`))),
    row("Endpoint", custom),
    row("Current", el("div", { className: "cur mono" }, currentDisplay)),
    row("API Key", el("div", { className: "inline" }, apiKey, eye)));

  const fields = {}; // name -> input

  const getCtx = () => ({
    tool: t.id, baseUrl: S.url, apiKey: S.key.trim(),
    model: fields.model?.value.trim() || "",
    subagent: fields.subagent?.value.trim() || "",
    claudeModels: t.id === "claude" ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value.trim()]).filter(([, v]) => v)) : {},
  });

  const autoSave = async (patch = {}) => {
    if (t.kind !== "auto") return;
    try {
      const ctx = getCtx();
      if (patch.model !== undefined) ctx.model = patch.model;
      if (patch.subagent !== undefined) ctx.subagent = patch.subagent;
      if (patch.claudeKey && patch.claudeVal !== undefined) {
        ctx.claudeModels[patch.claudeKey] = patch.claudeVal;
      }
      const r = await call("/api/apply", ctx);
      const applied = patch.model || patch.subagent || patch.claudeVal || "Settings";
      toast(`${t.title}: Saved & applied`, "ok", applied);
      await refreshState();
      await detailPage(id);
    } catch (e) {
      toast(e.message, "err");
    }
  };

  if (t.id === "claude") {
    const claudeDefaults = { fable: "auto/claude-opus", opus: "auto/claude-opus", sonnet: "auto/claude-sonnet", haiku: "auto/best-fast" };
    const names = { fable: "Claude Fable", opus: "Claude Opus", sonnet: "Claude Sonnet", haiku: "Claude Haiku" };
    for (const tier of t.claudeTiers || []) {
      const initVal = cur[tier.flag] || claudeDefaults[tier.flag] || "auto/best-coding";
      const f = modelField(names[tier.flag] || tier.flag, initVal, "auto/best-coding", (selectedId) => {
        autoSave({ claudeKey: tier.envKey, claudeVal: selectedId });
      });
      fields[tier.envKey] = f.input;
      rows.append(row(names[tier.flag] || tier.flag, f.node));
    }
  } else if (t.kind === "auto" && t.needsModel) {
    const defaultModel = cur.main || cur.act || "auto/best-coding";
    const f = modelField(t.title, defaultModel, "provider/model-id", (selectedId) => {
      autoSave({ model: selectedId });
    });
    fields.model = f.input;
    rows.append(row("Model", f.node));
    if (t.id === "codex") {
      const defaultSub = cur.subagent || cur.main || "auto/best-coding-fast";
      const s = modelField(t.title, defaultSub, "provider/model-id", (selectedId) => {
        autoSave({ subagent: selectedId });
      });
      fields.subagent = s.input;
      rows.append(row("Subagent Model", s.node));
    }
  } else if (t.kind === "guide") {
    const f = modelField(t.title, cur.main || "auto/best-coding");
    fields.model = f.input;
    rows.append(row("Model", f.node));
  } else rows.append(row("Models", el("div", { className: "cur" }, "Discovered automatically from the router — nothing to choose.")));

  const manual = el("button", { type: "button", className: "link-btn", id: "manualBtn" }, icon("copy", 17), "Manual Config");
  manual.onclick = async () => {
    try {
      const p = await call("/api/preview", getCtx());
      const copyBtn = el("button", { type: "button", className: "link-btn" }, icon("copy", 17), "Copy"); copyBtn.onclick = () => copy(p.text, "Config copied");
      openModal(`${t.title} - Manual Configuration`, el("div", {}, el("div", { className: "pathline" }, el("span", { className: "mono" }, p.path), copyBtn), el("pre", { className: "codebox mono" }, p.text)));
    } catch (e) { toast(e.message, "err"); }
  };

  const actions = el("div", { className: "actions" });
  if (t.kind === "auto") {
    const apply = el("button", { type: "button", className: "btn primary", id: "applyBtn" }, icon("save", 17), "Apply");
    apply.onclick = () => busy(apply, async () => {
      try {
        const r = await call("/api/apply", getCtx());
        toast(`${t.title} now points at OmniRoute`, "ok", r.written.join("\n")); await refreshState(); await detailPage(id);
      } catch (e) { toast(e.message, "err"); }
    });
    const reset = el("button", { type: "button", className: "btn", id: "resetBtn", disabled: !t.configured }, icon("reset", 17), "Reset");
    reset.onclick = () => busy(reset, async () => {
      try { const r = await call("/api/reset", { tool: t.id }); toast(`${t.title}: OmniRoute entries removed`, "ok", r.touched.join("\n")); await refreshState(); await detailPage(id); }
      catch (e) { toast(e.message, "err"); }
    });
    actions.append(apply, reset, manual);
  } else actions.append(manual);

  const panel = el("section", { className: "panel" }, head, rows, actions);
  if (t.kind === "guide") panel.append(el("div", { className: "note" }, "One-click setup for this tool isn't available yet. Press Manual Config for the values to paste into it."));
  if (t.ambiguousOwner && t.configured) panel.append(el("div", { className: "note" }, "Claude Code's settings have no provider id, so OmniRoute and 9Router can't be told apart. Apply to be sure it points here."));
  if (t.error) panel.append(el("div", { className: "note err" }, t.error));
  if (t.activeProvider && !t.active) panel.append(el("div", { className: "note" }, `Currently routed through "${t.activeProvider}". Apply switches it to OmniRoute (your other provider settings are kept).`));
  if (t.id === "codex") panel.append(await profilesSection(fields));

  view.replaceChildren(
    el("a", { className: "back", href: "#/" }, icon("back", 18), "Back to CLI Tools"),
    el("h1", { className: "page-title" }, t.title), el("p", { className: "page-sub" }, t.sub), panel);
}

async function profilesSection() {
  const wrap = el("div", { className: "extra" });
  const list = el("div", { className: "profiles" });
  const alias = el("input", { className: "input", placeholder: "Alias (e.g. claude)", spellcheck: false, ariaLabel: "Profile alias" });
  const mf = modelField("Codex profile", "", "provider/model-id");
  const add = el("button", { type: "button", className: "btn sm", id: "addProfile" }, icon("plus", 15), "Add");
  const drawList = (profiles) => {
    wrap.querySelector(".count").textContent = profiles.length;
    list.replaceChildren(...profiles.map((p) => {
      const cmd = el("button", { type: "button", className: "cmd mono", title: "Copy command" }, icon("term", 15), `codex -p ${p.alias}`); cmd.onclick = () => copy(`codex -p ${p.alias}`, "Command copied");
      const del = el("button", { type: "button", className: "x", ariaLabel: `Remove ${p.alias}` }, "×");
      del.onclick = async () => { try { const r = await call("/api/profiles/remove", { alias: p.alias }); drawList(r.profiles); toast(`Removed ${p.alias}`, "ok", r.file); } catch (e) { toast(e.message, "err"); } };
      return el("div", { className: "profile" }, el("div", { className: "nm" }, el("b", {}, p.alias), el("span", { className: "mono" }, p.model)), cmd, del);
    }));
  };
  add.onclick = () => busy(add, async () => {
    try {
      const r = await call("/api/profiles/add", { alias: alias.value.trim(), model: mf.input.value.trim() });
      drawList(r.profiles); alias.value = ""; mf.input.value = ""; toast(`Profile added — run: codex -p ${r.file.split(/[\\/]/).pop().replace(".config.toml", "")}`, "ok", r.file);
    } catch (e) { toast(e.message, "err"); }
  });
  wrap.append(el("h3", {}, icon("layers", 17), "Additional Models", el("span", { className: "count" }, "0")),
    el("div", { className: "add-row" }, alias, mf.node, add), el("p", { className: "hint", style: "margin:8px 2px 0" }, "Each profile becomes ~/.codex/<alias>.config.toml and is launched with codex -p <alias>."), list);
  try { drawList((await call("/api/profiles")).profiles); } catch (e) { list.replaceChildren(el("div", { className: "note err" }, e.message)); }
  return wrap;
}

// ── router status pill ──
async function updatePill() {
  const pill = $("#routerPill"); const port = Number(new URL(S.url).port || 80);
  try {
    const { found } = await call("/api/detect", {});
    const on = found.some((f) => f.port === port);
    pill.replaceChildren(el("span", { className: `dot ${on ? "on" : "off"}` }), on ? `Router reachable · ${S.url}` : `No router at ${S.url}`);
  } catch { pill.replaceChildren(el("span", { className: "dot" }), S.url); }
}

async function route() {
  const m = location.hash.match(/^#\/tool\/([\w-]+)/);
  try { m ? await detailPage(m[1]) : await listPage(); } catch (e) { $("#view").replaceChildren(el("div", { className: "note err" }, e.message)); }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
route(); updatePill();
