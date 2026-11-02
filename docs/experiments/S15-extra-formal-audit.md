# S15: 追加solverのSMTBMC/SBY独立監査と反復

[実験索引](README.md) / [接続層と固定資材](S15-extra-solver-smtbmc.md)

## 目的と対象

Bitwuzla/Boolectorを原本SMTBMC/SBYへ接続した結果を、生のstream、成果物、process記録から独立に検査します。検証の意味やSMT応答の解析は変更しません。製品での有効化、元HDLによるSMT反例の独立再実行、画面統合は別の認定です。両候補を製品catalogでは無効のままにします。

この記録は監査器と計測器の検証を扱います。資材のsource、build commit、コンパイラー、binary hashは[接続層の資材表](S15-extra-solver-smtbmc.md#資材)と前段のCLI認定記録を参照します。ここでは同じbinaryを再利用し、再ビルドしません。

## 事前基準

正式試行は `measure-extra-formal.py` を含む清浄なcommitを固定して実行します。先にA/Aを2回、続けて正式試行を5回実行し、各回でBitwuzla、Boolectorの順に交互に測ります。1候補につきnative参照、SMTBMC、SBY、異常対照を逐次実行します。途中で失敗した場合は停止し、同じ出力先を再利用しません。

| 対象 | 1候補・1回の条件 | 合計行数 | 全列数 |
|---|---|---|---|
| SMTBMC | 6 fixture、proveをbasecase/inductionへ分けた8条件 | 112 (A/A 32、正式80) | 15 |
| SBY | BMC/prove/coverの6条件 | 84 (A/A 24、正式60) | 19 |
| 異常対照 | 通常3、異常8、制限5の16条件 | 224 (A/A 64、正式160) | 14 |

SMTBMCの `phase` は上流の実行段階です。反復の種類は別の `series` 列へ保存し、取り違えません。異常8条件は取消、期限切れ、rootの異常終了、壊れた終了通知、破損差分、競合差分、構文エラー、未許可の終了codeです。制限5条件はautotune、並列jobs、jobserver、temporary、linkです。

全行のstatus/error、終了code、SMT log、stderr、VCD、YW、testbench、SQLite、model/solver/Yosysのhash、輸送記録を検査します。SBYは全成果物とSQLite全5表を検査し、記録している環境差だけを正規化します。SMTBMCとSBYの期待行数、全列、一意な条件の集合は既定のYices2/Z3から緩めず、追加候補を明示したときだけ切り替えます。

反復間では、source、solverとYosysのbinary、Node、Pyodide、native Python、計測器のsnapshotが一致することを必須にします。SMTBMCの終了と主要出力hash、SBYの正規化後の全成果物、対照の分類が全反復で一致しなければ不採用です。正式5回の時間は各条件の最小値・中央値・最大値を保存し、A/Aの時間を混ぜません。これらはVM上の検査であり、実機性能の値ではありません。

ZIPから未使用の場所へ証拠を復元し、全ファイルのhashと保存した監査器による再監査を必須にします。CSVの改変、欠落した成果物、異なるsolver hash、偽の成功状態を拒否する負の対照も必須です。これらが揃う前に正式認定とは扱いません。

## process境界の検査

Bitwuzlaは実WASIの `--help` と `--lang smt2` の2子processを要求し、順序、binary hash、実際の終了code、stderr、資源記録を照合します。helpの文字列を代わりに生成しません。

Boolectorは既定の `[0]` を広げず、明示した `[0, 10, 20]` と実codeを検査します。fixtureと段階から、最後が充足なら10、不充足なら20であることも照合します。BMCの違反、coverの到達、proveの帰納段階の不成立を同じ成功とは分類しません。

構文エラー対照は、検査専用workerがWASIの実 `fd_read` で最初の入力byteだけを `?` へ変えます。変更前後のbytesとhash、実solverの診断と終了1を保存し、trapと区別します。未許可code対照は、正常に実行したsolverの実codeと、検査用に9へ変えた通知を両方保存します。いずれも製品コードにはfault注入を追加しません。通常のFAIL/UNKNOWNと区別し、成果物や検証済みのPASSを公開しないことを検査します。

SMTBMCの正式証拠には、native参照のmetadata、native実行先とbinary本体、WASI本体を追加保存します。JSONの重複key、非有限値、証拠パスの途中のsymlinkも拒否します。容量を抑えるため、完了済み試行の同一入力を全byte照合後にhardlinkで共有します。内容を変えたり、symlinkで監査を迂回したりはしません。

## 監査器の予備検査と失敗

接続commit `82a37a7db556647de54c95e8ace9c19cbc5915ff` の既存予備記録を、新しい明示的solver選択で監査しました。SMTBMCは全16行13列、SBYは全12行16列が通っています。これは予備データの独立監査であり、正式反復の結果ではありません。

構文エラーと未許可codeの予備対照では、両候補で `runtime-error` と空の成果物を確認しました。初回の検査用観測メッセージは、detailの `type` が輸送用の `type` を上書きし、solver終了を `protocol-error` にしていました。`resultType` へ分離し、初回は除外しました。修正後は実parserの診断と終了1、正常codeから9への変更をそれぞれ記録できています。

全対照の予備03は、同じ作業コピーへのファイル追加でGitの状態が開始時から変わり、最終gateで停止しました。途中の16行が揃っていても、CSVと最終検査がないため採用しません。試行中の出力は削除せず保存し、次の検査はcommit後の固定した状態で行います。

## 再実行

前段で照合した各候補のnative/WASI buildを、診断manifestの `native` と `wasi` へ指定します。solverを指定しない従来のprobe/auditの既定対象はYices2/Z3のままです。次の計測器だけが追加2候補の全条件を要求します。

```sh
python3 scripts/build-formal-python.py --out build/S15/extra-audit-python
python3 scripts/measure-extra-formal.py \
  --sources build/S15/extra-audit-python \
  --probes build/S15/extra-probes.json --synth build/synth \
  --out build/S15/extra-formal-campaign
python3 scripts/measure-extra-formal.py \
  --audit-only --out build/S15/extra-formal-campaign
```

計測器は全コマンド、submodule、各probeの実際の版・ホスト・資材・source・全snapshotを保存します。出力先が既存なら停止します。単体検査は `python3 -m unittest discover -s tests/check-solver-protocol`、構文検査は `node --check` と `python3 -m py_compile` です。

## 現在の判定

監査器と計測器は実装済みです。清浄なcommitでの全対照の再検査、正式5回・A/A、証拠復元後の監査は未完了です。予備監査、正式結果、製品の有効化を別の状態として扱います。
