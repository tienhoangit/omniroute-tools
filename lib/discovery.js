/**
 * Auto-detect OmniRoute API key and provide curated OmniRoute model fallbacks.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const home = () => os.homedir();

function getDiscoveredApiKey() {
  // 1. Check environment variable
  if (process.env.OMNIROUTE_API_KEY) {
    return process.env.OMNIROUTE_API_KEY.trim();
  }

  // 2. Check ~/.omniroute/tools-key.json (our minted/cached key for tools)
  try {
    const keyFile = path.join(home(), ".omniroute", "tools-key.json");
    if (fs.existsSync(keyFile)) {
      const data = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      if (data?.apiKey) return data.apiKey.trim();
    }
  } catch {}

  // 3. Check ~/.codex/config.toml if it already has an omniroute key
  try {
    const codexFile = path.join(home(), ".codex", "config.toml");
    if (fs.existsSync(codexFile)) {
      const text = fs.readFileSync(codexFile, "utf8");
      // Match key under [model_providers.omniroute]
      const m = text.match(/model_providers\.omniroute[\s\S]*?env_key\s*=\s*["']([^"']+)["']/i);
      if (m && m[1] && process.env[m[1]]) return process.env[m[1]].trim();
      const mKey = text.match(/model_providers\.omniroute[\s\S]*?api_key\s*=\s*["']([^"']+)["']/i);
      if (mKey && mKey[1]) return mKey[1].trim();
    }
  } catch {}

  return "";
}

function getFallbackModels() {
  const groups = [
    {
      group: "Combos & Auto (OmniRoute)",
      combo: true,
      models: [
        "auto/best-coding",
        "auto/best-reasoning",
        "auto/best-fast",
        "auto/best-vision",
        "auto/best-chat",
        "auto/best-coding-fast",
        "auto/pro-coding",
        "auto/pro-reasoning",
        "auto/coding",
        "auto/fast",
        "auto/chat",
        "auto/smart",
        "auto/best-free",
        "auto/deepseek",
        "auto/claude-sonnet",
        "auto/claude-opus",
        "auto/gpt",
        "auto/gemini",
        "auto/qwen",
        "auto/llama",
        "auto/kimi",
        "auto/glm",
      ],
    },
    {
      group: "Connected Models (GitHub / gh)",
      combo: false,
      models: [
        "gh/claude-sonnet-5-5",
        "gh/claude-sonnet-5",
        "gh/claude-opus-5",
        "gh/claude-fable-5.1",
        "gh/claude-opus-4.8-fast",
        "gh/claude-haiku-4.5",
        "gh/gpt-6-astra",
        "gh/gpt-5.6-sol",
        "gh/gpt-5.6-terra",
        "gh/gpt-5.6-luna",
        "gh/gemini-3.8-flash",
        "gh/kimi-k3",
        "gh/grok-4.6",
        "gh/mai-code-1.1-flash",
        "gh/auto",
      ],
    },
    {
      group: "Codex App Server",
      combo: false,
      models: [
        "codex-app-server/gpt-4o",
        "codex-app-server/gpt-4o-mini",
        "codex-app-server/o1",
        "codex-app-server/o3-mini",
      ],
    },
    {
      group: "Devin Agentic",
      combo: false,
      models: [
        "devin-cli-agentic/claude-3-7-sonnet",
        "devin-cli-agentic/claude-3-5-sonnet",
        "devin-cli-agentic/gpt-4o",
      ],
    },
  ];

  const items = [];
  for (const g of groups) {
    for (const m of g.models) {
      items.push({ id: m, group: g.group, combo: g.combo });
    }
  }
  return items;
}

module.exports = { getDiscoveredApiKey, getFallbackModels };
