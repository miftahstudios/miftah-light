// Local save. Stays on this device only.
const KEY = 'madih-light-save-v1';
const LEADERBOARD_SIZE = 10;

const fresh = () => ({
  playerName: '',
  completedLevels: [],          // completed song ids
  best: {},                     // "songId:difficulty" -> best score
  leaderboard: {},              // "songId:difficulty" -> [{ name, score, light, date }]
  settings: { volume: 1, offsetMs: 0, difficulty: 'normal' },
});

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const saved = JSON.parse(raw);
    const base = fresh();
    return { ...base, ...saved, settings: { ...base.settings, ...(saved.settings || {}) } };
  } catch {
    return fresh(); // private mode or blocked storage: play on without saving
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

export const save = {
  get name() { return data.playerName; },
  set name(v) { data.playerName = String(v || '').trim().slice(0, 16); persist(); },
  get settings() { return data.settings; },
  setSetting(k, v) { data.settings[k] = v; persist(); },

  isCompleted: id => data.completedLevels.includes(id),
  // Level 1 is always open; every later level opens when the one before it is completed.
  isUnlocked(songs, index) { return index === 0 || data.completedLevels.includes(songs[index - 1].id); },
  complete(id) { if (!data.completedLevels.includes(id)) { data.completedLevels.push(id); persist(); } },

  best: (id, diff) => data.best[`${id}:${diff}`] ?? null,
  leaderboard: (id, diff) => data.leaderboard[`${id}:${diff}`] || [],

  // Records a finished run. Returns { rank (1-based, or 0 if it didn't place), newBest }.
  record(id, diff, entry) {
    const k = `${id}:${diff}`;
    const board = [...(data.leaderboard[k] || []), entry]
      .sort((a, b) => b.score - a.score || b.light - a.light || a.date - b.date)
      .slice(0, LEADERBOARD_SIZE);
    data.leaderboard[k] = board;
    const newBest = data.best[k] == null || entry.score > data.best[k];
    if (newBest) data.best[k] = entry.score;
    persist();
    return { rank: board.indexOf(entry) + 1, newBest };
  },
};
