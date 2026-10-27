# Maono Mic Mute for Ulanzi Studio

[![CI](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml/badge.svg)](https://github.com/shinoda-yosuke/ulanzi-maono-mute/actions/workflows/ci.yml)

**English** · [日本語](README.ja.md)

A plugin for [Ulanzi Studio](https://www.ulanzi.com/pages/ulanzi-app) (UlanziDeck) that mutes and unmutes a Maono
microphone with a key press — **the real microphone mute, the one that lights the device's mute LED** — and shows on
the key whether the microphone is muted. macOS only.

<img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/plugin.png" width="96" alt="Maono Mic Mute icon">

| Live | Muted | Can't reach the mute |
| --- | --- | --- |
| <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-live.png" width="72" alt="green microphone"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-muted.png" width="72" alt="red key with a crossed-out microphone"> | <img src="com.ulanzi.maonomute.ulanziPlugin/assets/icons/key-unavailable.png" width="72" alt="grey microphone with a warning badge"> |

## How it works

Maono Link's mute button does more than silence the signal: it mutes the microphone itself, and the device's mute LED
lights. That mute is driven by Maono Link over its local IPC socket, so this plugin sends the very same command
(mute "type 5", the microphone's mute register) through that socket. Pressing the key is then exactly like pressing
mute in Maono Link — LED and all. The key also follows mutes you make in Maono Link.

Because the mute goes through Maono Link, **Maono Link must be running with your microphone's panel open** (that is when
its IPC is available). When it is not, the key turns grey with a warning badge, and pressing it tells you to open
Maono Link. (A plain signal mute that works without Maono Link is possible but does *not* light the LED, so this plugin
does not use it.)

The plugin is plain Node.js — it never records or sends audio, and needs no native helper. It only reads the mute
state and flips it, through Maono Link.

## Installation

You need Node.js 22 or later. (No Xcode tools — the plugin is pure Node.js.)

```sh
npm ci
npm run plugin:install   # build, then copy into Ulanzi Studio's plugin folder
```

Restart Ulanzi Studio if **Maono Mic Mute** does not show up in the action list, or if it still runs an older version.

To install a zip from [Releases](https://github.com/shinoda-yosuke/ulanzi-maono-mute/releases) instead, quit
Ulanzi Studio and extract it so that the `com.ulanzi.maonomute.ulanziPlugin` folder sits directly in
`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`.

## Usage

1. Make sure **Maono Link** is running and showing your microphone (its panel open).
2. Drag **Maono Mic Mute › Toggle Mute** onto a key.
3. Press the key. It turns red while the microphone is muted (the device LED lights) and green while it is live.

### Troubleshooting

- **The key is grey with an orange badge**: the plugin cannot reach the mute. Open Maono Link and show your
  microphone's panel; the IPC that carries the mute is only there then.
- **Nothing happens / the LED does not light**: confirm the mute works in Maono Link itself first, then that
  Maono Link's window shows the microphone (not a device list or a different device).

## Development

```sh
npm ci
npm test                  # build + unit tests + end-to-end test against a fake Ulanzi Studio and Maono Link
npm run plugin:link       # symlink this checkout into Ulanzi Studio (then `npm run build` after changes)
npm run plugin:install    # copy a packaged build instead
npm run plugin:uninstall
npm run package           # dist/com.ulanzi.maonomute.ulanziPlugin.zip
npm run icons             # render design/*.svg into the PNG icons
```

To run the end-to-end test with the Node.js that ships with Ulanzi Studio (Node.js 20):

```sh
PLUGIN_NODE="/Applications/Ulanzi Studio.app/Contents/MacOS/NodeJS/node" npm test
```

```text
com.ulanzi.maonomute.ulanziPlugin/  the plugin folder as installed: manifest, icons, property inspector, translations
  plugin/app.js                     bundled from src/ by `npm run build` (not committed)
  libs/                             Ulanzi SDK for the property inspector (vendored)
src/                                main service (Node.js)
  maono-link.js                     talks to Maono Link's local IPC (connect, read/set mute, follow changes)
  plugin.js app.js                  the action: key icon, settings, the Ulanzi Studio connection
  vendor/plugin-common-node/        Ulanzi SDK for Node.js (vendored)
scripts/                            build, validation, packaging, install, icon rendering
test/                               node:test suites; fixtures/ run a fake Maono Link IPC server
design/                             icon sources
```

Ulanzi Studio starts the main service as `node plugin/app.js <address> <port> <language> <version>`. For debugging,
launch Ulanzi Studio with `--log` (see "Debug in Desktop App" in the SDK README); the plugin writes connection
failures with the SDK's `logMessage`.

### How the mute command was found

Maono Link's mute goes to device register `0x207d` (value 1 mutes, 0 unmutes); over its IPC that is mute "type 5".
This was observed from Maono Link for interoperability. The signal-only mute (`0x45` / type 8) silences the input but
does not light the LED, so it is not used here.

### Releasing

1. Bump `version` in `package.json` and `Version` in `com.ulanzi.maonomute.ulanziPlugin/manifest.json` (tests check they match).
2. Push a tag such as `v1.0.1`. GitHub Actions attaches the packaged zip to a new release.

## License

[MIT](LICENSE). The plugin bundles the Ulanzi SDK (Apache-2.0) and [ws](https://github.com/websockets/ws) (MIT);
see [THIRD_PARTY_NOTICES.txt](com.ulanzi.maonomute.ulanziPlugin/THIRD_PARTY_NOTICES.txt) and [src/vendor](src/vendor/README.md).

This is a community plugin, not affiliated with Maono or Ulanzi. Maono is a trademark of its owner. The UUID
(`com.ulanzi.ulanzistudio.maonomute`) follows the naming convention required by the SDK.
