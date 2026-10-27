// Runs every adapter against a throwaway HOME so the real ~/.codex etc. are never touched.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ort-home-"));
process.env.USERPROFILE = tmp; process.env.HOME = tmp;
delete process.env.XDG_CONFIG_HOME;
const { TOOLS } = require("../lib/tools");
const { BACKUP_SUFFIX } = require("../lib/fsutil");

const ctx = { baseUrl: "http://127.0.0.1:20128", apiKey: "sk-test-123", model: "gpt-5", claudeModels: { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-x" } };
const tool = (id) => TOOLS.find((t) => t.id === id);

test("sandbox HOME is in effect", () => assert.strictEqual(os.homedir(), tmp));

test("codex: merges into existing config, keeps unrelated + other providers, backs up once", async () => {
  const file = path.join(tmp, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = `model = "cf"\nmodel_provider = "9router"\n\n[plugins."x@y"]\nenabled = true\n\n[model_providers.9router]\nname = "9Router"\nbase_url = "http://127.0.0.1:20128/v1"\nwire_api = "responses"\n`;
  fs.writeFileSync(file, original);

  await tool("codex").apply(ctx);
  const { parseTOML } = await import("confbox");
  const cfg = parseTOML(fs.readFileSync(file, "utf8"));
  assert.strictEqual(cfg.model_provider, "omniroute");
  assert.strictEqual(cfg.model, "gpt-5");
  assert.strictEqual(cfg.model_providers.omniroute.base_url, "http://127.0.0.1:20128/v1");
  assert.strictEqual(cfg.model_providers.omniroute.http_headers.Authorization, "Bearer sk-test-123");
  assert.ok(cfg.model_providers["9router"], "9router provider must survive");
  assert.strictEqual(cfg.plugins["x@y"].enabled, true, "unrelated sections must survive");

  assert.strictEqual(fs.readFileSync(file + BACKUP_SUFFIX, "utf8"), original);
  await tool("codex").apply({ ...ctx, model: "gpt-6" });   // second write must not overwrite backup
  assert.strictEqual(fs.readFileSync(file + BACKUP_SUFFIX, "utf8"), original);

  const shown = await tool("codex").show();
  assert.strictEqual(shown.active, true);
  assert.strictEqual(shown.models.main, "gpt-6");

  await tool("codex").reset();
  const after = parseTOML(fs.readFileSync(file, "utf8"));
  assert.strictEqual(after.model_providers.omniroute, undefined);
  assert.ok(after.model_providers["9router"], "reset must not touch 9router");
  assert.strictEqual(after.plugins["x@y"].enabled, true);
  assert.notStrictEqual(after.model_provider, "omniroute");
});

test("codex: creates file when none exists, rejects unparsable file without clobbering it", async () => {
  fs.rmSync(path.join(tmp, ".codex"), { recursive: true, force: true });
  await tool("codex").apply(ctx);
  assert.ok(fs.existsSync(path.join(tmp, ".codex", "config.toml")));
  const bad = path.join(tmp, ".codex", "config.toml");
  fs.writeFileSync(bad, "this = = not toml [[[");
  await assert.rejects(() => tool("codex").apply(ctx), /Cannot parse/);
  assert.strictEqual(fs.readFileSync(bad, "utf8"), "this = = not toml [[[");
});

for (const id of ["claude", "opencode", "droid", "crush", "kilo", "cline", "pi", "omp"]) {
  test(`${id}: apply -> show -> reset round trip preserves foreign data`, async () => {
    const t = tool(id);
    await t.apply(ctx);
    const s = await t.show();
    assert.strictEqual(s.active, !t.ambiguousOwner, `${id} active flag`);
    assert.ok(String(s.baseUrl).includes("127.0.0.1:20128"));
    for (const f of t.paths()) assert.ok(fs.existsSync(f), `${f} should exist`);
    await t.reset();
    const s2 = await t.show();
    assert.ok(!s2.active && (t.ambiguousOwner || !s2.baseUrl), `${id} should be cleared after reset`);
  });
}

test("droid/crush/pi: foreign entries survive apply and reset", async () => {
  const dp = path.join(tmp, ".factory", "settings.json");
  fs.mkdirSync(path.dirname(dp), { recursive: true });
  fs.writeFileSync(dp, JSON.stringify({ theme: "dark", customModels: [{ id: "custom:Mine", model: "m", index: 0 }] }));
  await tool("droid").apply(ctx);
  let d = JSON.parse(fs.readFileSync(dp, "utf8"));
  assert.strictEqual(d.customModels.length, 2); assert.strictEqual(d.theme, "dark");
  assert.deepStrictEqual(d.customModels.map((m) => m.index), [0, 1]);
  await tool("droid").reset();
  d = JSON.parse(fs.readFileSync(dp, "utf8"));
  assert.deepStrictEqual(d.customModels.map((m) => m.id), ["custom:Mine"]);
});

test("claude: empty tier is removed, not left stale", async () => {
  const t = tool("claude");
  await t.apply({ ...ctx, claudeModels: { ANTHROPIC_DEFAULT_OPUS_MODEL: "o1" } });
  await t.apply({ ...ctx, claudeModels: {} });
  const env = JSON.parse(fs.readFileSync(path.join(tmp, ".claude", "settings.json"), "utf8")).env;
  assert.strictEqual(env.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
});

test("server: rejects foreign Host/Origin and never leaks the full key", async () => {
  const { server } = require("../server");
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  await tool("kilo").apply(ctx);
  const st = await (await fetch(`${base}/api/state`)).json();
  assert.ok(!JSON.stringify(st).includes("sk-test-123"), "full key must not be returned");
  const evil = await fetch(`${base}/api/reset`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
  assert.strictEqual(evil.status, 403);
  const trav = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.notStrictEqual(trav.status, 200);
  server.close();
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
