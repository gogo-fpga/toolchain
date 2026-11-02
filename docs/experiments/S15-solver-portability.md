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

## 予備診断（正式反復とは別）

最初の清浄な実装commit `be04b41b7211c444aee55f9af97db01764956691` でBoolector 3.2.4のnativeとWASIを再ビルドしました。nativeは2,861,824 byte（SHA-256 `19fbca1674a11dfa9caee74292203624de002fdcb43a31667ebb580129e27067`）、WASIは2,116,022 byte（SHA-256 `043b2d62ed145e59d5aa87ca0b22caa7fb69ec6bd829504b74453b0a1832dd24`）です。前段と出力ディレクトリーが異なり、バイナリーのbyte一致を前提にしません。`scripts/probe-extra-solver-cli.mjs` による版・ヘルプ・SMTの値とpush/pop・EOF・構文エラーの5条件はnative／WASIで一致しました（計10実行）。このCLI診断はSBYの認定ではありません。

原本のID検索では、nativeの大きなIDが未定義の行を返さなかったのに対し、WASIで正負の大きなIDが既存の行1に化けました。原本の負の対照はnativeが終了0、WASIが終了23で、いずれもsignalなしです。修正後の正負14値は両方とも終了0で全行一致しました。gzip API traceはnativeがgzipを出力し終了0、WASIがstderrに明示的な拒否理由を出し `runtime-error` で停止しました。通常のtraceは両方とも終了0です。WASI workerの入力は7 byte容量に3 byteごとに渡し、stdinのEOF、stdout／stderr、終了状態を別々に記録しています。生データは [修正後の6行21列](S15-solver-boundaries-preliminary.csv) と [原本の2行21列](S15-solver-boundaries-control-preliminary.csv) に保存しました。正式反復・配布条件・SMTBMCへの接続は未完了です。

ビルドログに残るCaDiCaLのGit識別子未検出、WASIの`getpid`エミュレーション警告、未使用変数・未使用関数などは削除していません。今回狙ったBTOR2Toolsの `labs(long)` とBoolector traceの未初期化参照という2種類の警告は、修正後のビルドログでは出ていません。CaDiCaLの `getpid` は乱数初期化にも関係するため、警告が残る限り製品認定の根拠とはしません。

## 再実行の入口

```sh
python3 scripts/build-solver-probe.py --solver boolector --runtime native --jobs 2 --out build/S15/portability-native-01
python3 scripts/build-solver-probe.py --solver boolector --runtime wasi --jobs 2 --out build/S15/portability-wasi-01
python3 scripts/build-extra-solver-boundaries.py --probe-build build/S15/portability-native-01 --out build/S15/boundary-native-01
python3 scripts/build-extra-solver-boundaries.py --probe-build build/S15/portability-wasi-01 --out build/S15/boundary-wasi-01
node scripts/probe-extra-solver-boundaries.mjs --native build/S15/boundary-native-01 --wasi build/S15/boundary-wasi-01 --out build/S15/boundary-results-01
python3 scripts/audit-extra-solver-boundaries.py --input build/S15/boundary-results-01
```

補助probeはbuild metadataのcompilerと明示的なCFLAGS・link flagsを再利用し、実際の全コマンドを別に記録します。CMakeが追加する既定のflagまで同じものとは扱わず、補助probeの所要時間を製品solverの性能として比較しません。

IDの原本対照は最後の2コマンドに `--unpatched-ids` を加え、別の未使用出力先で生成します。原本で32 bitの最小値への縮小に伴う未定義動作を持ち込まないため、補助probeの `--alias-only` 指定で正負2,147,483,648の2件を除きます。大きなIDから行1へのaliasという決定的な誤りと、修正後の全14値の検索を分けて検査します。
