# S15 P3 原本SBY・SMTBMCのprocess境界

- 状態: 実施中。Pyodideの能力診断とnative原本の予備12条件を実施。Pyodide経由のSBY原本との比較は未実施。
- 関連: [S15の事前基準](S15-formal-verification.md)、[P2の正式比較](S15-solver-native-wasi.md)、[調査索引](../../RESEARCH.md#7-分割した調査)

## 目的と仮説

上流SBYとyosys-smtbmcを原本のまま使い、Pythonのprocess・pipe・待機・終了だけをブラウザー用に接続します。SMTの生成、応答の意味、帰納法、propertyの評価、trace、statusのSQL処理はJavaScriptへ移植しません。P2の実solverと共有bufferを再利用する仮説です。

## 採否の基準

SBYを始点としてYosys、yosys-smtbmc、実solverまで通し、次の6条件をnative原本とPyodideで照合します。事前の期待値と異なる出力は失敗として保存し、判定を緩めません。

| 条件 | mode・depth | 事前の期待status | 意味 |
|---|---|---|---|
| 違反前の短いprefix | bmc・2 | PASS | 深さ内だけ安全。証明ではない |
| 到達する違反 | bmc・6 | FAIL | 元回路の反例とVCD・YWが必要 |
| 短い帰納法 | prove・2 | UNKNOWN | BMCのPASSだけをproofに昇格させない |
| counterの不変条件 | prove・6 | PASS | basecaseとinductionの成立が必要 |
| cover到達 | cover・6 | PASS | 到達の証拠が必要。安全性の証明ではない |
| cover未到達 | cover・6 | FAIL | 到達なし。assert違反とは区別 |

6条件は最初の縦方向の予備検査であり、P3全体の完了基準ではありません。正式比較にはVHDL・Verilog、制約、SMTとproperty、元回路の反例再実行、複数property、空虚な前提も含めます。unknown、timeout、cancel、solver crash、status破損、witness欠如、hash不一致を一つずつ注入して非成功を確認します。正式試行は清浄な同一commitで各5回以上、順序を交互にし、A/Aを2回行います。中央値・最小・最大と生CSV、全列の独立監査、raw log、tool版、hash、失敗試行を保存します。

## 固定する条件と手順

nativeは参照・測定用で、製品runtimeではありません。固定sourceとP2で照合したsolverを使い、SBYの並列数を最初は明示的に1へ制限します。nativeとPyodideの証明条件は同じにし、輸送境界とその待機方法だけを変えます。

予備native検査の再実行コマンドは次のとおりです。manifestは[P2の生成手順](S15-solver-native-wasi.md)で作ったprobe directoryを指定します。出力先が存在する場合は上書きせず停止します。

```sh
node scripts/probe-upstream-formal.mjs \
  --probes build/S15/p2-native-wasi-all-probes.json \
  --out build/S15/p3-native-upstream-1
node scripts/probe-formal-python.mjs --out build/S15/p3-python-runtime-probe-3
```

## Pyodideの能力診断

Node v24.21.0、npmのPyodide 314.0.7に含まれるPython 3.14.2を実行しました。`sys.platform`は`emscripten`、`os.name`は`posix`です。importできることと、実際の操作が可能なことを分けて調べました。

| 境界 | 実際に行った操作と結果 |
|---|---|
| resource | importでModuleNotFoundError |
| subprocess | importは成功。PopenはOSError 138でprocess非対応を返す |
| threading | importは成功。Thread.startはRuntimeErrorで拒否 |
| fcntl | importとF_GETFL定数の取得は成功。仮想processのFD監視は未確認 |
| select | importと空FD・待ち時間0の呼出しは成功。仮想pipeの待機は未確認 |
| signal | importは成功。仮想processの停止・process groupは未確認 |
| sqlite3 | importとin-memory databaseのSELECT 1が成功 |

この診断から、SQL処理を作り直す必要は示されませんでした。一方、原本がposixという条件だけで使うresourceとPopen、reader threadは、そのままでは動きません。importの成功だけをブラウザー対応済みとしません。

## 原本で確認した境界

固定SBYの`sby_core.py`はbash経由のPopen、fcntlのnonblocking指定、select、process groupのsignalを使います。`sby_jobserver.py`は並列数1ならpipeを作りません。Yosysの`smtio.py`はsolverのPopenとreader Thread・Queue、signal、resourceのstack limitを使います。SQLite、proofとSMTの処理は元のPythonを維持し、これらのprocess輸送だけを狭いpatchで接続する方針です。

原典は固定gitlinkの[SBY core](https://github.com/YosysHQ/sby/blob/79fc9eddca5e33a28cc2f2cd19c9825efd9a7255/sbysrc/sby_core.py)、[jobserver](https://github.com/YosysHQ/sby/blob/79fc9eddca5e33a28cc2f2cd19c9825efd9a7255/sbysrc/sby_jobserver.py)、[status](https://github.com/YosysHQ/sby/blob/79fc9eddca5e33a28cc2f2cd19c9825efd9a7255/sbysrc/sby_status.py)、[Yosys smtio](https://github.com/YosysHQ/yosys/blob/28ba3cb926fe376fa05ebfc1b921747d011d4557/backends/smt2/smtio.py)です。URLとSHAは`.gitmodules`と`git ls-tree HEAD`から取得しました。

## 失敗と未確認

最初の能力診断は、resourceがないときの診断器のexcept処理が未登録の辞書要素へ書き込み、KeyErrorで停止しました。診断器を直した2回目を上表の根拠とし、初回を成功として数えません。両方のログと2回目の実行scriptを保全しています。

## native原本の予備基準

P2の固定native solverを使い、原本SBY・Yosys・yosys-smtbmcを縦方向に実行しました。Yices2とZ3の両方で、上表の6条件、計12条件が期待したstatusと終了コードになりました。同じ条件をもう一度実行した予備試行も12条件が一致しました。5回の正式反復やnative/Pyodide比較ではありません。

特に短いproveでは、basecaseの`passed`に対してinductionは`Temporal induction failed!`となり、全体は`UNKNOWN 4`でした。生成した`trace_induct.vcd`と`trace_induct.yw`は帰納法の反例であり、初期状態から到達する元回路の反例として扱えません。不変条件のproveでは、basecaseとinductionがともにpassedで、上流のsummaryがk-inductionの成立を報告しました。

coverの到達はstep 4で、VCDとYWを生成しました。未到達のcoverは`FAIL 2`ですが、assert違反とは区別します。BMCの短いprefixは`PASS 0`でも、有界の確認にとどまります。検査器はmodeとstatusを分けて保持し、status file・終了コード・SBYの最終行の不一致と不正なstatusを拒否します。

予備出力には入力、設定、全stdout/stderr、SMT、制約、VCD、YW、SQLiteと全ファイルのsize/SHA-256を保存しました。診断3では配布Pyodideの5資材のsize/SHA-256も記録しました。原本のPythonと実行scriptのhash、実tool版、未commitの変更を含む状態は各metadataに記録しています。この2試行は未commitの予備結果で、清浄な提出commitを検証したものではありません。

SBY原本のPyodide実行、nativeとのstatus・trace・制約比較、正式反復、UI、ブラウザーの展開器、実機は未完了です。空FDのselectとsqlite3の単独queryを、P3の接続成功として扱いません。
