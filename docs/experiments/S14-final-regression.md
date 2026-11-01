# S14 カタログ昇格後の全候補回帰と配布ソースの照合

[実験の索引](README.md) / [HDLの正式反復](S14-production-hdl.md) / [CPUの正式反復と初回の失敗](S14-production-cpu.md)

## 目的と固定条件

CPUのカタログ昇格後、通常の選択制限を緩めずに全60組を再検査しました。実行したcommitは `9e098b99fa18667a62d5b11b3f29ce74e33fd4ea` です。途中でcheckout、入力、実行スクリプトを変更していません。正式な配置配線5回反復とは別の、ZIP読み戻しから合成・配置配線・packまでを含む最終回帰です。

Node.js v24.21.0、Yosys 0.70（28ba3cb92）、nextpnr 0.11.1、Pyodide 314.0.7、Python 3.14.2、zstd 1.5.7を使用しました。製品用のnative / WASIバイナリーと検証済み資材を再利用しています。新たなコンパイラーのビルド時間を測った試行ではありません。GHDL native参照版は、ホストのglibc不足を避けるため、同じcheckoutをbind mountした固定版の隔離環境で実行しました。

判定はS14の事前基準と `tests/synth/gowin-pack.test.mjs` に従います。成功は生の配置配線JSON、資源、pack後のbitstreamの一致を要求します。容量超過とfrontend非対応を成功したbitstreamに数えません。容量超過には数値で示す資源不足とnative / WASIの実診断、frontend非対応にはnative / WASMの同一解析エラーを要求します。

## 全60組の結果と全列監査

| 対象 | 組数 | 成功 | 容量超過 | frontend非対応 | CSVの行×列 | 空欄を含む全値 | 実測の末端値 |
|---|---:|---:|---:|---:|---:|---:|---:|
| HDL8部品×4ボード | 32 | 32 | 0 | 0 | 32×119 | 3,808 | 3,064 |
| CPU7候補×4ボード | 28 | 18 | 6 | 4 | 28×139 | 3,892 | 2,530 |

Node testの結果はHDLが33件成功、CPUが29件成功です。親のテストを含むため、組数とは1件ずつ異なります。全体の所要時間はHDLが2,030,910 ms、CPUが2,676,309 msでした。両者の並行負荷があり、独立した性能比較ではありません。

生の値は [HDLの全列CSV](S14-final-regression-hdl.csv) と [CPUの全列CSV](S14-final-regression-cpu.csv) に保持します。CSVはCRLFを含む元のbyte列を保持し、Gitで改行を変換しません。元の全measurementを読み、CSVの全フィールドを別のPython読取りでも照合しました。status、通常選択の拒否、catalogのboard state、CPUのlowered netlistでの正常実行とLED固定の負の対照、CPU回路・RAMの保持、資源、終了値、時間・メモリー、ZIP・合成・配置配線・bitstreamのhashを確認しました。存在する全成果物もサイズとSHA-256を採取しています。

通常APIはconfirmedの候補だけを通します。容量超過とfrontend非対応の10組は通常APIの拒否を再確認した後、検査専用の `requireConfirmed: false` 経路だけで測定しました。HDL / CPUとも既存の出力先を指定する負の対照はEEXIST・終了値1となり、sentinelと既存ファイルが変わらないことを確認しました。最終回帰は別の新規出力先で完走しています。

監査を再実行する手順です。生成元のcheckoutと資材、出力一式を保持し、出力先は存在しないファイル名を指定します。監査器はGitの作業状態と入力の差分も検査し、記録したrevisionから検査対象のコードやpinが変わっていれば停止します。

```sh
# 同じ製品用バイナリーを検証してから、未使用の出力先で実行する
PATH="$PWD/vendor/zstd/programs:$PATH" HDL_MATRIX_EVIDENCE=build/t5-final-hdl node --test --test-name-pattern='pinned HDL' tests/synth/gowin-pack.test.mjs
PATH="$PWD/vendor/zstd/programs:$PATH" CPU_MATRIX_EVIDENCE=build/t5-final-cpu node --test --test-name-pattern='pinned CPU' tests/synth/gowin-pack.test.mjs
node scripts/audit-library-matrix.mjs hdl build/t5-final-hdl build/t5-final-hdl-audit.json 9e098b99fa18667a62d5b11b3f29ce74e33fd4ea
node scripts/audit-library-matrix.mjs cpu build/t5-final-cpu build/t5-final-cpu-audit.json 9e098b99fa18667a62d5b11b3f29ce74e33fd4ea
```

GHDLのnative参照版がホスト上で実行できない環境では、`GHDL_NATIVE_BIN` に同じ固定版を起動する隔離環境のwrapperを指定します。新しいcommitでmatrixを実行した場合は、そのcommitと新規出力先を記録し、上のrevisionの検証と混同しません。

## 診断の監査

全候補の標準出力・標準エラーを読み、成功と期待した失敗を分けました。HDLの警告は重複を除いて253行で、`translate_off` コメントの扱い1種とメモリーのレジスター化252種でした。後者は展開後の関数名が異なる行を含みます。CPUの警告とERROR行は重複を除いて51行で、次のように根拠を確認しました。

| 診断 | 根拠と扱い |
|---|---|
| SERVの `i_raddr` 範囲外 | `third_party/serv/rtl/serv_rf_ram.v` の未適用の既定parameterに対する解析時の警告です。固定fixtureはRF_WIDTH=2です。4ボードとも実際のlowered netlistのアドレスは9bit、regzeroのreduce入力は有効な `[8:4]` だけで、未定義bitを含まないことを照合しました |
| SERV/4KのBRAM幅 | `vendor/yosys/techlibs/gowin/brams_map.v` の汎用幅変換macroが2bitポートの未使用上位bitを参照する警告です。nativeとWASIで同じ12種を出力します。配置配線の一致をBRAMの全設定に対する機能証明とは扱いません |
| VexRiscvの未駆動3信号 | 生成済み `VexRiscv_Min.v` のmtvec mode 2bitとisRvcです。4ボードともlowering後・mapping後のnetnamesに元の信号と伝搬先の別名が残らないことを確認しました。生成元のRTLを編集したり、警告を抑止したりしていません |
| NEORV32のFPU component未結合 | 固定fixtureはRV32Eで、`RISCV_ISA_Zfinx` の既定値はfalseです。未使用のFPUに属するcomponentの警告です。FPUを有効にした構成の確認とは扱いません |
| メモリーのレジスター化、translate_off | 合成による展開として保持し、回路・RAM保持の検査とプログラム実行の結果を別に確認しました |
| 1Kの配置ERROR | CPU6候補の数値上の容量不足に対応する期待した失敗です。終了値、資源不足、出力が未生成であることを照合しました |
| FemtoRVの解析失敗 | native / WASMで同じ実際のIcarus解析失敗です。配置配線やbitstreamの成功として数えません |

この監査は合成後の全セルを含む形式的な等価証明、配置配線後のタイミングシミュレーション、Tang Nano実機の動作確認ではありません。元の警告・失敗ログは保持し、原文を検査に合わせて書き換えていません。

## 同一commitの機能回帰と配布

| 検査 | 結果 |
|---|---|
| Web単体・Icarus | 178件成功 |
| CPU実行・GHDL native / WASM | CPU9件とGHDL19件がそれぞれ成功 |
| Web組立 | zstd 1.5.7とbuild-infoを照合して成功 |
| package-release | ソースtar.gz・Web ZIPとSHA256SUMSの2件を照合して成功 |
| Git情報なしのソース | 22候補の資材を再生成し、Webを組み立て、catalogと全107 source/license assetが元の配布物と全バイト一致 |
| ソースとWeb ZIP | ソース45,220ファイル、Web695ファイルを監査。22gitlinkとgitcommit、README、LICENSE、NOTICE、THIRD_PARTY_NOTICES、rootとSurferのlicense原文、synth・pack・Icarus・Surferの配布byteを照合 |
| 静的配信の制限 | Web ZIPの全ファイルが25 MiB未満、安全なarchive path、重複名なし、ソースにGit管理情報なし |

Git情報なしの再生成では検証済みWASMとnpm依存を再利用しました。配布ソースだけから全コンパイラーを新たにビルドした検証ではありません。初回にホストのglibc不足で停止したCPUテストと、旧zstd設定で停止したWeb組立のログも、隔離環境・固定版設定による成功ログと区別して保持します。

## ハッシュと未確認範囲

| 証拠 | SHA-256 |
|---|---|
| HDL全列CSV | `d8862aefa02c32e765c8467807df9fe8e41ae2026919d0448eefd067a26cea1f` |
| CPU全列CSV | `8a28eba939388a97013b3cb68b22bf3a15664192535b766c88850d2fcd319195` |
| catalog | `2df56365ba336356587bd0e611dab5894bca6dd10fb5bf8861f9efbaa6e2d91c` |
| HDL完走ログ | `bc71801f83542c58447f8e0e0966a7c69f8bd3dba18982a3770497bad871b6f3` |
| CPU完走ログ | `42b817f9a013fbc618cb1dafb66a53657444892bafbff593b31967b92c52d74c` |
| Git情報なしのsource closure監査 | `0670f861e31f3bba766827374bac4abc4f2a5057c7548bdbdc4c73bf87b360da` |
| no-overwrite監査 | `cf61bf3631378ae3f0d5fb4dbb41e5a93165a162ff4b8369a7e797bd34326d0e` |
| ソースtar.gz | `c46a9c88f8146dd25be3825ba930def2841182c4cb1a887a2ebc3e9c089a75bd` |
| Web ZIP | `6e3bafcaaf5a204ec390d091c4522ff0b4e8011d19e3b86de2d2dbeda67fb4cd` |

ここに記録した結果は9e098b9の確認です。Native Stack整列後のrevisionとCIは、その後の回帰結果を読むまで確認済みと扱いません。T6、S5の比較専用4件、S8のcache/RSSなどの残件は別です。手動の画面操作録画とTang Nano実機は本リポジトリでは試していません。Cloudflare Pagesへの公開と設定変更も行っていません。
