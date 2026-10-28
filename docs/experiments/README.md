# 実験の記録

実験・測定・比較を再現できる形で記録します。計画、実行、記録の手順は「experiment-record」スキル（`.agents/skills/experiment-record/SKILL.md`）に従います。

実験を始める前に、仮説、変える条件、採否の基準を決めます。基準の commit、ツールのバージョン、実行コマンド、環境変数、成果物のハッシュも記録します。生データは同じ名前の `.csv` に保存し、結果は RESEARCH.md に記録してください。

| 記録 | 内容 | 状態 |
|---|---|---|
| [S3A Pyodide gowin_pack のビットストリーム比較](S3A-pyodide-gowin-pack.md) | native と Pyodide の `.fs` 出力、実行時間、配布 asset の比較 | 完了 |
| [S4A ブラウザー内ビルドの測定](S4A-browser-build.md) | Chromium 内の4ボード build、時間、memoryBytes の比較 | 完了 |
| [S4B 大きい資材の圧縮形式と展開時間の比較](S4B-compressed-assets.md) | gzip、zstd、xz の大きさと Chromium での展開時間 | 完了 |

仮想デバイスによる測定値は、実機の値として扱いません。
