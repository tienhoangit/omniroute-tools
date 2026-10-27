/**
 * Per-tool config writers for OmniRoute.
 *
 * File layout and keys mirror 9Router's src/cli/commands/connectTools.js (MIT),
 * with the provider id changed from "9router" to "omniroute" so both routers
 * can coexist in the same config file and switching is just flipping the
 * active provider.
 *
 * Each tool: { id, name, group, paths(), apply(ctx), show(), reset() }
 *   ctx: { baseUrl (origin, no /v1), apiKey, model, claudeModels }
 *   needsModel:false => tool discovers models itself (omp)
 * Only entries we own are touched; everything else in the file is preserved.
 */
const fs = require("fs");
const path = require("path");
const {
  home, isStr, v1, readJson, readText, writeFile, writeJson, rewriteFile, codecs,
} = require("./fsutil");

const PID = "omniroute"; // provider id written into every config
const PNAME = "OmniRoute";

// ── Claude Code ─────────────────────────────────────────────────────────────
const CLAUDE_MODELS = [
  { flag: "fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL" },
  { flag: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { flag: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { flag: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
];
const CLAUDE_RESET_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", ...CLAUDE_MODELS.map((m) => m.envKey)];
const claudePath = () => path.join(home(), ".claude", "settings.json");

const claude = {
  // ambiguousOwner: settings.json has no provider id, so we cannot tell whether
  // ANTHROPIC_BASE_URL was written by OmniRoute or 9Router (same default port).
  id: "claude", name: "Claude Code", needsModel: false, claudeTiers: CLAUDE_MODELS, ambiguousOwner: true,
  paths: () => [claudePath()],
  async apply({ baseUrl, apiKey, claudeModels = {} }) {
    const file = claudePath();
    const cur = readJson(file) || {};
    cur.hasCompletedOnboarding = true;
    cur.env = { ...(cur.env || {}), ANTHROPIC_BASE_URL: v1(baseUrl), ANTHROPIC_AUTH_TOKEN: apiKey };
    // A tier left empty is removed so Claude Code falls back to its own default.
    for (const m of CLAUDE_MODELS) {
      if (claudeModels[m.envKey]) cur.env[m.envKey] = claudeModels[m.envKey];
      else delete cur.env[m.envKey];
    }
    writeJson(file, cur);
    return [file];
  },
  async show() {
    const env = readJson(claudePath())?.env || {};
    const models = {};
    if (isStr(env.ANTHROPIC_MODEL)) models.main = env.ANTHROPIC_MODEL;
    for (const m of CLAUDE_MODELS) if (isStr(env[m.envKey])) models[m.flag] = env[m.envKey];
    return { baseUrl: env.ANTHROPIC_BASE_URL, apiKey: env.ANTHROPIC_AUTH_TOKEN, models, active: false };
  },
  async reset() {
    const file = claudePath();
    const cur = readJson(file);
    if (!cur) return [];
    if (cur.env) {
      CLAUDE_RESET_KEYS.forEach((k) => delete cur.env[k]);
      if (!Object.keys(cur.env).length) delete cur.env;
    }
    rewriteFile(file, JSON.stringify(cur, null, 2));
    return [file];
  },
};

// ── OpenAI Codex (CLI + desktop app share ~/.codex/config.toml) ─────────────
const codexPath = () => path.join(home(), ".codex", "config.toml");

const codex = {
  id: "codex", name: "Codex (CLI + Desktop app)",
  paths: () => [codexPath()],
  async apply({ baseUrl, apiKey, model, subagent }) {
    const { parseTOML, stringifyTOML } = await codecs();
    const file = codexPath();
    let cfg = {};
    const text = readText(file);
    if (text !== null) {
      try { cfg = parseTOML(text) || {}; } catch (err) { throw new Error(`Cannot parse ${file}: ${err.message}`); }
    }
    cfg.model = model;
    cfg.model_provider = PID;
    cfg.model_providers = cfg.model_providers || {};
    // Custom providers ignore auth.json, so the key must travel as a static header.
    cfg.model_providers[PID] = {
      name: PNAME,
      base_url: v1(baseUrl),
      wire_api: "responses",
      requires_openai_auth: false,
      http_headers: { Authorization: `Bearer ${apiKey}` },
    };
    cfg.agents = cfg.agents || {};
    delete cfg.agents.subagent;
    cfg.agents.default_subagent_model = subagent || model;
    writeFile(file, stringifyTOML(cfg));
    return [file];
  },
  async show() {
    const text = readText(codexPath());
    if (text === null) return {};
    const { parseTOML } = await codecs();
    let cfg;
    try { cfg = parseTOML(text) || {}; } catch (err) { throw new Error(`Cannot parse ${codexPath()}: ${err.message}`); }
    const activeP = cfg.model_provider ? cfg.model_providers?.[cfg.model_provider] : undefined;
    const p = cfg.model_providers?.[PID];
    const auth = (p || activeP)?.http_headers?.Authorization;
    return {
      baseUrl: p?.base_url || activeP?.base_url,
      apiKey: isStr(auth) ? auth.replace(/^Bearer\s+/i, "") : undefined,
      models: {
        ...(isStr(cfg.model) ? { main: cfg.model } : {}),
        ...(isStr(cfg.agents?.default_subagent_model) ? { subagent: cfg.agents.default_subagent_model } : {}),
      },
      active: cfg.model_provider === PID,
      activeProvider: cfg.model_provider,
      activeProviderName: activeP?.name || cfg.model_provider,
    };
  },
  async reset() {
    const text = readText(codexPath());
    if (text === null) return [];
    const { parseTOML, stringifyTOML } = await codecs();
    const cfg = parseTOML(text) || {};
    if (cfg.model_provider === PID) { delete cfg.model; delete cfg.model_provider; }
    if (cfg.model_providers) delete cfg.model_providers[PID];
    if (cfg.agents) { delete cfg.agents.default_subagent_model; delete cfg.agents.subagent; }
    for (const k of ["model_providers", "agents"]) {
      if (cfg[k] && !Object.keys(cfg[k]).length) delete cfg[k];
    }
    rewriteFile(codexPath(), stringifyTOML(cfg));
    return [codexPath()];
  },
};

// ── OpenCode ────────────────────────────────────────────────────────────────
const opencodePath = () => path.join(home(), ".config", "opencode", "opencode.json");

const opencode = {
  id: "opencode", name: "OpenCode",
  paths: () => [opencodePath()],
  async apply({ baseUrl, apiKey, model }) {
    const file = opencodePath();
    const cfg = readJson(file) || {};
    cfg.provider = cfg.provider || {};
    const p = cfg.provider[PID] || { npm: "@ai-sdk/openai-compatible", options: {}, models: {} };
    p.options = { ...p.options, baseURL: v1(baseUrl), apiKey };
    p.models = p.models || {};
    p.models[model] = { name: model, modalities: { input: ["text", "image"], output: ["text"] } };
    cfg.provider[PID] = p;
    cfg.model = `${PID}/${model}`;
    cfg.agent = cfg.agent || {};
    cfg.agent.explorer = {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `${PID}/${model}`,
    };
    writeJson(file, cfg);
    return [file];
  },
  async show() {
    const cfg = readJson(opencodePath()) || {};
    const p = cfg.provider?.[PID];
    const models = {};
    if (isStr(cfg.model)) models.main = cfg.model;
    if (isStr(cfg.agent?.explorer?.model)) models.explorer = cfg.agent.explorer.model;
    const listed = Object.keys(p?.models || {});
    if (listed.length) models.available = listed.join(", ");
    return { baseUrl: p?.options?.baseURL, apiKey: p?.options?.apiKey, models, active: !!cfg.model?.startsWith(`${PID}/`) };
  },
  async reset() {
    const file = opencodePath();
    const cfg = readJson(file);
    if (!cfg) return [];
    if (cfg.provider) delete cfg.provider[PID];
    if (cfg.model?.startsWith(`${PID}/`)) delete cfg.model;
    if (cfg.agent?.explorer?.model?.startsWith(`${PID}/`)) {
      delete cfg.agent.explorer;
      if (!Object.keys(cfg.agent).length) delete cfg.agent;
    }
    rewriteFile(file, JSON.stringify(cfg, null, 2));
    return [file];
  },
};

// ── Factory Droid ───────────────────────────────────────────────────────────
const droidPath = () => path.join(home(), ".factory", "settings.json");
const isDroidOurs = (m) => m.id?.startsWith("custom:OmniRoute");

const droid = {
  id: "droid", name: "Factory Droid",
  paths: () => [droidPath()],
  async apply({ baseUrl, apiKey, model }) {
    const file = droidPath();
    const cfg = readJson(file) || {};
    const others = (cfg.customModels || []).filter((m) => !isDroidOurs(m));
    cfg.customModels = [
      {
        model, id: "custom:OmniRoute-0", index: 0, baseUrl: v1(baseUrl), apiKey,
        displayName: model, maxOutputTokens: 131072, noImageSupport: false, provider: "openai",
      },
      ...others,
    ];
    cfg.customModels.forEach((m, i) => { m.index = i; });
    writeJson(file, cfg);
    return [file];
  },
  async show() {
    const ours = (readJson(droidPath())?.customModels || []).filter(isDroidOurs);
    return {
      baseUrl: ours[0]?.baseUrl, apiKey: ours[0]?.apiKey,
      models: ours.length ? { main: ours[0].model } : {}, active: ours.length > 0,
    };
  },
  async reset() {
    const file = droidPath();
    const cfg = readJson(file);
    if (!cfg?.customModels) return [];
    cfg.customModels = cfg.customModels.filter((m) => !isDroidOurs(m));
    cfg.customModels.forEach((m, i) => { m.index = i; });
    if (!cfg.customModels.length) delete cfg.customModels;
    rewriteFile(file, JSON.stringify(cfg, null, 2));
    return [file];
  },
};

// ── Crush ───────────────────────────────────────────────────────────────────
const crushPath = () => path.join(process.env.XDG_CONFIG_HOME || path.join(home(), ".config"), "crush", "crush.json");

const crush = {
  id: "crush", name: "Crush",
  paths: () => [crushPath()],
  async apply({ baseUrl, apiKey, model }) {
    const file = crushPath();
    const cfg = readJson(file) || {};
    cfg.providers = cfg.providers || {};
    cfg.providers[PID] = {
      type: "openai-compat", base_url: v1(baseUrl), api_key: apiKey,
      models: [{ id: model, name: model, context_window: 128000 }],
    };
    writeJson(file, cfg);
    return [file];
  },
  async show() {
    const p = readJson(crushPath())?.providers?.[PID];
    const ids = (p?.models || []).map((m) => m.id).filter(isStr);
    return { baseUrl: p?.base_url, apiKey: p?.api_key, models: ids.length ? { main: ids[0] } : {}, active: !!p };
  },
  async reset() {
    const file = crushPath();
    const cfg = readJson(file);
    if (!cfg?.providers?.[PID]) return [];
    delete cfg.providers[PID];
    if (!Object.keys(cfg.providers).length) delete cfg.providers;
    rewriteFile(file, JSON.stringify(cfg, null, 2));
    return [file];
  },
};

// ── Kilo Code (CLI auth only; VS Code settings are not file-writable) ───────
const kiloPath = () => path.join(home(), ".local", "share", "kilo", "auth.json");

const kilo = {
  id: "kilo", name: "Kilo Code CLI",
  paths: () => [kiloPath()],
  async apply({ baseUrl, apiKey, model }) {
    const file = kiloPath();
    const auth = readJson(file) || {};
    auth["openai-compatible"] = { type: "api-key", apiKey, baseUrl: v1(baseUrl), model };
    writeJson(file, auth);
    return [file];
  },
  async show() {
    const a = readJson(kiloPath())?.["openai-compatible"];
    return { baseUrl: a?.baseUrl, apiKey: a?.apiKey, models: isStr(a?.model) ? { main: a.model } : {}, active: !!a };
  },
  async reset() {
    const file = kiloPath();
    const auth = readJson(file);
    if (!auth) return [];
    delete auth["openai-compatible"];
    rewriteFile(file, JSON.stringify(auth, null, 2));
    return [file];
  },
};

// ── Cline CLI ───────────────────────────────────────────────────────────────
const clineDir = () => path.join(home(), ".cline", "data");
const clineState = () => path.join(clineDir(), "globalState.json");
const clineSecrets = () => path.join(clineDir(), "secrets.json");

const cline = {
  id: "cline", name: "Cline CLI",
  paths: () => [clineState(), clineSecrets()],
  async apply({ baseUrl, apiKey, model }) {
    const state = readJson(clineState()) || {};
    state.actModeApiProvider = "openai";
    state.planModeApiProvider = "openai";
    state.openAiBaseUrl = baseUrl; // Cline expects the base WITHOUT /v1
    state.openAiModelId = model;
    state.planModeOpenAiModelId = model;
    writeJson(clineState(), state);
    const secrets = readJson(clineSecrets()) || {};
    secrets.openAiApiKey = apiKey;
    writeJson(clineSecrets(), secrets);
    return [clineState(), clineSecrets()];
  },
  async show() {
    const st = readJson(clineState()) || {};
    const models = {};
    if (isStr(st.openAiModelId)) models.act = st.openAiModelId;
    if (isStr(st.planModeOpenAiModelId)) models.plan = st.planModeOpenAiModelId;
    return {
      baseUrl: st.openAiBaseUrl, apiKey: readJson(clineSecrets())?.openAiApiKey, models,
      active: st.actModeApiProvider === "openai",
    };
  },
  async reset() {
    const state = readJson(clineState());
    if (!state) return [];
    if (state.actModeApiProvider === "openai") {
      delete state.openAiBaseUrl; delete state.openAiModelId; delete state.planModeOpenAiModelId;
      state.actModeApiProvider = "cline";
      state.planModeApiProvider = "cline";
    }
    rewriteFile(clineState(), JSON.stringify(state, null, 2));
    const touched = [clineState()];
    const secrets = readJson(clineSecrets());
    if (secrets) {
      delete secrets.openAiApiKey;
      rewriteFile(clineSecrets(), JSON.stringify(secrets, null, 2));
      touched.push(clineSecrets());
    }
    return touched;
  },
};

// ── Pi (pi-coding-agent) ────────────────────────────────────────────────────
// Prefers ~/.pi/agent/models.json; an existing legacy ~/.pi/models.json wins if the new one is absent.
const piPath = () => {
  const agent = path.join(home(), ".pi", "agent", "models.json");
  const root = path.join(home(), ".pi", "models.json");
  return !fs.existsSync(agent) && fs.existsSync(root) ? root : agent;
};

const pi = {
  id: "pi", name: "Pi",
  paths: () => [piPath()],
  async apply({ baseUrl, apiKey, model }) {
    const file = piPath();
    const cfg = readJson(file) || {};
    cfg.providers = cfg.providers || {};
    cfg.providers[PID] = {
      ...(cfg.providers[PID] || {}),
      baseUrl: v1(baseUrl), apiKey, api: "openai-completions",
      models: [{ id: model, name: model, contextWindow: 128000, maxTokens: 16384 }],
    };
    writeJson(file, cfg);
    return [file];
  },
  async show() {
    const p = readJson(piPath())?.providers?.[PID];
    const ids = (p?.models || []).map((m) => (typeof m === "string" ? m : m?.id)).filter(isStr);
    return { baseUrl: p?.baseUrl, apiKey: p?.apiKey, models: ids.length ? { main: ids[0] } : {}, active: !!p };
  },
  async reset() {
    const file = piPath();
    const cfg = readJson(file);
    if (!cfg?.providers?.[PID]) return [];
    delete cfg.providers[PID];
    if (!Object.keys(cfg.providers).length) delete cfg.providers;
    rewriteFile(file, JSON.stringify(cfg, null, 2));
    return [file];
  },
};

// ── Oh My Pi ────────────────────────────────────────────────────────────────
// Proxy discovery lists every server model, so no model is written.
const ompPath = () => path.join(home(), ".omp", "agent", "models.yml");

async function readYaml(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    const { parseYAML } = await codecs();
    return parseYAML(text) || {};
  } catch (err) {
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }
}

const omp = {
  id: "omp", name: "Oh My Pi", needsModel: false,
  paths: () => [ompPath()],
  async apply({ baseUrl, apiKey }) {
    const { stringifyYAML } = await codecs();
    const file = ompPath();
    const cfg = (await readYaml(file)) || {};
    cfg.providers = cfg.providers || {};
    cfg.providers[PID] = {
      baseUrl: v1(baseUrl), apiKey, api: "openai-completions",
      authHeader: true, disableStrictTools: true, discovery: { type: "proxy" },
    };
    writeFile(file, stringifyYAML(cfg));
    return [file];
  },
  async show() {
    const p = (await readYaml(ompPath()))?.providers?.[PID];
    return {
      baseUrl: p?.baseUrl, apiKey: p?.apiKey, active: !!p,
      models: p?.discovery?.type === "proxy" ? { main: "(all server models, via discovery)" } : {},
    };
  },
  async reset() {
    const { stringifyYAML } = await codecs();
    const file = ompPath();
    const cfg = await readYaml(file);
    if (!cfg?.providers?.[PID]) return [];
    delete cfg.providers[PID];
    if (!Object.keys(cfg.providers).length) delete cfg.providers;
    rewriteFile(file, Object.keys(cfg).length ? stringifyYAML(cfg) : "");
    return [file];
  },
};

const TOOLS = [codex, claude, opencode, droid, crush, kilo, cline, pi, omp];

// Tools 9Router's dashboard lists whose file layout is NOT yet ported here.
// Kept visible in the UI so coverage gaps are explicit instead of hidden.
const PLANNED = [
  "copilot", "cowork", "codewhale", "deepseek-tui", "devin", "forge",
  "grok-build", "hermes", "jcode", "openclaw", "smelt", "antigravity-mitm",
];

module.exports = { TOOLS, PLANNED, PID, CLAUDE_MODELS };
