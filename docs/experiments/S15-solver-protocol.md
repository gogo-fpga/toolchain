# S15 P2 実ソルバーの応答と終了の比較

- 状態: 予備検査。正式反復は未開始
- 関連: [実験索引](README.md)、[buildと輸送の記録](S15-solver-build-and-transport.md)、[ソルバー調査](../research/formal-solvers.md)

## 目的と仮説

固定sourceからbuildしたYices2とZ3のCLIを、native processと実WASI workerで実行します。JavaScriptへSMT-LIBの意味解析を移植せず、上流の応答を字句framerで区切り、同じsolverの両系で全byteを比較します。Nodeのisolation flagは検査用のfixtureであり、ブラウザーのCOOP/COEPや画面統合の確認ではありません。

## 正式反復前の基準

以下は予備調査を踏まえ、正式反復より前に固定します。正常・異常とも各条件5回以上、A/Aは2回とし、nativeとWASIの順は反復ごとに交互にします。重い実験はCIへ追加しません。

1. bit-vectorとarrayで、sat、値の取得、push後のunsat、pop後のsat、modelを同じprocessで確認する。
2. 32,768 bitの一意な値を取得する。7 byteの通常buffer、3 byteずつの入力に加え、長い値では257 byteのbufferと50 msのconsumer遅延でbackpressureを通す。
3. 通常条件のstdout、stderr、frame列、終了分類と終了コードを、native/WASIとA/Aで完全一致させる。改行や数値表記は正規化しない。
4. 構文エラーはerror応答として検査し、終了コード0でも論理判定の成功にしない。要求した応答がEOFまでに来なければ拒否する。
5. 実応答を受け取った後のtimeout、cancel、古いjob IDの通知、終了通知の欠落、出力上限を別々に検査する。破損WASM、hash不一致、worker起動時のcrashは、実solverの判定を実行したとは書かない。
6. Yices2のalarmの非対応要求は非ゼロ終了とstderrの明示診断を要求する。Z3のunknownはsat/unsatに置き換えない。hardware丸めの拒否はZ3の実build完了後に追加検証する。
7. stdout、stderr、frame、終了コード、終了分類を一つずつ壊した負の対照で、比較器が全て拒否することを確かめる。
8. 固定source、build script、patch、SDKとGMP archive、binary、stdout、stderr、frameのhashを保存する。nativeの最大RSSとWASMのlinear memoryは異なる指標として記録し、欠測を0で補わない。

失敗したprocessから得た途中のbyte数は、停止のタイミングで異なり得ます。正常応答の完全一致とは混同せず、失敗の分類と、成功を偽装しないことを検査します。時間とメモリーは絶対値と最小・中央値・最大を保存します。正しさの採否を所要時間で緩めません。

## 固定条件と実装

solverの固定版とprofileは[buildの記録](S15-solver-build-and-transport.md)を正とします。予備Yices2は、清浄な`537a140b4ba4e233af6606a78071e80e08ce858b`で作ったnativeとWASIを使います。nativeのSHA-256は`03ed31aadc9fcdb02864fa68785fddfbcfd28051cadd8c509128093403dfa3de`、WASIは`478fcb7fe5b3baa45420d2fb7087ae8508850cdb824a9968d871df13de66f7ad`です。Z3はbuildが続いており、成功扱いにしません。

比較器は`tests/synth/solver-protocol-helpers.mjs`と`solver-protocol-cases.mjs`、記録器は`scripts/measure-solver-protocol.mjs`です。metadataでsource pin、清浄なbuild、現行scriptとpatch、artifactのsizeとhashを照合します。通常CIには小さな比較器とmetadataの負の対照だけを追加し、実solverの反復には明示したmanifestを使います。正式記録器は未commitの変更や既存の出力先を拒否します。

## 予備結果と捨てた試行

| 試行 | 観測と修正 |
|---|---|
| incremental初回 | Yices2ではproduce-modelsをset-logicの後に設定できずerrorになった。上流の順に設定する |
| 条件比較の初回 | arrayの問い合わせ式をbinary表記と誤認し、長い値の改行も予想しなかった。元のstdoutはnative/WASIで一致していたが、検査器は失敗した |
| 構文エラーの初回 | 非ゼロ終了という誤った条件で失敗した。両系ともerror応答と終了0。上流sourceを確認し、errorの検出と終了コードを分離した |
| 構文検査の不備 | 検査器の編集で括弧が一つ余り、NodeのSyntaxErrorで実行前に停止。ソースと診断を保持して修正した |
| 修正後の予備3 | 5条件の両系比較10実行とworker異常系8実行が成功。正式5回反復ではない |
| alarm検査の初回 | SMT要求を送らずに待ったため、遅延初期化されるtimerへ到達せずhost timeout。check-satを送るよう修正した |
| 記録器の予備1 | alarmはstderrの63 byteと終了19を確認。arrayの正常終了では、分割したexitの最後の改行より先にCLIが終了しwriteが拒否された。正常終了はEOFで検査するよう修正した |
| 記録器の予備2 | EOFによる終了に分けた後、5条件の両系10実行、worker異常系8実行、alarm拒否の計19実行が成功した。正式反復ではない |

これらの試行は正式結果と混ぜません。初回のstdout、stderr、ソースのsnapshotを保全しています。[記録器の予備1の生CSV](S15-solver-protocol-preliminary-1.csv)と[予備2の生CSV](S15-solver-protocol-preliminary-2.csv)は、それぞれ19行31列です。binaryは清浄なbuildですが、比較器は未commitの予備版です。CSVのharness commitだけで比較器の版を示したとは扱わず、snapshotのhashも照合します。正式反復と全列監査の完了後に、正式CSV、ログのhash目録と集計をここへ追加します。

## 再実行の入口

buildの記録に従って同じ固定版とprofileを生成し、出力先の`metadata.json`があるdirectoryをmanifestへ指定します。相対パスは実行時の作業directoryを基準にします。次はYices2の予備比較の例です。Z3も同じ形式の`z3`項目で指定できますが、実buildの完了と結果の確認は残っています。

```json
{
  "yices2": {
    "native": "build/S15/yices2-native",
    "wasi": "build/S15/yices2-wasi"
  }
}
```

```sh
node scripts/measure-solver-protocol.mjs \
  --probes build/S15/probes.json --out build/S15/protocol-preliminary \
  --preliminary --repeats 1 --aa 0
```

正式反復は清浄なcommitで`--preliminary`を外し、`--repeats 5 --aa 2`で実行します。出力先の親directoryは先に用意し、既存の出力は上書きしません。記録器は各実行のstdout、stderr、frame列、結果JSON、native RSSと、生CSVを保存します。開始前と終了後のmetadata、実行時のソース、版の出力、負の対照の結果も同じdirectoryへ保存します。

## 未確認の点

Z3の実build・比較、正式5回反復、A/A、全列監査、上流yosys-smtbmc/SBYとの接続、配布と画面統合は未完了です。Tang Nanoの実機とブラウザー画面は、この記録では試していません。
