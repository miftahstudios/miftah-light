// Song playback on the Web Audio clock, so hit timing stays sample-accurate.
export class SongPlayer {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.src = null;
    this.t0 = 0;
    this.offset = 0;
    this.playing = false;
    this.volume = 1;
    this.userOffset = 0; // seconds; positive = the player hears the music later (e.g. Bluetooth)
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  // Call inside a tap. On iPhone, web audio is muted by the silent switch unless the page
  // plays as media, and it stays locked until a sound starts during a tap.
  ensureContext() {
    if (!this.ctx) {
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      this.unlockIOS();
      // iOS stops the audio when earphones are unplugged or a call comes in; tell the game
      const ctx = this.ctx;
      ctx.addEventListener('statechange', () => {
        if (ctx === this.ctx && ctx.state !== 'running' && !this.selfPaused) { this.stalled = true; this.onLost?.(); }
      });
      if (!this.watchingDevices) {
        this.watchingDevices = true;
        navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (this.playing) { this.stalled = true; this.onLost?.(); } });
      }
      this.clockSeen = { t: ctx.currentTime, at: performance.now() };
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
    return this.ctx;
  }

  unlockIOS() {
    // a one-sample silent buffer unlocks the context
    const b = this.ctx.createBuffer(1, 1, 22050);
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    // older iOS: a playing <audio> element switches the session to media, ignoring the silent switch
    if (!navigator.audioSession) {
      const el = document.createElement('audio');
      el.setAttribute('x-webkit-airplay', 'deny');
      el.loop = true;
      el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      el.play().catch(() => {});
      this.mediaEl = el;
    }
  }

  async load(url) {
    const ctx = this.ensureContext();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    this.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    return this.buffer.duration;
  }

  play(offset, onEnded) {
    this.stop();
    this.onEnded = onEnded;
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    this.src = src;
    this.offset = offset;
    this.t0 = ctx.currentTime + 0.15;
    // only the source that is still current may end the run (a stopped one fires 'ended' late)
    src.onended = () => { if (this.src === src && this.playing) { this.playing = false; onEnded?.(); } };
    src.start(this.t0, offset);
    this.playing = true;
  }

  // Song position in seconds, corrected for the device's output delay.
  time() {
    if (!this.ctx) return 0;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.ctx.currentTime - this.t0 + this.offset - latency - this.userOffset;
  }

  // Suspending the audio clock also freezes time(), so the game pauses with the music.
  pause() { if (this.ctx && this.ctx.state === 'running') { this.selfPaused = true; return this.ctx.suspend(); } }
  resume() { // call inside a tap; iOS also uses 'interrupted'
    this.selfPaused = false;
    if (this.mediaEl) this.mediaEl.play().catch(() => {});
    if (this.stalled && this.playing) return this.rebuild();
    if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume();
  }

  // iPhone: when AirPods disconnect the audio clock can freeze while the state still says 'running'.
  // Call every frame while a song plays; returns true once the clock has stopped for 0.4 s.
  isFrozen() {
    if (!this.ctx || !this.playing || this.selfPaused) return false;
    const now = performance.now(), t = this.ctx.currentTime;
    if (t !== this.clockSeen.t) { this.clockSeen = { t, at: now }; return false; }
    if (now - this.clockSeen.at > 400) { this.stalled = true; return true; }
    return false;
  }

  // Throw away a jammed audio context and carry on from the same song position in a fresh one.
  rebuild() {
    const pos = this.ctx.currentTime - this.t0 + this.offset;
    const old = this.ctx;
    this.stop();
    this.ctx = null;
    try { old.close(); } catch { /* already closed */ }
    this.stalled = false;
    this.play(Math.max(0, pos), this.onEnded);
  }

  stop() {
    this.playing = false;
    if (this.src) { try { this.src.stop(); } catch { /* already stopped */ } this.src.disconnect(); this.src = null; }
  }
}
