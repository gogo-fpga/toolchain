#!/usr/bin/env bash
# Adapted from synth-explorer/tools/ghdl-wasm/build-in-container.sh.
# Copyright 2025 synth-explorer contributors.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# https://www.apache.org/licenses/LICENSE-2.0
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

readonly ghdl_pin=e589c698c351369ac5bcfe7abe1f1152ac5d4727
readonly browser_pin=e98e5a6c6fd6c48a789705ae9900c6b34b3cb414
readonly gcc_pin=ed10445fe222d3973ae13eda9bf211f315c5e3f9
readonly adawebpack_version=24.0.0
readonly adawebpack_sha256=8edaae8b9987a20aec430d750f30033f12f953ce2b6437afb87fbf8cc1063796
readonly libxml2_sha256=c5a065f85c1e6f605741e365e40cad71c3ceb0e85e2791400bd35b8896e12ad1
readonly libicu74_sha256=c9a70989678660eed9a1e904c74fa043da8bec8e2036856fc16e31ced79b04f8

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
build_root=${GHDL_WASM_BUILD_ROOT:-"$root/build"}
case "$build_root" in
  /*) ;;
  *) build_root="$root/$build_root" ;;
esac
mkdir -p "$build_root"
build_root=$(CDPATH='' cd -- "$build_root" && pwd)
case "$build_root" in
  "$root"/build|"$root"/build/*) ;;
  *)
    printf 'GHDL_WASM_BUILD_ROOT must be inside %s/build\n' "$root" >&2
    exit 2
    ;;
esac

readonly cache_root="$root/build/cache/ghdl-wasm"
readonly host_package_cache="$root/build/cache/ghdl-host-packages"
readonly host_tools="$root/build/host-tools"
readonly host_lib_dir="$host_tools/usr/lib/x86_64-linux-gnu"
readonly ada_lib_dir="$host_tools/adawebpack-libs/usr/lib/x86_64-linux-gnu"
readonly work_dir="$build_root/ghdl-wasm-work"
readonly native_build="$build_root/ghdl-native-build"
readonly native_prefix="$build_root/ghdl-native"
readonly output_dir="$build_root/ghdl-wasm"
readonly sdk_dir="${WASI_SDK_DIR:-$root/build/wasi-sdk-34.0-x86_64-linux}"
readonly adawebpack_archive="$host_package_cache/adawebpack-$adawebpack_version.tar.gz"
readonly gcc_source="$cache_root/gcc-libgnat"
readonly jobs=${JOBS:-${GHDL_WASM_JOBS:-2}}

for tool in apt-get curl dpkg-deb file gcc gnatmake git gzip make patch python3 sha256sum tar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$tool" >&2
    exit 1
  fi
done
for tool in clang wasm-ld llvm-ar llvm-strip; do
  if [[ ! -x "$sdk_dir/bin/$tool" ]]; then
    printf 'Required WASI SDK tool is missing: %s/bin/%s\n' "$sdk_dir" "$tool" >&2
    exit 1
  fi
done
if [[ ! -f vendor/ghdl/configure || ! -f vendor/ghdl/src/synth/synthesis.adb ]]; then
  printf 'Initialize the pinned vendor/ghdl submodule before building.\n' >&2
  exit 1
fi
if [[ ! -f vendor/ghdl-browser/scripts/setup-frontend-build.sh ]]; then
  printf 'Initialize the pinned vendor/ghdl-browser submodule before building.\n' >&2
  exit 1
fi
if [[ $(git -C vendor/ghdl rev-parse HEAD) != "$ghdl_pin" ]]; then
  printf 'GHDL pin mismatch: expected %s\n' "$ghdl_pin" >&2
  exit 1
fi
if [[ $(git -C vendor/ghdl-browser rev-parse HEAD) != "$browser_pin" ]]; then
  printf 'ghdl-browser pin mismatch: expected %s\n' "$browser_pin" >&2
  exit 1
fi

mkdir -p "$cache_root" "$host_package_cache"
rm -rf "$work_dir" "$native_build" "$native_prefix" "$output_dir"
mkdir -p "$work_dir" "$native_build" "$output_dir" "$host_tools"
exec > >(tee "$output_dir/build.log") 2>&1
start_time=$(date +%s)

source_date_epoch=$(git -C vendor/ghdl show -s --format=%ct "$ghdl_pin")
export SOURCE_DATE_EPOCH="$source_date_epoch"
printf 'SOURCE_DATE_EPOCH=%s (GHDL %s)\n' "$SOURCE_DATE_EPOCH" "$ghdl_pin"

expected_package_version() {
  case "$1" in
    gprbuild|libgnatprj12) printf '%s' '2025.0.0-4build2' ;;
    gprconfig-kb) printf '%s' '25.0.0-2' ;;
    libxmlada-dom9|libxmlada-input8|libxmlada-sax8|libxmlada-schema8|libxmlada-unicode8)
      printf '%s' '25.0.0-4build2'
      ;;
    libgnat-14) printf '%s' '14.3.0-14ubuntu1' ;;
    *) return 1 ;;
  esac
}

expected_package_sha256() {
  case "$1" in
    gprbuild) printf '%s' ebf68e78caf320692fbae9c1cb58e8b365d989b66033f703e3224040691db9bb ;;
    gprconfig-kb) printf '%s' 4f3e254e1cae5c0edbc87f999144202d717ec828f4d07bd5cc0ddb31d01ccac0 ;;
    libgnat-14) printf '%s' d58050517bc1e289a879f4433eac71e8718c87143e9c860a5479e8aa92968012 ;;
    libgnatprj12) printf '%s' b57ab4d2bd90360966eb245ff464afd2145685802b6e8e56f7ecb806f59bb194 ;;
    libxmlada-dom9) printf '%s' 7b8773467a50b27bb9071f21e4a10b5c61a8bd0614d2bade32f45e57a91ed075 ;;
    libxmlada-input8) printf '%s' 30161cb121ee176ea0c5d37a9db2744dd91056f47f1ce75c2f4d54773d31f69b ;;
    libxmlada-sax8) printf '%s' aae83ba17f060d82a5c1e32432462470cc0a8bab1dfa45df58a816512d4c3a57 ;;
    libxmlada-schema8) printf '%s' b01d6d3ed8189a9902da2ba037599fbcb23cba3d553fa5b74d7741f64e299969 ;;
    libxmlada-unicode8) printf '%s' badb5d896cc19507c01996c71e54ff0beb83a8f30472a2c2bf15071f816e56f5 ;;
    *) return 1 ;;
  esac
}

installed_version() {
  local package=$1 status version
  status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
  if [[ "$status" != 'install ok installed' ]]; then
    return 1
  fi
  version=$(dpkg-query -W -f='${Version}' "$package")
  printf '%s' "$version"
}

download_package() {
  local package=$1 version expected_version expected_sha deb candidate_dir candidate sha
  expected_version=$(expected_package_version "$package" || true)
  expected_sha=$(expected_package_sha256 "$package" || true)
  if [[ -z "$expected_sha" ]]; then
    printf 'No SHA-256 pin is configured for downloadable host package %s\n' "$package" >&2
    return 1
  fi
  deb=
  for candidate in "$host_package_cache/${package}_"*.deb; do
    [[ -f "$candidate" ]] || continue
    if [[ $(dpkg-deb -f "$candidate" Package) == "$package" ]] &&
      { [[ -z "$expected_version" ]] || [[ $(dpkg-deb -f "$candidate" Version) == "$expected_version" ]]; }; then
      deb=$candidate
      break
    fi
  done
  if [[ -z "$deb" ]]; then
    candidate_dir=$(mktemp -d "$host_package_cache/download-${package}.XXXXXX")
    (cd "$candidate_dir" && apt-get download "$package")
    deb=$(find "$candidate_dir" -maxdepth 1 -type f -name '*.deb' -print -quit)
    if [[ -z "$deb" ]]; then
      printf 'apt-get download did not produce a .deb for %s\n' "$package" >&2
      return 1
    fi
    version=$(dpkg-deb -f "$deb" Version)
    if [[ -n "$expected_version" && "$version" != "$expected_version" ]]; then
      printf 'Unexpected %s version: expected %s, got %s\n' "$package" "$expected_version" "$version" >&2
      return 1
    fi
    cp "$deb" "$host_package_cache/"
    deb="$host_package_cache/$(basename "$deb")"
    rm -rf "$candidate_dir"
  fi
  version=$(dpkg-deb -f "$deb" Version)
  sha=$(sha256sum "$deb" | cut -d' ' -f1)
  if [[ -n "$expected_sha" && "$sha" != "$expected_sha" ]]; then
    printf 'SHA-256 mismatch for downloaded package: %s\n' "$deb" >&2
    return 1
  fi
  dpkg-deb -x "$deb" "$host_tools"
  printf 'downloaded\t%s\t%s\t%s\n' "$package" "$version" "$sha" >> "$work_dir/packages.tsv"
  printf 'apt package: %s %s sha256=%s\n' "$package" "$version" "$sha"
}

: > "$work_dir/packages.tsv"
for package in \
  gprbuild gprconfig-kb libgnat-14 libgnatprj12 libxmlada-dom9 libxmlada-input8 \
  libxmlada-sax8 libxmlada-schema8 libxmlada-unicode8; do
  if version=$(installed_version "$package"); then
    printf 'installed\t%s\t%s\t-\n' "$package" "$version" >> "$work_dir/packages.tsv"
    printf 'host package already installed: %s %s\n' "$package" "$version"
  else
    download_package "$package"
  fi
done

download_and_extract_pinned() {
  local url=$1 sha=$2 archive=$3 version=$4 expected_version=$5 destination=$6
  if [[ ! -f "$archive" ]]; then
    curl --fail --location --retry 3 --output "$archive.tmp" "$url"
    mv "$archive.tmp" "$archive"
  fi
  if ! printf '%s  %s\n' "$sha" "$archive" | sha256sum --check --status; then
    printf 'SHA-256 mismatch: %s\n' "$archive" >&2
    return 1
  fi
  if [[ $(dpkg-deb -f "$archive" Package) != "$version" ||
    $(dpkg-deb -f "$archive" Version) != "$expected_version" ]]; then
    printf 'Unexpected package metadata in %s\n' "$archive" >&2
    return 1
  fi
  dpkg-deb -x "$archive" "$destination"
  printf 'pinned package: %s %s sha256=%s\n' "$version" "$expected_version" "$sha"
}

readonly libxml2_archive="$host_package_cache/libxml2-noble.deb"
readonly libicu74_archive="$host_package_cache/libicu74-noble.deb"
download_and_extract_pinned \
  'https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/libxml2_2.9.14+dfsg-1.3ubuntu3.10_amd64.deb' \
  "$libxml2_sha256" "$libxml2_archive" libxml2 '2.9.14+dfsg-1.3ubuntu3.10' \
  "$host_tools/adawebpack-libs"
download_and_extract_pinned \
  'https://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu74_74.2-1ubuntu3.1_amd64.deb' \
  "$libicu74_sha256" "$libicu74_archive" libicu74 '74.2-1ubuntu3.1' \
  "$host_tools/adawebpack-libs"

if ! command -v gnatmake >/dev/null 2>&1; then
  printf 'GNAT is required for the native GHDL build.\n' >&2
  exit 1
fi

if [[ ! -f "$adawebpack_archive" ]]; then
  curl --fail --location --retry 3 --output "$adawebpack_archive.tmp" \
    "https://github.com/godunko/adawebpack/releases/download/$adawebpack_version/adawebpack-$adawebpack_version.tar.gz"
  mv "$adawebpack_archive.tmp" "$adawebpack_archive"
fi
if ! printf '%s  %s\n' "$adawebpack_sha256" "$adawebpack_archive" | sha256sum --check --status; then
  printf 'AdaWebPack archive SHA-256 mismatch: %s\n' "$adawebpack_archive" >&2
  exit 1
fi

readonly adawebpack_root="$work_dir/adawebpack"
readonly adawebpack="$adawebpack_root/adawebpack"
mkdir -p "$adawebpack_root"
tar -xzf "$adawebpack_archive" -C "$adawebpack_root"
if [[ ! -x "$adawebpack/bin/llvm-gcc" || ! -f "$adawebpack/lib/gnat/adawebpack_config.gpr" ]]; then
  printf 'AdaWebPack extraction is incomplete.\n' >&2
  exit 1
fi

source_date_year=$(date -u -d "@$SOURCE_DATE_EPOCH" +%Y)
readonly source_date_year
library_timestamp="$(date -u -d "@$SOURCE_DATE_EPOCH" +%Y%m%d%H%M%S).000"
readonly library_timestamp
if (( source_date_year < 2000 || source_date_year > 2099 )); then
  printf 'SOURCE_DATE_EPOCH year is outside GHDL Filesystem range: %s\n' \
    "$source_date_year" >&2
  exit 1
fi
if [[ ! -d "$gcc_source/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/gcc-mirror/gcc.git "$gcc_source"
  git -C "$gcc_source" sparse-checkout init --cone
  git -C "$gcc_source" sparse-checkout set gcc/ada/libgnat
fi
git -C "$gcc_source" fetch --quiet --depth=1 origin "$gcc_pin"
git -C "$gcc_source" checkout --quiet --detach "$gcc_pin"
gcc_commit=$(git -C "$gcc_source" rev-parse "$gcc_pin^{commit}")
if [[ $(git -C "$gcc_source" rev-parse HEAD) != "$gcc_commit" ]]; then
  printf 'GCC libgnat source pin mismatch: expected peeled commit %s.\n' "$gcc_commit" >&2
  exit 1
fi

readonly ghdl_source="$root/vendor/ghdl"
readonly browser_copy="$work_dir/ghdl-browser"
mkdir -p "$browser_copy"
git -C vendor/ghdl-browser archive --format=tar "$browser_pin" | tar -xf - -C "$browser_copy"
mkdir -p "$browser_copy/vendor/adawebpack-bin"
ln -s "$adawebpack" "$browser_copy/vendor/adawebpack-bin/adawebpack"
ln -s "$ghdl_source" "$browser_copy/vendor/ghdl"
# shellcheck disable=SC2016
sed -i \
  's|GCC_ADA="/usr/lib/gcc/x86_64-linux-gnu/14/adainclude/"|GCC_ADA="${GCC_ADA_SOURCE:?}"|' \
  "$browser_copy/scripts/setup-frontend-build.sh"
export GCC_ADA_SOURCE="$gcc_source/gcc/ada/libgnat"

prefix_flags="-ffile-prefix-map=$root=/src -ffile-prefix-map=$build_root=/build"
prefix_args=("-ffile-prefix-map=$root=/src" "-ffile-prefix-map=$build_root=/build")
(
  cd "$native_build"
  CC=gcc \
    CFLAGS="-g -O $prefix_flags" \
    ADA_FLAGS="-O $prefix_flags" \
    SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
    "$ghdl_source/configure" --prefix="$native_prefix"
  SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" make -j"$jobs"
  SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" make install
)
if [[ ! -x "$native_prefix/bin/ghdl" || ! -d "$native_prefix/lib/ghdl" ]]; then
  printf 'Native GHDL build did not install the binary and libraries.\n' >&2
  exit 1
fi
printf 'native GHDL: %s\n' "$("$native_prefix/bin/ghdl" --version | head -n 1)"

for tool in gcc gnat gnatbind gnatlink gnatls gnatmake gnatchop gnatname gnatprep gnatclean gnatkr; do
  # shellcheck disable=SC2016
  printf '#!/usr/bin/env bash\nLD_LIBRARY_PATH="${GHDL_WASM_ADAWP_LD_LIBRARY_PATH}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" exec "$(dirname "$0")/llvm-%s" "$@"\n' \
    "$tool" > "$adawebpack/bin/llvm-$tool-14"
  chmod +x "$adawebpack/bin/llvm-$tool-14"
done

export PATH="$adawebpack/bin:$host_tools/usr/bin:$sdk_dir/bin:$PATH"
export GPR_PROJECT_PATH="$adawebpack/lib/gnat"
export GHDL_WASM_ADAWP_LD_LIBRARY_PATH="$ada_lib_dir:$host_lib_dir"
gprbuild_bin=$(command -v gprbuild || true)
if [[ -n "$gprbuild_bin" ]]; then
  gprbuild_lib_path="$host_lib_dir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
else
  gprbuild_bin="$host_tools/usr/bin/gprbuild"
  gprbuild_lib_path="$host_lib_dir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
if [[ ! -x "$gprbuild_bin" ]]; then
  printf 'gprbuild is unavailable after package extraction.\n' >&2
  exit 1
fi

rm -f "$browser_copy/patches/dyn_htables.patch"
(
  cd "$browser_copy"
  bash scripts/setup-frontend-build.sh
)
readonly frontend="$browser_copy/build/ghdl-wasm-full"
readonly stub_ada="$adawebpack/lib/rts-native/adainclude"
readonly ghdl_libgnat="$gcc_source/gcc/ada/libgnat"

rm -f "$frontend"/trans*.ad? "$frontend"/translation.ad? "$frontend"/ortho_wasm*.ad?
rm -f "$frontend"/ortho_front.ad? "$frontend"/ortho_nodes.ad?
rm -f "$frontend"/ghdlsynth.ad? "$frontend"/ghdlsynth_maybe.ad?
rm -f "$frontend"/libghdl.ad? "$frontend"/ortho_ident.ad?
cp "$ghdl_source/src/synth/synthesis.ads" "$ghdl_source/src/synth/synthesis.adb" "$frontend/"
cp "$ghdl_source/src/libraries.ads" "$ghdl_source/src/libraries.adb" "$frontend/"
rm -f "$frontend"/verilog*.ad? "$frontend"/synth-verilog*.ad?
patch --directory "$frontend" --strip=0 < "$root/patches/ghdl/vhdl-only-synthesis.patch"
patch --directory "$frontend" --strip=0 < "$root/patches/ghdl/dyn-htables-v6.patch"

for unit in \
  grt-types.ads grt-c.ads grt-vhdl_types.ads grt-stdio.ads grt-severity.ads \
  grt-asserts.ads grt-asserts.adb \
  grt-fcvt.ads grt-fcvt.adb grt-to_strings.ads grt-to_strings.adb \
  grt-files.ads grt-files.adb grt-files_operations.ads grt-files_operations.adb \
  grt-table.ads grt-table.adb grt-arith.ads grt-arith.adb \
  grt-algos.ads grt-algos.adb grt-astdio.ads grt-astdio.adb \
  grt-strings.ads grt-strings.adb grt-vstrings.ads grt-vstrings.adb \
  grt-rstrings.ads grt-rstrings.adb grt-dynload.ads; do
  cp "$ghdl_source/src/grt/$unit" "$frontend/"
done
cp "$ghdl_source/src/grt/grt-readline_none.ads" \
  "$ghdl_source/src/grt/grt-readline_none.adb" "$frontend/"
cp "$root/scripts/ghdl-wasm/synth-vhdl_foreign.adb" "$frontend/"
cp "$native_build/grt-readline.ads" "$frontend/"
patch --directory "$frontend" --strip=0 < "$root/patches/ghdl/grt-stdio.patch"
patch --directory "$frontend" --strip=0 < "$root/patches/ghdl/blackbox-verilog.patch"
cp "$root/scripts/ghdl-wasm/grt-stdio.adb" "$frontend/"
cp "$root/scripts/ghdl-wasm/bug.adb" "$frontend/"
cp "$root/scripts/ghdl-wasm/version.ads" "$frontend/"
cp "$root/scripts/ghdl-wasm/synth_api.ads" \
  "$root/scripts/ghdl-wasm/synth_api.adb" "$frontend/"

runtime_source_units=(
  a-chahan.ads a-chahan.adb a-chlat1.ads a-strmap.ads a-strmap.adb a-stmaco.ads
  s-bitops.ads s-bitops.adb s-bytswa.ads s-imglli.ads s-imglli.adb s-vs_lli.ads
  s-expont.ads s-expont.adb s-explli.ads s-explli.adb
  s-vallli.ads s-vallli.adb s-valllli.ads s-vallllu.ads s-valllf.ads
  g-sechas.ads g-sechas.adb g-sehash.ads g-sehash.adb
  g-sha1.ads g-sha1.adb g-bytswa.ads g-bytswa.adb g-hesora.ads g-hesora.adb
)
for unit in "${runtime_source_units[@]}"; do
  cp "$ghdl_libgnat/$unit" "$stub_ada/"
done
sed -i "s/1970/$source_date_year/g" "$stub_ada/a-calend.adb"
sed -i '/function Swap128/,/end Swap128;/d' "$stub_ada/g-bytswa.adb"
sed -i '/function Swap128/d' "$stub_ada/g-bytswa.ads"
sed -i '/subtype U128/d;/function Bswap_128/d;/__builtin_bswap128/d' "$stub_ada/s-bytswa.ads"

readonly stub_objects="$frontend/.objs/stubali"
mkdir -p "$stub_objects"
(
  cd "$stub_objects"
  for unit in \
    i-c i-cstrea gnat a-calend a-catizo a-comlin a-strunb g-dirope g-os_lib \
    a-chahan a-chlat1 a-strmap a-stmaco s-bitops s-bytswa s-imglli s-vs_lli \
    s-expont s-explli s-vallli g-sechas g-sehash g-sha1 g-bytswa g-hesora; do
    source="$stub_ada/$unit.ads"
    if [[ -f "$stub_ada/$unit.adb" ]]; then
      source="$stub_ada/$unit.adb"
    fi
    env LD_LIBRARY_PATH="$GHDL_WASM_ADAWP_LD_LIBRARY_PATH" \
      "$adawebpack/bin/llvm-gcc" -c --target=wasm32 -O1 "${prefix_args[@]}" \
      -gnatg -gnatyN -gnatws -I"$stub_ada" "$source"
  done
)

cat > "$frontend/ghdl_wasm.gpr" <<EOF
with "adawebpack_config.gpr";

project Ghdl_Wasm is
   for Target use "llvm";
   for Source_Dirs use (".");
   for Object_Dir use ".objs";
   for Library_Name use "ghdl_wasm";
   for Library_Dir use "lib";
   for Library_Kind use "static";

   package Compiler is
      for Switches ("Ada") use
        ("--target=wasm32", "-O1", "-ffile-prefix-map=$root=/src",
         "-ffile-prefix-map=$build_root=/build", "-I$stub_objects");
   end Compiler;
end Ghdl_Wasm;
EOF

(
  cd "$frontend"
  env PATH="$PATH" LD_LIBRARY_PATH="$gprbuild_lib_path" \
    GHDL_WASM_ADAWP_LD_LIBRARY_PATH="$GHDL_WASM_ADAWP_LD_LIBRARY_PATH" \
    GPR_PROJECT_PATH="$GPR_PROJECT_PATH" \
    "$gprbuild_bin" -p -P ghdl_wasm.gpr -j"$jobs"
)

mapfile -t ali_files < <(find "$frontend/.objs" -maxdepth 1 -name '*.ali' -print | sort)
if [[ ${#ali_files[@]} -eq 0 ]]; then
  printf 'GPR build produced no Ada library information files.\n' >&2
  exit 1
fi
(
  cd "$frontend/.objs"
  env LD_LIBRARY_PATH="$GHDL_WASM_ADAWP_LD_LIBRARY_PATH" \
    "$adawebpack/bin/llvm-gnatbind" -n -Lghdlwasm_ -o b_ghdlwasm.adb \
    -aO"$stub_objects" "${ali_files[@]}"
  env LD_LIBRARY_PATH="$GHDL_WASM_ADAWP_LD_LIBRARY_PATH" \
    "$adawebpack/bin/llvm-gcc" -c --target=wasm32 -O1 "${prefix_args[@]}" \
    -gnatg -gnatyN -gnatws -I"$stub_ada" -I"$stub_objects" \
    -I"$adawebpack/lib/rts-native/adalib" b_ghdlwasm.adb
)

readonly gnat_objects="$work_dir/libgnat-wasm-objs"
mkdir -p "$gnat_objects"
(
  cd "$gnat_objects"
  "$sdk_dir/bin/llvm-ar" x "$adawebpack/lib/rts-native/adalib/libgnat.a"
  for object in *.o; do
    file "$object" | grep -q WebAssembly || rm -f "$object"
  done
  "$sdk_dir/bin/llvm-ar" rcs libgnat_wasm.a ./*.o
)

extra_objects=()
while IFS= read -r object; do
  if file "$object" | grep -q WebAssembly; then
    extra_objects+=("$object")
  fi
done < <(find "$stub_objects" -name '*.o' ! -name 'g-os_lib.o' -print | sort)
"$sdk_dir/bin/clang" --target=wasm32 -nostdlib \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--export-memory \
  -Wl,--export=malloc -Wl,--export=free -Wl,--export=__wasm_call_ctors \
  -Wl,--export=ghdlwasm_init \
  -Wl,--export=synth_api__synth_init \
  -Wl,--export=synth_api__analyze_file \
  -Wl,--export=synth_api__synth_top \
  -Wl,--whole-archive \
    "$frontend/lib/libghdl_wasm.a" \
    "$gnat_objects/libgnat_wasm.a" \
  -Wl,--no-whole-archive \
  "${extra_objects[@]}" \
  "$frontend/.objs/b_ghdlwasm.o" \
  -o "$work_dir/ghdl-synth.unstripped.wasm"
"$sdk_dir/bin/llvm-strip" --strip-all \
  -o "$output_dir/ghdl-synth.wasm" "$work_dir/ghdl-synth.unstripped.wasm"

library_stage="$work_dir/libraries"
mkdir -p "$library_stage"
cp -a "$native_prefix/lib/ghdl/." "$library_stage/"
normalized_catalogs=$(python3 - "$library_stage" "$library_timestamp" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
timestamp = sys.argv[2]
total = 0
for catalog in root.rglob("*.cf"):
    content = catalog.read_text(encoding="utf-8")
    normalized, count = re.subn(r'"[0-9]{14}\.[0-9]+"', f'"{timestamp}"', content)
    if count:
        catalog.write_text(normalized, encoding="utf-8")
        total += count
if total == 0:
    raise SystemExit("No GHDL library catalog timestamps were normalized")
print(total)
PY
)
printf 'Normalized %s GHDL library catalog timestamps to %s\n' \
  "$normalized_catalogs" "$library_timestamp"
tar --create --file "$work_dir/libraries.tar" \
  --sort=name --mtime="@${SOURCE_DATE_EPOCH}" --owner=0 --group=0 --numeric-owner \
  --directory "$library_stage" .
gzip --no-name --best --stdout "$work_dir/libraries.tar" > "$output_dir/libraries.tar.gz"
{
  printf 'ghdl_commit\t%s\n' "$ghdl_pin"
  printf 'ghdl_browser_commit\t%s\n' "$browser_pin"
  printf 'gcc_libgnat_tag_object\t%s\n' "$gcc_pin"
  printf 'gcc_libgnat_commit\t%s\n' "$gcc_commit"
  printf 'source_date_epoch\t%s\n' "$SOURCE_DATE_EPOCH"
  printf 'ada_calendar_year\t%s\n' "$source_date_year"
  printf 'library_catalog_timestamp\t%s\n' "$library_timestamp"
  printf 'adawebpack_version\t%s\n' "$adawebpack_version"
  printf 'adawebpack_sha256\t%s\n' "$adawebpack_sha256"
  printf 'wasi_sdk_clang\t%s\n' "$("$sdk_dir/bin/clang" --version | head -n 1)"
  printf 'libxml2_version\t2.9.14+dfsg-1.3ubuntu3.10\n'
  printf 'libxml2_sha256\t%s\n' "$libxml2_sha256"
  printf 'libicu74_version\t74.2-1ubuntu3.1\n'
  printf 'libicu74_sha256\t%s\n' "$libicu74_sha256"
  cat "$work_dir/packages.tsv"
} > "$output_dir/build-manifest.tsv"
(
  cd "$output_dir"
  sha256sum ghdl-synth.wasm libraries.tar.gz > SHA256SUMS
)

end_time=$(date +%s)
printf 'Build wall time: %s seconds\n' "$((end_time - start_time))"
printf 'Ada Calendar fixed year: %s\n' "$source_date_year"
printf 'GHDL %s / ghdl-browser %s / AdaWebPack %s / GCC libgnat %s\n' \
  "$ghdl_pin" "$browser_pin" "$adawebpack_version" "$gcc_pin"
du -h "$output_dir/ghdl-synth.wasm" "$output_dir/libraries.tar.gz"
