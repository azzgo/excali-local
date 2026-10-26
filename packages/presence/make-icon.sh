#!/usr/bin/env bash
# Generate Contents/Resources/AppIcon.icns for `Excali Presence.app`.
#
# The glyph is the same whiteboard + pen geometry as `tray_icon()` in
# src/main.rs, scaled to each iconset size and drawn in white on the UI's
# indigo (#4c6ef5) rounded rect — colored, unlike the template tray icon.
# PNGs are emitted by inline Python (zlib only, no new build deps); the icns
# is packed by `iconutil`, so no hand-rolled binary.
#
# Usage: make-icon.sh <output.icns>
set -euo pipefail

OUT="${1:?usage: make-icon.sh <output.icns>}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"

python3 - "$ICONSET" <<'PY'
import math, struct, sys, zlib

outdir = sys.argv[1]

SIZES = [16, 32, 64, 128, 256, 512, 1024]
BG = (0x4c, 0x6e, 0xf5)
FG = (0xff, 0xff, 0xff)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))


def write_png(path, size, rgba):
    raw = b"".join(
        b"\x00" + bytes(rgba[y * size * 4:(y + 1) * size * 4]) for y in range(size)
    )
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def draw(size):
    f = size / 64.0

    def s(v):
        return int(round(v * f))

    t = max(1, s(5))          # stroke weight, mirrors `const T: i32 = 5`
    small = max(1, s(4))      # the 4px details (inner bars, legs, pen width)

    px = bytearray(size * size * 4)
    # Rounded-rect background inset like a macOS app icon.
    inset = s(2)
    radius = s(14)
    for y in range(size):
        for x in range(size):
            if x < inset or y < inset or x >= size - inset or y >= size - inset:
                continue
            cx = max(inset + radius - x, x - (size - inset - 1 - radius), 0)
            cy = max(inset + radius - y, y - (size - inset - 1 - radius), 0)
            if math.hypot(cx, cy) > radius:
                continue
            o = (y * size + x) * 4
            px[o:o + 4] = bytes(BG + (255,))

    def put(x, y):
        if 0 <= x < size and 0 <= y < size:
            o = (y * size + x) * 4
            px[o:o + 4] = bytes(FG + (255,))

    def bar_h(x0, x1, y, t):
        for dy in range(t):
            for x in range(x0, x1 + 1):
                put(x, y + dy)

    def bar_v(x, y0, y1, t):
        for dx in range(t):
            for y in range(y0, y1 + 1):
                put(x + dx, y)

    # Same coordinates as tray_icon(), passed through s().
    bx, by, bw, bh = s(4), s(8), s(40), s(34)
    bar_h(bx, bx + bw, by, t)
    bar_h(bx, bx + bw, by + bh, t)
    bar_v(bx, by, by + bh, t)
    bar_v(bx + bw, by, by + bh, t)

    bar_h(bx + t + s(4), bx + t + s(18), by + t + s(6), small)
    bar_h(bx + t + s(4), bx + t + s(12), by + t + s(14), small)

    bar_v(bx + s(40) // 2 - s(8), by + bh + t, by + bh + t + s(6), small)
    bar_v(bx + s(40) // 2 + s(5), by + bh + t, by + bh + t + s(6), small)

    for i in range(s(22)):
        x = s(26) + i
        y = s(40) - i
        for w in range(max(2, s(6))):
            put(x + w, y)
            put(x, y - w)
    for i in range(s(6)):
        for j in range(s(6)):
            if i + j <= max(2, s(7)):
                put(s(47) + i, s(17) + j)

    return px


for size in SIZES:
    write_png(f"{outdir}/icon_{size}x{size}.png", size, draw(size))
    big = size * 2
    write_png(f"{outdir}/icon_{size}x{size}@2x.png", big, draw(big))
PY

iconutil -c icns -o "$OUT" "$ICONSET"
echo "[make-icon] ✓ $OUT"
