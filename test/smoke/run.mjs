// Smoke test for the freshly built core (run from test/smoke, after `npm install`).
//
// It serves out/ the way the app's static host does, loads out/ffmpeg-core-st.js
// through the shipped @ffmpeg/ffmpeg wrapper in headless Chromium, and asserts
// the two things that make this fork worth building:
//
//   1. MP4 → VP9 keeps 10 bit (the prebuilt @ffmpeg/core silently falls back to
//      yuv420p) and does not crash the core (it used to read out of bounds and
//      wedge the instance).
//   2. GIF → alpha still encodes (the alpha_mode tag, not the base pix_fmt) on
//      the same instance, after that MP4 encode.
//
// Exit code 0 = both webm outputs carry the expected stream properties.

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const out = path.join(root, "out");
const artifacts = path.join(root, "smoke-out");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".gif": "image/gif",
};

// Serve out/ the way the app's host does (relative paths, no COOP/COEP: the ST
// core needs neither).
async function serve() {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.join(out, rel === "/" ? "harness.html" : rel);
    if (!file.startsWith(out)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Content-Length": body.length,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function probe(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=pix_fmt:stream_tags=alpha_mode",
    "-of", "default=nw=1", file,
  ]);
  const fields = {};
  for (const line of stdout.trim().split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return fields;
}

async function main() {
  await rm(artifacts, { recursive: true, force: true });
  await mkdir(artifacts, { recursive: true });

  // Stage the page, the core and the fixtures the way the deployed site has them.
  const umd = path.join(here, "node_modules", "@ffmpeg", "ffmpeg", "dist", "umd");
  await cp(path.join(here, "harness.html"), path.join(out, "harness.html"));
  await cp(path.join(umd, "ffmpeg.js"), path.join(out, "ffmpeg.js"));
  await cp(path.join(umd, "814.ffmpeg.js"), path.join(out, "814.ffmpeg.js"));
  await cp(path.join(here, "fixtures"), path.join(out, "fixtures"), { recursive: true });

  const { server, port } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(300_000);
    page.on("pageerror", (e) => console.log("[page error]", String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") console.log("[page console]", m.text());
    });

    await page.goto(`http://127.0.0.1:${port}/harness.html`);
    const result = await page.evaluate(() => window.__smoke);
    console.log(`browser: ${result.agent}`);

    // VP9 alpha in WebM lives in a side channel: the base stream still reports
    // yuv420p, the marker is the alpha_mode tag.
    for (const [key, file, expect] of [
      ["mp4", "mp4-10bit.webm", { pix_fmt: "yuv420p10le" }],
      ["gif", "gif-alpha.webm", { alpha_mode: "1" }],
    ]) {
      const res = result[key];
      assert.ok(!res.error, `${key}: ${res.error}`);
      assert.equal(res.code, 0, `${key}: ffmpeg exited with ${res.code}`);
      assert.ok(res.size > 1000, `${key}: output is only ${res.size} bytes`);
      const target = path.join(artifacts, file);
      await writeFile(target, Buffer.from(res.b64, "base64"));
      const fields = await probe(target);
      for (const [field, want] of Object.entries(expect)) {
        assert.equal(fields[field], want,
          `${key}: expected ${field}=${want}, ffprobe reports ${fields[field] ?? "(none)"}`);
      }
      console.log(`ok  ${key}: ${res.size} bytes, ${JSON.stringify(fields)}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

try {
  await main();
  console.log("smoke test passed");
} catch (err) {
  console.error("smoke test FAILED");
  console.error(err);
  process.exit(1);
}
