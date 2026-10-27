# Maono Mic Mute for Ulanzi Studio

[![CI](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml/badge.svg)](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml)

[English](README.md) · **日本語**

Maono のマイクをキー 1 つでミュート・解除する [Ulanzi Studio](https://www.ulanzi.com/pages/ulanzi-app)（UlanziDeck）
用プラグインです。**Maono Link のミュートボタンと同じミュート**を行い、ミュート中かどうかをキーに表示します。macOS 専用です。

<img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/plugin.png" width="96" alt="Maono Mic Mute のアイコン">

| オン | ミュート中 | ミュートできる対象がない |
| --- | --- | --- |
| <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-live.png" width="72" alt="緑のマイク"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-muted.png" width="72" alt="赤いキーに斜線付きのマイク"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-unavailable.png" width="72" alt="警告バッジ付きの灰色のマイク"> |

## 2 つのミュート方式・優先順位を選べる

Maono のマイクを本体としてミュートするのは、macOS の入力ミュートとは別物で、デバイス上のレジスタです。本プラグインは
このレジスタを 2 つの方法で切り替え、設定パネルでその優先順位を選べます。

- **Maono Link** — Maono Link のローカル IPC を叩くので、Maono Link でミュートを押すのと完全に同じです。Maono Link の
  起動が必要です。
- **USB（直接）** — マイク本体と USB-HID で直接やり取りします（Maono Link が送るのと同じレジスタ書き込み）。Maono Link
  を閉じていても動きます。Maono Link がマイクの画面を開いている間はデバイスを占有するため、そのときは USB 方式はビジーです。

2 方式は相補的なので、既定の **「Maono Link 優先、なければ USB」** でそのまま機能します（Maono Link を開いていればそれを使い、
閉じていれば USB にフォールバック）。「USB 優先」「Maono Link のみ」「USB のみ」も選べます。

ほかのアプリや Maono Link でのミュート変更もキーに反映します。設定パネルとメッセージは 8 言語
（英・日・簡体字・繁体字・韓・独・葡・西）。マルチアクションの中でも使えます。

## しくみ

Ulanzi Studio はメインサービスを Node.js で動かします。**Maono Link** 方式はただの IPC なので、メインサービスが自分で
Maono Link のローカルソケットと通信します。**USB（直接）** 方式は HID が必要ですが Node.js からは扱えないため、小さな
Swift 製ヘルパー `plugin/bin/micmute-helper`（Apple シリコンと Intel のユニバーサルバイナリ、ad-hoc 署名）を同梱し、
デバイスのミュートレジスタ（`0x45`）を HID で書き込みます。ヘルパーは書き込み時だけマイクを開いてすぐ閉じるので、
Maono Link のデバイス利用を妨げません。

録音や音声の送信は一切しません。入力デバイスの一覧とミュート状態を読み、ミュートを切り替えるだけです。

## インストール

Xcode Command Line Tools（`xcode-select --install`）と Node.js 22 以上が必要です。

```sh
npm ci
npm run plugin:install   # ビルドして Ulanzi Studio のプラグインフォルダへコピー
```

アクション一覧に **Maono マイクミュート** が表示されない場合や古いバージョンが動き続ける場合は、Ulanzi Studio を再起動してください。

[Releases](https://github.com/shinoda-yosuke/ulanzi-maono-mute/releases) の zip から入れる場合は、Ulanzi Studio を終了し、
`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/` の直下に `com.ulanzi.maonomute.ulanziPlugin` フォルダが来るように
展開します。ヘルパーは公証（notarize）していないため、ブラウザでダウンロードした zip だと macOS が実行を止めます。
Ulanzi Studio を起動する前にダウンロード属性を外してください。

```sh
xattr -dr com.apple.quarantine ~/Library/Application\ Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.maonomute.ulanziPlugin
```

## 使い方

1. **Maono マイクミュート › ミュート切り替え** をキーにドラッグします。
2. キーを押します。ミュート中はキーが赤く、オンのときは緑のマイクになります。
3. どの方式を優先するかは、キーの設定を開いて **ミュート方式** で選びます。

### うまく動かないとき

- **キーが灰色でオレンジのバッジ**: いまミュートできる方式がありません。理由は設定パネルに表示されます
  （Maono Link が起動しておらず、かつ USB 方式もマイクに届かない＝Maono マイク未接続、または Maono Link がデバイス画面を
  開いて占有している）。
- **USB 方式から見えるマイクを確認する**: ヘルパーを直接実行します。

  ```sh
  ~/Library/Application\ Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.maonomute.ulanziPlugin/plugin/bin/micmute-helper list
  ```

## 開発

```sh
npm ci
npm test                  # ビルド + 単体テスト + 偽の Ulanzi Studio・Maono Link・ヘルパーを相手にした E2E テスト
npm run plugin:link       # このチェックアウトを Ulanzi Studio にシンボリックリンク（変更後は npm run build）
npm run plugin:install    # パッケージ済みのビルドをコピー
npm run plugin:uninstall
npm run package           # dist/com.ulanzi.maonomute.ulanziPlugin.zip を作成
npm run icons             # design/*.svg から PNG アイコンを生成
```

macOS では `npm test` が本物のヘルパーも読み取り専用で実行します（デバイスを列挙するだけで、ミュートは変えません）。
Ulanzi Studio 同梱の Node.js（Node.js 20）で E2E テストを実行するには:

```sh
PLUGIN_NODE="/Applications/Ulanzi Studio.app/Contents/MacOS/NodeJS/node" npm test
```

ディレクトリ構成やリリース手順は [README.md](README.md#development) を参照してください。

## ライセンス

[MIT](LICENSE)。Ulanzi SDK（Apache-2.0）と [ws](https://github.com/websockets/ws)（MIT）を同梱しています。
[THIRD_PARTY_NOTICES.txt](com.ulanzi.maonomute.ulanziPlugin/THIRD_PARTY_NOTICES.txt) と [src/vendor](src/vendor/README.md) を参照してください。

Maono・Ulanzi のどちらとも関係のないコミュニティ製プラグインです。Maono は各権利者の商標です。USB のレジスタレベルの
プロトコルは相互運用のために Maono Link の動作から観察したものです。UUID（`com.ulanzi.ulanzistudio.maonomute`）は SDK が
定める命名規則に従っています。
