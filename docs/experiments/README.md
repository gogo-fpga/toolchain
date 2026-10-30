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
| [S0 GHDL WASM 合成のビルドと smoke](S0-ghdl-wasm.md) | GHDL 6.0.0 の WASM 合成、VHDL fixture、Tang Nano 20K bitstream の比較 | Phase 1 完了 |

仮想デバイスによる測定値は、実機の値として扱いません。
