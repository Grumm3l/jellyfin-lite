# PC build of the module's book code (native/src/book.cpp, rarmini.cpp,
# pdfdoc.cpp) with native/test/book_test.cc, to check archives and PDFs
# without the TV: "nix run .#test-books -- comic.cbr book.pdf".
{ lib, stdenv, libarchive, zlib, pkg-config, naclMupdfSrc }:

let
  src = lib.fileset.toSource {
    root = ../native;
    fileset = lib.fileset.unions [ ../native/src ../native/test ];
  };

  # same MuPDF version as on the TV (newer releases changed the API)
  mupdf = stdenv.mkDerivation {
    pname = "mupdf-libs";
    version = "1.23.11";
    src = naclMupdfSrc;
    dontConfigure = true;
    buildPhase = ''
      make -s -j$NIX_BUILD_CORES build=release HAVE_X11=no HAVE_GLUT=no HAVE_CURL=no \
        HAVE_LEPTONICA=no HAVE_TESSERACT=no USE_SYSTEM_HARFBUZZ=yes \
        SYS_HARFBUZZ_CFLAGS=-I$PWD/thirdparty/harfbuzz/src SYS_HARFBUZZ_LIBS= \
        XCFLAGS="-DTOFU -DTOFU_CJK -DNO_ICC -DFZ_ENABLE_JS=0 -DFZ_ENABLE_XPS=0 -DFZ_ENABLE_SVG=0 \
          -DFZ_ENABLE_CBZ=0 -DFZ_ENABLE_IMG=0 -DFZ_ENABLE_HTML=0 -DFZ_ENABLE_EPUB=0 -DFZ_ENABLE_FB2=0 \
          -DFZ_ENABLE_MOBI=0 -DFZ_ENABLE_OFFICE=0 -DFZ_ENABLE_TXT=0 -DFZ_ENABLE_OCR_OUTPUT=0 \
          -DFZ_ENABLE_DOCX_OUTPUT=0 -DFZ_ENABLE_ODT_OUTPUT=0" libs
    '';
    installPhase = ''
      mkdir -p $out/lib
      cp build/release/libmupdf.a build/release/libmupdf-third.a $out/lib/
      cp -r include $out/
    '';
  };
in
stdenv.mkDerivation {
  pname = "book-test";
  version = "0.11.0";
  inherit src;
  nativeBuildInputs = [ pkg-config ];
  buildInputs = [ libarchive zlib ];
  dontConfigure = true;
  buildPhase = ''
    $CXX -std=c++11 -O2 -Wall -DWITH_PDF -Isrc -I${mupdf}/include $(pkg-config --cflags libarchive) \
      src/book.cpp src/rarmini.cpp src/pdfdoc.cpp test/book_test.cc \
      ${mupdf}/lib/libmupdf.a ${mupdf}/lib/libmupdf-third.a $(pkg-config --libs libarchive) -lz -lm -lpthread \
      -o book_test
  '';
  installPhase = "install -Dm755 book_test $out/bin/book_test";
}
