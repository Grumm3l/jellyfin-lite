# Installation

Samsung TVs only install apps that are signed with two certificates: an
author certificate (who made the app) and a distributor certificate that
names the TV it may be installed on. Both are free and are created with
Tizen Studio and a Samsung account.

## 1. Developer mode on the TV

1. Find the IP address of your PC.
2. On the TV open Smart Hub → **Apps**.
3. Press **1 2 3 4 5** on the TV remote. The Developer Mode window opens.
4. Switch **Developer mode** to **On**, enter the PC's IP and confirm.
5. Restart the TV (switch it off and on again).

Also note the TV's IP address (Menu → Network → Network Status).

## 2. Certificates

1. Install [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download).
2. In the Package Manager, under **Extension SDK**, install
   **Samsung Certificate Extension**.
3. Connect the TV: Tools → **Device Manager** → Remote Device Manager →
   **+**, enter the TV's IP (port `26101`) and switch the connection on.
   The Certificate Manager needs this to read the TV's DUID.
4. Open Tools → **Certificate Manager** → **+** → **Samsung** → **TV**.
5. Enter a profile name, then create a new **author certificate** (any name
   and a password). You sign in with your Samsung account here.
6. Create a new **distributor certificate** with privilege **Public**. The
   connected TV's DUID is filled in; add more DUIDs for more TVs. Use the
   same password as for the author certificate.

The files are in `~/SamsungCertificate/<profile>/`. Copy them into the
checkout:

| File | Content |
| --- | --- |
| `certs/author.p12` | author certificate |
| `certs/distributor.p12` | distributor certificate |
| `certs/password.txt` | the password (one line) |

`certs/` is ignored by git.

## 3. Install

With [Nix](https://nixos.org) (flakes enabled), from the checkout:

```bash
nix run . -- 192.168.1.50   # IP of the TV; it is remembered in .tv-ip
nix run .                   # next time
```

This signs the app, uploads it with `sdb` and starts it.

Without Nix, use the package from the
[releases](https://github.com/Grumm3l/jellyfin-lite/releases) and the tools
of Tizen Studio (`tizen` and `sdb`, in `~/tizen-studio/tools`):

```bash
tizen package -t wgt -s <profile> -- JellyfinLite-0.12.0.wgt
sdb connect 192.168.1.50:26101
sdb -s 192.168.1.50:26101 push JellyfinLite-0.12.0.wgt /opt/usr/apps/tmp/JellyfinLite.wgt
sdb -s 192.168.1.50:26101 shell 0 vd_appinstall JfLite2026.JellyfinLite /opt/usr/apps/tmp/JellyfinLite.wgt
```

`sdb install` does not work on Tizen 2.3; the app then appears under Apps.

## 4. First start

The app asks for the server address, e.g. `jellyfin.example.com` or
`http://192.168.1.10:8096`, and optionally the Seerr address.

## Note: IPv6

IPv6 is switched off by default on these TVs. If your server is only
reachable over IPv6, turn it on in the service menu: **Option → Engineer
Options → IPv6 Support → On**.

To open the service menu, put the TV in standby and press on the TV remote:

- European models: **Info, Menu, Mute, Power**
- American models: **Mute, 1, 8, 2, Power**

Don't change anything else there; wrong settings can break the TV.
