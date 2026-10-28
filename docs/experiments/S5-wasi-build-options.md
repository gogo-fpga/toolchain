# S5 WASI SDK のビルドオプション比較

- 状態: 計画（結果の前）
- 日付: 2026-10-28
- 担当: Devin
- 関連: T2 S5、基準 commit `aff4e61b576b4f18a3cb819069b16c4cc9c1652a`

## 目的と仮説

Yosys と nextpnr の WASI ビルドで、Release の最適化レベルと追加フラグを変え、合成・配置配線の時間、メモリー、配布サイズ、ビルド時間を比較する。候補によって実行時間または配布サイズが改善する可能性がある一方、出力の同一性、ビルド時間、ブラウザー互換性を損なう可能性もある。測定前には勝者を想定しない。

この記録は比較条件と採用基準を固定する計画である。正式なマトリクスはこのハーネスのレビュー後に実施する。S4B、S4C の測定値、基準、結論は変更しない。

## 採否の基準（結果を見る前に書く）

候補は次のすべてを満たす場合に限り採用する。

1. 4 ボードすべての全試行で、Yosys の JSON ネットリスト、nextpnr の出力、最終 `.fs` が B とバイト単位で一致し、trap または失敗がない。
2. 次のいずれかを満たす。
   - Chromium の Tang Nano 20K における合成と配置配線の中央値が B より 10% 以上速く、かつ A/A のノイズ床を超える。
   - Yosys と nextpnr の `zstd -19` サイズの合計が B より 10% 以上小さく、Chromium の Tang Nano 20K における合成と配置配線の中央値が B より 5% を超えて遅くならない。
3. ビルド時間が B の 2 倍以下である。
4. 使用する target feature が Chromium、Firefox、Safari の現行安定版でサポートされる。根拠として MDN、caniuse、または webassembly.org の機能表を引用する。

どの候補も基準を満たさない場合は B を維持する。同等の場合はフラグが少ない候補を優先し、安定性を速度より優先する。

## 条件

| 項目 | 値 |
|---|---|
| 基準の commit | `aff4e61b576b4f18a3cb819069b16c4cc9c1652a`（S5 phase 1b で `origin/main` にリベース） |
| ホスト | Linux x86_64、kernel `7.0.0-38-generic`、論理 CPU 12 個、メモリー 31,707,676 kB |
| WASI SDK | 34.0、clang 23.1.0 |
| Node.js / Playwright | Node.js 24.22.1、Playwright 1.64.1。Chromium のバージョンは正式計測時に記録する |
| 関連 submodule | Yosys `28ba3cb926fe376fa05ebfc1b921747d011d4557`、nextpnr `62e659ed6748e9f60b2a4aa25dd4fe79a9605881`。正式計測時は `git submodule status` も記録する |
| その他のツール | Python 3.14.4、CMake 4.4.4、zstd 1.5.7 |
| 出力先と状態 | 各 WASI ビルドは `build/s5/<variant>/` に分離する。B と B2 は別の新規ディレクトリーでビルドする。既存の出力や CSV は上書きしない |
| 再現性 | `SOURCE_DATE_EPOCH` が未設定なら、Yosys submodule の `git log -1 --format=%ct`（`1791880533`、2026-10-13 08:35:33 UTC）を設定してビルドする。Yosys の WASI と native ビルドに適用する |
| JOBS | 12 論理 CPU のホストで `10` に固定し、各ツールのビルド時間とピーク RSS を `/usr/bin/time -v` で記録する |
| 変える条件 | 下表の最適化フラグを Yosys と nextpnr の WASI ビルドに同じように適用する |
| 変えない条件 | WASI SDK 34.0、Release 構成、スタックサイズ、例外モデル、スレッド設定、入力 Verilog、nextpnr の seed・引数、native `gowin_pack`、対象の 4 ボード |
| 繰り返し | Node WASI は各 variant、各ボードにつき 5 回。各 repeat 内で variant の順番を交代する。中央値と最小・最大を記録する。Chromium は B と Node の出力同一性を通過した上位 2 候補までを、各ボード 5 回ずつ測る |

### 比較する variant

| variant | Yosys と nextpnr の WASI ビルド条件 |
|---|---|
| B | 現行スクリプト。`CMAKE_BUILD_TYPE=Release` による `-O3 -DNDEBUG` |
| B2 | B と同じ設定を、別の新規ビルドディレクトリーで再ビルドする A/A 試行 |
| O2 | `CMAKE_C_FLAGS_RELEASE` と `CMAKE_CXX_FLAGS_RELEASE` を `-O2 -DNDEBUG` にする |
| Os | 同じく `-Os -DNDEBUG` にする |
| Oz | 同じく `-Oz -DNDEBUG` にする |
| LTO | B に加えて C、C++、linker に `-flto` |
| TLTO | B に加えて C、C++、linker に `-flto=thin` |
| SIMD | B に加えて C、C++、linker に `-msimd128` |
| TC | B に加えて C、C++、linker に `-mtail-call` |

この比較では Yosys の例外モデル変更（`-fwasm-exceptions`）、nextpnr の例外モデル変更、スタックサイズ変更、スレッド、wasm-opt/Binaryen を試さない。例外モデル、スタック、スレッドの変更は安定性上のリスクがあり、wasm-opt/Binaryen は新しい依存として承認が必要なため除外する。

WASI SDK の標準 target feature は bulk-memory、multivalue、mutable-globals、nontrapping-fptoint、reference-types、sign-ext である。候補が新たに使う target feature は採用基準 4 に従って確認する。

## 測定項目

- 各 variant の Yosys と nextpnr それぞれについて、固定した `JOBS=10` でビルド時間（秒）とピーク RSS を記録する。
- 各 WASM のバイト数、SHA-256、pinned zstd 1.5.7 の `zstd -19` 圧縮後バイト数を記録する。
- Node WASI で Tang Nano 1K、4K、9K、20K を各 variant 5 回実行し、Yosys と nextpnr の時間（ms）、終了時の `WebAssembly.Memory.buffer.byteLength` を記録する。
- Yosys が生成した JSON ネットリスト、nextpnr の JSON 出力、native `gowin_pack` が生成した `.fs` の SHA-256 を記録し、全ての出力を B と比較する。
- 同じ Chromium を使い、B と Node 試験で同一性を通過した上位 2 候補までを各ボード 5 回実行する。既存の `toolchain:build-complete` build event から合成・配置配線の時間を取り、`.fs` の SHA-256 を記録する。
- 失敗、trap、無効な出力も CSV に残す。試行を除外する場合は、理由を記録する。

## 手順

計測器の確認では B と B2 の新規ビルド、SHA-256 の比較、1 バイト変更による負の対照、B の Tang Nano 1K 1 回の smoke run を行う。これは正式な variant 比較ではない。正式マトリクスの実行コマンドは次のとおり。出力先は新規であることを確認してから実行する。

```sh
python3 scripts/run-s5-matrix.py \
  --phase matrix \
  --reuse-builds \
  --jobs 10 \
  --output-csv docs/experiments/S5-wasi-build-options.csv \
  --output-dir build/s5/matrix-runs

python3 scripts/run-s5-matrix.py \
  --phase chromium \
  --variant B \
  --variant <候補1> \
  --variant <候補2> \
  --append \
  --output-csv docs/experiments/S5-wasi-build-options.csv \
  --output-dir build/s5/chromium-runs
```

Chromium の `<候補1>` と `<候補2>` は Node WASI の全ボードで出力同一性を通過した候補から選ぶ。候補が 1 つ以下なら、存在するものだけを指定する。正式な `.csv` は全試行を終えるまで作成しない。

## 計測器の検証

- A/A: B と B2 の Yosys、nextpnr WASM の SHA-256 がそれぞれ一致することを確認する。Node WASI の B、B2 の時間中央値も併記し、中央値の差を A/A のノイズ床として報告する。
- 負の対照: B の JSON ネットリストと `.fs` のコピーをそれぞれ 1 バイト変更し、SHA-256 比較器が両方の不一致を検出する。
- smoke run: B、Tang Nano 1K、1 回で Node WASI の合成・配置配線と出力ハッシュを記録する。
- この検証を終え、ハーネスのレビューを受けるまで正式なマトリクスを始めない。

### Phase 1a の記録（JOBS=2、SOURCE_DATE_EPOCH 固定前）

2026-10-28 と 2026-10-29 に B と B2 の WASI 資材を別ディレクトリーへ新規ビルドした。B の Yosys は 2,555.96 秒、ピーク RSS は 393,280 KiB、52,926,660 bytes だった。nextpnr は 206.70 秒、984,520 KiB、34,172,028 bytes だった。B2 の Yosys は 2,552.350 秒、393,568 KiB、52,926,660 bytes、nextpnr は 206.340 秒、984,840 KiB、34,172,028 bytes だった。zstd 1.5.7 の `-19` で B2 の Yosys は 9,449,054 bytes、nextpnr は 5,804,193 bytes になった。

Yosys の A/A は不一致だった。B の SHA-256 は `8376ebab361800f771ce0c283699fc3ea6140f1caecb81a0fd0d7d687a7544b0`、B2 は `4c252e3bbda1917e284d7043ac675c0635de50d67f2e7750ff3cab8644df5ba3`、既存の `build/wasi` は `aa18e2c167d614e4194796041bf4cb533a659b0028668418ee109a6cd9cc58aa` だった。WASM 内の ABC 文字列にビルド日時が含まれ、B と B2 で値が異なることを確認した。nextpnr は B、B2、`build/wasi` の全てが `b011f1d2798dead2698d58037d40523885330b7c0c7df2cf9577f07dbcfc7e7f` で一致した。B と B2 の Yosys 実行時間は測っていないため、A/A のノイズ床は未算出である。

B、Tang Nano 1K、1 回の Node WASI smoke run は成功した。合成は 1,213.761 ms、配置配線は 364.444 ms、終了時のメモリーは Yosys が 31,653,888 bytes、nextpnr が 18,874,368 bytes だった。JSON ネットリスト SHA-256 は `ed1a8270df866111bd762c3472668206859171d70301cbd12317a585adb5b5bf`、nextpnr 出力は `b94aa344cd99d2caa2228eeed445e62a76ea008d5410125080a1963e717259bd`、`.fs` は `6f83a9e8e96aa5f39b0da9a4176859098b2d5fba4bfb2cf0e5bd3c9aea5d29d3` だった。負の対照ではコピーした JSON と `.fs` の各 1 byte を変更し、両方の SHA-256 不一致を検出した。生データと実行ログは `build/s5/instrument-validation.csv` と `build/s5/instrument-validation-runs-retry/` にある。

Phase 1a の時点では、JOBS=2 の B と B2 のビルド時間から、未ビルドの 7 variant を約 322 分、Node の 180 試行を約 7 分、Chromium の最大 60 試行を約 20 分と見積もり、全体を約 5.8 時間とした。これは後述する JOBS=10 の見積もりに更新する前の値である。

### Phase 1b の記録（JOBS=10、SOURCE_DATE_EPOCH 固定）

2026-10-28 に B と B2 の出力先を削除し、新規ディレクトリーに再ビルドした。どちらも `SOURCE_DATE_EPOCH=1791880533` でビルドされ、Yosys WASM の SHA-256 は `05598a8d79b716f8711287b2e16610f8a0a7f8610ff9bdfbf6b1ce19839ff037` で一致した。両方のファイルは 52,926,644 bytes、zstd 1.5.7 の `-19` 圧縮後は 9,448,979 bytes だった。ビルド時間は B が 838.420 秒、B2 が 839.160 秒で、ピーク RSS はそれぞれ 393,416 KiB と 393,420 KiB だった。

nextpnr の B と B2 の SHA-256 は、どちらも `b011f1d2798dead2698d58037d40523885330b7c0c7df2cf9577f07dbcfc7e7f` で、`build/wasi` の既存成果物とも一致した。nextpnr のビルド時間は B が 93.910 秒、B2 が 91.950 秒だった。既存の Yosys `build/wasi` は修正前にビルドした成果物で、SHA-256 は `aa18e2c167d614e4194796041bf4cb533a659b0028668418ee109a6cd9cc58aa` だった。新しい B/B2 の A/A 判定には使わず、同一条件で再ビルドした B と B2 の一致を判定した。

WASM の文字列には `Oct 13 2026 08:35:33` が含まれ、ソースで確認した `__DATE__` と `__TIME__` が固定された。B、B2 のいずれにも `build/s5` を含むパス文字列はなかった。ビルドコマンドの `-ffile-prefix-map` は `WASI_BUILD_DIR` で決まる `$build_dir` を `/build` にマップする。

B、Tang Nano 1K、1 回の Node WASI smoke run は成功した。合成は 1,204.625 ms、配置配線は 363.528 ms、runner の wall time は 2.396 秒だった。終了時のメモリーは Yosys が 31,653,888 bytes、nextpnr が 18,874,368 bytes だった。JSON ネットリスト SHA-256 は `0dc67c8be84b75ba4956e17e2f6dc4954053918f0269e1b759ecb188b79bb485`、nextpnr 出力は `b94aa344cd99d2caa2228eeed445e62a76ea008d5410125080a1963e717259bd`、`.fs` は 351,954 bytes、SHA-256 `6f83a9e8e96aa5f39b0da9a4176859098b2d5fba4bfb2cf0e5bd3c9aea5d29d3` だった。負の対照ではコピーした JSON と `.fs` の 1 byte 変更を両方検出した。生データと実行ログは `build/s5/phase1b-build.csv`、`build/s5/phase1b-smoke.csv`、`build/s5/phase1b-smoke-runs/` にある。

正式な計測は未実施。JOBS=10 の B と B2 の平均ビルド時間は Yosys と nextpnr の合計で約 15.5 分だった。これを残り 7 variant に当てはめると約 108.7 分、Node の 180 試行は smoke と同じ 2.396 秒を仮定して約 7.2 分、Chromium の最大 60 試行は 1 試行 20 秒として約 20 分となり、合計は約 2 時間 16 分である。候補によるビルド時間の差や再試行を含まない外挿である。正式なマトリクスは未開始。

## 結果

正式な比較は未実施。事前登録した基準、条件、variant は結果を見てから変更しない。生データは正式実験後に同じ名前の `.csv` に保存する。

## 捨てた試行と経緯

正式な比較は未実施。最初の build フェーズは GNU `time` の表示ラベル `h:mm:ss or m:ss` を誤解析して B の後に停止したため、時間パーサーを修正して B2 を別フェーズでビルドした。B の nextpnr 初回ビルドは PATH に Node.js がなく失敗したため、Node.js を PATH に加えて `nextpnr-retry` にビルドした。最初の smoke run は Node.js の WASI 実行後に閉じられた file descriptor を二重 close して失敗したため、既存の nextpnr helper と同じ `EBADF` 処理を追加し、新しい出力先で再実行した。

### 失敗した試行: 初回 A/A（JOBS=2、SOURCE_DATE_EPOCH 固定前）

B と B2 の Yosys WASM はどちらも 52,926,660 bytes だったが、SHA-256 はそれぞれ `8376ebab361800f771ce0c283699fc3ea6140f1caecb81a0fd0d7d687a7544b0` と `4c252e3bbda1917e284d7043ac675c0635de50d67f2e7750ff3cab8644df5ba3` で、66,642 bytes が異なった。既存の `build/wasi` の SHA-256 は `aa18e2c167d614e4194796041bf4cb533a659b0028668418ee109a6cd9cc58aa` だった。ABC の `mainUtils.c`、`cmdUtils.c` および Cadical の version source が `__DATE__`、`__TIME__` を使い、Yosys の `kernel/version.cc.in` も同じマクロを使うことを確認した。したがって、確認した日時文字列は CMake/Make 生成ではなくコンパイル時マクロ由来である。初回 B/B2 の ABC 文字列には異なるビルド日時が入っていた。

## 結論

未確定。安定性と採否の基準を満たすことを確認するまで、現行の B を維持する。

## 未確認の点

Chromium、Firefox、Safari の現行安定版における target feature の対応状況は、正式な採否判定時に根拠となる資料と確認日を記録する。実機の Tang Nano では測定しないため、結果を実機の性能として扱わない。

## ログ

大きなビルドログと Node WASI の実行ファイルは `build/s5/` に置き、コミットしない。正式記録では再生成コマンドと SHA-256 を示す。
