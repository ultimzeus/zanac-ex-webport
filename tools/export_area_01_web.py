import json
import os
import sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_all_zanac_ex_maps import ZanacExEngine, rom, decode_pal, AREA_STAGE_LIMITS
from build_area_01_640 import decode_stamp

OUT_MAP_DIR = r'e:\Emul\Zanac_WebPort\assets\maps\640px_ex'
OUT_TILE_DIR = r'e:\Emul\Zanac_WebPort\assets\tiles'
os.makedirs(OUT_MAP_DIR, exist_ok=True)
os.makedirs(OUT_TILE_DIR, exist_ok=True)

# Object metadata for destructible meta-tiles (mt = 2..25)
DESTRUCTIBLE_META = {
    2:  {"type": "base_panel",    "destroyed_mt": 21},
    3:  {"type": "mini_core",     "destroyed_mt": 21},
    4:  {"type": "boss_turret",   "destroyed_mt": 21},
    5:  {"type": "boss_plate",    "destroyed_mt": 21},
    6:  {"type": "boss_core",     "destroyed_mt": 21},
    7:  {"type": "block",         "destroyed_mt": 21},
    8:  {"type": "turret_star",   "destroyed_mt": 19},
    9:  {"type": "hidden_item",   "destroyed_mt": 19},
    10: {"type": "idol_item",     "destroyed_mt": 22},
    11: {"type": "idol_warp",     "destroyed_mt": 22},
    12: {"type": "hatch",         "destroyed_mt": 21},
    17: {"type": "turret_round",  "destroyed_mt": 19},
    20: {"type": "turret_cannon", "destroyed_mt": 18},
    23: {"type": "radar_dome",    "destroyed_mt": 21},
    24: {"type": "turret_box",    "destroyed_mt": 19},
    25: {"type": "item_box",      "destroyed_mt": 21},
}


def export_area_01_web():
    engine = ZanacExEngine()
    engine.load_stage(1)

    b2 = rom[0x04000:0x08000]
    b14 = rom[14 * 0x2000 : 15 * 0x2000]
    cbf2 = engine.mem[0xCBF2] | (engine.mem[0xCBF3] << 8)

    def get_st(mt):
        off = (cbf2 - 0x8000) + mt * 5
        return (b2[off], b2[off + 1], b2[off + 2], b2[off + 3])

    # Map subtile 4-tuple back to valid meta-tile IDs (0..25 and 64..255)
    st_to_mt = {}
    for mt in list(range(255, 63, -1)) + list(range(25, -1, -1)):
        st_to_mt[get_st(mt)] = mt

    track1_rows = [list(b2[0x1218 + r * 16 : 0x1218 + (r + 1) * 16]) for r in range(5)]
    track8_rows = [list(b2[0x1268 + r * 16 : 0x1268 + (r + 1) * 16]) for r in range(5)]
    crater_8x15 = decode_stamp(b2, 0x98FA, 8, 15)
    diag_even = [238, 218, 210, 221]
    diag_odd  = [232, 216, 211, 234]

    total_rows, r_cmd5 = AREA_STAGE_LIMITS[1]
    orig_rows_mt = []
    pals = []

    for r in range(total_rows):
        if r > r_cmd5:
            engine.mem[0xC0A3] = 0xFF
            engine.mem[0xC0A4] = 0xFF
        engine.call(0x571E)
        if r == 0:
            item_table_ptr = engine.mem[0xC0A0] | (engine.mem[0xC0A1] << 8)
        top_sub = list(engine.mem[0xCB60 : 0xCB80])
        bot_sub = list(engine.mem[0xCB80 : 0xCBA0])
        pal = decode_pal(bytes(engine.mem[0xCBD0 : 0xCBF0]))
        real_mt = [
            st_to_mt.get((top_sub[2 * c], top_sub[2 * c + 1], bot_sub[2 * c], bot_sub[2 * c + 1]), 64)
            for c in range(16)
        ]
        for c in range(15):
            if real_mt[c] == 10 and real_mt[c + 1] == 11:
                real_mt[c] = 248
        orig_rows_mt.append(real_mt)
        pals.append(pal)

    # Read Area 1 item drop sequence from (0xC0A0) = 0xA6B1
    item_seq = list(b2[item_table_ptr - 0x8000 : item_table_ptr - 0x8000 + 64])
    item_cursor = 0

    grid_mt = []
    under_mt = []
    objects = []

    for r in range(total_rows):
        orig = orig_rows_mt[r]
        if r < 8:
            t1_p = r % 5
        elif r < 120:
            t1_p = (r - 22) % 5
        else:
            t1_p = (r - 290) % 5
        t1_row = track1_rows[t1_p]

        row_40 = [0] * 40
        under_40 = [0] * 40

        for col in range(40):
            c_rel = col - 12
            c_mod16 = c_rel % 16

            # Determine base terrain tile (without 1x1 turrets/item boxes) at (r, col):
            if 8 <= r <= 21:
                base_tile = orig[c_mod16]
            elif 98 <= r <= 259:
                p8 = (r - 160) % 5
                x0 = 15 - (r - 122) // 2
                if c_rel < x0:
                    if r < 120:
                        base_tile = track1_rows[(r - 22) % 5][c_mod16]
                    else:
                        x_shift = 0 if r < 122 else (15 - x0)
                        base_tile = track1_rows[r % 2][(c_rel + x_shift) % 16]
                elif x0 <= c_rel < x0 + 4:
                    d_idx = c_rel - x0
                    base_tile = diag_even[d_idx] if (r % 2 == 0) else diag_odd[d_idx]
                else:
                    base_tile = track8_rows[p8][c_mod16]
            elif 260 <= r <= 289:
                if 263 <= r <= 284:
                    base_tile = orig[c_rel % 4]
                else:
                    base_tile = orig[c_mod16]
            elif 360 <= r <= 398:
                p8 = (r - 360) % 5
                base_tile = track8_rows[p8][c_mod16]
            elif 399 <= r <= 401 or 554 <= r <= 556:
                base_tile = orig[c_rel % 6] if c_rel < 0 else orig[10 + ((c_rel - 10) % 6)]
            elif 402 <= r <= 499:
                is_rib = ((r - 403) % 3 == 0)
                if c_rel < 0:
                    pat = [165, 165, 158] if is_rib else [96, 96, 164]
                    base_tile = pat[c_rel % 3]
                else:
                    pat = [158, 165, 165] if is_rib else [164, 96, 96]
                    base_tile = pat[(c_rel - 16) % 3]
                    for r_start, x_start in [(402, 11), (420, 12), (438, 13)]:
                        if r_start <= r < r_start + 15 and x_start <= c_rel < x_start + 8:
                            c_tile = crater_8x15[r - r_start][c_rel - x_start]
                            if c_tile is not None:
                                base_tile = c_tile
            elif 500 <= r <= 549:
                is_rib = ((r - 403) % 3 == 0)
                if c_rel < 0:
                    pat = [165, 165, 158] if is_rib else [96, 96, 164]
                    base_tile = pat[c_rel % 3]
                else:
                    if 500 <= r <= 503:
                        right_arches = {
                            500: [208, 164, 96, 96, 164, 210],
                            501: [214, 212, 96, 96, 213, 215],
                            502: [203, 222, 198, 199, 221, 202],
                            503: [127, 203, 224, 226, 226, 226],
                        }
                        base_tile = right_arches[r][(c_rel - 12) % 6]
                    else:
                        p1 = (r - 504) % 5
                        base_tile = track1_rows[p1][(c_rel - 8) % 16]
            elif 550 <= r <= 553:
                if c_rel < 0:
                    base_tile = orig[c_rel % 6]
                else:
                    p1 = (r - 504) % 5
                    base_tile = track1_rows[p1][(c_rel - 8) % 16]
            elif 557 <= r <= 573:
                base_tile = orig[c_rel % 3] if c_rel < 0 else orig[13 + ((c_rel - 13) % 3)]
            else:
                base_tile = t1_row[c_mod16]

            if 12 <= col < 28:
                mt_val = orig[c_rel]
                row_40[col] = mt_val
                if mt_val in DESTRUCTIBLE_META:
                    info = DESTRUCTIBLE_META[mt_val]
                    obj_id = b14[0x1A11 + mt_val]
                    hp = b14[0x1A27 + mt_val]
                    # For item boxes (mt=25) on open terrain, replace with underlying base_tile or crater (21)
                    under_40[col] = base_tile if mt_val == 25 else info["destroyed_mt"]
                    item_drop = None
                    if obj_id in (0x47, 0x52):
                        item_drop = item_seq[item_cursor]
                        item_cursor += 1
                    warp_to = 2 if info["type"] == "idol_warp" else None
                    objects.append({
                        "row": r,
                        "col": col,
                        "x": col * 16,
                        "y": (total_rows - 1 - r) * 16,
                        "mt": mt_val,
                        "type": info["type"],
                        "is_smiling": (info["type"] == "idol_warp"),
                        "obj_id": obj_id,
                        "hp": hp,
                        "destroyed_mt": under_40[col],
                        "item_drop": item_drop,
                        "warp_to": warp_to,
                    })
                else:
                    under_40[col] = mt_val
            else:
                row_40[col] = base_tile
                under_40[col] = base_tile

        grid_mt.append(row_40)
        under_mt.append(under_40)

    # Render clean 256x256 tileset PNG (16x16 grid of 16x16 meta-tiles)
    pal = pals[0]
    tileset_img = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    px = tileset_img.load()
    for mt in list(range(0, 26)) + list(range(64, 256)):
        gx = (mt % 16) * 16
        gy = (mt // 16) * 16
        st0, st1, st2, st3 = get_st(mt)
        for st_id, ox, oy in [(st0, 0, 0), (st1, 8, 0), (st2, 0, 8), (st3, 8, 8)]:
            nibs = engine.subtiles[st_id]
            for py in range(8):
                for px_i in range(8):
                    r_c, g_c, b_c = pal[nibs[py * 8 + px_i]]
                    px[gx + ox + px_i, gy + oy + py] = (r_c, g_c, b_c, 255)

    tileset_path = os.path.join(OUT_TILE_DIR, 'area_01_tileset.png')
    tileset_img.save(tileset_path)

    # Embed Area 1 authentic bosses from boss_encounters.json
    bosses_area1 = []
    try:
        with open(r'e:\Emul\Zanac_WebPort\src\data\boss_encounters.json', 'r', encoding='utf-8') as bf:
            bosses_area1 = json.load(bf).get("bosses", [])
    except Exception as ex:
        pass

    stage_json = {
        "area": 1,
        "width": 40,
        "height": total_rows,
        "tileSize": 16,
        "pixelWidth": 40 * 16,
        "pixelHeight": total_rows * 16,
        "tileset": "assets/tiles/area_01_tileset.png",
        "music": "assets/music/ex_stereo/04 ZANAC 002 Area 1-3.mp3",
        "bossMusic": "assets/music/ex_stereo/10 ZANAC 008 Boss.mp3",
        "objectsCount": len(objects),
        "objects": objects,
        "bosses": bosses_area1,
        "grid_mt": grid_mt,
        "under_mt": under_mt,
    }
    json_path = os.path.join(OUT_MAP_DIR, 'area_01_grid.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(stage_json, f, indent=2)

    print(f"Exported Area 1 Tileset: {tileset_path} (256x256)")
    print(f"Exported Area 1 Grid JSON: {json_path} ({len(objects)} interactive objects, {item_cursor} item drops)")
    for obj in objects:
        print(f"  r={obj['row']:3d} col={obj['col']:2d} mt={obj['mt']:2d} ({obj['type']:13s}) hp={obj['hp']:2d} drop={obj['item_drop']}")


if __name__ == '__main__':
    export_area_01_web()
