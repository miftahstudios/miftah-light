// Game rules only (no drawing).
import * as C from './config.js';

export function dirVec(deg) {
  const r = (deg * Math.PI) / 180;
  return { x: Math.round(Math.sin(r)), z: Math.round(Math.cos(r)) };
}
const EPS = 1e-6;
const same = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS;
const onBoard = p => p.x >= -5 - EPS && p.x <= 5 + EPS && p.z >= -EPS && p.z <= 5 + EPS;
const inArena = p => p.x >= -6.25 - EPS && p.x <= 6.25 + EPS && p.z >= -1.25 - EPS && p.z <= 6.25 + EPS;

const MOVES = { up: { x: 0, z: 1 }, down: { x: 0, z: -1 }, left: { x: -1, z: 0 }, right: { x: 1, z: 0 } };

export class Game {
  constructor(chart, difficulty, events = {}) {
    this.hits = chart.charts[difficulty];
    this.sched = C.SPAWN[difficulty];
    this.ev = events;
    this.light = C.LIGHT_MAX;
    this.player = { ...C.PLAYER_START };
    this.wisps = [];
    this.nextId = 1;
    this.beatIndex = 0;
    this.beatCount = 0;
    this.judged = new Set();
    this.burstUntil = -Infinity;
    this.spawnK = 0;
    this.nextSpawnBeat = this.sched.first;
    this.stats = { perfect: 0, great: 0, good: 0, offbeat: 0, cleared: 0, contacts: 0 };
    this.lastHit = this.hits.length ? this.hits[this.hits.length - 1] : 0;
    this.score = 0;
    this.over = false;
    this.result = null;
  }

  emit(name, ...args) { this.ev[name]?.(...args); }

  changeLight(delta) {
    // Below the near-death threshold, light lost is multiplied by the modifier.
    if (delta < 0 && this.light < C.NEAR_DEATH_THRESHOLD) delta *= C.NEAR_DEATH_MODIFIER;
    this.light = Math.max(0, Math.min(C.LIGHT_MAX, this.light + delta));
    this.emit('onLight', this.light);
  }

  update(t) {
    if (this.over) return;
    while (this.beatIndex < this.hits.length && this.hits[this.beatIndex] <= t) {
      this.beat(t);
      this.beatIndex++;
      if (this.over) return;
    }
    if (t > this.lastHit + C.LEAD_OUT) this.end('complete');
  }

  // One chart hit reaching the line = one beat.
  beat(t) {
    this.beatCount++;
    // Existing shadows step first; one spawned this beat waits for the next beat.
    for (const w of [...this.wisps]) {
      const v = dirVec(w.dir);
      w.x += v.x * C.CELL;
      w.z += v.z * C.CELL;
      w.moves++;
      if (w.behavior.turnAt && w.moves === w.behavior.turnAt) w.dir = (w.dir + w.behavior.turn + 360) % 360;
      if (!inArena(w)) { this.remove(w); this.emit('onWispLeave', w); continue; }
      this.emit('onWispMove', w);
      if (!w.spent && same(w, this.player)) {
        if (t <= this.burstUntil) this.clear(w); else this.contact(w);
      }
    }
    if (this.beatCount === this.nextSpawnBeat) {
      const sp = C.SPAWN_POINTS[(this.spawnK * C.SPAWN_STEP) % C.SPAWN_POINTS.length];
      const w = { id: this.nextId++, x: sp.x, z: sp.z, dir: sp.dir, moves: 0, spent: false,
                  behavior: C.BEHAVIORS[this.spawnK % C.BEHAVIORS.length] };
      this.wisps.push(w);
      this.spawnK++;
      this.nextSpawnBeat += this.sched.every;
      this.emit('onSpawn', w);
    }
    this.emit('onBeat', this.beatCount, t);
  }

  judge(t) {
    let best = -1, bestErr = Infinity;
    // only hits near t can qualify; scan around the current beat index
    for (let i = Math.max(0, this.beatIndex - 4); i < Math.min(this.hits.length, this.beatIndex + 4); i++) {
      if (this.judged.has(i)) continue;
      const err = Math.abs(this.hits[i] - t);
      if (err < bestErr) { bestErr = err; best = i; }
    }
    if (best < 0 || bestErr > C.WINDOWS.good) return 'offbeat';
    this.judged.add(best);
    if (bestErr <= C.WINDOWS.perfect) return 'perfect';
    if (bestErr <= C.WINDOWS.great) return 'great';
    return 'good';
  }

  move(dirName, t) {
    if (this.over) return;
    const m = MOVES[dirName];
    if (!m) return;
    const grade = this.judge(t);
    this.stats[grade]++;
    if (grade !== 'offbeat') {
      this.score += C.SCORE[grade];
      this.changeLight(C.GAIN[grade]);
      this.burstUntil = t + C.BURST_TIME;
    }
    this.emit('onJudge', grade);
    const target = { x: this.player.x + m.x * C.CELL, z: this.player.z + m.z * C.CELL };
    if (!onBoard(target)) { this.emit('onBlocked', dirName); return; } // a wall blocks the move
    this.player = target;
    this.emit('onMove', target, dirName, grade);
    for (const w of [...this.wisps]) {
      if (!w.spent && same(w, target)) {
        if (grade !== 'offbeat') this.clear(w); else this.contact(w);
      }
    }
  }

  clear(w) {
    this.remove(w);
    this.stats.cleared++;
    this.score += C.SCORE.clear;
    this.changeLight(C.GAIN.clear);
    this.emit('onClear', w);
  }

  contact(w) {
    w.spent = true; // the shadow passes through but can only hurt once
    this.stats.contacts++;
    this.emit('onContact', w);
    this.changeLight(-C.CONTACT_DAMAGE);
    if (this.light <= 0) this.end('out');
  }

  remove(w) { this.wisps = this.wisps.filter(o => o !== w); }

  end(result) {
    if (this.over) return;
    this.over = true;
    this.result = result;
    if (result === 'complete') this.score += Math.round(this.light) * C.SCORE.lightLeft;
    this.emit('onEnd', result, this.stats, this.light, this.score);
  }
}
