import { Scene } from './scene.js';
import { Game, MOVES, dirVec } from './game.js';
import { Hud } from './hud.js';
import { SongPlayer } from './audio.js';
import { bindInput } from './input.js';
import { save } from './save.js';
import { SCORE, LEAD_OUT, WINDOWS, CELL, PLAYER_START, GAIN, BURST_TIME } from './config.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const params = new URLSearchParams(location.search);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { songs: [], charts: {}, index: 0, difficulty: save.settings.difficulty, game: null, running: false, tutorial: null, practice: false };
const scene = new Scene($('#stage'));
const hud = new Hud(document);
const player = new SongPlayer();
state.player = player;
player.onLost = () => pause(); // earphones unplugged etc.: pause so Resume (a tap) restarts the sound
state.scene = scene;
window.__ml = state; // handy for testing in the browser console

function show(panel) {
  for (const p of $$('.panel')) p.hidden = p.id !== panel;
  $('#hud').hidden = panel !== null;
  if (panel === 'levels') renderLevels();
  if (panel === 'settings') renderSettings();
  if (panel === 'menu') {
    // Brand-new players see the tutorial as the first step; everyone else sees Play.
    const isNew = !save.tutorialDone && save.completed() === 0;
    $('#learn').classList.toggle('primary', isNew);
    $('#play').classList.toggle('primary', !isNew);
  }
}

// ---------- song list ----------
function renderLevels() {
  for (const b of $$('[data-difficulty]')) b.classList.toggle('on', b.dataset.difficulty === state.difficulty);
  $('#song-list').innerHTML = state.songs.map((s, i) => {
    const open = save.isUnlocked(state.songs, i);
    const best = save.best(s.id, state.difficulty);
    const mins = `${Math.floor(s.duration / 60)}:${String(Math.round(s.duration % 60)).padStart(2, '0')}`;
    return `<li><button class="song ${open ? '' : 'locked'} ${save.isCompleted(s.id) ? 'done' : ''}" data-index="${i}" ${open ? '' : 'disabled'}>
      <span class="num">${i + 1}</span>
      <span class="title" dir="auto">${esc(s.title)}</span>
      <span class="meta">${open ? (best != null ? `Best ${best.toLocaleString()}` : mins) : 'Locked'}</span>
    </button></li>`;
  }).join('');
}

// ---------- settings ----------
function renderSettings() {
  const st = save.settings;
  $('#name').value = save.name;
  $('#volume').value = st.volume;
  $('#offset').value = st.offsetMs;
  $('#volume-value').textContent = `${Math.round(st.volume * 100)}%`;
  $('#offset-value').textContent = `${st.offsetMs > 0 ? '+' : ''}${st.offsetMs} ms`;
}

function applySettings() {
  player.setVolume(save.settings.volume);
  player.userOffset = save.settings.offsetMs / 1000;
}

// ---------- interactive tutorial ----------
// Four steps on the real board, each must be passed to advance. The beat is a
// steady 1 s metronome with a tick; the lane shows the beats like a song.
// Passing all four steps opens a full practice round of level 1.
const TUT_BEAT_MS = 1000;
const TUT_FIRST_BEAT_MS = 700;
const TUT_STEPS = 4;
const TUT_TEXT = [
  { step: 'Step 1 of 4', text: 'Move the orb — swipe up, or press the up arrow key.' },
  { step: 'Step 2 of 4', text: 'Move on the beat — watch the dots slide to the ring. Move when a dot touches it.' },
  { step: 'Step 3 of 4', text: 'Clear a shadow — wait until it is one square away, then move into it right on the beat.' },
  { step: 'Step 4 of 4', text: 'Win your Light back — a shadow caught you and your Light is at 50. Burst a shadow on the beat to win some back.' },
];

function accuracy(stats) {
  const total = stats.perfect + stats.great + stats.good + stats.offbeat;
  if (!total) return 0;
  return (stats.perfect + stats.great * (2 / 3) + stats.good * (1 / 3)) / total;
}
function gradeFor(acc) {
  return acc >= 0.95 ? 'S' : acc >= 0.9 ? 'A' : acc >= 0.8 ? 'B' : acc >= 0.7 ? 'C' : 'D';
}
const sameCell = (a, b) => a.x === b.x && a.z === b.z;

class Tutorial {
  constructor() {
    this.step = 0;
    this.player = { ...PLAYER_START };
    this.light = 100;
    this.wisps = [];
    this.nextId = 1;
    this.t0 = performance.now();
    this.beatCount = 0;
    this.nextBeatAt = this.t0 + TUT_FIRST_BEAT_MS;
    this.burstUntil = -Infinity;
    this.judged = new Set();
    this.hits = [];
    for (let i = 0; i < 240; i++) this.hits.push((TUT_FIRST_BEAT_MS + i * TUT_BEAT_MS) / 1000);
    this.passed = false;
    this.showStep();
  }

  get nowSec() { return (performance.now() - this.t0) / 1000; }

  beatIndexAt(t) { return Math.max(0, Math.round((t - TUT_FIRST_BEAT_MS / 1000) / (TUT_BEAT_MS / 1000))); }

  grade(t) {
    const beat = TUT_FIRST_BEAT_MS / 1000 + this.beatIndexAt(t) * (TUT_BEAT_MS / 1000);
    const err = t - beat, a = Math.abs(err);
    if (a <= WINDOWS.perfect) return ['perfect', err];
    if (a <= WINDOWS.great) return ['great', err];
    if (a <= WINDOWS.good) return ['good', err];
    return ['offbeat', err];
  }

  setHint(msg) {
    const el = $('#tut-hint');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  showStep() {
    const s = TUT_TEXT[this.step];
    $('#tut-step').textContent = s.step;
    $('#tut-text').textContent = s.text;
    this.setHint('');
    document.querySelectorAll('#tut-dots span').forEach((d, i) => d.classList.toggle('done', i < this.step));
    if (this.step === 3) { this.light = 50; hud.setLight(50); }
    if (this.step >= 2) this.spawnShadow();
  }

  spawnShadow() {
    const p = this.player;
    const fromTop = p.z <= 2.5;
    const w = { id: this.nextId++, x: p.x, z: fromTop ? p.z + 2 * CELL : p.z - 2 * CELL,
                dir: fromTop ? 180 : 0, moves: 0, spent: false };
    this.wisps.push(w);
    scene.addWisp(w);
  }

  tick() {
    try {
      const ctx = player.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 660; o.type = 'sine';
      g.gain.setValueAtTime(0.05, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.07);
    } catch { /* the metronome is a nicety; never break the tutorial */ }
  }

  update(nowMs) {
    while (this.nextBeatAt <= nowMs) { this.onBeat(); this.nextBeatAt += TUT_BEAT_MS; }
    if (this.hits.length < this.beatCount + 5) {
      const n = this.hits.length;
      for (let i = 0; i < 10; i++) this.hits.push((TUT_FIRST_BEAT_MS + (n + i) * TUT_BEAT_MS) / 1000);
    }
    hud.draw(this.nowSec, this.step === 0 ? [] : this.hits, this.judged, this.beatCount);
  }

  onBeat() {
    this.beatCount++;
    scene.beat(); hud.beat(); this.tick();
    for (const w of [...this.wisps]) {
      const v = dirVec(w.dir);
      w.x += v.x * CELL; w.z += v.z * CELL; w.moves++;
      // off the board without meeting the orb: it is gone, a fresh one comes
      if (w.x < -6.25 || w.x > 6.25 || w.z < -1.25 || w.z > 6.25) {
        this.wisps = this.wisps.filter(o => o !== w);
        scene.removeWisp(w);
        continue;
      }
      scene.moveWisp(w);
      if (sameCell(w, this.player)) {
        if (this.nowSec <= this.burstUntil) this.clearWisp(w);
        else this.wispPassed(w);
      }
    }
    if ((this.step === 2 || this.step === 3) && !this.passed && this.wisps.length === 0) this.spawnShadow();
  }

  wispPassed(w) {
    this.wisps = this.wisps.filter(o => o !== w);
    scene.spendWisp(w);
    scene.removeWisp(w);
    this.setHint('It slipped past — wait until it is one square away, then move into it on the beat.');
  }

  clearWisp(w) {
    this.wisps = this.wisps.filter(o => o !== w);
    scene.burst(w);
    this.light = Math.min(100, this.light + GAIN.clear);
    hud.setLight(this.light);
    this.completeStep();
  }

  handleMove(dir) {
    if (this.passed) return;
    const t = this.nowSec;
    const m = MOVES[dir];
    const target = { x: this.player.x + m.x * CELL, z: this.player.z + m.z * CELL };
    if (target.x < -5 || target.x > 5 || target.z < 0 || target.z > 5) {
      this.setHint("That's the edge of the board — try another direction.");
      return;
    }
    const [grade, err] = this.grade(t);
    const wispHere = this.wisps.find(w => !w.spent && sameCell(w, target));
    if (wispHere && grade !== 'offbeat') {
      this.player = target;
      scene.movePlayer(target);
      hud.judge(grade, SCORE[grade] + SCORE.clear);
      this.judged.add(this.beatIndexAt(t));
      this.burstUntil = t + BURST_TIME;
      this.clearWisp(wispHere);
      return;
    }
    this.player = target;
    scene.movePlayer(target);
    if (this.step === 0) {
      if (dir === 'up') this.completeStep();
      else this.setHint("Good — that's a move! Now try swiping up.");
      return;
    }
    if (grade === 'offbeat') {
      hud.judge('offbeat');
      this.setHint(err < 0 ? 'Too early — wait for the dot to reach the ring.' : 'Too late — move a little sooner.');
      return;
    }
    this.judged.add(this.beatIndexAt(t));
    hud.judge(grade, SCORE[grade]);
    this.burstUntil = t + BURST_TIME;
    if (this.step === 1) this.completeStep();
    else if (this.step >= 2) this.setHint('On the beat! Now move into the shadow when it is one square away.');
  }

  completeStep() {
    for (const w of [...this.wisps]) scene.removeWisp(w);
    this.wisps = [];
    this.step++;
    if (this.step >= TUT_STEPS) { this.finishTutorial(); return; }
    this.showStep();
  }

  finishTutorial() {
    this.passed = true;
    save.setTutorialDone();
    $('#tut-step').textContent = 'Tutorial complete';
    $('#tut-text').textContent = 'You passed! Now finish level 1 in a practice round — your Light can’t run out.';
    this.setHint('');
    document.querySelectorAll('#tut-dots span').forEach(d => d.classList.add('done'));
    $('#tut-go').hidden = false;
  }
}

function startTutorial() {
  stopRun();
  state.practice = false;
  state.tutorial = new Tutorial();
  document.body.classList.add('tutorial');
  $('#tutorial').hidden = false;
  $('#tut-go').hidden = true;
  scene.reset({ ...PLAYER_START });
  hud.setLight(100);
  hud.setScore(0);
  hud.setSong('Tutorial');
  hud.setProgress(0);
  player.ensureContext();
  show(null);
}

function endTutorial() {
  state.tutorial = null;
  document.body.classList.remove('tutorial');
  $('#tutorial').hidden = true;
  $('#tut-go').hidden = true;
}

// ---------- play ----------
async function start(index = state.index, opts = {}) {
  state.index = index;
  state.practice = !!opts.practice;
  endTutorial();
  const song = state.songs[index];
  const chart = state.charts[song.id];
  show('loading');
  $('#loading-text').textContent = 'Loading…';
  player.ensureContext(); // inside the tap, so phones allow sound
  applySettings();
  try {
    if (player.loadedId !== song.id) {
      const dur = await player.load(song.file);
      player.loadedId = song.id;
      if (Math.abs(dur - chart.duration) > 0.5) {
        console.warn(`Song length ${dur.toFixed(2)}s differs from chart length ${chart.duration}s; charts need re-measuring.`);
      }
    }
  } catch (err) {
    $('#loading-text').textContent = `Could not load the song: ${err.message}`;
    setTimeout(() => show('levels'), 2500);
    return;
  }

  const game = new Game(chart, state.difficulty, {
    onSpawn: w => scene.addWisp(w),
    onWispMove: w => scene.moveWisp(w),
    onWispLeave: w => scene.removeWisp(w),
    onClear: w => { scene.burst(w); hud.bonus(SCORE.clear); },
    onContact: w => { scene.spendWisp(w); scene.hurt(); hud.judge('miss'); },
    onMove: p => scene.movePlayer(p),
    onJudge: g => hud.judge(g, SCORE[g] || 0),
    onLight: v => hud.setLight(v),
    onBeat: () => { scene.beat(); hud.beat(); },
    onEnd: finish,
  }, { practice: state.practice });
  state.game = game;
  state.paused = false;
  scene.reset(game.player);
  hud.setLight(game.light);
  hud.setSong(song.title + (state.practice ? ' · Practice' : ''));
  hud.setScore(0);
  hud.setProgress(0);

  // 3-2-1, then the music starts (lead-in of ~2 s before the first hit follows)
  const token = (state.countToken = (state.countToken || 0) + 1);
  $('#count-song').textContent = song.title;
  $('#count-diff').textContent = state.difficulty[0].toUpperCase() + state.difficulty.slice(1);
  show('countdown');
  for (const n of [3, 2, 1]) {
    $('#count').textContent = n;
    $('#count').classList.remove('tick'); void $('#count').offsetWidth; $('#count').classList.add('tick');
    await new Promise(r => setTimeout(r, 700));
    if (token !== state.countToken) return;
  }
  show(null);
  state.running = true;
  state.span = [chart.start_offset, game.lastHit + LEAD_OUT];
  player.play(chart.start_offset, () => game.end(game.light > 0 ? 'complete' : 'out'));
}

function pause() {
  if (!state.running || state.paused) return;
  state.paused = true;
  player.pause();
  show('paused');
}

function resume() {
  if (!state.paused) return;
  state.paused = false;
  show(null);
  player.resume();
}

function stopRun() {
  state.running = false;
  state.paused = false;
  if (state.game) state.game.over = true;
  player.stop();
  player.resume();
  if (state.game) scene.reset(state.game.player);
}

function quit() {
  stopRun();
  show('levels');
}

function finish(result, stats, light, score) {
  state.running = false;
  player.stop();
  const song = state.songs[state.index];
  const complete = result === 'complete';
  const practice = state.practice;
  const acc = accuracy(stats);
  const grade = gradeFor(acc);
  let rank = 0, newBest = false, unlockedNext = false;
  if (complete && !practice) {
    const nextWasOpen = save.isUnlocked(state.songs, state.index + 1);
    save.complete(song.id);
    unlockedNext = state.index + 1 < state.songs.length && !nextWasOpen;
    ({ rank, newBest } = save.record(song.id, state.difficulty,
      { name: save.name || 'Player', score, light: Math.round(light), date: Date.now() }));
  }

  $('#result-title').textContent = practice ? 'Practice complete' : complete ? 'Song complete' : 'The light went out';
  $('#result-song').textContent = song.title;
  $('#result-score').textContent = score.toLocaleString();
  $('#new-best').hidden = !newBest;
  $('#practice-tag').hidden = !practice;
  $('#board-wrap').hidden = practice;
  $('#result-stats').innerHTML = [
    ['Light left', Math.round(light)], ['Shadows cleared', stats.cleared],
    ['Perfect', stats.perfect], ['Great', stats.great], ['Good', stats.good],
    ['Off beat', stats.offbeat], ['Hit by shadows', stats.contacts],
    ['Accuracy', `${Math.round(acc * 100)}%`], ['Grade', grade],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#unlocked').hidden = !unlockedNext;
  if (unlockedNext) $('#unlocked').innerHTML = `Unlocked: <bdi>${esc(state.songs[state.index + 1].title)}</bdi>`;

  if (!practice) {
    const board = save.leaderboard(song.id, state.difficulty);
    $('#leaderboard').innerHTML = board.length
      ? board.slice(0, 5).map((e, i) => `<li class="${i + 1 === rank ? 'me' : ''}"><span>${esc(e.name)}</span><span>${e.score.toLocaleString()}</span></li>`).join('')
      : '<li class="empty">Complete the song to get on the board.</li>';
  }

  if (practice) {
    $('#next').hidden = false;
    $('#next').textContent = 'Play level 1 for real';
    $('#next').classList.add('primary');
    $('#retry').textContent = 'Practice again';
    $('#retry').classList.remove('primary');
  } else {
    $('#next').textContent = 'Next song';
    $('#retry').textContent = 'Play again';
    const hasNext = state.index + 1 < state.songs.length && save.isUnlocked(state.songs, state.index + 1);
    $('#next').hidden = !hasNext;
    $('#next').classList.remove('primary');
    $('#retry').classList.toggle('primary', !hasNext);
  }
  setTimeout(() => show('results'), 600);
}

// ---------- wiring ----------
async function boot() {
  const [songs, charts] = await Promise.all([
    fetch('songs.json').then(r => r.json()),
    fetch('charts.json').then(r => r.json()),
  ]);
  state.songs = songs;
  state.charts = charts;

  $('#play').addEventListener('click', () => show('levels'));
  $('#learn').addEventListener('click', startTutorial);
  $('#howto-learn').addEventListener('click', startTutorial);
  $('#tut-exit').addEventListener('click', () => { endTutorial(); show('menu'); });
  $('#tut-go').addEventListener('click', () => { endTutorial(); start(0, { practice: true }); });
  $('#open-settings').addEventListener('click', () => show('settings'));
  for (const b of $$('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
  for (const b of $$('[data-difficulty]')) b.addEventListener('click', () => {
    state.difficulty = b.dataset.difficulty;
    save.setSetting('difficulty', state.difficulty);
    renderLevels();
  });
  $('#song-list').addEventListener('click', e => {
    const b = e.target.closest('button.song');
    if (b && !b.disabled) start(Number(b.dataset.index), { practice: false });
  });
  $('#retry').addEventListener('click', () => start(state.index, { practice: state.practice }));
  $('#next').addEventListener('click', () => { if (state.practice) start(0, { practice: false }); else start(state.index + 1, { practice: false }); });
  $('#pause').addEventListener('click', pause);
  $('#resume').addEventListener('click', resume);
  $('#restart').addEventListener('click', () => { stopRun(); start(state.index, { practice: state.practice }); });
  $('#quit').addEventListener('click', quit);
  window.addEventListener('keydown', e => { if (e.code === 'Escape') (state.paused ? resume : pause)(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  $('#name').addEventListener('change', e => { save.name = e.target.value; });
  $('#volume').addEventListener('input', e => { save.setSetting('volume', Number(e.target.value)); renderSettings(); applySettings(); });
  $('#offset').addEventListener('input', e => { save.setSetting('offsetMs', Number(e.target.value)); renderSettings(); applySettings(); });

  bindInput($('#stage'), dir => {
    if (state.tutorial) { state.tutorial.handleMove(dir); return; }
    if (state.running && !state.paused) state.game.move(dir, player.time());
  });

  const direct = songs.findIndex(s => s.id === params.get('song'));
  if (direct >= 0 && save.isUnlocked(songs, direct)) state.index = direct;
  show('menu');
  requestAnimationFrame(loop);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = state.running ? player.time() : now / 1000;
  if (state.running && !state.paused && player.isFrozen()) pause(); // AirPods out etc.
  if (state.running && !state.paused) {
    state.game.update(t);
    hud.draw(t, state.game.hits, state.game.judged, state.game.beatIndex);
    hud.setScore(state.game.score);
    const [a, b] = state.span;
    hud.setProgress((t - a) / (b - a));
  }
  if (state.tutorial) state.tutorial.update(now);
  scene.update(dt, t);
  requestAnimationFrame(loop);
}

boot();
