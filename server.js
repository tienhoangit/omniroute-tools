/**
 * OmniRoute Tools — local web UI that writes CLI-tool configs pointing at OmniRoute.
 *
 * Security model: this process writes files into the user's home directory and
 * handles API keys, so it binds to loopback only and rejects requests whose
 * Host/Origin is not loopback (blocks DNS-rebinding and cross-site POSTs).
 * API keys are never returned to the browser in full.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { TOOLS } = require("./lib/tools");
const { CATALOG, isInstalled, preview, listProfiles, addProfile, removeProfile } = require("./lib/catalog");
const { getDiscoveredApiKey, getFallbackModels } = require("./lib/discovery");

const PORT = Number(process.env.PORT || 20130); // deliberately not 20128 (router port)
const HOST = "127.0.0.1";
const PUBLIC = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

const mask = (k) => (typeof k === "string" && k ? `${k.slice(0, 6)}…${k.slice(-3)}` : undefined);
const isLoopbackHost = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(h || "");
const normBase = (u) => String(u || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");

function send(res, code, body) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json", "Cache-Control": "no-store" });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) { reject(new Error("Body too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

let _getCliToken = null;
let _CLI_TOKEN_HEADER = "x-omniroute-cli-token";

async function loadCliTokenHelper() {
  if (_getCliToken) return _getCliToken;
  try {
    const mod = await import("file:///C:/Users/Hoang Minh Tien/AppData/Roaming/npm/node_modules/omniroute/bin/cli/utils/cliToken.mjs");
    _getCliToken = mod.getCliToken;
    _CLI_TOKEN_HEADER = mod.CLI_TOKEN_HEADER || _CLI_TOKEN_HEADER;
  } catch (e) {}
  return _getCliToken;
}

const ALIAS_MAP = {
  github: "gh", gh: "github",
  deepseek: "ds", ds: "deepseek",
  "kimi-coding": "kmc", kmc: "kimi-coding", kimi: "kmc",
  nvidia: "nvidia",
  groq: "groq",
  agnes: "agnes",
  trae: "tr", tr: "trae",
  huggingface: "hf", hf: "huggingface",
  claude: "cc", cc: "claude",
  codex: "cx", cx: "codex",
  opencode: "oc", oc: "opencode",
};

async function fetchModels(baseUrl, apiKey) {
  const norm = normBase(baseUrl);
  const key = apiKey || getDiscoveredApiKey();

  let token = "";
  try {
    const fn = await loadCliTokenHelper();
    if (fn) token = await fn();
  } catch {}

  const headers = {};
  if (token) headers[_CLI_TOKEN_HEADER] = token;
  if (key) headers["Authorization"] = `Bearer ${key}`;

  // 1. Fetch REAL live models & connections from OmniRoute internal endpoints
  try {
    const [mRes, pRes, cRes] = await Promise.all([
      fetch(`${norm}/api/models`, { headers, signal: AbortSignal.timeout(5000) }).catch(() => null),
      fetch(`${norm}/api/providers`, { headers, signal: AbortSignal.timeout(5000) }).catch(() => null),
      fetch(`${norm}/api/combos`, { headers, signal: AbortSignal.timeout(5000) }).catch(() => null),
    ]);

    if (mRes && mRes.ok) {
      const rawModels = (await mRes.json())?.models || [];
      const rawConnections = pRes?.ok ? (await pRes.json())?.connections || [] : [];
      const rawCombos = cRes?.ok ? (await cRes.json())?.combos || [] : [];

      // Map provider health & testStatus
      const providerStatus = new Map();
      for (const conn of rawConnections) {
        const p = conn.provider;
        const prefix = conn.providerSpecificData?.prefix || ALIAS_MAP[p] || p;
        const isInactive = conn.isActive === false;
        const isExpired = conn.testStatus === "expired" || conn.testStatus === "unavailable" || conn.testStatus === "error";
        const errText = String(conn.lastError || "");
        const isQuotaDead = /402|403|quota|balance|insufficient|rejected|expired|unauthorized/i.test(errText);
        const failed = isInactive || isExpired || isQuotaDead;
        const info = { provider: p, name: conn.name || p, failed, errText };
        providerStatus.set(p, info);
        providerStatus.set(prefix, info);
        if (ALIAS_MAP[p]) providerStatus.set(ALIAS_MAP[p], info);
      }

      const items = [];
      const seen = new Set();

      // Add actual configured Combos
      for (const c of rawCombos) {
        const id = c.id || c.name;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        items.push({
          id: id.startsWith("combo/") ? id : `combo/${id}`,
          name: c.name || id,
          group: "Combos & Auto (OmniRoute)",
          combo: true,
        });
      }

      // Add real models that are available (skip available === false and failed providers)
      for (const m of rawModels) {
        const id = m.fullModel || m.model || m.id;
        if (!id || seen.has(id)) continue;

        // Skip failed / unavailable models
        if (m.available === false) continue;

        // Skip models of failed / expired / quota-dead providers
        const p = m.provider;
        const pInfo = providerStatus.get(p) || (ALIAS_MAP[p] ? providerStatus.get(ALIAS_MAP[p]) : null);
        if (pInfo && pInfo.failed) continue;

        seen.add(id);
        let group = m.provider || (id.includes("/") ? id.split("/")[0] : "Models");
        if (p === "nvidia") group = "NVIDIA NIM";
        else if (p === "kmc" || p === "kimi-coding") group = "Kimi Coding";
        else if (p === "groq") group = "Groq";
        else if (p === "gh" || p === "github") group = "GitHub Copilot";
        else if (p === "tr" || p === "trae") group = "Trae";
        else if (p === "ds" || p === "deepseek") group = "DeepSeek";
        else if (pInfo?.name && pInfo.name !== p) group = `${pInfo.name}`;

        items.push({
          id,
          name: m.name || id,
          group,
          combo: false,
        });
      }

      if (items.length > 0) {
        return items.sort((a, b) => (b.combo - a.combo) || a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
      }
    }
  } catch (err) {}

  // Fallback to /v1/models if /api/models was not reachable
  const url = `${norm}/v1/models`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: ctl.signal });
    if (r.status === 401 || r.status === 403) throw new Error("Router rejected the API key (401/403)");
    if (!r.ok) throw new Error(`Router answered HTTP ${r.status}`);
    const j = await r.json();
    const raw = Array.isArray(j) ? j : j.data || j.models || [];
    const seen = new Set();
    const items = [];
    for (const m of raw) {
      const id = typeof m === "string" ? m : m.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const owner = typeof m === "object" ? m.owned_by || m.provider : "";
      let group = String(owner || (id.includes("/") ? id.split("/")[0] : "models"));
      const isCombo = /combo|auto/i.test(group) || id.startsWith("auto/") || id.startsWith("combo/");
      if (isCombo) group = "Combos & Auto (OmniRoute)";
      items.push({ id, name: id, group, combo: isCombo });
    }
    return items.sort((a, b) => (b.combo - a.combo) || a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`No response from ${url} (timeout)`);
    if (e.cause?.code === "ECONNREFUSED") throw new Error(`Nothing is listening at ${norm} — is OmniRoute running?`);
    throw e;
  } finally { clearTimeout(t); }
}

async function toolState(t) {
  const paths = t.paths();
  let cfg = {}, error = null;
  try { cfg = (await t.show()) || {}; } catch (e) { error = e.message; }
  return {
    id: t.id, name: t.name, needsModel: t.needsModel !== false,
    claudeTiers: t.claudeTiers?.map((m) => ({ flag: m.flag, envKey: m.envKey })),
    paths, fileExists: paths.some((p) => fs.existsSync(p)),
    configured: !!cfg.baseUrl, active: !!cfg.active, activeProvider: cfg.activeProvider, activeProviderName: cfg.activeProviderName, ambiguousOwner: !!t.ambiguousOwner,
    baseUrl: cfg.baseUrl, apiKey: mask(cfg.apiKey), models: cfg.models || {}, error,
  };
}

const findTool = (id) => {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw Object.assign(new Error(`Unknown tool "${id}"`), { status: 400 });
  return t;
};

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    const entries = await Promise.all(CATALOG.map(async (c) => {
      const adapter = TOOLS.find((t) => t.id === c.id);
      const base = { id: c.id, kind: c.kind, title: c.title, sub: c.sub, color: c.color, fg: c.fg, letter: c.letter };
      const installed = await isInstalled(c);
      if (!adapter) return { ...base, installed, status: "guide" };
      const s = await toolState(adapter);
      // connected = our provider is the active one. Claude's config can't tell routers apart, so it gets a neutral 'routed'.
      const status = s.active ? "connected" : s.ambiguousOwner && s.configured ? "routed" : installed || s.fileExists ? "ready" : "missing";
      return { ...base, ...s, installed, status };
    }));
    return send(res, 200, { tools: entries, discoveredApiKey: getDiscoveredApiKey() });
  }
  if (req.method === "POST" && url.pathname === "/api/preview") {
    const b = await readBody(req);
    return send(res, 200, await preview(b.tool, { ...b, baseUrl: normBase(b.baseUrl) }));
  }
  if (req.method === "GET" && url.pathname === "/api/profiles") return send(res, 200, { profiles: await listProfiles() });
  if (req.method === "POST" && url.pathname === "/api/profiles/add") {
    const { alias, model } = await readBody(req);
    return send(res, 200, { ok: true, file: await addProfile(alias, model), profiles: await listProfiles() });
  }
  if (req.method === "POST" && url.pathname === "/api/profiles/remove") {
    const { alias } = await readBody(req);
    return send(res, 200, { ok: true, file: await removeProfile(alias), profiles: await listProfiles() });
  }
  if (req.method === "POST" && url.pathname === "/api/models") {
    const { baseUrl, apiKey } = await readBody(req);
    try {
      const items = await fetchModels(baseUrl, apiKey);
      if (items && items.length) return send(res, 200, { models: items.map((i) => i.id), items });
    } catch (e) {
      // Router offline or unauthorized — use curated fallback models
    }
    const fallback = getFallbackModels();
    return send(res, 200, { models: fallback.map((i) => i.id), items: fallback, fallback: true });
  }
  if (req.method === "POST" && url.pathname === "/api/detect") {
    const found = [];
    for (const port of [20128, 20129, 20130 === PORT ? 0 : 20130, 3000, 8080].filter(Boolean)) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(1200) });
        if (r.status < 500) found.push({ port, status: r.status });
      } catch {}
    }
    return send(res, 200, { found });
  }
  if (req.method === "POST" && url.pathname === "/api/apply") {
    const b = await readBody(req);
    const t = findTool(b.tool);
    const baseUrl = normBase(b.baseUrl);
    if (!/^https?:\/\//i.test(baseUrl)) return send(res, 400, { error: "Base URL must start with http:// or https://" });
    if (!b.apiKey) return send(res, 400, { error: "API key is required" });
    if (t.needsModel !== false && !b.model) return send(res, 400, { error: "Pick a model first" });
    const written = await t.apply({ baseUrl, apiKey: b.apiKey, model: b.model, subagent: b.subagent, claudeModels: b.claudeModels || {} });
    return send(res, 200, { ok: true, written });
  }
  if (req.method === "POST" && url.pathname === "/api/reset") {
    const { tool } = await readBody(req);
    const touched = await findTool(tool).reset();
    return send(res, 200, { ok: true, touched });
  }
  return send(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);
    if (!isLoopbackHost(req.headers.host)) return send(res, 403, "Forbidden host");
    if (req.method !== "GET") {
      const origin = req.headers.origin;
      if (origin && !isLoopbackHost(new URL(origin).host)) return send(res, 403, "Forbidden origin");
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "Not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`OmniRoute Tools → http://${HOST}:${PORT}`));
}
module.exports = { server, normBase };
