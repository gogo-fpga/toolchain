# HDL ライブラリーと CPU コアの調査

調査日: 2026-11-01

T5 では22候補を登録します。現段階の HDL は VHDL と Verilog です。SystemVerilog、Scala の生成環境、VHDL のシミュレーターは持ち込みません。候補の登録と、部品が特定のボードで動くことの確認は別に扱います。

## 固定版と原典

- 取得元と監視する branch は [`.gitmodules`](../../.gitmodules) が正です。
- 固定する commit は `third_party/` の gitlink が正です。`git ls-tree -r HEAD -- third_party/` で確認できます。
- [部品カタログ](../../libraries/catalog.json)は表示名、言語、ライセンス文書、依存を含む部品の定義を持ちます。取得元と commit の固定値は重複して書きません。
- `scripts/build-library-assets.py` は gitlink と一致する checkout を要求し、固定した commit の blob から資材を作ります。作業ツリー上の変更を混入させず、上流のファイルとライセンス本文をそのまま配布します。
- 生成する `dist/libraries/catalog.json` は取得元、commit、各ファイルの元のパス、サイズ、SHA-256 を含みます。ビルドで生成する記録であり、手書きの pin ではありません。

取得は `git submodule update --init --depth 1 -- third_party/` を使います。上流の submodule は再帰的に取得しません。ソースは参照する部品ごとに選び、取得できていない依存を黙って省きません。

## 候補とライセンス

次のライセンスは、各固定版の本文を確認した分類です。部品ごとのソースヘッダーも残します。表の分類だけで、選択したすべてのファイルの条件を置き換えるものではありません。

| 候補 | 用途・言語 | ライセンス | 本文の upstream 内パス |
|---|---|---|---|
| Colibri | ライブラリー・VHDL | 主な RTL は CERN-OHL-W-2.0 | `LICENSES/CERN-OHL-W-2.0.txt`、`LICENSES/Apache-2.0.txt`、`LICENSES/CC-BY-SA-4.0.txt` |
| Open Logic | ライブラリー・VHDL | PSI HDL Library License 1.0 | `License.txt` |
| hdl-modules | ライブラリー・VHDL | BSD-3-Clause | `license.txt` |
| verilog-axis | ライブラリー・Verilog | MIT | `COPYING` |
| verilog-uart | ライブラリー・Verilog | MIT | `COPYING` |
| libfpga | ライブラリー・Verilog | MIT | `LICENSE` |
| verilog-axi | ライブラリー・Verilog | MIT | `COPYING` |
| verilog-ethernet | ライブラリー・Verilog | MIT | `COPYING` |
| SERV | CPU・Verilog | ISC | `LICENSE` |
| PicoRV32 | CPU・Verilog | ISC | `COPYING` |
| NEORV32 | CPU・VHDL | BSD-3-Clause | `LICENSE` |
| Hazard3 | CPU・Verilog | Apache-2.0 | `LICENSE` |
| VexRiscv の生成済みリポジトリー | CPU・Verilog | MIT | `LICENSE` |
| DarkRISCV | CPU・Verilog | BSD-3-Clause | `LICENSE` |
| learn-fpga の FemtoRV | CPU・Verilog | BSD-3-Clause | `LICENSE` |
| Ibex | CPU・SystemVerilog | Apache-2.0 | `LICENSE`、`NOTICE` |
| CV32E40P | CPU・SystemVerilog | SHL-0.51 または Apache-2.0 | `LICENSE` |
| VexiiRiscv | CPU・Scala | MIT | `LICENSE` |
| OSVVM | 検証用・VHDL | Apache-2.0 | `LICENSE.md` |
| UVVM | 検証用・VHDL | Apache-2.0 | `LICENSE` |
| VUnit | 検証用・VHDL | HDL と Python 等は MPL-2.0 | `LICENSE.rst` とソースヘッダー |
| Taxi | ライブラリー・SystemVerilog | CERN-OHL-S-2.0 | `LICENSE` |

Open Logic の本文は GNU Library GPL v2 以降を基にした PSI HDL Library License 1.0 です。FPGA 等の生成物への例外を含むため、単純な LGPL-2.1 の表示はしません。カタログでは `LicenseRef-PSI-HDL-1.0` として原文へ案内します。

Colibri は RTL、文書、メタデータで条件が異なります。上記3文書を保持し、選択するファイルの SPDX 表記も含めます。VUnit の図版に使うフォントは別の条件です。カタログへ登録しただけで、これらの図版やフォントを配布するわけではありません。

Taxi の有償ライセンスには別途契約が必要です。MIT の旧ライブラリーを Taxi へ置き換えたり、有償ライセンスを自動で適用したりしません。

## 対応範囲と保守状況

HDL ライブラリー8候補と CPU 7候補は、代表部品、依存の解析、合成、動作を検証する対象です。登録直後の状態は「未検証」です。ボードの容量超過、言語の非対応、未検証は区別します。CPU はプログラムの実行による出力を確認し、定数化された回路だけで合格としません。

Ibex、CV32E40P、Taxi は SystemVerilog、VexiiRiscv は Scala からの生成が必要なため、現段階では非対応です。OSVVM、UVVM、VUnit は VHDL の検証用で、現段階のシミュレーターでは実行できません。この7候補は理由付きで残し、選択できない状態で表示する対象です。

`verilog-axis`、`verilog-uart`、`verilog-axi`、`verilog-ethernet` は、固定版の README が deprecated と明記し、後継に Taxi を案内しています。保守終了の表示を残し、明示的な選択だけで使います。

VHDL の依存にはコンパイル順と library 名を保持します。ソースの文字列置換で名前付き library を `work` へ変更しません。Verilog の include、define、ROM 等のデータも部品の定義に含めます。FuseSoC、LiteX、SpinalHDL の生成環境や C/C++ のツールチェーンをブラウザーへ持ち込みません。

## 更新監視

`.github/scripts/check-pins.py consistency` は、全 `third_party/` とカタログの対応、gitlink、監視用 branch を検査します。取得元と固定版の重複した手書き定義は拒否します。

「固定版の更新確認」の週次実行は、GitHub と GitLab の双方を `.gitmodules` の URL から調べます。branch 先端との差を判定し、安定版のタグがあれば参考値も記録します。タグ付き依存をタグで比べる既存の処理とは分けています。取得できない場合は「最新」ではなく「要確認」にします。

結果は既存の追跡 Issue にまとめます。自動で版を採用せず、更新時に vendor-update の手順で変更履歴、破壊的変更、セキュリティ修正、新機能、ライセンス条件を確認します。

## 初期調査からの訂正

- `RESEARCH.md` 5章の初期転記表が示す Colibri の GitLab.com URL は採用しません。固定版の README と CERN GitLab の API を照合し、取得元を `https://gitlab.cern.ch/colibri/colibri.git` と確認しました。
- Open Logic の初期転記表にあった LGPL-2.1-or-later の分類は訂正します。固定版の `License.txt` は上記の PSI HDL Library License 1.0 です。
- CV32E40P と OSVVM は API のライセンス分類だけで判断せず、固定版の本文を読みました。CV32E40P の Solderpad 本文の版は 0.51 です。

## 配布と検証の境界

Web 配布物には静的カタログ、必要なライセンス本文、登録した部品のソースを含めます。Release のソースアーカイブには `third_party/` の固定版も含めます。実行時に GitHub や GitLab へ設計データを送信する構成ではありません。

ソースアーカイブには、生成した `libraries/source-manifest.json` と各依存の `.gitcommit` も含めます。Git の履歴がなくても、記録したハッシュと原文ファイルを照合して静的資材を再生成できます。Release のパッケージ処理はこの再生成結果を元のカタログと比較します。この照合は破損の検出であり、アーカイブ単体で upstream の真正性を証明するものではありません。

portable ZIP は、選択した依存と原文のライセンスを同梱します。schema 3 の `libraries` は部品、固定版、manifest のハッシュを保持します。旧 schema 1・2 は選択なしで移行し、シミュレーションの設定を保持します。ZIP の全項目は256項目、展開後16 MiB 以下です。ソースだけでなく、ライセンス、データ、manifest、`project.json` も制限に算入します。

manifest とファイルのサイズ・SHA-256 を検査し、同じ部品の異なる版、依存の循環、不足、衝突を拒否します。古い snapshot はその版のまま保持し、現行のカタログへ自動で置き換えません。ZIP 自身に書かれたハッシュの一致だけで、upstream の真正性を確認したとは表示しません。現行の配布カタログとの一致、照合できない場合、不一致を区別します。

依存のソースとデータは合成とシミュレーションで同じ closure を使います。原文のライセンスと manifest はコンパイラーへ渡しません。VHDL のソースは現段階のシミュレーターから除外します。名前付き VHDL library のメタデータは保持しますが、ホスト API の対応が済むまでは合成を明示的に拒否します。

選択画面は同一オリジンの静的カタログと資材だけを取得し、リダイレクトを拒否します。ソース等は検証後に保存し、その後でプロジェクトを切り替えます。取得や検証が失敗しても、旧プロジェクトを途中の依存で置き換えません。選択解除はカタログを取得できない場合も使えます。他の選択から参照される依存と原文のライセンスは残します。

資材生成の単体テストと、ブラウザー統合・ボードでの動作確認は別です。ライセンス文書とカタログの生成だけで、4ボードへの対応や CPU の動作を確認した扱いにはしません。実機への書き込みは本リポジトリでは試していない。
