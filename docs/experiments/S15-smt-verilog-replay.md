# S15: SMT反例を元Verilogで独立に再実行する

[実験一覧に戻る](README.md)

## 目的と仮説

原本SMTBMCのVCD出力境界で記録した値を、元VerilogのIcarus native/WASMへ渡す。DUTの内部状態を直接設定せず、入力だけを駆動して、ポート・内部信号・clock・時刻・assertの診断を照合する。これにより、solverの値を保存するだけでは見つからない、元回路との不一致を検出できると考える。

この記録の初版は、正式測定前の条件と予備結果である。正式5回・A/A 2回、証拠ZIPの復元、提出commitの最終確認はまだ完了していない。画面統合、元VHDL/PSLと下位化Verilogの比較、T6全体の認定は別工程とする。

## 固定する条件

- 4候補はYices2、Z3、Bitwuzla、Boolectorとする。追加候補の製品での無効状態は変えない。
- 原本のSMT解析・property選択・solverの判定処理は変更しない。
- ソース・モデル・記録JSON・元VCD・生成testbench・再実行出力のhashを残す。
- native/Pyodideの記録有無を比較し、同一runtimeの原本成果物は全byte一致を要求する。
- runtime間の原本testbench比較では、PI宣言と同じ名前への接続の順序だけを正規化する。原本のbyteは残す。
- 深さN-1、N、N+1、proveのbasecase、負エッジ、非ゼロ初期値、組合せ回路、reset、assume、複数assert、階層を含む17ケースを使う。
- 未初期化、未知初期値、memory、assertなし、空虚な前提、組合せループは成功と分類しない。拒否理由と上流のtool errorを区別する。
- 既にビルドした固定版の参照バイナリーを使い回す。測定時に本体のbyteとbuild metadataを照合する。版表示の原文、ホスト、submodule、実行コマンドも保存する。
- 正式測定ではclean checkoutと同一commitを要求する。実行中に計測器を編集しない。

## 事前の採否基準

4候補ごとにA/Aを2回、その後に正式測定を5回行い、1回ごとに候補を交互に実行する。個別CSVは53行21列、全体は1,484行23列とする。全列を独立監査器で生証拠から導出する。受理する再実行、拒否、上流エラーの区分が期待どおりであることを要求する。

全反復でソース・モデル・記録・再実行testbench・診断・波形の意味的hashが一致することを要求する。反復比較で除くのは経過時間とVCDのdate欄だけとし、生VCDは変更せずに残す。各条件の正式5件から経過時間の中央値・最小・最大を出す。これは参照環境とWASMの時間であり、実機FPGAの値ではない。

CSV/JSONの全21列の改変に加え、ソース、モデル、記録値、VCD、testbench、sample欠落、clock edge、子process、再実行出力の改変を拒否することを要求する。ZIPを空の場所へ復元し、保存した監査器でも全列を再監査する。失敗試行は成功した正式測定に混ぜない。

## 再実行コマンド

Python用の固定資材と4候補のprobe manifestは、先行する[SMT記録の正式測定](S15-smt-trace-audit.md)と同じものを使う。出力先が既にあれば停止する。

```sh
python3 scripts/measure-smt-replay.py \
  --sources build/S15/smt-trace-python-assets-formal-01 \
  --probes build/S15/smt-trace-all-probes.json \
  --out build/S15/smt-verilog-replay-formal-01
python3 scripts/measure-smt-replay.py --audit-only \
  --out build/S15/smt-verilog-replay-formal-01
node --test tests/web/formal-smt-replay.test.mjs tests/web/formal-trace-compare.test.mjs
```

## 予備結果と失敗試行

未コミットの予備実装で、4候補の計212行と全21列の監査が通った。Web単体330件、Python単体148件も通ったが、これは提出commitの検証ではない。Yices2の予備証拠に対する70件の改変対照は全て拒否した。

予備試行では、定数netを元HDLの信号として参照する誤り、階層内のclock別名の扱い、PI順序とPython hash依存の順序差を検出した。定数はliteralで照合し、clock別名は同じRTLIL bitの場合だけ受理する。比較時の正規化はPI順序に限定し、native/Pyodideに同じhash seedを渡す。

改変対照の初回は、保存した再実行ファイルの位置を取り違えて停止した。2回目は資材manifestのキー名の取り違えで停止した。どちらも監査成功に数えず、ログを保持して修正した。nativeの診断を追加監査する際には、ivlppの標準出力が前処理済みソースである点を見落とした。前処理出力と実行出力を区別し、実行出力・各段階の終了code・全stderrを照合するよう訂正した。
