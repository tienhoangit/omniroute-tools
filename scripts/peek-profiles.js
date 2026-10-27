// Print the 9Router codex profile files with secrets redacted.
const fs = require("fs"), os = require("os"), path = require("path");
for (const f of ["cf-glm-47-flash.config.toml", "nvidia.config.toml"]) {
  const t = fs.readFileSync(path.join(os.homedir(), ".codex", f), "utf8")
    .replace(/(Bearer\s+)\S+/g, "$1***")
    .replace(/((?:key|token)\s*=\s*")[^"]+/gi, "$1***");
  console.log("--", f); console.log(t);
}
