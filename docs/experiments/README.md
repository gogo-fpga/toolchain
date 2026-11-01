# 実験の記録

実験・測定・比較を再現できる形で記録します。計画、実行、記録の手順は「experiment-record」スキル（`.agents/skills/experiment-record/SKILL.md`）に従います。

実験を始める前に、仮説、変える条件、採否の基準を決めます。基準の commit、ツールのバージョン、実行コマンド、環境変数、成果物のハッシュも記録します。生データは同じ名前の `.csv` に保存し、結果は RESEARCH.md に記録してください。

| 記録 | 内容 | 状態 |
|---|---|---|
| [S3A Pyodide gowin_pack のビットストリーム比較](S3A-pyodide-gowin-pack.md) | native と Pyodide の `.fs` 出力、実行時間、配布 asset の比較 | 完了 |
| [S4A ブラウザー内ビルドの測定](S4A-browser-build.md) | Chromium 内の4ボード build、時間、memoryBytes の比較 | 完了 |
| [S4B 大きい資材の圧縮形式と展開時間の比較](S4B-compressed-assets.md) | gzip、zstd、xz の大きさと Chromium での展開時間 | 完了 |
| [S4C ブラウザーの初回配信量](S4C-cold-load-bytes.md) | 4 ボードの冷たい初回ビルド・書き込み時に取得する応答本文量 | 完了 |
| [S5 WASI SDK のビルドオプション比較](S5-wasi-build-options.md) | Yosys と nextpnr のビルドサイズ、資源、Node・Chromium の実行時間と出力同一性 | 完了 |
| [S5B Yosys・nextpnr の Os／LTO／Os+LTO 比較](S5B-os-lto-chromium.md) | Chromium の性能、WASM サイズ、ビルド安定性と出力同一性の追加比較 | 完了 |
| [S6 zstd・xz 展開器のビルドオプション比較](S6-decoder-build-options.md) | Chromium での展開時間、WASM サイズ、A/A と Node テストによる安定性を比較。凍結基準を満たす候補がなく B を維持 | 完了 |
| [S7 openFPGALoader の Chromium ビルドオプション比較](S7-openfpgaloader-chromium.md) | fake USB の実内容検証付きで5変種を比較し、凍結規則により B+LTOA を既定に採用。以前の既定は `scripts/build-wasm.sh --variant=B` で再現 | 完了 |
| [S8 CI ビルド時間の短縮](S8-ci-speed.md) | CI cache と並列 job の安定性・所要時間を測定 | 採用（2026-10-30、ユーザー判断「A」。凍結基準に未達項目あり） |
| [S9 GHDL WASM の Os + LTO 安定性確認](S9-ghdl-os-lto.md) | 凍結基準に基づき GHDL WASM の Os + LTO を評価 | 不合格（候補の LTO リンクに失敗。既定は変更せず） |
| [S9 GHDL WASM Os + LTO の凍結基準](S9-ghdl-os-lto-criteria.md) | Os + LTO 候補の安定性・採否条件 | 測定前に固定 |
| [S9B GHDL WASM 最適化マトリクス](S9B-ghdl-matrix.md) | GHDL WASM の最適化設定の安定性、size、Node 時間を比較 | 採用：Os（ユーザーの判断、基準からの逸脱） |
| [S9B GHDL WASM 最適化マトリクスの凍結基準](S9B-ghdl-matrix-criteria.md) | 最適化候補の安定性・比較・採否条件 | 測定前に固定 |
| [S0 GHDL WASM 合成のビルドと smoke](S0-ghdl-wasm.md) | GHDL 6.0.0 の WASM 合成、VHDL fixture、Tang Nano bitstream、T3-2 のブラウザー統合 | 完了 |
| [S0B GHDL WASM の Chromium / Node 測定](S0B-ghdl-chromium.md) | 7 fixture と4ボードの VHDL template を Node / Chromium で測定。raw CSV は本文から参照 | 記録のみ（既定 Os を変更しない） |
| [S0B GHDL Chromium 測定の凍結基準](S0B-ghdl-chromium-criteria.md) | GHDL WASM の Node / Chromium 測定条件と正しさの確認 | 測定前に固定 |
| [S10 Icarus Verilog WASM 化](S10-iverilog-wasm.md) | Icarus v13_0 の WASI build、native parity、制限、artifact hash | 完了 |
| [S10 Icarus Verilog WASM 化の凍結基準](S10-iverilog-wasm-criteria.md) | 3つの WASM の再現性、native parity、negative control の条件 | 測定前に固定 |
| [S11 NVC r1.23.1 の WASM 化](S11-nvc-wasm.md) | Emscripten NVC の callback signature mismatch を特定。cast emulation 後も Node simulation が完走せず、5-file limit で停止 | 中止（5-file limit） |
| [S11 NVC WASM 化の凍結基準](S11-nvc-wasm-criteria.md) | NVC WASM の build、parity、negative control の基準と延長条件 | 測定前に固定 |
| [S12 Surfer WASM 化](S12-surfer-wasm.md) | Surfer v0.7.0 の WASM build、配布、browser test と再現性 | 同一 revision の local 2回と CI の全453ファイル一致 |
| [S12 Surfer WASM 化の凍結基準](S12-surfer-wasm-criteria.md) | Surfer の再現 build、browser load、negative control の条件 | 測定前に固定 |
| [S12B シミュレーション統合の回帰検証](S12B-simulation-integration.md) | timescale前後の4ボードbitstream比較、波形8画面、Icarus配布前検査と初回失敗の記録 | 全体E2E76件成功・比較測定4件skip、シミュレーション3回反復30件成功 |
| [S13 nextpnr の配置結果の再現性](S13-nextpnr-determinism.md) | 製品用の8代表回路×4ボードで native / WASI を各5回比較。A/A、負の対照、資源、CSV を記録 | 候補2を採用。通常320回と A/A 20回が一致し、負例10回を拒否 |
| [S14 CPU コアの実行と4ボード比較](S14-cpu-library-matrix.md) | ROM、RAM、GPIO と独立検査、負の対照、合成・配置配線・pack の採否基準 | 事前基準と初回失敗の保全記録 |
| [S14 製品用HDLの正式反復](S14-production-hdl.md) | 8部品と4ボード、A/A、負の対照、生CSVと全列監査 | 全32組で両系各5回一致。350行39列を監査 |
| [S14 製品用CPUの正式反復](S14-production-cpu.md) | 7候補と4ボード、3経路の対照、生CSVと全列監査 | 成功18・容量超過6・frontend非対応4。正常な18組は両系各5回一致。370行39列を監査 |
| [S14 昇格後の最終回帰と配布ソース](S14-final-regression.md) | 全60組の全列CSV・診断・選択制限とGit情報なしの再生成 | 整列後の07e2256でもHDL32組成功、CPU成功18・容量超過6・frontend非対応4。全7,700値、22候補107資材と全配布ファイルを照合 |
| [S14 整列後のE2Eと配布物再生成](S14-post-stack-e2e.md) | 保存API・配布前検査の修正、失敗試行、同一commitのWeb再生成 | 876c2a8で全体E2E76件成功・比較4件skip、22候補107資材とWeb全661ファイルが一致 |

仮想デバイスによる測定値は、実機の値として扱いません。

| 実験 | 目的 | 状態 |
|---|---|---|
| [S15 形式検証](S15-formal-verification.md) | 上流SBY・SMTBMCとソルバーの再利用、native/WASM、property・反例、輸送と非成功判定 | 事前基準を登録。形式検証のビルド・証明・5回反復は未実施 |
