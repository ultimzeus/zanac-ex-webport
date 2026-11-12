import json
import os
import sys
import time
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_all_zanac_ex_maps import ZanacExEngine, rom, decode_pal, AREA_STAGE_LIMITS

OUT_MAP_DIR = r'e:\Emul\Zanac_WebPort\assets\maps\640px_ex'
OUT_TILE_DIR = r'e:\Emul\Zanac_WebPort\assets\tiles'
os.makedirs(OUT_MAP_DIR, exist_ok=True)
os.makedirs(OUT_TILE_DIR, exist_ok=True)

# Destructible/interactive object metadata for meta-tiles (mt < 26)
DESTRUCTIBLE_META = {
    2:  {"type": "base_panel",      "destroyed_mt": 21},
    3:  {"type": "mini_core",       "destroyed_mt": 21},
    4:  {"type": "boss_turret",     "destroyed_mt": 21},
    5:  {"type": "boss_plate",      "destroyed_mt": 21},
    6:  {"type": "boss_core",       "destroyed_mt": 21},
    7:  {"type": "block",           "destroyed_mt": 21},
    8:  {"type": "turret_star",     "destroyed_mt": 19},
    9:  {"type": "hidden_item",     "destroyed_mt": 19},
    10: {"type": "idol_item",       "destroyed_mt": 22},
    11: {"type": "idol_warp",       "destroyed_mt": 22},
    12: {"type": "hatch",           "destroyed_mt": 21},
    13: {"type": "wall_corner_tl",  "destroyed_mt": 21},
    14: {"type": "wall_corner_bl",  "destroyed_mt": 21},
    15: {"type": "wall_corner_tr",  "destroyed_mt": 21},
    16: {"type": "wall_corner_br",  "destroyed_mt": 21},
    17: {"type": "turret_round",    "destroyed_mt": 19},
    18: {"type": "wall_edge_left",  "destroyed_mt": 21},
    19: {"type": "wall_edge_right", "destroyed_mt": 21},
    20: {"type": "turret_cannon",   "destroyed_mt": 18},
    23: {"type": "radar_dome",      "destroyed_mt": 21},
    24: {"type": "turret_box",      "destroyed_mt": 19},
    25: {"type": "item_box",        "destroyed_mt": 21},
}

BOSS_SCHEDULE = {
    1: [
        {"row": 220, "timer": 20, "decel": 8,  "name": "Orbital Bunker (Petit Boss)", "is_area_boss": False},
        {"row": 305, "timer": 40, "decel": 8,  "name": "Core Outpost (Mid-Boss)",     "is_area_boss": False},
        {"row": 564, "timer": 40, "decel": 10, "name": "Megabase System (Area Boss)", "is_area_boss": True},
    ],
    2: [
        {"row": 560, "timer": 60, "decel": 8,  "name": "Fortress Core (Area 2 Boss)", "is_area_boss": True},
    ],
    3: [
        {"row": 86,  "timer": 50, "decel": 9,  "name": "Outpost Bunker",              "is_area_boss": False},
        {"row": 505, "timer": 40, "decel": 9,  "name": "Mid-Stage Fortress",          "is_area_boss": False},
        {"row": 600, "timer": 60, "decel": 8,  "name": "Twin Core Bastion",           "is_area_boss": False},
        {"row": 700, "timer": 90, "decel": 9,  "name": "Quad Core Base (Area 3 Boss)", "is_area_boss": True},
    ],
    4: [
        {"row": 495,  "timer": 90, "decel": 14, "name": "Diamond Core Outpost",        "is_area_boss": False},
        {"row": 808,  "timer": 60, "decel": 10, "name": "Fortress Core",               "is_area_boss": False},
        {"row": 1380, "timer": 90, "decel": 13, "name": "Assault Megabase (Area Boss)","is_area_boss": True},
    ],
    5: [
        {"row": 1030, "timer": 90, "decel": 11, "name": "Desert Fortress (Area 5 Boss)","is_area_boss": True},
    ],
    6: [
        {"row": 320,  "timer": 90, "decel": 8,  "name": "Dual Dreadnought Outpost",    "is_area_boss": False},
        {"row": 760,  "timer": 80, "decel": 12, "name": "Titan Core Base (Area 6 Boss)","is_area_boss": True},
    ],
    7: [
        {"row": 750,  "timer": 80, "decel": 13, "name": "Dual Eye Sanctum (Area 7 Boss)","is_area_boss": True},
    ],
    8: [
        {"row": 860,  "timer": 80, "decel": 11, "name": "Subterranean Base (Area Boss)", "is_area_boss": True},
    ],
    9: [
        {"row": 350,  "timer": 90, "decel": 12, "name": "Orbital Station Alpha",       "is_area_boss": False},
        {"row": 650,  "timer": 80, "decel": 8,  "name": "Cruiser Bastion",             "is_area_boss": False},
        {"row": 777,  "timer": 70, "decel": 15, "name": "Satellite Core",              "is_area_boss": False},
        {"row": 1200, "timer": 90, "decel": 10, "name": "Deep Space Outpost",          "is_area_boss": False},
        {"row": 1520, "timer": 90, "decel": 10, "name": "Cosmic Megabase (Area 9 Boss)","is_area_boss": True},
    ],
    10: [
        {"row": 79,   "timer": 60, "decel": 9,  "name": "Outpost Alpha",               "is_area_boss": False},
        {"row": 570,  "timer": 90, "decel": 15, "name": "Dreadnought Beta",            "is_area_boss": False},
        {"row": 1150, "timer": 90, "decel": 11, "name": "Citadel Gamma",               "is_area_boss": False},
        {"row": 1480, "timer": 90, "decel": 14, "name": "Star Fortress (Area 10 Boss)","is_area_boss": True},
    ],
    11: [
        {"row": 530,  "timer": 90, "decel": 14, "name": "Armored Citadel (Area 11 Boss)","is_area_boss": True},
    ],
    12: [
        {"row": 789,  "timer": 90, "decel": 28, "name": "THE SYSTEM (Final Boss)",    "is_area_boss": True},
    ],
}


BGM_MAP = {
    1:  "assets/music/ex_stereo/04 ZANAC 002 Area 1-3.mp3",
    2:  "assets/music/ex_stereo/05 ZANAC 003 Area 2-4.mp3",
    3:  "assets/music/ex_stereo/04 ZANAC 002 Area 1-3.mp3",
    4:  "assets/music/ex_stereo/05 ZANAC 003 Area 2-4.mp3",
    5:  "assets/music/ex_stereo/06 ZANAC 004 Area 5-7-11.mp3",
    6:  "assets/music/ex_stereo/07 ZANAC 005 Area 6-9.mp3",
    7:  "assets/music/ex_stereo/06 ZANAC 004 Area 5-7-11.mp3",
    8:  "assets/music/ex_stereo/08 ZANAC 006 Area 8-10.mp3",
    9:  "assets/music/ex_stereo/07 ZANAC 005 Area 6-9.mp3",
    10: "assets/music/ex_stereo/08 ZANAC 006 Area 8-10.mp3",
    11: "assets/music/ex_stereo/06 ZANAC 004 Area 5-7-11.mp3",
    12: "assets/music/ex_stereo/09 ZANAC 007 Area 12.mp3",
}

def export_area_web(area):
    t0 = time.time()
    b2 = rom[0x04000:0x08000]
    b14 = rom[14 * 0x2000 : 15 * 0x2000]

    engine = ZanacExEngine()
    engine.load_stage(area)

    cbf2 = engine.mem[0xCBF2] | (engine.mem[0xCBF3] << 8)

    def get_st(mt):
        off = (cbf2 - 0x8000) + mt * 5
        return (b2[off], b2[off + 1], b2[off + 2], b2[off + 3])

    st_to_mt = {}
    for mt in list(range(255, 63, -1)) + list(range(25, -1, -1)):
        st_to_mt[get_st(mt)] = mt

    total_rows, r_cmd5 = AREA_STAGE_LIMITS[area]
    orig_rows_mt = []
    pals = []
    item_table_ptr = None

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
        # In MSX Zanac, sequential 10 & 11 in landscape row indicates artifact boundary fix
        for c in range(15):
            if real_mt[c] == 10 and real_mt[c + 1] == 11:
                real_mt[c] = 248

        orig_rows_mt.append(real_mt)
        pals.append(pal)

    # Read item sequence from Bank 2
    item_seq = list(b2[item_table_ptr - 0x8000 : item_table_ptr - 0x8000 + 128]) if item_table_ptr else []
    item_cursor = 0

    grid_mt = []
    under_mt = []
    objects = []

    for r in range(total_rows):
        orig = orig_rows_mt[r]

        # Find clean background tiles in current row to use for margins/replacements
        left_bg = next((mt for mt in orig if mt >= 64), 64)
        right_bg = next((mt for mt in reversed(orig) if mt >= 64), 64)

        row_40 = [0] * 40
        under_40 = [0] * 40

        # Check if current row is inside a boss encounter zone
        is_boss_row = any(abs(r - b["row"]) <= 12 for b in BOSS_SCHEDULE.get(area, []))

        for col in range(40):
            c_rel = col - 12
            c_mod16 = c_rel % 16

            if col < 12:
                # Left margin: wrap terrain naturally, avoiding object tiles & boss structures
                mt_cand = orig[c_mod16]
                base_tile = mt_cand if (mt_cand >= 64 and not is_boss_row) else left_bg
                row_40[col] = base_tile
                under_40[col] = base_tile
            elif col >= 28:
                # Right margin: wrap terrain naturally, avoiding object tiles & boss structures
                mt_cand = orig[c_mod16]
                base_tile = mt_cand if (mt_cand >= 64 and not is_boss_row) else right_bg
                row_40[col] = base_tile
                under_40[col] = base_tile
            else:
                # Central MSX playfield (cols 12..27)
                mt_val = orig[c_rel]
                row_40[col] = mt_val

                if mt_val in DESTRUCTIBLE_META:
                    info = DESTRUCTIBLE_META[mt_val]
                    obj_id = b14[0x1A11 + mt_val]
                    hp = b14[0x1A27 + mt_val]

                    # Find appropriate underlying ground tile for when object is destroyed
                    if c_rel > 0 and orig[c_rel - 1] >= 64:
                        surrounding_bg = orig[c_rel - 1]
                    elif c_rel < 15 and orig[c_rel + 1] >= 64:
                        surrounding_bg = orig[c_rel + 1]
                    else:
                        surrounding_bg = left_bg if c_rel < 8 else right_bg

                    under_40[col] = surrounding_bg if mt_val == 25 else info["destroyed_mt"]

                    # Item drop handling
                    item_drop = None
                    if obj_id in (0x47, 0x52):
                        if item_seq:
                            item_drop = item_seq[item_cursor % len(item_seq)]
                        item_cursor += 1

                    # Warp destination
                    warp_to = (area + 1) if info["type"] == "idol_warp" else None
                    if warp_to is not None and warp_to > 12:
                        warp_to = 12

                    objects.append({
                        "row": r,
                        "col": col,
                        "x": col * 16,
                        "y": (total_rows - 1 - r) * 16,
                        "mt": mt_val,
                        "type": info["type"],
                        "is_smiling": (info["type"] == "idol_warp"),
                        "obj_id": int(obj_id),
                        "hp": 100 if info["type"] in ("idol_warp", "idol_item") else int(hp),
                        "destroyed_mt": under_40[col],
                        "item_drop": item_drop,
                        "warp_to": warp_to,
                    })
                else:
                    under_40[col] = mt_val

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

    tileset_filename = f'area_{area:02d}_tileset.png'
    tileset_path = os.path.join(OUT_TILE_DIR, tileset_filename)
    tileset_img.save(tileset_path)

    # Construct area-specific boss encounters from authentic ROM schedule
    area_bosses = []
    if area in BOSS_SCHEDULE:
        for b_info in BOSS_SCHEDULE[area]:
            r_trig = b_info["row"]
            decel = b_info["decel"]
            targets = []
            for obj in objects:
                if r_trig <= obj["row"] <= r_trig + decel + 25:
                    if obj["mt"] in (3, 6):
                        targets.append({
                            "id": f"core_{obj['row']}_{obj['col']}",
                            "row": obj["row"],
                            "col": obj["col"],
                            "type": obj["type"],
                            "hp": obj["hp"],
                            "isTarget": True
                        })
                    elif obj["mt"] == 4:
                        targets.append({
                            "id": f"turret_{obj['row']}_{obj['col']}",
                            "row": obj["row"],
                            "col": obj["col"],
                            "type": obj["type"],
                            "hp": obj["hp"],
                            "isTarget": False
                        })
            if not targets:
                targets.append({
                    "id": f"target_{r_trig}_center",
                    "row": r_trig + decel,
                    "col": 20,
                    "type": "mini_core",
                    "hp": 60,
                    "isTarget": True
                })
            area_bosses.append({
                "id": f"boss_a{area:02d}_r{r_trig}",
                "name": b_info["name"],
                "type": "area_boss" if b_info["is_area_boss"] else "mid_boss",
                "triggerRow": r_trig,
                "decelSteps": decel,
                "timerSeconds": b_info["timer"],
                "hasTimer": True,
                "bossMusic": b_info["is_area_boss"],
                "bgmTrack": "10 ZANAC 008 Boss.mp3" if b_info["is_area_boss"] else None,
                "bonusScore": 20000 if b_info["is_area_boss"] else 10000,
                "targets": targets
            })

    stage_json = {
        "area": area,
        "width": 40,
        "height": total_rows,
        "tileSize": 16,
        "pixelWidth": 40 * 16,
        "pixelHeight": total_rows * 16,
        "tileset": f"assets/tiles/{tileset_filename}",
        "music": BGM_MAP.get(area, "assets/music/ex_stereo/04 ZANAC 002 Area 1-3.mp3"),
        "bossMusic": "assets/music/ex_stereo/10 ZANAC 008 Boss.mp3",
        "objectsCount": len(objects),
        "objects": objects,
        "bosses": area_bosses,
        "grid_mt": grid_mt,
        "under_mt": under_mt,
    }

    json_filename = f'area_{area:02d}_grid.json'
    json_path = os.path.join(OUT_MAP_DIR, json_filename)
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(stage_json, f, indent=2)

    dt = time.time() - t0
    idols_in_stage = [obj for obj in objects if obj["type"] in ("idol_warp", "idol_item")]
    print(f"[AREA {area:2d}] Exported in {dt:.1f}s -> {json_filename} ({total_rows} rows, {len(objects)} objs, {len(idols_in_stage)} idols)")
    for idl in idols_in_stage:
        print(f"   -> Idol at row {idl['row']}, col {idl['col']}: {idl['type']} (smiling={idl['is_smiling']}, warp_to={idl['warp_to']})")


def export_all():
    print("=== EXPORTING ALL 12 AREAS FOR ZANAC EX WEBPORT ===")
    t_start = time.time()
    for area in range(1, 13):
        if area == 1:
            # For Area 1, keep the meticulously hand-crafted track/bridge alignments from export_area_01_web.py
            print("[AREA  1] Running specialized Area 1 exporter...")
            import export_area_01_web
            export_area_01_web.export_area_01_web()
        else:
            export_area_web(area)
    print(f"\nALL 12 AREAS SUCCESSFULLY EXPORTED in {time.time() - t_start:.1f}s!")


if __name__ == '__main__':
    if len(sys.argv) > 1:
        target = int(sys.argv[1])
        export_area_web(target)
    else:
        export_all()

