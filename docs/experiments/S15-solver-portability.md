# S15 P4 追加ソルバーの型幅と未対応process境界

- 状態: 事前基準。診断patchと計測器を準備中
- 基準: [追加ソルバーの診断](S15-extra-solver-builds.md)、[S15の共通基準](S15-formal-verification.md)
- 戻り先: [実験索引](README.md)

## 目的と変える条件

前段で見つけたBTOR2のID切り詰めとBoolectorのgzip API traceの未初期化参照を、WASI向けの最小patchと実行で調べます。固定したsource・依存・compiler・最適化・memory上限は前段から変えず、能力一覧は無効のままです。上流への投稿は行いません。

WASIのlongは32 bitであり、int64_tを `labs(long)` へ渡すと幅を失います。`btor2tools-wasi-ids.patch` は4箇所を `llabs(long long)` へ置き換えます。nativeの64 bit longは変更せず、SMT処理や判定アルゴリズムを置換しません。API traceのpatchはWASIのgzip要求をstderrとabortで拒否し、外部processの成功を装いません。上流sourceを直接編集せず、隔離したbuild sourceだけに適用します。

## 結果を見る前の基準

1. 固定sourceへfuzzなしで適用でき、実際に使うpatchのsnapshotとhash、driverと全コマンド、ログ・終了状態・binary hashを保存すること。失敗した出力先は再利用しません。
2. 原本のBTOR2 parserへ小さな有効入力を与え、公開のID検索APIで32 bitを越える正負IDが既存行へ化けないことをnative/WASIで確認します。巨大なtableを作ってmemory不足を試す検査にはしません。原本WASIが誤って既存行を返す負の対照も確認します。
3. WASIのgzip API traceで診断が出て成功扱いにならないことを確認します。未初期化参照はコンパイラーと原文から確認した問題であり、原本で未定義動作が毎回同じ結果になるとは仮定しません。
4. patch後のビルドで上記の型幅・未初期化警告が消え、前段のCLI 5条件が維持されること。別の警告は捨てずに記録します。
5. 予備診断の後に清浄な同一commitへ固定し、A/A 2回と正式5回、全列の独立監査とhash・欠落の負の対照を行います。今回の境界検査をSMTBMC/SBYの正式認定や製品配布の確認とは扱いません。

実行中のスクリプトは変更しません。基準commitとworktree、実際のツール版、ホスト条件、入力・出力・測定資材のhash、生CSVを保存し、失敗試行も結果へ残します。

## 再実行の入口

```sh
python3 scripts/build-solver-probe.py --solver boolector --runtime native --jobs 2 --out build/S15/portability-native-01
python3 scripts/build-solver-probe.py --solver boolector --runtime wasi --jobs 2 --out build/S15/portability-wasi-01
python3 scripts/build-extra-solver-boundaries.py --probe-build build/S15/portability-native-01 --out build/S15/boundary-native-01
python3 scripts/build-extra-solver-boundaries.py --probe-build build/S15/portability-wasi-01 --out build/S15/boundary-wasi-01
```

補助probeはbuild metadataのcompilerと明示的なCFLAGS・link flagsを再利用し、実際の全コマンドを別に記録します。CMakeが追加する既定のflagまで同じものとは扱わず、補助probeの所要時間を製品solverの性能として比較しません。

IDの原本対照は最後の2コマンドに `--unpatched-ids` を加え、別の未使用出力先で生成します。原本で32 bitの最小値への縮小に伴う未定義動作を持ち込まないため、補助probeの `--alias-only` 指定で正負2,147,483,648の2件を除きます。大きなIDから行1へのaliasという決定的な誤りと、修正後の全14値の検索を分けて検査します。
