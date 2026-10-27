# Maono Mic Mute for Ulanzi Studio

[![CI](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml/badge.svg)](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml)

[English](README.md) · **日本語**

Maono のマイクをキー 1 つでミュート・解除する [Ulanzi Studio](https://www.ulanzi.com/pages/ulanzi-app)（UlanziDeck）
用プラグインです。**マイク本体のミュート LED が点く「本物のミュート」**を行い、ミュート中かどうかをキーに表示します。macOS 専用です。

<img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/plugin.png" width="96" alt="Maono Mic Mute のアイコン">

| オン | ミュート中 | ミュートに届かない |
| --- | --- | --- |
| <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-live.png" width="72" alt="緑のマイク"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-muted.png" width="72" alt="赤いキーに斜線付きのマイク"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-unavailable.png" width="72" alt="警告バッジ付きの灰色のマイク"> |

## しくみ

Maono Link のミュートボタンは、単に信号を消すのではなく**マイク本体をミュートし、デバイスのミュート LED が点灯**します。
本プラグインはこの本物のミュートを 2 通りで実現し、自動で切り替えます。

- **Maono Link 経由**（マイクの画面が開いているとき）。Maono Link 自身のボタンと**同じコマンド**（ミュート「type 5」＝マイクの
  ミュートレジスタ）をローカル IPC ソケットに送ります。Maono Link 側でのミュート操作もキーに反映されます。
- **単体で HID 直接**（Maono Link が閉じている／画面を開いていないとき）。小さなネイティブヘルパー（`maono-hid`）が受信機に直接
  話し、Maono Link が接続時に送るのと同じ短いハンドシェイクで受信機を“起こして”からミュートレジスタを書きます（LED も点灯）。
  Maono Link は起動していなくて構いません。

キーが灰色＋警告バッジになるのは、どちらも不可能なとき（マイク未接続かつ Maono Link も未起動）だけです。録音や音声送信は一切せず、
ミュート状態を読んで切り替えるだけです。

## インストール

Node.js 22 以上と、Xcode Command Line Tools（HID ヘルパーのコンパイルに使います。無ければ `xcode-select --install`）が必要です。

```sh
npm ci
npm run plugin:install   # ビルドして Ulanzi Studio のプラグインフォルダへコピー
```

アクション一覧に **Maono マイクミュート** が出ない、または古いバージョンが動き続ける場合は、Ulanzi Studio を再起動してください。

[Releases](https://github.com/shinoda-yosuke/ulanzi-maono-mute/releases) の zip から入れる場合は、Ulanzi Studio を終了し、
`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/` の直下に `com.ulanzi.maonomute.ulanziPlugin` フォルダが来るように展開します。

## 使い方

1. Maono のマイクが接続されていることを確認します。Maono Link は起動していなくて構いません。
2. **Maono マイクミュート › ミュート切り替え** をキーにドラッグします。
3. キーを押します。ミュート中はキーが赤く（本体の LED も点灯）、オンのときは緑のマイクになります。

### うまく動かないとき

- **キーが灰色でオレンジのバッジ**: マイクに届いていません。接続を確認してください。Maono Link を開いている場合は、その
  ウィンドウがこのマイクを表示しているか（デバイス一覧や別デバイスでないか）を確認してください。
- **押しても LED が点かない**: Maono Link を開いている場合は、まず Maono Link 自体でミュットが効くか確認してください。閉じて
  いる場合は、他のアプリがマイクを掴んでいないか確認してください。

## 開発

```sh
npm ci
npm test                  # ビルド + 単体テスト + 偽の Ulanzi Studio・Maono Link を相手にした E2E テスト
npm run plugin:link       # このチェックアウトを Ulanzi Studio にシンボリックリンク（変更後は npm run build）
npm run plugin:install    # パッケージ済みのビルドをコピー
npm run plugin:uninstall
npm run package           # dist/com.ulanzi.maonomute.ulanziPlugin.zip を作成
npm run icons             # design/*.svg から PNG アイコンを生成
```

Ulanzi Studio 同梱の Node.js（Node.js 20）で E2E テストを実行するには:

```sh
PLUGIN_NODE="/Applications/Ulanzi Studio.app/Contents/MacOS/NodeJS/node" npm test
```

ディレクトリ構成やリリース手順は [README.md](README.md#development) を参照してください。

### ミュートコマンドの特定方法

Maono Link のミュートはデバイスのレジスタ `0x207d`（値 1=ミュート / 0=解除）に書き込みます。IPC ではミュート「type 5」です。
受信機はこの書き込みを、レジスタ `0x000b`（値 3）への制御モード書き込み——Maono Link が接続時に最初に送るもの——で“起こす”まで
無視します。このキックの後はミュートがマイク本体と LED まで届き、デバイスを閉じても状態が保持されます。そのため HID ヘルパーは
短命で、「open → `0x000b`=3 書き込み → `0x207d` 書き込み → close」を行います。いずれも相互運用のために Maono Link の動作
（`IOHIDDeviceSetReport` の捕捉）から特定しました。信号だけのミュート（`0x45` / type 8）は入力を止めますが LED が点かないため使いません。

## ライセンス

[MIT](LICENSE)。Ulanzi SDK（Apache-2.0）と [ws](https://github.com/websockets/ws)（MIT）を同梱しています。
[THIRD_PARTY_NOTICES.txt](com.ulanzi.maonomute.ulanziPlugin/THIRD_PARTY_NOTICES.txt) と [src/vendor](src/vendor/README.md) を参照してください。

Maono・Ulanzi のどちらとも関係のないコミュニティ製プラグインです。Maono は各権利者の商標です。
UUID（`com.ulanzi.ulanzistudio.maonomute`）は SDK が定める命名規則に従っています。

### 免責

HID 直接の経路は、相互運用のために Maono Link の動作を観察して判明した**非公開のプロトコル**でマイクに書き込みます。
Maono Link やファームウェアの更新で動かなくなる可能性があり、デバイスへの書き込みには常に多少のリスクが伴います。
**本プラグインは自己責任でご利用ください** — MIT ライセンスのとおり「現状のまま」提供され、いかなる保証もありません。
