#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_root="${BUILD_ROOT:-$root/build}"
if [[ ! -x "$root/node_modules/.bin/esbuild" ]]; then
  printf 'Missing esbuild. Run npm ci before scripts/build-web.sh.\n' >&2
  exit 1
fi
if [[ "$build_root" != /* ]]; then
  build_root="$root/$build_root"
fi
artifacts="$build_root/jspi-pthread"
dist="$root/dist"
cd "$root"

case "${BUILD_INFO_CHECK:-full}" in
  full)
    build_info_action=check
    ;;
  artifacts)
    build_info_action=check-artifacts
    ;;
  *)
    printf 'Unsupported BUILD_INFO_CHECK value: %s\n' "$BUILD_INFO_CHECK" >&2
    exit 1
    ;;
esac

for artifact in openFPGALoader.mjs openFPGALoader.wasm; do
  if [[ ! -s "$artifacts/$artifact" ]]; then
    printf 'Missing required C-profile artifact: %s\n' "$artifacts/$artifact" >&2
    exit 1
  fi
done
for decoder in zstd-decoder.wasm xz-decoder.wasm; do
  if [[ ! -s "$build_root/wasi/decoders/$decoder" ]]; then
    printf 'Missing required WASI decoder: %s\n' "$build_root/wasi/decoders/$decoder" >&2
    exit 1
  fi
done

python3 "$root/scripts/build-info.py" "$build_info_action" \
  --root "$root" \
  --artifacts "$artifacts"

if [[ ! -f "$root/web/index.html" || ! -f "$root/web/serve.py" ]]; then
  printf 'Missing web application sources under %s/web\n' "$root" >&2
  exit 1
fi

rm -rf -- "$dist"
mkdir -p "$dist"
cp -R "$root/web/." "$dist/"
node_modules/.bin/esbuild web/editor/editor.mjs --bundle --minify --format=esm --outfile="$dist/editor/editor.bundle.mjs"
node_modules/.bin/esbuild web/lib/project-zip.mjs --bundle --minify --format=esm --outfile="$dist/lib/project-zip.bundle.mjs"
cp "$artifacts/openFPGALoader.mjs" "$dist/openFPGALoader.mjs"
cp "$artifacts/openFPGALoader.wasm" "$dist/openFPGALoader.wasm"
cp "$artifacts/build-info.json" "$dist/build-info.json"
mkdir -p "$dist/lib/decoders"
cp "$build_root/wasi/decoders/zstd-decoder.wasm" "$dist/lib/decoders/"
cp "$build_root/wasi/decoders/xz-decoder.wasm" "$dist/lib/decoders/"
scripts/build-pack-assets.sh --dist-output "$dist/pack"
python3 "$root/scripts/build-synth-assets.py" \
  --output "$build_root/synth" \
  --dist-output "$dist/synth"
python3 "$root/scripts/check-dist-size.py" "$dist"

printf 'Assembled web app in %s from %s\n' "$dist" "$artifacts"
