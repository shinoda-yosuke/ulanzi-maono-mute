# Maono Mic Mute for Ulanzi Studio

[![CI](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml/badge.svg)](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml)

**English** · [日本語](README.ja.md)

A plugin for [Ulanzi Studio](https://www.ulanzi.com/pages/ulanzi-app) (UlanziDeck) that mutes and unmutes a Maono USB
microphone with a key press, and shows on the key whether the microphone is muted. macOS only.

<img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/plugin.png" width="96" alt="Maono Mic Mute icon">

| Live | Muted | Nothing to mute |
| --- | --- | --- |
| <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-live.png" width="72" alt="green microphone"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-muted.png" width="72" alt="red key with a crossed-out microphone"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-unavailable.png" width="72" alt="grey microphone with a warning badge"> |

## Features

- **Toggle Mute** action: each press flips the input mute of the microphone.
- **Automatic** device choice: picks the Maono microphone connected over USB (for example *Maono Wireless Mic RX*),
  ahead of virtual devices such as *Maono AI Microphone* that Maono Link adds. Any other input device can be chosen in
  the settings panel.
- The key follows mute changes made elsewhere (for example by another app) and microphones being plugged in or out.
- Messages and the settings panel in 8 languages (en, ja, zh-CN, zh-HK, ko, de, pt, es). Works inside multi-actions.

## How it works

Ulanzi Studio runs the plugin's main service on Node.js, which cannot reach macOS's audio APIs. The plugin therefore
ships a small Swift helper, `plugin/bin/micmute-helper` (universal binary for Apple silicon and Intel, ad-hoc signed),
which sets the device's input mute in CoreAudio (`kAudioDevicePropertyMute`), so every app that records from the device
gets silence. The main service and the helper exchange JSON lines over stdin/stdout; the helper reports device and
mute changes as they happen and exits together with the main service.

The plugin never records or sends audio. It only reads the list of input devices and changes their mute switch.

## Installation

You need the Xcode Command Line Tools (`xcode-select --install`) and Node.js 22 or later.

```sh
npm ci
npm run plugin:install   # build, then copy into Ulanzi Studio's plugin folder
```

Restart Ulanzi Studio if **Maono Mic Mute** does not show up in the action list, or if it still runs an older version.

To install a zip from [Releases](https://github.com/shinoda-yosuke/ulanzi-maono-mute/releases) instead, quit
Ulanzi Studio and extract it so that the `com.ulanzi.maonomute.ulanziPlugin` folder sits directly in
`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`. The helper is not notarized, so macOS blocks it when the zip
came from a browser download; remove the download flag before starting Ulanzi Studio:

```sh
xattr -dr com.apple.quarantine ~/Library/Application\ Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.maonomute.ulanziPlugin
```

## Usage

1. Drag **Maono Mic Mute › Toggle Mute** onto a key.
2. Press the key. It turns red while the microphone is muted and green while it is live.
3. To mute another device (for example *Maono AI Microphone*), choose it under **Microphone** in the settings panel.

### Troubleshooting

- **The key is grey with an orange badge**: there is nothing to mute. The settings panel says why: no Maono
  microphone that can be muted is connected, the chosen microphone is unplugged, or the helper cannot run.
- **See what the helper sees**: run it directly; it prints the input devices, whether each can be muted, and their mute.

  ```sh
  ~/Library/Application\ Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.maonomute.ulanziPlugin/plugin/bin/micmute-helper list
  ```

- A mute button on the microphone or its transmitter may work inside the device without telling macOS; the key then
  cannot show it.

## Development

```sh
npm ci
npm test                  # build + unit tests + end-to-end test against a fake Ulanzi Studio and a fake helper
npm run plugin:link       # symlink this checkout into Ulanzi Studio (then `npm run build` after changes)
npm run plugin:install    # copy a packaged build instead
npm run plugin:uninstall
npm run package           # dist/com.ulanzi.maonomute.ulanziPlugin.zip
npm run icons             # render design/*.svg into the PNG icons
```

`npm test` also runs the real helper on macOS, read-only: it lists devices but never changes a mute. To run the
end-to-end test with the Node.js that ships with Ulanzi Studio (Node.js 20):

```sh
PLUGIN_NODE="/Applications/Ulanzi Studio.app/Contents/MacOS/NodeJS/node" npm test
```

```text
com.ulanzi.maonomute.ulanziPlugin/  the plugin folder as installed: manifest, icons, property inspector, translations
  plugin/app.js                     bundled from src/ by `npm run build` (not committed)
  plugin/bin/micmute-helper         built from native/ by `npm run build` on macOS (not committed)
  libs/                             Ulanzi SDK for the property inspector (vendored)
native/micmute-helper.swift         CoreAudio helper (JSON lines over stdin/stdout)
src/                                main service (Node.js)
  vendor/plugin-common-node/        Ulanzi SDK for Node.js (vendored)
scripts/                            build, validation, packaging, install, icon rendering
test/                               node:test suites; fixtures/fake-helper.js stands in for the helper
design/                             icon sources
```

Ulanzi Studio starts the main service as `node plugin/app.js <address> <port> <language> <version>`. For debugging,
launch Ulanzi Studio with `--log` (see "Debug in Desktop App" in the SDK README); the plugin writes helper failures and
the helper's diagnostics with the SDK's `logMessage`.

### Releasing

1. Bump `version` in `package.json` and `Version` in `com.ulanzi.maonomute.ulanziPlugin/manifest.json` (tests check they match).
2. Push a tag such as `v1.0.1`. GitHub Actions builds on macOS and attaches the packaged zip to a new release.

## License

[MIT](LICENSE). The plugin bundles the Ulanzi SDK (Apache-2.0) and [ws](https://github.com/websockets/ws) (MIT);
see [THIRD_PARTY_NOTICES.txt](com.ulanzi.maonomute.ulanziPlugin/THIRD_PARTY_NOTICES.txt) and [src/vendor](src/vendor/README.md).

This is a community plugin, not affiliated with Maono or Ulanzi. Maono is a trademark of its owner. The UUID
(`com.ulanzi.ulanzistudio.maonomute`) follows the naming convention required by the SDK.
