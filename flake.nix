{
  description = "Jellyfin Lite: Jellyfin client for Samsung Tizen 2.3 TVs";

  # stable branch that still has Python 2 (removed from unstable)
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      lib = nixpkgs.lib;
      pkgs = import nixpkgs {
        inherit system;
        # the PNaCl toolchain's driver scripts are Python 2
        config.allowInsecurePredicate = p: lib.getName p == "python" && lib.versionOlder (lib.getVersion p) "3";
      };

      # files of the app package
      appFiles = [
        "app.js" "config.xml" "i18n.js" "icon.png" "index.html" "logo.png" "style.css"
        "native/dist/tlsproxy_arm.nmf" "native/dist/tlsproxy_arm.nexe"
        "LICENSE" "THIRD_PARTY.md"
      ] ++ map (f: "LICENSES/" + f) (builtins.attrNames (builtins.readDir ./LICENSES));
      files = lib.concatStringsSep " " appFiles;

      sdb = pkgs.callPackage ./nix/sdb.nix { };
      naclSdk = pkgs.callPackage ./nix/nacl-sdk.nix { };
      native = pkgs.callPackage ./nix/native.nix { inherit naclSdk; python2 = pkgs.python27; };
      bookTest = pkgs.callPackage ./nix/book-test.nix { naclMupdfSrc = native.passthru.mupdf.src; };

      # unsigned package, e.g. for signing with Tizen Studio
      wgt = pkgs.runCommand "JellyfinLite.wgt" { nativeBuildInputs = [ pkgs.zip ]; } ''
        cd ${self}
        zip -q -X $out ${files}
      '';

      # apps work on the checkout they are started in
      findRoot = ''
        root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
        [ -f "$root/config.xml" ] || { echo "Run this inside the jellyfin-lite checkout." >&2; exit 1; }
        cd "$root"
      '';

      sign = pkgs.writeShellApplication {
        name = "jellyfin-lite-sign";
        runtimeInputs = with pkgs; [ git nodejs openssl zip xmlsec coreutils ];
        text = ''
          ${findRoot}
          # Samsung author/distributor certificates: certs/author.p12,
          # certs/distributor.p12 and certs/password.txt (or CERT_DIR=...)
          CERT_DIR=''${CERT_DIR:-$root/certs}
          OUT=$root/JellyfinLite-signed.wgt
          for f in author.p12 distributor.p12 password.txt; do
            [ -f "$CERT_DIR/$f" ] || { echo "$CERT_DIR/$f is missing." >&2; exit 1; }
          done

          WORK=$(mktemp -d)
          chmod 700 "$WORK"
          trap 'rm -rf "$WORK"' EXIT
          mkdir "$WORK/pkg" "$WORK/keys"
          for f in ${files}; do mkdir -p "$WORK/pkg/$(dirname "$f")"; cp "$f" "$WORK/pkg/$f"; done

          # .p12 -> key + certificate chain (temporary, private directory)
          extract() {
            openssl pkcs12 -legacy -in "$1" -passin file:"$CERT_DIR/password.txt" -nocerts -nodes 2>/dev/null |
              openssl pkey -out "$WORK/keys/key.pem"
            openssl pkcs12 -legacy -in "$1" -passin file:"$CERT_DIR/password.txt" -nokeys 2>/dev/null > "$WORK/keys/chain.pem"
          }
          # sign only the in-document reference and let xmlsec1 check the result
          selftest() {
            mkdir -p "$WORK/t"
            rm -f "$WORK/t"/*
            node ${./tools/tizen-sign.js} "$WORK/t" "$WORK/keys/key.pem" "$WORK/keys/chain.pem" "$1" >/dev/null
            xmlsec1 --verify --insecure --lax-key-search --id-attr:Id Object "$WORK/t"/*.xml >/dev/null 2>&1 ||
              { echo "The $1 signature failed verification." >&2; exit 1; }
          }

          extract "$CERT_DIR/author.p12"
          selftest author
          node ${./tools/tizen-sign.js} "$WORK/pkg" "$WORK/keys/key.pem" "$WORK/keys/chain.pem" author ${files}
          extract "$CERT_DIR/distributor.p12"
          selftest distributor
          node ${./tools/tizen-sign.js} "$WORK/pkg" "$WORK/keys/key.pem" "$WORK/keys/chain.pem" distributor author-signature.xml ${files}
          rm -rf "$WORK/keys"

          rm -f "$OUT"
          (cd "$WORK/pkg" && zip -q -X "$OUT" author-signature.xml signature1.xml ${files})
          echo "Signed $(basename "$OUT")"
        '';
      };

      install = pkgs.writeShellApplication {
        name = "jellyfin-lite-install";
        runtimeInputs = with pkgs; [ git coreutils gnugrep sdb sign ];
        text = ''
          ${findRoot}
          # usage: nix run .#install -- [TV_IP]   (the last IP is kept in .tv-ip)
          #   NO_LAUNCH=1: install only, LAUNCH_ONLY=1: only start the app
          TV_IP=''${1:-''${TV_IP:-$(cat .tv-ip 2>/dev/null || true)}}
          [ -n "$TV_IP" ] || { echo "Usage: nix run .#install -- <TV_IP>" >&2; exit 2; }
          echo "$TV_IP" > .tv-ip
          TARGET="$TV_IP:26101"
          WGT=JellyfinLite-signed.wgt
          APP_ID=$(grep -o 'tizen:application id="[^"]*"' config.xml | cut -d'"' -f2)

          # re-sign when a packaged file changed
          stale=0
          [ -f "$WGT" ] || stale=1
          for f in ${files}; do [ "$f" -nt "$WGT" ] && stale=1; done
          [ "$stale" = 1 ] && jellyfin-lite-sign

          # a server left running by another sdb version prints warnings on every call
          if sdb devices 2>&1 | grep -q "are different"; then sdb kill-server >/dev/null 2>&1 || true; sleep 1; fi
          sdb start-server >/dev/null 2>&1 || true

          echo "Connecting to $TARGET ..."
          conn=
          for _ in 1 2 3 4 5; do
            conn=$(sdb connect "$TARGET" 2>&1) || true
            echo "$conn" | grep -qiE "connected|already" && break
            sleep 2
          done
          echo "$conn" | grep -qiE "connected|already" ||
            { echo "TV not reachable. Is it on, in developer mode, with this PC's IP as host?" >&2; exit 1; }

          # Tizen 2.x can't do "sdb install": push the package and run the TV's installer
          REMOTE="/opt/usr/apps/tmp/$WGT"
          if [ -z "''${LAUNCH_ONLY:-}" ]; then
            echo "Uploading $WGT ..."
            out=$(sdb -s "$TARGET" push "$WGT" "$REMOTE" 2>&1) || { echo "$out"; exit 1; }
            vd_install() {
              local out
              out=$(sdb -s "$TARGET" shell 0 vd_appinstall "$APP_ID" "$REMOTE" 2>&1) || true
              echo "$out" | grep -v "are different\|compatibility problems\|recommended to use SDB" || true
              ! echo "$out" | grep -qiE "install failed|not found|error"
            }
            echo "Installing as $APP_ID ..."
            if ! vd_install; then
              echo "Install failed; removing the old version and retrying (settings and login are reset) ..."
              sdb -s "$TARGET" shell 0 vd_appuninstall "$APP_ID" >/dev/null 2>&1 || true
              vd_install || { echo "Installation failed." >&2; exit 1; }
            fi
          fi

          # the launch command differs between firmware versions
          if [ -z "''${NO_LAUNCH:-}" ]; then
            echo "Launching ..."
            launched=
            for cmd in was_execute execute debug; do
              out=$(sdb -s "$TARGET" shell 0 "$cmd" "$APP_ID" 2>&1) || true
              if ! echo "$out" | grep -qiE "^closed|failed|error|not (found|supported|allowed)|unknown"; then
                launched=1
                break
              fi
            done
            [ -n "$launched" ] || echo "Could not launch $APP_ID; start it from the TV menu." >&2
          fi
          echo "Done."
        '';
      };

      # build the NaCl module and put it into native/dist (committed)
      buildNative = pkgs.writeShellApplication {
        name = "jellyfin-lite-native";
        runtimeInputs = with pkgs; [ git coreutils ];
        text = ''
          ${findRoot}
          install -m644 ${native}/tlsproxy_arm.nexe ${native}/tlsproxy_arm.nmf native/dist/
          echo "Updated native/dist from ${native}"
        '';
      };

      testBooks = pkgs.writeShellApplication {
        name = "jellyfin-lite-test-books";
        runtimeInputs = [ bookTest ];
        text = ''
          [ $# -gt 0 ] || { echo "Usage: nix run .#test-books -- comic.cbr book.pdf ..." >&2; exit 2; }
          for f in "$@"; do echo "== $f"; book_test "$f"; done
        '';
      };

      app = drv: { type = "app"; program = lib.getExe drv; };
    in
    {
      packages.${system} = {
        default = wgt;
        inherit wgt sdb native;
        nacl-sdk = naclSdk;
        book-test = bookTest;
      };

      apps.${system} = {
        default = app install;
        install = app install;
        sign = app sign;
        native = app buildNative;
        test-books = app testBooks;
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [ sdb sign install buildNative testBooks pkgs.nodejs ];
      };
    };
}
