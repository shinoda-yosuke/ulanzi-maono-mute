# Maono Mic Mute for Ulanzi Studio

[![CI](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml/badge.svg)](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml)

[English](README.md) · **日本語**

Maono の USB マイクをキー 1 つでミュート・解除し、ミュート中かどうかをキーに表示する
[Ulanzi Studio](https://www.ulanzi.com/pages/ulanzi-app)（UlanziDeck）用プラグインです。macOS 専用です。

<img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/plugin.png" width="96" alt="Maono Mic Mute のアイコン">

| オン | ミュート中 | ミュートできる対象がない |
| --- | --- | --- |
| <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-live.png" width="72" alt="緑のマイク"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-muted.png" width="72" alt="赤いキーに斜線付きのマイク"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-unavailable.png" width="72" alt="警告バッジ付きの灰色のマイク"> |

## 機能

- **ミュート切り替え** アクション: キーを押すたびにマイク入力のミュートを切り替えます。
- **自動** でのデバイス選択: USB で接続した Maono のマイク（例: *Maono Wireless Mic RX*）を、Maono Link が追加する
  *Maono AI Microphone* などの仮想デバイスより優先して対象にします。設定パネルでほかの入力デバイスも選べます。
- ほかのアプリでのミュート変更や、マイクの抜き差しもキーの表示に反映します。
- 設定パネルとメッセージは 8 言語（英・日・簡体字・繁体字・韓・独・葡・西）。マルチアクションの中でも使えます。

## しくみ

Ulanzi Studio はメインサービスを Node.js で動かしますが、Node.js からは macOS のオーディオ API を呼べません。
そこで小さな Swift 製ヘルパー `plugin/bin/micmute-helper`（Apple シリコンと Intel のユニバーサルバイナリ、ad-hoc 署名）を
同梱し、CoreAudio のデバイス入力ミュート（`kAudioDevicePropertyMute`）を切り替えます。デバイス単位のミュートなので、
そのデバイスで録音するどのアプリにも無音が届きます。メインサービスとヘルパーは stdin/stdout で JSON Lines をやり取りし、
ヘルパーはデバイスやミュートの変化をその都度知らせ、メインサービスの終了とともに終了します。

録音や音声の送信は一切しません。入力デバイスの一覧を読み、ミュートを切り替えるだけです。

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
3. ほかのデバイス（例: *Maono AI Microphone*）をミュートしたいときは、設定パネルの **マイク** で選びます。

### うまく動かないとき

- **キーが灰色でオレンジのバッジが付いている**: ミュートできる対象がありません。理由は設定パネルに表示されます
  （ミュートできる Maono のマイクが接続されていない、選んだマイクが外れている、ヘルパーを実行できない、のいずれか）。
- **ヘルパーから見えるデバイスを確認する**: ヘルパーを直接実行すると、入力デバイスと、それぞれミュートできるか・
  ミュート中かを表示します。

  ```sh
  ~/Library/Application\ Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.maonomute.ulanziPlugin/plugin/bin/micmute-helper list
  ```

- マイク本体や送信機のミュートボタンは、macOS に知らせずデバイスの中だけで効くことがあります。その場合はキーに反映できません。

## 開発

```sh
npm ci
npm test                  # ビルド + 単体テスト + 偽の Ulanzi Studio と偽のヘルパーを相手にした E2E テスト
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

Maono・Ulanzi のどちらとも関係のないコミュニティ製プラグインです。Maono は各権利者の商標です。
UUID（`com.ulanzi.ulanzistudio.maonomute`）は SDK が定める命名規則に従っています。
