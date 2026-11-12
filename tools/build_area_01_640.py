import os
import sys
import time
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_all_zanac_ex_maps import ZanacExEngine, rom, decode_pal, AREA_STAGE_LIMITS

OUT_DIR = r'e:\Emul\Zanac_WebPort\assets\maps\640px_ex'
os.makedirs(OUT_DIR, exist_ok=True)


def decode_stamp(b2, addr, w, h):
    idx = addr - 0x8000
    rows = []
    for _ in range(h):
        row = [None] * 32
        e = 0
        b_cnt = w
        while b_cnt > 0:
            a = b2[idx]
            if a == 0:
                idx += 1
                e += b2[idx]
                idx += 1
                continue
            idx += 1
            if a == 1:
                break
            if 0 <= e < 32:
                row[e] = a
            e += 1
            b_cnt -= 1
        rows.append(row[:w])
    return rows


def build_area_01_640():
    t0 = time.time()
    engine = ZanacExEngine()
    engine.load_stage(1)

    b2 = rom[0x04000:0x06000]
    cbf2 = engine.mem[0xCBF2] | (engine.mem[0xCBF3] << 8)
    get_st = lambda mt: (
        b2[(cbf2 - 0x8000) + mt * 5],
        b2[(cbf2 - 0x8000) + mt * 5 + 1],
        b2[(cbf2 - 0x8000) + mt * 5 + 2],
        b2[(cbf2 - 0x8000) + mt * 5 + 3],
    )
    st_to_mt = {get_st(mt): mt for mt in range(255, -1, -1)}

    # Pre-decode Track 1 (0x9218, 5 rows x 16 cols) and Track 8 (0x9268, 5 rows x 16 cols)
    track1_rows = [list(b2[0x1218 + r * 16 : 0x1218 + (r + 1) * 16]) for r in range(5)]
    track8_rows = [list(b2[0x1268 + r * 16 : 0x1268 + (r + 1) * 16]) for r in range(5)]

    # Pre-decode 0x98FA (8x15 oval crater)
    crater_8x15 = decode_stamp(b2, 0x98FA, 8, 15)

    # Diagonal cliff stamp 0x829A (4x2)
    diag_even = [238, 218, 210, 221]
    diag_odd  = [232, 216, 211, 234]

    total_rows, r_cmd5 = AREA_STAGE_LIMITS[1]

    orig_rows_mt = []
    orig_rows_sub = []
    pals = []

    for r in range(total_rows):
        if r > r_cmd5:
            engine.mem[0xC0A3] = 0xFF
            engine.mem[0xC0A4] = 0xFF
        engine.call(0x571E)
        top_sub = list(engine.mem[0xCB60 : 0xCB80])
        bot_sub = list(engine.mem[0xCB80 : 0xCBA0])
        pal = decode_pal(bytes(engine.mem[0xCBD0 : 0xCBF0]))
        real_mt = [
            st_to_mt.get((top_sub[2 * c], top_sub[2 * c + 1], bot_sub[2 * c], bot_sub[2 * c + 1]), 64)
            for c in range(16)
        ]
        orig_rows_mt.append(real_mt)
        orig_rows_sub.append((top_sub, bot_sub))
        pals.append(pal)

    expanded_rows_mt = []

    for r in range(total_rows):
        orig = orig_rows_mt[r]

        # Exact Track 1 phase for standard full-width Track 1 zones:
        if r < 8:
            t1_p = r % 5
        elif r < 120:
            t1_p = (r - 22) % 5
        else:
            t1_p = (r - 290) % 5
        t1_row = track1_rows[t1_p]

        row_40 = [0] * 40
        # Center 16 columns (col 12..27) = 100% untouched original hardware output
        for c_rel in range(16):
            row_40[12 + c_rel] = orig[c_rel]

        for col in list(range(0, 12)) + list(range(28, 40)):
            c_rel = col - 12  # -12..-1 on left wing, 16..27 on right wing
            c_mod16 = c_rel % 16

            if 8 <= r <= 21:
                # First full-width horizontal bridge / wall
                row_40[col] = orig[c_mod16]

            elif 98 <= r <= 259:
                # Diagonal shoreline transition from Track 1 to Track 8 (r=98..183) and Track 8 field (r=184..259)
                # Track 8 phase steps +1 mod 5 per row (matches r=160 -> row 0):
                p8 = (r - 160) % 5
                x0 = 15 - (r - 122) // 2
                if c_rel < x0:
                    if r < 120:
                        row_40[col] = track1_rows[(r - 22) % 5][c_mod16]
                    else:
                        # Slot 6 (0x9218, h=2) shifts left with x0(r) (at r=120..121, x_shift=0; at r>=122, x_shift=15-x0):
                        x_shift = 0 if r < 122 else (15 - x0)
                        row_40[col] = track1_rows[r % 2][(c_rel + x_shift) % 16]
                elif x0 <= c_rel < x0 + 4:
                    d_idx = c_rel - x0
                    row_40[col] = diag_even[d_idx] if (r % 2 == 0) else diag_odd[d_idx]
                else:
                    row_40[col] = track8_rows[p8][c_mod16]

            elif 260 <= r <= 289:
                # Second full-width horizontal bridge (with central oval crater at r=270..284, c_rel=4..11)
                if 263 <= r <= 284:
                    row_40[col] = orig[c_rel % 4]
                else:
                    row_40[col] = orig[c_mod16]

            elif 360 <= r <= 398:
                # Rocky blue field (Track 8, steps +1 mod 5 per row)
                p8 = (r - 360) % 5
                row_40[col] = track8_rows[p8][c_mod16]

            elif 399 <= r <= 401 or 554 <= r <= 556:
                # Bottom border of Purple Megabase (399..401) and Boss Fortress (554..556)
                # Align period-6 border pattern with the period-3 vertical purple ribs on both wings:
                if c_rel < 0:
                    row_40[col] = orig[c_rel % 6]
                else:
                    row_40[col] = orig[10 + ((c_rel - 10) % 6)]

            elif 402 <= r <= 499:
                # Purple Megabase:
                is_rib = ((r - 403) % 3 == 0)
                if c_rel < 0:
                    pat = [165, 165, 158] if is_rib else [96, 96, 164]
                    row_40[col] = pat[c_rel % 3]
                else:
                    pat = [158, 165, 165] if is_rib else [164, 96, 96]
                    mt_val = pat[(c_rel - 16) % 3]
                    # Restore the right half of the three 8x15 oval craters (0x98FA) at x=11, 12, 13:
                    for r_start, x_start in [(402, 11), (420, 12), (438, 13)]:
                        if r_start <= r < r_start + 15 and x_start <= c_rel < x_start + 8:
                            c_tile = crater_8x15[r - r_start][c_rel - x_start]
                            if c_tile is not None:
                                mt_val = c_tile
                    row_40[col] = mt_val

            elif 500 <= r <= 549:
                # Left wing (c_rel < 0): continues solid Purple Megabase
                # Right wing (c_rel >= 16): transitions at r=500..503 (using the 6-column arch starting at c_rel=12) into Track 1
                is_rib = ((r - 403) % 3 == 0)
                if c_rel < 0:
                    pat = [165, 165, 158] if is_rib else [96, 96, 164]
                    row_40[col] = pat[c_rel % 3]
                else:
                    if 500 <= r <= 503:
                        right_arches = {
                            500: [208, 164, 96, 96, 164, 210],
                            501: [214, 212, 96, 96, 213, 215],
                            502: [203, 222, 198, 199, 221, 202],
                            503: [127, 203, 224, 226, 226, 226],
                        }
                        row_40[col] = right_arches[r][(c_rel - 12) % 6]
                    else:
                        # r = 504..549: Slot 4 (Track 1) is placed at x = 8, stepping +1 mod 5 per row:
                        p1 = (r - 504) % 5
                        row_40[col] = track1_rows[p1][(c_rel - 8) % 16]

            elif 550 <= r <= 553:
                # Left wing (c_rel < 0): transitions from Purple Megabase into Track 1 (repeating 6-col arch orig[0..5])
                # Right wing (c_rel >= 16): continues Track 1 seamlessly from r=504..549!
                if c_rel < 0:
                    row_40[col] = orig[c_rel % 6]
                else:
                    p1 = (r - 504) % 5
                    row_40[col] = track1_rows[p1][(c_rel - 8) % 16]

            elif 557 <= r <= 573:
                # Boss Fortress:
                if c_rel < 0:
                    row_40[col] = orig[c_rel % 3]
                else:
                    row_40[col] = orig[13 + ((c_rel - 13) % 3)]

            else:
                # All other rows (r=0..7, r=22..97, r=290..359): pure Track 1 on both wings
                row_40[col] = t1_row[c_mod16]

        expanded_rows_mt.append(row_40)

    # Render the 640 x 9184 image
    img_w = 40 * 16  # 640 px
    img_h = total_rows * 16  # 9184 px
    map_img = Image.new('RGB', (img_w, img_h))
    px = map_img.load()

    for r_idx in range(total_rows):
        base_y = (total_rows - 1 - r_idx) * 16
        pal = pals[r_idx]
        row_40 = expanded_rows_mt[r_idx]
        top_sub, bot_sub = orig_rows_sub[r_idx]

        for col in range(40):
            base_x = col * 16
            if 12 <= col < 28:
                c_orig = col - 12
                st0 = top_sub[2 * c_orig]
                st1 = top_sub[2 * c_orig + 1]
                st2 = bot_sub[2 * c_orig]
                st3 = bot_sub[2 * c_orig + 1]
            else:
                st0, st1, st2, st3 = get_st(row_40[col])

            for st_id, ox, oy in [(st0, 0, 0), (st1, 8, 0), (st2, 0, 8), (st3, 8, 8)]:
                nibs = engine.subtiles[st_id]
                for py in range(8):
                    for px_i in range(8):
                        px[base_x + ox + px_i, base_y + oy + py] = pal[nibs[py * 8 + px_i]]

    out_path = os.path.join(OUT_DIR, 'area_01_640.png')
    map_img.save(out_path)
    print(f"Saved 640px Area 1 map to {out_path} ({img_w}x{img_h}) in {time.time() - t0:.1f}s")

    # Save 1:1 verification crops of key sections for visual inspection
    crops = [
        ('crop_1_boss_and_megabase_top.png', 495, 574),
        ('crop_2_megabase_craters.png', 395, 495),
        ('crop_3_mini_fortress_and_bridge2.png', 255, 365),
        ('crop_4_diagonal_river.png', 95, 190),
        ('crop_5_start_bridge1.png', 0, 45),
    ]
    for name, r_lo, r_hi in crops:
        y_top = (total_rows - r_hi) * 16
        y_bot = (total_rows - r_lo) * 16
        c_img = map_img.crop((0, y_top, img_w, y_bot))
        c_img.save(os.path.join(OUT_DIR, name))


if __name__ == '__main__':
    build_area_01_640()
