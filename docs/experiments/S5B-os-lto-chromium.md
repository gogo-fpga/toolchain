# S5B Yosys・nextpnr の Os／LTO／Os+LTO を Chromium で比較

- 状態: 事前登録済み
- 日付: 2026-10-29
- 担当: Devin
- 関連: [S5 WASI ビルド最適化](S5-wasi-build-options.md)
- 基準 commit: `f440ab04fdbe728edf9ac124e6af6221722495ef`
- 事前登録 commit: 初回 commit 後に追記する。正式計測は SHA を記録した commit の後に始める。

## 目的

Yosys と nextpnr の WASI 最適化案 `Os`、`LTO`、`OsLTO` を、同一セッションで Chromium の合成・配置配線時間と圧縮後サイズを測って比較する。安定性を速度より優先し、S5 の記録を置き換えずに追加結果として残す。

## 仮説

`OsLTO` は `Os` の小さい WASM と `LTO` の実行時間上の利点を両立し、既定案 `B` と同じネットリスト、配置配線結果、`.fs` を生成する。既存の `LTO` と `Os` の結果も同一条件で測り直し、同じ基準で採否を判断する。

## 基準

基準は正式計測前に固定する。候補は `LTO`、`Os`、`OsLTO` とし、安定性条件をすべて満たさない候補は採用しない。

1. Node と Chromium の全対象ボード・全反復で、ネットリスト JSON、配置配線 JSON、`.fs` が同じボードの `B` とバイト単位で一致し、trap または失敗がないこと。
2. 次のいずれかを満たすこと。
   - Chromium の Tang Nano 20K の合成＋配置配線時間の中央値が `B` より 10% 以上速く、かつ `B` と `B2` のこのセッションでの中央値の絶対差より大きく速い。
   - Yosys と nextpnr の zstd-19 圧縮サイズの合計が `B` より 10% 以上小さく、Chromium の Tang Nano 20K の合成＋配置配線時間の中央値が `B` より 5% を超えて遅くない。
3. Yosys と nextpnr の合計 build wall time が `B` の 2 倍以下である。
4. 使用する WASM target feature が、現行安定版 Chromium、Firefox、Safari でサポートされている。
5. 各候補の Yosys と nextpnr を二度ビルドした SHA-256 がそれぞれ一致すること。S5 の成果物は、S5 CSV に記録された SHA-256 と一致した場合に限り、その二度のうち一度として再利用できる。候補の成果物で `node --test tests/synth/*.test.mjs` が 5 回連続で成功し、build peak RSS を記録すること。peak RSS が 14 GiB を超えた候補は、16 GB GitHub-hosted Ubuntu runner に収まらないものとして不合格とする。

S5B の Node 計測は `OsLTO` のみ、4 ボード×5 回とし、全出力を `B` と比較する。Chromium は `B`、`B2`、`LTO`、`Os`、`OsLTO` を4ボード×5回測る。順番は repeat を外側、board を次、variant を内側にして交互に実行する。全 Chromium 試行で合成時間、配置配線時間、合計時間、`.fs` の `B` との同一性を記録する。

採用候補は安定性条件を先に適用してから選ぶ。性能基準を満たす候補のうち Chromium Tang Nano 20K の合成＋配置配線中央値が最も短いものを選ぶ。次点が `|B-B2|` 以内なら、最適化フラグが少ない順 `B < Os < LTO < OsLTO` を優先し、なお同じなら zstd 合計サイズが小さいものを選ぶ。候補がなければ `B` を選ぶ。`LTO` が同じセッションで性能基準 2 のいずれも満たさない場合は、その事実を明記する。

## 条件

| 項目 | 固定値 |
|---|---|
| 基準 commit | `f440ab04fdbe728edf9ac124e6af6221722495ef`（`origin/main`） |
| OS／CPU | Ubuntu 26.04.1 LTS、x86_64、Intel Xeon CPU D-1531 2.20 GHz、6 core／12 thread |
| メモリー | 32 GiB RAM、swap 8 GiB |
| Node.js／npm | Node.js 24.22.1、npm 11.19.1 |
| Chromium | Playwright 1.64.1、Google Chrome for Testing 156.0.8078.4 |
| WASI SDK | 34.0、clang 23.1.0-wasi-sdk |
| Yosys／nextpnr | submodule `vendor/yosys` `28ba3cb926fe376fa05ebfc1b921747d011d4557`、`vendor/nextpnr` `62e659ed6748e9f60b2a4aa25dd4fe79a9605881` |
| 出力先 | build 根は `build/s5b/`。CSV は `docs/experiments/S5B-os-lto-chromium.csv`。ログは `build/s5b/logs/` 以下に保存し、失敗ログも保持する。 |
| 比較 variant | `B`、`B2`、`LTO`、`Os`、`OsLTO` |
| OsLTO の最適化 | Yosys は S5 `LTO` のフラグを使い、B の最適化を `-Os` に置き換える。nextpnr は `USE_IPO=OFF`、`-Os`、明示的な `-flto` を使い、`-flto=thin` がなく、全 object が LLVM bitcode であることを検証する。SHA-256 は `B`、`LTO`、`Os` の各成果物と異なること。 |
| 繰り返し | 候補 A/A は Yosys と nextpnr を各2回。Node は `OsLTO` の4ボード×5回。各候補で Node test glob を5回連続。Chromium は5 variant×4ボード×5回、repeat→board→variant 順。 |
| 測定環境 | Chromium 計測中はマシンを他の重い処理に使わず、開始時の load average と稼働プロセスを記録する。 |
| S5 からの再利用 | 各成果物を S5 CSV の `wasm_sha256` と照合してから決める。比較対象の CSV 行、成果物 hash、build time、peak RSS を記録する。 |

S5 の `B` build time は Yosys 838.420 s、nextpnr 93.910 s、合計 932.330 s である。したがって基準 3 の上限は 1,864.660 s。S5 の基準 `B` zstd-19 合計は 15,253,172 bytes。S5 の SHA-256 は Yosys `05598a8d79b716f8711287b2e16610f8a0a7f8610ff9bdfbf6b1ce19839ff037`、nextpnr `b011f1d2798dead2698d58037d40523885330b7c0c7df2cf9577f07dbcfc7e7f`。

## 手順

1. S5 の全候補成果物の SHA-256 を S5 CSV と照合し、一致したものだけ再利用する。欠落または不一致は S5 harness でビルドする。
2. `scripts/run-s5-matrix.py` の `OsLTO` variant を使って各候補をビルドし、build wall time、peak RSS、WASM の raw size、zstd-19 size、SHA-256、コマンドとログを記録する。各 LTO／Os／OsLTO の A/A SHA-256 を確認する。OsLTO nextpnr の LTO・IPO・bitcode validator を通す。
3. OsLTO の Yosys と nextpnr WASM をそれぞれ1 byte 改変する負の対照を行い、改変成果物が元の SHA-256 ではなく、WASM validator に拒否されることを確認する。
4. LTO、Os、OsLTO の候補成果物を一つずつ `S5_WASI_ROOT` から指定して、`node --test tests/synth/*.test.mjs` を各5回連続で実行する。全出力を保存する。
5. `scripts/run-s5-matrix.py --phase node` で `B` と OsLTO を使い、4ボード×5回の Node 行列を測る。netlist JSON、PnR JSON、`.fs` の identity を記録する。
6. `scripts/run-s5-matrix.py --phase chromium` で B、B2、LTO、Os、OsLTO を交互に測る。順番は repeat→board→variant。各試行の synth、PnR、total、`.fs` identity と raw log を保存する。
7. CSV の全試行を用いて中央値、B–B2 noise、圧縮サイズ、各基準の pass/fail、および選定規則を計算する。失敗・無効試行も削除せず CSV とログに残す。

正式実行コマンドは、事前登録 commit SHA を追記した後に実行し、CSV とこの記録の「ログ」節にそのまま転記する。出力・ログのリポジトリ内パスは `$REPO_ROOT` を基準に記録し、個人環境の絶対パスはコミットしない。
