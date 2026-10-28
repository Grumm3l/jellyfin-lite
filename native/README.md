# NaCl module

The browser on Tizen 2.3 TVs only supports TLS 1.0. This Native Client module
does TLS 1.2 itself (mbedTLS over Pepper sockets) and makes the server
available to the app at `http://127.0.0.1:18080`. API calls, images,
subtitles and video streams all go through it. It also reads books for the
reader.

If the module doesn't start within 15 seconds, or crashes, the app checks
once whether the TV can reach the server by itself (newer TVs support TLS
1.2). If not, it shows an error screen. Servers on plain `http://` are used
directly in that case.

## Files

| Path | Content |
| --- | --- |
| `src/tlsproxy.cc` | the module: proxy, Seerr mode, book requests |
| `src/book.cpp` | reads ZIP, RAR4 and RAR5 archives over byte ranges |
| `src/rarmini.cpp` | unpacks compressed RAR pages (libarchive) |
| `src/pdfdoc.cpp` | renders PDF pages to JPEG (MuPDF) |
| `src/mbedtls_user_config.h` | mbedTLS options for NaCl |
| `src/compat/` | two headers MuPDF needs to build for NaCl |
| `ca/` | trusted root certificates (Mozilla's list, as packaged by curl.se) |
| `test/book_test.cc` | PC test for the book code |
| `dist/` | the built module, committed so the app can be signed without building it |

## Building

```bash
nix run .#native                       # build and copy to native/dist
nix run .#test-books -- a.cbr b.pdf    # test the book code on the PC
```

The build ([../nix/native.nix](../nix/native.nix)) uses the PNaCl toolchain
from Samsung's NaCl SDK v37, mbedTLS 2.28.9, libarchive 3.8.1 and MuPDF
1.23.11. All downloads are pinned by hash.

To trust a private CA (for example a home server with its own certificate),
add its root certificate as a PEM file to `ca/` and rebuild.

## Proxy

`proxy <localport> <host> <port> fast [seerr] [plain]` (a message from the
app) starts a proxy. Reads from the socket are buffered in 64 KB blocks,
because every Pepper call is a round trip to the browser process. With that
the proxy reaches about 31 Mbit/s on a UE48J5670, the same as the TV's own
TLS 1.0.

Seerr runs through a second proxy on port 18090. Its cookies are `Secure`
and `SameSite=Strict`, and the app runs on another origin, so the module
keeps them itself, sends the `XSRF-TOKEN` cookie back as `X-XSRF-TOKEN`,
answers CORS preflight requests and reports cookie changes to the app, which
stores them across restarts.

## Books

`GET /__book/<itemId>/info`, `/page/<n>` and `/file/<path>` (with
`?token=…`) on the proxy port. The module reads only the parts of the file it
needs with range requests: the archive index (ZIP central directory, RAR5
quick-open record, RAR4 file headers) and then one request per page. The last
three books stay open.

PDF pages (`page/<n>?width=1280`) are rendered by MuPDF, built without
JavaScript, HTML, EPUB, XPS and extra fonts. The last eight rendered pages
are cached.
