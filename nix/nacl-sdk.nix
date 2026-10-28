# Samsung NaCl SDK v37 (Pepper 37, for 2015 TVs), from
# developer.samsung.com/smarttv/develop/extension-libraries/nacl/download.html
# Only the PNaCl toolchain, headers and libraries are kept; the 64-bit host
# programs are patched to run on NixOS. The toolchain's driver scripts need
# Python 2: set PNACLPYTHON to python2 when using it.
{ stdenv, fetchurl, unzip, autoPatchelfHook }:

stdenv.mkDerivation {
  pname = "nacl-sdk-pepper";
  version = "37";
  src = fetchurl {
    name = "NaCl_SDK_v37.zip";
    url = "https://developer.samsung.com/smarttv/file/7a760779-2908-4b20-9530-22e9858323d6";
    hash = "sha256-C9+QwIjUJb5Q6QlEvPDe4Ba3UFn6kfIXNCYrhomK4BY=";
  };
  nativeBuildInputs = [ unzip autoPatchelfHook ];
  buildInputs = [ stdenv.cc.cc.lib ];
  unpackPhase = ''
    unzip -q $src 'nacl_sdk/pepper_37/toolchain/linux_pnacl/*' \
      'nacl_sdk/pepper_37/include/*' 'nacl_sdk/pepper_37/lib/pnacl/*' \
      'nacl_sdk/pepper_37/ports/lib/newlib_pnacl/*' 'nacl_sdk/pepper_37/ports/include/*' \
      'nacl_sdk/pepper_37/tools/sel_ldr_x86_64' 'nacl_sdk/pepper_37/tools/irt_core_x86_64.nexe' \
      -x 'nacl_sdk/pepper_37/toolchain/linux_pnacl/host_x86_32/*'
  '';
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    mkdir -p $out
    cp -r nacl_sdk/pepper_37/. $out/
  '';
  # only the x86-64 host programs are Linux binaries; leave the NaCl libraries alone
  dontAutoPatchelf = true;
  dontStrip = true;
  postFixup = ''
    addAutoPatchelfSearchPath $out/toolchain/linux_pnacl/host_x86_64/lib
    autoPatchelf $out/toolchain/linux_pnacl/host_x86_64 $out/tools/sel_ldr_x86_64
  '';
  meta.platforms = [ "x86_64-linux" ];
}
