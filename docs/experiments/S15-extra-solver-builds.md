# S15 P4 追加ソルバーの固定依存と診断ビルド

- 状態: 事前基準と依存取得の記録。native/WASIのビルドは未実施
- 基準: [S15の共通基準](S15-formal-verification.md)、[候補と無効理由](../research/formal-capabilities.md)
- 戻り先: [実験索引](README.md)、[形式検証の調査](../research/formal-solvers.md)

## 目的と固定条件

BitwuzlaとBoolectorを、固定した上流実装のままnative/WASIで動かせるかを調べます。nativeは比較用であり、製品として配布しません。Boolectorは保守終了のため既定にはしません。未検証の候補は能力一覧で無効のまま保持します。

本書は診断ビルドより前に追加しました。実行するcommit、作業ツリーの差分、実際のcompilerとSDK、全コマンド、終了状態、所要時間、ログとbinaryのSHA-256は試行ごとの `metadata.json` に保存します。実行中のスクリプトは変えず、失敗した出力先は再利用しません。正式な検証は清浄な同一commitに限り、予備試行と区別します。

| 条件 | 固定方法 |
|---|---|
| 本体 | `git ls-tree HEAD vendor/bitwuzla vendor/boolector`。原本の直接編集はしない |
| Bitwuzlaの依存 | 固定版の `subprojects/cadical.wrap` と `symfpu.wrap`、RESEARCHのGMP・MPFR表から読む |
| Boolectorの依存 | 固定版の `contrib/setup-cadical.sh` と `setup-btor2tools.sh` のcommitと取得元から読む |
| Boolectorのprofile | 上流のonly-CaDiCaL、GMPなし、Pythonなし、単一thread。Lingelingなどを暗黙に加えない |
| Meson | `requirements-formal-build.txt` のhost専用hash lock。rootのpip Dependabotで更新を監視 |
| MPFR | RESEARCHのarchive pin。公式配布、GNUミラー、原文licenseと変更履歴を照合 |
| 製品の境界 | 新しいarchive pinの登録だけでバイナリーや配布ソースの同梱完了とは扱わない |

## 結果を見る前の採否基準

1. 本体・依存の固定値に一致し、必要なlicense原文があり、実際のlink対象を列挙できること。未知の指定、取得先やcommitの不一致、出力の上書きは拒否します。
2. nativeとWASIの両方を上流のビルド方式で作り、版表示、`--help`、SMTのsat/unsat、値の取得、push/pop、EOFを比較できること。構文エラーは終了コード0でも成功にしません。
3. WASIは実workerを使い、stdout/stderr、分割した入力、応答の境界、停止、期限切れを区別できること。原本SMTBMCが行うBitwuzlaの `--help` 起動も仮想processへ接続します。
4. 採用前に同じbinary・入力のA/A 2回と正式5回、全列の独立監査、hash改変・欠落などの負の対照を実施します。成功条件を削って通しません。
5. 512 MiBのmemory上限、配信ファイル25 MiB未満、原文licenseと対応ソースの提供を満たすこと。静的リンクではGMP・MPFRの再リンク条件も確認します。

ビルド成功だけでは能力一覧を有効化しません。資材manifest、binary hash、原本SMTBMC/SBY、反例、配布の確認は別の条件です。proof semanticsやSMT parserをJavaScriptへ移植しません。

## MPFRの取得と原文

公式の [4.2.2配布ページ](https://www.mpfr.org/mpfr-4.2.2/) は2025年3月20日公開を示しています。[原archive](https://www.mpfr.org/mpfr-4.2.2/mpfr-4.2.2.tar.xz) と [GNUミラー](https://ftp.gnu.org/gnu/mpfr/mpfr-4.2.2.tar.xz) は全バイトが一致しました。正となるSHA-256はRESEARCHの表に置き、ここへ複製しません。

同梱READMEはLGPL-3.0-or-laterを示します。`COPYING`、`COPYING.LESSER`、README、NEWSを改変せず保存します。NEWSの4.2.1から4.2.2への変更は、binary128の型の可搬性、ゼロの `%c` 書式出力の修正と安全性への影響、GMPの `vsnprintf` 代替の問題検出を含みます。独自の算術実装や高速化への置換は行いません。

[Detached signature](https://www.mpfr.org/mpfr-4.2.2/mpfr-4.2.2.tar.xz.asc) をGNU keyringと `gpgv` で照合し、終了0、`GOODSIG` と `VALIDSIG` を確認しました。署名鍵fingerprintは `A534BE3F83E241D918280AEB5831D11A0D4DB02A` です。これは取得したkeyringとの署名一致であり、独立した信頼経路の確認を追加したとは主張しません。GMPで以前確認した期限切れ警告を、このMPFRの結果で取り消しません。

Meson 1.12.1のwheelはPyPIのSHA-256に一致し、同梱COPYINGはApache-2.0でした。runtimeの依存はなく、ninjaなどのextrasは指定しません。Mesonを製品のWASMへ含めるわけではありません。

## 再実行の入口

```sh
python3 -m venv build/formal-build-tools
build/formal-build-tools/bin/pip install --require-hashes -r requirements-formal-build.txt
python3 scripts/build-solver-probe.py --solver boolector --runtime native --out build/S15/boolector-native-01
python3 scripts/build-solver-probe.py --solver boolector --runtime wasi --out build/S15/boolector-wasi-01
```

`--cmake` と `--jobs` でhostツールのパスと並列数を明示できます。対応していないsolver名は拒否します。Bitwuzlaのビルド接続と正式反復は未完了です。Tang Nano実機での動作は本リポジトリでは試していません。
