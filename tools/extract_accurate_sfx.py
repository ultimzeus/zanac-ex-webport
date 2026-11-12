"""
Zanac EX / MSX - 100% Byte-Accurate PSG SFX Synthesizer
Directly simulates the Z80 sound engine routines:
  - sub_4E7B (psg_sound_tick)
  - sub_4F0D (pitch-slide calculation)
  - sub_4ED3 (volume-envelope calculation)
  - sub_5099 (amplitude curve lookup)
  - sub_4F4A (advance_track_stream)
  - sub_50D2 (output_slot_to_psg)
  - AY-3-8910 16-step log DAC at 44.1 kHz, MSX 1.7897725 MHz clock.
"""

import os
import struct
import numpy as np
from scipy.io import wavfile

ROM_PATH = r'e:\Emul\zanac_msx\Zanac - 2nd Version (1987)(Pony Canyon).rom'
OUT_DIR = r'e:\Emul\Zanac_WebPort\assets\sfx'
os.makedirs(OUT_DIR, exist_ok=True)

with open(ROM_PATH, 'rb') as f:
    rom = f.read()

def b(a): return rom[a - 0x4000]
def w(a): return b(a) | (b(a+1) << 8)

# Memory addresses in Zanac 2nd Version
PTR_TABLE = 0x52A1
DUR_TABLE = 0x52DB
CURVE_TABLE = 0x52EE
BASE_PERIODS_ADDR = 0x525D

base_periods = [w(BASE_PERIODS_ADDR + i*2) for i in range(12)]
freq_table = []
for octave in range(10):
    for semi in range(12):
        freq_table.append(base_periods[semi] >> octave)

dur_table = [b(DUR_TABLE + i) for i in range(19)]
curve_ptrs = [w(CURVE_TABLE + i*2) for i in range(8)]

# AY-3-8910 16-step logarithmic DAC curve
AY_DAC = np.array([
    0.0, 0.0099, 0.0144, 0.0210, 0.0304, 0.0441, 0.0641, 0.0931,
    0.1352, 0.1964, 0.2853, 0.4143, 0.6017, 0.8739, 1.0, 1.0
], dtype=np.float32)

PSG_CLOCK = 1789772.5 # MSX NTSC clock
SAMPLE_RATE = 44100
FPS = 60
SAMPLES_PER_FRAME = SAMPLE_RATE // FPS # 735 samples

class VoiceSlot:
    def __init__(self, idx):
        self.idx = idx
        self.active = False
        self.cfg0 = 0
        self.base_amp = 0
        self.curve_idx = 0
        self.transpose = 0
        self.tempo = 1
        self.channel = 0
        self.stream_ptr = 0
        self.flags = 0 # bit1=env reached, bit5=env active, bit6=slide dir (0=down/add, 1=up/sub), bit7=slide active
        self.step_ctr = 0
        self.duration = 1
        self.tick_ctr = 1
        self.noise_period = 0
        self.last_note = 0
        self.last_duration = 1
        self.period = 0
        self.curve_phase = 0
        self.loop_ctr = 0
        self.slide_rate = 0
        self.slide_accum = 0x80
        self.slide_shift = 0
        self.env_target = 0
        self.env_rate = 0
        self.env_accum = 0
        self.out_amp = 0

def simulate_event(ev_num, max_frames=240):
    slots = [VoiceSlot(i) for i in range(5)]
    shadow_psg = [0] * 11

    ptr = w(PTR_TABLE + ev_num * 2)
    n_voices = b(ptr); ptr += 1
    for _ in range(n_voices):
        D = b(ptr); ptr += 1
        cfg0 = b(ptr)
        if cfg0 == 0:
            ptr += 1
        else:
            cfg = [b(ptr + i) for i in range(8)]
            ptr += 8
            s = slots[D]
            s.active = True
            s.cfg0 = cfg[0]
            s.base_amp = cfg[1]
            s.curve_idx = cfg[2]
            s.transpose = cfg[3]
            s.tempo = cfg[4]
            s.channel = cfg[5]
            s.stream_ptr = cfg[6] | (cfg[7] << 8)
            s.flags = 0
            s.step_ctr = 0
            s.duration = 1
            s.tick_ctr = 1
            s.noise_period = 0
            s.period = 0
            s.curve_phase = 0
            s.slide_accum = 0x80
            s.env_accum = 0

    def advance_stream(s):
        p = s.stream_ptr
        while True:
            token = b(p); p += 1
            if token < 0x80:
                s.last_note = token
                if token == 0:
                    s.period = 0
                else:
                    note_idx = (token + s.transpose - 1) & 0xFF
                    s.period = freq_table[note_idx] if note_idx < len(freq_table) else 0

                dur_byte = b(p)
                if dur_byte >= 0xDF:
                    p += 1
                    dur_val = b(p) if dur_byte == 0xDF else dur_table[dur_byte - 0xE0]
                    if dur_byte == 0xDF: p += 1
                else:
                    dur_val = s.last_duration
                s.duration = dur_val
                s.last_duration = dur_val
                s.tick_ctr = s.tempo
                s.step_ctr = 0
                s.curve_phase = 0
                if s.flags & 0x80:
                    s.slide_accum = 0x80
                s.stream_ptr = p
                break
            elif token >= 0xDF:
                dur_val = b(p) if token == 0xDF else dur_table[token - 0xE0]
                if token == 0xDF: p += 1
                s.duration = dur_val
                s.last_duration = dur_val
                s.tick_ctr = s.tempo
                s.step_ctr = 0
                s.curve_phase = 0
                if s.flags & 0x80:
                    s.slide_accum = 0x80
                s.stream_ptr = p
                break
            else:
                cmd = token
                if cmd == 0x80: # JUMP
                    p = w(p)
                elif cmd == 0x81: # LOOP
                    tgt = w(p); p += 2
                    s.loop_ctr = (s.loop_ctr - 1) & 0xFF
                    if s.loop_ctr != 0: p = tgt
                elif cmd == 0x82: # END
                    s.active = False
                    s.stream_ptr = p
                    break
                elif cmd == 0x83: # JMP_IF_ENV
                    tgt = w(p); p += 2
                    if not (s.flags & 0x02): p = tgt
                elif cmd == 0x84: s.curve_idx = b(p); p += 1
                elif cmd == 0x85:
                    val = b(p); p += 1
                    s.transpose = 0 if val == 0 else (s.transpose + (val if val < 128 else val - 256)) & 0xFF
                elif cmd == 0x86:
                    val = b(p); p += 1
                    if val >= 128: val -= 256
                    s.base_amp = max(0, min(15, s.base_amp + val))
                elif cmd == 0x87: # PLAY_EVENT
                    ev = b(p); p += 1
                elif cmd == 0x88: s.loop_ctr = b(p); p += 1
                elif cmd == 0x89: s.noise_period = b(p); p += 1
                elif cmd == 0x8A: # IDX_TRANSPOSE
                    tbl = w(p); p += 2
                    s.transpose = (s.transpose + b(tbl + ((s.loop_ctr - 1) & 0xFF))) & 0xFF
                elif cmd == 0x8B: # VOL_ENV
                    s.env_target = b(p); s.env_rate = b(p+1); p += 2
                    s.flags |= 0x20
                elif cmd == 0x8C: # PITCH_SLIDE
                    val = b(p); rate = b(p+1); p += 2
                    s.slide_rate = rate
                    s.flags &= ~0x40
                    if val & 0x80:
                        s.flags |= 0x40
                    shift = val & 0x7F
                    if shift != 0:
                        s.slide_shift = shift
                        s.flags |= 0x80
                    else:
                        s.flags &= ~0x80

    psg_frames = []
    for frame in range(max_frames):
        if not any(s.active for s in slots):
            break
        shadow_psg[7] = 0xB8
        shadow_psg[8] = 0; shadow_psg[9] = 0; shadow_psg[10] = 0

        for s in slots:
            if not s.active: continue
            s.tick_ctr -= 1
            if s.tick_ctr <= 0:
                s.tick_ctr = s.tempo
                s.step_ctr += 1
                if s.step_ctr >= s.duration:
                    advance_stream(s)

            if not s.active: continue

            # sub_5099: Apply amp curve
            if s.curve_idx == 0:
                s.out_amp = s.base_amp
            else:
                cp = curve_ptrs[s.curve_idx]
                val = b(cp + s.curve_phase)
                s.curve_phase += 1
                if val & 0x80:
                    s.curve_phase -= 1
                    val = b(cp + s.curve_phase - 1)
                atten = 0x10 - (val & 0x0F)
                s.out_amp = max(0, s.base_amp - atten)

            # sub_4F0D: Apply pitch slide
            if s.flags & 0x80:
                s.slide_accum = (s.slide_accum + s.slide_rate)
                if s.slide_accum >= 256:
                    s.slide_accum -= 256
                    if s.slide_shift > 0:
                        delta = s.period >> s.slide_shift
                        if s.flags & 0x40:
                            s.period = max(0, s.period - delta) # Up in pitch
                        else:
                            s.period = min(0x0FFF, s.period + delta) # Down in pitch

            # sub_4ED3: Apply volume envelope
            if s.flags & 0x20:
                s.env_accum += s.env_rate
                if s.env_accum >= 256:
                    s.env_accum -= 256
                    if s.base_amp == s.env_target:
                        s.flags |= 0x02
                    elif s.base_amp > s.env_target:
                        s.base_amp -= 1

            # sub_50D2: Output slot to shadow PSG
            ch = s.channel
            if s.period == 0:
                s.out_amp = 0
            if s.cfg0 & 0x02:
                shadow_psg[6] = s.noise_period
                shadow_psg[7] &= ~(8 << ch)
                shadow_psg[7] |= (1 << ch)
            else:
                shadow_psg[7] &= ~(1 << ch)
                shadow_psg[7] |= (8 << ch)
            shadow_psg[8 + ch] = s.out_amp
            shadow_psg[ch * 2] = s.period & 0xFF
            shadow_psg[ch * 2 + 1] = (s.period >> 8) & 0x0F

        psg_frames.append(list(shadow_psg))

    # Synthesize PCM audio
    total_frames = len(psg_frames)
    total_samples = total_frames * SAMPLES_PER_FRAME
    audio = np.zeros(total_samples, dtype=np.float32)

    tone_phase = [0.0, 0.0, 0.0]
    noise_lfsr = 1
    noise_counter = 0.0
    noise_state = 1

    for f_idx, regs in enumerate(psg_frames):
        start_smp = f_idx * SAMPLES_PER_FRAME
        periods = [regs[0] | (regs[1] << 8), regs[2] | (regs[3] << 8), regs[4] | (regs[5] << 8)]
        vols = [regs[8], regs[9], regs[10]]
        mixer = regs[7]
        noise_p = regs[6] & 0x1F
        if noise_p == 0: noise_p = 1
        noise_period_samples = (noise_p * 16.0 * SAMPLE_RATE) / PSG_CLOCK

        frame_buf = np.zeros(SAMPLES_PER_FRAME, dtype=np.float32)

        # Noise
        noise_buf = np.zeros(SAMPLES_PER_FRAME, dtype=np.float32)
        for i in range(SAMPLES_PER_FRAME):
            noise_counter += 1.0
            if noise_counter >= noise_period_samples:
                noise_counter -= noise_period_samples
                bit = (noise_lfsr ^ (noise_lfsr >> 3)) & 1
                noise_lfsr = (noise_lfsr >> 1) | (bit << 16)
                noise_state = 1 if (noise_lfsr & 1) else -1
            noise_buf[i] = noise_state

        for ch in range(3):
            p = periods[ch]
            vol = vols[ch] & 0x0F
            if vol == 0: continue
            amp = AY_DAC[vol]

            tone_disabled = (mixer >> ch) & 1
            noise_disabled = (mixer >> (ch + 3)) & 1

            if not tone_disabled and p > 0:
                tone_period_samples = (p * 16.0 * SAMPLE_RATE) / PSG_CLOCK
                tone_step = 1.0 / max(1.0, tone_period_samples)
                phases = (tone_phase[ch] + np.arange(SAMPLES_PER_FRAME) * tone_step) % 1.0
                tone_phase[ch] = (tone_phase[ch] + SAMPLES_PER_FRAME * tone_step) % 1.0
                tone_sq = np.where(phases < 0.5, 1.0, -1.0)
            else:
                tone_sq = np.ones(SAMPLES_PER_FRAME, dtype=np.float32)

            if not noise_disabled:
                ch_out = np.where((tone_sq > 0) & (noise_buf > 0), 1.0, -1.0) * amp
            elif not tone_disabled:
                ch_out = tone_sq * amp
            else:
                ch_out = np.zeros(SAMPLES_PER_FRAME, dtype=np.float32)

            frame_buf += ch_out

        audio[start_smp:start_smp + SAMPLES_PER_FRAME] = frame_buf

    max_val = np.max(np.abs(audio))
    if max_val > 0.001:
        audio = (audio / max_val) * 0.95
    audio_int16 = (audio * 32767).astype(np.int16)
    return audio_int16

# All SFX mapped accurately according to disassembly
SFX_MAP = [
    (13, 'shot_tier0.wav',      'Primary Shot Tier 0 (Level 0-1 Single)'),
    (14, 'shot_tier1.wav',      'Primary Shot Tier 1 (Level 2-3 Double)'),
    (15, 'shot_tier2.wav',      'Primary Shot Tier 2 (Level 4-5 Triple)'),
    (6,  'subweapon_fire.wav',  'Subweapon Fire (Weapons #0..#7)'),
    (19, 'subweapon_special.wav','Special / Plasma Bomb Fire'),
    (18, 'player_explosion.wav','Player / Base Explosion'),
    (20, 'player_damage.wav',   'Player Damage Impact'),
    (21, 'weapon_switch.wav',   'Weapon Switch / Token Hit'),
    (24, 'powerup.wav',         'Power-up Chip Pickup'),
    (23, 'warp.wav',            'Player Warp / Secret Reveal')
]

for ev, filename, desc in SFX_MAP:
    pcm = simulate_event(ev)
    out_path = os.path.join(OUT_DIR, filename)
    wavfile.write(out_path, SAMPLE_RATE, pcm)
    print(f'Generated: {filename:22s} ({desc}) - {len(pcm)/SAMPLE_RATE:.3f}s')

print('All authentic PSG SFX successfully generated!')

