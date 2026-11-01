# 形式検証の原本とブラウザーの制約

[調査の索引](../../RESEARCH.md#7-分割した調査) / [固定ソースと配布条件](formal-sources.md) / [S15の事前基準](../experiments/S15-formal-verification.md)

## 結論と確認範囲

T6では upstream の SBY と `yosys-smtbmc` を再利用します。SMT式の生成、BMC、帰納法、モデルとVCDの生成を独自に書き換えません。Yices2とZ3を優先して比較し、BitwuzlaとBoolectorも候補として残します。Yosys内蔵SATは比較経路であり、SMT対応の代わりにはしません。

この記録はソースの静的調査とP0の依存確認です。形式検証ソルバーのビルド、native / WASMの証明、ブラウザーの形式検証画面、5回反復は未実施です。固定ソースの登録だけで、ソルバーを利用可能にはしません。実行前にS15の基準をコミットして検査します。

## 上流の再利用と輸送層

| 原本 | 確認した処理 | ブラウザーで必要な対応 |
|---|---|---|
| [SBY core](https://github.com/YosysHQ/sby/blob/79fc9eddca5e33a28cc2f2cd19c9825efd9a7255/sbysrc/sby_core.py) | bash、`subprocess.Popen`、fcntl、非同期pipe、process group、signal | `SbyProc` の外部プロセスを仮想processへ接続する。任意のshellを実行しない |
| [Yosys SMT輸送](https://github.com/YosysHQ/yosys/blob/28ba3cb926fe376fa05ebfc1b921747d011d4557/backends/smt2/smtio.py) | ソルバーへのpipe、stdout readerのThreadとQueue、read/write/close | Pyodideでfork・pipe・Threadを使えると仮定せず、輸送だけをadapterへ接続する |
| [yosys-smtbmc](https://github.com/YosysHQ/yosys/blob/28ba3cb926fe376fa05ebfc1b921747d011d4557/backends/smt2/smtbmc.py) | BMC・帰納法・cover、モデルと反例出力 | アルゴリズムと意味を維持し、終了コード・status・witnessを照合する |

最初は1つのソルバーとtaskで縦に接続します。ソルバーのコマンド、作業ディレクトリー、ファイル名は静的な許可リストで制限します。設計、property、SMT入力、ログ、反例をサーバーへ送信しません。実行時のDevinへの依存も設けません。

輸送の比較には、長い入力、複数の `check-sat`、`push/pop`、`get-value`、stdout/stderrの分離、EOF、終了済みprocessへの書込み、timeout、cancel、停止後の遅れた応答を含めます。輸送が通ったことだけを証明器の正しさとは扱いません。

## Z3の公式WASM先例

調査時点の公式 `z3-solver` は5.3.3、Nodeの条件は16以上、npmの `gitHead` は `430d19e697e2ec9bad79ff210d41b4a7a5fcfa3e` です。展開サイズは39,457,489 bytes、25 filesでした。採用ソースのrelease commitと一致していますが、npmパッケージは製品依存には追加していません。

原典は同じcommitの [build-wasm.ts](https://github.com/Z3Prover/z3/blob/430d19e697e2ec9bad79ff210d41b4a7a5fcfa3e/src/api/js/scripts/build-wasm.ts)、[async-fns.ts](https://github.com/Z3Prover/z3/blob/430d19e697e2ec9bad79ff210d41b4a7a5fcfa3e/src/api/js/scripts/async-fns.ts)、[api_parsers.cpp](https://github.com/Z3Prover/z3/blob/430d19e697e2ec9bad79ff210d41b4a7a5fcfa3e/src/api/api_parsers.cpp)、[公開README](https://github.com/Z3Prover/z3/blob/430d19e697e2ec9bad79ff210d41b4a7a5fcfa3e/src/api/js/PUBLISHED_README.md)です。

- 公式buildはEmscriptenのpthreadを使用します。poolの大きさは0、strict設定は0、初期メモリーは2 GiB、stackは20 MiBです。小さいメモリーやWASIで動く証拠ではなく、この設定をそのまま採用しません。
- `Z3_eval_smtlib2_string` はC context内にコマンドcontextを保持します。宣言、push/popなどをZ3自身に解釈させる候補であり、JavaScriptで独自のSMT parserを書く必要を避けられる可能性があります。
- 公開READMEの非同期関数一覧だけでは判断できません。実際の `async-fns.ts` に `Z3_eval_smtlib2_string` が含まれます。npmのJavaScript APIを、Pyodideの同期Pythonからそのまま呼べるとは言えません。
- WASI CLIと双方向pipe、単一threadの同期C API、公式Emscripten経路を隔離して比較します。JSPI・pthreadは、必要性を実験で示した場合だけ候補にします。

上記は本リポジトリでは試していない実行方式です。ソース調査時に参照した別のmaster snapshotと、採用releaseは区別します。

## HDLのproperty保持

通常のSystemVerilog対応と、形式検証専用の限定的なVerilog構文を分けます。`assert`、`assume`、`cover` を解析できることと、意図したpropertyが合成後も残ることは別の検査です。

GHDLでは [synth-flags.ads](https://github.com/ghdl/ghdl/blob/e589c698c351369ac5bcfe7abe1f1152ac5d4727/src/synth/synth-flags.ads) の `Flag_Formal` の初期値がTrueです。[netlists-disp_verilog.adb](https://github.com/ghdl/ghdl/blob/e589c698c351369ac5bcfe7abe1f1152ac5d4727/src/synth/netlists-disp_verilog.adb) に `Id_Assert`、`Id_Assume`、`Id_Cover` の出力処理があります。plain VHDL assertionを残せる候補ですが、現在のWASMでの保持と、PSLの解析フラグ・対応範囲は未確認です。plain assertionとPSLをまとめて対応済みにはしません。

比較にはproperty数とID、0件、途中で消えたassertion、矛盾したassume、clock/reset、初期状態、X、ROM初期化、メモリー、組合せループ、ライブラリーのソース依存を含めます。最初に違反する深さがNの入力で、N-1・N・N+1の境界を調べます。反例は元の回路で独立に再実行し、VCDとpropertyを照合します。複数の正しいモデルがあり得るため、反例の全バイト一致だけを正しさの条件にはしません。

## 判定とブラウザー統合

| 結果 | 必ず区別する内容 |
|---|---|
| BMC | 指定深さまで反例なし。無制限の証明ではない |
| prove | 基底部と帰納部。片方だけの成功をprove成功にしない |
| cover | 到達、指定深さで未到達、到達不能の証明 |
| 非成功 | unknown、timeout、cancel、crash、error、unsupported、壊れたstatus、witness欠落、hash不一致 |

schema 4では形式検証設定、propertyファイルと順序、入力snapshotを保持し、schema 1から3の読込み、ZIP/OPFSの往復、旧アプリが新設定を黙って捨てないことを検査します。workerのcancel後は新しく作り直し、古いjobの応答を新しい結果として表示しません。反例は既存Surferの複数VCD選択へ接続する候補です。現時点では未実装です。

資源の提案値は同時job 1、既定30秒・設定上限300秒、solver linear memory 512 MiB、ログ8 MiB、trace64 MiBです。実測値ではありません。静的配信の1資材25 MiB未満、ZIPでのプロジェクト保存、Zstandardでの大きな配信資材、T4/T5回帰も確認対象です。全資材の事前保存によるoffline対応はT6後に扱います。

## 調査から実装への対応

| 段階 | 成果と確認 |
|---|---|
| P0 | 固定ソース・依存・NOTICE・配布ソース・S15の事前基準。この記録の範囲 |
| P1 | Yosys SAT、VHDL/Verilogのproperty保持、境界、負の対照、反例再実行 |
| P2 | Yices2/Z3、native / WASM、ABI・C API・pipe、終了とcancel |
| P3 | upstream SBY / SMTBMCをadapterで接続しBMC・prove・coverを分離 |
| P4 | Bitwuzla・Boolector、cvc4/cvc5、MathSAT、ABC、dummyを含む全選択肢と無効理由 |
| P5 | schema 4、保存、worker、結果画面、Surfer、許可リストと資源制限 |
| P6 | 固定commitとbinaryで各5回、A/A、負の対照、失敗試行、S15と配布・回帰 |

実機のTang Nano、Cloudflare Pages公開、独立した証明書の検査は、この調査で確認した事項には含めません。
