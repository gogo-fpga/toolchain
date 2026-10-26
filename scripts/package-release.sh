#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <version>\n' "${0##*/}" >&2
  exit 2
}

[[ $# == 1 ]] || usage
version="$1"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || usage

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_dir="$root/release"
web_name="toolchain-web-$version"
source_name="toolchain-source-$version"
web_archive="$web_name.zip"
source_archive="$source_name.tar.gz"
submodules=(
  vendor/emsdk
  vendor/libftdi
  vendor/libusb
  vendor/openFPGALoader
  vendor/yomiyasu
  vendor/zlib
)

for tool in git tar gzip zip sha256sum python3 find sort touch chmod cp xargs; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required release tool not found: %s\n' "$tool" >&2
    exit 1
  fi
done

required_files=(
  "$root/dist/build-info.json"
  "$root/dist/openFPGALoader.mjs"
  "$root/dist/openFPGALoader.wasm"
  "$root/dist/serve.py"
  "$root/README.md"
  "$root/LICENSE"
  "$root/NOTICE"
  "$root/THIRD_PARTY_NOTICES.md"
)
for required_file in "${required_files[@]}"; do
  if [[ ! -f "$required_file" ]]; then
    printf 'Required release file is missing: %s\n' "$required_file" >&2
    exit 1
  fi
done

python3 "$root/scripts/build-info.py" check-artifacts \
  --root "$root" \
  --artifacts "$root/dist"

commit="$(git -C "$root" rev-parse HEAD)"
source_date_epoch="$(git -C "$root" log -1 --format=%ct)"
emsdk_version="$(git -C "$root/vendor/emsdk" describe --tags --exact-match)"
export SOURCE_DATE_EPOCH="$source_date_epoch"
mkdir -p "$release_dir"
work="$(mktemp -d "$release_dir/.package.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
web_root="$work/$web_name"
source_root="$work/$source_name"
mkdir -p "$web_root" "$web_root/licenses" "$source_root"
cp -R "$root/dist/." "$web_root/"
cp "$root/README.md" "$root/LICENSE" "$root/NOTICE" \
  "$root/THIRD_PARTY_NOTICES.md" "$web_root/"

emscripten_root="$root/build/emsdk-$emsdk_version/upstream/emscripten"
license_copies=(
  "$root/vendor/openFPGALoader/LICENSE:openFPGALoader-LICENSE"
  "$root/vendor/libusb/COPYING:libusb-COPYING"
  "$root/vendor/libftdi/COPYING.LIB:libftdi-COPYING.LIB"
  "$root/vendor/zlib/LICENSE:zlib-LICENSE"
  "$emscripten_root/LICENSE:emscripten-LICENSE"
  "$emscripten_root/system/lib/libc/musl/COPYRIGHT:emscripten-musl-COPYRIGHT"
  "$emscripten_root/system/lib/libcxx/LICENSE.TXT:emscripten-libcxx-LICENSE.TXT"
  "$emscripten_root/system/lib/libcxxabi/LICENSE.TXT:emscripten-libcxxabi-LICENSE.TXT"
  "$emscripten_root/system/lib/llvm-libc/LICENSE.TXT:emscripten-llvm-libc-LICENSE.TXT"
  "$emscripten_root/system/lib/compiler-rt/LICENSE.TXT:emscripten-compiler-rt-LICENSE.TXT"
  "$emscripten_root/system/lib/libunwind/LICENSE.TXT:emscripten-libunwind-LICENSE.TXT"
)
for entry in "${license_copies[@]}"; do
  source_file="${entry%%:*}"
  destination_name="${entry#*:}"
  if [[ ! -f "$source_file" ]]; then
    printf 'Required license file is missing: %s\n' "$source_file" >&2
    exit 1
  fi
  cp "$source_file" "$web_root/licenses/$destination_name"
done

symlink_file="$(find "$web_root" -type l -print -quit)"
if [[ -n "$symlink_file" ]]; then
  printf 'Release web tree must not contain symbolic links.\n' >&2
  exit 1
fi
find "$web_root" -type d -exec chmod 755 {} +
find "$web_root" -type f -exec chmod 644 {} +
find "$web_root" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
(
  cd "$work"
  find "$web_name" -print | LC_ALL=C sort | TZ=UTC zip -X -q "$release_dir/$web_archive" -@
)

git -C "$root" archive --format=tar HEAD | tar -xf - -C "$source_root"
submodule_lines="$(git -C "$root" ls-tree HEAD -- "${submodules[@]}")"
declare -A submodule_shas=()
while IFS=$'\t' read -r metadata path; do
  [[ -n "$metadata" ]] || continue
  read -r mode object_type sha <<< "$metadata"
  if [[ "$mode" != 160000 || "$object_type" != commit ]]; then
    printf 'Expected a gitlink for %s\n' "$path" >&2
    exit 1
  fi
  submodule_shas["$path"]="$sha"
  mkdir -p "$source_root/$path"
  git -C "$root/$path" archive --format=tar "$sha" | tar -xf - -C "$source_root/$path"
done <<< "$submodule_lines"
for path in "${submodules[@]}"; do
  if [[ -z "${submodule_shas[$path]:-}" ]]; then
    printf 'Missing submodule gitlink: %s\n' "$path" >&2
    exit 1
  fi
done

python3 - "$root" "$source_root/RELEASE-SOURCE.json" "$version" "$commit" \
  "$source_date_epoch" "$emsdk_version" "${submodules[@]}" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
output = Path(sys.argv[2])
version, commit, source_date_epoch, emsdk_version = sys.argv[3:7]
submodules = sys.argv[7:]
submodule_shas = {}
for path in submodules:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-tree", "HEAD", "--", path],
        check=True,
        capture_output=True,
        text=True,
    )
    line = result.stdout.strip()
    metadata, actual_path = line.split("\t", 1)
    mode, object_type, sha = metadata.split()
    if mode != "160000" or object_type != "commit" or actual_path != path:
        raise SystemExit(f"Expected a gitlink for {path}")
    submodule_shas[path] = sha

data = {
    "version": version,
    "commit": commit,
    "submodule_shas": submodule_shas,
    "emsdk_version": emsdk_version,
    "source_date_epoch": int(source_date_epoch),
}
output.write_text(f"{json.dumps(data, indent=2, sort_keys=True)}\n", encoding="utf-8")
PY
chmod 644 "$source_root/RELEASE-SOURCE.json"

(
  cd "$work"
  find "$source_name" -print0 | LC_ALL=C sort -z > "$work/$source_name-files.list"
  LC_ALL=C tar \
    --sort=name \
    --no-recursion \
    --null \
    --files-from="$work/$source_name-files.list" \
    --mtime="@$SOURCE_DATE_EPOCH" \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    --format=gnu \
    --no-acls \
    --no-selinux \
    --no-xattrs \
    -cf "$work/$source_name.tar"
)
TZ=UTC gzip -n -9 -c "$work/$source_name.tar" > "$release_dir/$source_archive"

python3 - "$root" "$root/dist/build-info.json" "$release_dir/notes.md" "$version" \
  "$commit" "$emsdk_version" "${submodules[@]}" <<'PY'
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
build_info_path = Path(sys.argv[2])
notes_path = Path(sys.argv[3])
version, commit, emsdk_version = sys.argv[4:7]
source_name = f"toolchain-source-{version}"
submodules = sys.argv[7:]
build_info = json.loads(build_info_path.read_text(encoding="utf-8"))
labels = {
    "vendor/openFPGALoader": "openFPGALoader",
    "vendor/libusb": "libusb",
    "vendor/libftdi": "libftdi",
    "vendor/zlib": "zlib",
    "vendor/emsdk": "emsdk",
    "vendor/yomiyasu": "yomiyasu",
}
rows = []
for path in submodules:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-tree", "HEAD", "--", path],
        check=True,
        capture_output=True,
        text=True,
    )
    metadata, actual_path = result.stdout.strip().split("\t", 1)
    mode, object_type, sha = metadata.split()
    if mode != "160000" or object_type != "commit" or actual_path != path:
        raise SystemExit(f"Expected a gitlink for {path}")
    if path == "vendor/emsdk":
        pinned_version = emsdk_version
    elif path == "vendor/libftdi":
        cmake = (root / path / "CMakeLists.txt").read_text(encoding="utf-8")
        major = re.search(r"set\(MAJOR_VERSION\s+([0-9]+)\)", cmake)
        minor = re.search(r"set\(MINOR_VERSION\s+([0-9]+)\)", cmake)
        suffix = re.search(
            r"set\(VERSION_STRING\s+\$\{MAJOR_VERSION\}\.\$\{MINOR_VERSION\}([A-Za-z0-9.]*)\)",
            cmake,
        )
        if not major or not minor or not suffix:
            raise SystemExit(f"Could not read libftdi version from {path}/CMakeLists.txt")
        pinned_version = f"{major.group(1)}.{minor.group(1)}{suffix.group(1)}"
    else:
        tag = subprocess.run(
            ["git", "-C", str(root / path), "describe", "--tags", "--exact-match"],
            check=False,
            capture_output=True,
            text=True,
        )
        pinned_version = tag.stdout.strip() if tag.returncode == 0 else "commit-pinned"
    rows.append(f"| {labels[path]} | {pinned_version} | `{sha}` |")

text = [
    f"# 午後のFPGA Web Toolchain {version}",
    "",
    f"- Commit: `{commit}`",
    f"- emcc: `{build_info['emcc_version']}`",
    f"- `openFPGALoader.wasm` SHA-256: `{build_info['artifacts']['openFPGALoader.wasm']}`",
    f"- `openFPGALoader.mjs` SHA-256: `{build_info['artifacts']['openFPGALoader.mjs']}`",
    "",
    "## vendor の固定版",
    "",
    "| 部品 | version / tag | commit |",
    "|---|---|---|",
    *rows,
    "",
    "## 使い方",
    "",
    "1. `toolchain-web-<version>.zip` をダウンロードして展開します。",
    "2. 展開先で `python3 serve.py` を実行します。",
    "3. 表示された URL を Chrome または Edge で開きます。",
    "",
    "WebUSB と JSPI を利用するため、対応する Chromium 系ブラウザーが必要です。",
    "実機の Tang Nano では試していません。",
    "",
    "部品ごとのライセンスは `THIRD_PARTY_NOTICES.md` を参照してください。",
    f"対応するソースは `{source_name}.tar.gz` です。",
    "",
]
notes_path.write_text("\n".join(text), encoding="utf-8")
PY

printf '%s\n' "$source_archive" "$web_archive" |
  LC_ALL=C sort |
  (cd "$release_dir" && xargs sha256sum) > "$release_dir/SHA256SUMS"
printf 'Created release files in %s\n' "$release_dir"
