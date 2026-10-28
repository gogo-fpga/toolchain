# S0 Phase 1: GHDL WASM 合成のビルドと smoke

## 目的と範囲

GHDL 6.0.0 の VHDL 合成を WASM で実行し、Verilog を出力する。既存の Yosys、nextpnr、gowin_pack の経路で Tang Nano 20K の `.fs` まで進め、native GHDL と比較する。これは S0 Phase 1 の build-and-smoke であり、正式な S0 matrix はレビュー後に行う。

## 固定条件

実験元は `origin/main` の `aff4e61b576b4f18a3cb819069b16c4cc9c1652a`。GHDL の `SOURCE_DATE_EPOCH` は固定 commit の時刻から `1772905660` とした。build と fixture のログおよび生成物は `build/` 以下に保存した。

| 入力 | 固定値 |
|---|---|
| GHDL | v6.0.0、`e589c698c351369ac5bcfe7abe1f1152ac5d4727` |
| ghdl-browser | `e98e5a6c6fd6c48a789705ae9900c6b34b3cb414` |
| GCC libgnat tag object | `ed10445fe222d3973ae13eda9bf211f315c5e3f9` |
| GCC libgnat peeled commit | `cd0059a1976303638cea95f216de129334fc04d1` |
| AdaWebPack | 24.0.0、SHA-256 `8edaae8b9987a20aec430d750f30033f12f953ce2b6437afb87fbf8cc1063796` |
| WASI SDK | 34、clang 23.1.0-wasi-sdk |
| ホスト GCC / GNAT | GCC 15.2.0-16ubuntu1 / GNAT 14.3.0 |
| gprbuild / gprconfig-kb | 2025.0.0-4build2 / 25.0.0-2 |
| AdaWebPack 用 libxml2 / ICU | libxml2 2.9.14+dfsg-1.3ubuntu3.10 / libicu74 74.2-1ubuntu3.1 |
| Node.js | 24.22.1 |

ビルドは Docker と root 権限を使わず、必要な host package を `apt-get download` で取得し、`build/host-tools/` に展開した。AdaWebPack の `llvm-ar` は使わず、WASI SDK 34 の `clang`、`wasm-ld`、`llvm-ar`、`llvm-strip` を使った。AdaWebPack の runtime calendar stub は展開コピー上でのみ変更し、固定 epoch の年 2026 を返すようにした。GHDL v6 の Verilog frontend units と `Synth.Verilog_Insts` への synthesis-path 依存は build copy から除外した。Verilog output emitter は維持した。vendor source は変更していない。

| 取得した host package | 版 | .deb SHA-256 |
|---|---|---|
| `gprbuild` | 2025.0.0-4build2 | `ebf68e78caf320692fbae9c1cb58e8b365d989b66033f703e3224040691db9bb` |
| `gprconfig-kb` | 25.0.0-2 | `4f3e254e1cae5c0edbc87f999144202d717ec828f4d07bd5cc0ddb31d01ccac0` |
| `libgnat-14` | 14.3.0-14ubuntu1 | host に導入済み、download なし |
| `libgnatprj12` | 2025.0.0-4build2 | `b57ab4d2bd90360966eb245ff464afd2145685802b6e8e56f7ecb806f59bb194` |
| `libxmlada-dom9` | 25.0.0-4build2 | `7b8773467a50b27bb9071f21e4a10b5c61a8bd0614d2bade32f45e57a91ed075` |
| `libxmlada-input8` | 25.0.0-4build2 | `30161cb121ee176ea0c5d37a9db2744dd91056f47f1ce75c2f4d54773d31f69b` |
| `libxmlada-sax8` | 25.0.0-4build2 | `aae83ba17f060d82a5c1e32432462470cc0a8bab1dfa45df58a816512d4c3a57` |
| `libxmlada-schema8` | 25.0.0-4build2 | `b01d6d3ed8189a9902da2ba037599fbcb23cba3d553fa5b74d7741f64e299969` |
| `libxmlada-unicode8` | 25.0.0-4build2 | `badb5d896cc19507c01996c71e54ff0beb83a8f30472a2c2bf15071f816e56f5` |
| `libxml2` for AdaWebPack | 2.9.14+dfsg-1.3ubuntu3.10 | `c5a065f85c1e6f605741e365e40cad71c3ceb0e85e2791400bd35b8896e12ad1` |
| `libicu74` for AdaWebPack | 74.2-1ubuntu3.1 | `c9a70989678660eed9a1e904c74fa043da8bec8e2036856fc16e31ced79b04f8` |

`libxml2` は Ubuntu archive の `https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/libxml2_2.9.14+dfsg-1.3ubuntu3.10_amd64.deb` から取得した。manifest と package の版・hash は `build/ghdl-wasm-final/ghdl-wasm/build-manifest.tsv` にも記録した。

## build と fixture の結果

| 項目 | 結果 |
|---|---|
| WASM | 1,999,655 bytes、SHA-256 `8c919800d9c23c381920f8782b6ca33cb214a8a34018b6ed8d3ee767c95acd7d` |
| libraries archive | 455,929 bytes、SHA-256 `32c3586a64b5adc62d55a45aab127b18aeb2f45a8205da089d5618c6c9e10513` |
| build wall time | 最終 build 297 秒 |
| artifact を作った GHDL | 6.0.0、commit `e589c698c351369ac5bcfe7abe1f1152ac5d4727` |
| fixture tests | 8/8 成功。6 positive fixture は全て native output と byte-identical |

| Fixture | WASM と native GHDL の Verilog |
|---|---|
| Combinational logic | byte-identical |
| `numeric_std` counter | byte-identical |
| Generic entity | byte-identical |
| FSM | byte-identical |
| Package と依存 entity の2 file | byte-identical |
| Tang Nano 20K LED blink | byte-identical |
| Syntax error | 非0終了、source filename と line の診断 |
| Semantic error | 非0終了、source filename と line の診断 |

詳細な fixture 出力は `build/ghdl-wasm/fixture-tests.log` にある。

## Tang Nano 20K `.fs` smoke

VHDL LED blink について、WASM GHDL と native GHDL の双方が出した Verilog を、native / WASI Yosys、native / WASI nextpnr、native gowin_pack / Pyodide pack に通した。4 経路の `.fs` は全て 4,618,782 bytes、SHA-256 `16f96233dbbc90af33256cae3bdc9a12e245e9afbc480e756af47941abf72e3c` で byte-identical だった。WASM と native GHDL の Verilog は 1,162 bytes で byte-identical だった。実機では試していない。

## A/A 再現性

最初の fresh-root builds では WASM は一致したが、libraries archive は一致しなかった。archive の member metadata は一致し、差は `ieee` と `std` の8個の `.cf` catalog に含まれる compile time だった。GHDL は `SOURCE_DATE_EPOCH` を無視して catalog に wall-clock timestamp を記録していた。

build script は native GHDL の library tree を staging copy に複製し、123 個の catalog timestamp を `SOURCE_DATE_EPOCH` に基づく `20260307174740.000` に正規化してから、sort、mtime、owner/group を固定して archive 化する。native library tree 自体は変更しない。二つの fresh-root library tree を同じ処理で再梱包し、patched script で作った最終 archive と比較した結果、全て SHA-256 `32c3586a64b5adc62d55a45aab127b18aeb2f45a8205da089d5618c6c9e10513`、455,929 bytes で一致した。WASM も fresh-root 2回と最終 build で一致した。

| Fresh root | build time | WASM SHA-256 | 初回 archive SHA-256 | 正規化後 archive SHA-256 |
|---|---:|---|---|---|
| 初回 `ghdl-wasm` | 297 秒 | `8c919800d9c23c381920f8782b6ca33cb214a8a34018b6ed8d3ee767c95acd7d` | `163154f1830b033d1af2950dd2e41337b83c6f94f7052e0b8cc491846fd2215f` | — |
| `ghdl-wasm-aa1` | 299 秒 | `8c919800d9c23c381920f8782b6ca33cb214a8a34018b6ed8d3ee767c95acd7d` | `e20bba6f9398a73088de2efea35141ff210ba10a1bdcef1347ab48cfa4fc4a8e` | `32c3586a64b5adc62d55a45aab127b18aeb2f45a8205da089d5618c6c9e10513` |
| `ghdl-wasm-aa2` | 297 秒 | `8c919800d9c23c381920f8782b6ca33cb214a8a34018b6ed8d3ee767c95acd7d` | `4cde6d255e621f024aac2fb90498b887642b76f3741182c15a65be26b67e4952` | `32c3586a64b5adc62d55a45aab127b18aeb2f45a8205da089d5618c6c9e10513` |
| patched script build | 297 秒 | `8c919800d9c23c381920f8782b6ca33cb214a8a34018b6ed8d3ee767c95acd7d` | — | `32c3586a64b5adc62d55a45aab127b18aeb2f45a8205da089d5618c6c9e10513` |

生データと比較結果は [S0-ghdl-wasm.csv](S0-ghdl-wasm.csv) に記録した。

## 失敗した試行

全て GHDL 6.0.0 を使った。v5.0.1 への切り替えは行っていない。

| 試行 | 失敗内容 | 記録 |
|---|---|---|
| 1 | v5.0.1 向け dynamic table patch が v6 の `dyn_htables.ads` に適用できず、`Hunk #1 FAILED at 71.` | `build/ghdl-wasm-v6-attempt1-build.log` |
| 2 | 同じ patch mismatch。`dyn_htables.ads` の hunk が失敗 | `build/ghdl-wasm-v6-attempt2-build.log` |
| 3 | AdaWebPack tree に `llvm-ar` がなく、archive step が失敗。WASI SDK の `llvm-ar` に変更 | `build/ghdl-wasm-v6-attempt3-build.log` |
| v6 full frontend | `verilog-allocates.adb` compile 中に GNAT LLVM assertion failure。VHDL synthesis に不要な Verilog frontend を build copy から外した | `build/ghdl-wasm-work/ghdl-browser/build/ghdl-wasm-full/gprbuild-gnatd-n.log` |
| runtime analysis | AdaWebPack calendar が 1970 年を返し、GHDL の `Filesystem.Year_Range` 2000..2099 に反して `Constraint_Error` (`filesystem.adb:93`) | `build/ghdl-wasm/runtime-analysis-attempt1.log` |
| 初回 A/A archive | `.cf` catalog の wall-clock timestamp が fresh roots で異なり、archive hash が不一致。timestamp 正規化を追加して解消 | `build/ghdl-wasm-aa1/ghdl-wasm/build.log`, `build/ghdl-wasm-aa2/ghdl-wasm/build.log` |
