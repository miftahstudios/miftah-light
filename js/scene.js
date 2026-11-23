// Three.js visuals. Board coords (x, z) map to three (x, -z) so "up" swipes move away from the camera.
import * as THREE from '../vendor/three.module.min.js';
import { COLS, ROWS, CELL } from './config.js';

export const PALETTE = {
  bg: 0x030805, green: 0x0f4d34, greenDeep: 0x082a1d, gold: 0xd4af37, goldSoft: 0xf3dc8a,
  silver: 0xc4ccd4, blue: 0x8fb8de, cube: 0x0d1612,
};

const BOARD_CENTER_Z = -2.5;
const toV = (x, z, y = 0) => new THREE.Vector3(x, y, -z);

function glowTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TEX = {
  gold: () => glowTexture([[0, 'rgba(255,246,214,1)'], [0.25, 'rgba(243,220,138,0.85)'], [0.6, 'rgba(212,175,55,0.25)'], [1, 'rgba(212,175,55,0)']]),
  blue: () => glowTexture([[0, 'rgba(143,184,222,0.5)'], [0.5, 'rgba(143,184,222,0.12)'], [1, 'rgba(143,184,222,0)']]),
  spark: () => glowTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,240,200,0.8)'], [1, 'rgba(255,240,200,0)']]),
  shadow: () => glowTexture([[0, 'rgba(8,4,14,0.95)'], [0.45, 'rgba(14,8,24,0.75)'], [0.8, 'rgba(20,14,32,0.2)'], [1, 'rgba(20,14,32,0)']]),
  rim: () => glowTexture([[0.4, 'rgba(143,184,222,0)'], [0.68, 'rgba(176,196,224,0.55)'], [0.85, 'rgba(143,184,222,0.18)'], [1, 'rgba(143,184,222,0)']]),
};

export class Scene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.bg);
    this.scene.fog = new THREE.Fog(PALETTE.bg, 14, 34);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.tex = Object.fromEntries(Object.entries(TEX).map(([k, f]) => [k, f()]));
    this.pulse = 0;
    this.wisps = new Map();
    this.bursts = [];

    this.scene.add(new THREE.AmbientLight(0x9fd8b8, 0.35));
    const key = new THREE.DirectionalLight(PALETTE.goldSoft, 0.6);
    key.position.set(-4, 10, 6);
    const rimLight = new THREE.DirectionalLight(PALETTE.green, 1.4);
    rimLight.position.set(6, 3, -12);
    this.scene.add(key, rimLight);

    this.buildBackdrop();
    this.buildBoard();
    this.buildOrb();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Field of dark 3D cubes.
  buildBackdrop() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: PALETTE.cube, roughness: 0.55, metalness: 0.35 });
    const nx = 30, nz = 22, step = 1.7;
    this.cubes = new THREE.InstancedMesh(geo, mat, nx * nz);
    this.cubeBase = [];
    const m = new THREE.Matrix4();
    let i = 0;
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const x = (a - nx / 2) * step, z = -b * step + 8;
      const h = 0.6 + ((a * 7 + b * 13) % 11) / 6;            // fixed pattern, no randomness
      const y = -2.2 - h / 2 - ((a * 3 + b * 5) % 4) * 0.25;
      this.cubeBase.push({ x, y, z, h, phase: (a + b) % 8 });
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1.45, h, 1.45));
      this.cubes.setMatrixAt(i++, m);
    }
    this.scene.add(this.cubes);
  }

  buildBoard() {
    this.board = new THREE.Group();
    const tileGeo = new THREE.BoxGeometry(CELL * 0.92, 0.12, CELL * 0.92);
    const tileMat = new THREE.MeshStandardMaterial({ color: PALETTE.greenDeep, roughness: 0.7, metalness: 0.2,
      emissive: PALETTE.green, emissiveIntensity: 0.18 });
    const edgeGeo = new THREE.EdgesGeometry(tileGeo);
    this.edgeMat = new THREE.LineBasicMaterial({ color: PALETTE.gold, transparent: true, opacity: 0.35 });
    for (const x of COLS) for (const z of ROWS) {
      const tile = new THREE.Mesh(tileGeo, tileMat);
      tile.position.copy(toV(x, z, -0.06));
      const edge = new THREE.LineSegments(edgeGeo, this.edgeMat);
      edge.position.copy(tile.position);
      this.board.add(tile, edge);
    }
    // thin outline around the whole board
    const w = (COLS.length) * CELL, d = (ROWS.length) * CELL;
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.1, 0.02, d + 0.1)),
      new THREE.LineBasicMaterial({ color: PALETTE.gold, transparent: true, opacity: 0.8 }));
    frame.position.set(0, 0.01, BOARD_CENTER_Z);
    this.board.add(frame);
    this.scene.add(this.board);
  }

  sprite(tex, scale, opacity, additive = true) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.scale.setScalar(scale);
    return s;
  }

  // The player: a faceless glowing orb with sparkles.
  buildOrb() {
    this.orb = new THREE.Group();
    this.orbCore = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff6d6 }));
    this.orbGlow = this.sprite(this.tex.gold, 2.0, 1);
    this.orbHalo = this.sprite(this.tex.blue, 3.4, 0.5);
    this.orbLight = new THREE.PointLight(PALETTE.goldSoft, 6, 6, 1.6);
    this.orbLight.position.y = 0.6;
    const n = 36, pos = new Float32Array(n * 3);
    this.sparkSeeds = Array.from({ length: n }, (_, i) => ({ r: 0.35 + (i % 5) * 0.11, a: (i / n) * Math.PI * 2, s: 0.6 + (i % 7) * 0.18, y: ((i % 9) - 4) * 0.07 }));
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({ map: this.tex.spark, size: 0.14, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, color: PALETTE.goldSoft }));
    this.orb.add(this.orbHalo, this.orbGlow, this.orbCore, this.orbLight, this.sparks);
    this.orb.position.y = 0.45;
    this.scene.add(this.orb);
    this.orbTarget = this.orb.position.clone();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    // fit the board (plus the spawn ring) across the screen; portrait phones fit the board a little tighter
    const halfWidth = this.camera.aspect < 1 ? 7.0 : 8.2;
    const dist = Math.max(halfWidth / Math.tan(hf / 2), 5.2 / Math.tan(vf / 2));
    // keep the fog behind the board at any camera distance
    this.scene.fog.near = dist + 2;
    this.scene.fog.far = dist + 22;
    const elev = THREE.MathUtils.degToRad(58);
    const target = new THREE.Vector3(0, 0, BOARD_CENTER_Z - 0.3);
    this.camera.position.set(0, Math.sin(elev) * dist, target.z + Math.cos(elev) * dist);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  reset(player) {
    for (const g of this.wisps.values()) this.scene.remove(g);
    this.wisps.clear();
    for (const b of this.bursts) this.scene.remove(b.points);
    this.bursts = [];
    this.orbTarget = toV(player.x, player.z, 0.45);
    this.orb.position.copy(this.orbTarget);
  }

  movePlayer(p) { this.orbTarget = toV(p.x, p.z, 0.45); }

  // An abstract drifting shadow: layered dark smoke with a faint silver rim. No face, no figure.
  addWisp(w) {
    const g = new THREE.Group();
    const layers = [];
    for (let i = 0; i < 3; i++) {
      const s = this.sprite(this.tex.shadow, 1.1 - i * 0.18, 0.9, false);
      s.position.set((i - 1) * 0.12, 0.1 * i, 0);
      layers.push(s);
      g.add(s);
    }
    const rim = this.sprite(this.tex.rim, 1.25, 1);
    g.add(rim);
    g.userData = { layers, rim, target: toV(w.x, w.z, 0.4), seed: w.id, spawn: 0 };
    g.position.copy(g.userData.target);
    g.scale.setScalar(0.01);
    this.wisps.set(w.id, g);
    this.scene.add(g);
  }

  moveWisp(w) { const g = this.wisps.get(w.id); if (g) g.userData.target = toV(w.x, w.z, 0.4); }

  spendWisp(w) {
    const g = this.wisps.get(w.id);
    if (g) for (const s of [...g.userData.layers, g.userData.rim]) s.material.opacity = 0.25;
  }

  removeWisp(w) { const g = this.wisps.get(w.id); if (g) { this.scene.remove(g); this.wisps.delete(w.id); } }

  // Light bursting a shadow apart.
  burst(w, color = PALETTE.goldSoft, count = 28) {
    const g = this.wisps.get(w.id);
    const origin = g ? g.position.clone() : toV(w.x, w.z, 0.4);
    this.removeWisp(w);
    const pos = new Float32Array(count * 3), vel = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2, up = 0.6 + (i % 4) * 0.35;
      vel.push(new THREE.Vector3(Math.cos(a) * (1.6 + (i % 3) * 0.6), up, Math.sin(a) * (1.6 + (i % 3) * 0.6)));
      pos.set([origin.x, origin.y, origin.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: this.tex.spark, size: 0.28, color, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(points);
    this.bursts.push({ points, vel, age: 0 });
  }

  hurt() { this.hurtFlash = 1; }
  beat() { this.pulse = 1; }

  update(dt, t) {
    // orb glides to its cell
    const step = 5 * dt * 1.25;
    const d = this.orbTarget.clone().sub(this.orb.position);
    if (d.length() <= step) this.orb.position.copy(this.orbTarget); else this.orb.position.add(d.setLength(step));

    this.pulse = Math.max(0, this.pulse - dt * 4);
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 2.5);
    const breathe = 1 + Math.sin(t * 3) * 0.04 + this.pulse * 0.25;
    this.orbGlow.scale.setScalar(2.0 * breathe);
    this.orbHalo.scale.setScalar(3.4 * (1 + this.pulse * 0.15));
    this.orbCore.material.color.setHex(this.hurtFlash > 0.05 ? 0xffb0a0 : 0xfff6d6);
    this.orbLight.intensity = 5 + this.pulse * 6;
    const p = this.sparkGeo.attributes.position;
    this.sparkSeeds.forEach((s, i) => {
      const a = s.a + t * s.s;
      p.setXYZ(i, Math.cos(a) * s.r, s.y + Math.sin(t * 2 + i) * 0.08, Math.sin(a) * s.r);
    });
    p.needsUpdate = true;
    this.edgeMat.opacity = 0.3 + this.pulse * 0.5;

    // backdrop cubes breathe with the beat
    const m = new THREE.Matrix4();
    this.cubeBase.forEach((c, i) => {
      const lift = this.pulse * (c.phase % 3 === 0 ? 0.35 : 0.12);
      m.compose(new THREE.Vector3(c.x, c.y + lift, c.z), new THREE.Quaternion(), new THREE.Vector3(1.45, c.h, 1.45));
      this.cubes.setMatrixAt(i, m);
    });
    this.cubes.instanceMatrix.needsUpdate = true;

    for (const g of this.wisps.values()) {
      const u = g.userData;
      g.position.lerp(u.target, Math.min(1, dt * 10));
      u.spawn = Math.min(1, u.spawn + dt * 3);
      g.scale.setScalar(u.spawn * (1 + Math.sin(t * 2.2 + u.seed) * 0.06));
      u.layers.forEach((s, i) => { s.material.rotation = t * (0.4 + i * 0.25) * (i % 2 ? -1 : 1) + u.seed; });
    }

    for (const b of [...this.bursts]) {
      b.age += dt;
      const pos = b.points.geometry.attributes.position;
      b.vel.forEach((v, i) => { pos.setXYZ(i, pos.getX(i) + v.x * dt, pos.getY(i) + v.y * dt, pos.getZ(i) + v.z * dt); v.y -= dt * 2; });
      pos.needsUpdate = true;
      b.points.material.opacity = Math.max(0, 1 - b.age / 0.6);
      if (b.age > 0.6) { this.scene.remove(b.points); this.bursts.splice(this.bursts.indexOf(b), 1); }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
