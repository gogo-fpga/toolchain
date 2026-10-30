# S8 CI ビルド時間の短縮

- 状態: 結果記録済み（S1不合格、S4・S5未確認）
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

## 計画からの逸脱

GitHub API の dispatch、artifact download、cache list を使う token の提供をユーザーが見送ったため、v1 の手順は実行せず、承認済みの v2 手順に切り替えた。PR #28 の push-triggered `pull_request` run と公開 REST API、job log のみを使い、workflow dispatch、artifact download、cache list の照会は行っていない。

v2 のシナリオは次のとおり。W1 は既存 head `c781097`、W2 と W3 は空 commit、NC1/M2 と M3 は `scripts/build-synth-wasm.sh` の comment-only 変更、W4 は comment を元に戻した run である。M1 は既存の `920d99e` run とした。各 run の間に完了を待ち、R1-R6 の順で実施した。

| scenario | commit | run ID | 内容 |
|---|---|---:|---|
| W1 | `c781097` | `41003258404` | 既存 head |
| W2 | `11f421d` | `41004784275` | 空 commit |
| W3 | `fcde8ff` | `41005982616` | 空 commit |
| M2 / NC1 | `8d7932a` | `41007222906` | comment-only 変更 |
| M3 | `d7d725e` | `41009940210` | comment-only 変更 |
| W4 | `d274bdc` | `41012642448` | comment を元に戻す |
| M1 | `920d99e` | `41000038411` | 既存の成功 run |

元の build script には shebang 以外の comment がなかったため、NC1 は `# S8 R4` を追加し、M3 は `# S8 R5` に変更した。W4 でその行を削除し、script が `920d99e` と一致することを確認した。これは指定された comment-only 意図を保つための小さな実施上の差である。

cache=false dispatch run と cache 合計容量は測定できなかった。破損 cache の CI control も実施できず、既存のローカル負の対照（artifact の 1 byte を反転した copy を integrity check が拒否）を参照した。したがって W1-W4 と M1-M3 は速度規則にある dispatch branch の全条件を満たす試行ではない。

## 計測器の検証

R4 と R5 では Yosys WASI / native output cache がともに miss となり、W4 では元の key に戻って両 cache が hit した。既存のローカル破損 artifact control では、1 byte を反転した copy が integrity check に拒否された。scratch prefix を使う CI control は未実施である。

## 結果

run は `pull_request` event で実行し、R1-R6 と M1 の build workflow job はすべて成功した。R1-R6 は各 run で 14 job、PR checks は 22 passed / 0 failed / 0 pending / 0 skipped だった。合計時間は run の `created_at` から最後の job の `completed_at` まで、job と step の時間は jobs API の timestamp 差から分単位で算出した。

### run 時間

| 区分 | scenario | run ID | 合計時間（分） | run 結果 |
|---|---|---:|---:|---|
| warm | W1 | `41003258404` | 13.567 | success |
| warm | W2 | `41004784275` | 12.533 | success |
| warm | W3 | `41005982616` | 11.933 | success |
| warm | W4 | `41012642448` | 11.700 | success |
| miss | M1 | `41000038411` | 29.850 | success |
| miss | M2 / NC1 | `41007222906` | 28.183 | success |
| miss | M3 | `41009940210` | 27.917 | success |

W1-W4 の合計時間中央値は **12.233 分**、M1-M3 は **28.183 分**だった。凍結した baseline median は 74.2 分である。ただし M1-M3 は Yosys output cache miss の PR run で、cache=false の C ではない。v2 は dispatch branch で実行していないため、この比較は速度採否規則を満たす証拠ではない。

### job 時間の中央値

各欄は W1-W4 または M1-M3 の job 所要時間の中央値（分）。`runs.csv` には各 run の job と step の値を記録した。

| job | warm median | miss median |
|---|---:|---:|
| Build | 2.725 | 2.917 |
| Changes | 0.100 | 0.133 |
| GHDL WASM synthesis | 4.633 | 3.717 |
| Playwright E2E | 4.600 | 5.017 |
| Pyodide gowin_pack | 0.717 | 0.700 |
| Simulation shard 1 | 2.408 | 3.617 |
| Simulation shard 2 | 3.575 | 3.567 |
| Simulation shard 3 | 3.300 | 2.750 |
| Simulation shard coverage | 0.108 | 0.100 |
| Yosys WASI synthesis | 0.592 | 19.767 |
| Yosys WASM/native comparison | 0.192 | 0.233 |
| Yosys native synthesis | 0.425 | 20.033 |
| nextpnr WASI place and route | 4.742 | 3.150 |
| nextpnr WASI/native comparison | 0.358 | 0.450 |

### S1 の SHA-256

R1-R6 の SHA-256 log は計 4,560 行（各 run 760 path）。下表のすべての値は [artifact-sha256.csv](S8/artifact-sha256.csv) にある。

| 対象 | R1-R6 の結果 | 判定 |
|---|---|---|
| Yosys WASI output | `yosys.wasm` と share files は一致。318 path 中 build-info.json を除く 317 path が一致 | artifact は一致 |
| native Yosys output | 317 path 中 build-info.json を除く 316 path が一致。WASM/native compare は全 run 成功 | artifact は一致 |
| nextpnr WASM | 6 run で `d5412c969e27f8708a517fc9c6ddc9e7f731433d5d932528a9558996c482336c` | 一致 |
| nextpnr chipdb | 4 chipdb files はいずれも 6 run 間で不一致 | **不一致** |
| GHDL | `ghdl-synth.wasm` は `a0eff3c41ccf92b104143174ce6ed735118fb787b0c0200e7b416f4d7feaa273` | 一致 |
| decoder WASMs | 6 run で一致 | 一致 |
| openFPGALoader WASM / MJS | `61c4943252821a0d1405133c11690b7718fb5af28c86bf102e926ccba780a642` / `f66be852ed33c8245fe781d900a7124186a6d3cd611a81849e1019ae080d8d44` | 一致 |

例として `chipdb-GW1N-9C.bin` は W1 が `1826f98d2d4e6e3296267561a6b7e4e7ca617f419531cfd5aeebe7124c244132`、W4 が `051cb1fa996f99786e6df77f684fedb1e73265f059f0fc3bf640029ba6ed9cfa` であり、M2 と M3 を含む全 run で異なった。hash log では S1 対象外の GHDL native `.cf` files と `build.log` にも run 間差があった。

Yosys の build-info.json hash は R1-R3/W4 と R4/R5 で異なる。生成コード上、comment-only 変更が反映される metadata field は `build_script_sha256` であり、基準/R4/R5 の script hash はそれぞれ `eb932977382e880bc80fa005fc8fad955c909d845fd11a5102014ea6edb6c14a`、`a9b37d4b35f8ea44a94b27083eb092088525ec1ae9592b48aa5880e5d7c82791`、`98fa89127a95f15fe1e946376d75c894d50ac4d40a1ec56da109686efe24afc0` である。artifact download は行っていないため JSON field values 自体の読み戻し比較はしていない。

### M5: nextpnr build cache

M1 と R1-R6 の log では nextpnr build cache はすべて hit だった。WASI nextpnr/chipdb build step の時間は次のとおり。miss の観測値がなく、hit/miss の比較はできない。

| scenario | cache | build step（分） |
|---|---|---:|
| M1 | hit | 1.533 |
| W1 | hit | 2.600 |
| W2 | hit | 2.783 |
| W3 | hit | 1.867 |
| M2 / NC1 | hit | 1.600 |
| M3 | hit | 2.217 |
| W4 | hit | 2.683 |

R1-R6 の hit build-step median は 2.409 分。M2/M3 で miss したのは Yosys output caches であり、nextpnr cache は hit のままだった。

### S1-S5 の凍結基準と判定

> S1: `yosys.wasm`、native Yosys の比較出力、nextpnr WASM と chipdb、`ghdl-synth.wasm`、decoder WASMs、openFPGALoader WASM / MJS の SHA-256 が、(a) cache hit、(b) cache miss、(c) `cache=false` の fresh build でそれぞれ一致すること。S1 の表を記録する。
>
> S2: 測定した各 run で既存 job がすべて成功すること（WASM / native 比較、sim shard、coverage、E2E）。
>
> S3: 次の負の対照を行い、両方の結果を記録する。
> 1. dispatch 専用 branch で `scripts/build-synth-wasm.sh` の comment を 1 byte 変更する。Yosys cache key が変わり、build が実行されること。
> 2. scratch key prefix で cache key を同じにしたまま、cached `yosys.wasm` の 1 byte を反転して再保存する。復元したファイルと cached `build-info.json` の SHA-256 を検査し、破損を検出して fail closed で再 build すること。
>
> S4: `JOBS=$(nproc)` で動かす各 build step の `/usr/bin/time -v` による最大 RSS が runner 上で 12 GiB 以下であること。各 job の `nproc` と `free -g` を記録する。
>
> S5: 測定後の cache 合計が 8 GiB 以下であること（repository limit は 10 GB）。Actions UI または API の cache list を使い、利用できない場合は save step log の cache size を合計する。

| 基準 | M1: Yosys WASI cache | M2: native Yosys cache | M3: `JOBS=$(nproc)` | M4: nextpnr 並列化 |
|---|---|---|---|---|
| S1 | 部分合格。WASI artifact は一致。cache=false 条件は未測定 | 部分合格。native output は一致し compare 成功。cache=false 条件は未測定 | 不合格。共通 S1 の chipdb が run 間で不一致 | 不合格。4 chipdb files の SHA が不一致 |
| S2 | 合格。W1-W4 と M1-M3 の jobs が成功 | 合格。WASM/native compare を含め成功 | 合格。全測定 run の既存 jobs が成功 | 合格。nextpnr build/compare と後続 jobs が成功 |
| S3 | 部分合格。R4/R5 は miss、R6 は hit。破損 control はローカルのみ | 部分合格。R4/R5 は miss、R6 は hit。破損 control はローカルのみ | 対象外。S3 は Yosys output cache の control | 対象外。S3 は Yosys output cache の control |
| S4 | 未確認。RSS summary の値を取得できない | 未確認。RSS summary の値を取得できない | 未確認。`nproc=4` と `free -g` は記録したが max RSS がない | 未確認。nextpnr の max RSS がない |
| S5 | 未確認。cache list / size を取得していない | 未確認。cache list / size を取得していない | 未確認。cache list / size を取得していない | 未確認。cache list / size を取得していない |

S1 は nextpnr chipdb の不一致により満たさない。公開 job logs から `nproc=4` と `free -g` の出力は取得できたが、max RSS は `$GITHUB_STEP_SUMMARY` にのみ記録され、公開 REST/log response には含まれなかった。cache list は v2 手順の対象外で、save logs にも合計サイズはなかった。

### 速度規則

> W（warm: Yosys に変更がなく cache がある）と C（cold: cache=false）をそれぞれ 3 回以上、dispatch 専用 branch `devin/<ts>-ci-speed-bench` で実行する。PR head から dispatch しない。jobs API から job ごと、step ごとの所要時間を CSV に記録する。S1-S5 を満たし、W と C のどちらの全体中央値も基準の中央値 74.2 分より遅くならない変更を採用する。

観測した warm median は 12.233 分、Yosys cache-miss median は 28.183 分で、いずれも baseline 74.2 分を下回る。ただし v2 の PR runs は dispatch 専用 branch の W/C ではなく、C の cache=false 条件でもない。また S1 は不合格、S4/S5 は未確認であるため、凍結した採否規則に基づく採用判定には使えない。

## 失敗した試行と修正経緯

測定対象の R1-R6 と M1 に失敗 run はなかった。修正履歴として、`5d752ee` の run `40996149575` は nextpnr shim test が Yosys artifact を見つけられず失敗し、nextpnr と GHDL の resource summary も time log 不在で失敗した。その後 shim test を Yosys artifact download 後の compare job に移し、resource summary を修正した。`6a5e595` の run `40997016270` は native compare が `yosys-abc` 不在で4 board すべて失敗したため、`920d99e` で helper を artifact に含める修正を行った。ログ抜粋は [historical-log-extracts.txt](S8/raw/historical-log-extracts.txt)、全 job/step metadata は `runs.csv` と raw JSON にある。

## 結論

WASM/native compare を含む全測定 run は成功し、Yosys cache hit / miss behavior は期待どおりだった。一方、S1 は nextpnr chipdb の SHA-256 が run 間で異なるため不合格で、S4 と S5 は未確認、cache=false の cold run も未測定である。したがって凍結基準に基づく M1-M4 の採用判定は保留する。

## 未確認の点

nextpnr chipdb の SHA-256 が変化した原因、S4 の max RSS、S5 の cache 合計容量、cache=false fresh-build 時の SHA と速度は未確認である。

## ログ

[runs.csv](S8/runs.csv) に R1-R6、M1、および修正前の失敗 run の job / step 時間を記録した。[artifact-sha256.csv](S8/artifact-sha256.csv) は R1-R6 の SHA-256 log、[resources.csv](S8/resources.csv) は公開 log で得た runner の CPU / memory 表示、build-step 時間、および未取得の RSS を示す。raw directory には run / jobs JSON と抽出 log lines を保存した。
