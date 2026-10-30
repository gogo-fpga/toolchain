# S11 NVC r1.23.1 の WASM 化

- 状態: 中止（凍結基準の打ち切り条件）
- 日付: 2026-10-31
- 関連: [凍結基準](S11-nvc-wasm-criteria.md)

## 目的と仮説

NVC r1.23.1 を LLVM なしで WASM にし、ブラウザーと Node の WASI host から実行できるか調べます。方式 1 の WASI SDK 34.0 を先に試し、ucontext または pthread が利用できないことを configure log で確認した場合に限り、方式 2 の Emscripten に切り替えます。

## 採否の基準

最初の branch commit `70d4160a3e51a5bc13f6376f7a16f99177f3a8a4` に固定した[凍結基準](S11-nvc-wasm-criteria.md)に従います。ビルド、2回の clean build の同一性、native/WASM parity、negative control、5回連続のテストのすべてが合格条件です。方式 3 の打ち切り条件に当たった場合は実装を続けません。

## 条件

| 項目 | 値 |
|---|---|
| 基準の commit | `026a7f5aef88521b5fc98a1a7d7e70d714404430` |
| NVC | tag `r1.23.1`、peeled commit `fab54a9e96964b431050d837e163c22282a1df6c` |
| ホスト | Linux 7.0.0-42-generic、x86_64、12 logical CPU、30 GiB RAM |
| WASI SDK | 34.0、Linux x86_64 archive SHA-256 `b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4` |
| Emscripten | emsdk 6.0.13、emcc revision `e13ee988ce3d87a738dd8f3661d02223308c412a` |
| Node.js | emsdk 同梱 Node v24.19.0。WASM runtime test は未実施 |
| zstd | pinned `vendor/zstd` commit `f8745da6ff1ad1e7bab384bd1f9d742439278e99` を Emscripten 用 static library に build |
| NVC submodule | cutoff path のため `vendor/nvc` は追加せず |
| 出力先 | `build/S11/`。configure probe と zstd build のみ。NVC executable/WASM は未生成 |
| 変える条件 | WASI から Emscripten へ移行。両方で `--disable-llvm` |
| 固定した設定 | NVC r1.23.1、Emscripten では `-pthread -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false -sSTANDALONE_WASM` |

NVC の `NEWS.md` の r1.23.1 release section を確認しました。`README.md` は NVC を GPL-3.0-or-later とし、VITAL library のライセンス状態が不明なため厳格な配布では `--disable-vital` を勧めています。`COPYING` の全条文は GPL version 3 です。各 configure probe には `--disable-vital` を指定しました。submodule、license bundle、release check は cutoff path のため追加していません。

## 手順

次の手順は、固定した NVC と依存を使って configure の失敗を再現します。SDK はリポジトリーの固定版一覧で版と hash を確認し、`vendor/zstd` は記載した commit を使います。

```sh
git clone --depth 1 --branch r1.23.1 https://github.com/nickg/nvc.git build/S11/nvc-source
(cd build/S11/nvc-source && autoreconf --force --install -I m4)

mkdir -p build/S11/wasi-configure
cd build/S11/wasi-configure
CC="$PWD/../../wasi-sdk-34.0-x86_64-linux/bin/clang" \
CXX="$PWD/../../wasi-sdk-34.0-x86_64-linux/bin/clang++" \
CFLAGS="-O2 -g0" \
CXXFLAGS="-O2 -g0 -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false" \
LDFLAGS="-fwasm-exceptions -lunwind" \
../nvc-source/configure --build=x86_64-pc-linux-gnu \
  --host=wasm32-wasi --disable-llvm --disable-tcl --disable-vital
```

WASI configure は `ucontext.h` と `sys/ucontext.h` がなく、`-pthread` と `-lpthread` の両 probe が失敗して停止しました。これを記録した後、凍結基準どおり Emscripten へ切り替えました。

Emscripten configure に先立ち、pinned zstd を static library として build しました。以下の configure にはその install prefix の `pkg-config` metadata を渡します。

```sh
source build/emsdk-6.0.13/emsdk_env.sh
emcmake cmake -S vendor/zstd/build/cmake -B build/S11/zstd-emscripten \
  -DCMAKE_INSTALL_PREFIX="$PWD/build/S11/emscripten-deps" \
  -DZSTD_BUILD_SHARED=OFF -DZSTD_BUILD_STATIC=ON
cmake --build build/S11/zstd-emscripten --target install --parallel 1

mkdir -p build/S11/emscripten-configure
cd build/S11/emscripten-configure
export PKG_CONFIG_PATH="$PWD/../emscripten-deps/lib/pkgconfig"
export CPPFLAGS="-I$PWD/../emscripten-deps/include"
export LDFLAGS="-L$PWD/../emscripten-deps/lib -pthread -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false -sSTANDALONE_WASM -lunwind"
CC=emcc CXX=em++ \
  CFLAGS="-O2 -g0 -pthread -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false -sSTANDALONE_WASM" \
  CXXFLAGS="-O2 -g0 -pthread -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false -sSTANDALONE_WASM" \
  ../nvc-source/configure --build=x86_64-pc-linux-gnu \
  --host=wasm32-unknown-emscripten --disable-llvm --disable-tcl --disable-vital
```

The requested Emscripten form included `-fwasm-exceptions` and `-sSTANDALONE_WASM`. `-lunwind` was also tried. An additional probe with `-sWASM_EXCEPTIONS=1` stopped because emsdk 6.0.13 reports that setting as internal and disallows setting it from the command line.

## 計測器の検証

計測器は使用していません。NVC の configure が成功せず、WASM artifact を作成できなかったため、parity や runtime test は行っていません。

## 結果

| Frozen criterion | Result |
|---|---|
| 1. Build succeeds | Not met. WASI configure stopped at pthread detection; Emscripten configure stopped at the required `_Unwind_Backtrace` link probe |
| 2. Two clean builds are byte-identical | Not run |
| 3. Native/WASM report and waveform parity | Not run |
| 4. Syntax, undefined entity, severity failure, corrupted-WASM controls | Not run |
| 5. Five consecutive passing tests | Not run |

WASI configure のログは次のとおりです。

```text
checking for ucontext.h... no
checking for sys/ucontext.h... no
checking whether pthreads work with "-pthread" and "-lpthread"... no
checking whether pthreads work with -pthread... no
configure: error: pthread not found
```

Emscripten configure は zstd dependency の用意後、必須の `_Unwind_Backtrace` probe まで進みました。

```text
checking for unwind.h... yes
checking for library containing _Unwind_Backtrace... no
wasm-ld: error: ... undefined symbol: _Unwind_Backtrace
configure: error: cannot find library for _Unwind_Backtrace
```

The link command tried `-lunwind`, `-lc++abi`, and `-lpthread`; its Emscripten library selection used `libunwind-mt-legacyexcept.a` and `libc++abi-mt-legacyexcept.a`. The failure is in NVC's required configure check for the stack unwinder used by `src/debug.c`. No NVC object, final link, standalone module, or import list was produced. Node and Chromium execution therefore was not tested. Making this check pass would require a separate NVC debug-backtrace compatibility change; the frozen cutoff was applied rather than modifying the NVC core or claiming that the output would work with `wasi-p1.mjs`.

## 捨てた試行と経緯

The first Emscripten configure stopped earlier because libzstd was not found. Building pinned zstd for Emscripten got past that dependency check. Adding `-lunwind` did not resolve `_Unwind_Backtrace`. A separate `-sWASM_EXCEPTIONS=1` attempt failed because the setting is internal to emsdk 6.0.13. Retrying with the requested `-fwasm-exceptions`, `-mllvm -wasm-use-legacy-eh=false`, `-sSTANDALONE_WASM`, and `-lunwind` still failed at the same link probe.

## 結論と未確認事項

方式 1 は ucontext と pthread の不在により使えず、方式 2 は required `_Unwind_Backtrace` link probe を通過しませんでした。凍結基準の方式 3 の打ち切り条件に該当するため、ここで実装を止めます。NVC submodule、patch、build script、host、fixtures、tests、CI は追加していません。次の4つの条件は未確認です: 2回の WASM build の再現性、native parity、negative controls、5回連続 test。

NVC r1.23.1 以外の changelog、NVC WASM の import list、ブラウザー/Node runtime、VITAL library の配布条件、実機 FPGA は本リポジトリーでは試していません。

## ログ

ログは `build/S11/` に保持しています。以下の hash は各ファイル全体の SHA-256 です。大きな build log はコミットしていません。

| Log | SHA-256 | 内容 |
|---|---|---|
| `build/S11/wasi-configure-probe.log` | `8d1c4d623c98605048a43d8ca1e7d3e91ed0dc8217891c766ff599e2dd87c890` | WASI ucontext / pthread failure |
| `build/S11/emscripten-configure-probe.log` | `c15f3bb45b4732fdda75329799150859cb0a6faead7350cd6b6bab2266cc8797` | Initial Emscripten configure; zstd missing |
| `build/S11/zstd-emscripten-build.log` | `a03462e50b7d2cd6e9d4f55873caaf1c11d694e54387b62a3ca823d7d6cbb2e3` | Pinned zstd Emscripten static build |
| `build/S11/emscripten-configure-zstd.log` | `6821a5197b0743d52c0cede1898f1ca9a407f783d8bae64fba6c00264c061a8d` | Emscripten `_Unwind_Backtrace` failure after zstd build |
| `build/S11/emscripten-configure-unwind.log` | `6821a5197b0743d52c0cede1898f1ca9a407f783d8bae64fba6c00264c061a8d` | Retry with `-lunwind`; same configure output |
| `build/S11/emscripten-configure-wasm-eh.log` | `ff273569bb556b007a098efa9138f5be7f4bdfc8f424b400452c9d4a04cd1133` | `-sWASM_EXCEPTIONS=1` rejected as an internal setting |
| `build/S11/emscripten-configure-native-eh.log` | `6821a5197b0743d52c0cede1898f1ca9a407f783d8bae64fba6c00264c061a8d` | Retry with legacy EH disabled; same configure output |
| `build/S11/emscripten-configure/config.log` | `1dce8fc66bb50bfc4d55f3b7c823a910dd74e26dcdace579eab9865ef314d8fb` | Full final Emscripten link probe and compiler command |
