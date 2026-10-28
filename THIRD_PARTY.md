# Licenses

| Part | License |
| --- | --- |
| Jellyfin Lite's own code (app, scripts, module sources) | MIT, see [LICENSE](LICENSE) |
| NaCl module (`native/dist/tlsproxy_arm.nexe`) | AGPL-3.0, because it contains MuPDF |
| Signed app package (`.wgt`) | AGPL-3.0, because it contains the module |
| Jellyfin logo (`logo.png`) | CC BY-SA 4.0, © Jellyfin contributors ([jellyfin-ux](https://github.com/jellyfin/jellyfin-ux)) |
| Screenshots and animation (`docs/`) | contain images from the [Blender open movies](https://studio.blender.org/films/) (CC BY, © Blender Foundation) and [Pepper & Carrot](https://www.peppercarrot.com) (CC BY 4.0, © David Revoy) |

The MIT-licensed files stay available under MIT on their own.

## Source of the module

The complete source of the module is:

- this repository: `native/src`, `native/ca` and the build in
  [nix/native.nix](nix/native.nix), which pins every download by hash;
- MuPDF 1.23.11, unchanged:
  <https://mupdf.com/downloads/archive/mupdf-1.23.11-source.tar.gz>
  (SHA-256 `478f2a167feae2a291c8b8bc5205f2ce2f09f09b574a6eb0525bfad95a3cfe66`).

## Components in the module

| Component | Version | License | Text |
| --- | --- | --- | --- |
| MuPDF | 1.23.11 | AGPL-3.0 | [AGPL-3.0](LICENSES/AGPL-3.0.txt) |
| jbig2dec, extract (bundled with MuPDF) | | AGPL-3.0 | [AGPL-3.0](LICENSES/AGPL-3.0.txt) |
| FreeType (bundled with MuPDF) | | FreeType License | [FTL](LICENSES/FreeType-FTL.txt) |
| libjpeg (bundled with MuPDF) | 9 | IJG License | [IJG](LICENSES/libjpeg-IJG.txt) |
| OpenJPEG (bundled with MuPDF) | | BSD-2-Clause | [OpenJPEG](LICENSES/OpenJPEG.txt) |
| Little CMS (bundled with MuPDF) | | MIT | [Little CMS](LICENSES/LittleCMS.txt) |
| libarchive | 3.8.1 | BSD-2-Clause | [libarchive](LICENSES/libarchive.txt) |
| Mbed TLS | 2.28.9 | Apache-2.0 | [Apache-2.0](LICENSES/mbedTLS-Apache-2.0.txt) |
| zlib | | zlib License | [zlib](LICENSES/zlib.txt) |
| Pepper libraries (Samsung NaCl SDK) | 37 | BSD-3-Clause | [Chromium BSD](LICENSES/Chromium-BSD.txt) |
| Mozilla CA certificates (`native/ca`) | 2026-10-20 | MPL-2.0 | [MPL-2.0](LICENSES/MPL-2.0.txt) |

This software is based in part on the work of the Independent JPEG Group.

RAR archives are read with libarchive's own implementation.
