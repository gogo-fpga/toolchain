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
| iverilog | v13_0 | `dfeee909ed9f20b4870dd93423156c0170c0e1ff` | `https://github.com/steveicarus/iverilog.git` |
| surfer | v0.7.0 | `bd749b1f786c1c62cd67893ca71346cbe6983915` | `https://gitlab.com/surfer-project/surfer.git` |

WASI SDK の固定値は pin checker とビルドスクリプトが読む次の表を正とします。

| 依存 | 版 | SHA-256 | 取得元 |
|---|---|---|---|
| wasi-sdk | 34.0 | `b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4` | `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz` |
| boost | 1.92.0 | `ea7b982002cc9dfbe59b0b217b206f470dc75f3de0bb2973d844118934d82411` | `https://github.com/boostorg/boost/releases/download/boost-1.92.0/boost-1.92.0-b2-nodocs.tar.xz` |
| eigen | 5.0.1 | `e9c326dc8c05cd1e044c71f30f1b2e34a6161a3b6ecf445d56b53ff1669e3dec` | `https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz` |
| adawebpack | 24.0.0 | `8edaae8b9987a20aec430d750f30033f12f953ce2b6437afb87fbf8cc1063796` | `https://github.com/godunko/adawebpack/releases/download/24.0.0/adawebpack-24.0.0.tar.gz` |

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

T5 の22候補、ライセンス本文、部品の登録と更新監視は、[HDL ライブラリーと CPU コアの調査](docs/research/hdl-libraries.md)にまとめました。現在の取得元は `.gitmodules`、固定版は gitlink が正です。下表は初期調査で転記した記録です。Colibri の取得元と Open Logic のライセンス表記には誤りがあり、分割した調査に訂正内容と原典を記載しました。

VexRiscv は生成済みパッケージのライセンスだけでなく、同じパッケージが gitlink で固定する生成元のライセンス原文も保持します。入れ子の URL と revision は原本のメタデータから取り、ソースアーカイブにも必要な原文を追加します。手元の生成器で、Git を呼べない状態から22候補の資材を同一ハッシュで再生成しました。根拠と検証の境界は、上記の分割した調査に記録しています。

製品用スカラー設定のnextpnrによる[HDLの正式反復](docs/experiments/S14-production-hdl.md)は、8部品と4ボードの全32組でnative / WASIを各5回照合しました。A/A20回と負の対照10回も含む350行39列を監査し、生CSVとmetadata、summaryを保存しました。CPUとの並行負荷があるため、隔離した性能改善は主張しません。これは代表部品の仮想検証で、CPU全体や実機の確認とは区別します。

[初回の正式反復の失敗](docs/experiments/S14-cpu-library-matrix.md#初回の正式反復で見つかった負の対照の不備)では、未知のセルへ変更した既存LUTがSERVのwide MUXも壊し、意図した診断を検証できませんでした。CPUは未完了、同じ初回のHDLも修正後の版の確認には流用しません。全2,914ファイルのサイズとhashを目録に残し、新しい出力先での反復と区別します。

その後の[CPU正式反復](docs/experiments/S14-production-cpu.md)では、生CSVの370行39列、14,430値を監査しました。passed 200、負の対照のfailed 30、capacity-exceeded 80、frontend-unsupported 60を区別し、性能統計は正常な本試行18組だけから再計算しました。metadata・summary・生CSVと、前提回帰も含む全3,768ファイルのhash目録を保存しました。HDLとの並行負荷があり、隔離した性能改善は主張しません。実機とブラウザー画面操作の検証ではありません。

カタログ昇格後の最終回帰ではHDL全32組が成功しましたが、容量超過のCPU入力を通常選択の制限が拒否して検査が停止しました。製品の制限は維持し、拒否確認後に検査用入力だけを実行し、実測分類とカタログを照合するように修正しました。Git設定なしで失敗した資材生成のfixtureも、subprocess内だけで検証用identityを設定し、23件を再検証しました。[失敗と修正の記録](docs/experiments/S14-production-cpu.md#カタログ昇格後の選択制限と検査の修正)に分けて保持します。

[初期調査で転記した11候補とライセンスの記録](docs/research/hdl-library-survey-history.md)は、現在のカタログと区別して保存します。誤っていた取得元やライセンスも、当時の記録を改変せず、訂正先と原典を追えるようにしています。

## 6. ライセンスとソース配布

本リポジトリー自体のライセンスは BSD-3-Clause です。第三者のソフトウェアのライセンスと配布時の表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) に記録します。

GHDL、NVC、Icarus Verilog など GPL のツールを WASM にビルドして Release に含める場合、対応するソースも配布します。ソースには対象 revision、適用したパッチ、ビルド手順を含め、WASM の生成内容を追跡可能にします。書き込み部から引き継ぐ source archive と再ビルド検査の仕組みを、後続ツールにも拡張する方針です。

配布前に、各ツールと HDL ライブラリーの正確なライセンス、改変の有無、ソース提供方法、著作権表示を確認します。各ツールを導入する際は、そのバージョンのライセンス本文を読み、義務を最終確認します。

## 7. 分割した調査

大きな調査は `docs/research/` に分けて置きます。

| 文書 | 内容 |
|---|---|
| [GHDL WASM の調査と合成の検証](docs/research/ghdl-wasm.md) | Ada API、VHDL の合成、最適化と配布・ライセンスの記録 |
| [ブラウザー内ビルドと静的配信の調査](docs/research/browser-build-and-delivery.md) | S4、圧縮資材の復号、配信量と配信先の比較 |
| [OSS の FPGA 開発環境と HDL ライブラリーの広域調査](docs/research/oss-survey.md) | ブラウザーで動く HDL ツールの先行例、HDL のツール、形式検証のソルバー、HDL ライブラリーと CPU コア（2026-10-26） |
| [エディターと AI 機能の調査](docs/research/editor-and-ai.md) | エディターの候補（CodeMirror 6、Monaco Editor、Ace など）の比較、AI 機能の接続方式（OpenRouter OAuth PKCE など）との相性（2026-10-26） |
| [Actions.lock の調査結果と導入の採否](docs/research/actions-lock.md) | 現行 CI、保護範囲、既存検査との関係、運用負担と再検討条件（2026-11-01） |
| [文書を意味単位で分割する方針](docs/research/document-structure.md) | 目的・読者による分割、サイズの目安、例外、旧リンクと証拠の保持 |
| [HDL ライブラリーと CPU コアの調査](docs/research/hdl-libraries.md) | T5 の22候補、ライセンスの原典、対応範囲、固定版と更新監視（2026-11-01） |
| [HDL ライブラリー候補の初期調査記録](docs/research/hdl-library-survey-history.md) | 初期の11候補、当時の転記、訂正先と原典。現在のカタログとは区別 |

Actions.lock は今回は導入を見送り、現行の完全長 SHA 固定を維持します。取得元 ID と推移依存の保護という追加価値、導入の制限、未確認の事項は上記の調査に記録しました。

## 8. 未確認の事項

- Tang Nano の IDCODE とフラッシュ情報の個体差。移植元の調査値はありますが、実機での照合はしていません。
- 合成・配置配線 WASM の実行可否、実行時間、メモリー量、成果物サイズ。YoWASP と synth-explorer の記録を本リポジトリーで再現していません。
- WASI SDK 33 での LTO とネイティブ WASM 例外の問題。synth-explorer の報告を確認しただけで、再現していません。
- NVC で `--disable-llvm` を指定したときの interpreter の runtime 完走。S11 では `-sEMULATE_FUNCTION_POINTER_CASTS=1` により analysis/elaboration が進むことを確認しましたが、Node counter simulation は `missing body for (null)` で停止しました。function signature mismatch の原因は特定済みですが、null unit name の根本原因は未確認です。[実験記録](docs/experiments/S11-nvc-wasm.md)を参照してください。
- Apicula と Pyodide の組み合わせ、必要な Python 依存、実行時間、配布サイズ。
- VeriSim の Icarus Verilog 構成を本リポジトリーへ適用した場合の機能範囲と実行時間。
- Verilator 生成 C++ をブラウザー内でコンパイル・実行する方法。
- SymbiYosys / `yosys-smtbmc` の WASM 実行方法とライセンス。Yices2 / Z3 の API 統合と実行性能、Boolector のライセンスは未確認です。
- sv-elab の WASM 対応。
- Chromium 以外のブラウザー、実機 USB、4 ボードでの書き込み。
- GPL ツールおよび HDL ライブラリーを配布する際の、各 revision に固有のソース提供・表示義務。
