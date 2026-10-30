# 午後のFPGA Web Toolchain 調査記録

## 1. 目的と対象ボード

本リポジトリーは、ブラウザー内で VHDL と Verilog の設計、論理合成、配置配線、ビットストリーム作成、Tang Nano への書き込みを行う Web IDE を目指します。サーバーへ設計データを送らない構成を計画しています。T0 では、午後のFPGA Web Flasher から書き込み部を移植した段階で、IDE の機能はまだありません。

対象は Tang Nano 1K、4K、9K、20K です。FPGA の内蔵 SRAM に構成を書き込めることを、ユーザー指定の選定理由としています。ボード名、FPGA、openFPGALoader のボード名、IDCODE、書き込み先は移植元の調査記録を引き継ぎます。

| ボード | FPGA | openFPGALoader 名 | IDCODE | 書き込み先 | nextpnr device | nextpnr family | `gowin_pack -d` |
|---|---|---|---|---|---|---|---|
| Tang Nano 1K | GW1NZ-1 | `tangnano1k` | `0x0100681B` | SRAM、内蔵フラッシュ | `GW1NZ-LV1QN48C6/I5` | `GW1NZ-1` | `GW1NZ-1` |
| Tang Nano 4K | GW1NSR-4C | `tangnano4k` | `0x0100981B` | SRAM、内蔵フラッシュ | `GW1NSR-LV4CQN48PC7/I6` | `GW1NS-4` | `GW1NS-4` |
| Tang Nano 9K | GW1NR-9C | `tangnano9k` | `0x0100481B`（`0x0100581B` の個体もある） | SRAM、内蔵フラッシュ | `GW1NR-LV9QN88PC6/I5` | `GW1N-9C` | `GW1N-9C` |
| Tang Nano 20K | GW2AR-18C | `tangnano20k` | `0x0000081B` | SRAM、外付け SPI フラッシュ | `GW2AR-LV18QN88C8/I7` | `GW2A-18C` | `GW2A-18C` |

9K の IDCODE `0x0100581B` は、画面（`web/lib/boards.mjs`）の照合には加えていません。`.fs` の IDCODE が `0x0100481B` でないと、書き込みを止めます。upstream の openFPGALoader は、`0x0100581b` を `src/part.hpp` の 443 行目で `GW1NR-9` として、`src/fsparser.cpp` の 233 行目で `GW1N-9(ES)` として扱っています。この IDCODE の個体は、本リポジトリでは試していません。

IDCODE と書き込み先は、[移植元の RESEARCH.md](https://github.com/gogo-fpga/flasher/blob/dcbeb67/RESEARCH.md) に記録された値です。nextpnr の device / family 名は Apicula の README と wiki で確認しました。C 品種では `gowin_pack -d` に device 名ではなく family 名を渡します。詳細と出典は[広域調査](docs/research/oss-survey.md)を参照してください。実機の Tang Nano では試していません。

## 2. 午後のFPGA Web Flasher から引き継ぐ知見

書き込み部は、[午後のFPGA Web Flasher](https://github.com/gogo-fpga/flasher) のコード、ビルド、テストを基礎にします。移植元の調査記録は[RESEARCH.md](https://github.com/gogo-fpga/flasher/blob/dcbeb67/RESEARCH.md)です。実験記録はコピーせず、[S0](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S0-wasm-build.md)、[S1a](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S1a-program-sim.md)、[S1b](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S1b-option-matrix.md)、[S2](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S2-ci-sim-environment.md)、[S3](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S3-ci-speed.md)を参照してください。

- openFPGALoader v1.2.0 と libusb、libftdi、zlib を Emscripten 6.0.13 でビルドしています。
- JSPI と `-fwasm-exceptions` を組み合わせる構成で書き込み部を動かしています。libusb の WebUSB バックエンドは pthread と共有メモリーを必要とし、配信には COOP/COEP ヘッダーを使います。
- upstream の openFPGALoader は、失敗時にログへ `FAIL` を出しても終了コード 0 を返す場合があります。終了コードだけで成否を判断しません。
- 仮想 FT2232、GOWIN TAP、NOR フラッシュを使ったテストがあり、故障注入による負の対照も行っています。仮想デバイスの結果は実機の検証ではありません。
- S7 では、Chromium 上の fake USB 書き込みと最終 SRAM / flash 内容検証を行い、凍結基準により B+LTOA を選定しました。primary は B+LTOA が 14,994.695 ms、B が 15,491.515 ms（3.207%改善、N = 55.165 ms）でした。B+O3+LTOA は sim 4/5 のため対象外です。この選定を反映し、B+LTOA を JSPI の既定 build に採用しました。以前の既定 build は `scripts/build-wasm.sh --variant=B` で再現できます。詳細は [S7 実験記録](docs/experiments/S7-openfpgaloader-chromium.md)を参照してください。実機では、本リポジトリでは試していない。

  現行既定 WASM の SHA-256 `61c4943252821a0d1405133c11690b7718fb5af28c86bf102e926ccba780a642` は S7 B+LTOA の `5ccccd017186a7a8d137f9791e08a53cf2fedaa5aaa59143028def8908557812` と異なりますが、差は `-ffile-prefix-map=$build_root=/build` が残す `/build/jspi-pthread/` と `/build/B+LTOA/` の出力下位パス、およびそれに伴う data offset です（MJS は両方 `f66be852ed33c8245fe781d900a7124186a6d3cd611a81849e1019ae080d8d44`）。確認では `--variant=B+LTOA` が S7 の WASM/MJS SHA `5ccccd017186a7a8d137f9791e08a53cf2fedaa5aaa59143028def8908557812` / `f66be852ed33c8245fe781d900a7124186a6d3cd611a81849e1019ae080d8d44` を、`--variant=B` が S7 B の `ecf7617859639422050c1098edc1dac04e943def90cb5a7328b8035714cb42b7` / `9005540841199936d9f983124e7a890e3661bd21f250b11e580346e8e7c0df27` を再現し、既定 profile の A/A も `61c4943252821a0d1405133c11690b7718fb5af28c86bf102e926ccba780a642` / `f66be852ed33c8245fe781d900a7124186a6d3cd611a81849e1019ae080d8d44` で一致しました。4条件の `$REPO_ROOT` 再生成コマンド、`flags.make`／`link.txt` の差分件数、`wasm-dis`／`strings` の差分件数は [S7 実験記録の既定 profile 確認](docs/experiments/S7-openfpgaloader-chromium.md#jspi-既定-profile-の再現確認)に記録しました。

asyncify は S1b のフラグを維持し、現行スクリプトと origin/main の `flags.make` / `link.txt` は build root 置換後の diff が各 0 行（configure-level の一致でバイト同一性は未確認）だったが、この VM での full link は 1:18:51・peak RSS 15.3 GB で終了コード 2 により失敗し、バイト同一性は本リポジトリでは試していない（origin/main でも同じ失敗となるかは未確認）。

これらは移植元の記録に基づく知見です。新しい Emscripten やブラウザーでの再検証は、このリポジトリーではまだ実施していません。

vendor submodule の commit は次のとおりです。pin checker がこの表と gitlink の一致を検査します。

| 依存 | 版 | commit | 取得元 |
|---|---|---|---|
| openFPGALoader | v1.2.0 | `befbab4f646207dbaf1daf8b144dd980ad283dd5` | `https://github.com/trabucayre/openFPGALoader.git` |
| libusb | v1.0.30 | `87a55632db62c9bdc58cd31d3ccfa673f1bb017f` | `https://github.com/libusb/libusb.git` |
| libftdi | 1.6rc1 | `92d657bcb543a9622947d984d4a8e725fb680e8c` | `git://developer.intra2net.com/libftdi` |
| zlib | v1.3.2 | `da607da739fa6047df13e66a2af6b8bec7c2a498` | `https://github.com/madler/zlib.git` |
| zstd | v1.5.7 | `f8745da6ff1ad1e7bab384bd1f9d742439278e99` | `https://github.com/facebook/zstd.git` |
| xz-embedded | v20240322 | `62d5603b5114c5aa8bb5f6bb461efbe0e3b51891` | `https://github.com/tukaani-project/xz-embedded.git` |
| emsdk | 6.0.13 | `35659964bc2762fffec0d257997fb61475f765b7` | `https://github.com/emscripten-core/emsdk.git` |
| yomiyasu | 未確認 | `552c12c472ddfb79e2ee7a15219847782686a945` | `https://github.com/nanaism/yomiyasu.git` |
| yosys | v0.70 | `28ba3cb926fe376fa05ebfc1b921747d011d4557` | `https://github.com/YosysHQ/yosys.git` |
| nextpnr | nextpnr-0.11.1 | `62e659ed6748e9f60b2a4aa25dd4fe79a9605881` | `https://github.com/YosysHQ/nextpnr.git` |
| ghdl | v6.0.0 | `e589c698c351369ac5bcfe7abe1f1152ac5d4727` | `https://github.com/ghdl/ghdl.git` |
| ghdl-browser | main | `e98e5a6c6fd6c48a789705ae9900c6b34b3cb414` | `https://github.com/UnsignedChad/ghdl-browser.git` |

WASI SDK の固定値は pin checker とビルドスクリプトが読む次の表を正とします。

| 依存 | 版 | SHA-256 | 取得元 |
|---|---|---|---|
| wasi-sdk | 34.0 | `b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4` | `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz` |
| boost | 1.92.0 | `ea7b982002cc9dfbe59b0b217b206f470dc75f3de0bb2973d844118934d82411` | `https://github.com/boostorg/boost/releases/download/boost-1.92.0/boost-1.92.0-b2-nodocs.tar.xz` |
| eigen | 5.0.1 | `e9c326dc8c05cd1e044c71f30f1b2e34a6161a3b6ecf445d56b53ff1669e3dec` | `https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz` |
| adawebpack | 24.0.0 | `8edaae8b9987a20aec430d750f30033f12f953ce2b6437afb87fbf8cc1063796` | `https://github.com/godunko/adawebpack/releases/download/24.0.0/adawebpack-24.0.0.tar.gz` |

libftdi は `developer.intra2net.com` に Dependabot が接続できないため、`.gitmodules` の URL と branch から upstream 先端を調べ、「固定版の更新確認」ワークフローで監視します。

## 3. ツールの WASM 化方針

T0 では書き込み部だけが実装されています。合成、配置配線、シミュレーション、形式検証は後続段階で、upstream のコードを WASM にビルドして使います。機能を手作業で移植しません。upstream へのパッチが避けられない場合は `patches/` に保管し、理由と範囲を本書に記録します。

| ツール | 主な言語 | ライセンス | 確認した WASM の事例 | 方針と段階 |
|---|---|---|---|---|
| Yosys + ABC | C、C++ | Yosys: ISC。ABC: Berkeley の許諾条件 | [YoWASP](https://yowasp.org/) は Yosys を WASI で提供。[synth-explorer](https://github.com/cachanova/synth-explorer) は WASI SDK 33 で合成用 Yosys を構築 | T2。YoWASP とネイティブ版を比較し、必要な `synth_gowin` を含む upstream ビルドを検証する |
| GHDL | Ada、C | GPL-2.0-or-later | [synth-explorer](https://github.com/cachanova/synth-explorer) は GHDL 5.0.1 で合成し、Verilog を別 Worker の Yosys に渡す。[ghdl-browser](https://github.com/UnsignedChad/ghdl-browser) と [ghdl-wasm](https://github.com/UnsignedChad/ghdl-wasm) は解析・シミュレーションの事例 | T3。`--synth --out=verilog` で Verilog に変換し、Yosys に渡す。GPL-3.0 の ghdl-yosys-plugin は Yosys WASM に組み込まず、ISC の Yosys を保つ。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| nextpnr-himbaechel（Gowin） | C++ | ISC | [YoWASP](https://yowasp.org/) が nextpnr の WASI 版を提供 | T2。必要な Gowin device database のみを含め、4 ボードの配置配線を検証する |
| Apicula / `gowin_pack` | Python | Apicula: MIT。Pyodide: MPL-2.0 | S3 で Node.js/Pyodide の native parity を確認し、配布 wheel を追加する。Worker は S4 | S3。4ボードの `.fs` 一致、実行時間、配布サイズを測定する |
| openFPGALoader | C++ | Apache-2.0 | 移植元で Emscripten と WebUSB による WASM 化を実装 | T0 の書き込み部として移植済み。以降も upstream のソースを使う |
| NVC | C | GPL-3.0-or-later | この調査では WASM 版を確認できていない | T4。LLVM なしの解釈実行を調査する。`configure.ac` は `--enable-llvm` を宣言し、LLVM を既定で有効にする。依存は pthread、zlib、libffi、libzstd |
| Icarus Verilog (`iverilog` / `vvp`) | C | GPL-2.0 | [VeriSim](https://github.com/senolgulgonul/verisim) が Emscripten で `ivlpp`、`ivl`、`vvp` を個別に WASM 化 | T4。3 つの WASM を JavaScript で順番に呼ぶ方式を基礎にする。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| Verilator | C++ | LGPL-3.0 | [tiny-tpu](https://github.com/deaneeth/tiny-tpu) は事前ビルドした WASM を配布。ブラウザー内で C++ をコンパイルする例ではない | 将来。生成コードを実行する C++ コンパイラーをブラウザー内で用意する方法が必要。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| SymbiYosys / `yosys-smtbmc` | Python | 未確認 | YoWASP の Yosys は確認したが、Python 側の WASM 実行例は未確認 | T6。Yosys と Python 側の実行環境を分けて検証する |
| Yices2 | C | GPL-3.0 | 非公式の WASM パッケージと wasi-libc の制約を報告した issue がある | T6。ライセンスと issue は[広域調査](docs/research/oss-survey.md)を参照し、Emscripten 版を含めビルドと実行を検証する |
| Z3 | C++ | MIT | 公式 npm [`z3-solver`](https://www.npmjs.com/package/z3-solver) 5.3.2 が WASM を含む | T6。公式パッケージの API と solver の実行時間を小さな証明で測る。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| Boolector | C | 未確認 | YoWASP が WASI 版を配布 | T6。ライセンスと必要な API、solver の実行時間を確認する。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| [sv-elab（旧 yosys-slang）](https://github.com/povik/sv-elab) | C++ | ISC | この調査では WASM 版を確認できていない | 将来。SystemVerilog 対応の段階で調査する。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |

[synth-explorer の Yosys ビルド記録](https://github.com/cachanova/synth-explorer/blob/main/tools/yosys-wasm/README.md)は、WASI SDK 33 で LTO とネイティブ WASM 例外を組み合わせたときの symbol type failure を避けるため、LTO を無効にしたと報告しています。この問題を本リポジトリーで再現したわけではありません。

### Yosys v0.70 と WASI SDK

Yosys v0.70 は CMake でビルドします。upstream の [`CMakeLists.txt`](https://github.com/YosysHQ/yosys/blob/28ba3cb926fe376fa05ebfc1b921747d011d4557/CMakeLists.txt#L159-L169) は `CMAKE_SYSTEM_NAME` が `WASI` の場合の設定を持ちますが、Emscripten 用の分岐はありません。このため、合成・配置配線ツールには WASI SDK を使い、書き込み部の Emscripten と使い分けます。

upstream の [`kernel/yosys.cc`](https://github.com/YosysHQ/yosys/blob/28ba3cb926fe376fa05ebfc1b921747d011d4557/kernel/yosys.cc#L601-L605) は WASM 実行時の share ディレクトリーを `/share/` として扱います。`synth_gowin` が参照する techlibs を含むビルド時の `share` を、WASI 実行環境の `/share` に割り当てます。Slang を無効にしても、ABC と CMake が使う `libs/cxxopts`、`libs/fmt`、`libs/tomlplusplus`、`libs/boost_regex`、`libs/symfpu` の submodule は必要です。

S1 の合成 JSON は `creator` にコンパイラー情報、`attributes.src` に techlib の実行時パスを記録します。native は `build/native/share`、WASI は `/share` を使うため、比較では `creator` の Yosys gitlink 由来 prefix を確認し、`attributes.src` にある native share path だけを `/share` に置き換えます。それ以外の値とキー順は変換せず比較します。

WASI SDK 34.0 の Linux x86_64 アーカイブ名、URL、SHA-256 は上の固定値表に置き、pin checker が更新を監視します。ビルドスクリプトは同じ表を読み、値を重複して持ちません。

### nextpnr-himbaechel（Gowin）と WASI SDK

nextpnr は `nextpnr-0.11.1` の gitlink に固定します。upstream の [`himbaechel/CMakeLists.txt`](https://github.com/YosysHQ/nextpnr/blob/62e659ed6748e9f60b2a4aa25dd4fe79a9605881/himbaechel/CMakeLists.txt#L1-L22) では `HIMBAECHEL_SPLIT=ON` により microarchitecture ごとに実行ファイルを分けます。Gowin の [`CMakeLists.txt`](https://github.com/YosysHQ/nextpnr/blob/62e659ed6748e9f60b2a4aa25dd4fe79a9605881/himbaechel/uarch/gowin/CMakeLists.txt#L28-L57) は `HIMBAECHEL_GOWIN_DEVICES` に列挙した device ごとに chipdb を生成します。対象 family は `web/lib/boards.mjs` の4ボードから導き、`GW1NZ-1`、`GW1NS-4`、`GW1N-9C`、`GW2A-18C` 以外が入る場合はビルドを停止します。device 名も同じファイルの board 定義をテストで使います。

nextpnr は CMake の `STATIC_BUILD` を使い、Boost 1.92.0 の `program_options` と `iostreams` のみを静的リンクします。Boost は WASI SDK の clang で構築し、Eigen 5.0.1 はヘッダーとして参照します。Boost 1.92.0 の `iostreams` には例外構文を使うソースがあるため、`-fno-exceptions` ではビルドできません。WASI SDK 34 の WebAssembly 例外と `libunwind` を使い、Boost と nextpnr を `-fwasm-exceptions` で構築します。Apycula は `requirements-nextpnr.txt` のハッシュ付き固定版を使ってチップデータを生成します。依存の版、取得元、checksum は pin checker が検査する上表と lock file から読み、ビルドスクリプトに重複して持ちません。

nextpnr は native build で `bbasm` を用意し、WASI build の `BBA_IMPORT` に渡す方式です。upstream の [`CMakeLists.txt`](https://github.com/YosysHQ/nextpnr/blob/62e659ed6748e9f60b2a4aa25dd4fe79a9605881/CMakeLists.txt#L268-L271) と [`BBAsm.cmake`](https://github.com/YosysHQ/nextpnr/blob/62e659ed6748e9f60b2a4aa25dd4fe79a9605881/cmake/BBAsm.cmake#L70-L130) の構成に合わせ、native helper で chipdb を生成します。独立生成した `.bba` と chipdb には差があったため、WASI build には native build の `.bba` を読み込みます。4 family の chipdb が一致することはテストで確認済みです。WASI 実行時の外部 chipdb は `/share/himbaechel/gowin/` から読み、WASM と別に配置します。native build 用の実行時パスも設定済みです。Threads は無効、WASM の stack は 8 MiB です。

S2 の P&R テストは各ボードの Verilog テンプレートを WASI Yosys で合成し、`generateCst` の制約と同じ `--seed` を使って native と WASI nextpnr に渡します。出力 JSON はパース後に比較し、実測で差が現れ、ツールまたはパスの metadata と確認できた値だけを狭く置き換えます。配置などの差は許容しません。比較規則には置換数の確認と、非 metadata 値を変える負の対照を設けます。

nextpnr は ISC、Boost は Boost Software License 1.0、Eigen は主に MPL-2.0 で、一部に BSD など互換ライセンスのコードがあります。Apycula は MIT のライセンスです。S2 の chipdb 生成では Apicula と Python 依存をビルド時だけ使い、S3 では `gowin_pack` を実行する Apicula wheel と Pyodide runtime を web build / Release に追加します。ライセンス本文は `licenses/` と配布 zip に含めます。

Apycula 0.35 と `requirements-nextpnr.txt` の固定依存で、4 family の chipdb 生成と P&R が成功しました。他の Apycula 版は試していません。native と WASI で別々に生成した `.bba` と chipdb は一致しなかったため、native build の `.bba` を WASI build に取り込みます。これにより、両実行形式が同じ chipdb を使うことをテストで byte 単位に確認します。

Boost 1.92.0 は `-fwasm-exceptions` と `libunwind` を使って WASI 向けにビルドできました。別の Boost 版は試していません。nextpnr WASM は 34,141,610 bytes、native binary は 55,324,696 bytes です。ビルド時間は初回の WASI が 5 分 5.890 秒、native が 2 分 44.644 秒でした。chipdb 生成を共有する変更後の再ビルドは、既存のビルドを再利用して WASI が 10.957 秒、native が 4.575 秒でした。

### S5: WASI ビルドオプション比較

S5 の事前登録基準では LTO を採用します。Chromium の Tang Nano 20K は 2,296.095 ms で B より 10.5% 速く、zstd -19 の合計は 11.6% 小さく、ビルド時間は 1.81 倍でした。
B の nextpnr は upstream の `USE_IPO=ON` で ThinLTO 済みです。Yosys の O2/Os/Oz は `-DNDEBUG` を付けず、B と assert の状態をそろえました。
Os は Node 20K で 2,048.583 ms、zstd 合計 13,235,553 bytes でしたが、Chromium では測定していません。
詳細は [S5 WASI SDK ビルドオプション比較](docs/experiments/S5-wasi-build-options.md) を参照してください。後続の S5B 比較では OsLTO（Yosys と nextpnr は `-Os`、C/C++/linker は `-flto`、nextpnr は `USE_IPO=OFF`）を選定しました（[計測記録 PR #23](https://github.com/gogo-fpga/toolchain/pull/23)）。この条件は [PR #24](https://github.com/gogo-fpga/toolchain/pull/24) で既定にしました。S5 の B は、最適化フラグを明示的に空にし、nextpnr に `WASI_USE_IPO=ON` を指定して再現します。

S5B では Os、LTO、OsLTO を追加比較し、出力同一性、A/A build、連続5回の Node test、peak RSS の安定性条件を3候補すべてが満たしました。凍結した選定規則では、Chromium 20K の中央値が 2,122.105 ms（B より20.563%速い）で、zstd-19 合計も 11,327,113 bytes の OsLTO を選びます。既定の build script は [PR #24](https://github.com/gogo-fpga/toolchain/pull/24) で OsLTO に変更しました。詳細は [S5B 実験記録](docs/experiments/S5B-os-lto-chromium.md) を参照してください。

### S8: CI ビルドの高速化

CI 高速化の凍結基準を [S8 実験記録](docs/experiments/S8-ci-speed.md) に記録しました。計測は未実施です。

### Pyodide 上の Apicula `gowin_pack`

S3 では Apicula 0.35 の Python wheel を配布物に含め、Node.js の Pyodide 314.0.7 から実行します。Pyodide の lock は Python 3.14.2、micropip 0.11.1、NumPy 2.4.6（SHA-256 `a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf`）、msgspec 0.20.0（SHA-256 `2a4075cee8afc2c0424c63ae1a9b0655e727478df7fa2eb78f86f846fc5fb4bd`）を指定します。これらの wheel hash はビルド時に Pyodide の lock から読み、Apicula wheel の hash は `requirements-nextpnr.txt` の固定値を使います。

Pyodide は新規依存として導入し、upstream の 314.0.0〜314.0.7 の変更履歴を確認しました。314.0.0 で Python 3.14.2 と Emscripten 5.0.3 に更新され、`lzma` が標準ライブラリーに含まれます。`pyodide.asm.mjs` への ES module 名変更は Node の実行には影響しませんが、S4 の Worker は module worker を使う必要があります。314.0.1〜314.0.6 の修正・性能改善はこの file-based 実行で使う API を変えません。314.0.7 の `dedent` オプションは既定値が従来動作を保つため採用不要です。`loadPackage` は lock 内の名前を指定し、依存解決を切った `micropip.install` でローカル wheel を入れるため、314.0.6 の requirement-specifier 処理変更にも依存しません。

Apicula 0.35 の wheel は 4,281,385 bytes、SHA-256 `6495d1c7cdc3cf6ac0a74bf7246932e96e5af84e24c17c1fef7296ebe7ed82fe` です。wheel に同梱された chipdb を `importlib.resources` で読み、圧縮データの展開に `lzma` を使います。`lzma` は Pyodide core に含まれることを実行時に検査します。`fastcrc` は Pyodide にないため、Apicula は CRC table fallback を選び、その警告を stderr に残します。Cattrs は使用しません。

Pyodide の NumPy / msgspec は 2.4.6 / 0.20.0 で、native 参照環境の 2.5.4 / 0.22.0 と版が異なります。S3 の比較では、同一の WASI nextpnr routed JSON を使い、全4ボードで native と Pyodide の `.fs` を5回ずつバイト比較し、IDCODE も確認しました。17件の synthesis tests は成功し、壊れた JSON、別 device、wheel hash 不一致、欠落 wheel の4負例を検出しました。Pyodide setup は 4,627.9 ms、pack assets は 21,021,184 bytes、`.fs` は 1K 351,954、4K 1,167,294、9K 2,069,320、20K 4,618,782 bytes でした。native / Pyodide の実行時間と各回の値は `docs/experiments/S3A-pyodide-gowin-pack.md` と CSV に記録しました。ブラウザー Worker での実行は S4 の範囲で、本段階では確認しません。

### S4: ブラウザー内の Verilog から .fs 生成

`@yowasp/runtime` 11.0.72 は jco 変換済み module の WASI Preview 2 component import を実装し、README で内部用途と説明されています。Yosys と nextpnr は Preview 1 import を使うため、本リポジトリーでは Preview 1 shim を実装し、未対応 import は `LinkError` で拒否します。

shim が公開する import は `args_get`、`args_sizes_get`、`clock_time_get`、`environ_get`、`environ_sizes_get`、`fd_close`、`fd_fdstat_get`、`fd_fdstat_set_flags`、`fd_filestat_get`、`fd_filestat_set_size`、`fd_pread`、`fd_prestat_dir_name`、`fd_prestat_get`、`fd_read`、`fd_readdir`、`fd_renumber`、`fd_seek`、`fd_write`、`path_create_directory`、`path_filestat_get`、`path_open`、`path_readlink`、`path_remove_directory`、`path_rename`、`path_unlink_file`、`proc_exit`、`random_get` の27個です。仮想ファイルは growable `Uint8Array` とし、Yosys と nextpnr は共有 workspace と `/tmp` を preopen します。Yosys share は deterministic USTAR を読み込みます。

ブラウザーでは module Worker が manifest の size と SHA-256 を検証してから Yosys と nextpnr を順に実行し、選択した family の chipdb だけを配置します。次の pack Worker は S3 の `runGowinPack` を使い、キャンセル時に終了して次の build で作り直します。IDE は Verilog でのみ build を有効化し、VHDL は「VHDL の合成は T3 で対応予定です」と表示します。`.fs` をプロジェクトへ保存し、成功後に書き込み対象として選びます。

Playwright の preflight は `build/synth` と `dist/synth` の相対 file set と各 file の byte 列を比較します。E2E の期待値は Node WASI Yosys、Node WASI nextpnr、native `gowin_pack` で生成し、ブラウザー成果物と比較します。測定値は Chromium と VM の値として記録し、実機の性能値とは扱いません。

全4ボードで5回ずつ、Chromium内の出力が期待する`.fs`とbyte-identicalであること、IDCODE、fake USBによるSRAM書込みを確認しました。20回分の段階別時間と各toolの`memoryBytes`、出力sizeは [S4A実験記録](docs/experiments/S4A-browser-build.md) とCSVに記録しています。中央値はVM/Chromium上で合成1,533–1,563 ms、配置配線468–1,079 ms、ビットストリーム318–1,423 msです。各boardの最初のビットストリーム計測はPyodide初期化を含みます。これらの測定値をTang Nano実機の性能として扱いません。

| Family | Native / WASI chipdb bytes |
|---|---:|
| GW1N-9C | 12,846,661 |
| GW1NS-4 | 10,193,030 |
| GW1NZ-1 | 5,922,288 |
| GW2A-18C | 17,493,847 |

固定 seed を使った P&R JSON の比較は4ボードすべて成功しました。以下の時間は native / WASI の順です。ピーク RSS は各ボードのテスト時に計測したプロセスの最大値です。

| Board | P&R time (ms) | Peak RSS (KiB) |
|---|---:|---:|
| Tang Nano 1K | 161.0 / 433.6 | 410,628 |
| Tang Nano 4K | 189.6 / 299.3 | 427,336 |
| Tang Nano 9K | 244.2 / 405.9 | 429,188 |
| Tang Nano 20K | 441.5 / 813.2 | 453,740 |

存在しない pin の負例は native と WASI の両方で有用なエラーと非ゼロ終了を返し、chipdb を欠落させた WASI 実行も非ゼロで終了しました。

Yosys v0.69 から v0.70 では `alumacc -macc-only`、`optbarriers`、`flatten` と `prep` の `-barriers`、`mcm`、`rmports -purge`、`ltp -select`、色付きログが追加され、`read_xaiger2` が削除されました。`vendor/yosys/CHANGELOG` の該当節を確認しました。今回の `read_verilog` と `synth_gowin` を使う経路ではどの変更も必要ないため、追加のオプションやパスは採用しません。WASI SDK 34 の release notes では CMake toolchain の調整、wasi-libc の更新、WASI Preview 3 対応の作業が挙げられています。Preview 1 の同期実行を使う本段階では追加の対応を行いません。

### 圧縮した WASM 資材の復号

`zstd` v1.5.7 の `CHANGELOG` では圧縮 API の追加、圧縮速度の改善、32-bit 圧縮処理の修正などを確認しました。今回使うのは standalone decoder の `ZSTD_decompress` だけで、複数 frame を連結した入力も扱えます。生成 C はビルド時に `combine.py` で作り、BSD-3-Clause の条件を選びます。

`xz-embedded` v20240322 では、v20240124 以降の decoder、CRC、build 設定の変更と、0BSD への切り替えを確認しました。採用する `linux/lib/xz/` の CRC32、CRC64、stream、LZMA2 decoder は 0BSD です。CRC64 を有効にし、`XZ_SINGLE` で一つの stream を復号します。BCJ decoder は使いません。変更履歴は [v20240124 から v20240322 の比較](https://github.com/tukaani-project/xz-embedded/compare/v20240124...v20240322)を参照してください。

`gzip` は `DecompressionStream` で処理し、`zstd` と `xz` は WASI reactor の decoder を使います。decoder は `dist/lib/decoders/` に配置しますが、この段階では既存の資材取得経路を変更しません。

### 配信の大きさと配信先

開発初期には初回に読み込む資材を約 104〜115 MB（圧縮前）と見積もりました。この値は当時の未計測の概算として残し、2026-10-28 に Playwright の冷たい browser context で初回ビルド・書き込み時の成功 GET 応答本文を実測しています。配信先の候補の制限については、2026-10-27 に公式資料で確認しました。

| 配信先 | 1 ファイルの上限 | ヘッダーの設定 | 根拠 |
|---|---|---|---|
| Cloudflare Pages | 25 MiB（Free は 20,000 ファイル） | `_headers` で可 | [Limits](https://developers.cloudflare.com/pages/platform/limits/) |
| Cloudflare Workers Static Assets | 25 MiB | Worker で可 | [Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Cloudflare R2 | 5 TiB（`r2.dev` は試験用で、本番はカスタムドメイン） | Transform Rules など | [Limits](https://developers.cloudflare.com/r2/platform/limits/) |
| GitHub Pages | 資料に記載なし。サイト全体は 1 GB、帯域は月 100 GB（目安） | 不可 | [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |
| Vercel | 静的ファイルのアップロード合計が Hobby 100 MB、Pro 1 GB | `vercel.json` で可 | [Limits](https://vercel.com/docs/limits) |
| Firebase Hosting | 2 GB | `firebase.json` で可 | [FAQ](https://firebase.google.com/docs/hosting/faq-and-troubleshooting) |
| Netlify | 公式資料に記載なし（サポートの回答では 10 MB 以下を推奨） | `_headers` で可 | 未確認 |

`yosys.wasm`（52,926,660 bytes）と `nextpnr-himbaechel-gowin.wasm`（34,172,028 bytes）は、圧縮しないと Cloudflare Pages の 25 MiB を超えます。Cloudflare の自動圧縮は gzip、Brotli、zstd を返せ、`application/wasm` も対象です（[Compression](https://developers.cloudflare.com/speed/optimization/content/compression/)）。ただし対象は決まった Content-Type だけで、chipdb の `.bin` と tar は入りません。zstd は Compression Rules で有効にする必要があります。2026-10-27 に応答ヘッダーを確かめたところ、Cloudflare で配信している fpga.moe は zstd を優先して要求しても br を返し、GitHub Pages で配信している muromi.moe は gzip だけを返しました。GitHub Pages はヘッダーを設定できないため、書き込み部に必要な COOP/COEP は Service Worker で付けることになります。

配信先の自動圧縮に任せず、圧縮した資材を配ってブラウザーで展開する方式を [S4B](docs/experiments/S4B-compressed-assets.md) で比べました。gzip と互換の高圧縮では、libdeflate の最高レベルでも gzip -9 より約 5% 小さいだけでした。Zopfli も同じくらいの大きさで、圧縮に時間がかかります。zstd -19 は 20K の大きい 5 つの資材を 28.5 MB（gzip -9）から 19.2 MB に縮めます。Chromium 156 での展開は合計 359 ms で、gzip の `DecompressionStream`（673 ms）より速くなりました。xz -9e は zstd より 10% 小さいものの、展開に 2.2 秒かかります。50 Mbps での推定時間は gzip 5.23 秒、xz 4.98 秒、zstd 3.43 秒で、事前に決めた基準により zstd を採ります。Brotli は Chromium 156 の `DecompressionStream` で展開できないため、配信時の `Content-Encoding` にしか使えません。S4B の時点では配信先は未定でしたが、後続の S4C では Cloudflare Pages を目標にします。

S6 では zstd・xz 展開器の最適化を比較しました。OsLTO が最速でしたが、B より 3.224% の短縮にとどまり、凍結した 5% 基準を満たす候補はありませんでした。そのため B を維持し、既定 build は変更していません。LTO の zstd・xz WASM は `wasi_snapshot_preview1.random_get` を import するため、将来 LTO を既定にする場合は本番展開器にも対応が必要です。詳細は [S6 実験記録](docs/experiments/S6-decoder-build-options.md) を参照してください。

この実装では `manifest.json` を除く `dist/synth/` の資材を zstd 形式で配信する構成にしました。manifest の各項目には展開後の `size` と `sha256` に加えて `encoding: "zstd"`、`compressed_size`、`compressed_sha256` を記録します。ビルド Worker は圧縮前後のサイズと SHA-256 を検証し、展開後のデータを Cache Storage `gogo-fpga-synth-v1` に `new URL(path + "?sha256=" + sha256, synthURL)` のキーで保存します。実際のビルドで得た圧縮サイズの合計は、共有する 3 資材と各ボードの chipdb を合わせて Tang Nano 1K が 16,003,246 bytes、4K が 16,155,020 bytes、9K が 16,164,593 bytes、20K が 16,256,883 bytes です。最大の圧縮ファイルは `yosys.wasm.zst` の 9,448,361 bytes でした。

冷たい browser context で初回のビルドと fake USB 書き込みを行う Playwright 計測では、同一 origin の成功 GET 応答本文を集計しました。各ボードで 43 個の異なる要求パスがあり、合計は Tang Nano 1K が 33,408,160 bytes、4K が 33,559,934 bytes、9K が 33,569,507 bytes、20K が 33,661,797 bytes でした。内訳は次のとおりです。

| ボード | 要求パス数 | synth (bytes) | pack (bytes) | その他 (bytes) | 合計 (bytes) |
|---|---:|---:|---:|---:|---:|
| Tang Nano 1K | 43 | 16,016,710 | 14,219,198 | 3,172,252 | 33,408,160 |
| Tang Nano 4K | 43 | 16,168,484 | 14,219,198 | 3,172,252 | 33,559,934 |
| Tang Nano 9K | 43 | 16,178,057 | 14,219,198 | 3,172,252 | 33,569,507 |
| Tang Nano 20K | 43 | 16,270,347 | 14,219,198 | 3,172,252 | 33,661,797 |

合計にはページ、ビルド Worker、書き込み用資材とライブラリーも含みます。分類別の内訳は synth が manifest と zstd 資材、pack が manifest・圧縮資材・raw 資材、その他が画面と書き込み資材です。pack の配信では Pyodide の WASM と lock JSON を zstd にし、その他は raw のままにします。pack も shared verified loader で検証し、展開後の資材を Cache Storage `gogo-fpga-pack-v1` に SHA-256 を含むキーで保存します。実機では未確認で、配信先の目標は Cloudflare Pages です。ユーザーによる実機確認後に公開します。計測の詳細と集計値は [S4C](docs/experiments/S4C-cold-load-bytes.md) に記録しました。デプロイは行っていません。

NVC の確認元は[configure.ac](https://github.com/nickg/nvc/blob/058be4ccd39abefe3bcff455eb3964f4731a4a05/configure.ac)です。そこから確認できるのは LLVM の有効化条件と pthread、zlib、libffi、libzstd の検出です。LLVM を無効にした実行経路や WASM での動作は、まだ検証していません。

## 4. Emscripten のオプション

以下は合成・配置配線ツールの比較計画で、測定結果ではありません。書き込み部は移植元で使われていた JSPI と pthread の構成を維持します。合成・配置配線のツールは WebUSB を使わないため、JSPI と pthread は測定で必要性が示されない限り加えません。

| 項目 | 比較候補 | 方針 |
|---|---|---|
| 非同期 | なし / JSPI | 合成系はまずなし。書き込み部は JSPI を維持 |
| スレッド | なし / `-pthread` | 合成系はまずなし。nextpnr の並列化の効果を測る |
| 最適化 | `-O2`、`-O3`、`-Os`、`-flto` の有無 | ビルド可否、実行時間、成果物サイズを比較する |
| 例外 | `-fwasm-exceptions`、`WASM_LEGACY_EXCEPTIONS=0` | Yosys と nextpnr の C++ 例外を確認し、方式を比較する |
| メモリー | `ALLOW_MEMORY_GROWTH`、`MAXIMUM_MEMORY=4GB`、`STACK_SIZE=8MB` | 20K の配置配線で必要量を測る。Memory64 は対応ブラウザーを確認してから検討 |
| メモリー確保 | dlmalloc、emmalloc、mimalloc | 合成時の速度と最大メモリーを比較する |
| SIMD | `-msimd128` | 効果とブラウザー対応を測る |
| 出力形式 | `MODULARIZE`、`EXPORT_ES6`、`ENVIRONMENT=worker,node`、`INVOKE_RUN=0`、`EXIT_RUNTIME=1`、`STRICT` | Worker からの呼び出しや Node テストとの互換性を確認する |

比較時は同じ入力を使い、YoWASP の WASI 版とネイティブ版を基準にします。採否の条件は測定前に決め、繰り返しの値と生データを `docs/experiments/` に残します。手順は [実験記録の README](docs/experiments/README.md) を参照してください。

## 5. HDL ライブラリーと CPU コア

次の URL と revision は、[fpga-agent の HDL ライブラリー登録](https://github.com/VibeBB/fpga-agent/blob/76560989bf570fca1e0e3b864dd466251c210117/scripts/hdl_libraries.json)から転記しています。すべて T5 の候補で、T0 では取り込んでいません。

| 名前 | HDL | URL | revision | ライセンス |
|---|---|---|---|---|
| Colibri | VHDL | `https://gitlab.com/colibri-cern/colibri.git` | `3fa784121ccea86d9e65b2e0dc08d2a3327f5f2f` | CERN-OHL-W-2.0 |
| Open Logic | VHDL | `https://github.com/open-logic/open-logic.git` | `d9f123aae1c6022288782668067311f9794da0a2` | LGPL-2.1-or-later と PSI HDL exception |
| hdl-modules | VHDL | `https://github.com/hdl-modules/hdl-modules.git` | `8142d3a1d878651811427e609293946e699c5cb7` | BSD-3-Clause |
| verilog-axis | Verilog | `https://github.com/alexforencich/verilog-axis.git` | `48ff7a7e2ef782cf778d47910cf85835c64b1bce` | MIT |
| verilog-uart | Verilog | `https://github.com/alexforencich/verilog-uart.git` | `1b867e53af738e4a8bc7c839ca2f1c07f40382dc` | MIT |
| libfpga | Verilog | `https://github.com/libfpga/libfpga.git` | `a4ef4a3fa4ac1de6aa485baf3efc56f14a6df704` | MIT |
| SERV | Verilog | `https://github.com/olofk/serv.git` | `f200eb2ed7b69ac1c6b8eddd47654522aeee5ce8` | ISC |
| PicoRV32 | Verilog | `https://github.com/YosysHQ/picorv32.git` | `ef203c2b0a3fb793280f5114941416c425c5b461` | ISC |
| NEORV32 | VHDL | `https://github.com/stnolting/neorv32.git` | `84743cdbeefccb531f836d66933c8478f1d9bf71` | BSD-3-Clause |
| Hazard3 | Verilog | `https://github.com/Wren6991/Hazard3.git` | `8af992930f71a69b0e06c38734c1094f41a05ca0` | Apache-2.0 |
| VexRiscv (`pythondata-cpu-vexriscv`) | Verilog | `https://github.com/litex-hub/pythondata-cpu-vexriscv.git` | `642ecfed1c84460555d6d803d660cc60cfc1ecb6` | MIT |

ライセンスは、fpga-agent の [ADR-0004](https://github.com/VibeBB/fpga-agent/blob/76560989bf570fca1e0e3b864dd466251c210117/docs/adr/ADR-0004-external-hdl-libraries-colibri.md)、[ADR-0014](https://github.com/VibeBB/fpga-agent/blob/76560989bf570fca1e0e3b864dd466251c210117/docs/adr/ADR-0014-component-resolution-and-more-hdl-libraries.md)、[ADR-0015](https://github.com/VibeBB/fpga-agent/blob/76560989bf570fca1e0e3b864dd466251c210117/docs/adr/ADR-0015-cpu-core-libraries.md)に記録された値です。取り込み時には各 revision のライセンス本文も確認し、依存の pin とライセンスを checker の対象ファイルに記録します。

## 6. ライセンスとソース配布

本リポジトリー自体のライセンスは BSD-3-Clause です。第三者のソフトウェアのライセンスと配布時の表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) に記録します。

GHDL、NVC、Icarus Verilog など GPL のツールを WASM にビルドして Release に含める場合、対応するソースも配布します。ソースには対象 revision、適用したパッチ、ビルド手順を含め、WASM の生成内容を追跡可能にします。書き込み部から引き継ぐ source archive と再ビルド検査の仕組みを、後続ツールにも拡張する方針です。

配布前に、各ツールと HDL ライブラリーの正確なライセンス、改変の有無、ソース提供方法、著作権表示を確認します。各ツールを導入する際は、そのバージョンのライセンス本文を読み、義務を最終確認します。

## 7. 分割した調査

大きな調査は `docs/research/` に分けて置きます。

| 文書 | 内容 |
|---|---|
| [OSS の FPGA 開発環境と HDL ライブラリーの広域調査](docs/research/oss-survey.md) | ブラウザーで動く HDL ツールの先行例、HDL のツール、形式検証のソルバー、HDL ライブラリーと CPU コア（2026-10-26） |
| [エディターと AI 機能の調査](docs/research/editor-and-ai.md) | エディターの候補（CodeMirror 6、Monaco Editor、Ace など）の比較、AI 機能の接続方式（OpenRouter OAuth PKCE など）との相性（2026-10-26） |

## 8. 未確認の事項

- Tang Nano の IDCODE とフラッシュ情報の個体差。移植元の調査値はありますが、実機での照合はしていません。
- 合成・配置配線 WASM の実行可否、実行時間、メモリー量、成果物サイズ。YoWASP と synth-explorer の記録を本リポジトリーで再現していません。
- WASI SDK 33 での LTO とネイティブ WASM 例外の問題。synth-explorer の報告を確認しただけで、再現していません。
- GHDL WASM 化に必要なパッチと、本リポジトリーで対応する設計の範囲。合成から Verilog を出す経路は[広域調査](docs/research/oss-survey.md)の先行例を確認しましたが、こちらではまだ検証していません。
- NVC で `--disable-llvm` を指定したときの解釈実行経路と WASM 互換性。確認した `configure.ac` は LLVM を既定で有効にし、`--enable-llvm` を宣言しています。
- Apicula と Pyodide の組み合わせ、必要な Python 依存、実行時間、配布サイズ。
- VeriSim の Icarus Verilog 構成を本リポジトリーへ適用した場合の機能範囲と実行時間。
- Verilator 生成 C++ をブラウザー内でコンパイル・実行する方法。
- SymbiYosys / `yosys-smtbmc` の WASM 実行方法とライセンス。Yices2 / Z3 の API 統合と実行性能、Boolector のライセンスは未確認です。
- sv-elab の WASM 対応。
- Chromium 以外のブラウザー、実機 USB、4 ボードでの書き込み。
- GPL ツールおよび HDL ライブラリーを配布する際の、各 revision に固有のソース提供・表示義務。
