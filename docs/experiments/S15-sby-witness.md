# S15: SbyPopenによるwitness変換の実境界

[実験の索引](README.md) / [実SBYの停止・輸送の対照](S15-sby-controls.md)

## 目的と範囲

上流の`witness.py`とClickをnative PythonとPyodideの子workerで実行し、AIGERとBTORの形式変換、標準出力、ファイル差分と終了情報を比較します。SMTBMCはYWを直接生成するため、通常のSBY条件からこの子を自然に呼べるとは限りません。

この試験のrootは上流SBYそのものではなく、製品の`formal_process.SbyPopen`を呼ぶ検査専用の`tests/synth/formal-witness-boundary.py`です。rootの実行枠だけを使うため、実行時のmanifestに限って`sby.py`をこのfixtureへ置換します。元のmanifestと全ソースも別に保存し、独立監査で変更がこの1ファイルに限られることを確かめます。子の`witness.py`、`ywio.py`、Clickと製品のprocess・delta処理は原本のままです。JavaScriptへmapや変換の意味論を移植しません。

元のVerilogの反例、AIGER・BTORソルバーの判定、回路の性質の証明を検査したものではありません。トレースは2時刻の形式境界用fixtureです。上流が変換できることと、回路の有効な反例であることを混同しません。

## 入力・固定条件と事前の基準

map生成の入力は、実SBYの`yices2-bounded-pass`が出力した`design_prep.il`です。ソースpinと一致するnative Yosysを使い、`vendor/sby/sbysrc/sby_core.py`のAIGER・BTORモデル生成と同じコマンド列で`write_aiger -ywmap`と`write_btor -ywmap`を実行します。全コマンドを`.ys`へ、stdout・stderr・終了情報を個別ファイルへ保存します。使ったnative Yosys自体もhashとともに保存します。

| 条件 | 採否の基準 |
| --- | --- |
| AIGER | 実際のSbyPopenから`yosys-witness aiw2yw trace.aiw aiger-map.json aiger.yw`を起動 |
| BTOR | 実際のSbyPopenから`yosys-witness wit2yw trace.wit btor-map.json btor.yw`を起動 |
| 原本 | 元ソースのhashと、rootだけを替えたmanifestのhashを検査。子のソース変更を拒否 |
| native | map生成と両変換の終了0・signalなし・エラーなし。stderr空、切れたトレースやWarningを拒否 |
| 子境界 | 両子がtoolとして起動し、exited・終了0・integrityVerified。rootと全3 workerの実exitを確認 |
| 輸送 | 両出力YWの全byteとstdout/stderrがnativeと一致。4入力のbyteも不変。出力は6ファイルのみ |
| 監査 | 生の終了・イベント・全ファイルから全7列を再生成。CSVだけの自己申告を使わない |
| 反復 | 停止・輸送の対照と同じ清浄commitでA/A 2回・正式5回。反復間のYW hashが一致 |

NodeとPyodideの版、native Python・Yosysの実際の版、ソースとバイナリーのhash、計測器とfixtureも保存します。所要時間はrootと両子を含む経路全体の値であり、2変換の個別時間ではありません。ビルドは繰り返さず、固定した資材を使います。

## 再実行

```sh
node scripts/probe-formal-witness.mjs \
  --sources build/S15/p3-sby-campaign-assets \
  --model build/S15/p3-controls-preliminary-4/yices2-bounded-pass/output/result/model/design_prep.il \
  --yosys build/native/yosys --out build/S15/p3-witness-preliminary
python3 scripts/audit-formal-witness.py build/S15/p3-witness-preliminary
```

正式な反復は[対照全体のコマンド](S15-sby-controls.md#計測器と再実行)で実行します。各回の対照で生成したモデルを使い、witness用の別ディレクトリーへ結果を保存します。独立監査器`audit-formal-witness.py`は全7列を、全体の監査器はphaseとiterationを足した全9列を照合します。結果は上書きしません。

## 予備結果・失敗と制約

最初のmap生成は排他的なformalffオプションで失敗しました。詳細とログは[停止・輸送の記録](S15-sby-controls.md)に残しています。その後、上流の手順で両mapを生成できました。

変換実行器の初回は検査用worker factoryのexport名を誤ってimportし、起動前に停止しました。ログは`build/S15/p3-witness-preliminary-1.log`へ保存しました。修正後の2回目は両変換が成功し、nativeとPyodideでYW全byteが一致しました。3回目はmap生成の終了情報も保存し、独立監査でCSV全7列、全3 workerの実exit、全6ファイル、stdout/stderrと原本の不変を照合しました。証拠は`build/S15/p3-witness-preliminary-3`、監査結果は同名の`-audit.json`です。

3回目の出力はAIGERが296 byte、BTORが567 byteです。SHA-256はそれぞれ`93ce3a849c0eac5c0d9404a2fd6c2015d2cfafa041e4ba2d44410962980a1a26`と`4470ac2e779b8a4a2733044cd3bdcea7a2f1e13c169c0f877178c63c20870001`でした。未コミットの予備値であり、正式な同一commitの反復とは区別します。

正式反復は未完了です。ブラウザーの画面、実機Tang Nano、AIGER・BTORの実ソルバーは本リポジトリでは試していません。
