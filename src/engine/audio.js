/**
 * Zanac EX WebPort - Audio System
 * Real AY-3-8910 PSG exact sound effects loaded from 44.1 kHz 16-bit PCM WAV recordings
 * alongside Enhanced Stereo OST tracks.
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.bgmAudio = null;
    this.bgmSources = [];
    this.bgmGain = null;
    this.bgmBuffers = new Map();
    this.bgmVolume = 0.55;
    this.sfxVolume = 0.65;
    this.isMuted = false;
    this.currentTrack = null;

    // Cache of decoded AudioBuffers for zero-latency, concurrent SFX playback
    this.sfxBuffers = new Map();
    this.sfxLoading = false;
    this.sfxLoaded = false;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (!this.bgmGain && this.ctx) {
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.setValueAtTime(this.isMuted ? 0 : this.bgmVolume, this.ctx.currentTime);
      this.bgmGain.connect(this.ctx.destination);
    }

    if (!this.sfxLoading && !this.sfxLoaded) {
      this.preloadAllSfx();
    }
  }

  async preloadAllSfx() {
    this.sfxLoading = true;

    const sfxList = [
      { name: 'shot_tier0', file: 'assets/sfx/shot_tier0.wav?v=2' },
      { name: 'shot_tier1', file: 'assets/sfx/shot_tier1.wav?v=2' },
      { name: 'shot_tier2', file: 'assets/sfx/shot_tier2.wav?v=2' },
      { name: 'subweapon_fire', file: 'assets/sfx/subweapon_fire.wav?v=2' },
      { name: 'subweapon_special', file: 'assets/sfx/subweapon_special.wav?v=2' },
      { name: 'powerup', file: 'assets/sfx/powerup.wav?v=2' },
      { name: 'player_explosion', file: 'assets/sfx/player_explosion.wav?v=2' },
      { name: 'player_damage', file: 'assets/sfx/player_damage.wav?v=2' },
      { name: 'weapon_switch', file: 'assets/sfx/weapon_switch.wav?v=2' },
      { name: 'warp', file: 'assets/sfx/warp.wav?v=2' },
    ];

    await Promise.all(
      sfxList.map(async ({ name, file }) => {
        try {
          const resp = await fetch(file);
          if (!resp.ok) {
            console.warn(`Failed to fetch sound: ${file}`);
            return;
          }
          const arrayBuf = await resp.arrayBuffer();
          const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
          this.sfxBuffers.set(name, audioBuf);
        } catch (e) {
          console.warn(`Error loading sound ${name} from ${file}:`, e);
        }
      })
    );

    this.sfxLoaded = true;
    this.sfxLoading = false;
    console.log(`[AudioManager] Loaded ${this.sfxBuffers.size} exact PSG sound effects!`);
  }

  async playBgm(trackFilename, loop = true) {
    this.init();
    this.stopBgm();
    this.currentTrack = trackFilename;

    // Area 1 track: use sample-accurate seamless intro + infinite loop (no fadeout)
    if (trackFilename.includes('Area 1') || trackFilename === 'area1') {
      try {
        const introUrl = 'assets/music/ex_stereo/area1_intro.wav?v=2';
        const mainUrl = 'assets/music/ex_stereo/area1_main_double.wav?v=2';

        if (!this.bgmBuffers.has('area1_intro')) {
          const [bIntro, bMain] = await Promise.all([
            fetch(introUrl).then(r => r.arrayBuffer()).then(ab => this.ctx.decodeAudioData(ab)),
            fetch(mainUrl).then(r => r.arrayBuffer()).then(ab => this.ctx.decodeAudioData(ab))
          ]);
          this.bgmBuffers.set('area1_intro', bIntro);
          this.bgmBuffers.set('area1_main', bMain);
        }

        const bIntro = this.bgmBuffers.get('area1_intro');
        const bMain = this.bgmBuffers.get('area1_main');

        const startTime = this.ctx.currentTime + 0.05;
        const sIntro = this.ctx.createBufferSource();
        sIntro.buffer = bIntro;
        sIntro.connect(this.bgmGain);

        const sMain = this.ctx.createBufferSource();
        sMain.buffer = bMain;
        sMain.loop = true;
        sMain.connect(this.bgmGain);

        sIntro.start(startTime);
        sMain.start(startTime + bIntro.duration);

        this.bgmSources = [sIntro, sMain];
        console.log(`[AudioManager] Playing Area 1: Intro (${bIntro.duration.toFixed(2)}s once) -> Main Loop (${bMain.duration.toFixed(2)}s infinite) without fadeout!`);
        return;
      } catch (err) {
        console.warn('[AudioManager] Failed to load seamless Area 1 BGM buffers, falling back to Audio element:', err);
      }
    }

    // Standard HTML5 Audio fallback
    const path = `assets/music/ex_stereo/${trackFilename}`;
    this.bgmAudio = new Audio(path);
    this.bgmAudio.loop = loop;
    this.bgmAudio.volume = this.isMuted ? 0 : this.bgmVolume;

    this.bgmAudio.play().catch(err => {
      console.log('Audio autoplay blocked, will start on first click/key press:', err.message);
    });
  }

  stopBgm() {
    if (this.bgmSources && this.bgmSources.length > 0) {
      this.bgmSources.forEach(s => {
        try { s.stop(); } catch (e) {}
      });
      this.bgmSources = [];
    }
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio = null;
    }
  }

  playBossMusic(trackFilename = '10 ZANAC 008 Boss.mp3') {
    this.playBgm(trackFilename, true);
  }

  playBossVictory(trackFilename = '12 ZANAC 010 Area Boss Destroyed.mp3', onComplete = null) {
    this.stopBgm();
    const path = `assets/music/ex_stereo/${trackFilename}`;
    const victoryAudio = new Audio(path);
    victoryAudio.volume = this.isMuted ? 0 : this.bgmVolume;
    victoryAudio.play().catch(e => console.warn('Victory audio play error:', e));
    if (onComplete) {
      victoryAudio.onended = onComplete;
    }
    return victoryAudio;
  }

  resumeAreaBgm(area = 1) {
    const a = ((area - 1) % 12) + 1;
    let track = '04 ZANAC 002 Area 1-3.mp3';
    if (a === 2 || a === 4) track = '05 ZANAC 003 Area 2-4.mp3';
    else if (a === 5 || a === 7 || a === 11) track = '06 ZANAC 004 Area 5-7-11.mp3';
    else if (a === 6 || a === 9) track = '07 ZANAC 005 Area 6-9.mp3';
    else if (a === 8 || a === 10) track = '08 ZANAC 006 Area 8-10.mp3';
    else if (a === 12) track = '09 ZANAC 007 Area 12.mp3';
    this.playBgm(track, true);
  }

  playSfx(name, volumeScale = 1.0) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    // Check if we have the authentic decoded WAV buffer
    const buffer = this.sfxBuffers.get(name);
    if (buffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(this.sfxVolume * volumeScale, this.ctx.currentTime);
      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start(0);
      return;
    }

    // Fallback synthesis if buffer isn't decoded yet
    this._playSynthFallback(name);
  }

  _playSynthFallback(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (name.startsWith('shot')) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(name === 'shot_tier2' ? 1400 : (name === 'shot_tier1' ? 1200 : 900), t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.08);
      gain.gain.setValueAtTime(this.sfxVolume * 0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    } else if (name === 'powerup') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const noteTime = t + idx * 0.045;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, noteTime);
        gain.gain.setValueAtTime(this.sfxVolume * 0.5, noteTime);
        gain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.08);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(noteTime);
        osc.stop(noteTime + 0.09);
      });
    } else if (name === 'player_explosion' || name === 'player_damage') {
      const duration = 0.45;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, t);
      filter.frequency.exponentialRampToValueAtTime(50, t + duration);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(this.sfxVolume * 0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(t);
    }
  }

  setBgmVolume(val) {
    this.bgmVolume = Math.max(0, Math.min(1, val));
    if (this.bgmAudio) {
      this.bgmAudio.volume = this.isMuted ? 0 : this.bgmVolume;
    }
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setValueAtTime(this.isMuted ? 0 : this.bgmVolume, this.ctx.currentTime);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.bgmAudio) {
      this.bgmAudio.volume = this.isMuted ? 0 : this.bgmVolume;
    }
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setValueAtTime(this.isMuted ? 0 : this.bgmVolume, this.ctx.currentTime);
    }
    return this.isMuted;
  }
}
