const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const PORT = process.env.PORT || 9090;
const APIM_BASE = process.env.APIM_BASE_URL || "https://nc-comms-agent-dev-apim.azure-api.net";
const APIM_KEY = process.env.APIM_SUBSCRIPTION_KEY;

if (!APIM_KEY) {
  console.error("ERROR: Set APIM_SUBSCRIPTION_KEY environment variable before starting.");
  console.error("  export APIM_SUBSCRIPTION_KEY=your-key-here");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // Serve demo.html
  if (req.method === "GET" && (req.url === "/" || req.url === "/demo.html")) {
    const html = fs.readFileSync(path.join(__dirname, "docs", "html", "demo.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Proxy API calls: /api/* -> APIM (/api/clips/query -> /comms/clips/query)
  if (req.method === "POST" && req.url.startsWith("/api/")) {
    const apimPath = "/comms" + req.url.slice(4); // /api/clips/query -> /comms/clips/query
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const url = new URL(`${APIM_BASE}${apimPath}`);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Ocp-Apim-Subscription-Key": APIM_KEY,
        },
      };
      const proxyReq = https.request(options, (proxyRes) => {
        let data = "";
        proxyRes.on("data", (chunk) => { data += chunk; });
        proxyRes.on("end", () => {
          res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
          res.end(data);
        });
      });
      proxyReq.on("error", (e) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      });
      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Demo server running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/demo.html`);
});
