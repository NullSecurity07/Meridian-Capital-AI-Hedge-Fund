{ pkgs }: {
  deps = [
    pkgs.nodejs_22   # yahoo-finance2 v3 requires Node >= 22

    # Required by node-gyp to compile better-sqlite3 (native C++ addon)
    pkgs.python3
    pkgs.gnumake
    pkgs.gcc
    pkgs.pkg-config
  ];
}
