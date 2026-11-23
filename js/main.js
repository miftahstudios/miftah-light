import { Scene } from './scene.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { SongPlayer } from './audio.js';
import { bindInput } from './input.js';
import { save } from './save.js';
import { SCORE, LEAD_OUT } from './config.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const params = new URLSearchParams(location.search);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { songs: [], charts: {}, index: 0, difficulty: save.settings.difficulty, game: null, running: false };
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

// ---------- play ----------
async function start(index = state.index) {
  state.index = index;
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
  });
  state.game = game;
  state.paused = false;
  scene.reset(game.player);
  hud.setLight(game.light);
  hud.setSong(song.title);
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
  let rank = 0, newBest = false, unlockedNext = false;
  if (complete) {
    const nextWasOpen = save.isUnlocked(state.songs, state.index + 1);
    save.complete(song.id);
    unlockedNext = state.index + 1 < state.songs.length && !nextWasOpen;
    ({ rank, newBest } = save.record(song.id, state.difficulty,
      { name: save.name || 'Player', score, light: Math.round(light), date: Date.now() }));
  }

  $('#result-title').textContent = complete ? 'Song complete' : 'The light went out';
  $('#result-song').textContent = song.title;
  $('#result-score').textContent = score.toLocaleString();
  $('#new-best').hidden = !newBest;
  $('#result-stats').innerHTML = [
    ['Light left', Math.round(light)], ['Shadows cleared', stats.cleared],
    ['Perfect', stats.perfect], ['Great', stats.great], ['Good', stats.good],
    ['Off beat', stats.offbeat], ['Hit by shadows', stats.contacts],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#unlocked').hidden = !unlockedNext;
  if (unlockedNext) $('#unlocked').innerHTML = `Unlocked: <bdi>${esc(state.songs[state.index + 1].title)}</bdi>`;

  const board = save.leaderboard(song.id, state.difficulty);
  $('#leaderboard').innerHTML = board.length
    ? board.slice(0, 5).map((e, i) => `<li class="${i + 1 === rank ? 'me' : ''}"><span>${esc(e.name)}</span><span>${e.score.toLocaleString()}</span></li>`).join('')
    : '<li class="empty">Complete the song to get on the board.</li>';

  const hasNext = state.index + 1 < state.songs.length && save.isUnlocked(state.songs, state.index + 1);
  $('#next').hidden = !hasNext;
  $('#retry').classList.toggle('primary', !hasNext);
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
  $('#open-settings').addEventListener('click', () => show('settings'));
  for (const b of $$('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));
  for (const b of $$('[data-difficulty]')) b.addEventListener('click', () => {
    state.difficulty = b.dataset.difficulty;
    save.setSetting('difficulty', state.difficulty);
    renderLevels();
  });
  $('#song-list').addEventListener('click', e => {
    const b = e.target.closest('button.song');
    if (b && !b.disabled) start(Number(b.dataset.index));
  });
  $('#retry').addEventListener('click', () => start());
  $('#next').addEventListener('click', () => start(state.index + 1));
  $('#pause').addEventListener('click', pause);
  $('#resume').addEventListener('click', resume);
  $('#restart').addEventListener('click', () => { stopRun(); start(); });
  $('#quit').addEventListener('click', quit);
  window.addEventListener('keydown', e => { if (e.code === 'Escape') (state.paused ? resume : pause)(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  $('#name').addEventListener('change', e => { save.name = e.target.value; });
  $('#volume').addEventListener('input', e => { save.setSetting('volume', Number(e.target.value)); renderSettings(); applySettings(); });
  $('#offset').addEventListener('input', e => { save.setSetting('offsetMs', Number(e.target.value)); renderSettings(); applySettings(); });

  bindInput($('#stage'), dir => { if (state.running && !state.paused) state.game.move(dir, player.time()); });

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
  scene.update(dt, t);
  requestAnimationFrame(loop);
}

boot();
