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

書き込み部は午後のFPGA Web Flasherを基礎にし、JSPI、pthread、WebUSBを使います。終了コード0でもログの `FAIL` を拒否し、仮想USBの結果を実機確認と扱いません。移植元の知見、S7の既定ビルド選定とhash照合、asyncifyのlink失敗・バイト一致未確認は、[書き込み部の移植とビルド選定](docs/research/flasher-integration.md)に原典とともに保持しました。

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
| iverilog | v13_0 | `dfeee909ed9f20b4870dd93423156c0170c0e1ff` | `https://github.com/steveicarus/iverilog.git` |
| surfer | v0.7.0 | `bd749b1f786c1c62cd67893ca71346cbe6983915` | `https://gitlab.com/surfer-project/surfer.git` |
| sby | snapshot | `79fc9eddca5e33a28cc2f2cd19c9825efd9a7255` | `https://github.com/YosysHQ/sby.git` |
| yices2 | yices-2.7.0 | `85cf17e44eac76b5d14b297c09fc9bfecf47ef65` | `https://github.com/SRI-CSL/yices2.git` |
| z3 | z3-5.3.3 | `430d19e697e2ec9bad79ff210d41b4a7a5fcfa3e` | `https://github.com/Z3Prover/z3.git` |
| boolector | 3.2.4 | `393cdfba3735d334bb4e6525500b8a0280dd41e6` | `https://github.com/Boolector/boolector.git` |
| bitwuzla | 0.9.1 | `8d1eb01093ae54d9b4586456b69c3bf31000a4c2` | `https://github.com/bitwuzla/bitwuzla.git` |
| click | 8.3.1 | `1d038f270701498433cb432f54db89f95f07a845` | `https://github.com/pallets/click.git` |

WASI SDK の固定値は pin checker とビルドスクリプトが読む次の表を正とします。

| 依存 | 版 | SHA-256 | 取得元 |
|---|---|---|---|
| wasi-sdk | 34.0 | `b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4` | `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz` |
| boost | 1.92.0 | `ea7b982002cc9dfbe59b0b217b206f470dc75f3de0bb2973d844118934d82411` | `https://github.com/boostorg/boost/releases/download/boost-1.92.0/boost-1.92.0-b2-nodocs.tar.xz` |
| eigen | 5.0.1 | `e9c326dc8c05cd1e044c71f30f1b2e34a6161a3b6ecf445d56b53ff1669e3dec` | `https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz` |
| adawebpack | 24.0.0 | `8edaae8b9987a20aec430d750f30033f12f953ce2b6437afb87fbf8cc1063796` | `https://github.com/godunko/adawebpack/releases/download/24.0.0/adawebpack-24.0.0.tar.gz` |
| gmp | 6.3.0 | `a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898` | `https://ftp.gnu.org/gnu/gmp/gmp-6.3.0.tar.xz` |

Surfer WASM build tools:

| Tool | Version | SHA-256 | URL |
|---|---|---|---|
| rust | 1.99.1 | - | `https://static.rust-lang.org/dist/channel-rust-stable.toml` |
| trunk | 0.21.14 | `f2b4680cd239693a646a2795e4633c625328d7b2a044fbe749fa3a2fe9e7036b` | `https://github.com/trunk-rs/trunk/releases/download/v0.21.14/trunk-x86_64-unknown-linux-gnu.tar.gz` |
| wasm-bindgen-cli | 0.2.118 | `00b519c9fc2d6e087265da1a00f29160bfcc6a823993482bc2e691910287427b` | `https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.118/wasm-bindgen-0.2.118-x86_64-unknown-linux-musl.tar.gz` |
| binaryen | version_123 | `e959f2170af4c20c552e9de3a0253704d6a9d2766e8fdb88e4d6ac4bae9388fe` | `https://github.com/WebAssembly/binaryen/releases/download/version_123/binaryen-version_123-x86_64-linux.tar.gz` |

libftdi は `developer.intra2net.com` に Dependabot が接続できないため、`.gitmodules` の URL と branch から upstream 先端を調べ、「固定版の更新確認」ワークフローで監視します。

## 3. ツールの WASM 化方針

T0 では書き込み部だけが実装されています。合成、配置配線、シミュレーション、形式検証は後続段階で、upstream のコードを WASM にビルドして使います。機能を手作業で移植しません。upstream へのパッチが避けられない場合は `patches/` に保管し、理由と範囲を本書に記録します。

| ツール | 主な言語 | ライセンス | 確認した WASM の事例 | 方針と段階 |
|---|---|---|---|---|
| Yosys + ABC | C、C++ | Yosys: ISC。ABC: Berkeley の許諾条件 | [YoWASP](https://yowasp.org/) は Yosys を WASI で提供。[synth-explorer](https://github.com/cachanova/synth-explorer) は WASI SDK 33 で合成用 Yosys を構築 | T2。YoWASP とネイティブ版を比較し、必要な `synth_gowin` を含む upstream ビルドを検証する |
| GHDL | Ada、C | GPL-2.0-or-later | [synth-explorer](https://github.com/cachanova/synth-explorer) は GHDL 5.0.1 で合成し、Verilog を別 Worker の Yosys に渡す | T3。`--synth --out=verilog` で Verilog に変換し、Yosys に渡す。GPL-3.0 の ghdl-yosys-plugin は Yosys WASM に組み込まず、ISC の Yosys を保つ。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| nextpnr-himbaechel（Gowin） | C++ | ISC | [YoWASP](https://yowasp.org/) が nextpnr の WASI 版を提供 | T2。必要な Gowin device database のみを含め、4 ボードの配置配線を検証する |
| Apicula / `gowin_pack` | Python | Apicula: MIT。Pyodide: MPL-2.0 | S3 で Node.js/Pyodide の native parity を確認し、配布 wheel を追加する。Worker は S4 | S3。4ボードの `.fs` 一致、実行時間、配布サイズを測定する |
| openFPGALoader | C++ | Apache-2.0 | 移植元で Emscripten と WebUSB による WASM 化を実装 | T0 の書き込み部として移植済み。以降も upstream のソースを使う |
| NVC | C | GPL-3.0-or-later | S11 は Emscripten NVC の link と native standard-library build に成功したが、Node counter testbench が elaboration で trap | 実際の addendum cutoff により T5 へ進む。初回の cutoff 判断は誤適用として訂正し再開した。out-of-scope NVC files は5。詳細は[S11 記録](docs/experiments/S11-nvc-wasm.md) |
| Icarus Verilog (`iverilog` / `vvp`) | C | GPL-2.0-or-later。`tgt-vvp` は LGPL-2.1 | [VeriSim](https://github.com/senolgulgonul/verisim) が Emscripten で `ivlpp`、`ivl`、`vvp` を個別に WASM 化 | T4。3 つの WASM を JavaScript で順番に呼ぶ方式を基礎にする。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| Verilator | C++ | LGPL-3.0 | [tiny-tpu](https://github.com/deaneeth/tiny-tpu) は事前ビルドした WASM を配布。ブラウザー内で C++ をコンパイルする例ではない | 将来。生成コードを実行する C++ コンパイラーをブラウザー内で用意する方法が必要。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| SymbiYosys / `yosys-smtbmc` | Python | 未確認 | YoWASP の Yosys は確認したが、Python 側の WASM 実行例は未確認 | T6。Yosys と Python 側の実行環境を分けて検証する |
| Yices2 | C | GPL-3.0 | 非公式の WASM パッケージと wasi-libc の制約を報告した issue がある | T6。ライセンスと issue は[広域調査](docs/research/oss-survey.md)を参照し、Emscripten 版を含めビルドと実行を検証する |
| Z3 | C++ | MIT | 公式 npm [`z3-solver`](https://www.npmjs.com/package/z3-solver) 5.3.2 が WASM を含む | T6。公式パッケージの API と solver の実行時間を小さな証明で測る。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| Boolector | C | 未確認 | YoWASP が WASI 版を配布 | T6。ライセンスと必要な API、solver の実行時間を確認する。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |
| [sv-elab（旧 yosys-slang）](https://github.com/povik/sv-elab) | C++ | ISC | この調査では WASM 版を確認できていない | 将来。SystemVerilog 対応の段階で調査する。詳しくは[広域調査](docs/research/oss-survey.md)を参照 |

### GHDL v6.0.0

GHDL の WASM 化、Ada API、VHDL 合成、配布とライセンスの調査は、[GHDL WASM の調査と合成の検証](docs/research/ghdl-wasm.md)に分けました。測定値と当時の判断は、分割先に残しています。

T4 の配布前検査では `ivlpp.wasm`、`ivl.wasm`、`vvp.wasm` をビルド元と全バイト照合します。配布先に追加するだけの例外ではなく、各ファイルの欠落・改変と余分なファイルを拒否する負の対照を設けます。波形表示は VCD 選択、状態表示、Surfer の3行に分け、タブを含む下部ペインに必要な高さを確保します。通常幅と390px幅のパネル高420px以上という既存の検査条件は維持します。

[T4の統合回帰](docs/experiments/S12B-simulation-integration.md)では、timescale追加前後のbitstreamが4ボードで全バイト一致し、native / Pyodideも各5回一致しました。通常幅と390px幅の波形8画面を目視し、配布前検査の負の対照も確認しました。初回のfixture未生成による14件の失敗を保持し、固定版で生成した後の `c19c69f` では全体E2E76件が成功しました。S5比較測定4件はskipです。同じcommitのシミュレーションE2Eも3回反復して30件すべて成功しました。

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

T5 の UART で見つかった native / WASI の配置差には、同じ座標のセルの入力順を保持するパッチをビルド時に適用します。製品用の8代表回路×4ボードを各実行系で5回ずつ比較し、全320回の配置 JSON が一致しました。A/A 20回と負例10回、資源・時間・メモリー・ビルドの根拠は [S13 の記録と生 CSV](docs/experiments/S13-nextpnr-determinism.md) に残します。回路や JSON のキー順の正規化で差を隠していません。実機は本リポジトリでは試していません。

CPU 7候補のプログラム実行、負の対照、4ボードでの比較は [S14](docs/experiments/S14-cpu-library-matrix.md) に採否の基準を先に定め、実装を進めています。6候補の正常系と5種類の負の対照は予備検証済みです。SERV の4K は分散 RAM への割当を避ける上流の `-nolutram` で bitstream まで一致しました。1K の容量不足と9K・20K の配線差は別に記録し、差のあるボードを確認済みにはしていません。正式な性能測定とボードの昇格は未実施です。

上記は正式反復より前の状態です。その後、パッチ0004の同一grid keyの順序固定と `EIGEN_DONT_VECTORIZE` を製品用ビルドへ適用し、[CPUの正式反復](docs/experiments/S14-production-cpu.md)を完走しました。28組は配置配線成功18・容量超過6・frontend非対応4です。成功した18組の生JSONと資源は両系で各5回一致し、該当ボードをconfirmedへ更新しました。残る2分類は選択できない理由を保持します。元の差を正規化で隠したり、初回の失敗を成功に書き換えたりしていません。

その後、GCC 15のFMAを使う環境でSERV / 20Kの差が見つかりました。[S14Aの固定artifact・fast / off対照](docs/experiments/S14A-pnr-fp-contract.md)でheap placerの演算の縮約へ切り分け、その翻訳単位だけに `-ffp-contract=off` を追加します。6条件の各系5回、全60実行とA/A、値・キー順の負の対照、全列CSVを記録しました。compilerとchipdbの根拠を保持し、JSONやcreatorの置換で差を隠していません。[修正commitの全60組回帰](docs/experiments/S14A-final-regression.md)ではHDL32組とCPU18組が成功し、CPU6組の容量超過と4組のfrontend非対応を区別しました。全7,700セル、警告、出力、終了状態と、SERV / 20Kの追加反復20実行を監査しています。全60組の各5回反復や修正後CIの成功を主張するものではありません。

Apycula 0.35 と `requirements-nextpnr.txt` の固定依存で、4 family の chipdb 生成と P&R が成功しました。他の Apycula 版は試していません。native と WASI で別々に生成した `.bba` と chipdb は一致しなかったため、native build の `.bba` を WASI build に取り込みます。これにより、両実行形式が同じ chipdb を使うことをテストで byte 単位に確認します。

Boost 1.92.0 は `-fwasm-exceptions` と `libunwind` を使って WASI 向けにビルドできました。別の Boost 版は試していません。nextpnr WASM は 34,141,610 bytes、native binary は 55,324,696 bytes です。ビルド時間は初回の WASI が 5 分 5.890 秒、native が 2 分 44.644 秒でした。chipdb 生成を共有する変更後の再ビルドは、既存のビルドを再利用して WASI が 10.957 秒、native が 4.575 秒でした。

### S5: WASI ビルドオプション比較

S5 の事前登録基準では LTO を採用します。Chromium の Tang Nano 20K は 2,296.095 ms で B より 10.5% 速く、zstd -19 の合計は 11.6% 小さく、ビルド時間は 1.81 倍でした。
B の nextpnr は upstream の `USE_IPO=ON` で ThinLTO 済みです。Yosys の O2/Os/Oz は `-DNDEBUG` を付けず、B と assert の状態をそろえました。
Os は Node 20K で 2,048.583 ms、zstd 合計 13,235,553 bytes でしたが、Chromium では測定していません。
詳細は [S5 WASI SDK ビルドオプション比較](docs/experiments/S5-wasi-build-options.md) を参照してください。後続の S5B 比較では OsLTO（Yosys と nextpnr は `-Os`、C/C++/linker は `-flto`、nextpnr は `USE_IPO=OFF`）を選定しました（[計測記録 PR #23](https://github.com/gogo-fpga/toolchain/pull/23)）。この条件は [PR #24](https://github.com/gogo-fpga/toolchain/pull/24) で既定にしました。S5 の B は、最適化フラグを明示的に空にし、nextpnr に `WASI_USE_IPO=ON` を指定して再現します。

S5B では Os、LTO、OsLTO を追加比較し、出力同一性、A/A build、連続5回の Node test、peak RSS の安定性条件を3候補すべてが満たしました。凍結した選定規則では、Chromium 20K の中央値が 2,122.105 ms（B より20.563%速い）で、zstd-19 合計も 11,327,113 bytes の OsLTO を選びます。既定の build script は [PR #24](https://github.com/gogo-fpga/toolchain/pull/24) で OsLTO に変更しました。詳細は [S5B 実験記録](docs/experiments/S5B-os-lto-chromium.md) を参照してください。

### S8: CI ビルドの高速化

S8 v2 の warm / Yosys cache-miss 合計時間中央値は 12.233 / 28.183 分でした。R1-R6 で見つかった chipdb 差は Apicula の hash-ordered set 反復が原因で、`PYTHONHASHSEED=0` 固定後の R7 miss / R8 hit は4 chipdb とも local seed-0 hash に一致しました。計測した nextpnr / GHDL build の max RSS は12 GiB以下で、ローカルの corrupted-cache check も成功しました。採用は、ユーザーが測定後の2026-10-30に決定したものです（判断「A」、凍結基準は未達項目あり）。未確認なのは `cache=false` run、cache 合計サイズ、CI での corrupted-cache 検出、output-cache hit run で省略された Yosys build の max RSS の4項目です。GHDL native `.cf` は timestamp が変わる既知の中間物で、WASM staging copy は正規化されます。詳細と raw data は [S8 実験記録](docs/experiments/S8-ci-speed.md) と CSV を参照してください。

### Pyodide 上の Apicula `gowin_pack`

S3 では Apicula 0.35 の Python wheel を配布物に含め、Node.js の Pyodide 314.0.7 から実行します。Pyodide の lock は Python 3.14.2、micropip 0.11.1、NumPy 2.4.6（SHA-256 `a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf`）、msgspec 0.20.0（SHA-256 `2a4075cee8afc2c0424c63ae1a9b0655e727478df7fa2eb78f86f846fc5fb4bd`）を指定します。これらの wheel hash はビルド時に Pyodide の lock から読み、Apicula wheel の hash は `requirements-nextpnr.txt` の固定値を使います。

Pyodide は新規依存として導入し、upstream の 314.0.0〜314.0.7 の変更履歴を確認しました。314.0.0 で Python 3.14.2 と Emscripten 5.0.3 に更新され、`lzma` が標準ライブラリーに含まれます。`pyodide.asm.mjs` への ES module 名変更は Node の実行には影響しませんが、S4 の Worker は module worker を使う必要があります。314.0.1〜314.0.6 の修正・性能改善はこの file-based 実行で使う API を変えません。314.0.7 の `dedent` オプションは既定値が従来動作を保つため採用不要です。`loadPackage` は lock 内の名前を指定し、依存解決を切った `micropip.install` でローカル wheel を入れるため、314.0.6 の requirement-specifier 処理変更にも依存しません。

Apicula 0.35 の wheel は 4,281,385 bytes、SHA-256 `6495d1c7cdc3cf6ac0a74bf7246932e96e5af84e24c17c1fef7296ebe7ed82fe` です。wheel に同梱された chipdb を `importlib.resources` で読み、圧縮データの展開に `lzma` を使います。`lzma` は Pyodide core に含まれることを実行時に検査します。`fastcrc` は Pyodide にないため、Apicula は CRC table fallback を選び、その警告を stderr に残します。Cattrs は使用しません。

Pyodide の NumPy / msgspec は 2.4.6 / 0.20.0 で、native 参照環境の 2.5.4 / 0.22.0 と版が異なります。S3 の比較では、同一の WASI nextpnr routed JSON を使い、全4ボードで native と Pyodide の `.fs` を5回ずつバイト比較し、IDCODE も確認しました。17件の synthesis tests は成功し、壊れた JSON、別 device、wheel hash 不一致、欠落 wheel の4負例を検出しました。Pyodide setup は 4,627.9 ms、pack assets は 21,021,184 bytes、`.fs` は 1K 351,954、4K 1,167,294、9K 2,069,320、20K 4,618,782 bytes でした。native / Pyodide の実行時間と各回の値は `docs/experiments/S3A-pyodide-gowin-pack.md` と CSV に記録しました。ブラウザー Worker での実行は S4 の範囲で、本段階では確認しません。

### ブラウザー内ビルドと静的配信

S4 のビルド時間、圧縮資材の復号、配信量と配信先の比較は、[ブラウザー内ビルドと静的配信の調査](docs/research/browser-build-and-delivery.md)に分けました。測定値と当時の判断は、分割先に残しています。

固定版Yosysの比較では版とcommitを必須にし、上流のタグ情報による版の接尾辞とcompiler名を回路差から分離します。許容する表記、拒否する負の対照、native/WASIの検査範囲も分割先に記録しました。

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

T5の22候補、ライセンス本文、取得元と固定版は、[HDLライブラリーとCPUコアの調査](docs/research/hdl-libraries.md)にまとめました。[検証の経緯](docs/research/hdl-validation-history.md)には、正式反復と全60組の回帰、失敗と修正、配布ソース照合の原記録を保持しています。実機での確認とは区別します。

## 6. ライセンスとソース配布

本リポジトリー自体のライセンスは BSD-3-Clause です。第三者のソフトウェアのライセンスと配布時の表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) に記録します。

GHDL、NVC、Icarus Verilog など GPL のツールを WASM にビルドして Release に含める場合、対応するソースも配布します。ソースには対象 revision、適用したパッチ、ビルド手順を含め、WASM の生成内容を追跡可能にします。書き込み部から引き継ぐ source archive と再ビルド検査の仕組みを、後続ツールにも拡張する方針です。

配布前に、各ツールと HDL ライブラリーの正確なライセンス、改変の有無、ソース提供方法、著作権表示を確認します。各ツールを導入する際は、そのバージョンのライセンス本文を読み、義務を最終確認します。

## 7. 分割した調査

Z3 WASIのlink失敗とSDK例外library・fork登録の対処は、[ソルバー調査](docs/research/formal-solvers.md)と[S15の診断記録](docs/experiments/S15-z3-wasi-link.md)に保存しました。手動18条件を経てclean buildと[両solverの正式反復](docs/experiments/S15-solver-native-wasi.md)まで実施しました。

T6は上流SBY・SMTBMCの再利用を選び、固定ソースと[S15の事前基準](docs/experiments/S15-formal-verification.md)を登録しました。Yosys SAT、元のVerilogをIcarusで独立に再実行する検査経路、明示したGHDL形式出力によるVHDL・PSL property保持を追加しました。PSLのコメント解析には上流と同じ2フラグが必要で、activation coverはassertと区別します。[GHDLの診断と初回の失敗](docs/experiments/S15-vhdl-formal.md)も保存します。元VHDLのnative検査経路とその5回反復も追加しましたが、下位化後の比較、追加fixture、SMTソルバー・画面統合と製品版の正式反復は未完了です。以下に方式と制限、初期調査との差、依存、GMPの取得失敗と署名鍵の期限切れも記録します。

大きな調査は `docs/research/` に分けて置きます。

| 文書 | 内容 |
|---|---|
| [依存の版の検出と負の対照](docs/research/dependency-version-detection.md) | GHDLの公開安定タグの選択、Rust channel TOMLの構造化読取り、欠落と不正入力の扱い |
| [書き込み部の移植とビルド選定](docs/research/flasher-integration.md) | 移植元の原典、JSPIとWebUSB、S7の選定とhash照合、asyncifyの失敗と未確認範囲 |
| [GHDL WASM の調査と合成の検証](docs/research/ghdl-wasm.md) | Ada API、VHDL の合成、最適化と配布・ライセンスの記録 |
| [ブラウザー内ビルドと静的配信の調査](docs/research/browser-build-and-delivery.md) | S4、圧縮資材の復号、配信量と配信先の比較 |
| [OSS の FPGA 開発環境と HDL ライブラリーの広域調査](docs/research/oss-survey.md) | ブラウザーで動く HDL ツールの先行例、HDL のツール、形式検証のソルバー、HDL ライブラリーと CPU コア（2026-10-26） |
| [エディターと AI 機能の調査](docs/research/editor-and-ai.md) | エディターの候補（CodeMirror 6、Monaco Editor、Ace など）の比較、AI 機能の接続方式（OpenRouter OAuth PKCE など）との相性（2026-10-26） |
| [Actions.lock の調査結果と導入の採否](docs/research/actions-lock.md) | 現行 CI、保護範囲、既存検査との関係、運用負担と再検討条件（2026-11-01） |
| [文書を意味単位で分割する方針](docs/research/document-structure.md) | 目的・読者による分割、サイズの目安、例外、旧リンクと証拠の保持 |
| [HDL ライブラリーと CPU コアの調査](docs/research/hdl-libraries.md) | T5 の22候補、ライセンスの原典、対応範囲、固定版と更新監視（2026-11-01） |
| [HDL ライブラリー候補の初期調査記録](docs/research/hdl-library-survey-history.md) | 初期の11候補、当時の転記、訂正先と原典。現在のカタログとは区別 |
| [形式検証の原本とブラウザーの制約](docs/research/formal-verification.md) | SBY・SMTBMC、Z3のWASM先例、property、輸送と非成功判定 |
| [HDLライブラリーとCPUコアの検証経緯](docs/research/hdl-validation-history.md) | 正式反復と全60組の回帰、失敗と修正、配布ソースの原記録 |
| [形式検証の固定ソース・依存・配布条件](docs/research/formal-sources.md) | 採用releaseと初期snapshot、依存、SQLite、license、GMP、source closure |
| [形式検証ソルバーのビルドと実行方式](docs/research/formal-solvers.md) | WASI CLI・C API・公式WASMの比較候補、GMP・timer・丸め・版表示・native ABIの制約、字句境界、終了0の構文エラーと実応答比較 |
| [原本SBY・SMTBMCのprocess境界](docs/experiments/S15-sby-process.md) | Pyodideの制約、SQLite、native SBY12条件、SMTBMC仮想processの16条件・AST照合と失敗記録。SBY全体は未接続 |

元VHDLの独立再実行は、GHDL標準のVPIと`--psl-report`を再利用する限定した検査経路を追加しました。清浄な同一commitで55件×5回とA/Aの2回が成功し、元ファイルとCSV全280行19列を照合しています。通常assertionとclocked PSLの評価位相、coverが既定では標準出力に現れないこと、root moduleのVPI列挙、生CSV・全ファイルのhash・失敗試行と未完了の範囲を[元VHDLによる再実行の実験記録](docs/experiments/S15-vhdl-native-replay.md)へ保存します。下位化後のVerilog比較、追加fixtureとT6全体は未完了です。

その後、[下位化Verilog比較](docs/experiments/S15-vhdl-lowered-replay.md)を追加しました。上流YosysでIcarus用モデルを出力し、assertion再実行からだけcoverを除き、元のcoverとPSLレポートを保持します。propertyのkind・A/EN別名と元ソースを対応付け、準備後のstate bit・初期値・clock、全ポートを照合します。通常assertionの診断密度は実行系で異なるため、最初の違反と全違反の包含を比較します。階層・名前付きライブラリーを含む10成功fixtureと5境界fixture、全60行20列の監査が予備検査で通りました。未知の初期値、memory、循環、空虚な条件は成功と区別します。[初回の失敗・process footerの制約](docs/experiments/S15-vhdl-lowered-failures.md)も保存します。その後、清浄な同一commitで69件を5回とA/Aの2回実行し、CSV420行の全20列とソース・実行系のhashを監査しました。GHDL VCDの日時と所要時間以外は反復間で一致しました。SMTソルバー、worker/UIとT6全体は引き続き未完了です。

Actions.lock は今回は導入を見送り、現行の完全長 SHA 固定を維持します。取得元 ID と推移依存の保護という追加価値、導入の制限、未確認の事項は上記の調査に記録しました。

T6 P2では、WASI shimの同期stdin reader、容量を制限した共有buffer、期限・整合性・終了を管理する専用workerを追加しました。予備Yices2 WASMでは5 byteの入力chunkと7 byteのbufferで双方向SMT通信を確認しました。この段階は正式反復ではありません。GMP検索先、cross makeのarch、alarm、SDKとEmscriptenの丸め、C++標準ライブラリー、setjmp/longjmp、版表示の由来を[ソルバー調査](docs/research/formal-solvers.md)と[S15 P2](docs/experiments/S15-solver-build-and-transport.md)に残します。hardware丸めの単独compile後、実Z3 WASIでも非対応要求を明示拒否できました。

その後、Z3のclean buildを終え、両solverのnative/WASIを清浄な`3ea717e`の比較器で各5回・A/A 2回実行しました。全329行31列と294負の対照を監査し、正常3条件の全byte一致と異常分類を確認しました。欠測をnullに保つ資源、生CSV、全buildの由来と警告、証拠ZIPは[正式比較](docs/experiments/S15-solver-native-wasi.md)、予備21実行などの履歴は[実応答記録](docs/experiments/S15-solver-protocol.md)へ分けます。Z3 WASIはZstandardで5,246,594 byteとなり、host展開後のhashも元と一致しました。ブラウザーの展開、SBYと製品画面、既定solverの選定は未完了です。

## 8. 未確認の事項

- Tang Nano の IDCODE とフラッシュ情報の個体差。移植元の調査値はありますが、実機での照合はしていません。
- 合成・配置配線 WASM の実行可否、実行時間、メモリー量、成果物サイズ。YoWASP と synth-explorer の記録を本リポジトリーで再現していません。
- WASI SDK 33 での LTO とネイティブ WASM 例外の問題。synth-explorer の報告を確認しただけで、再現していません。
- NVC で `--disable-llvm` を指定したときの interpreter の runtime 完走。S11 では `-sEMULATE_FUNCTION_POINTER_CASTS=1` により analysis/elaboration が進むことを確認しましたが、Node counter simulation は `missing body for (null)` で停止しました。function signature mismatch の原因は特定済みですが、null unit name の根本原因は未確認です。[実験記録](docs/experiments/S11-nvc-wasm.md)を参照してください。
- Apicula と Pyodide の組み合わせ、必要な Python 依存、実行時間、配布サイズ。
- VeriSim の Icarus Verilog 構成を本リポジトリーへ適用した場合の機能範囲と実行時間。
- Verilator 生成 C++ をブラウザー内でコンパイル・実行する方法。
- SymbiYosys / `yosys-smtbmc`、Yices2 / Z3 のWASM統合と実行性能。初期表で未確認だったSBY・BoolectorのlicenseはISC・MITと確認し、上記の形式検証調査に記録しました。
- sv-elab の WASM 対応。
- Chromium 以外のブラウザー、実機 USB、4 ボードでの書き込み。
- GPL ツールおよび HDL ライブラリーを配布する際の、各 revision に固有のソース提供・表示義務。
