import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd());
const port = Number(process.env.PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    const requested = pathname === "/" ? "/index.html" : pathname;
    const target = resolve(
      join(root, normalize(requested).replace(/^(\.\.[/\\])+/, "")),
    );
    if (!target.startsWith(`${root}/`) && target !== root) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) {
      throw new Error("Not a file");
    }
    response.writeHead(200, {
      "Content-Type": types[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    createReadStream(target).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pulse Trace running at http://127.0.0.1:${port}`);
});
