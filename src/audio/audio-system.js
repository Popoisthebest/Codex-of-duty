// Budget tuned down after an intermittent 'AudioContext encountered an error
// from the audio device or the WebAudio renderer' fault during full 6v6 combat:
// twelve combatants bursting at once can request voices faster than the renderer
// retires them, and once the context faults the whole match goes silent.
const VOICE_BUDGET = 24;
// Highest priority in use; anything at this level may use the whole budget.
const MAX_PRIORITY = 3;

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
    // Voice accounting. A previous layering pass faulted the WebAudio context and
    // silenced the whole match, so growth in simultaneous voices is measured
    // rather than assumed.
    this.peakVoices = 0;
    this.droppedBudget = 0;
    this.droppedDistance = 0;
    this.voicesByKind = { gunfire: 0, footstep: 0, impact: 0, feedback: 0, other: 0 };
    this.peakSpatial = 0;
    this.spatialActive = 0;
    this.spatialSamples = 0;
    this.spatialTotal = 0;
    this.indoor = false;
    this.voices = new Set();
    this.listenerForward = ctx.camera.position.clone();
    this.listenerUp = ctx.camera.position.clone();
    this.rayDirection = ctx.camera.position.clone();
    this.unlock = () => this.ensureAudio();
    window.addEventListener('pointerdown', this.unlock, { passive: true });
    window.addEventListener('keydown', this.unlock, { passive: true });
    this.unsubscribers = [
      ctx.events.on('weapon:fired', () => this.gunshot()),
      ctx.events.on('ai:fired', (event) => this.combatantGunshot(event.origin, event.team)),
      ctx.events.on('ai:footstep', (event) => this.combatantFootstep(event)),
      ctx.events.on('weapon:dryfire', () => this.click()),
      ctx.events.on('weapon:reload', (event) => this.mechanical(event.phase)),
      ctx.events.on('projectile:impact', (event) => this.impact(event.surface, event.point)),
      ctx.events.on('player:footstep', (event) => this.footstep(event.surface, event.sprinting)),
      ctx.events.on('combat:damage', (event) => { if (event.targetType === 'player') this.damage(event.health); }),
      // Feedback the player had no audio for at all.
      ctx.events.on('match:kill', (event) => this.onKill(event)),
      ctx.events.on('match:respawn', (event) => { if (event.actorId === 'player') this.respawn(); }),
      ctx.events.on('match:phase', (event) => this.onPhase(event)),
      ctx.events.on('match:announce', (event) => this.announce(event?.kind)),
      // An enemy round that misses still passes somewhere; if it passes close it
      // should be heard doing so.
      ctx.events.on('ai:fired', (event) => this.onEnemyShot(event)),
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
    const hitDistance = this.ctx.get('physics').raycastWorldDistance(camera.position, this.rayDirection, distance);
    return hitDistance != null && hitDistance < distance - 0.16;
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

  trackVoice(source, kind = 'other', spatial = false) {
    this.eventsPlayed += 1;
    this.activeVoices += 1;
    if (this.activeVoices > this.peakVoices) this.peakVoices = this.activeVoices;
    this.voicesByKind[kind] = (this.voicesByKind[kind] ?? 0) + 1;
    if (spatial) {
      this.spatialActive += 1;
      if (this.spatialActive > this.peakSpatial) this.peakSpatial = this.spatialActive;
    }
    this.voices.add(source);
    source.addEventListener('ended', () => {
      if (this.voices.delete(source)) {
        this.activeVoices = Math.max(0, this.activeVoices - 1);
        if (spatial) this.spatialActive = Math.max(0, this.spatialActive - 1);
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
    this.peakVoices = 0;
    this.droppedBudget = 0;
    this.droppedDistance = 0;
    this.voicesByKind = { gunfire: 0, footstep: 0, impact: 0, feedback: 0, other: 0 };
    this.peakSpatial = 0;
    this.spatialActive = 0;
    this.spatialSamples = 0;
    this.spatialTotal = 0;
  }

  // Twelve combatants firing bursts can request far more simultaneous voices
  // than the WebAudio renderer will service; overloading it makes the whole
  // context fault out and the match goes silent. Sounds are budgeted, and
  // spatial ones outside their own falloff are dropped before any node is built.
  canPlay(position, maxDistance, priority = 0) {
    if (!this.audio) return false;
    // Priority reserves headroom for sounds that matter. The old formula was
    // `VOICE_BUDGET - priority * 8`, which inverted the meaning: a priority-3
    // gunfire tail got an allowance of zero and could never play at all, while a
    // priority -1 footstep was allowed 32 and pushed the peak past the budget
    // entirely. Now a higher priority simply gets to use more of the budget, and
    // VOICE_BUDGET remains a hard ceiling for everything.
    const limit = Math.max(4, VOICE_BUDGET - (MAX_PRIORITY - priority) * 4);
    if (this.activeVoices >= limit) { this.droppedBudget += 1; return false; }
    if (!position) return true;
    const camera = this.ctx.camera;
    const dx = position.x - camera.position.x; const dy = position.y - camera.position.y; const dz = position.z - camera.position.z;
    if ((dx * dx + dy * dy + dz * dz) > maxDistance * maxDistance) { this.droppedDistance += 1; return false; }
    return true;
  }

  noiseBurst({ duration = 0.1, gain = 0.2, highpass = 80, lowpass = 9000, delay = 0, position = null, spatial = false, reverb = 0.08, maxDistance = 45, priority = 0, kind = 'other' } = {}) {
    if (!this.canPlay(spatial ? position : null, maxDistance, priority)) return;
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
    this.trackVoice(source, kind, spatial);
    source.start(now, 0, Math.min(duration * 1.3, this.noise.duration));
    source.stop(now + duration + 0.02);
  }

  tone(frequency, duration, gain, type = 'sine', delay = 0, endFrequency = null, options = {}) {
    if (!this.canPlay(options.spatial ? options.position : null, options.maxDistance ?? 45, options.priority ?? 0)) return;
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
    this.trackVoice(oscillator, options.kind ?? 'other', Boolean(options.spatial));
    oscillator.start(now); oscillator.stop(now + duration + 0.01);
  }

  // The player's own rifle. Every shot used to be byte-identical, which is what
  // makes sustained fire read as a loop rather than a weapon, and it responded
  // the same in an alley as in the open. Three layers - mechanical transient,
  // blast body, tail - each varied per shot, with the tail carrying the room.
  gunshot() {
    // Small per-shot variation. Enough to break the loop, not enough to sound
    // like a different gun.
    const v = 0.94 + Math.random() * 0.12;
    const indoor = this.indoor;
    // Indoors the tail is louder, longer and darker; outdoors it thins out.
    const tailGain = indoor ? 0.26 : 0.11;
    const tailLength = indoor ? 0.46 : 0.3;
    const tailReverb = indoor ? 0.5 : 0.18;

    // Mechanical transient: the action, not the powder. Bright and very short.
    this.noiseBurst({ duration: 0.012, gain: 0.3 * v, highpass: 2600, lowpass: 13000, reverb: 0.02, priority: 3, kind: 'gunfire' });
    // Blast body.
    this.noiseBurst({ duration: 0.055 * v, gain: 0.95 * v, highpass: 180, lowpass: 11000 * v, reverb: indoor ? 0.2 : 0.1, priority: 3, kind: 'gunfire' });
    // Low-frequency weight.
    this.tone(155 * v, 0.09, 0.42 * v, 'sawtooth', 0, 58, { reverb: 0.07, priority: 3, kind: 'gunfire' });
    // Tail: what the room gives back.
    this.noiseBurst({
      duration: tailLength, gain: tailGain * v, highpass: indoor ? 140 : 100,
      lowpass: indoor ? 2400 : 1800, delay: 0.045, reverb: tailReverb, priority: 1, kind: 'gunfire',
    });
  }

  // Every other combatant's rifle used to play one identical sample regardless
  // of range or side, so a firefight forty metres away sounded exactly like one
  // at arm's length and there was no way to tell an ally from an enemy by ear.
  // Distance now crossfades a sharp near crack against a muffled far thump with
  // a longer tail, and the two teams get slightly different timbres.
  combatantGunshot(position, team = 'bravo') {
    this.enemyShotEvents += 1;
    if (!this.audio) return;
    const camera = this.ctx.camera;
    const distance = position
      ? Math.hypot(position.x - camera.position.x, position.y - camera.position.y, position.z - camera.position.z)
      : 30;
    const near = Math.max(0, Math.min(1, 1 - (distance - 8) / 34));
    const far = 1 - near;
    const ally = team === 'alpha';
    // Allied fire sits a little brighter and quieter so it reads as friendly.
    const bodyHz = ally ? 148 : 124;
    const gain = ally ? 0.56 : 0.72;

    // Near layer: transient crack with high content that the air strips out
    // with distance.
    if (near > 0.02) {
      this.noiseBurst({
        duration: 0.055, gain: gain * near, highpass: ally ? 210 : 170, lowpass: 4000 + near * 7000,
        position, spatial: true, reverb: 0.14, maxDistance: 70, priority: 3, kind: 'gunfire',
      });
      this.tone(bodyHz, 0.1, 0.3 * near, 'sawtooth', 0, 52, { position, spatial: true, reverb: 0.1, maxDistance: 70, priority: 2, kind: 'gunfire' });
    }
    // Far layer: the low thump plus a longer, wetter tail that carries.
    if (far > 0.02) {
      this.noiseBurst({
        duration: 0.09, gain: 0.42 * far, highpass: 60, lowpass: 900,
        position, spatial: true, reverb: 0.3, maxDistance: 110, priority: 2, kind: 'gunfire',
      });
      // Tail layer is the first thing sacrificed when the budget is tight.
      this.noiseBurst({
        duration: 0.34, gain: 0.16 * far, highpass: 90, lowpass: 1500, delay: 0.05 + far * 0.06,
        // Tail is the first thing sacrificed when the budget tightens.
        position, spatial: true, reverb: 0.46, maxDistance: 110, priority: 0, kind: 'gunfire',
      });
    }
  }

  click() { this.tone(1500, 0.018, 0.08, 'square', 0, null, { reverb: 0.02, priority: 3, kind: 'feedback' }); }

  // Reload has three distinct mechanical moments rather than one anonymous
  // rustle, so the player can hear where in the cycle the weapon is.
  mechanical(phase) {
    if (phase === 'complete') {
      this.noiseBurst({ duration: 0.03, gain: 0.16, highpass: 900, lowpass: 7000, reverb: 0.04, priority: 3, kind: 'feedback' });
      this.noiseBurst({ duration: 0.05, gain: 0.13, highpass: 400, lowpass: 3600, delay: 0.05, reverb: 0.05, priority: 3, kind: 'feedback' });
      this.tone(240, 0.05, 0.09, 'square', 0.05, 170, { reverb: 0.03, priority: 3, kind: 'feedback' });
      return;
    }
    // Magazine out: lighter, higher.
    this.noiseBurst({ duration: 0.035, gain: 0.11, highpass: 700, lowpass: 6000, reverb: 0.04, priority: 3, kind: 'feedback' });
  }
  // What a round hits. Previously one burst with two branches, so concrete, wood
  // and glass were indistinguishable and a body hit sounded like a wall hit. The
  // player has to be able to tell "I am hitting him" from "I am hitting cover".
  static IMPACT_VOICE = {
    // duration, gain, highpass, lowpass, reverb
    flesh: [0.055, 0.24, 70, 1100, 0.05],
    metal: [0.05, 0.2, 900, 9000, 0.18],
    glass: [0.07, 0.17, 1800, 12000, 0.16],
    wood: [0.045, 0.15, 260, 2600, 0.1],
    concrete: [0.042, 0.13, 380, 3400, 0.14],
    brick: [0.042, 0.13, 340, 3100, 0.14],
    foliage: [0.06, 0.08, 700, 5200, 0.06],
    fabric: [0.05, 0.09, 160, 1600, 0.05],
  };

  impact(surface, position) {
    const [duration, gain, highpass, lowpass, reverb] = AudioSystem.IMPACT_VOICE[surface]
      ?? AudioSystem.IMPACT_VOICE.concrete;
    const v = 0.9 + Math.random() * 0.2;
    this.noiseBurst({
      duration: duration * v, gain: gain * v, highpass, lowpass: lowpass * v,
      position, spatial: true, reverb, maxDistance: 40, kind: 'impact',
    });
    // A body hit gets a short low thud under the spatter so it reads as mass
    // rather than as another chip of stone.
    if (surface === 'flesh') {
      this.tone(96, 0.07, 0.16, 'sine', 0, 58, { position, spatial: true, reverb: 0.04, maxDistance: 40, kind: 'impact' });
    }
  }

  // A round passing close enough to matter. This is the cue that tells a player
  // they are being shot at rather than merely hearing shooting.
  nearMiss(distance) {
    const closeness = Math.max(0, Math.min(1, 1 - distance / 3.2));
    if (closeness <= 0.05) return;
    this.noiseBurst({
      duration: 0.03, gain: 0.3 * closeness, highpass: 1400, lowpass: 9000,
      reverb: 0.05, priority: 2, kind: 'gunfire',
    });
  }
  // A bot footfall: the same material response as the player's, placed in the
  // world and attenuated with distance. Quiet, and cheap enough that eleven
  // walking soldiers cannot exhaust the voice budget.
  combatantFootstep({ position, surface, sprinting }) {
    if (!this.audio) return;
    const camera = this.ctx.camera;
    const distance = Math.hypot(
      position.x - camera.position.x, position.y - camera.position.y, position.z - camera.position.z,
    );
    // Beyond this a footstep is inaudible anyway; skip it rather than spend a voice.
    if (distance > 26) return;
    const tile = surface === 'tile'; const concrete = surface === 'concrete';
    this.noiseBurst({
      duration: tile ? 0.045 : 0.065,
      gain: (sprinting ? 0.13 : 0.085) * 0.8,
      highpass: tile ? 180 : concrete ? 85 : 55,
      lowpass: tile ? 1500 : concrete ? 900 : 650,
      reverb: tile ? 0.13 : 0.07,
      spatial: true, position, maxDistance: 26, kind: 'footstep',
      // Low priority: under voice pressure footsteps are dropped before gunfire,
      // which is the cue that actually matters.
      priority: 0,
    });
  }

  footstep(surface, sprint) {
    this.lastFootstepSurface = surface;
    const tile = surface === 'tile'; const concrete = surface === 'concrete';
    // The player's own steps sit below gunfire. At the top priority they could
    // consume the entire budget on their own and mask the shots being fired at
    // the player, which is the one cue that must never be lost.
    this.noiseBurst({ duration: tile ? 0.045 : 0.065, gain: sprint ? 0.16 : 0.1, highpass: tile ? 180 : concrete ? 85 : 55, lowpass: tile ? 1500 : concrete ? 900 : 650, reverb: tile ? 0.13 : 0.07, priority: 2, kind: 'footstep' });
  }
  damage(health) {
    this.tone(68, 0.18, 0.16, 'sine', 0, 42, { reverb: 0.03, kind: 'feedback' });
    // Low health earns its own cue: a tight ringing over the hit, so the state
    // is audible without watching the vitals bar.
    if (Number.isFinite(health) && health > 0 && health <= 35) {
      this.tone(1750, 0.5, 0.05, 'sine', 0.04, 1500, { reverb: 0.0, kind: 'feedback' });
    }
  }

  // Kill confirmation, and a distinctly heavier one for the player's own death.
  onKill(event) {
    if (!event) return;
    // The kill feed carries display names, so the player is identified by theirs.
    const me = this.ctx.peek('match')?.getParticipant?.('player')?.name;
    if (!me) return;
    if (event.victim === me) { this.playerDeath(); return; }
    if (event.killer !== me) return;
    const headshot = event.hitZone === 'head';
    this.tone(headshot ? 1320 : 990, 0.055, 0.14, 'square', 0, headshot ? 1760 : 1320, { reverb: 0.02, kind: 'feedback', priority: 2 });
    this.tone(headshot ? 1980 : 1480, 0.05, 0.09, 'square', 0.045, null, { reverb: 0.02, kind: 'feedback', priority: 2 });
  }

  playerDeath() {
    // Descending body plus a long dark wash: the match stops mattering for a
    // moment, which is what the respawn wait feels like.
    this.tone(184, 0.7, 0.24, 'sawtooth', 0, 46, { reverb: 0.5, kind: 'feedback', priority: 3 });
    this.noiseBurst({ duration: 0.9, gain: 0.1, highpass: 40, lowpass: 620, delay: 0.03, reverb: 0.6, kind: 'feedback', priority: 3 });
  }

  respawn() {
    this.tone(420, 0.1, 0.1, 'triangle', 0, 700, { reverb: 0.05, kind: 'feedback', priority: 2 });
    this.noiseBurst({ duration: 0.14, gain: 0.07, highpass: 300, lowpass: 4200, delay: 0.06, reverb: 0.08, kind: 'feedback', priority: 2 });
  }

  onPhase(event) {
    if (event?.phase === 'active') {
      // Deployment: two rising notes, the match starting.
      this.tone(330, 0.16, 0.12, 'triangle', 0, 440, { reverb: 0.16, kind: 'feedback', priority: 3 });
      this.tone(494, 0.22, 0.11, 'triangle', 0.16, 587, { reverb: 0.2, kind: 'feedback', priority: 3 });
      return;
    }
    if (event?.phase !== 'ended') return;
    const player = this.ctx.peek('match')?.getParticipant?.('player');
    const won = player && event.winner === player.team;
    if (won) {
      for (const [i, hz] of [392, 494, 659].entries()) {
        this.tone(hz, 0.34, 0.12, 'triangle', i * 0.13, null, { reverb: 0.34, kind: 'feedback', priority: 3 });
      }
    } else {
      for (const [i, hz] of [392, 330, 262].entries()) {
        this.tone(hz, 0.42, 0.12, 'sawtooth', i * 0.15, null, { reverb: 0.38, kind: 'feedback', priority: 3 });
      }
    }
  }

  // Match-point and lead-change stingers, distinct from the end result.
  announce(kind) {
    if (kind === 'match-point') {
      this.tone(880, 0.16, 0.11, 'square', 0, 1174, { reverb: 0.24, kind: 'feedback', priority: 3 });
      return;
    }
    this.tone(587, 0.14, 0.09, 'triangle', 0, 740, { reverb: 0.2, kind: 'feedback', priority: 3 });
  }

  // Enemy fire that misses the player: if the round's path passes close to the
  // head, play a crack. Uses the shot's own end point, so it costs one distance
  // check rather than any new ballistics.
  onEnemyShot(event) {
    if (!this.audio || !event?.origin || !event?.end) return;
    if (event.team === 'alpha') return;
    if (event.hit) return;
    const camera = this.ctx.camera;
    const ax = event.origin.x; const ay = event.origin.y; const az = event.origin.z;
    const bx = event.end.x - ax; const by = event.end.y - ay; const bz = event.end.z - az;
    const length = bx * bx + by * by + bz * bz;
    if (length < 0.001) return;
    // Closest approach of the shot line to the listener.
    let t = ((camera.position.x - ax) * bx + (camera.position.y - ay) * by + (camera.position.z - az) * bz) / length;
    t = Math.max(0, Math.min(1, t));
    const distance = Math.hypot(
      ax + bx * t - camera.position.x, ay + by * t - camera.position.y, az + bz * t - camera.position.z,
    );
    if (distance < 3.2) this.nearMiss(distance);
  }

  update() {
    if (!this.audio) return;
    // Room response is sampled here, not per shot: a zone lookup per gunshot is
    // pure waste when the answer changes at walking speed.
    const camera = this.ctx.camera;
    if ((this.ctx.time?.frame ?? 0) % 15 === 0) {
      const zone = this.ctx.peek('world')?.zoneAt?.(camera.position.x, camera.position.z, camera.position.y);
      this.indoor = zone?.kind === 'indoor';
    }
    this.spatialSamples += 1;
    this.spatialTotal += this.spatialActive;
    const listener = this.audio.listener;
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
      // Voice accounting: the previous layering pass faulted the context and
      // silenced a whole match, so growth here is watched rather than assumed.
      peakVoices: this.peakVoices,
      voiceBudget: VOICE_BUDGET,
      droppedBudget: this.droppedBudget,
      droppedDistance: this.droppedDistance,
      voicesByKind: { ...this.voicesByKind },
      peakSpatialVoices: this.peakSpatial,
      averageSpatialVoices: this.spatialSamples
        ? Number((this.spatialTotal / this.spatialSamples).toFixed(2))
        : 0,
      indoor: this.indoor,
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
