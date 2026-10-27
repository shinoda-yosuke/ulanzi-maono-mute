# Marketplace submission kit

Materials and steps for listing Maono Mic Mute on the
[Ulanzi Studio Marketplace](https://ugc.ulanzistudio.com) and the unofficial
[Ulanzi Community Store](https://ulanzicommunitystore.narlei.com/).

## Materials

| Item | File | Notes |
| --- | --- | --- |
| Plugin package | `dist/com.ulanzi.maonomute.ulanziPlugin.zip` (`npm run package`) or the asset of a GitHub Release | The `com.ulanzi.maonomute.ulanziPlugin/` folder sits at the root of the zip; keep this file name |
| Cover (1:1) | [`../com.ulanzi.maonomute.ulanziPlugin/assets/icons/plugin.png`](../com.ulanzi.maonomute.ulanziPlugin/assets/icons/plugin.png) (288×288 PNG) | Taken from `Icon` in manifest.json |
| Banner 01 (3:2) | [`banner-1.png`](banner-1.png) (1098×732) | Source: [`../design/banner.svg`](../design/banner.svg) (`npm run icons`) |
| Name, summary, details, update note | [`listing.md`](listing.md) | Limits: name 40, summary 300, details 1000, update note 1000 characters |
| Privacy policy | <https://github.com/shinoda-yosuke/ulanzi-maono-mute#privacy> | |

## Ulanzi Studio Marketplace

1. Sign in at <https://ugc.ulanzistudio.com> and choose **Upload works**
   ([guide](https://bbs.ulanzistudio.com/thread-464-1-1.html)).
2. Drop the zip into the main work file field and wait until every item of **Auto check** passes.
3. Add the cover and banner, then the texts of each supported language from [`listing.md`](listing.md).
4. Compatibility: all devices (the action works on any key); macOS (Apple Silicon) and macOS (Intel). The plugin does
   not run on Windows.
5. Submit and follow the review under **Works under review**. In July 2026 Ulanzi support also asked developers to
   e-mail <ustudioservice@ulanzi.com> with the upload ID or name and what the plugin is for; check whether this is still needed.
6. For updates, bump the version (see "Releasing" in the README) and upload the new zip the same way. The published
   version stays online until the new one is approved.

The zip contains a small native helper, `plugin/bin/maono-hid` (a universal binary built from
[`../native/maono-hid.swift`](../native/maono-hid.swift) and signed ad hoc), which mutes the microphone over USB when
Maono Link is not open. If the review asks about it, that is what it is for.

> [!IMPORTANT]
> The plugin UUID (`com.ulanzi.ulanzistudio.maonomute`) cannot be changed once the plugin is published
> ([guideline](https://bbs.ulanzistudio.com/thread-23-1-1.html)).

## Ulanzi Community Store

1. Push a tag that matches the version, e.g. `v1.2.0`. The Release workflow attaches `com.ulanzi.maonomute.ulanziPlugin.zip`.
2. Submit the repository URL at <https://ulanzicommunitystore.narlei.com/#publish>
   ([requirements](https://github.com/narlei/ulanzicommunitystore/blob/main/PUBLISHING.md)).
