# OmniRoute Tools

> Modern 1-click CLI Configuration Dashboard for [OmniRoute](https://github.com/dromerom/omniroute) (inspired by 9Router).

OmniRoute Tools provides a sleek, modern local web UI to effortlessly discover live working models and configure your AI developer CLI tools (OpenAI Codex CLI & Desktop App, Claude Code, OpenCode, etc.) to route through your local OmniRoute daemon in one click.

![OmniRoute Tools UI](public/app.js)

---

## Features

- **⚡ 1-Click Auto-Configuration:** Automatically generates and surgically updates configuration files (`~/.codex/config.toml`, `~/.claude/settings.json`, etc.) without overwriting existing settings.
- **🔄 Auto-Save on Select:** Seamless model picking like 9Router. Click any model in the picker modal to immediately apply and save it to your tool.
- **🎯 Live Working Model Detection:**
  - Queries OmniRoute's real runtime daemon via machine token.
  - Automatically filters out inactive providers and failed models (`available: false`).
  - No static hardcoded catalogs or phantom models.
- **🔒 Safe Loopback Security:** Binds to `127.0.0.1` only, blocking DNS rebinding and cross-site requests. API keys remain safe and masked in the UI.
- **🧩 Profile Manager:** Easily generate multiple sub-profiles for Codex (`codex -p <alias>`).

---

## Quick Start

### 1. Prerequisites
- Node.js >= 18
- [OmniRoute](https://github.com/dromerom/omniroute) installed and running (`omniroute serve` on port 20128).

### 2. Install & Run
```bash
# Clone the repository
git clone https://github.com/tienhoangit/omniroute-tools.git
cd omniroute-tools

# Install dependencies
npm install

# Start the dashboard
npm start
```

Open your browser and navigate to:
👉 **[http://127.0.0.1:20130](http://127.0.0.1:20130)**

---

## Supported Tools

- **OpenAI Codex CLI & Desktop App** (`~/.codex/config.toml`)
- **Claude Code CLI** (`~/.claude/settings.json`)
- **OpenCode** (`~/.config/opencode/opencode.json`)
- **Kilo Code / Factory Droid / Cline / etc.**

---

## License

MIT License.
