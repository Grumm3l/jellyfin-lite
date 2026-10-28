# The NaCl module (native/): TLS 1.2 proxy + book service, built with the
# PNaCl toolchain and translated for the TV's ARM CPU.
# Output: tlsproxy_arm.nexe + tlsproxy_arm.nmf (copied to native/dist by
# "nix run .#native") and the portable tlsproxy.pexe.
{ lib, stdenv, fetchurl, python2, naclSdk }:

let
  tc = "${naclSdk}/toolchain/linux_pnacl/bin64";
  sdkFlags = "-I${naclSdk}/include -I${naclSdk}/include/pnacl -I${naclSdk}/ports/include";
  sdkLibs = "-L${naclSdk}/lib/pnacl/Release -L${naclSdk}/ports/lib/newlib_pnacl/Release";

  nativeSrc = lib.fileset.toSource {
    root = ../native;
    fileset = lib.fileset.unions [ ../native/src ../native/ca ];
  };
  # the dependencies only see what they need, so editing the module doesn't rebuild them
  mbedtlsConfig = lib.fileset.toSource { root = ../native/src; fileset = ../native/src/mbedtls_user_config.h; };
  compat = lib.fileset.toSource { root = ../native/src/compat; fileset = ../native/src/compat; };

  # settings shared by all PNaCl builds
  pnacl = attrs: stdenv.mkDerivation ({
    dontConfigure = true;
    dontStrip = true;
    dontPatchELF = true;
    preBuild = ''
      export PNACLPYTHON=${python2}/bin/python HOME=$TMPDIR
    '';
  } // attrs);

  mbedtls = pnacl rec {
    pname = "mbedtls-pnacl";
    version = "2.28.9";
    src = fetchurl {
      url = "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-${version}/mbedtls-${version}.tar.bz2";
      hash = "sha256-6F6peq943WwKW6LlTdWTL/oV85q/wYnCa+73aEYwwCs=";
    };
    buildPhase = ''
      runHook preBuild
      mkdir obj
      for c in library/*.c; do
        ${tc}/pnacl-clang -O3 -Iinclude -I${mbedtlsConfig} \
          '-DMBEDTLS_USER_CONFIG_FILE="mbedtls_user_config.h"' -c "$c" -o "obj/$(basename "''${c%.c}").o"
      done
      ${tc}/pnacl-ar rcs libmbedtls_nacl.a obj/*.o
    '';
    installPhase = ''
      mkdir -p $out/lib
      cp libmbedtls_nacl.a $out/lib/
      cp -r include $out/
    '';
  };

  # compressed RAR comic pages (BSD license)
  libarchive = pnacl rec {
    pname = "libarchive-pnacl";
    version = "3.8.1";
    src = fetchurl {
      url = "https://github.com/libarchive/libarchive/releases/download/v${version}/libarchive-${version}.tar.gz";
      hash = "sha256-vegypeM0Tccjz+nMN/jlS94EVlv+bxNrwb0xqzUun6s=";
    };
    buildPhase = ''
      runHook preBuild
      patchShebangs .
      ./configure -q --host=le32-unknown-nacl CC=${tc}/pnacl-clang AR=${tc}/pnacl-ar RANLIB=true \
        CPPFLAGS="-I${naclSdk}/include -I${naclSdk}/ports/include" LDFLAGS="${sdkLibs}" \
        --disable-shared --enable-static --with-zlib --without-xml2 --without-expat --without-openssl \
        --without-lzma --without-bz2lib --without-zstd --without-lz4 --without-libb2 --without-iconv \
        --without-mbedtls --without-nettle --without-cng --disable-acl --disable-xattr \
        --disable-bsdtar --disable-bsdcpio --disable-bsdcat --disable-bsdunzip
      # newlib calls the global "timezone" _timezone
      make -s -j$NIX_BUILD_CORES CFLAGS="-O2 -Dtimezone=_timezone" libarchive.la
      ${tc}/pnacl-ar s .libs/libarchive.a
    '';
    installPhase = ''
      mkdir -p $out/lib $out/include
      cp .libs/libarchive.a $out/lib/
      cp libarchive/archive.h libarchive/archive_entry.h $out/include/
    '';
  };

  # PDF pages (AGPL-3.0); without JavaScript, HTML/EPUB/XPS and extra fonts
  mupdf = pnacl rec {
    pname = "mupdf-pnacl";
    version = "1.23.11";
    src = fetchurl {
      url = "https://mupdf.com/downloads/archive/mupdf-${version}-source.tar.gz";
      hash = "sha256-R48qFn/q4qKRyLi8UgXyzi8J8JtXSm6wUlv62Vo8/mY=";
    };
    xcflags = lib.concatStringsSep " " [
      "-I${compat}" "-include ${compat}/mupdf_compat.h" "-DHAVE_SIGSETJMP=0"
      "-DTOFU" "-DTOFU_CJK" "-DNO_ICC" "-DFZ_ENABLE_JS=0" "-DFZ_ENABLE_XPS=0" "-DFZ_ENABLE_SVG=0"
      "-DFZ_ENABLE_CBZ=0" "-DFZ_ENABLE_IMG=0" "-DFZ_ENABLE_HTML=0" "-DFZ_ENABLE_EPUB=0"
      "-DFZ_ENABLE_FB2=0" "-DFZ_ENABLE_MOBI=0" "-DFZ_ENABLE_OFFICE=0" "-DFZ_ENABLE_TXT=0"
      "-DFZ_ENABLE_OCR_OUTPUT=0" "-DFZ_ENABLE_DOCX_OUTPUT=0" "-DFZ_ENABLE_ODT_OUTPUT=0"
    ];
    buildPhase = ''
      runHook preBuild
      # HarfBuzz (only used for HTML layout) is too new for this compiler: headers only
      make -s -j$NIX_BUILD_CORES build=release OS=pnacl CC=${tc}/pnacl-clang \
        CXX="${tc}/pnacl-clang++ -std=gnu++11" AR=${tc}/pnacl-ar HAVE_X11=no HAVE_GLUT=no HAVE_CURL=no \
        HAVE_LEPTONICA=no HAVE_TESSERACT=no HAVE_OBJCOPY=no USE_SYSTEM_HARFBUZZ=yes \
        SYS_HARFBUZZ_CFLAGS=-I$PWD/thirdparty/harfbuzz/src SYS_HARFBUZZ_LIBS= \
        XCFLAGS="$xcflags" libs
      # the makefile indexes the archives with the host ranlib
      for l in build/release/libmupdf.a build/release/libmupdf-third.a; do ${tc}/pnacl-ar s $l; done
    '';
    installPhase = ''
      mkdir -p $out/lib
      cp build/release/libmupdf.a build/release/libmupdf-third.a $out/lib/
      cp -r include $out/
    '';
  };

in
pnacl {
  pname = "jellyfin-lite-nacl";
  version = "0.11.0";
  src = nativeSrc;
  passthru = { inherit mbedtls libarchive mupdf; };
  buildPhase = ''
    runHook preBuild
    {
      echo "/* generated from the PEM files in native/ca */"
      echo "static const char kCaPem[] ="
      cat ca/*.pem | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/  "/; s/$/\\n"/'
      echo ";"
    } > ca_bundle.h
    ${tc}/pnacl-clang++ -std=gnu++11 -O3 -I. -Isrc -Isrc/compat ${sdkFlags} \
      -I${mbedtls}/include '-DMBEDTLS_USER_CONFIG_FILE="mbedtls_user_config.h"' \
      -I${libarchive}/include -I${mupdf}/include -DHAVE_SIGSETJMP=0 \
      src/tlsproxy.cc src/book.cpp src/rarmini.cpp src/pdfdoc.cpp ${sdkLibs} \
      ${mbedtls}/lib/libmbedtls_nacl.a ${libarchive}/lib/libarchive.a \
      ${mupdf}/lib/libmupdf.a ${mupdf}/lib/libmupdf-third.a \
      -lppapi_cpp -lppapi -lz -lm -lpthread -o tlsproxy.bc
    ${tc}/pnacl-finalize tlsproxy.bc -o tlsproxy.pexe
    ${tc}/pnacl-translate -arch arm tlsproxy.pexe -o tlsproxy_arm.nexe
  '';
  installPhase = ''
    mkdir -p $out
    cp tlsproxy_arm.nexe tlsproxy.pexe $out/
    # ARM-only manifest: the TV's x-nacl parser rejects a "portable" entry
    echo '{ "program": { "arm": { "url": "tlsproxy_arm.nexe" } } }' > $out/tlsproxy_arm.nmf
  '';
  meta.platforms = [ "x86_64-linux" ];
}
