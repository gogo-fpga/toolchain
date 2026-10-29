# S7: Chromium における openFPGALoader ビルドオプション比較

事前登録。正式計測の前に、目的、仮説、基準、条件、手順を固定する。結果はこの文書と対応する CSV に記録する。

## 目的

openFPGALoader のビルドオプションが、Chromium 上の Web フラッシャーでの書き込み時間、WASM のロード時間とサイズ、ビルド時間、メモリー使用量、安定性に与える影響を比較する。仮想 USB による時間は実機の値として扱わず、実機では試していない。

## 仮説

B を基準に、B+O3、B+O3+LTOA、B+LTOA のいずれかが、安定性の条件をすべて満たしたうえで、B と B2 の差から求めるノイズ幅を超え、かつ主指標を 3% 以上改善すると予測する。条件を満たす候補がなければ B を維持する。

## 基準

安定性の各条件はすべて必須とし、ひとつでも満たさない候補は選定対象から外す。

1. すべての試行で成功し、ログに `FAIL` がなく、trap や hang がないこと。仮想デバイスの最終 SRAM／フラッシュ内容、または既存 E2E の検証信号が、期待する fixture のデータと一致すること。
2. 各候補を 2 回ビルドし、`.wasm` と `.mjs` の SHA-256 がそれぞれ一致すること。
3. 各候補の成果物を使い、`WASM_BUILD_ROOT=... node --test --test-concurrency=1 tests/sim/*.test.mjs` が 5 回連続で成功すること。
4. WASM が使う機能は、製品が必要とする WebUSB と JSPI に対応する安定版 Chromium でサポートされるものに限ること。`wasm-objdump` で検出した機能を記録する。
5. B と選定候補について、次の負の対照を行い、どちらも失敗を検出すること。
   - 1 byte 壊した `.fs` では、書き込み失敗（`FAIL` の検出または verify 不一致）が報告されること。
   - WASM code section の 1 byte を壊すと、UI がロード失敗を検出すること。
6. ビルドの peak RSS が 14 GiB 未満であり、ビルド wall time が B の 2 倍以下であること。

候補の主指標は、8 種類の書き込みケースそれぞれの経過時間の中央値を合計した値とする。B と B2 の主指標の差を `N = |primary(B) - primary(B2)|` と定義する。選定候補は、B より `N` を超えて速く、かつ 3% 以上速い候補とする。条件を満たす候補のうち最も速いものを選ぶ。候補どうしが `N` 以内の差で並ぶ場合は、フラグ数が少ないもの（LTO なしを LTO より優先し、Os を O3 より優先）、次に gzip 圧縮後の WASM が小さいものを選ぶ。該当候補がなければ B を維持する。

二次指標は instantiate の中央値、WASM の raw／gzip／zstd サイズ、ビルド wall time、peak RSS とする。仮想 USB の時間は実機の性能値ではない。

## 条件

- 基準 commit: `092a31bd1fa03ed900ae7eab2b3b4ad926bb80d6`（`origin/main`）。
- 変種は既存の `scripts/build-wasm.sh` profile 構文を使い、`--async=jspi` と pthread を有効にする。`--variant` なしの既定ビルドは変更せず、`.wasm` と `.mjs` の SHA-256 が `origin/main` のビルドと一致することを確認する。
- 変種は次の 5 つとする。
  - B: 現行設定の `-Os`、LTO なし。
  - B2: B を別の `BUILD_ROOT` で再ビルドする。A/A とノイズ幅の確認に使う。
  - B+O3: `-O3`。
  - B+O3+LTOA: `-O3` と全対象への LTO。
  - B+LTOA: `-Os` と全対象への LTO。
- 「Os」はユーザーの指定どおり B（現行設定）を指す。各変種の `flags.make` と `link.txt` で `-O` が各行にちょうど 1 つあること、および LTO フラグが期待どおりであることを S1b と同じ方法で確認する。
- Chromium headless と Playwright を使い、同じホストで他の重い処理を動かさずに実行する。Node からの書き込み測定は行わない。アプリの実際の Web フラッシャー経路と `tests/e2e/fake-usb-helpers.mjs` の仮想 WebUSB を使い、各試行で新しいページを使う。
- 書き込みケースは Tang Nano 1K、4K、9K、20K の各 SRAM／flash の計 8 ケースとする。fixture は `tests/fixtures` が作る `.fs` を使う。別に instantiate（モジュールのロード、compile、instantiate が ready になるまで）を測る。
- 5 回以上繰り返し、各反復で変種の順を round-robin に回転させる。1 ケース 120 秒を超えた場合は失敗として扱う。
- 基準 commit、emsdk と Chromium のバージョン、ホスト CPU、コマンド、環境変数、成果物の SHA-256、出力先を記録する。仮想 USB の結果には「実機では試していない」と明記する。

## 手順

1. `origin/main` を fetch し、記録する基準 commit から指定ブランチを作る。`scripts/build-wasm.sh` を引数なしで実行し、`.wasm` と `.mjs` の SHA-256 を `origin/main` の同じ既定ビルドと比較する。
2. 各変種を別の `BUILD_ROOT`（`build/s7/` 以下）でビルドする。コマンド、環境、wall time、peak RSS、`.wasm` と `.mjs` の SHA-256 を保存する。既存の出力を上書きしない。
3. 各ビルドの `flags.make` と `link.txt` を検査し、期待する最適化レベルが一つだけあり、LTO の有無と範囲が指定どおりであることを記録する。
4. 各変種を 2 回ビルドして A/A の SHA-256 を比較する。各変種の成果物を使ってシミュレーションテストを 5 回連続で実行し、すべての結果を保存する。
5. `wasm-objdump` で機能を調べ、安定版 Chromium の対応状況を確認する。
6. Chromium 上で、8 つの書き込みケースと instantiate を 5 回以上測る。反復ごとに変種順を回転し、毎回新しいページを使う。成功状態、ログ、fixture との一致を確かめ、失敗を含む全試行を記録する。
7. B と、結果に基づいて選ぶ候補のそれぞれで、1 byte 壊した `.fs` と code section を 1 byte 壊した WASM の負の対照を行い、UI が失敗を検出することを確かめる。
8. 安定性の各条件への適合を確認し、主指標から `N` を求めたうえで、固定した選定規則を機械的に適用する。結果と失敗試行を Markdown と CSV に記録し、ログは `build/s7/` に保存する。記録には VM 固有の絶対パスを含めない。

### 手順への追記（2026-10-29、事前登録後・正式計測前）

各 Chromium 書き込み試行では、`tests/e2e/fake-usb-helpers.mjs` の opt-in 状態取得を使って fake USB の最終状態を読み戻す。SRAM は `tests/sim/program.test.mjs` と同じ `parseFsPayload(..., true)` のバイト列、Tang Nano 20K の外付け NOR は `parseFsPayload(..., false)` のバイト列、その他の内蔵フラッシュは `GW1N`、20 バイトの `0xff`、`parseFsPayload(..., false)` を連結したバイト列と比較する。比較は各試行の UI 成功判定の後に行い、長さと全バイトが一致しなければ失敗とする。正式計測前の smoke では、期待値の先頭バイトを意図的に反転する負の対照も実行し、比較が不一致を検出することを確認する。fake USB のモデルと permanent test は変更しない。
