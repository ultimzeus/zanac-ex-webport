import os
import sys
import time
from PIL import Image
import z80

ROM_PATH = r'e:\Emul\zanac_ex\Zanac-Ex (1986) Compile [Hack] [10170].rom'
OUT_DIR = r'e:\Emul\zanac_ex\maps'
os.makedirs(OUT_DIR, exist_ok=True)

with open(ROM_PATH, 'rb') as f:
    rom = f.read()


class ZanacExEngine:
    def __init__(self):
        self.vram = bytearray(128 * 1024)
        self.vdp_regs = [0] * 64
        self.vdp_indirect_reg = 0
        self.vdp_indirect_auto = 0
        self.vdp_latch = 0
        self.vdp_latch_val = 0
        self.hmmc_active = False
        self.hmmc_dx = self.hmmc_dy = self.hmmc_nx = self.hmmc_ny = self.hmmc_cur_x = self.hmmc_cur_y = 0

        self.m = z80.Z80Machine()
        self.m.set_memory_block(0x4000, rom[0x1C000:0x1E000])  # Bank 14
        self.m.set_memory_block(0x6000, rom[0x1E000:0x20000])  # Bank 15

        sv = self.m.get_state_view()
        self.mem = sv[44 : 44 + 65536]
        self.mem[0x0047] = 0xC9  # RET
        self.mem[0x0006] = 0x98  # VDPRD

        self.m.set_write_callback(self._on_write)
        self.m.mark_addr(0x5000, self.m.WRITE_MARK)
        self.m.mark_addr(0x7000, self.m.WRITE_MARK)
        self.m.mark_addr(0x9000, self.m.WRITE_MARK)
        self.m.mark_addr(0xB000, self.m.WRITE_MARK)

        self.m.set_output_callback(self._on_out)
        self.m.set_input_callback(self._on_in)
        self.m.set_breakpoint(0xFF00)

        # Boot load common tiles from Bank 8 & 9
        self._load_bank8_tiles()

    def _write_hmmc_byte(self, b):
        if not self.hmmc_active:
            return
        px = self.hmmc_dx + self.hmmc_cur_x
        py = self.hmmc_dy + self.hmmc_cur_y
        vram_off = py * 128 + (px // 2)
        if vram_off < len(self.vram):
            self.vram[vram_off] = b
        self.hmmc_cur_x += 2
        if self.hmmc_cur_x >= self.hmmc_nx:
            self.hmmc_cur_x = 0
            self.hmmc_cur_y += 1
            if self.hmmc_cur_y >= self.hmmc_ny:
                self.hmmc_active = False

    def _on_out(self, port, val):
        p = port & 0xFF
        if p == 0x99:
            if self.vdp_latch == 0:
                self.vdp_latch_val = val
                self.vdp_latch = 1
            else:
                self.vdp_latch = 0
                if val & 0x80:
                    reg = val & 0x3F
                    self.vdp_regs[reg] = self.vdp_latch_val
                    if reg == 17:
                        self.vdp_indirect_reg = self.vdp_latch_val & 0x3F
                        self.vdp_indirect_auto = (self.vdp_latch_val & 0x80) == 0
        elif p == 0x9B:
            reg = self.vdp_indirect_reg
            self.vdp_regs[reg] = val
            if self.vdp_indirect_auto:
                self.vdp_indirect_reg = (self.vdp_indirect_reg + 1) & 0x3F
            if reg == 46 and (val & 0xF0) == 0xF0:
                self.hmmc_active = True
                self.hmmc_dx = self.vdp_regs[36] | (self.vdp_regs[37] << 8)
                self.hmmc_dy = self.vdp_regs[38] | (self.vdp_regs[39] << 8)
                self.hmmc_nx = self.vdp_regs[40] | (self.vdp_regs[41] << 8)
                self.hmmc_ny = self.vdp_regs[42] | (self.vdp_regs[43] << 8)
                self.hmmc_cur_x = 0
                self.hmmc_cur_y = 0
                self._write_hmmc_byte(self.vdp_regs[44])
            elif reg == 44 and self.hmmc_active:
                self._write_hmmc_byte(val)
        elif p == 0x98 and self.hmmc_active:
            self._write_hmmc_byte(val)

    def _on_in(self, port):
        if (port & 0xFF) == 0x99:
            return 0x80
        return 0xFF

    def _on_write(self, addr, val):
        bank = val & 0x0F
        if addr == 0x5000:
            self.m.set_memory_block(0x4000, rom[bank * 0x2000 : (bank + 1) * 0x2000])
        elif addr == 0x7000:
            self.m.set_memory_block(0x6000, rom[bank * 0x2000 : (bank + 1) * 0x2000])
        elif addr == 0x9000:
            self.m.set_memory_block(0x8000, rom[bank * 0x2000 : (bank + 1) * 0x2000])
        elif addr == 0xB000:
            self.m.set_memory_block(0xA000, rom[bank * 0x2000 : (bank + 1) * 0x2000])

    def call(self, addr, a=None, hl=None):
        if a is not None:
            self.m.a = a
        if hl is not None:
            self.m.hl = hl
        self.m.ix = 0xC080
        self.m.sp = 0xF300
        self.mem[0xF300] = 0x00
        self.mem[0xF301] = 0xFF
        self.m.pc = addr
        while self.m.pc != 0xFF00:
            self.m.ticks_to_stop = 10_000_000
            self.m.run()

    def _load_bank8_tiles(self):
        self.m.set_memory_block(0x8000, rom[0x10000:0x12000])
        self.m.set_memory_block(0xA000, rom[0x12000:0x14000])
        # Only call 0x8000 (gameplay common fortress/turret tiles 127..232 & boss cores).
        # Never call 0x8003 or 0x8006 (title screen COMPILE logo & demo tiles, which overwrite 127..131).
        self.call(0x8000)

    def load_stage(self, area):
        # 1. Bank 2/3 stage script and meta-tile setup
        self.m.set_memory_block(0x8000, rom[0x04000:0x06000])
        self.m.set_memory_block(0xA000, rom[0x06000:0x08000])
        self.call(0x8000, a=area)
        script_ptr = self.m.hl

        # 2. Bank 6/7 terrain tiles for style
        style = rom[0x04059 + area]
        self.m.set_memory_block(0x8000, rom[0x0C000:0x0E000])
        self.m.set_memory_block(0xA000, rom[0x0E000:0x10000])
        self.call(0x8000, a=style)

        # 3. Bank 2/3 restore and script init
        self.m.set_memory_block(0x8000, rom[0x04000:0x06000])
        self.m.set_memory_block(0xA000, rom[0x06000:0x08000])
        self.call(0x561A, hl=script_ptr)

        # Pre-extract all 256 8x8 sub-tiles from VRAM Page 1 (offset 0x8000)
        self.subtiles = []
        for st in range(256):
            sx = (st % 32) * 8
            sy = (st // 32) * 8
            nibs = []
            for r in range(8):
                b_off = 0x8000 + (sy + r) * 128 + (sx // 2)
                for c in range(4):
                    b = self.vram[b_off + c]
                    nibs.append(b >> 4)
                    nibs.append(b & 0x0F)
            self.subtiles.append(nibs)


def decode_pal(chunk):
    pal = []
    for c in range(16):
        rb = chunk[c * 2]
        g = chunk[c * 2 + 1] & 7
        r = (rb >> 4) & 7
        b = rb & 7
        pal.append((r * 255 // 7, g * 255 // 7, b * 255 // 7))
    return pal


# Exact (r_final_cmd7 + countdown_ix45, r_cmd5) per area from Bank 3 script & Bank 13 0xB3B0 boss scroll controller:
AREA_STAGE_LIMITS = {
    1:  (574,  565),  # Cmd7 at 564 + 10 rows
    2:  (568,  561),  # Cmd7 at 560 +  8 rows
    3:  (709,  701),  # Cmd7 at 700 +  9 rows
    4:  (1393, 1381), # Cmd7 at 1380 + 13 rows
    5:  (1041, 1031), # Cmd7 at 1030 + 11 rows
    6:  (772,  761),  # Cmd7 at 760 + 12 rows
    7:  (763,  751),  # Cmd7 at 750 + 13 rows
    8:  (871,  861),  # Cmd7 at 860 + 11 rows
    9:  (1530, 1528), # Cmd7 at 1520 + 10 rows
    10: (1494, 1481), # Cmd7 at 1480 + 14 rows
    11: (544,  531),  # Cmd7 at 530 + 14 rows
    12: (817,  789),  # Cmd7 at 789 + 28 rows
}


def build_all_maps():
    print("=== Generating 100% Authentic Hardware-Exact Maps for Zanac EX (Areas 1-12) ===")
    total_start = time.time()
    generated = []

    for area in range(1, 13):
        t0 = time.time()
        engine = ZanacExEngine()
        engine.load_stage(area)

        total_rows, r_cmd5 = AREA_STAGE_LIMITS[area]

        rows_data = []
        for r in range(total_rows):
            if r > r_cmd5:
                # Prevent 0x571E from reading post-script data tables after Cmd 5
                engine.mem[0xC0A3] = 0xFF
                engine.mem[0xC0A4] = 0xFF
            engine.call(0x571E)
            # Read hardware VDP HMMM sub-tile buffers populated by 0x5998..0x59D4:
            # 0xCB60..0xCB7F = 32 top 8x8 sub-tiles, 0xCB80..0xCB9F = 32 bottom 8x8 sub-tiles
            top_sub = bytes(engine.mem[0xCB60 : 0xCB80])
            bot_sub = bytes(engine.mem[0xCB80 : 0xCBA0])
            pal = decode_pal(bytes(engine.mem[0xCBD0 : 0xCBF0]))
            rows_data.append((top_sub, bot_sub, pal))

        num_rows = len(rows_data)
        img_w = 256
        img_h = num_rows * 16

        map_img = Image.new('RGB', (img_w, img_h))
        px = map_img.load()

        for r_idx, (top_sub, bot_sub, pal) in enumerate(rows_data):
            # Row 0 is at the bottom of the stage; row (num_rows - 1) is at the top
            base_y = (num_rows - 1 - r_idx) * 16
            for sc in range(32):
                bx = sc * 8
                nibs_t = engine.subtiles[top_sub[sc]]
                nibs_b = engine.subtiles[bot_sub[sc]]
                for py in range(8):
                    for px_i in range(8):
                        px[bx + px_i, base_y + py] = pal[nibs_t[py * 8 + px_i]]
                        px[bx + px_i, base_y + 8 + py] = pal[nibs_b[py * 8 + px_i]]

        out_path = os.path.join(OUT_DIR, f'area_{area:02d}_ex.png')
        map_img.save(out_path)
        dt = time.time() - t0
        print(f"Area {area:2d}: {num_rows:4d} rows -> {out_path} ({img_w}x{img_h}) [{dt:.1f}s]")
        generated.append((area, out_path, map_img))

    # Generate 12-area showcase panorama
    print("\nGenerating 12-area showcase panorama...")
    col_w = 128
    col_h = 1280
    gutter = 12
    margin_top = 20
    margin_side = 16
    total_w = margin_side * 2 + 12 * col_w + 11 * gutter
    total_h = col_h + margin_top * 2

    showcase = Image.new('RGB', (total_w, total_h), (12, 14, 20))
    for idx, (area, path, full_img) in enumerate(generated):
        x = margin_side + idx * (col_w + gutter)
        y = margin_top
        thumb = full_img.resize((col_w, col_h), Image.Resampling.NEAREST)
        showcase.paste(thumb, (x, y))

    showcase_path = os.path.join(OUT_DIR, 'zanac_ex_12_areas_showcase.png')
    showcase.save(showcase_path)
    print(f"Showcase saved: {showcase_path} ({showcase.size})")
    print(f"All 12 maps successfully generated in {time.time() - total_start:.1f}s!")


if __name__ == '__main__':
    build_all_maps()
