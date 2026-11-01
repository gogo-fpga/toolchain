# S15 P1: 元のVHDLによる反例の独立再実行

## 目的と採否の基準

基準は`2e5e9f28dd359130bc6696ab530bf0af15886273`です。GHDLが生成したVerilogだけでなく、元のVHDLを変更せずにnative GHDLで実行し、SAT反例の入出力とassertion違反を照合します。VHDLとPSLのparser、monitor、runtimeは上流GHDLを再利用します。この検査用nativeプラグインはWeb製品の構成要素ではありません。

上流の`--vpi-compile`と`--vpi-link`で検査用Cプラグインをビルドします。GHDLのVPIで入力とclockを駆動し、全ての非clockポートの幅・方向・値を調べます。runtimeの診断と`--psl-report`のJSONを元のproperty一覧へ結び付け、独立したVCDでも全入力・出力・clock遷移を照合します。ポート一覧の欠落や余剰、unknown、未初期化の状態、欠けたwitness、診断の不一致、前提違反、非正常終了は成功にしません。

正式反復の前に、通常assertion、clocked PSL、両clock極性、深さ境界と帰納法の反例を検査します。出力・入力・初期値・property・VPIプロトコルを壊した負の対照を全て拒否することを条件にします。通常assertionとPSLを一律の1ステップずれで補正せず、最後のPSL評価用edgeで生じた範囲外の通常assertion違反をwitnessの証拠に数えません。正式反復は清浄な同一commitで5回以上とA/Aを行い、CSVの全列と元のファイルを照合してから判定します。

## 評価タイミングと検査方法

最初の状態は0 nsで入力を与え、2 nsで観測します。2状態目からは10 ns間隔でclock edgeを与え、1 ns後に次の入力、2 ns後に入出力を観測します。PSLを有効にした場合だけ、最後にもう一つedgeを与えます。上流runtimeはclocked PSLをedge直前の状態で評価し、通常の並行assertionは状態変更に伴って評価するため、この区別を記録します。

全てのdrive・edge・観測・flush・終了markerを順に照合し、診断の時刻も前後のmarkerの間にあることを確かめます。入力切り替え前の隙間で通常assertionが失敗し、その入力が前後で変わる場合は曖昧として拒否します。これは任意のdelta-cycle挙動の同値性を保証するものではありません。

VCDはscope、変数、幅、時刻、値の変更、終了時刻を読みます。検査時刻ごとに全ポートの期待値を照合し、clockの全遷移も比較します。ファイルの存在や終了markerの検索だけでは合格にしません。

PSLのレポートはGHDLの`grt-psl.adb`が出力したものを読み、ラベル、元ファイルと行、directive、started/finished count、status、summaryを調べます。assert/assumeの違反回数は診断数とも一致する必要があります。明示したassumeとcoverが欠けたレポートを拒否します。合成時にassertionから作られるactivation coverは元の明示的coverと区別します。

## 予備検査と失敗の記録

未コミットの実装で、統合・全列監査15件と検査器単体40件、計55件が成功しました。GHDL native/WASMとYosys native/WASIの4通りから得た28反例を元のVHDLで再実行し、実runtimeを使った12件の負の対照も拒否しました。これは予備結果であり、提出commitの検証と正式反復はまだ完了していません。

最初の予備入力では、通常assertionは30 ns、同じ式のclocked PSLは40 nsで違反しました。VPI callbackへ渡す時刻構造体をローカル変数に置くのは安全でないため、継続して使える静的領域に変えています。

最初の統合比較は通常assertionが成功し、PSLが失敗しました。検査器がcoverのfinished countと標準出力の診断数を一致させようとしていたためです。GHDLは既定ではcover到達を標準出力へ出さず、JSONレポートへ記録します。出力を捏造せず、coverは上流レポートの件数と状態で検査し、assert/assumeの違反数との照合は維持しました。その修正後の14件は全て成功しました。

ポート一覧検査の追加後は、top moduleを`vpi_handle_by_name`で取得しようとしたため、14件中7件が停止しました。GHDLの上流実装を確認し、`vpi_iterate(vpiModule, NULL)`と`vpi_scan`でrootを取得する方式へ変えました。各ポートの方向、重複、scope、実ポート数を確認する条件は緩めていません。修正後の焦点を絞った検査と、負の対照を含む50件が成功しています。

## 証拠と再実行

`tests/synth/formal-vhdl.test.mjs`が一意な`build/S15/p1-vhdl-<一意名>/`を作り、元VHDL、合成出力、中間JSON、SAT反例、VPI入力、nativeのstdout/stderr、終了状態・所要時間、PSLレポート、VCDと判定を保存します。`native-replay.csv`は40行19列です。`manifest.json`と`native-replay-manifest.json`にはrevision、未コミット差分、GHDLのnative/WASMとCコンパイラーの実表示、VPIヘッダー・共有ライブラリー・プラグイン・検査コードのhash、上流が返すcompile/link flagsを残します。

```sh
GHDL_WASM_BUILD_ROOT=build/S15/vhdl-formal-build4 node --test tests/synth/formal-vhdl.test.mjs tests/synth/ghdl-replay.test.mjs
node --test tests/web/formal-replay.test.mjs
```

前層と同じGHDL build4を使い、runtimeのABIを満たす隔離環境で実行します。ホストでそのABIを満たす場合は隔離を要しません。上記のコマンドはCIの既定出力先なら`GHDL_WASM_BUILD_ROOT=build`で実行します。VPIのヘッダーと共有ライブラリー、GCCが必要で、欠落時にskipしません。

## 未完了の範囲

`scripts/audit-ghdl-replay.mjs`はCSVの全19列を元ファイル、再計算した判定、実行command・flags・終了状態、SATのproperty一覧と反例へ結び付けます。全40行の組合せ、ソースとbinaryのhash、ポート入力、stdout/stderr、VCD、PSLレポートと所要時間を調べます。CSVの各列の改変、行の欠落・重複、不完全なCSVを拒否する負の対照も統合検査に含めます。元の測定ファイルは変更せず、別ディレクトリーの入力で検査器を試します。`--preliminary`を指定した監査は清浄なcommitの正式結果と区別します。

```sh
node scripts/audit-ghdl-replay.mjs --sample build/S15/p1-vhdl-<一意名> --out build/S15/native-replay-audit
```

正式5回反復とA/A、全列のファイル単位の監査、提出commitでの再検証、下位化後のVerilog/Icarusとの照合、reset・X・memory・loop・階層・複数property・名前付きlibrary・vacuityの追加fixtureは残っています。ブラウザーの形式検証結果を独立再実行済みへ変更していません。SMT、SBY、形式検証の画面統合とT6全体も未完了です。

[実験一覧](README.md)と[形式検証の調査](../research/formal-verification.md)へ戻れます。
