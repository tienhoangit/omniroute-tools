/**
 * File helpers shared by every tool adapter.
 *
 * Behaviour mirrors 9Router's connectTools.js (MIT): config files hold an API
 * key so they are written owner-only, and the user's pre-existing file is
 * backed up exactly once (`<file>.bak-omniroute`) before our first write.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const home = () => os.homedir();
const isStr = (v) => typeof v === "string" && v.length > 0;
const v1 = (baseUrl) => (baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`);
const SECRET_MODE = 0o600;
const BACKUP_SUFFIX = ".bak-omniroute";

// Drop trailing commas (JSONC) outside string literals.
function stripTrailingCommas(text) {
  return text.replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (m, str, tail) => str ?? tail);
}

function readJson(file) {
  try {
    return JSON.parse(stripTrailingCommas(fs.readFileSync(file, "utf8")));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// Rewrite an existing file (reset path): no backup, keeps existing mode.
function rewriteFile(file, content) {
  fs.writeFileSync(file, content, { mode: SECRET_MODE });
}

// First write: back up the user's original once, then write atomically.
function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = `${file}${BACKUP_SUFFIX}`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
    try { fs.chmodSync(backup, SECRET_MODE); } catch {}
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { mode: SECRET_MODE });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, SECRET_MODE); } catch {}
}

const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2));

// confbox is ESM-only; load lazily so JSON-only tools never need it.
let confbox;
async function codecs() {
  confbox ||= await import("confbox");
  return confbox;
}

module.exports = {
  home, isStr, v1, readJson, readText, writeFile, writeJson, rewriteFile,
  codecs, stripTrailingCommas, BACKUP_SUFFIX,
};
