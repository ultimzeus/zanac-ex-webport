import os
import sys
import z80
from PIL import Image

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
        self.m.set_memory_block(0x4000, rom[0x1C000:0x1E000]) # Bank 14
        self.m.set_memory_block(0x6000, rom[0x1E000:0x20000]) # Bank 15

        sv = self.m.get_state_view()
        self.mem = sv[44 : 44 + 65536]
        self.mem[0x0047] = 0xC9 # RET
        self.mem[0x0006] = 0x98 # VDPRD

        self.m.set_write_callback(self._on_write)
        self.m.mark_addr(0x5000, self.m.WRITE_MARK)
        self.m.mark_addr(0x7000, self.m.WRITE_MARK)
        self.m.mark_addr(0x9000, self.m.WRITE_MARK)
        self.m.mark_addr(0xB000, self.m.WRITE_MARK)

        self.m.set_output_callback(self._on_out)
        self.m.set_input_callback(self._on_in)
        self.m.set_breakpoint(0xFF00)

        # Boot load common tiles from Bank 8
        self._load_bank8_tiles()

    def _write_hmmc_byte(self, b):
        if not self.hmmc_active: return
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
                self.hmmc_cur_x = 0; self.hmmc_cur_y = 0
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
        if addr == 0x5000: self.m.set_memory_block(0x4000, rom[bank*0x2000 : (bank+1)*0x2000])
        elif addr == 0x7000: self.m.set_memory_block(0x6000, rom[bank*0x2000 : (bank+1)*0x2000])
        elif addr == 0x9000: self.m.set_memory_block(0x8000, rom[bank*0x2000 : (bank+1)*0x2000])
        elif addr == 0xB000: self.m.set_memory_block(0xA000, rom[bank*0x2000 : (bank+1)*0x2000])

    def call(self, addr, a=None, hl=None):
        if a is not None: self.m.a = a
        if hl is not None: self.m.hl = hl
        self.m.ix = 0xC080
        self.m.sp = 0xF300
        self.mem[0xF300] = 0x00; self.mem[0xF301] = 0xFF
        self.m.pc = addr
        while self.m.pc != 0xFF00:
            self.m.ticks_to_stop = 10_000_000
            self.m.run()

    def _load_bank8_tiles(self):
        self.m.set_memory_block(0x8000, rom[0x10000:0x12000])
        self.m.set_memory_block(0xA000, rom[0x12000:0x14000])
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

        # Pre-extract all 256 sub-tiles from Page 1 (offset 0x8000 in VRAM)
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

        cbf2 = self.mem[0xCBF2] | (self.mem[0xCBF3] << 8)
        b2_rom = rom[0x04000:0x06000]
        self.get_subtiles = lambda mt: (
            b2_rom[(cbf2 - 0x8000) + mt * 5],
            b2_rom[(cbf2 - 0x8000) + mt * 5 + 1],
            b2_rom[(cbf2 - 0x8000) + mt * 5 + 2],
            b2_rom[(cbf2 - 0x8000) + mt * 5 + 3]
        )

def decode_pal(chunk):
    pal = []
    for c in range(16):
        rb = chunk[c * 2]
        g = chunk[c * 2 + 1] & 7
        r = (rb >> 4) & 7
        b = rb & 7
        pal.append((r * 255 // 7, g * 255 // 7, b * 255 // 7))
    return pal

def build_area_1():
    print("Initializing Zanac EX Engine...", flush=True)
    engine = ZanacExEngine()
    print("Loading Area 1...", flush=True)
    engine.load_stage(1)

    print("Stepping rows...", flush=True)
    rows_data = []
    # Area 1 has 565 rows
    for r in range(565):
        engine.call(0x571E)
        meta_row = bytes(engine.mem[0xCB30 : 0xCB40])
        pal = decode_pal(bytes(engine.mem[0xCBD0 : 0xCBF0]))
        rows_data.append((meta_row, pal))

    # Skip first 14 pre-scroll rows
    gameplay_rows = rows_data[14:]
    num_rows = len(gameplay_rows)
    img_w = 256
    img_h = num_rows * 16
    print(f"Rendering {num_rows} rows ({img_w}x{img_h})...", flush=True)
    map_img = Image.new('RGB', (img_w, img_h))
    px = map_img.load()

    for r_idx, (meta_row, pal) in enumerate(gameplay_rows):
        base_y = (num_rows - 1 - r_idx) * 16
        for c_idx, mt in enumerate(meta_row):
            base_x = c_idx * 16
            st0, st1, st2, st3 = engine.get_subtiles(mt)
            for st_id, ox, oy in [(st0, 0, 0), (st1, 8, 0), (st2, 0, 8), (st3, 8, 8)]:
                nibs = engine.subtiles[st_id]
                for py in range(8):
                    for px_i in range(8):
                        px[base_x + ox + px_i, base_y + oy + py] = pal[nibs[py * 8 + px_i]]

    out_path = os.path.join(OUT_DIR, 'area_01_ex_clean.png')
    map_img.save(out_path)
    print(f"Area 1 clean map saved: {out_path} ({map_img.size})", flush=True)

if __name__ == '__main__':
    build_area_1()

