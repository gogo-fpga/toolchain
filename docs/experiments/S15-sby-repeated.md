# S15: 原本SBYの正式反復とA/A照合

対象はT6 P3の計測です。上流SBYからYosys・SMTBMC・Yices2/Z3を呼ぶnative/Pyodideの全12条件を、同じ版・同じ入力で繰り返します。[全成果物の独立監査](S15-sby-artifact-audit.md)で使った既知差だけを正規化し、反復間でも全成果物の内容が同じになるか確認します。[実験の索引](README.md)へ戻れます。

## 実行前に固定した基準

| 項目 | 固定する内容 |
|---|---|
| 仮説 | process境界の差で、SBYの判定・終了・成果物の意味は変わらない |
| 条件 | Yices2/Z3 × BMC深さ内PASS、BMC反例、prove UNKNOWN、prove PASS、cover到達、cover未到達 |
| 計測器の事前確認 | A/Aを2回。その後に正式5回。全12条件を各回欠落なく実行する |
| 採否 | 全7組が成功し、native/Pyodideで全成果物・16列・全SQLite列・再帰的終了が一致する。未知差は0件 |
| 反復間の採否 | 同じ12条件の正規化後の全成果物hashが、A/Aと正式5回の間で全て一致する |
| 時間 | nativeとPyodideの有限かつ正の実測時間を保存し、正式5回の最小・中央値・最大を出す。高速化の採否基準にはしない |
| 中止 | A/Aまたは反復の差を検出した時点で後続を止める。失敗・log・既存の証拠は消さない |
| 除外しないもの | ordinary engine nonzero、UNKNOWN、cover未到達を失敗した測定として除かない。期待した意味・終了コードと照合する |

1組はnative全12条件、その直後に対応するPyodide全12条件です。nativeを先に生成するのは、各回固有の比較基準が必要なためです。別の最適化候補を比較する実験ではなく、実行順を使った速度の優劣は主張しません。時間にはworkerの起動・資材読込み・process・成果物回収が含まれます。

期待値は[既存6条件の表](S15-sby-artifact-audit.md#固定条件と実行前の基準)と同じです。各回268成果物、全7組で1,876成果物を比較します。A/Aは24行、正式は60行で、合計84行です。元の16列に`phase`・`iteration`・`nativeElapsedMs`を足した19列を、生の証拠から独立に作り直します。経過時間を除いた全成果物hashの一致は、時間そのものの一致を意味しません。

## 固定する版と入力

SBY/Yosys/Clickのpin、Yices2/Z3のビルド済みnative/WASI、Yosysのnative/WASI/shareは[接続層の実測](S15-sby-runtime.md#清浄な実装commitの予備確認)と同じものを使います。比較前には独立監査で実入力binaryとmetadataのSHA-256を照合し、source/pin/patchとPython資材のhashも調べます。binaryを作り直す候補比較ではありません。

実行版は、この事前基準と計測器を含む清浄なcommitへ固定します。runnerは開始時・各processの前後・完了時にcommitと空のworktreeを確認し、版や保存済みsourceが変わった場合は成功としません。実行中のスクリプトは編集しません。`plan.json`へcommit・runner hash・OS・CPU数・メモリー・引数・指定した環境変数を保存し、各組のmetadataへ実Node/Python/Pyodide・pin・binary hash・source snapshotを保存します。

## 再実行

前提は[SBY接続層の準備](S15-sby-runtime.md#比較器の予備実行)と同じです。native solverを含むprobe manifestとYosys資材が必要です。出力先は存在しない新しいパスを使います。

```sh
git status --porcelain
python3 scripts/build-formal-python.py --out build/S15/p3-sby-campaign-assets
python3 scripts/measure-formal-sby.py \
  --sources build/S15/p3-sby-campaign-assets \
  --probes build/S15/p2-native-wasi-all-probes.json \
  --synth build/synth --out build/S15/p3-sby-campaign
python3 scripts/measure-formal-sby.py \
  --out build/S15/p3-sby-campaign --audit-only
```

runnerが最初に2回のA/Aを実行し、その後の5回を正式反復として分けます。nativeとPyodideの両probeへ`--formal`を渡し、既存の予備測定と区別します。このflagだけで成功とはしません。全12条件の独立監査を各回実施したうえで、別の集計経路から19列・全84行・全反復のhash・時間統計を照合します。

`aa-1`・`aa-2`・`run-1`から`run-5`の各directoryにnative・Pyodideの元の証拠と実行logを置き、元の値を残します。終了後に`all-independent-audits.json`、`results.csv`、`summary.json`、実際に実行した`commands.json`を追加します。失敗時は`failure.json`を追加し、成功のsummaryへ置き換えません。元の証拠が必要なので、`--audit-only`は集計CSVとsummaryだけでは実行できません。

## 計測器の対照と範囲

全成果物・16列・SQLite・transportの個別の改変は[独立監査のunit対照](S15-sby-artifact-audit.md#計測器の負の対照)を維持します。反復の監査には、回の欠落、scheduleの型違い、版・runner hashの違い、dirty状態、予備/正式の混在、集計CSV・summaryの改変を加えます。native/Pyodideの1組としては一致するが、他の回とは入力が違う場合も拒否します。

これは実SBYを動かす計測器と正式反復の層です。workerの全異常対照とwitness変換の実境界、元回路の反例検査、製品の配布・画面統合、CI全体は別の残件です。Tang Nano実機では本リポジトリで試していません。

## 結果

上記の基準を固定した段階です。未commitのunit検査を正式反復とは数えません。清浄な実行commit、全列の生CSV、各回の完全な監査結果、時間統計、失敗試行、証拠のhashを実行後に追記します。
