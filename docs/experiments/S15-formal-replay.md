# S15 P1 SAT反例の独立再実行

- 状態: 実装中の診断試行。正式な5回反復・ブラウザー統合は未完了
- 基準: SAT比較経路の`cbef0c84f631add993b82c5e7bcdd2d5cedb5973`
- 関連: [事前基準](S15-formal-verification.md)、[方式と制限](../research/formal-verification.md#元のverilogによる反例の独立再実行)

## 目的と固定条件

Yosys SATの反例を同じソルバーで自己確認せず、元のVerilogと独立したIcarusのイベント駆動シミュレーションで確認します。事前基準のN-1/N/N+1、clock/reset、原文propertyと具体的な初期値を保持します。正常な終了だけでは採用せず、全stepの出力一致、元のassertionの違反、VCD保存を要求します。壊したモデルとreset列は非成功が条件です。

この層ではfixtureと入力を固定し、YosysとIcarusをそれぞれnative/WASMで比較します。性能やブラウザー全体の資源上限の採否は測りません。診断試行は変更中のcheckoutで実行しており、pushしたcommitの検証には数えません。清浄なrevisionでの実行は別に記録します。

## 再実行コマンドと保存先

固定版のYosysとIcarusのnative/WASM、Icarusの両`build-info.json`をビルドしてから、次を実行します。CIでは既存の比較用artifactを使います。

```sh
node --test --test-concurrency=1 tests/synth/formal-replay.test.mjs
node --test tests/web/formal-replay.test.mjs
```

各実行は`build/S15/p1-replay-<一意名>/`を新規作成します。manifestに実行revision・未コミット差分の有無・Node・引数・実バイナリー8本のhash・Icarusの原版とbuild-info・実行したvvpの版を保存します。Icarusの版とcommitはpin checkerを正とし、metadataの各hashを実ファイルと照合します。Yosysの中間JSONのcreatorも固定版と照合します。

元のソース、Yosys scriptと全stdout/stderr、中間JSON・RTLIL、SAT witness、再実行bench、nativeの作業ファイル、WASMのVCD、判定と生CSVを保存します。CSVは38行で、SAT反例12本に対する独立再実行24行、壊した出力12行、誤reset2行です。深さN-1で反例がない結果は別のSATログと結果JSONで保持します。CSVの全列を監査してから結果を引用します。失敗時も同じディレクトリーを残し、CIは7日間artifactとして保存します。

## 診断試行と失敗の記録

初回は5シナリオのVCD比較で失敗しました。バイト内容ではなく、WASMの`Uint8Array`とnativeの`Buffer`の型差を検査器が拒否したためです。nativeも`Uint8Array`へそろえて全バイト比較を維持し、再実行しました。失敗ログは`build/S15/p1-replay-attempt1.log`に保全し、入力・出力の証拠も削除していません。

その後、reset列、VCD欠落・UTF-8不正、`FORMAL`定義、実バイナリーとmetadataの照合、生CSVを追加しました。診断の各試行は別の証拠ディレクトリーへ保存しています。作業中の変更を含む成功は、配布revisionの成功に読み替えません。

## 未確認の範囲

一般的な反例、未初期化状態、複数clock、VHDL・PSL、vacuity、cover、SMT/SBY、workerと保存への接続、5回反復とA/Aは未完了です。負の対照の再実行は現段階ではWASM Icarusのみです。ブラウザー画面、実機Tang Nano、Cloudflare Pages公開は確認していません。
