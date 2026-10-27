# Maono Mic Mute for Ulanzi Studio

[![CI](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml/badge.svg)](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml)

**English** · [日本語](README.ja.md)

A plugin for [Ulanzi Studio](https://www.ulanzi.com/pages/ulanzi-app) (UlanziDeck) that mutes and unmutes a Maono
microphone with a key press — **the same mute as Maono Link's own mute button** — and shows on the key whether the
microphone is muted. macOS only.

<img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/plugin.png" width="96" alt="Maono Mic Mute icon">

| Live | Muted | Nothing to mute |
| --- | --- | --- |
| <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-live.png" width="72" alt="green microphone"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-muted.png" width="72" alt="red key with a crossed-out microphone"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-unavailable.png" width="72" alt="grey microphone with a warning badge"> |

## Two ways to mute, with a selectable priority

Muting a Maono microphone the way its hardware does is not the same as the microphone mute macOS offers; it is a
register on the device. This plugin flips that register two ways, and you choose the order in the settings panel:

- **Maono Link** — drives Maono Link's local IPC, so it is exactly what clicking mute in Maono Link does. Needs Maono
  Link running.
- **USB (direct)** — talks to the microphone over USB-HID itself (the same register write Maono Link sends), so it
  works even when Maono Link is closed. While Maono Link is showing the microphone it holds the device, so the USB
  method is busy then.

The two are complementary, so the default — **Maono Link first, then USB** — just works: when Maono Link is open the
key uses it, and when Maono Link is closed the key falls back to USB. You can also pick *USB first*, *Maono Link only*,
or *USB only*.

The key follows mute changes made elsewhere (Maono Link, another app), and in 8 languages
(en, ja, zh-CN, zh-HK, ko, de, pt, es). Works inside multi-actions.

## How it works

Ulanzi Studio runs the plugin's main service on Node.js. The **Maono Link** method is plain IPC, so the main service
talks to Maono Link's local socket itself. The **USB (direct)** method needs HID, which Node.js cannot do, so the
plugin ships a small Swift helper, `plugin/bin/micmute-helper` (universal binary for Apple silicon and Intel, ad-hoc
signed), that writes the device's mute register (`0x45`) over HID. The helper opens the microphone only to write and
closes it immediately, so it never keeps Maono Link from using the device.

The plugin never records or sends audio. It only reads the list of input devices and the mute state, and flips the
mute.

## Installation

You need the Xcode Command Line Tools (`xcode-select --install`) and Node.js 22 or later.

```sh
npm ci
npm run plugin:install   # build, then copy into Ulanzi Studio's plugin folder
```

Restart Ulanzi Studio if **Maono Mic Mute** does not show up in the action list, or if it still runs an older version.

To install a zip from [Releases](https://github.com/shinoda-yosuke/ulanzi-maono-mute/releases) instead, quit
Ulanzi Studio and extract it so that the `com.ulanzi.maonomute.ulanziPlugin` folder sits directly in
`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`. The helper is not notarized, so macOS blocks it when the
zip came from a browser download; remove the download flag before starting Ulanzi Studio:

```sh
xattr -dr com.apple.quarantine ~/Library/Application\ Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.maonomute.ulanziPlugin
```

## Usage

1. Drag **Maono Mic Mute › Toggle Mute** onto a key.
2. Press the key. It turns red while the microphone is muted and green while it is live.
3. To change which method is tried first, open the key's settings and pick a **Mute method**.

### Troubleshooting

- **The key is grey with an orange badge**: nothing can mute right now. The settings panel shows why — Maono Link is
  not running *and* the USB method cannot reach the microphone (no Maono microphone connected, or Maono Link is holding
  it with the device panel open).
- **See the microphones the USB method sees**: run the helper directly.

  ```sh
  ~/Library/Application\ Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.maonomute.ulanziPlugin/plugin/bin/micmute-helper list
  ```

## Development

```sh
npm ci
npm test                  # build + unit tests + end-to-end test against a fake Ulanzi Studio, Maono Link and helper
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
native/micmute-helper.swift         CoreAudio-free HID helper (JSON lines over stdin/stdout)
src/                                main service (Node.js)
  maono-link.js                     the Maono Link IPC method
  hid.js                            the USB (direct) method, driving the helper
  methods.js plugin.js app.js       the action: priority, key icon, settings
  vendor/plugin-common-node/        Ulanzi SDK for Node.js (vendored)
scripts/                            build, validation, packaging, install, icon rendering
test/                               node:test suites; fixtures/ stand in for Maono Link and the helper
design/                             icon sources
```

Ulanzi Studio starts the main service as `node plugin/app.js <address> <port> <language> <version>`. For debugging,
launch Ulanzi Studio with `--log` (see "Debug in Desktop App" in the SDK README); the plugin writes method failures and
the helper's diagnostics with the SDK's `logMessage`.

### Releasing

1. Bump `version` in `package.json` and `Version` in `com.ulanzi.maonomute.ulanziPlugin/manifest.json` (tests check they match).
2. Push a tag such as `v1.0.1`. GitHub Actions builds on macOS and attaches the packaged zip to a new release.

## License

[MIT](LICENSE). The plugin bundles the Ulanzi SDK (Apache-2.0) and [ws](https://github.com/websockets/ws) (MIT);
see [THIRD_PARTY_NOTICES.txt](com.ulanzi.maonomute.ulanziPlugin/THIRD_PARTY_NOTICES.txt) and [src/vendor](src/vendor/README.md).

This is a community plugin, not affiliated with Maono or Ulanzi. Maono is a trademark of its owner. The register-level
USB protocol was observed from Maono Link for interoperability. The UUID (`com.ulanzi.ulanzistudio.maonomute`) follows
the naming convention required by the SDK.
