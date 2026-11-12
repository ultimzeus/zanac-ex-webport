import os
import time
import z80
from PIL import Image

BIOS_PATH = r'e:\Emul\Bluemsx\Machines\Shared Roms\MSX.rom'
ROM_PATH = r'e:\Emul\zanac_msx\Zanac - 2nd Version (1987)(Pony Canyon).rom'
OUT_DIR = r'e:\Emul\zanac_msx\maps'
os.makedirs(OUT_DIR, exist_ok=True)

with open(BIOS_PATH, 'rb') as f:
    bios = f.read()[:0x4000]

with open(ROM_PATH, 'rb') as f:
    rom = f.read()

def w(a):
    return rom[a - 0x4000] | (rom[a - 0x4000 + 1] << 8)

# Authentic TMS9918 Palette matched to original Zanac game capture
tms9918_colors = [
    (0, 0, 0, 255),       # 0: Transparent -> Black backdrop (VDP R7 = 0x01)
    (0, 0, 0, 255),       # 1: Black
    (33, 200, 66, 255),   # 2: Medium Green (grass)
    (94, 220, 120, 255),  # 3: Light Green
    (32, 32, 244, 255),   # 4: Dark Blue (ocean)
    (76, 88, 255, 255),   # 5: Light Blue
    (180, 32, 34, 255),   # 6: Dark Red (authentic deep crimson)
    (83, 209, 223, 255),  # 7: Cyan
    (220, 40, 44, 255),   # 8: Medium Red (authentic game red ground)
    (255, 110, 110, 255), # 9: Light Red (crater rim highlights)
    (212, 193, 84, 255),  # 10: Dark Yellow
    (230, 206, 128, 255), # 11: Light Yellow
    (27, 168, 27, 255),   # 12: Dark Green
    (201, 91, 186, 255),  # 13: Magenta
    (178, 178, 178, 255), # 14: Gray
    (255, 255, 255, 255), # 15: White
]

class ZanacZ80Hardware:
    """Executes the real Z80 machine code from Zanac ROM + MSX1 BIOS with TMS9918 VRAM."""
    def __init__(self):
        self.m = z80.Z80Machine()
        self.m.set_memory_block(0x0000, bios)
        self.m.set_memory_block(0x4000, rom)
        sv = self.m.get_state_view()
        self.mem = sv[44 : 44 + 65536]

        self.vram = bytearray(0x4000)
        self.vdp_regs = [0] * 8
        self.vdp_latch = 0
        self.vdp_lo = 0
        self.vdp_addr = 0
        self.vram_dirty = True

        self.m.set_output_callback(self._on_out)
        self.m.set_input_callback(self._on_in)

        # Breakpoints: 0xFF00 = return trampoline, 0x99E5 = cmd 9 (end-of-stage jump)
        self.m.set_breakpoint(0xFF00)
        self.m.set_breakpoint(0x99E5)

        self.tile_cache = [None] * 256

    def _on_out(self, port, val):
        p = port & 0xFF
        if p == 0x99:
            if self.vdp_latch == 0:
                self.vdp_lo = val
                self.vdp_latch = 1
            else:
                self.vdp_latch = 0
                if val & 0x80:
                    self.vdp_regs[val & 7] = self.vdp_lo
                else:
                    self.vdp_addr = (self.vdp_lo | ((val & 0x3F) << 8)) & 0x3FFF
        elif p == 0x98:
            self.vdp_latch = 0
            if self.vram[self.vdp_addr] != val:
                self.vram[self.vdp_addr] = val
                if self.vdp_addr < 0x0800 or (0x2000 <= self.vdp_addr < 0x2800):
                    self.vram_dirty = True
            self.vdp_addr = (self.vdp_addr + 1) & 0x3FFF

    def _on_in(self, port):
        p = port & 0xFF
        if p == 0x98:
            self.vdp_latch = 0
            v = self.vram[self.vdp_addr]
            self.vdp_addr = (self.vdp_addr + 1) & 0x3FFF
            return v
        elif p == 0x99:
            self.vdp_latch = 0
            return 0x80
        return 0xFF

    def call_z80(self, addr, hl=None, ix=None):
        if hl is not None:
            self.m.hl = hl
        if ix is not None:
            self.m.ix = ix
        self.m.sp = 0xF37E
        self.mem[0xF37E] = 0x00
        self.mem[0xF37F] = 0xFF
        self.m.pc = addr
        while self.m.pc != 0xFF00 and self.m.pc != 0x99E5:
            self.m.ticks_to_stop = 10_000_000
            self.m.run()

    def cold_init(self):
        # 1. Execute ROM 0x5D96: decompress standard gameplay patterns (0x60DC) & colors (0x670E) to VRAM
        self.call_z80(0x5D96)
        # 2. Execute ROM 0x4221..0x4236 setup: base-layer column pointers in RAM
        self.mem[0xE2B4] = 0x47; self.mem[0xE2B5] = 0xA7  # 0xA747
        self.mem[0xE2B6] = 0x5F; self.mem[0xE2B7] = 0xA7  # 0xA75F
        self.mem[0xE2B8] = 0x77; self.mem[0xE2B9] = 0xA7  # 0xA777
        self.mem[0xE714] = 0x00
        self.mem[0xE715] = 0x00; self.mem[0xE716] = 0xE8

    def refresh_tiles(self):
        if not self.vram_dirty:
            return
        for t in range(256):
            img = Image.new('RGBA', (8, 8), (0, 0, 0, 255))
            px = img.load()
            base_p = t * 8
            base_c = 0x2000 + t * 8
            for y in range(8):
                pat_b = self.vram[base_p + y]
                col_b = self.vram[base_c + y]
                fg = tms9918_colors[col_b >> 4]
                bg = tms9918_colors[col_b & 0x0F]
                for x in range(8):
                    px[x, y] = fg if ((pat_b >> (7 - x)) & 1) else bg
            self.tile_cache[t] = img
        self.vram_dirty = False


def build_all_maps():
    hw = ZanacZ80Hardware()
    hw.cold_init()

    generated_maps = []

    # ROM table at 0x978C stores the 12 stage script pointers in descending order (Area 12 .. Area 1)
    for idx in range(11, -1, -1):
        stage_num = 12 - idx
        script_addr = w(0x978C + idx * 2)

        t0 = time.time()
        print(f"Building Area {stage_num:2d} via Z80 CPU execution (Script: 0x{script_addr:04X})...")

        # At 0x410A in ROM: when entering Area 12 (0x0C), call 0x5D51 to load mechanical core tiles into VRAM
        if stage_num == 12:
            hw.call_z80(0x5D51)

        # Call ROM 0x9728 to initialize stage script and clear stream slots 0xE2C0..0xE2FF
        hw.mem[0xE701] = stage_num
        hw.call_z80(0x9728, hl=script_addr, ix=0xE700)

        max_limit = 124 if stage_num == 12 else 4000
        row_Snapshots = []

        for r in range(max_limit):
            # Execute ROM 0x97F3 (map_script_step -> dispatches script commands & calls 0x9B5A scroll_map_reader)
            hw.call_z80(0x97F3, ix=0xE700)
            hw.mem[0xE700] &= ~1  # Clear VBlank pending bit so scroll_sync never blocks

            if hw.m.pc == 0x99E5:
                # Reached cmd 9 (end of stage script)
                break

            hw.refresh_tiles()
            row_tiles = bytes(hw.mem[0xEA48 : 0xEA60])
            # Capture the exact tile images active on this row (reflecting live cmd A VRAM color patches)
            row_Snapshots.append([hw.tile_cache[tid] for tid in row_tiles])

        num_rows = len(row_Snapshots)
        img_w = 24 * 8
        img_h = num_rows * 8
        map_img = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 255))

        for r_idx, row_imgs in enumerate(row_Snapshots):
            y = (num_rows - 1 - r_idx) * 8
            for c_idx, tile_img in enumerate(row_imgs):
                map_img.paste(tile_img, (c_idx * 8, y))

        out_map_path = os.path.join(OUT_DIR, f'area_{stage_num:02d}_full_map.png')
        map_img.save(out_map_path)
        dt = time.time() - t0
        print(f"  -> Area {stage_num:2d} saved: {out_map_path} ({num_rows} rows, {map_img.size}, {dt:.2f}s)")
        generated_maps.append((stage_num, out_map_path, map_img))

    # Build 12-area showcase
    print("\nCreating 12-area showcase...")
    thumb_w = 96
    thumb_h = 1000
    showcase = Image.new('RGBA', (thumb_w * 12 + 13 * 10, thumb_h + 40), (15, 15, 20, 255))
    for idx, (num, path, full_img) in enumerate(generated_maps):
        x = 10 + idx * (thumb_w + 10)
        y = 20
        crop_h = min(full_img.size[1], 1500)
        cropped = full_img.crop((0, 0, full_img.size[0], crop_h))
        thumb = cropped.resize((thumb_w, thumb_h), Image.Resampling.NEAREST)
        showcase.paste(thumb, (x, y))

    showcase_path = os.path.join(OUT_DIR, 'zanac_12_areas_showcase.png')
    showcase.save(showcase_path)
    print(f"Showcase saved to {showcase_path} ({showcase.size})")

if __name__ == '__main__':
    build_all_maps()
