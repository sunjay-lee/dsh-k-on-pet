#!/usr/bin/env python3
"""Decode K-ON! desktop mascot `.el` sprite archives into PNG.

Reverse-engineered from the original ELSC runtime (0x410780 .. 0x4109a0):
  * header: 'ELSC' + u16 version + u32 length + u32?? ; u16 entry count at 8,
    u32 offset-table offset at 0xa, u32 data base at 0xc
  * each entry: 0x14-byte header
      +0x00 'ELSC'
      +0x02 0x00
      +0x03 info bitset: 1 = horizontal delta, 2 = vertical delta, 4 = palette
      +0x0c u16 width, +0x0e u16 height
      +0x10 u8 bits-per-pixel, +0x11 u8 palette count, +0x12 u8 RLE marker
      +0x14 palette (BGRA) then RLE payload
  * entry 0 = pixels (RGB), entry 1 = alpha (value,count pairs)
  * RLE: literal = 3 raw B,G,R bytes; marker,0xff escapes the marker byte;
    marker,pal,count or (palette count 1) marker,count repeats a palette color
  * delta filters are XOR with the left/upper neighbour.
"""
import argparse, json, struct, sys
from pathlib import Path
from PIL import Image

def u16(d, o): return struct.unpack_from('<H', d, o)[0]
def u32(d, o): return struct.unpack_from('<I', d, o)[0]

def entries(d):
    n = u16(d, 8); tofs = u16(d, 0xa); base = u16(d, 0xc)
    offs = [u32(d, tofs + 4 * i) for i in range(n)]
    return [(base + o, base + offs[k + 1] if k + 1 < len(offs) else len(d))
            for k, o in enumerate(offs)]

def decode_pixels(d, e, end):
    W = u16(d, e + 0xc); H = u16(d, e + 0xe)
    info = d[e + 2]; paln = d[e + 0x11]; marker = d[e + 0x12]
    pal = []
    for k in range(paln):
        b, g, r, _ = d[e + 0x14 + 4 * k:e + 0x14 + 4 * k + 4]
        pal.append((r << 16) | (g << 8) | b)
    i = e + 0x14 + 4 * paln
    buf = [0] * (W * H); row = col = 0
    while i < end and row < H:
        b = d[i]; i += 1
        if b != marker:
            B = b; G = d[i]; R = d[i + 1]; i += 2
            buf[row * W + col] = (R << 16) | (G << 8) | B
            col += 1
            if col >= W: col = 0; row += 1
        else:
            nxt = d[i]; i += 1
            if nxt == 0xff:
                G = d[i]; R = d[i + 1]; i += 2
                buf[row * W + col] = (R << 16) | (G << 8) | marker
                col += 1
                if col >= W: col = 0; row += 1
            else:
                if paln == 1: cnt, pi = nxt, 0
                else: pi, cnt = nxt, d[i]; i += 1
                if cnt == 0: break
                color = pal[pi]; rem = cnt
                while rem:
                    take = min(rem, W - col)
                    for k in range(take): buf[row * W + col + k] = color
                    col += take; rem -= take
                    if col >= W: col = 0; row += 1
                    if row >= H: break
    if info & 1:
        for y in range(H):
            b = y * W
            for x in range(1, W): buf[b + x] ^= buf[b + x - 1]
    if info & 2:
        for y in range(1, H):
            b = y * W; p = b - W
            for x in range(W): buf[b + x] ^= buf[p + x]
    return W, H, buf

def decode_alpha(d, e, end):
    W = u16(d, e + 0xc); H = u16(d, e + 0xe); n = W * H
    i = e + 0x14; out = bytearray()
    while i + 1 < end and len(out) < n:
        v = d[i]; c = d[i + 1]; i += 2
        if c == 0: break
        out.extend(bytes([v]) * c)
    return out[:n]

def decode_el(path):
    d = path.read_bytes(); ents = entries(d)
    W, H, buf = decode_pixels(d, *ents[0]); alpha = decode_alpha(d, *ents[1])
    img = Image.new('RGBA', (W, H)); px = img.load()
    for y in range(H):
        for x in range(W):
            v = buf[y * W + x]; a = alpha[y * W + x] if y * W + x < len(alpha) else 255
            px[x, y] = ((v >> 16) & 255, (v >> 8) & 255, v & 255, a)
    # EL scanlines are stored bottom-up; flip once here so the atlas is upright.
    return img.transpose(Image.FLIP_TOP_BOTTOM)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', type=Path, help='directory containing Mascot*_d folders')
    ap.add_argument('out', type=Path, help='output assets/characters directory')
    args = ap.parse_args()
    names = {'yui': 'yui01.el', 'mio': 'mio01.el', 'ritsu': 'ritsu01.el',
             'tsumugi': 'tsumugi01.el', 'azusa': 'azusa01.el'}
    dirs = {'yui': 'MascotYui_d', 'mio': 'MascotMio_d', 'ritsu': 'MascotRitsu_d',
            'tsumugi': 'MascotTsumugi_d', 'azusa': 'MascotAzusa_d'}
    for key, fn in names.items():
        src = args.src / dirs[key] / fn
        img = decode_el(src)
        dest = args.out / key
        dest.mkdir(parents=True, exist_ok=True)
        img.save(dest / 'sheet.png')
        W, H = img.size
        cells = []
        for y in range(H // 96):
            for x in range(W // 96):
                cell = img.crop((x * 96, y * 96, x * 96 + 96, y * 96 + 96))
                cells.append({'index': y * (W // 96) + x, 'bbox': cell.getbbox()})
        (dest / 'meta.json').write_text(json.dumps(
            {'sheet': {'width': W, 'height': H, 'cell': 96, 'columns': W // 96,
                       'rows': H // 96}, 'cells': cells}, ensure_ascii=False, indent=1))
        print(f'{key}: {W}x{H} -> {dest}')

if __name__ == '__main__':
    main()
