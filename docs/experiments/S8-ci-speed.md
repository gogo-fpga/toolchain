# S8 CI ビルド時間の短縮

- 状態: 基準記録済み（計測待ち）
- 日付: 2026-10-30
- 担当: Devin
- 関連: [RESEARCH.md](../../RESEARCH.md)

## 目的と仮説

Yosys の WASI / native build を分離して並列化し、出力キャッシュを追加すると、安定性を保ちながら CI 全体の所要時間を短縮できると予測する。nextpnr の build も synth と並行して実行し、Yosys と nextpnr の build に CI runner の CPU 数を使う。採否は測定前に凍結した下記の基準で判断する。

## 凍結基準

以下の基準は測定前に固定し、結果を見て変更しない。

### 既存の基準

既に測定済みの main build workflow の run は次のとおり。

| run ID | commit | 所要時間 |
|---|---|---:|
| `40870780527` | `092a31b` | 74.2 分 |
| `40857507212` | `a757cd6` | 74.8 分 |
| `40849436664` | `346d5d5` | 62.1 分 |

### 変更する項目

- M1: Yosys WASI の `yosys.wasm`、`share`、`build-info.json` を出力キャッシュにする。キーには `vendor/yosys` の gitlink、WASI SDK pin の hash、`hashFiles(scripts/build-synth-wasm.sh, scripts/build-synth-info.py)`、実効 `WASI_*` flags を含める。
- M2: native Yosys も同じ方式の出力キャッシュにし、別の job で並行して build する。WASM / native の比較は両方の artifact を必要とする job で行う。
- M3: CI では Yosys、nextpnr、GHDL の `JOBS=$(nproc)` を使う。
- M4: nextpnr の build は synth の完了を待たない。Yosys artifact を使うのは WASI / native の P&R を比較する job のみとする。
- M5: nextpnr の cache が incremental object を復元するかを測定し、cache hit / miss ごとの build step 時間を記録する。復元しない場合は M1 と同じ出力キャッシュ方式に変更する。

### 変更しない項目

- `schedule`、`workflow_dispatch` の `cache=false`、および `release.yml` は cache を復元しない。
- build script の既定 `JOBS` はローカル利用向けに `2` のままとする。

### 安定性（すべて必須。満たさない測定は採用しない）

- S1: `yosys.wasm`、native Yosys の比較出力、nextpnr WASM と chipdb、`ghdl-synth.wasm`、decoder WASMs、openFPGALoader WASM / MJS の SHA-256 が、(a) cache hit、(b) cache miss、(c) `cache=false` の fresh build でそれぞれ一致すること。S1 の表を記録する。
- S2: 測定した各 run で既存 job がすべて成功すること（WASM / native 比較、sim shard、coverage、E2E）。
- S3: 次の負の対照を行い、両方の結果を記録する。
  1. dispatch 専用 branch で `scripts/build-synth-wasm.sh` の comment を 1 byte 変更する。Yosys cache key が変わり、build が実行されること。
  2. scratch key prefix で cache key を同じにしたまま、cached `yosys.wasm` の 1 byte を反転して再保存する。復元したファイルと cached `build-info.json` の SHA-256 を検査し、破損を検出して fail closed で再 build すること。
- S4: `JOBS=$(nproc)` で動かす各 build step の `/usr/bin/time -v` による最大 RSS が runner 上で 12 GiB 以下であること。各 job の `nproc` と `free -g` を記録する。
- S5: 測定後の cache 合計が 8 GiB 以下であること（repository limit は 10 GB）。Actions UI または API の cache list を使い、利用できない場合は save step log の cache size を合計する。

### 速度（記録のみ。採否規則）

W（warm: Yosys に変更がなく cache がある）と C（cold: `cache=false`）をそれぞれ 3 回以上、dispatch 専用 branch `devin/<ts>-ci-speed-bench` で実行する。PR head では実行しない。jobs API から job ごと、step ごとの所要時間を CSV に記録する。S1-S5 を満たし、W と C のどちらの全体中央値も基準の中央値 74.2 分より遅くならない変更を採用する。

## 条件

| 項目 | 値 |
|---|---|
| 基準 commit | `9bec84aa3cf1585587bc94bceb4c27207f26047f`（S8 branch の stack bottom） |
| CI runner | `ubuntu-26.04`。CPU 数と memory は後続測定時に `nproc` と `free -g` で記録する。 |
| 変更する条件 | M1-M4 の workflow 変更。M5 は cache hit / miss の観測のみ。 |
| 変えない条件 | build script の既定 `JOBS=2`、`schedule` / `cache=false` / release workflow の cache 非使用。 |
| 出力 | Actions cache、job / step の所要時間 CSV、および S1-S5 の確認記録。 |
| 繰り返しと集計 | W、C をそれぞれ 3 回以上実行し、全体所要時間の中央値を基準と比較する。 |

## 手順

1. M1-M4 の workflow 変更を実装し、M5 の観測に必要な build-step 時間を記録する。
2. dispatch 専用 branch で W と C をそれぞれ 3 回以上実行する。PR head から dispatch しない。
3. jobs API の job / step 時間を CSV に記録し、S1-S5 の安定性、resource、cache size の結果をあわせて記録する。
4. 凍結した速度の採否規則を適用し、測定した各変更を採用するか判断する。

## 計測器の検証

後続測定で S1 の成果物 hash を比較し、S3 の comment 変更と破損 cache の負の対照を行う。これらの検証はまだ実施していない。

## 結果

基準のみを記録した。W / C の計測値は未収集である。

## 捨てた試行と経緯

計測はまだ開始していないため、捨てた試行はない。

## 結論

採否基準を凍結した。変更の採否は、後続測定で S1-S5 と速度規則を適用してから決める。

## 未確認の点

cache hit / miss 時の所要時間、成果物の同一性、各 build step の最大 RSS、cache 合計容量は未確認である。

## ログ

後続測定の run ID、job / step ごとの所要時間、SHA-256、resource usage、cache size を CSV と記録に追加する。現時点で計測ログはない。
