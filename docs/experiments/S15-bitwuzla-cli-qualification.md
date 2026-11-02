# S15 P4 BitwuzlaのCLI比較と独立監査

- 状態: 計測器と監査器の事前基準。正式反復・SMTBMC接続・製品認定は未完了
- 前段: [固定依存と診断ビルド](S15-bitwuzla-build.md)
- 戻り先: [実験索引](README.md)

## 目的と事前基準

上流Bitwuzlaのnative版とWASI版で、同じSMT入力への応答、異常終了、明示的に未対応の機能を比較します。ソルバーの意味論は変更しません。両版の診断バイナリーを同じ清浄なcommitから別々にビルドし、原本の構文エラーでtrapする旧WASIバイナリーを負の対照に残します。旧版のtrapは成功として数えません。

1. `--wrap-mode=nodownload` と固定GMP・MPFR・CaDiCaL・SymFPU、上流Mesonのoverlay、原license、全patch、実行したコマンドと終了状態を独立に照合します。バイナリーと全静的libraryのhash、WASIの終了境界、未対応thread・RSSも照合します。失敗ビルドや作業中の変更を正式結果へ含めません。
2. 版表示、help、bit-vectorの値取得とpush/pop、EOF、構文エラー、model、time limit、浮動小数点の5丸め方式とNaN、配列の計14条件を各版で実行します。正常系は終了状態・stdout/stderrを照合します。WASIのtime limitはthread非対応の診断とtrapを記録し、SAT判定や外部workerの期限と混同しません。
3. 旧WASIの構文エラーは別の負の対照として `runtime-error`、終了codeなし、trapを要求します。修正版は両版で同じ診断文を出し、終了code 1を要求します。元のWASIがtrapしない場合も監査は失敗させます。
4. 各条件の元入力、stdout、stderr、JSON、CSVの全14列、バイナリーとmetadataのhash、build logを保存します。独立監査器で全列の改変、入力・出力・依存・patch・実行statusの改変、欠落や余剰の負の対照を確認します。監査に通った条件のみ正式結果に含めます。
5. A/Aを2回、その後に正式5回を、同一の清浄なcommit・バイナリーで実行します。各回は異なる未使用の出力先を使い、実行中のスクリプトや資材を変更しません。A/Aと正式結果の期待応答・終了状態・hashは全回一致が必要です。起動時間は最小・中央値・最大を記録しますが、回ごとに一致するとは仮定しません。
6. 生の証拠をZIPとmanifestに保全し、ZIP全件のbyte数・SHA-256を照合します。別の清浄な場所へ展開し、元のbuild出力なしでも監査器を再実行します。使用したGit commitのblobはGitから参照できる状態を保ちます。

この比較が通っても、SMTBMC/SBYへの接続、取消と外部期限、配布条件の検証、製品での有効化は別の検査です。BitwuzlaとBoolectorは引き続き無効とします。実機のTang Nanoでは試していません。

## 予備試行と失敗

固定Mesonの清浄な診断ビルドとCLIの最初の29実行は[前段の記録](S15-bitwuzla-build.md)にあります。監査器を追加するために作業ツリーを変えた後、改めて行った予備試行は、実行時のスクリプトがcommitのblobと一致しなかったため、独立監査で `Harness commit mismatch` として拒否しました。監査器の最初の呼び出しには必須の `--input` がなく、引数エラーで停止しました。どちらも正式結果に含めず、生ログは `build/S15/` に残しています。同じ版の清浄な計測器・監査器を固定してから再実行します。

2 CPUのホストでnativeとWASIを並列にした初回のclean-03ビルドは、出力metadataが両方とも `error` になったため認定外にしました。原因は並列の資源競合と断定せず、全ログを残して逐次ビルドで再確認します。その後の逐次clean-03ビルドは両方 `built`、同じcommitで29実行を通過しましたが、計測器の変更後の正式結果には使いません。

## 再実行の入口

```sh
python3 scripts/build-solver-probe.py --solver bitwuzla --runtime native --meson meson --jobs 1 --out build/S15/bitwuzla-native-new
python3 scripts/build-solver-probe.py --solver bitwuzla --runtime wasi --meson meson --jobs 1 --out build/S15/bitwuzla-wasi-new
node scripts/probe-extra-solver-cli.mjs --solver bitwuzla --phase formal-probe --native build/S15/bitwuzla-native-new --wasi build/S15/bitwuzla-wasi-new --negative-wasi build/S15/bitwuzla-wasi-clean-01 --out build/S15/bitwuzla-cli-new
python3 scripts/audit-extra-solver-cli.py --input build/S15/bitwuzla-cli-new
```

出力先は毎回未使用の名前にします。最後の負の対照は、終了境界修正前の清浄な旧版から作ったWASIバイナリーです。正式結果を追記するときに、実際のcommit・binary・CSV・証拠ZIP・実行回数を記録します。
