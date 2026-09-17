# ffmpeg-core-st

Fork of [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) that builds the
single-threaded WASM core shipped by [StickerProcess](https://github.com/TheFunny/StickerProcess).

Everything is on the branch **`st-core`** (= upstream `f876f907c7e9b9bf51d4ed0b913a855a63ae63fc`,
the source of `@ffmpeg/core@0.12.10`, plus the changes below). `main` is untouched upstream.

## What this fork changes

| Change | Why |
|---|---|
| `build/libvpx.sh`: `--enable-vp9-highbitdepth` | The prebuilt core falls back to 8-bit VP9 for `-pix_fmt yuv420p10`; StickerProcess relies on real 10-bit for its MP4 path. |
| `.github/workflows/build-core.yml` | Builds and publishes the core from CI instead of a local Docker/WSL session. |
| `test/smoke/` | Headless-Chromium check that the built core actually encodes 10-bit VP9 (and that a GIF encode afterwards still works). |

That is the whole diff — the Dockerfile, the 16 library build scripts and the
ffmpeg/ffmpeg-wasm stages are upstream's.

## Releases

`.github/workflows/build-core.yml` (Actions → *Build ST core* → *Run workflow*, with a tag such as
`st-core-v1`) publishes a release containing:

- `ffmpeg-core-st.js` — the UMD loader (`dist/umd/ffmpeg-core.js`)
- `ffmpeg-core-st.wasm` — the loader's wasm, after `wasm-opt -Oz --strip-debug`
- `SHA256SUMS.txt` — hashes; consumers pin these

The same two files plus `SHA256SUMS.txt` are also kept as workflow artifacts for debugging;
the unoptimized `dist/` build is not published.

Build knobs (pinned in the workflow): `emscripten/emsdk:3.1.40`, binaryen `version_132`,
`FFMPEG_ST=yes`, `EXTRA_CFLAGS="-O3 -msimd128"`, FFmpeg `n5.1.4`.

A cold build takes tens of minutes on the 4-vCPU runner; the buildx layer cache
(`actions/cache`, keyed on `Dockerfile`/`Makefile`/`build/*`) makes later builds skip the
unchanged library stages.

## Consuming it

```bash
tag=st-core-v1
curl -fsSLO "https://github.com/TheFunny/ffmpeg-core-st/releases/download/$tag/ffmpeg-core-st.js"
curl -fsSLO "https://github.com/TheFunny/ffmpeg-core-st/releases/download/$tag/ffmpeg-core-st.wasm"
curl -fsSLO "https://github.com/TheFunny/ffmpeg-core-st/releases/download/$tag/SHA256SUMS.txt"
sha256sum -c SHA256SUMS.txt
```

StickerProcess does exactly this in `scripts/fetch-ffmpeg-core.sh`, with the tag and hashes
pinned in that script — update them when you publish a new core.

## Local smoke test

```bash
cd test/smoke && npm install && npx playwright install --with-deps chromium && node run.mjs
```

Requires a build in `out/` (`ffmpeg-core-st.js` + `ffmpeg-core-st.wasm`) and `ffprobe` on `PATH`.

## License

Upstream is MIT. The core binaries are GPL v3: FFmpeg is configured with `--enable-gpl` and
links x264/x265. The exact source for a published binary is this repository at the commit
named in that release's notes, plus the upstream project.
