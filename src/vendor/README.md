# Vendored Ulanzi SDK code

The Ulanzi SDK libraries are not published to npm, so (as the SDK instructs) they are copied into this
repository **unmodified**:

| Path | Upstream | Commit | License |
| --- | --- | --- | --- |
| `src/vendor/plugin-common-node/` | [UlanziTechnology/plugin-common-node](https://github.com/UlanziTechnology/plugin-common-node) | `112bd13` | Apache-2.0 |
| `com.ulanzi.maonomute.ulanziPlugin/libs/` | [UlanziTechnology/plugin-common-html](https://github.com/UlanziTechnology/plugin-common-html) | `79de0b0` | Apache-2.0 |

Both commits are the submodules of [UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK) `550ab80`.
To update, copy the newer files over these directories and run `npm test`.
