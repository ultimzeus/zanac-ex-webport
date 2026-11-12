import os
import json
from PIL import Image, ImageDraw

ROM_PATH = r'e:\Emul\Zanac_WebPort\assets\roms\Zanac-Ex (1986) Compile [Hack] [10170].rom'
OUT_DIR = r'e:\Emul\Zanac_WebPort\assets\sprites\original_1x'
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.join(OUT_DIR, 'individual'), exist_ok=True)

with open(ROM_PATH, 'rb') as f:
    rom = f.read()

b45 = rom[0x08000:0x0C000]    # Bank 4 & 5 mapped at 0x8000..0xBFFF
b1213 = rom[0x18000:0x1C000]  # Bank 12 & 13 mapped at 0x8000..0xBFFF

# Exact Area 1 / Sprite V9938 16-color palette (RGBA; index 0 is transparent (0,0,0,0) for sprites)
PALETTE_RGBA = [
    (  0,   0,   0,   0),  # 0: Transparent
    (255,  36,   0, 255),  # 1: Bright Red (#FF2400)
    (  0, 255,   0, 255),  # 2: Bright Green (#00FF00)
    (  0,  36,   0, 255),  # 3: Dark Shadow / Outline (#002400)
    (255, 109,  36, 255),  # 4: Bright Orange (#FF6D24)
    ( 36, 182, 255, 255),  # 5: Sky Blue (#24B6FF)
    (255, 218,   0, 255),  # 6: Golden Yellow (#FFDA00)
    (255, 255, 255, 255),  # 7: Pure White (#FFFFFF)
    (145,  36,   0, 255),  # 8: Dark Red (#912400)
    (  0, 218, 255, 255),  # 9: Cyan (#00DAFF)
    ( 36,  36, 145, 255),  # 10: Navy Blue (#242491)
    ( 36,   0, 218, 255),  # 11: Royal Blue (#2400DA)
    (  0, 145,   0, 255),  # 12: Medium Green (#009100)
    ( 16,  16,  24, 255),  # 13: Near-Black (for black orb visibility)
    (145,  36, 145, 255),  # 14: Purple (#912491)
    (218,  72, 255, 255),  # 15: Magenta (#DA48FF)
]

# Build the 48-entry Sprite Color Table (0xCD00..0xCFFF), 16 scanlines each:
# 0x00..0x0F: solid color 0..15
# 0x10..0x1F: solid color 0..15 with CC bit (0x40)
# 0x20..0x2F: copied from Bank 12 0x863D..0x873C
SCT_TABLE = []
for c in range(16):
    SCT_TABLE.append([c] * 16)
for c in range(16):
    SCT_TABLE.append([0x40 | c] * 16)
for c in range(16):
    off = 0x063D + c * 16
    SCT_TABLE.append(list(b1213[off : off + 16]))


def decode_16x16_bits(raw32):
    grid = [[0] * 16 for _ in range(16)]
    for y in range(16):
        b_left = raw32[y]
        b_right = raw32[16 + y]
        for x in range(8):
            grid[y][x] = (b_left >> (7 - x)) & 1
            grid[y][8 + x] = (b_right >> (7 - x)) & 1
    return grid


# 1. Common animated sprites s5..s55 across 4 frames (0x828A..0x9C09)
common_frames = [{}, {}, {}, {}]
for f_idx, rom_base in enumerate([0x828A, 0x88EA, 0x8F4A, 0x95AA]):
    for s_slot in range(5, 56):
        off = (rom_base - 0x8000) + (s_slot - 5) * 32
        common_frames[f_idx][s_slot] = decode_16x16_bits(b45[off : off + 32])

# 2. Stage / Giant Enemy sets 0..5 (0x9C0A..0xB409)
stage_sets = []
for set_idx in range(6):
    set_base = (0x9C0A - 0x8000) + set_idx * 1024
    frames_dict = [{}, {}, {}, {}]
    for f_idx in range(4):
        for k in range(8):
            s_slot = 56 + k
            off = set_base + f_idx * 256 + k * 32
            frames_dict[f_idx][s_slot] = decode_16x16_bits(b45[off : off + 32])
    stage_sets.append(frames_dict)

# 3. Weapon / Shield / Shot sprites (0xB40A..0xB609 = 16 sprites, indices 0..15)
weapon_raw_sprites = []
for idx in range(16):
    off = (0xB40A - 0x8000) + idx * 32
    weapon_raw_sprites.append(decode_16x16_bits(b45[off : off + 32]))

# 4. Player Ship & Death Explosion sprites (0xB60A..0xB809 = 8 pairs of (s0, s1))
ship_pairs = []
for pair_idx in range(8):
    off = (0xB60A - 0x8000) + pair_idx * 64
    s0 = decode_16x16_bits(b45[off : off + 32])
    s1 = decode_16x16_bits(b45[off + 32 : off + 64])
    ship_pairs.append((s0, s1))


def render_v9938_metasprite(sprites_list, canvas_w, canvas_h, center_x, center_y, default_col=5):
    color_buf = [[0] * canvas_w for _ in range(canvas_h)]
    i = 0
    while i < len(sprites_list):
        dy, dx, grid, col_idx = sprites_list[i]
        eff_col = default_col if col_idx == 0 else col_idx
        sct_main = SCT_TABLE[eff_col & 0x3F]

        group = [(dy, dx, grid, sct_main)]
        j = i + 1
        while j < len(sprites_list):
            dy2, dx2, grid2, col_idx2 = sprites_list[j]
            eff_col2 = default_col if col_idx2 == 0 else col_idx2
            sct2 = SCT_TABLE[eff_col2 & 0x3F]
            if any(c & 0x40 for c in sct2):
                group.append((dy2, dx2, grid2, sct2))
                j += 1
            else:
                break

        grp_buf = [[0] * canvas_w for _ in range(canvas_h)]
        for g_dy, g_dx, g_grid, g_sct in group:
            ox = center_x + g_dx
            oy = center_y + g_dy
            for sy in range(16):
                py = oy + sy
                if 0 <= py < canvas_h:
                    line_col = g_sct[sy] & 0x0F
                    if line_col != 0:
                        for sx in range(16):
                            if g_grid[sy][sx]:
                                px = ox + sx
                                if 0 <= px < canvas_w:
                                    grp_buf[py][px] |= line_col

        for py in range(canvas_h):
            for px in range(canvas_w):
                if color_buf[py][px] == 0 and grp_buf[py][px] != 0:
                    color_buf[py][px] = grp_buf[py][px]

        i = j

    img = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    px = img.load()
    for py in range(canvas_h):
        for px_i in range(canvas_w):
            c = color_buf[py][px_i]
            if c != 0:
                px[px_i, py] = PALETTE_RGBA[c & 0x0F]
    return img


def save_with_dark_preview(sheet_rgba, filename, cell_w, cell_h):
    """Save both the transparent RGBA PNG and a dark-background preview PNG so white pixels are 100% visible."""
    out_rgba = os.path.join(OUT_DIR, filename)
    sheet_rgba.save(out_rgba)

    w, h = sheet_rgba.size
    prev = Image.new('RGBA', (w, h), (12, 12, 22, 255))
    draw = ImageDraw.Draw(prev)
    for x in range(0, w, cell_w):
        draw.line([(x, 0), (x, h)], fill=(28, 28, 44, 255))
    for y in range(0, h, cell_h):
        draw.line([(0, y), (w, y)], fill=(28, 28, 44, 255))
    prev.alpha_composite(sheet_rgba)
    prev_name = filename.replace('.png', '_preview_dark.png')
    prev.convert('RGB').save(os.path.join(OUT_DIR, prev_name))


# Decode all 68 Meta-Sprites from 0x86DD in Bank 12 (1-indexed: MS #1..#68)
meta_sprites_def = {}
for ms_id in range(1, 69):
    off_ptr = 0x6DB + ms_id * 2
    p = b1213[off_ptr] | (b1213[off_ptr + 1] << 8)
    off = p - 0x8000
    cnt = b1213[off]
    entries = []
    for k in range(cnt):
        dy = b1213[off + 1 + k * 4]
        dx = b1213[off + 2 + k * 4]
        dy_s = dy - 256 if dy >= 128 else dy
        dx_s = dx - 256 if dx >= 128 else dx
        pat = b1213[off + 3 + k * 4]
        col = b1213[off + 4 + k * 4]
        entries.append({'dy': dy_s, 'dx': dx_s, 'slot': pat // 4, 'col': col})
    meta_sprites_def[ms_id] = entries


def build_player_ship_sheet():
    """Sheet 1: AFX-6502 Zanac Fighter + Wing Shields + 7-Frame Ship Death Explosion"""
    cell_w, cell_h = 32, 24
    cols, rows = 8, 3
    sheet = Image.new('RGBA', (cols * cell_w, rows * cell_h), (0, 0, 0, 0))

    # Row 0: Col 0 = Player Ship (pair 0), Cols 1..7 = 7-frame Player Ship Disintegration/Death Explosion (pairs 1..7)
    for idx, (s0, s1) in enumerate(ship_pairs):
        sp_list = [(-8, -8, s0, 0x05), (-8, -8, s1, 0x13)]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=5)
        sheet.paste(im, (idx * cell_w, 0))
        name = 'player_ship_main.png' if idx == 0 else f'player_death_exp_f{idx - 1}.png'
        im.save(os.path.join(OUT_DIR, 'individual', name))

    # Row 1: Cols 0..3 = Ship with Wing Shield pods (w_idx 0..3), Cols 4..7 = Standalone Wing Shield pods
    for w_idx in range(4):
        s0, s1 = ship_pairs[0]
        s4 = weapon_raw_sprites[w_idx]
        sp_list = [
            (-8, -8, s0, 0x05),
            (-8, -8, s1, 0x13),
            (-8, -18, s4, 0x07),
            (-8, +2, s4, 0x07),
        ]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=5)
        sheet.paste(im, (w_idx * cell_w, cell_h))
        im.save(os.path.join(OUT_DIR, 'individual', f'player_ship_shield_{w_idx}.png'))

        sp_pod = [(-8, -8, s4, 0x07)]
        im_pod = render_v9938_metasprite(sp_pod, 16, 16, 8, 8, default_col=7)
        sheet.paste(im_pod, ((4 + w_idx) * cell_w + 8, cell_h + 4))
        im_pod.save(os.path.join(OUT_DIR, 'individual', f'wing_pod_{w_idx}.png'))

    # Row 2: Invincibility / Power-up color flash variants (colors 1..7)
    for c_idx in range(1, 8):
        s0, s1 = ship_pairs[0]
        sp_list = [(-8, -8, s0, c_idx), (-8, -8, s1, 0x13)]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=c_idx)
        sheet.paste(im, ((c_idx - 1) * cell_w, 2 * cell_h))

    save_with_dark_preview(sheet, 'player_ship_sheet.png', cell_w, cell_h)
    return sheet


def build_weapons_sheet():
    """Sheet 2: Normal Shots (Single/Double/Triple x 4 frames) + All 8 Sub-Weapons (#0..#7)"""
    cell_w, cell_h = 32, 32
    cols, rows = 12, 3
    sheet = Image.new('RGBA', (cols * cell_w, rows * cell_h), (0, 0, 0, 0))

    # Row 0: Normal Shots (Tier 0 Single = MS #14, Tier 1 Double = MS #15, Tier 2 Triple = MS #16) x 4 frames
    for lvl_idx, ms_id in enumerate([14, 15, 16]):
        for f_idx in range(4):
            sp_list = [
                (e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col'])
                for e in meta_sprites_def[ms_id]
            ]
            im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=0x21)
            col_pos = lvl_idx * 4 + f_idx
            sheet.paste(im, (col_pos * cell_w, 0))
            im.save(os.path.join(OUT_DIR, 'individual', f'normal_shot_tier{lvl_idx}_f{f_idx}.png'))

    # Row 1:
    # - Cols 0..3: s2 4-frame animation (weapon_raw_sprites[8, 10, 12, 14] in White 0x07: Fire #0/#3/#4)
    # - Cols 4..7: s3 4-frame animation (weapon_raw_sprites[9, 11, 13, 15] in White 0x07: Fire #1/#5/#7)
    # - Cols 8..9: Giant 32x16 Wave (MS #41: weapon_raw_sprites[4+5] Frame 0, weapon_raw_sprites[6+7] Frame 1)
    # - Cols 10..11: Plasma Flash (Fire #6, MS #8 s21+s20 in Sky Blue 5 & White 7)
    for f_idx, raw_i in enumerate([8, 10, 12, 14]):
        sp_list = [(-8, -8, weapon_raw_sprites[raw_i], 0x07)]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=7)
        sheet.paste(im, (f_idx * cell_w, cell_h))
        im.save(os.path.join(OUT_DIR, 'individual', f'subweapon_orb_s2_f{f_idx}.png'))

    for f_idx, raw_i in enumerate([9, 11, 13, 15]):
        sp_list = [(-8, -8, weapon_raw_sprites[raw_i], 0x07)]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=7)
        sheet.paste(im, ((4 + f_idx) * cell_w, cell_h))
        im.save(os.path.join(OUT_DIR, 'individual', f'subweapon_blade_s3_f{f_idx}.png'))

    for f_idx, base_i in enumerate([4, 6]):
        sp_list = [
            (-8, -16, weapon_raw_sprites[base_i], 0x07),
            (-8, 0, weapon_raw_sprites[base_i + 1], 0x07),
        ]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=7)
        sheet.paste(im, ((8 + f_idx) * cell_w, cell_h))
        im.save(os.path.join(OUT_DIR, 'individual', f'subweapon_giant_wave_f{f_idx}.png'))

    for f_idx in range(2):
        sp_list = [
            (e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col'])
            for e in meta_sprites_def[8]
        ]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=5 if f_idx == 0 else 6)
        sheet.paste(im, ((10 + f_idx) * cell_w, cell_h))
        im.save(os.path.join(OUT_DIR, 'individual', f'subweapon_plasma_flash_f{f_idx}.png'))

    # Row 2:
    # - Cols 0..3: Field Shutter (Fire #2, MS #10..#13 using weapon_raw_sprites[2, 3])
    # - Cols 4..7: All-Range directional shots (MS #28 s20 x 4 frames)
    # - Cols 8..11: Spark / Bolt projectiles (MS #5 s5, MS #9 s23, MS #20 s15+s14, MS #30 s18)
    for k, ms_id in enumerate([10, 11, 12, 13]):
        s2_grid = weapon_raw_sprites[2]
        s3_grid = weapon_raw_sprites[3]
        sp_list = [
            (e['dy'], e['dx'], s2_grid if e['slot'] == 2 else s3_grid, e['col'])
            for e in meta_sprites_def[ms_id]
        ]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=7)
        sheet.paste(im, (k * cell_w, 2 * cell_h))
        im.save(os.path.join(OUT_DIR, 'individual', f'field_shutter_state{k}.png'))

    for f_idx in range(4):
        sp_list = [
            (e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col'])
            for e in meta_sprites_def[28]
        ]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=7)
        sheet.paste(im, ((4 + f_idx) * cell_w, 2 * cell_h))
        im.save(os.path.join(OUT_DIR, 'individual', f'all_range_shot_f{f_idx}.png'))

    extra_ms = [(5, 7, 'spark_s5'), (9, 6, 'ring_shot_s23'), (20, 4, 'light_bar_s14_15'), (30, 6, 'small_ring_s18')]
    for k, (ms_id, dcol, ename) in enumerate(extra_ms):
        sp_list = [
            (e['dy'], e['dx'], common_frames[0][e['slot']], e['col'])
            for e in meta_sprites_def[ms_id]
        ]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=dcol)
        sheet.paste(im, ((8 + k) * cell_w, 2 * cell_h))
        im.save(os.path.join(OUT_DIR, 'individual', f'{ename}.png'))

    save_with_dark_preview(sheet, 'weapons_sheet.png', cell_w, cell_h)
    return sheet


def build_items_and_explosions_sheet():
    """Sheet 3: Power Chips, Floating Boxes, Smiling Idol / Warp Orbs, Numbered Weapon Pickups 0..7, Explosions & Bullets"""
    cell_w, cell_h = 24, 24
    cols, rows = 8, 5
    sheet = Image.new('RGBA', (cols * cell_w, rows * cell_h), (0, 0, 0, 0))

    # Row 0 Cols 0..3: Rotating 'P' Power Chip (MS #46, s6+s7, 4 frames)
    for f_idx in range(4):
        sp_list = [
            (e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col'])
            for e in meta_sprites_def[46]
        ]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=5)
        sheet.paste(im, (f_idx * cell_w, 0))
        im.save(os.path.join(OUT_DIR, 'individual', f'power_chip_f{f_idx}.png'))

    # Row 0 Cols 4..7: Smiling Idol / Warp Orb (MS #36, s11+s10, 4 frames)
    for f_idx in range(4):
        sp_list = [
            (e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col'])
            for e in meta_sprites_def[36]
        ]
        im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=5)
        sheet.paste(im, ((4 + f_idx) * cell_w, 0))
        im.save(os.path.join(OUT_DIR, 'individual', f'idol_orb_f{f_idx}.png'))

    # Row 1 Cols 0..3: Floating Item Box Yellow (MS #47, s8+s9, 4 frames, col=6)
    # Row 1 Cols 4..7: Floating Item Box Blue (MS #47, s8+s9, 4 frames, col=5)
    for f_idx in range(4):
        sp_y = [(e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col']) for e in meta_sprites_def[47]]
        im_y = render_v9938_metasprite(sp_y, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=6)
        sheet.paste(im_y, (f_idx * cell_w, cell_h))
        im_y.save(os.path.join(OUT_DIR, 'individual', f'floating_box_yellow_f{f_idx}.png'))

        im_b = render_v9938_metasprite(sp_y, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=5)
        sheet.paste(im_b, ((4 + f_idx) * cell_w, cell_h))
        im_b.save(os.path.join(OUT_DIR, 'individual', f'floating_box_blue_f{f_idx}.png'))

    # Row 2 Cols 0..7: Numbered Weapon Upgrade Pickups 0..7!
    # In Zanac-Ex (0xB1D3 handler_type83_black_shadow):
    # Digit sprite (MS #48..#55, slots s50..s53 with SCT 0x24 for even digits 0,2,4,6 at dy=-4, and SCT 0x25 for odd digits 1,3,5,7 at dy=-12)
    # overlaid on the circular orb (MS #2, slot s55, colored with dark blue/red/purple)!
    for num in range(8):
        ms_digit = 48 + num
        digit_entry = meta_sprites_def[ms_digit][0]
        sct_digit = 0x24 if (num % 2 == 0) else 0x25
        # Digit on top (white 7 via sct_digit), circle s55 behind (color 10 Navy or 1 Red)
        sp_num = [
            (digit_entry['dy'], digit_entry['dx'], common_frames[0][digit_entry['slot']], sct_digit),
            (-8, -8, common_frames[0][55], 10),
        ]
        im_n = render_v9938_metasprite(sp_num, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=10)
        sheet.paste(im_n, (num * cell_w, 2 * cell_h))
        im_n.save(os.path.join(OUT_DIR, 'individual', f'weapon_pickup_{num}.png'))

    # Row 3 Cols 0..3: Aerial Enemy Explosion Orange (MS #43, s12+s13, 4 frames, col=4)
    # Row 3 Cols 4..7: Aerial Enemy Explosion Yellow (MS #43, s12+s13, 4 frames, col=6)
    for f_idx in range(4):
        sp_e = [(e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col']) for e in meta_sprites_def[43]]
        im_o = render_v9938_metasprite(sp_e, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=4)
        sheet.paste(im_o, (f_idx * cell_w, 3 * cell_h))
        im_o.save(os.path.join(OUT_DIR, 'individual', f'explosion_orange_f{f_idx}.png'))

        im_y = render_v9938_metasprite(sp_e, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=6)
        sheet.paste(im_y, ((4 + f_idx) * cell_w, 3 * cell_h))
        im_y.save(os.path.join(OUT_DIR, 'individual', f'explosion_yellow_f{f_idx}.png'))

    # Row 4 Cols 0..3: Small Enemy Bullet 'Lead' (MS #6, s17+s16, 4 frames, col=6)
    # Row 4 Cols 4..5: Medium Bullet (MS #7, s19+s18, 2 frames, col=4)
    # Row 4 Cols 6..7: Large Bullet (MS #8, s21+s20, 2 frames, col=4)
    for f_idx in range(4):
        sp_b = [(e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col']) for e in meta_sprites_def[6]]
        im_b = render_v9938_metasprite(sp_b, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=6)
        sheet.paste(im_b, (f_idx * cell_w, 4 * cell_h))
        im_b.save(os.path.join(OUT_DIR, 'individual', f'enemy_bullet_lead_f{f_idx}.png'))

    for f_idx in range(4):
        ms_id = 7 if f_idx < 2 else 8
        sp_c = [(e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col']) for e in meta_sprites_def[ms_id]]
        im_c = render_v9938_metasprite(sp_c, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=4)
        sheet.paste(im_c, ((4 + f_idx) * cell_w, 4 * cell_h))
        btype = 'med' if f_idx < 2 else 'large'
        im_c.save(os.path.join(OUT_DIR, 'individual', f'enemy_bullet_{btype}_f{f_idx % 2}.png'))

    save_with_dark_preview(sheet, 'items_and_explosions_sheet.png', cell_w, cell_h)
    return sheet


def build_enemies_common_sheet():
    """Sheet 4: All 14 Common Airborne & Ground-Turret Enemies across all 4 animation frames"""
    enemy_ms_list = [
        (17, 5, 'loga_spinner_s24_25'),      # MS #17: s24+s25
        (21, 5, 'umber_claw_s26_27'),        # MS #21: s26+s27
        (25, 5, 'swooper_wing_s28_29'),      # MS #25: s28+s29
        (31, 5, 'veybar_glider_s30_31'),     # MS #31: s30+s31
        (23, 5, 'luster_heavy_s32_33'),      # MS #23: s32+s33
        (24, 4, 'luster_mandible_s34_35'),   # MS #24: s34+s35
        (44, 5, 'duster_meteor_s36_37'),     # MS #44: s36+s37
        (27, 5, 'spinner_mine_s38_39'),      # MS #27: s38+s39
        (29, 3, 'teruzo_pulse_s40_41'),      # MS #29: s41+s40
        (40, 5, 'stealth_jet_s42_43'),       # MS #40: s42+s43
        (18, 5, 'mech_pod_s44_45'),          # MS #18: s44+s45
        (19, 4, 'eye_tentacle_s46_47'),      # MS #19: s46+s47
        (34, 5, 'degid_diamond_s48_49'),     # MS #34: s48+s49 (32px wide)
        (33, 4, 'degid_half_s49'),           # MS #33: s49
    ]
    cell_w, cell_h = 32, 24
    cols = 8
    rows = (len(enemy_ms_list) + 1) // 2
    sheet = Image.new('RGBA', (cols * cell_w, rows * cell_h), (0, 0, 0, 0))

    for idx, (ms_id, dcol, name) in enumerate(enemy_ms_list):
        macro_col = idx % 2
        row = idx // 2
        for f_idx in range(4):
            sp_list = [
                (e['dy'], e['dx'], common_frames[f_idx][e['slot']], e['col'])
                for e in meta_sprites_def[ms_id]
            ]
            im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=dcol)
            sheet.paste(im, ((macro_col * 4 + f_idx) * cell_w, row * cell_h))
            im.save(os.path.join(OUT_DIR, 'individual', f'{name}_f{f_idx}.png'))

    save_with_dark_preview(sheet, 'enemies_common_sheet.png', cell_w, cell_h)
    return sheet


def build_enemies_stage_sets_sheet():
    """Sheet 5: All 6 Dynamic Stage / Giant Enemy Sprite Sets (Sets 0..5 at 0x9C0A..0xB409, slots s56..s63)"""
    cell_w, cell_h = 40, 40
    cols, rows = 8, 6
    sheet = Image.new('RGBA', (cols * cell_w, rows * cell_h), (0, 0, 0, 0))

    for set_idx in range(6):
        s_frames = stage_sets[set_idx]
        # Cols 0..3: 32x32 composite (MS #22) across Frames 0..3
        for f_idx in range(4):
            sp_list = [
                (e['dy'], e['dx'], s_frames[f_idx][e['slot']], e['col'])
                for e in meta_sprites_def[22]
            ]
            im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=5)
            sheet.paste(im, (f_idx * cell_w, set_idx * cell_h))
            im.save(os.path.join(OUT_DIR, 'individual', f'stage_set{set_idx}_32x32_f{f_idx}.png'))

        # Cols 4..7: The 4 individual 16x16 pairs (s56+s57, s58+s59, s60+s61, s62+s63) at Frame 0
        for pair_k, s_base in enumerate([56, 58, 60, 62]):
            sp_list = [
                (-8, -8, s_frames[0][s_base], 0x05),
                (-8, -8, s_frames[0][s_base + 1], 0x13),
            ]
            im = render_v9938_metasprite(sp_list, cell_w, cell_h, cell_w // 2, cell_h // 2, default_col=5)
            sheet.paste(im, ((4 + pair_k) * cell_w, set_idx * cell_h))
            for f_idx in range(4):
                sp_f = [
                    (-8, -8, s_frames[f_idx][s_base], 0x05),
                    (-8, -8, s_frames[f_idx][s_base + 1], 0x13),
                ]
                im_f = render_v9938_metasprite(sp_f, 16, 16, 8, 8, default_col=5)
                im_f.save(os.path.join(OUT_DIR, 'individual', f'stage_set{set_idx}_pair{pair_k}_f{f_idx}.png'))

    save_with_dark_preview(sheet, 'enemies_stage_sets_sheet.png', cell_w, cell_h)
    return sheet


if __name__ == '__main__':
    build_player_ship_sheet()
    build_weapons_sheet()
    build_items_and_explosions_sheet()
    build_enemies_common_sheet()
    build_enemies_stage_sets_sheet()

    meta_out = {
        'palette_rgba': PALETTE_RGBA,
        'meta_sprites': meta_sprites_def,
        'sheets': [
            'player_ship_sheet.png',
            'weapons_sheet.png',
            'items_and_explosions_sheet.png',
            'enemies_common_sheet.png',
            'enemies_stage_sets_sheet.png',
        ],
    }
    with open(os.path.join(OUT_DIR, 'sprites_metadata.json'), 'w', encoding='utf-8') as f:
        json.dump(meta_out, f, indent=2)

    print('Successfully extracted all original 1x sprites and dark previews into:', OUT_DIR)
