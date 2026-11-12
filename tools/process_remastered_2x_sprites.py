import os
import shutil
from PIL import Image

BRAIN_DIR = r'C:\Users\lassad\.gemini\antigravity\brain\dab3315c-b72b-4cc7-8915-68090002efe9'
OUT_DIR = r'e:\Emul\Zanac_WebPort\assets\sprites\remastered_2x'
INDIV_DIR = os.path.join(OUT_DIR, 'individual')
os.makedirs(INDIV_DIR, exist_ok=True)

RAW_SOURCES = {
    'player_ship_sheet': (
        os.path.join(BRAIN_DIR, 'player_ship_sheet_2x_raw_1794234718037.jpg'),
        8, 3, 64, 48,  # 8 cols x 3 rows, 2x cell size = 64x48 (total 512x144)
    ),
    'weapons_sheet': (
        os.path.join(BRAIN_DIR, 'weapons_sheet_2x_grid_1794234819563.jpg'),
        12, 3, 64, 64,  # 12 cols x 3 rows, 2x cell size = 64x64 (total 768x192)
    ),
    'items_and_explosions_sheet': (
        os.path.join(BRAIN_DIR, 'items_and_explosions_sheet_2x_raw_dark_bg_1794234831304.jpg'),
        8, 5, 48, 48,  # 8 cols x 5 rows, 2x cell size = 48x48 (total 384x240)
    ),
    'enemies_common_sheet': (
        os.path.join(BRAIN_DIR, 'enemies_common_sheet_2x_raw_1794234722088.jpg'),
        8, 7, 64, 48,  # 8 cols x 7 rows, 2x cell size = 64x48 (total 512x336)
    ),
    'enemies_stage_sets_sheet': (
        os.path.join(BRAIN_DIR, 'enemies_stage_sets_sheet_2x_raw_1794234725645.jpg'),
        8, 6, 80, 80,  # 8 cols x 6 rows, 2x cell size = 80x80 (total 640x480)
    ),
}


from collections import deque
import numpy as np
from scipy.ndimage import label


def clean_cell_to_rgba(cell_rgb, target_w, target_h):
    """Remove dark background and border grid lines from a cell using flood-fill and connected components,
    quantize to 256 arcade colors, and resize to exact 2x dimensions (target_w, target_h).
    """
    w, h = cell_rgb.size
    px = cell_rgb.load()

    def is_bg(r, g, b):
        lum = max(r, g, b)
        dist_bg = abs(r - 12) + abs(g - 12) + abs(b - 22)
        if lum < 58 or dist_bg < 65:
            return True
        if r < 50 and g < 50 and b < 70:
            return True
        return False

    bg_mask = np.zeros((h, w), dtype=bool)
    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    # Seed all 4 borders of the cell
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        if visited[y, x]:
            continue
        visited[y, x] = True
        r, g, b = px[x, y]
        if is_bg(r, g, b):
            bg_mask[y, x] = True
            for nx, ny in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]:
                if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx]:
                    q.append((nx, ny))

    # Also mark any pixel whose luminance is low as background
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if max(r, g, b) < 48:
                bg_mask[y, x] = True

    clean = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    cpx = clean.load()
    for y in range(h):
        for x in range(w):
            if not bg_mask[y, x]:
                cpx[x, y] = px[x, y] + (255,)

    # Connected component filter: remove stray border lines and tiny artifacts
    fg = np.array(clean)[:, :, 3] > 0
    lbl, num = label(fg)
    if num > 1:
        cx, cy = w / 2, h / 2
        clean_arr = np.array(clean)
        for comp_id in range(1, num + 1):
            comp_mask = (lbl == comp_id)
            comp_size = np.sum(comp_mask)
            comp_ys, comp_xs = np.where(comp_mask)
            dist_to_center = np.hypot(comp_xs.mean() - cx, comp_ys.mean() - cy)
            if comp_size < 40 and dist_to_center > min(w, h) * 0.32:
                clean_arr[comp_mask] = [0, 0, 0, 0]
        clean = Image.fromarray(clean_arr)

    # Resize to exact 2x cell dimensions using high-quality Lanczos
    resized = clean.resize((target_w, target_h), Image.Resampling.LANCZOS)
    r_px = resized.load()
    rgb_only = Image.new('RGB', (target_w, target_h), (0, 0, 0))
    rgb_px = rgb_only.load()
    alpha_mask = [[0] * target_w for _ in range(target_h)]

    for y in range(target_h):
        for x in range(target_w):
            r, g, b, a = r_px[x, y]
            if a >= 64:
                alpha_mask[y][x] = 255
                rgb_px[x, y] = (r, g, b)

    # Quantize RGB to 256 colors for authentic 256-color arcade look
    quant_rgb = rgb_only.quantize(colors=256, method=Image.Quantize.FASTOCTREE).convert('RGB')
    q_px = quant_rgb.load()

    final_cell = Image.new('RGBA', (target_w, target_h), (0, 0, 0, 0))
    f_px = final_cell.load()
    for y in range(target_h):
        for x in range(target_w):
            if alpha_mask[y][x]:
                r, g, b = q_px[x, y]
                f_px[x, y] = (r, g, b, 255)

    return final_cell


def process_all_sheets():
    sheets_2x = {}
    for sheet_name, (src_path, cols, rows, cw, ch) in RAW_SOURCES.items():
        shutil.copy2(src_path, os.path.join(OUT_DIR, f'{sheet_name}_nano_raw.jpg'))
        raw_im = Image.open(src_path).convert('RGB')
        rw, rh = raw_im.size

        sheet_out = Image.new('RGBA', (cols * cw, rows * ch), (0, 0, 0, 0))
        sheet_dark = Image.new('RGBA', (cols * cw, rows * ch), (12, 12, 22, 255))

        for r in range(rows):
            if sheet_name == 'weapons_sheet':
                y_bands = [(25, 265), (320, 448), (466, 594)]
                y0, y1 = y_bands[r]
            else:
                y0 = int(round(r * rh / rows))
                y1 = int(round((r + 1) * rh / rows))
            for c in range(cols):
                x0 = int(round(c * rw / cols))
                x1 = int(round((c + 1) * rw / cols))
                cell_rgb = raw_im.crop((x0, y0, x1, y1))
                cell_rgba = clean_cell_to_rgba(cell_rgb, cw, ch)
                sheet_out.paste(cell_rgba, (c * cw, r * ch))
                sheet_dark.alpha_composite(cell_rgba, (c * cw, r * ch))

        out_png = os.path.join(OUT_DIR, f'{sheet_name}.png')
        sheet_out.save(out_png)
        sheet_dark.convert('RGB').save(os.path.join(OUT_DIR, f'{sheet_name}_preview_dark.png'))
        sheets_2x[sheet_name] = (sheet_out, cw, ch)
        print(f'Processed 2x sheet: {out_png} ({cols*cw}x{rows*ch})')

    # Slice individual 2x sprites with matching names to original_1x/individual/
    # 1. Player ship sheet
    s_ship, cw, ch = sheets_2x['player_ship_sheet']
    for idx in range(8):
        cell = s_ship.crop((idx * cw, 0, (idx + 1) * cw, ch))
        name = 'player_ship_main.png' if idx == 0 else f'player_death_exp_f{idx - 1}.png'
        cell.save(os.path.join(INDIV_DIR, name))
    for w_idx in range(4):
        cell = s_ship.crop((w_idx * cw, ch, (w_idx + 1) * cw, 2 * ch))
        cell.save(os.path.join(INDIV_DIR, f'player_ship_shield_{w_idx}.png'))
        pod = s_ship.crop(((4 + w_idx) * cw + 16, ch + 8, (4 + w_idx) * cw + 48, ch + 40))
        pod.save(os.path.join(INDIV_DIR, f'wing_pod_{w_idx}.png'))

    # 2. Weapons sheet
    s_weap, cw, ch = sheets_2x['weapons_sheet']
    for lvl_idx in range(3):
        for f_idx in range(4):
            col_pos = lvl_idx * 4 + f_idx
            cell = s_weap.crop((col_pos * cw, 0, (col_pos + 1) * cw, ch))
            cell.save(os.path.join(INDIV_DIR, f'normal_shot_tier{lvl_idx}_f{f_idx}.png'))
    for f_idx in range(4):
        s_weap.crop((f_idx * cw, ch, (f_idx + 1) * cw, 2 * ch)).save(
            os.path.join(INDIV_DIR, f'subweapon_orb_s2_f{f_idx}.png')
        )
        s_weap.crop(((4 + f_idx) * cw, ch, (5 + f_idx) * cw, 2 * ch)).save(
            os.path.join(INDIV_DIR, f'subweapon_blade_s3_f{f_idx}.png')
        )
    for f_idx in range(2):
        s_weap.crop(((8 + f_idx) * cw, ch, (9 + f_idx) * cw, 2 * ch)).save(
            os.path.join(INDIV_DIR, f'subweapon_giant_wave_f{f_idx}.png')
        )
        s_weap.crop(((10 + f_idx) * cw, ch, (11 + f_idx) * cw, 2 * ch)).save(
            os.path.join(INDIV_DIR, f'subweapon_plasma_flash_f{f_idx}.png')
        )
    for k in range(4):
        s_weap.crop((k * cw, 2 * ch, (k + 1) * cw, 3 * ch)).save(
            os.path.join(INDIV_DIR, f'field_shutter_state{k}.png')
        )
        s_weap.crop(((4 + k) * cw, 2 * ch, (5 + k) * cw, 3 * ch)).save(
            os.path.join(INDIV_DIR, f'all_range_shot_f{k}.png')
        )
    for k, ename in enumerate(['spark_s5', 'ring_shot_s23', 'light_bar_s14_15', 'small_ring_s18']):
        s_weap.crop(((8 + k) * cw, 2 * ch, (9 + k) * cw, 3 * ch)).save(
            os.path.join(INDIV_DIR, f'{ename}.png')
        )

    # 3. Items & explosions sheet
    s_item, cw, ch = sheets_2x['items_and_explosions_sheet']
    for f_idx in range(4):
        s_item.crop((f_idx * cw, 0, (f_idx + 1) * cw, ch)).save(
            os.path.join(INDIV_DIR, f'power_chip_f{f_idx}.png')
        )
        s_item.crop(((4 + f_idx) * cw, 0, (5 + f_idx) * cw, ch)).save(
            os.path.join(INDIV_DIR, f'idol_orb_f{f_idx}.png')
        )
        s_item.crop((f_idx * cw, ch, (f_idx + 1) * cw, 2 * ch)).save(
            os.path.join(INDIV_DIR, f'floating_box_yellow_f{f_idx}.png')
        )
        s_item.crop(((4 + f_idx) * cw, ch, (5 + f_idx) * cw, 2 * ch)).save(
            os.path.join(INDIV_DIR, f'floating_box_blue_f{f_idx}.png')
        )
        s_item.crop((f_idx * cw, 3 * ch, (f_idx + 1) * cw, 4 * ch)).save(
            os.path.join(INDIV_DIR, f'explosion_orange_f{f_idx}.png')
        )
        s_item.crop(((4 + f_idx) * cw, 3 * ch, (5 + f_idx) * cw, 4 * ch)).save(
            os.path.join(INDIV_DIR, f'explosion_yellow_f{f_idx}.png')
        )
        s_item.crop((f_idx * cw, 4 * ch, (f_idx + 1) * cw, 5 * ch)).save(
            os.path.join(INDIV_DIR, f'enemy_bullet_lead_f{f_idx}.png')
        )
    for num in range(8):
        s_item.crop((num * cw, 2 * ch, (num + 1) * cw, 3 * ch)).save(
            os.path.join(INDIV_DIR, f'weapon_pickup_{num}.png')
        )
    for f_idx in range(4):
        btype = 'med' if f_idx < 2 else 'large'
        s_item.crop(((4 + f_idx) * cw, 4 * ch, (5 + f_idx) * cw, 5 * ch)).save(
            os.path.join(INDIV_DIR, f'enemy_bullet_{btype}_f{f_idx % 2}.png')
        )

    # 4. Common enemies sheet
    s_enem, cw, ch = sheets_2x['enemies_common_sheet']
    enemy_names = [
        'loga_spinner_s24_25', 'umber_claw_s26_27',
        'swooper_wing_s28_29', 'veybar_glider_s30_31',
        'luster_heavy_s32_33', 'luster_mandible_s34_35',
        'duster_meteor_s36_37', 'spinner_mine_s38_39',
        'teruzo_pulse_s40_41', 'stealth_jet_s42_43',
        'mech_pod_s44_45', 'eye_tentacle_s46_47',
        'degid_diamond_s48_49', 'degid_half_s49',
    ]
    for idx, name in enumerate(enemy_names):
        macro_col = idx % 2
        row = idx // 2
        for f_idx in range(4):
            c = macro_col * 4 + f_idx
            s_enem.crop((c * cw, row * ch, (c + 1) * cw, (row + 1) * ch)).save(
                os.path.join(INDIV_DIR, f'{name}_f{f_idx}.png')
            )

    # 5. Stage giant enemies sheet
    s_stage, cw, ch = sheets_2x['enemies_stage_sets_sheet']
    for set_idx in range(6):
        for f_idx in range(4):
            s_stage.crop((f_idx * cw, set_idx * ch, (f_idx + 1) * cw, (set_idx + 1) * ch)).save(
                os.path.join(INDIV_DIR, f'stage_set{set_idx}_32x32_f{f_idx}.png')
            )
        for pair_k in range(4):
            c = 4 + pair_k
            cell = s_stage.crop((c * cw, set_idx * ch, (c + 1) * cw, (set_idx + 1) * ch))
            for f_idx in range(4):
                cell.save(os.path.join(INDIV_DIR, f'stage_set{set_idx}_pair{pair_k}_f{f_idx}.png'))


if __name__ == '__main__':
    process_all_sheets()
