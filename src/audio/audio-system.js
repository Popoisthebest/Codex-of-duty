export class AudioSystem {
  static id = 'audio';
  static deps = ['player', 'weapons', 'physics'];

  async init(ctx) {
    this.ctx = ctx;
    this.audio = null;
    this.master = null;
    this.noise = null;
    this.eventsPlayed = 0;
    this.spatialEvents = 0;
    this.occludedEvents = 0;
    this.activeVoices = 0;
    this.enemyShotEvents = 0;
    this.lastFootstepSurface = null;
    this.voices = new Set();
    this.listenerForward = ctx.camera.position.clone();
    this.listenerUp = ctx.camera.position.clone();
    this.rayDirection = ctx.camera.position.clone();
    this.unlock = () => this.ensureAudio();
    window.addEventListener('pointerdown', this.unlock, { passive: true });
    window.addEventListener('keydown', this.unlock, { passive: true });
    this.unsubscribers = [
      ctx.events.on('weapon:fired', () => this.gunshot()),
      ctx.events.on('ai:fired', (event) => this.enemyGunshot(event.origin)),
      ctx.events.on('weapon:dryfire', () => this.click()),
      ctx.events.on('weapon:reload', (event) => this.mechanical(event.phase)),
      ctx.events.on('projectile:impact', (event) => this.impact(event.surface, event.point)),
      ctx.events.on('player:footstep', (event) => this.footstep(event.surface, event.sprinting)),
      ctx.events.on('combat:damage', (event) => { if (event.targetType === 'player') this.damage(); }),
    ];
  }

  ensureAudio() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    if (!this.audio) {
      this.audio = new AudioCtor({ latencyHint: 'interactive' });
      this.master = this.audio.createGain();
      this.master.gain.value = 0.42;
      const compressor = this.audio.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 14;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.18;
      this.master.connect(compressor).connect(this.audio.destination);
      this.noise = this.createNoiseBuffer(1.2);
      this.reverb = this.audio.createConvolver();
      this.reverb.buffer = this.createImpulseBuffer(0.72);
      this.reverbReturn = this.audio.createGain();
      this.reverbReturn.gain.value = 0.17;
      this.reverb.connect(this.reverbReturn).connect(this.master);
    }
    if (this.audio.state === 'suspended') this.audio.resume();
  }

  createNoiseBuffer(seconds) {
    const length = Math.floor(this.audio.sampleRate * seconds);
    const buffer = this.audio.createBuffer(1, length, this.audio.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x12345678;
    for (let i = 0; i < length; i += 1) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[i] = ((state >>> 0) / 0x80000000 - 1) * (1 - i / length * 0.35);
    }
    return buffer;
  }

  createImpulseBuffer(seconds) {
    const length = Math.floor(this.audio.sampleRate * seconds);
    const buffer = this.audio.createBuffer(2, length, this.audio.sampleRate);
    let state = 0x4f1bbcdc;
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        const decay = Math.pow(1 - i / length, 2.65);
        data[i] = (((state >>> 0) / 0x80000000) - 1) * decay * (channel ? 0.82 : 0.9);
      }
    }
    return buffer;
  }

  isOccluded(position) {
    if (!position) return false;
    const camera = this.ctx.camera;
    this.rayDirection.set(position.x - camera.position.x, position.y - camera.position.y, position.z - camera.position.z);
    const distance = this.rayDirection.length();
    if (distance < 0.6) return false;
    this.rayDirection.multiplyScalar(1 / distance);
    const hit = this.ctx.get('physics').raycastWorld(camera.position, this.rayDirection, distance);
    return Boolean(hit && hit.distance < distance - 0.16);
  }

  createVoiceOutput(position, { spatial = false, reverb = 0.08, maxDistance = 45 } = {}) {
    const input = this.audio.createGain();
    const lowpass = this.audio.createBiquadFilter();
    lowpass.type = 'lowpass';
    const occluded = spatial && this.isOccluded(position);
    lowpass.frequency.value = occluded ? 920 : 16000;
    input.connect(lowpass);

    let output = lowpass;
    if (spatial && position) {
      const panner = this.audio.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1.35;
      panner.maxDistance = maxDistance;
      panner.rolloffFactor = 1.18;
      panner.coneInnerAngle = 270;
      panner.coneOuterAngle = 360;
      panner.coneOuterGain = 0.72;
      if (panner.positionX) {
        panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z;
      } else {
        panner.setPosition(position.x, position.y, position.z);
      }
      lowpass.connect(panner);
      output = panner;
      this.spatialEvents += 1;
      if (occluded) this.occludedEvents += 1;
    }

    const dry = this.audio.createGain();
    dry.gain.value = occluded ? 0.52 : 1;
    output.connect(dry).connect(this.master);
    if (reverb > 0) {
      const send = this.audio.createGain();
      send.gain.value = reverb * (occluded ? 1.4 : 1);
      output.connect(send).connect(this.reverb);
    }
    return input;
  }

  trackVoice(source) {
    this.eventsPlayed += 1;
    this.activeVoices += 1;
    this.voices.add(source);
    source.addEventListener('ended', () => {
      if (this.voices.delete(source)) {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
      }
    }, { once: true });
  }

  reset() {
    for (const source of this.voices) {
      try { source.stop(); } catch {}
      source.disconnect();
    }
    this.voices.clear();
    this.eventsPlayed = 0;
    this.spatialEvents = 0;
    this.occludedEvents = 0;
    this.activeVoices = 0;
    this.enemyShotEvents = 0;
    this.lastFootstepSurface = null;
  }

  noiseBurst({ duration = 0.1, gain = 0.2, highpass = 80, lowpass = 9000, delay = 0, position = null, spatial = false, reverb = 0.08, maxDistance = 45 } = {}) {
    if (!this.audio || this.audio.state !== 'running') return;
    const now = this.audio.currentTime + delay;
    const source = this.audio.createBufferSource();
    source.buffer = this.noise;
    const hp = this.audio.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = highpass;
    const lp = this.audio.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass;
    const envelope = this.audio.createGain();
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(hp).connect(lp).connect(envelope).connect(this.createVoiceOutput(position, { spatial, reverb, maxDistance }));
    this.trackVoice(source);
    source.start(now, 0, Math.min(duration * 1.3, this.noise.duration));
    source.stop(now + duration + 0.02);
  }

  tone(frequency, duration, gain, type = 'sine', delay = 0, endFrequency = null, options = {}) {
    if (!this.audio || this.audio.state !== 'running') return;
    const now = this.audio.currentTime + delay;
    const oscillator = this.audio.createOscillator();
    const envelope = this.audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(this.createVoiceOutput(options.position, options));
    this.trackVoice(oscillator);
    oscillator.start(now); oscillator.stop(now + duration + 0.01);
  }

  gunshot() {
    this.noiseBurst({ duration: 0.055, gain: 0.95, highpass: 180, lowpass: 11000, reverb: 0.12 });
    this.tone(155, 0.09, 0.42, 'sawtooth', 0, 58, { reverb: 0.07 });
    this.noiseBurst({ duration: 0.32, gain: 0.13, highpass: 100, lowpass: 1800, delay: 0.045, reverb: 0.22 });
  }

  enemyGunshot(position) {
    this.enemyShotEvents += 1;
    this.noiseBurst({ duration: 0.06, gain: 0.72, highpass: 170, lowpass: 9000, position, spatial: true, reverb: 0.16, maxDistance: 60 });
    this.tone(128, 0.11, 0.28, 'sawtooth', 0, 52, { position, spatial: true, reverb: 0.11, maxDistance: 60 });
  }

  click() { this.tone(1500, 0.018, 0.08, 'square', 0, null, { reverb: 0.02 }); }
  mechanical(phase) { this.noiseBurst({ duration: phase === 'complete' ? 0.055 : 0.035, gain: 0.12, highpass: 700, lowpass: 6000, reverb: 0.04 }); }
  impact(surface, position) { this.noiseBurst({ duration: 0.045, gain: surface === 'metal' ? 0.2 : 0.11, highpass: surface === 'flesh' ? 90 : 380, lowpass: surface === 'metal' ? 9000 : 3200, position, spatial: true, reverb: 0.12 }); }
  footstep(surface, sprint) {
    this.lastFootstepSurface = surface;
    const tile = surface === 'tile'; const concrete = surface === 'concrete';
    this.noiseBurst({ duration: tile ? 0.045 : 0.065, gain: sprint ? 0.16 : 0.1, highpass: tile ? 180 : concrete ? 85 : 55, lowpass: tile ? 1500 : concrete ? 900 : 650, reverb: tile ? 0.13 : 0.07 });
  }
  damage() { this.tone(68, 0.18, 0.16, 'sine', 0, 42, { reverb: 0.03 }); }

  update() {
    if (!this.audio) return;
    const listener = this.audio.listener;
    const camera = this.ctx.camera;
    camera.getWorldDirection(this.listenerForward);
    this.listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const now = this.audio.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(camera.position.x, now, 0.01);
      listener.positionY.setTargetAtTime(camera.position.y, now, 0.01);
      listener.positionZ.setTargetAtTime(camera.position.z, now, 0.01);
      listener.forwardX.setTargetAtTime(this.listenerForward.x, now, 0.01);
      listener.forwardY.setTargetAtTime(this.listenerForward.y, now, 0.01);
      listener.forwardZ.setTargetAtTime(this.listenerForward.z, now, 0.01);
      listener.upX.setTargetAtTime(this.listenerUp.x, now, 0.01);
      listener.upY.setTargetAtTime(this.listenerUp.y, now, 0.01);
      listener.upZ.setTargetAtTime(this.listenerUp.z, now, 0.01);
    } else {
      listener.setPosition(camera.position.x, camera.position.y, camera.position.z);
      listener.setOrientation(this.listenerForward.x, this.listenerForward.y, this.listenerForward.z, this.listenerUp.x, this.listenerUp.y, this.listenerUp.z);
    }
  }

  snapshot() {
    return {
      supported: Boolean(window.AudioContext || window.webkitAudioContext),
      state: this.audio?.state ?? 'uninitialized',
      eventsPlayed: this.eventsPlayed,
      spatialEvents: this.spatialEvents,
      occludedEvents: this.occludedEvents,
      activeVoices: this.activeVoices,
      enemyShotEvents: this.enemyShotEvents,
      lastFootstepSurface: this.lastFootstepSurface,
      reverbReady: Boolean(this.reverb?.buffer),
    };
  }

  dispose() {
    this.reset();
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.audio?.close();
  }
}
