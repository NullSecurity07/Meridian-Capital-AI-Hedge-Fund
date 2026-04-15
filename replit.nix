{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.nodePackages.npm

    # Required by node-gyp to compile better-sqlite3 (native C++ addon)
    pkgs.python3
    pkgs.gnumake
    pkgs.gcc
    pkgs.pkg-config
  ];
}
