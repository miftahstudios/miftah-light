// HUD: Light meter, judgement text, and the beat lane (notes close in on a centre ring).
import { LIGHT_MAX, NEAR_DEATH_THRESHOLD } from './config.js';

const LABEL = { perfect: 'Perfect', great: 'Great', good: 'Good', offbeat: 'Off beat', miss: 'Miss' };
const LANE_AHEAD = 1.6; // seconds of upcoming hits shown

export class Hud {
  constructor(root) {
    this.meterFill = root.querySelector('#light-fill');
    this.meterValue = root.querySelector('#light-value');
    this.meter = root.querySelector('#light');
    this.judgeEl = root.querySelector('#judge');
    this.judgeText = root.querySelector('#judge-text');
    this.judgePoints = root.querySelector('#judge-points');
    this.scoreEl = root.querySelector('#hud-score');
    this.songEl = root.querySelector('#hud-song');
    this.progressEl = root.querySelector('#progress-fill');
    this.shownScore = -1;
    this.lane = root.querySelector('#lane');
    this.ctx = this.lane.getContext('2d');
    this.flash = 0;
  }

  setLight(v) {
    const pct = (v / LIGHT_MAX) * 100;
    this.meterFill.style.width = `${pct}%`;
    this.meterValue.textContent = Math.round(v);
    this.meter.classList.toggle('low', v < NEAR_DEATH_THRESHOLD);
  }

  judge(grade, points = 0) {
    this.judgeText.textContent = LABEL[grade] || '';
    this.judgePoints.textContent = points ? `+${points}` : '';
    this.judgeEl.className = `judge ${grade}`;
    void this.judgeEl.offsetWidth; // restart the pop animation
    this.judgeEl.classList.add('show');
  }

  // extra points (a cleared shadow) added to the popup already showing
  bonus(points) {
    const now = Number(this.judgePoints.textContent.replace(/\D/g, '')) || 0;
    this.judgePoints.textContent = `+${now + points}`;
  }

  setSong(title) { this.songEl.textContent = title; }

  setScore(score) {
    if (score === this.shownScore) return;
    this.shownScore = score;
    this.scoreEl.textContent = score.toLocaleString();
  }

  setProgress(fraction) { this.progressEl.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`; }

  beat() { this.flash = 1; }

  draw(t, hits, judged, from) {
    const c = this.lane, g = this.ctx, dpr = Math.min(window.devicePixelRatio, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, half = w / 2 - 12;
    this.flash = Math.max(0, this.flash - 0.08);

    g.strokeStyle = 'rgba(212,175,55,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(12, cy); g.lineTo(w - 12, cy); g.stroke();

    g.strokeStyle = `rgba(243,220,138,${0.6 + this.flash * 0.4})`;
    g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, 13 + this.flash * 4, 0, Math.PI * 2); g.stroke();

    for (let i = Math.max(0, from - 2); i < hits.length; i++) {
      const dt = hits[i] - t;
      if (dt > LANE_AHEAD) break;
      if (dt < -0.15 || judged.has(i)) continue;
      const d = (Math.max(0, dt) / LANE_AHEAD) * half;
      const a = 1 - Math.max(0, dt) / LANE_AHEAD;
      g.fillStyle = `rgba(196,204,212,${0.25 + a * 0.75})`;
      for (const x of [cx - d, cx + d]) { g.beginPath(); g.arc(x, cy, 5, 0, Math.PI * 2); g.fill(); }
    }
  }
}
