# 午後のFPGA Web Toolchain

Web ブラウザーだけで VHDL と Verilog の編集、論理合成、配置配線、ビットストリームの作成、Tang Nano への書き込みまで行う FPGA 開発環境を目指します。設計データをサーバーへ送らない構成にします。

対象は Sipeed Tang Nano 1K、4K、9K、20K です。各ボードの FPGA が内蔵 SRAM へ構成できることを選定理由としています。HDL は VHDL と Verilog を最初から対象とし、SystemVerilog は将来の段階で扱います。

## 開発状況

T0 から T3 の編集・保存・合成・配置配線・ビットストリーム作成に加え、T4 の Verilog シミュレーションと波形表示を実装しています。合成には Yosys + ABC と GHDL、配置配線には nextpnr-himbaechel、ビットストリームの作成には Apicula を使います。書き込み部は、[午後のFPGA Web Flasher](https://github.com/gogo-fpga/flasher) から移植したものです。HDL ライブラリーと CPU コアの取り込み（T5）、形式検証（T6）は未対応です。

書き込み部は Chromium 系ブラウザーの WebUSB を使います。実機の Tang Nano では試していません。

## IDE 画面

IDE は、左にプロジェクトのファイル一覧、中央に HDL エディターとログ・問題・成果物・波形、右にボード情報と書き込み設定を表示します。プロジェクトと設計ファイルはブラウザー内の OPFS に保存し、ZIP で書き出し・読み込みができます。設計データをサーバーへ送信せず、合成・配置配線・ビットストリーム作成をブラウザー内で実行します。

画面幅が 900 ピクセル未満の場合、ファイル一覧と書き込み設定は切り替えボタンから開きます。`.fs` は手元のファイル、またはプロジェクト内のファイルを選んで書き込みます。

### シミュレーションと波形

Icarus Verilog で Verilog の testbench を実行し、出力された VCD を Surfer で表示します。testbench の top、対象ファイル、実行時間の上限（1 から 120 秒）を設定できます。実行中は停止ボタンで Worker を終了できます。WASM 資材の読み込み時間とシミュレーションの実行時間は別に制限します。

4 ボードの Verilog テンプレートには `src/top_tb.v` が含まれます。自作の testbench では `$dumpfile` と `$dumpvars` を指定してください。VCD が出力されなければ失敗として表示します。複数の VCD が出力されたときは、表示・保存するファイルを選べます。Surfer の表示には WebGL が必要ですが、表示できない場合も VCD は保存できます。

VHDL だけのプロジェクトではシミュレーションを無効にし、理由を表示します。Verilog と VHDL が混在する場合、VHDL ファイルはシミュレーションの対象から除外します。VHDL の回路をインスタンス化した Verilog を、そのままシミュレーションできるわけではありません。VHDL シミュレーションを提供しない理由は [NVC の調査記録](docs/experiments/S11-nvc-wasm.md) を参照してください。

現在、アプリのオフライン起動は未対応です。全資材を事前保存するオフライン対応は T6 の後に実装します。サーバーの役割は静的ファイルの配信に限り、サーバー側で設計を処理する機能は追加しません。

## 開発段階

| 段階 | 内容 | 完了条件 |
|---|---|---|
| T0 | リポジトリーの土台、書き込み部、文書、スキル、CI、依存関係の監視を整える | CI、リンク検査、JIS X 0213 検査が通る |
| T1 | 画面の骨組み、ボード選択、プロジェクト保存、書き込み機能の統合 | 仮想 USB で `.fs` を SRAM に書き込む E2E が通る |
| T2 | Verilog 用の Yosys + ABC、nextpnr-himbaechel、Apicula を WASM 化 | 4 ボードで `.fs` を作り、ネイティブ版との比較を記録する |
| T3 | GHDL の合成部を WASM 化し、VHDL から `.fs` までつなぐ | 4 ボードのテンプレートで合成と仮想書き込みを実行できる |
| T4 | Icarus Verilog による Verilog シミュレーションと Surfer の波形表示 | Verilog テンプレートをブラウザーで実行できる。VHDL シミュレーションは NVC の cutoff により未対応（[S11 記録](docs/experiments/S11-nvc-wasm.md)） |
| T5 | HDL ライブラリーと CPU コアの取り込み、依存解決 | 各ライブラリーの代表回路が 4 ボードで合成できる |
| T6 | SymbiYosys、yosys-smtbmc、Yices2、Z3、Boolector による形式検証 | 小さな性質の証明がブラウザーで通る |
| T6 の後 | Service Worker と全資材の事前保存によるオフライン対応 | 通信を遮断して編集・ビルド・シミュレーションを実行できる |
| 将来 | SystemVerilog と Verilator | C++ コンパイラーを含む実行方式を調査する |

## ビルドとテスト

```sh
git clone https://github.com/gogo-fpga/toolchain.git
cd toolchain
git submodule update --init --depth 1
git -C vendor/emsdk fetch --depth=1 --tags origin  # build-wasm.sh に必要な emsdk のタグを取得。CI の build.yml と同じ
npm ci
scripts/build-wasm.sh
scripts/build-decoders.sh
scripts/build-synth-wasm.sh
scripts/build-pnr-wasm.sh
scripts/build-ghdl-wasm.sh
scripts/build-pack-assets.sh
scripts/build-iverilog-wasm.sh
scripts/build-surfer.sh
scripts/build-web.sh
tests/fixtures/build-fs.sh
node --test tests/web/*.test.mjs
WASM_BUILD_ROOT=build node --test --test-concurrency=1 tests/sim/*.test.mjs
npx playwright install --with-deps chromium
npx playwright test
python3 dist/serve.py --port 8000
```

書き込み部は Emscripten、合成・配置配線と Icarus Verilog は WASI SDK、GHDL の合成部は AdaWebPack と WASI SDK、Surfer は Rust で WASM にします。Apicula は Pyodide で動かします。`scripts/build-web.sh` が Web 画面と各ツールの資材・ライセンスを `dist/` にまとめます。

ビルドには Autotools、CMake 3.28 以上、rustup などが必要です。`scripts/build-wasm.sh` は `vendor/emsdk` を使います。ツールの固定版と取得元は [RESEARCH.md](RESEARCH.md) を参照してください。

ネイティブ版は比較テストの参照用で、製品として配布するものではありません。比較には Yosys、nextpnr、Icarus Verilog の `--native` ビルドも必要です。

```sh
scripts/build-synth-wasm.sh --native
scripts/build-pnr-wasm.sh --native
scripts/build-iverilog-wasm.sh --native
node --test tests/synth/*.test.mjs
```

自動検証はブラウザーと仮想 USB で行います。実機の Tang Nano では試していません。

## ライセンス

本リポジトリー自体は BSD-3-Clause です。配布物に含める第三者のソフトウェアとライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

EUPL-1.2 の Surfer v0.7.0 と WASM 実行時依存のライセンス一覧も配布物に含まれます。