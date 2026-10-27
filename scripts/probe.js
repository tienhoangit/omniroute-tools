// Probe which router is listening and what /v1/models returns (no secrets printed).
const http = require("http");

function get(port, path) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path, timeout: 4000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ port, path, status: res.statusCode, body: body.slice(0, 300) }));
    });
    req.on("error", (e) => resolve({ port, path, error: e.code || e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ port, path, error: "timeout" }); });
  });
}

(async () => {
  for (const port of [20128, 20129]) {
    for (const p of ["/v1/models", "/api/health", "/health"]) {
      console.log(JSON.stringify(await get(port, p)));
    }
  }
})();
