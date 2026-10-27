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
| Additional link | <https://github.com/shinoda-yosuke/ulanzi-maono-mute> | The form's optional 追加リンク (docs or demo) |
| Privacy policy | <https://github.com/shinoda-yosuke/ulanzi-maono-mute#privacy> | The October 2026 form has no field for it |

## Ulanzi Studio Marketplace

The steps follow the upload form as of October 2026 (its labels are in the site's language; Japanese is shown here).

1. Sign in at <https://ugc.ulanzistudio.com> and choose **作品のアップロード** (Upload works)
   ([guide](https://bbs.ulanzistudio.com/thread-464-1-1.html)).
2. Choose the type **プラグイン** (Plugin). This shows the Unique ID and additional link fields and makes the cover 1:1.
3. Drop the zip into **メイン作品ファイル** (main work file). The form reads the manifest and fills in the Unique ID,
   the version, the cover (from `Icon`) and each language's name and summary; the detailed introduction starts as a
   copy of the summary.
4. Add `banner-1.png` as **Banner 01** and confirm the crop dialog with **OK** (the banner is already 3:2).
5. In each of the 7 language tabs, paste the name, summary and detailed introduction from [`listing.md`](listing.md).
   Change **作者** (author), which starts as the login e-mail, to `shinoda-yosuke`.
6. Metadata: **カテゴリ** (category) **ライブ配信** (live streaming), **追加リンク** (additional link) the repository
   URL, and **更新内容** (update note), a single field for all languages, e.g. `First release.`
7. Compatibility: the form selects all 7 languages, all devices and, from the manifest, macOS (Apple Silicon) and
   macOS (Intel). Check that Windows stays off; the plugin does not run on Windows.
8. Submit. The work appears under **審査中の作品** (works under review) in **個人センター** (personal center). In July
   2026 Ulanzi support also asked developers to e-mail <ustudioservice@ulanzi.com> with the upload ID or name and what
   the plugin is for; check whether this is still needed.
9. For updates, bump the version (see "Releasing" in the README) and upload the new zip the same way. The published
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
