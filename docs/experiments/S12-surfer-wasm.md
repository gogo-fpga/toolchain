# S12 Surfer v0.7.0 の WASM 化

- 状態: ローカル検証完了。CI artifact hash の比較待ち
- 日付: 2026-10-31
- 関連: [凍結基準](S12-surfer-wasm-criteria.md)

## 目的

Surfer v0.7.0 を upstream source から `wasm32-unknown-unknown` 向けにビルドし、`dist/surfer/` と Release に含めます。ビルドの再現性、依存 crate のライセンス、同一 origin iframe での VCD 読み込みを検証します。Surfer をアプリの UI に統合する作業は T4 Stack step 2 で行うため、この記録には含めません。

## 固定条件

| 項目 | 値 |
|---|---|
| 凍結基準 | `3c7ed8a` の `docs/experiments/S12-surfer-wasm-criteria.md` |
| upstream | Surfer v0.7.0、peeled commit `bd749b1f786c1c62cd67893ca71346cbe6983915` |
| source URL | `https://gitlab.com/surfer-project/surfer.git` |
| nested submodules | f128 `e60de395f0d6454c1dc546b87f06a6358425b6b6`、instruction-decoder `02bdcbfd5663a72e4a0b1b9d54519412d417fab1` |
| license | EUPL-1.2 |
| Rust | 1.99.1、target `wasm32-unknown-unknown` |
| Trunk | 0.21.14、archive SHA-256 `f2b4680cd239693a646a2795e4633c625328d7b2a044fbe749fa3a2fe9e7036b` |
| wasm-bindgen-cli | 0.2.118、archive SHA-256 `00b519c9fc2d6e087265da1a00f29160bfcc6a823993482bc2e691910287427b` |
| Binaryen | version_123、archive SHA-256 `e959f2170af4c20c552e9de3a0253704d6a9d2766e8fdb88e4d6ac4bae9388fe` |
| Cargo | `--locked --release --features accesskit` |
| public URL | `./` |
| build output | `build/surfer/dist/` |

## build 環境と再現性

実行環境は Linux x86_64、kernel 7.0.0-42-generic、12 CPU threads、約 30 GiB memory です。Surfer submodule は v0.7.0 の peeled commit、nested submodules は f128 `e60de395f0d6454c1dc546b87f06a6358425b6b6` と instruction-decoder `02bdcbfd5663a72e4a0b1b9d54519412d417fab1` です。

clean build は `build/S12/clean-a` と `build/surfer` の別々の Cargo target directory で実行しました。両方とも source copy を作り直し、nested submodule を shallow fetch してから同じ patch を適用しました。Trunk の log は `offline=true` を示し、PATH 上の wasm-bindgen 0.2.118 と wasm-opt version_123 を選択したため、Trunk による tool download はありません。

| run | 開始時刻 UTC | 完了時刻 UTC | build script 所要時間 | Trunk 所要時間 |
|---|---|---|---:|---:|
| clean-a | 2026-10-31 02:47:49 | 2026-10-31 02:51:54 | 245 s | 240 s |
| clean-b | 2026-10-31 02:51:58 | 2026-10-31 02:56:01 | 243 s | 240 s |

両 build の manifest は 453 files で、relative path、size、SHA-256 が全件一致しました。WASM は 12,867,044 bytes、SHA-256 `3846ca2ab603a9bd544618740725f19228a1d56198fdf40cbe0c058e027c0ae4` です。全配布物は 15,383,177 raw bytes です。圧縮値は再現可能な tar stream に対し gzip `-n -9`、zstd `-19 -T1`、WASM 単体に同じ圧縮設定を使いました。

| data | raw bytes | gzip bytes | zstd bytes |
|---|---:|---:|---:|
| `surfer_bg.wasm` | 12,867,044 | 4,347,085 | 3,207,899 |
| distribution tar | 15,383,177 | 4,485,758 | 3,257,513 |

全成果物の path、size、SHA-256 は `build/S12/clean-a-retry.log` と `build/S12/clean-b.log` に記録しました。集計値は `build/S12/size-metrics.txt` にあります。

## 事前の browser probe

次の事実は事前 probe で得た値を採用し、この build では再測定しません。

- 同一 origin の iframe で Surfer を開き、親 frame から blob URL の VCD を送ると読み込みます。console に `LoadWaveformFileFromUrl` と `FileDownloaded` が出て、scope `logic` が現れました。
- 外部 origin への request はありませんでした。in-origin の favicon 404 は発生しました。
- text VCD は読み込みますが、binary FST は読み込みませんでした。
- WebGL が必要です。headless Chromium では `DISPLAY` を unset し、`--use-angle=swiftshader --enable-unsafe-swiftshader` を使うと描画できました。
- accesskit の build への影響と byte-identical build は事前 probe では未確認でした。

## 先行試行

事前の trial build は accesskit feature を有効にせず、4分15秒で 12,870,570 bytes の WASM を生成しました。gzip は 4,346,277 bytes でしたが、記録された hash に不一致があったため、この成果物は採用せず、今回の build artifact にも再利用しません。

今回の最初の clean build は patch file の hunk 行数が合わず、`patch` が `malformed patch at line 19` で停止しました。hunk を upstream の `surfer/index.html` に合わせ、Service Worker 登録部分だけを削除する patch に直して再試行しました。失敗 log は `build/S12/clean-a.log`、再試行 log は `build/S12/clean-a-retry.log` です。

## build と配布

`scripts/build-surfer.sh` は pinned tool archive を SHA-256 で検証し、vendor source と nested submodule を `build/surfer-src/` にコピーしてから Service Worker 登録だけを patch します。Trunk は offline mode で実行し、PATH 上の pinned wasm-bindgen と wasm-opt を使います。`build/surfer/dist/` の各ファイルについて relative path、size、SHA-256 を log に出します。

`scripts/collect-surfer-licenses.py` は Cargo metadata の `wasm32-unknown-unknown` graph から Surfer の normal runtime dependencies をたどり、crate 名、版、license expression、source とライセンスファイルを記録します。dev/build dependency は含めず、license expression と license file の両方がない crate があれば停止します。

`libsurfer/Cargo.toml` の `egui_skia_renderer` は `[dev-dependencies]` にあり、WASM runtime dependency graph の外です。依頼にあった dev dependency を除外する条件を優先し、配布 license table には含めていません。upstream の Git source と revision は Cargo.lock に固定されています。

local/CI hash 比較は push 後の CI handoff で行うため、この時点では未確認です。

## 結果

凍結基準の各項目は測定後に記録します。CI の結果はこの push の完了後には待たず、後続の CI handoff で確認します。
