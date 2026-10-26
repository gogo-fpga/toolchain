# 午後のFPGA Web Toolchain 調査記録

## 1. 目的と対象ボード

本リポジトリーは、ブラウザー内で VHDL と Verilog の設計、論理合成、配置配線、ビットストリーム作成、Tang Nano への書き込みを行う Web IDE を目指します。サーバーへ設計データを送らない構成を計画しています。T0 では、午後のFPGA Web Flasher から書き込み部を移植した段階で、IDE の機能はまだありません。

対象は Tang Nano 1K、4K、9K、20K です。FPGA の内蔵 SRAM に構成を書き込めることを、ユーザー指定の選定理由としています。ボード名、FPGA、openFPGALoader のボード名、IDCODE、書き込み先は移植元の調査記録を引き継ぎます。

| ボード | FPGA | openFPGALoader 名 | IDCODE | 書き込み先 | nextpnr-himbaechel device / family（予定） |
|---|---|---|---|---|---|
| Tang Nano 1K | GW1NZ-1 | `tangnano1k` | `0x0100681B` | SRAM、内蔵フラッシュ | `GW1NZ-LV1QN48C6/I5` / `GW1NZ-1`（実装時に Apicula で確認する） |
| Tang Nano 4K | GW1NSR-4C | `tangnano4k` | `0x0100981B` | SRAM、内蔵フラッシュ | `GW1NSR-LV4CQN48PC7/I6` / `GW1NS-4`（実装時に Apicula で確認する） |
| Tang Nano 9K | GW1NR-9C | `tangnano9k` | `0x0100481B`（`0x0100581B` の個体もある） | SRAM、内蔵フラッシュ | `GW1NR-LV9QN88PC6/I5` / `GW1N-9C`（実装時に Apicula で確認する） |
| Tang Nano 20K | GW2AR-18C | `tangnano20k` | `0x0000081B` | SRAM、外付け SPI フラッシュ | `GW2AR-LV18QN88C8/I7` / `GW2A-18C`（実装時に Apicula で確認する） |

IDCODE と書き込み先は、[移植元の RESEARCH.md](https://github.com/gogo-fpga/flasher/blob/dcbeb67/RESEARCH.md) に記録された値です。nextpnr の device / family 名は計画上の候補であり、Apicula の device profile と nextpnr のソースで未確認です。実機の Tang Nano では試していません。

## 2. 午後のFPGA Web Flasher から引き継ぐ知見

書き込み部は、[午後のFPGA Web Flasher](https://github.com/gogo-fpga/flasher) のコード、ビルド、テストを基礎にします。移植元の調査記録は[RESEARCH.md](https://github.com/gogo-fpga/flasher/blob/dcbeb67/RESEARCH.md)です。実験記録はコピーせず、[S0](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S0-wasm-build.md)、[S1a](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S1a-program-sim.md)、[S1b](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S1b-option-matrix.md)、[S2](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S2-ci-sim-environment.md)、[S3](https://github.com/gogo-fpga/flasher/blob/dcbeb67/docs/experiments/S3-ci-speed.md)を参照してください。

- openFPGALoader v1.2.0 と libusb、libftdi、zlib を Emscripten 6.0.13 でビルドしています。
- JSPI と `-fwasm-exceptions` を組み合わせる構成で書き込み部を動かしています。libusb の WebUSB バックエンドは pthread と共有メモリーを必要とし、配信には COOP/COEP ヘッダーを使います。
- upstream の openFPGALoader は、失敗時にログへ `FAIL` を出しても終了コード 0 を返す場合があります。終了コードだけで成否を判断しません。
- 仮想 FT2232、GOWIN TAP、NOR フラッシュを使ったテストがあり、故障注入による負の対照も行っています。仮想デバイスの結果は実機の検証ではありません。

これらは移植元の記録に基づく知見です。新しい Emscripten やブラウザーでの再検証は、このリポジトリーではまだ実施していません。

## 3. ツールの WASM 化方針

T0 では書き込み部だけが実装されています。合成、配置配線、シミュレーション、形式検証は後続段階で、upstream のコードを WASM にビルドして使います。機能を手作業で移植しません。upstream へのパッチが避けられない場合は `patches/` に保管し、理由と範囲を本書に記録します。

| ツール | 主な言語 | ライセンス | 確認した WASM の事例 | 方針と段階 |
|---|---|---|---|---|
| Yosys + ABC | C、C++ | Yosys: ISC。ABC: 未確認 | [YoWASP](https://yowasp.org/) は Yosys を WASI で提供。[synth-explorer](https://github.com/cachanova/synth-explorer) は WASI SDK 33 で合成用 Yosys を構築 | T2。YoWASP とネイティブ版を比較し、必要な `synth_gowin` を含む upstream ビルドを検証する |
| GHDL、ghdl-yosys-plugin | Ada、C | GPL-2.0-or-later | [synth-explorer の GHDL 合成](https://github.com/cachanova/synth-explorer/blob/main/tools/ghdl-wasm/README.md)は GHDL 5.0.1 の解析、精緻化、合成を WASM 化し、汎用 Verilog を別 Worker の Yosys に渡す。[ghdl-browser](https://github.com/UnsignedChad/ghdl-browser) と [ghdl-wasm](https://github.com/UnsignedChad/ghdl-wasm) はブラウザー内の解析・シミュレーション事例で、合成フローとは別 | T3。ghdl-yosys-plugin 経由と、GHDL 合成から Verilog を出して Yosys に渡す経路を比較する |
| nextpnr-himbaechel（Gowin） | C++ | ISC | [YoWASP](https://yowasp.org/) が nextpnr の WASI 版を提供 | T2。必要な Gowin device database のみを含め、4 ボードの配置配線を検証する |
| Apicula / `gowin_pack` | Python | Apicula: MIT。Pyodide: MPL-2.0 | この調査では Apicula のブラウザー実行例を確認できていない | T2。Apicula を Pyodide 上で実行する案を試し、依存、実行時間、配布サイズを測る |
| openFPGALoader | C++ | Apache-2.0 | 移植元で Emscripten と WebUSB による WASM 化を実装 | T0 の書き込み部として移植済み。以降も upstream のソースを使う |
| NVC | C | GPL-3.0-or-later | この調査では WASM 版を確認できていない | T4。LLVM なしの解釈実行を調査する。`configure.ac` は `--enable-llvm` を宣言し、LLVM を既定で有効にする。依存は pthread、zlib、libffi、libzstd |
| Icarus Verilog (`iverilog` / `vvp`) | C | 未確認 | この調査では WASM 版を確認できていない | T4。テストベンチ実行と VCD 出力をブラウザー内で検証する |
| Verilator | C++ | 未確認 | この調査ではブラウザー内で C++ をコンパイルして実行する例を確認できていない | 将来。生成コードを実行する C++ コンパイラーをブラウザー内で用意する方法が必要 |
| SymbiYosys / `yosys-smtbmc` | Python | 未確認 | YoWASP の Yosys は確認したが、Python 側の WASM 実行例は未確認 | T6。Yosys と Python 側の実行環境を分けて検証する |
| Yices2 | C | 未確認 | この調査では WASM 版を確認できていない | T6。ビルド、実行速度、ブラウザーでのメモリー使用量を調査する |
| Z3 | C++ | 未確認 | この調査では WASM 版を確認できていない | T6。必要な API と solver の実行時間を小さな証明で測る |
| Boolector | C | 未確認 | この調査では WASM 版を確認できていない | T6。必要な API と solver の実行時間を小さな証明で測る |
| yosys-slang | C++ | 未確認 | この調査では WASM 版を確認できていない | 将来。SystemVerilog 対応の段階で調査する |

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

## 7. 未確認の事項

- nextpnr-himbaechel の device / family 名、4 ボードの chip database、Apicula の device profile との対応。
- Tang Nano の IDCODE とフラッシュ情報の個体差。移植元の調査値はありますが、実機での照合はしていません。
- 合成・配置配線 WASM の実行可否、実行時間、メモリー量、成果物サイズ。YoWASP と synth-explorer の記録を本リポジトリーで再現していません。
- WASI SDK 33 での LTO とネイティブ WASM 例外の問題。synth-explorer の報告を確認しただけで、再現していません。
- GHDL の WASM 化に必要なパッチ、ghdl-yosys-plugin と GHDL 合成のどちらを使うか、対応する設計の範囲。
- NVC で `--disable-llvm` を指定したときの解釈実行経路と WASM 互換性。確認した `configure.ac` は LLVM を既定で有効にし、`--enable-llvm` を宣言しています。
- Apicula と Pyodide の組み合わせ、必要な Python 依存、実行時間、配布サイズ。
- Icarus Verilog、Verilator、SymbiYosys、yosys-smtbmc、Yices2、Z3、Boolector、yosys-slang の WASM 対応と、表で未確認としたライセンス。
- Chromium 以外のブラウザー、実機 USB、4 ボードでの書き込み。
- GPL ツールおよび HDL ライブラリーを配布する際の、各 revision に固有のソース提供・表示義務。
