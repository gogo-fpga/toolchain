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

IDCODE と書き込み先は、[移植元の RESEARCH.md](https://github.com/gogo-fpga/flasher/blob/dcbeb67/RESEARCH.md) に記録された値です。nextpnr の device / family 名は Apicula の README と wiki で確認しました。C 品種では `gowin_pack -d` に device 名ではなく family 名を渡します。詳細と出典は[7 節](#oss-fpga-survey)を参照してください。実機の Tang Nano では試していません。

## 2. 午後のFPGA Web Flasher から引き継ぐ知見

書き込み部は、[午後のFPGA Web Flasher](https://github.com/gogo-fpga/flasher) のコード、ビルド、テストを基礎にします。移植元の調査記録は[RESEARCH.md](https://github.com/gogo-fpga/flasher/blob/dcbeb67/RESEARCH.md)です。実験記録はコピーせず、[S0](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S0-wasm-build.md)、[S1a](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S1a-program-sim.md)、[S1b](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S1b-option-matrix.md)、[S2](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S2-ci-sim-environment.md)、[S3](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S3-ci-speed.md)を参照してください。

- openFPGALoader v1.2.0 と libusb、libftdi、zlib を Emscripten 6.0.13 でビルドしています。
- JSPI と `-fwasm-exceptions` を組み合わせる構成で書き込み部を動かしています。libusb の WebUSB バックエンドは pthread と共有メモリーを必要とし、配信には COOP/COEP ヘッダーを使います。
- upstream の openFPGALoader は、失敗時にログへ `FAIL` を出しても終了コード 0 を返す場合があります。終了コードだけで成否を判断しません。
- 仮想 FT2232、GOWIN TAP、NOR フラッシュを使ったテストがあり、故障注入による負の対照も行っています。仮想デバイスの結果は実機の検証ではありません。

これらは移植元の記録に基づく知見です。新しい Emscripten やブラウザーでの再検証は、このリポジトリーではまだ実施していません。

書き込み部の submodule commit は次のとおりです。pin checker がこの表と gitlink の一致を検査します。

| 依存 | 版 | commit | 取得元 |
|---|---|---|---|
| openFPGALoader | v1.2.0 | `befbab4f646207dbaf1daf8b144dd980ad283dd5` | `https://github.com/trabucayre/openFPGALoader.git` |
| libusb | v1.0.30 | `87a55632db62c9bdc58cd31d3ccfa673f1bb017f` | `https://github.com/libusb/libusb.git` |
| libftdi | 1.6rc1 | `92d657bcb543a9622947d984d4a8e725fb680e8c` | `git://developer.intra2net.com/libftdi` |
| zlib | v1.3.2 | `da607da739fa6047df13e66a2af6b8bec7c2a498` | `https://github.com/madler/zlib.git` |
| emsdk | 6.0.13 | `35659964bc2762fffec0d257997fb61475f765b7` | `https://github.com/emscripten-core/emsdk.git` |
| yomiyasu | 未確認 | `552c12c472ddfb79e2ee7a15219847782686a945` | `https://github.com/nanaism/yomiyasu.git` |

## 3. ツールの WASM 化方針

T0 では書き込み部だけが実装されています。合成、配置配線、シミュレーション、形式検証は後続段階で、upstream のコードを WASM にビルドして使います。機能を手作業で移植しません。upstream へのパッチが避けられない場合は `patches/` に保管し、理由と範囲を本書に記録します。

| ツール | 主な言語 | ライセンス | 確認した WASM の事例 | 方針と段階 |
|---|---|---|---|---|
| Yosys + ABC | C、C++ | Yosys: ISC。ABC: 未確認 | [YoWASP](https://yowasp.org/) は Yosys を WASI で提供。[synth-explorer](https://github.com/cachanova/synth-explorer) は WASI SDK 33 で合成用 Yosys を構築 | T2。YoWASP とネイティブ版を比較し、必要な `synth_gowin` を含む upstream ビルドを検証する |
| GHDL | Ada、C | GPL-2.0-or-later | [synth-explorer](https://github.com/cachanova/synth-explorer) は GHDL 5.0.1 で合成し、Verilog を別 Worker の Yosys に渡す。[ghdl-browser](https://github.com/UnsignedChad/ghdl-browser) と [ghdl-wasm](https://github.com/UnsignedChad/ghdl-wasm) は解析・シミュレーションの事例 | T3。`--synth --out=verilog` で Verilog に変換し、Yosys に渡す。GPL-3.0 の ghdl-yosys-plugin は Yosys WASM に組み込まず、ISC の Yosys を保つ。詳しくは[7 節](#oss-fpga-survey)を参照 |
| nextpnr-himbaechel（Gowin） | C++ | ISC | [YoWASP](https://yowasp.org/) が nextpnr の WASI 版を提供 | T2。必要な Gowin device database のみを含め、4 ボードの配置配線を検証する |
| Apicula / `gowin_pack` | Python | Apicula: MIT。Pyodide: MPL-2.0 | この調査では Apicula のブラウザー実行例を確認できていない | T2。Apicula を Pyodide 上で実行する案を試し、依存、実行時間、配布サイズを測る |
| openFPGALoader | C++ | Apache-2.0 | 移植元で Emscripten と WebUSB による WASM 化を実装 | T0 の書き込み部として移植済み。以降も upstream のソースを使う |
| NVC | C | GPL-3.0-or-later | この調査では WASM 版を確認できていない | T4。LLVM なしの解釈実行を調査する。`configure.ac` は `--enable-llvm` を宣言し、LLVM を既定で有効にする。依存は pthread、zlib、libffi、libzstd |
| Icarus Verilog (`iverilog` / `vvp`) | C | GPL-2.0 | [VeriSim](https://github.com/senolgulgonul/verisim) が Emscripten で `ivlpp`、`ivl`、`vvp` を個別に WASM 化 | T4。3 つの WASM を JavaScript で順番に呼ぶ方式を基礎にする。詳しくは[7 節](#oss-fpga-survey)を参照 |
| Verilator | C++ | LGPL-3.0 | [tiny-tpu](https://github.com/deaneeth/tiny-tpu) は事前ビルドした WASM を配布。ブラウザー内で C++ をコンパイルする例ではない | 将来。生成コードを実行する C++ コンパイラーをブラウザー内で用意する方法が必要。詳しくは[7 節](#oss-fpga-survey)を参照 |
| SymbiYosys / `yosys-smtbmc` | Python | 未確認 | YoWASP の Yosys は確認したが、Python 側の WASM 実行例は未確認 | T6。Yosys と Python 側の実行環境を分けて検証する |
| Yices2 | C | GPL-3.0 | 非公式の WASM パッケージと wasi-libc の制約を報告した issue がある | T6。ライセンスと issue は[7 節](#oss-fpga-survey)を参照し、Emscripten 版を含めビルドと実行を検証する |
| Z3 | C++ | MIT | 公式 npm [`z3-solver`](https://www.npmjs.com/package/z3-solver) 5.3.2 が WASM を含む | T6。公式パッケージの API と solver の実行時間を小さな証明で測る。詳しくは[7 節](#oss-fpga-survey)を参照 |
| Boolector | C | 未確認 | YoWASP が WASI 版を配布 | T6。ライセンスと必要な API、solver の実行時間を確認する。詳しくは[7 節](#oss-fpga-survey)を参照 |
| [sv-elab（旧 yosys-slang）](https://github.com/povik/sv-elab) | C++ | ISC | この調査では WASM 版を確認できていない | 将来。SystemVerilog 対応の段階で調査する。詳しくは[7 節](#oss-fpga-survey)を参照 |

[synth-explorer の Yosys ビルド記録](https://github.com/cachanova/synth-explorer/blob/main/tools/yosys-wasm/README.md)は、WASI SDK 33 で LTO とネイティブ WASM 例外を組み合わせたときの symbol type failure を避けるため、LTO を無効にしたと報告しています。この問題を本リポジトリーで再現したわけではありません。

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

## 7. OSS の FPGA 開発環境と HDL ライブラリーの広域調査（2026-10-26）

<a id="oss-fpga-survey"></a>

fpga-agent が採用したものに限らず、OSS の FPGA 開発環境、ブラウザーで動く HDL ツール、HDL ライブラリーを調べました。ライセンスと版は、各リポジトリーの LICENSE、GitHub・GitLab の API の表示、公開ページで確かめたものだけを書き、確かめていないものは「未確認」とします。

### ブラウザーで動く HDL ツールの先行例

| 名前 | 内容 | WASM 化の方法 | ライセンス | 本リポジトリへの示唆 |
|---|---|---|---|---|
| [YoWASP](https://yowasp.org/) | Yosys・nextpnr・openFPGALoader などを WASM で配布 | Yosys・nextpnr は wasi-sdk。[`@yowasp/openfpgaloader`](https://www.npmjs.com/package/@yowasp/openfpgaloader) は Emscripten で WebUSB 対応（0.13.1-105.120） | パッケージは ISC | 速度・出力の比較基準にする。Yosys の npm 版は `0.70.62-dev.1236` まで公開されている（npm の表示） |
| [VeriSim](https://github.com/senolgulgonul/verisim) | Icarus Verilog をブラウザーで実行 | Emscripten。`ivlpp`・`ivl`・`vvp` を別々の WASM にし、`iverilog` ドライバーの代わりに JavaScript で 3 段を順に呼び、MEMFS でファイルを渡す（`dlopen` と子プロセスがないため） | GPL-2.0 | T4 の Icarus Verilog は、この構成（3 モジュール + JS で順に呼ぶ）を基本にする |
| [DigitalJS](https://github.com/tilk/digitaljs) / [DigitalJS Online](https://digitaljs.tilk.eu/) | Yosys の合成結果を論理回路図としてブラウザーで動かす | Yosys（WASM）+ yosys2digitaljs。Amaranth（WASM）も扱える | BSD-2-Clause（GitHub の表示） | 回路図表示と、学習向けの「合成結果を見る」機能の参考 |
| [8bitworkshop](https://8bitworkshop.com/docs/platforms/verilog/index.html) | ブラウザーの Verilog IDE | Verilog を JavaScript または WASM に変換して実行（文書の記述） | GPL-3.0 | 初心者向け IDE の操作の参考。Verilator の仕組みは未確認 |
| [synth-explorer](https://github.com/cachanova/synth-explorer) | VHDL-2008 → GHDL 合成 → Verilog → Yosys をブラウザーで実行 | GHDL は AdaWebPack + GNAT-LLVM、Yosys は WASI SDK 33 | Apache-2.0 | T3 の GHDL の第一候補 |
| [ghdl-browser](https://github.com/UnsignedChad/ghdl-browser) | ブラウザーで GHDL によるシミュレーション | WAT 出力のバックエンド | GPL-2.0 | 既知の問題（`NUMERIC_STD` で境界外アクセスなど）があり、採用は保留 |
| [Surfer](https://gitlab.com/surfer-project/surfer) | 波形ビューアー。Web 版（https://app.surfer-project.org/）がある | Rust → WASM | EUPL-1.2（GitLab の表示） | T4 の波形表示の候補。README によると Web 版はネイティブ版より遅く、一部機能がない |

### HDL のツール（言語処理、変換、検証、ビルド）

| 名前 | 役割 | ライセンス | ブラウザーでの扱い（案） |
|---|---|---|---|
| [GHDL](https://ghdl.github.io/ghdl/using/Synthesis.html) | VHDL の解析・シミュレーション・合成（`--synth`、`--out=verilog` で Verilog を出力） | GPL-2.0-or-later | T3。plugin を使わず `--synth --out=verilog` で Verilog に変換し、Yosys に渡す |
| [ghdl-yosys-plugin](https://github.com/ghdl/ghdl-yosys-plugin) | Yosys から GHDL を呼ぶ plugin | GPL-3.0（LICENSE）。GHDL の議論では「Yosys に組み込むと Yosys が GPL になる」と書かれている | ブラウザーでは動的読み込みができず組み込みになるため、ISC の Yosys を保つ目的で使わない |
| [NVC](https://github.com/nickg/nvc) | VHDL シミュレーター | GPL-3.0-or-later | T4。`--disable-llvm` で解釈実行にして Emscripten で WASM 化 |
| [Icarus Verilog](https://github.com/steveicarus/iverilog) | Verilog シミュレーター | GPL-2.0 | T4。VeriSim の構成 |
| Verilator | Verilog/SystemVerilog を C++ に変換 | LICENSE は LGPL-3.0 | 生成した C++ をブラウザーで翻訳する手段がないため将来。先行例 [tiny-tpu](https://github.com/deaneeth/tiny-tpu) は、事前にネイティブで変換・Emscripten でビルドした WASM を配る形で、IDE には向かない |
| [sv-elab（旧 yosys-slang）](https://github.com/povik/yosys-slang) | SystemVerilog を Yosys 用のネットリストに展開 | ISC（GitHub の表示、`povik/sv-elab` へ移転済み） | 将来の SystemVerilog 対応の第一候補 |
| [sv2v](https://github.com/zachjs/sv2v) | SystemVerilog → Verilog-2005 変換 | BSD-3-Clause | 将来の候補。Haskell 製のため WASM 化は未確認 |
| [Verible](https://chipsalliance.github.io/verible/license.html) | SystemVerilog の構文解析・整形・lint | Apache-2.0 | Verilog の lint・整形の候補（WASM 化は未確認） |
| [rust_hdl（vhdl_ls）](https://github.com/VHDL-LS/rust_hdl) | VHDL の言語サーバー（Rust、20 万行を 160 ms で解析と README に記載） | MPL-2.0 | エディターでの即時の診断・補完の候補。Rust なので WASM 化しやすいと見込む（仮説） |
| [Amaranth HDL](https://amaranth-lang.org/docs/amaranth/v0.4.5/platform/gowin.html) | Python の HDL。`GowinPlatform` で Apicula を使える | BSD-2-Clause | 将来。Pyodide で動かせる可能性（DigitalJS Online が WASM で扱う） |
| [LiteX](https://github.com/litex-hub/litex-boards/blob/master/litex_boards/targets/sipeed_tang_nano_20k.py) | SoC 生成。Tang Nano 20K の target がある | BSD-2-Clause | 将来。CPU コアを使う SoC の参考 |
| [FuseSoC / Edalize](https://fusesoc.readthedocs.io/en/stable/user/build_system/index.html) | IP コアの管理とツールの呼び分け | BSD-2-Clause（FuseSoC・Edalize とも） | ライブラリーの依存記述（`.core`）の形式を参考にする |
| [VUnit](https://github.com/VUnit/vunit/blob/master/LICENSE.rst) | VHDL のテスト枠組み（Python） | MPL-2.0（OSVVM を同梱） | 将来。Python の実行部は Pyodide 前提 |
| [cocotb](https://www.cocotb.org/) | Python によるテストベンチ | BSD-3-Clause | 将来。シミュレーターと VPI でつなぐ必要があり難度が高い |
| [CIRCT arcilator](https://circt.llvm.org/) | CIRCT のサイクル精度シミュレーター | 未確認 | 調査のみ。LLVM でネイティブコードを作るためブラウザーには向かない（仮説） |

### 形式検証のソルバー

| 名前 | WASM の状況 | ライセンス |
|---|---|---|
| Z3 | 公式の npm [`z3-solver`](https://www.npmjs.com/package/z3-solver)（5.3.2）が WASM を含む | MIT |
| Yices 2 | 非公式の WASM パッケージがある。wasi-libc では `alarm` が未定義になり、`setjmp`/`longjmp` の除去が必要だった報告がある（[wasi-libc#459](https://github.com/WebAssembly/wasi-libc/issues/459)） | GPL-3.0（`SRI-CSL/yices2`） |
| Boolector / Bitwuzla | YoWASP が Boolector を配布（RESEARCH の前節）。Bitwuzla の WASM は未確認 | 未確認 |

Emscripten なら `setjmp`/`longjmp` と `alarm` 相当を用意できるため、Yices 2 は Emscripten のほうが楽だと見込みます（仮説。T6 で確かめる）。

### Gowin 向けの補足（Apicula の README と wiki）

- [Apicula の wiki](https://github.com/YosysHQ/apicula/wiki/Nextpnr%E2%80%90Himbaechel-Gowin) は 4 ボードの device を次のように示しています。1K は `GW1NZ-LV1QN48C6/I5`、4K は `GW1NSR-LV4CQN48PC7/I6`、9K は `GW1NR-LV9QN88PC6/I5`（`--vopt family=GW1N-9C`）、20K は `GW2AR-LV18QN88C8/I7`（`--vopt family=GW2A-18C`）。
- 「C」付きの品種では、nextpnr に `--device` と `--vopt family` の両方を渡し、`gowin_pack -d` には device ではなく family を渡します（Apicula README の注記）。ボード定義にはこの 2 つを別々に持たせます。
- Sipeed の公式サンプル（例：[TangNano-20K-example](https://github.com/sipeed/TangNano-20K-example)、[TangNano-9K-example](https://github.com/sipeed/TangNano-9K-example)）は、ピン割り当ての出典とテンプレートの参考にします。ライセンスは未確認です。

### HDL ライブラリーと CPU コア（fpga-agent 以外）

| 名前 | 言語 | 内容 | ライセンス | 扱い |
|---|---|---|---|---|
| [PoC](https://github.com/VHDL/PoC) | VHDL | 汎用部品（FIFO、算術、通信など） | Apache-2.0 | T5 の候補 |
| [surf](https://github.com/slaclab/surf/) | VHDL | SLAC の大規模ライブラリー | 独自（GitHub の表示は Other） | 条件を読んでから判断 |
| [en_cl_fix](https://github.com/enclustra/en_cl_fix/) | VHDL（Python・MATLAB も） | 固定小数点演算 | MIT | T5 の候補 |
| OSVVM / UVVM | VHDL | 検証用ライブラリー | どちらも Apache-2.0 | シミュレーション用。T4/T5 で検討 |
| [verilog-ethernet](https://github.com/alexforencich/verilog-ethernet) | Verilog | Ethernet 部品 | MIT | Tang Nano には Ethernet がないため優先度は低い |
| [wb2axip](https://github.com/ZipCPU/wb2axip/) | Verilog | バスのブリッジ（形式検証つき） | 未確認 | 形式検証の題材の候補 |
| [common_cells](https://github.com/pulp-platform/common_cells) | SystemVerilog | PULP の基本部品 | 独自（GitHub の表示は Other） | SystemVerilog 対応後 |
| [BaseJump STL](https://github.com/bespoke-silicon-group/basejump_stl) | SystemVerilog | SystemVerilog の部品集 | 独自（GitHub の表示は Other） | SystemVerilog 対応後 |
| [Ibex](https://lowrisc.org/ibex/) | SystemVerilog | RISC-V コア | Apache-2.0 | SystemVerilog 対応後 |

### この調査で計画に反映すること

1. VHDL の合成は ghdl-yosys-plugin を使わず、GHDL の `--synth --out=verilog` で Verilog を作って Yosys に渡す。Yosys の WASM を ISC のまま保ち、GHDL（GPL）は別の WASM に分ける。synth-explorer も同じ分け方をしている。
2. Icarus Verilog は VeriSim と同じく 3 つの WASM と JavaScript による順次実行にする。
3. ボード定義には nextpnr の `device` と `family`、`gowin_pack` に渡す名前を別々に持たせる。
4. 波形表示は Surfer（EUPL-1.2）の Web 版の組み込みを先に調べ、ライセンスと大きさが合わなければ自作の軽い表示にする。
5. エディターでの即時の VHDL 診断に rust_hdl（vhdl_ls）を、Verilog には Verible を候補として、T1 以降で WASM 化を試す。

## 8. 未確認の事項

- Tang Nano の IDCODE とフラッシュ情報の個体差。移植元の調査値はありますが、実機での照合はしていません。
- 合成・配置配線 WASM の実行可否、実行時間、メモリー量、成果物サイズ。YoWASP と synth-explorer の記録を本リポジトリーで再現していません。
- WASI SDK 33 での LTO とネイティブ WASM 例外の問題。synth-explorer の報告を確認しただけで、再現していません。
- GHDL WASM 化に必要なパッチと、本リポジトリーで対応する設計の範囲。合成から Verilog を出す経路は[7 節](#oss-fpga-survey)の先行例を確認しましたが、こちらではまだ検証していません。
- NVC で `--disable-llvm` を指定したときの解釈実行経路と WASM 互換性。確認した `configure.ac` は LLVM を既定で有効にし、`--enable-llvm` を宣言しています。
- Apicula と Pyodide の組み合わせ、必要な Python 依存、実行時間、配布サイズ。
- VeriSim の Icarus Verilog 構成を本リポジトリーへ適用した場合の機能範囲と実行時間。
- Verilator 生成 C++ をブラウザー内でコンパイル・実行する方法。
- SymbiYosys / `yosys-smtbmc` の WASM 実行方法とライセンス。Yices2 / Z3 の API 統合と実行性能、Boolector のライセンスは未確認です。
- sv-elab の WASM 対応。
- Chromium 以外のブラウザー、実機 USB、4 ボードでの書き込み。
- GPL ツールおよび HDL ライブラリーを配布する際の、各 revision に固有のソース提供・表示義務。
