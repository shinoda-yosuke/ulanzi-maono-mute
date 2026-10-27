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
lights. This plugin produces that same real mute, two ways, and picks between them automatically:

- **Through Maono Link**, when its microphone panel is open. The plugin sends the very same command Maono Link's own
  button sends (mute "type 5", the microphone's mute register) over Maono Link's local IPC socket. The key also follows
  mutes you make in Maono Link.
- **On its own over HID**, when Maono Link is closed (or running without the panel open). A small native helper
  (`maono-hid`) talks straight to the receiver: it wakes it with the same short handshake Maono Link sends on connect,
  then writes the mute register — LED and all. Maono Link does not need to be running at all.

The key turns grey with a warning badge only when neither is possible — the microphone is not connected and Maono Link
is not open. The plugin never records or sends audio; it only reads the mute state and flips it.

## Installation

You need Node.js 22 or later and the Xcode Command Line Tools, which provide the compiler for the small HID helper
(run `xcode-select --install` if you do not have them).

```sh
npm ci
npm run plugin:install   # build, then copy into Ulanzi Studio's plugin folder
```

Restart Ulanzi Studio if **Maono Mic Mute** does not show up in the action list, or if it still runs an older version.

To install a zip from [Releases](https://github.com/shinoda-yosuke/ulanzi-maono-mute/releases) instead, quit
Ulanzi Studio and extract it so that the `com.ulanzi.maonomute.ulanziPlugin` folder sits directly in
`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`.

## Usage

1. Make sure your Maono microphone is connected. Maono Link does not need to be running.
2. Drag **Maono Mic Mute › Toggle Mute** onto a key.
3. Press the key. It turns red while the microphone is muted (the device LED lights) and green while it is live.

### Troubleshooting

- **The key is grey with an orange badge**: the plugin cannot reach the microphone. Check that it is plugged in. If
  Maono Link is open, make sure its window shows this microphone (not a device list or a different device).
- **Nothing happens / the LED does not light**: if Maono Link is open, confirm its own mute works first. If it is
  closed, make sure no other app is holding the microphone.

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
  plugin/bin/maono-hid              the native HID helper, built from native/ (not committed)
  libs/                             Ulanzi SDK for the property inspector (vendored)
native/maono-hid.swift              the HID helper source: wakes the receiver and sets its mute register
src/                                main service (Node.js)
  maono-link.js                     talks to Maono Link's local IPC (connect, read/set mute, follow changes)
  hid-mute.js                       runs the maono-hid helper to mute over HID without Maono Link
  mute-controller.js                picks Maono Link (IPC) or HID and presents one mute interface
  plugin.js app.js                  the action: key icon, settings, the Ulanzi Studio connection
  vendor/plugin-common-node/        Ulanzi SDK for Node.js (vendored)
scripts/                            build, validation, packaging, install, icon rendering
test/                               node:test suites; fixtures/ run a fake Maono Link IPC server and HID helper
design/                             icon sources
```

Ulanzi Studio starts the main service as `node plugin/app.js <address> <port> <language> <version>`. For debugging,
launch Ulanzi Studio with `--log` (see "Debug in Desktop App" in the SDK README); the plugin writes connection
failures with the SDK's `logMessage`.

### How the mute command was found

Maono Link's mute goes to device register `0x207d` (value 1 mutes, 0 unmutes); over its IPC that is mute "type 5". The
receiver ignores that write until it is "woken" by a control-mode write to register `0x000b` (value 3) — the first
thing Maono Link sends on connect. After that kick the mute reaches the microphone and its LED, and the state latches
even after the device is closed, so the HID helper is short-lived: open → write `0x000b`=3 → write `0x207d` → close.
All of this was observed from Maono Link (capturing its `IOHIDDeviceSetReport` calls) for interoperability. The
signal-only mute (`0x45` / type 8) silences the input but does not light the LED, so it is not used here.

### Releasing

1. Bump `version` in `package.json` and `Version` in `com.ulanzi.maonomute.ulanziPlugin/manifest.json` (tests check they match).
2. Push a tag such as `v1.0.1`. GitHub Actions attaches the packaged zip to a new release.

## License

[MIT](LICENSE). The plugin bundles the Ulanzi SDK (Apache-2.0) and [ws](https://github.com/websockets/ws) (MIT);
see [THIRD_PARTY_NOTICES.txt](com.ulanzi.maonomute.ulanziPlugin/THIRD_PARTY_NOTICES.txt) and [src/vendor](src/vendor/README.md).

This is a community plugin, not affiliated with Maono or Ulanzi. Maono is a trademark of its owner. The UUID
(`com.ulanzi.ulanzistudio.maonomute`) follows the naming convention required by the SDK.
