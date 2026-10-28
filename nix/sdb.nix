# Samsung's sdb (Smart Development Bridge) from the official Tizen Studio
# repository, patched to run on NixOS.
{ stdenv, fetchurl, unzip, autoPatchelfHook }:

stdenv.mkDerivation rec {
  pname = "sdb";
  version = "4.2.36";
  src = fetchurl {
    url = "https://download.tizen.org/sdk/tizenstudio/official/binary/sdb_${version}_ubuntu-64.zip";
    hash = "sha256-rd+CXhqIap8iDLPSh+dEOMrg/6/lghubrKnU9sfeUSQ=";
  };
  nativeBuildInputs = [ unzip autoPatchelfHook ];
  buildInputs = [ stdenv.cc.cc.lib ];
  unpackPhase = "unzip -q -j $src data/tools/sdb";
  installPhase = "install -Dm755 sdb $out/bin/sdb";
  meta.platforms = [ "x86_64-linux" ];
}
