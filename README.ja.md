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
このミュートは Maono Link がローカル IPC ソケット経由で送っているので、本プラグインも**同じコマンド**（ミュート「type 5」＝
マイクのミュートレジスタ）をそのソケットに送ります。キーを押すことは、Maono Link でミュートを押すのと完全に同じ（LED も点灯）です。
Maono Link 側でのミュート操作もキーに反映されます。

ミュートが Maono Link 経由のため、**Maono Link を起動し、マイクの画面を開いておく必要があります**（そのとき IPC が有効になります）。
開いていないときはキーが灰色＋警告バッジになり、押すと「Maono Link を開いてください」と表示します。（Maono Link 無しでも効く
「信号ミュート」も作れますが、それでは LED が点かないため採用していません。）

プラグインは純 Node.js です。録音や音声送信は一切せず、ネイティブヘルパーも不要です。Maono Link 経由でミュート状態を読み、切り替えるだけです。

## インストール

Node.js 22 以上が必要です。（Xcode ツールは不要。純 Node.js です。）

```sh
npm ci
npm run plugin:install   # ビルドして Ulanzi Studio のプラグインフォルダへコピー
```

アクション一覧に **Maono マイクミュート** が出ない、または古いバージョンが動き続ける場合は、Ulanzi Studio を再起動してください。

[Releases](https://github.com/shinoda-yosuke/ulanzi-maono-mute/releases) の zip から入れる場合は、Ulanzi Studio を終了し、
`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/` の直下に `com.ulanzi.maonomute.ulanziPlugin` フォルダが来るように展開します。

## 使い方

1. **Maono Link** を起動し、マイクの画面を開いておきます。
2. **Maono マイクミュート › ミュート切り替え** をキーにドラッグします。
3. キーを押します。ミュート中はキーが赤く（本体の LED も点灯）、オンのときは緑のマイクになります。

### うまく動かないとき

- **キーが灰色でオレンジのバッジ**: ミュートに届いていません。Maono Link を起動し、マイクの画面を開いてください
  （ミュートを運ぶ IPC はそのときだけ有効です）。
- **押しても LED が点かない**: まず Maono Link 自体でミュットが効くか、そして Maono Link のウィンドウがそのマイクを表示しているか
  （デバイス一覧や別デバイスでないか）を確認してください。

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
相互運用のために Maono Link の動作から特定しました。信号だけのミュート（`0x45` / type 8）は入力を止めますが LED が点かないため、
本プラグインでは使いません。

## ライセンス

[MIT](LICENSE)。Ulanzi SDK（Apache-2.0）と [ws](https://github.com/websockets/ws)（MIT）を同梱しています。
[THIRD_PARTY_NOTICES.txt](com.ulanzi.maonomute.ulanziPlugin/THIRD_PARTY_NOTICES.txt) と [src/vendor](src/vendor/README.md) を参照してください。

Maono・Ulanzi のどちらとも関係のないコミュニティ製プラグインです。Maono は各権利者の商標です。
UUID（`com.ulanzi.ulanzistudio.maonomute`）は SDK が定める命名規則に従っています。
