# 午後のFPGA Web Toolchain

Web ブラウザーだけで VHDL と Verilog の編集、論理合成、配置配線、ビットストリームの作成、Tang Nano への書き込みまで行う FPGA 開発環境を目指します。設計データをサーバーへ送らない構成にします。

対象は Sipeed Tang Nano 1K、4K、9K、20K です。各ボードの FPGA が内蔵 SRAM へ構成できることを選定理由としています。HDL は VHDL と Verilog を最初から対象とし、SystemVerilog は将来の段階で扱います。

## 開発状況

現在は T1 です。CodeMirror 6 による HDL 編集画面と、ブラウザー内の OPFS に保存するプロジェクト機能を追加しています。論理合成と配置配線は T2 で対応予定です。書き込み部は、[午後のFPGA Web Flasher](https://github.com/gogo-fpga/flasher) から移植したものです。

書き込み部は Chromium 系ブラウザーの WebUSB を使います。実機の Tang Nano では試していません。

## IDE 画面

IDE は、左にプロジェクトのファイル一覧、中央に HDL エディターとログ・問題・成果物、右にボード情報と書き込み設定を表示します。プロジェクトと設計ファイルはブラウザー内の OPFS に保存し、サーバーへ送信しません。合成・配置配線は未対応で、T2 で対応予定です。

画面幅が 900 ピクセル未満の場合、ファイル一覧と書き込み設定は切り替えボタンから開きます。`.fs` は手元のファイル、またはプロジェクト内のファイルを選んで書き込みます。

## 開発段階

| 段階 | 内容 | 完了条件 |
|---|---|---|
| T0 | リポジトリーの土台、書き込み部、文書、スキル、CI、依存関係の監視を整える | CI、リンク検査、JIS X 0213 検査が通る |
| T1 | 画面の骨組み、ボード選択、プロジェクト保存、書き込み機能の統合 | 仮想 USB で `.fs` を SRAM に書き込む E2E が通る |
| T2 | Verilog 用の Yosys + ABC、nextpnr-himbaechel、Apicula を WASM 化 | 4 ボードで `.fs` を作り、ネイティブ版との比較を記録する |
| T3 | GHDL の合成部を WASM 化し、VHDL から `.fs` までつなぐ | 4 ボードのテンプレートで合成と仮想書き込みを実行できる |
| T4 | NVC と Icarus Verilog によるシミュレーション、波形表示 | ネイティブ版と assertion、VCD の結果が一致する |
| T5 | HDL ライブラリーと CPU コアの取り込み、依存解決 | 各ライブラリーの代表回路が 4 ボードで合成できる |
| T6 | SymbiYosys、yosys-smtbmc、Yices2、Z3、Boolector による形式検証 | 小さな性質の証明がブラウザーで通る |
| 将来 | SystemVerilog と Verilator | C++ コンパイラーを含む実行方式を調査する |

## ビルドとテスト

```sh
git clone https://github.com/gogo-fpga/toolchain.git
cd toolchain
git submodule update --init --depth 1
git -C vendor/emsdk fetch --depth=1 --tags origin  # build-wasm.sh に必要な emsdk のタグを取得。CI の build.yml と同じ
npm ci
scripts/build-wasm.sh
scripts/build-web.sh
tests/fixtures/build-fs.sh
node --test tests/web/*.test.mjs
WASM_BUILD_ROOT=build node --test --test-concurrency=1 tests/sim/*.test.mjs
npx playwright install --with-deps chromium
npx playwright test
python3 dist/serve.py --port 8000
```

書き込み部は Emscripten で WASM にし、Web 画面と合わせて `dist/` にまとめます。シミュレーションと Playwright のテストは仮想環境で行います。実機の Tang Nano では試していません。

ビルドには Autotools が必要です。`scripts/build-wasm.sh` は `vendor/emsdk` を使います。

## ライセンス

本リポジトリー自体は BSD-3-Clause です。配布物に含める第三者のソフトウェアとライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

EUPL-1.2 の Surfer v0.7.0 と WASM 実行時依存のライセンス一覧も配布物に含まれます。