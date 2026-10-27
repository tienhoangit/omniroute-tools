/**
 * Catalog: the ordered list of tools shown in the UI (mirrors 9Router's CLI Tools
 * page), plus per-tool "manual config" previews and Codex profile helpers.
 *
 * kind "auto"  -> we can write the config (adapter in tools.js)
 * kind "guide" -> no writer yet; the UI shows copyable endpoint/key/model values
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { TOOLS, PID, CLAUDE_MODELS } = require("./tools");
const { home, v1, codecs, writeFile, BACKUP_SUFFIX } = require("./fsutil");

// color/letter are used for the avatar tile; bins are probed on PATH to detect "installed".
const CATALOG = [
  { id: "claude", kind: "auto", title: "Claude Code", sub: "Anthropic Claude Code CLI", color: "#d97757", letter: "C", bins: ["claude"] },
  { id: "codex", kind: "auto", title: "OpenAI Codex CLI / App", sub: "OpenAI Codex CLI", color: "#111111", letter: "O", bins: ["codex"], dirs: [".codex"] },
  { id: "opencode", kind: "auto", title: "OpenCode", sub: "OpenCode AI coding agent", color: "#2b2b2b", letter: "▣", bins: ["opencode"] },
  { id: "hermes", kind: "guide", title: "Hermes Agent", sub: "Nous Research Hermes agent", color: "#1f1f1f", letter: "H", bins: ["hermes"] },
  { id: "cursor", kind: "guide", title: "Cursor", sub: "Cursor IDE (config is not file-writable)", color: "#0b0b0b", letter: "◆" },
  { id: "kilo", kind: "auto", title: "Kilo Code", sub: "Kilo Code CLI", color: "#f2d21b", letter: "K", bins: ["kilo", "kilocode"], fg: "#111" },
  { id: "continue", kind: "guide", title: "Continue", sub: "Continue.dev extension", color: "#7fd1b9", letter: "∞", fg: "#103" },
  { id: "qwen", kind: "guide", title: "Qwen Code", sub: "Alibaba Qwen Code CLI", color: "#6d5bf0", letter: "Q", bins: ["qwen"] },
  { id: "jcode", kind: "guide", title: "jcode", sub: "jcode coding agent", color: "#5fcf9a", letter: "j", bins: ["jcode"], fg: "#052" },
  { id: "openclaw", kind: "guide", title: "Open Claw", sub: "Open Claw agent", color: "#d9463b", letter: "🦞", bins: ["openclaw"] },
  { id: "copilot", kind: "guide", title: "GitHub Copilot", sub: "GitHub Copilot", color: "#3b82c4", letter: "G" },
  { id: "cowork", kind: "guide", title: "Claude Cowork", sub: "Claude Cowork", color: "#d97757", letter: "C" },
  { id: "droid", kind: "auto", title: "Factory Droid", sub: "Factory Droid CLI", color: "#222222", letter: "✻", bins: ["droid"] },
  { id: "cline", kind: "auto", title: "Cline", sub: "Cline CLI", color: "#2a2147", letter: "▲", bins: ["cline"] },
  { id: "roo", kind: "guide", title: "Roo", sub: "Roo Code extension", color: "#111111", letter: "R" },
  { id: "amp", kind: "guide", title: "Amp CLI", sub: "Sourcegraph Amp", color: "#e02d1f", letter: "A", bins: ["amp"] },
  { id: "deepseek-tui", kind: "guide", title: "DeepSeek TUI", sub: "DeepSeek terminal UI", color: "#1f4fd8", letter: "D", bins: ["deepseek-tui"] },
  { id: "grok-build", kind: "guide", title: "Grok Build", sub: "xAI Grok Build", color: "#2a2a2a", letter: "⌀", bins: ["grok"] },
  { id: "crush", kind: "auto", title: "Crush", sub: "Charm Crush", color: "#c026d3", letter: "✦", bins: ["crush"] },
  { id: "pi", kind: "auto", title: "Pi", sub: "pi-coding-agent", color: "#0e7490", letter: "π", bins: ["pi"] },
  { id: "omp", kind: "auto", title: "Oh My Pi", sub: "omp agent", color: "#7c3aed", letter: "Ω", bins: ["omp"] },
];

// ── "installed" detection ───────────────────────────────────────────────────
const binCache = new Map(); // bin -> { at, ok }
function hasBin(bin) {
  const hit = binCache.get(bin);
  if (hit && Date.now() - hit.at < 30000) return Promise.resolve(hit.ok);
  const cmd = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(cmd, [bin], { timeout: 2500, windowsHide: true }, (err) => {
      const ok = !err;
      binCache.set(bin, { at: Date.now(), ok });
      resolve(ok);
    });
  });
}

async function isInstalled(entry) {
  if (entry.dirs?.some((d) => fs.existsSync(path.join(home(), d)))) return true;
  for (const b of entry.bins || []) if (await hasBin(b)) return true;
  const adapter = TOOLS.find((t) => t.id === entry.id);
  return !!adapter?.paths().some((p) => fs.existsSync(p));
}

// ── Manual-config previews: only OUR fragment, never the user's other settings ──
const redact = (s) => s;
const json = (o) => JSON.stringify(o, null, 2);

async function preview(id, { baseUrl, apiKey, model, claudeModels = {} }) {
  const url = v1(baseUrl), key = apiKey || "<OMNIROUTE_API_KEY>", m = model || "<model-id>";
  switch (id) {
    case "codex": {
      const { stringifyTOML } = await codecs();
      const body = stringifyTOML({
        model: m, model_provider: PID,
        model_providers: { [PID]: { name: "OmniRoute", base_url: url, wire_api: "responses", requires_openai_auth: false, http_headers: { Authorization: `Bearer ${key}` } } },
        agents: { default_subagent_model: m },
      });
      return { path: "~/.codex/config.toml", text: `# OmniRoute Configuration for Codex CLI\n${body}` };
    }
    case "claude": {
      const env = { ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: key };
      for (const t of CLAUDE_MODELS) if (claudeModels[t.envKey]) env[t.envKey] = claudeModels[t.envKey];
      return { path: "~/.claude/settings.json", text: json({ hasCompletedOnboarding: true, env }) };
    }
    case "opencode":
      return { path: "~/.config/opencode/opencode.json", text: json({
        provider: { [PID]: { npm: "@ai-sdk/openai-compatible", options: { baseURL: url, apiKey: key }, models: { [m]: { name: m } } } },
        model: `${PID}/${m}` }) };
    case "droid":
      return { path: "~/.factory/settings.json", text: json({ customModels: [{ model: m, id: "custom:OmniRoute-0", index: 0, baseUrl: url, apiKey: key, displayName: m, provider: "openai" }] }) };
    case "crush":
      return { path: "~/.config/crush/crush.json", text: json({ providers: { [PID]: { type: "openai-compat", base_url: url, api_key: key, models: [{ id: m, name: m, context_window: 128000 }] } } }) };
    case "kilo":
      return { path: "~/.local/share/kilo/auth.json", text: json({ "openai-compatible": { type: "api-key", apiKey: key, baseUrl: url, model: m } }) };
    case "cline":
      return { path: "~/.cline/data/globalState.json  +  secrets.json", text: json({
        "globalState.json": { actModeApiProvider: "openai", planModeApiProvider: "openai", openAiBaseUrl: baseUrl, openAiModelId: m, planModeOpenAiModelId: m },
        "secrets.json": { openAiApiKey: key } }) };
    case "pi":
      return { path: "~/.pi/agent/models.json", text: json({ providers: { [PID]: { baseUrl: url, apiKey: key, api: "openai-completions", models: [{ id: m, name: m, contextWindow: 128000, maxTokens: 16384 }] } } }) };
    case "omp": {
      const { stringifyYAML } = await codecs();
      return { path: "~/.omp/agent/models.yml", text: stringifyYAML({ providers: { [PID]: { baseUrl: url, apiKey: key, api: "openai-completions", authHeader: true, disableStrictTools: true, discovery: { type: "proxy" } } } }) };
    }
    default:
      return { path: "(any OpenAI-compatible tool)", text:
        `Base URL : ${url}\nAPI key  : ${key}\nModel    : ${m}\nAPI type : OpenAI-compatible (chat/completions or responses)` };
  }
}

// ── Codex profiles ("Additional Models"): ~/.codex/<alias>.config.toml, run with `codex -p <alias>` ──
const codexDir = () => path.join(home(), ".codex");
const aliasOk = (a) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(a || "");

async function listProfiles() {
  const dir = codexDir();
  if (!fs.existsSync(dir)) return [];
  const { parseTOML } = await codecs();
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".config.toml")) continue;
    try {
      const cfg = parseTOML(fs.readFileSync(path.join(dir, f), "utf8")) || {};
      if (cfg.model_provider !== PID) continue; // only profiles that route through OmniRoute
      out.push({ alias: f.slice(0, -".config.toml".length), model: cfg.model || "" });
    } catch {}
  }
  return out.sort((a, b) => a.alias.localeCompare(b.alias));
}

async function addProfile(alias, model) {
  if (!aliasOk(alias)) throw Object.assign(new Error("Alias may only contain letters, digits, . _ - (max 64)"), { status: 400 });
  if (!model) throw Object.assign(new Error("Pick a model for the profile"), { status: 400 });
  const file = path.join(codexDir(), `${alias}.config.toml`);
  if (fs.existsSync(file)) {
    const { parseTOML } = await codecs();
    const cur = parseTOML(fs.readFileSync(file, "utf8")) || {};
    if (cur.model_provider !== PID) throw Object.assign(new Error(`"${alias}" already exists and belongs to another provider; choose a different alias`), { status: 409 });
  }
  const { stringifyTOML } = await codecs();
  writeFile(file, `# codex -p ${alias}\n${stringifyTOML({ model, model_provider: PID })}`);
  return file;
}

async function removeProfile(alias) {
  if (!aliasOk(alias)) throw Object.assign(new Error("Invalid alias"), { status: 400 });
  const file = path.join(codexDir(), `${alias}.config.toml`);
  const mine = (await listProfiles()).some((p) => p.alias === alias);
  if (!mine) throw Object.assign(new Error("Not an OmniRoute profile"), { status: 404 });
  fs.rmSync(file);
  return file;
}

module.exports = { CATALOG, isInstalled, preview, listProfiles, addProfile, removeProfile, redact };
