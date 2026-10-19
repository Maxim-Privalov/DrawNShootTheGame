import Phaser from 'phaser';

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
interface PB { x: number; y: number; r: number; dx: number; dy: number; speed: number; path: Pt[]; dmg: number; mine: boolean; life: number; color: number; minD: number; hit: boolean; dead: boolean }
interface EB { x: number; y: number; dx: number; dy: number; dead: boolean }

const W = 1280, H = 720, AX = 40, AY = 60, AW = 1200, AH = 640;
const TS = 0.4, PR = 14, BR = 16;
const SHOT = 900, ESHOT = 500; // базовые скорости снарядов игрока и бота
const COLORS = [0, 0xffffff, 0x66ccff, 0xffdd33];
const NAMES = ['', 'Линия', 'Залп', 'Стена'];
const OBST: Rect[] = [
  { x: 200, y: 300, w: 50, h: 160 }, { x: 1030, y: 300, w: 50, h: 160 }, { x: 590, y: 320, w: 100, h: 120 },
  { x: 560, y: 140, w: 160, h: 30 }, { x: 560, y: 590, w: 160, h: 30 },
];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const hitsRect = (x: number, y: number, r: number, o: Rect) => {
  const cx = Math.max(o.x, Math.min(x, o.x + o.w)), cy = Math.max(o.y, Math.min(y, o.y + o.h));
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
};
const inArena = (x: number, y: number, r: number) => x >= AX + r && x <= AX + AW - r && y >= AY + r && y <= AY + AH - r;
const inObst = (x: number, y: number, r: number) => OBST.some(o => hitsRect(x, y, r, o));
const free = (x: number, y: number, r: number) => inArena(x, y, r) && !inObst(x, y, r);
const slide = (e: Pt, dx: number, dy: number, r: number) => { // движение с «скольжением» по стенам
  if (free(e.x + dx, e.y, r)) e.x += dx;
  if (free(e.x, e.y + dy, r)) e.y += dy;
};
const mk = (o: Partial<PB>): PB => ({
  x: 0, y: 0, r: 8, dx: 0, dy: 0, speed: SHOT, path: [], dmg: 1, mine: false,
  life: 0, color: 0xffffff, minD: 1e9, hit: false, dead: false, ...o,
});

class Main extends Phaser.Scene {
  g!: Phaser.GameObjects.Graphics;
  hud!: Phaser.GameObjects.Text;
  big!: Phaser.GameObjects.Text;
  keys = new Set<string>();
  player = { x: 0, y: 0, hp: 3, inv: 0 };
  bot = { x: 0, y: 0, hp: 10, timer: 0, tele: false, ang: 0 };
  pts: Pt[] = [];
  spell = 1;
  cd = 0;
  pb: PB[] = [];
  eb: EB[] = [];
  score = 0;
  over: '' | 'win' | 'lose' = '';

  create() {
    this.g = this.add.graphics();
    const st = { fontFamily: 'monospace', fontSize: '18px', color: '#e6e6e6' };
    this.hud = this.add.text(AX, 10, '', st);
    this.add.text(AX, H - 20, 'WASD — ход | ЛКМ — точка | ЛКМ по игроку — заново | ПКМ/Esc — отмена | Enter — запуск | 1/2/3 — спелл', { ...st, fontSize: '12px', color: '#6c7489' });
    this.big = this.add.text(W / 2, H / 2, '', { ...st, fontSize: '48px', color: '#ffffff', align: 'center', lineSpacing: 12 }).setOrigin(0.5).setVisible(false);
    this.input.mouse?.disableContextMenu();
    this.reset();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.over) return;
      if (p.rightButtonDown()) { this.pts = []; return; }
      const m = { x: p.x, y: p.y };
      if (dist(m, this.player) <= PR + 6) { this.pts = []; return; }
      if (this.pts.length < 8 && inArena(m.x, m.y, 0) && !inObst(m.x, m.y, 0)) this.pts.push(m);
    });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.reset();
      else if (e.code === 'Escape') this.pts = [];
      else if (e.code === 'Enter') this.launch();
      else if (e.code === 'Digit1') this.spell = 1;
      else if (e.code === 'Digit2') this.spell = 2;
      else if (e.code === 'Digit3') this.spell = 3;
    });
    this.input.keyboard!.on('keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
  }

  reset() {
    this.player = { x: 100, y: 380, hp: 3, inv: 0 };
    this.bot = { x: 1180, y: 380, hp: 10, timer: 0, tele: false, ang: 0 };
    this.pts = []; this.pb = []; this.eb = [];
    this.spell = 1; this.cd = 0; this.score = 0; this.over = '';
  }

  update(_t: number, delta: number) {
    const dt = Math.min(delta, 50) / 1000;
    if (!this.over) this.step(dt, dt * TS);
    this.draw();
  }

  step(dt: number, sdt: number) {
    const p = this.player, k = this.keys;
    this.cd = Math.max(0, this.cd - dt);
    p.inv = Math.max(0, p.inv - dt);
    const mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), my = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
    const l = Math.hypot(mx, my);
    if (l) slide(p, (mx / l) * 220 * sdt, (my / l) * 220 * sdt, PR);

    this.botAI(dt, sdt);
    this.updatePB(dt, sdt);
    this.updateEB(sdt);
    if (this.bot.hp <= 0) this.over = 'win';
    else if (p.hp <= 0) this.over = 'lose';
  }

  botAI(dt: number, sdt: number) {
    const b = this.bot, p = this.player;
    // минимальное уклонение: только от снаряда, летящего прямо в бота вплотную, и вполсилы
    let best: PB | undefined, bd = 170;
    for (const q of this.pb) {
      if (q.mine || q.dead) continue;
      const d = dist(q, b);
      if (d < bd) { bd = d; best = q; }
    }
    let vx = 0, vy = 0, sp = 190;
    let dodge = false;
    if (best) {
      const rx = b.x - best.x, ry = b.y - best.y;
      const along = rx * best.dx + ry * best.dy;
      const cross = best.dx * ry - best.dy * rx;
      if (along > 0 && Math.abs(cross) < BR + best.r) {
        dodge = true;
        const px = -best.dy, py = best.dx, s0 = cross >= 0 ? 1 : -1;
        const ok = (s: number) => free(b.x + px * s * 30, b.y + py * s * 30, BR);
        const s = ok(s0) ? s0 : ok(-s0) ? -s0 : 0; // 0 — прижат с обеих сторон: стоит
        vx = px * s; vy = py * s; sp *= 0.5;
      }
    }
    if (!dodge) {
      // преследование: держится на 200–300 px от игрока (дальше — идёт к нему, ближе — отступает, между — кружит),
      // направление из 16 вариантов, где впереди свободно; небольшая «инерция» против дёрганья
      const tx = p.x - b.x, ty = p.y - b.y, d = Math.hypot(tx, ty) || 1;
      const want = d > 300 ? Math.atan2(ty, tx) : d < 200 ? Math.atan2(-ty, -tx) : Math.atan2(ty, tx) + Math.PI / 2;
      let bestA = b.ang, bestS = -Infinity;
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8, c = Math.cos(a), s = Math.sin(a);
        if (!free(b.x + c * 22, b.y + s * 22, BR) || !free(b.x + c * 50, b.y + s * 50, BR)) continue;
        const sc = Math.cos(a - want) + 0.35 * Math.cos(a - b.ang);
        if (sc > bestS) { bestS = sc; bestA = a; }
      }
      b.ang = bestA;
      vx = Math.cos(bestA); vy = Math.sin(bestA);
    }
    slide(b, vx * sp * sdt, vy * sp * sdt, BR);

    // выстрел раз в 2.5 с (реальное время), телеграф за 0.4 с
    const inR = dist(b, p) <= 500;
    if (inR) {
      b.timer += dt;
      if (b.timer >= 2.5) {
        b.timer = 0;
        const d = dist(b, p) || 1;
        this.eb.push({ x: b.x, y: b.y, dx: (p.x - b.x) / d, dy: (p.y - b.y) / d, dead: false });
      }
    } else b.timer = 0;
    b.tele = inR && b.timer >= 2.1;
  }

  updatePB(dt: number, sdt: number) {
    const b = this.bot;
    for (const q of this.pb) {
      if (q.dead) continue;
      let end = false;
      if (q.mine) {
        q.life -= dt;
        if (q.life <= 0) q.dead = true;
      } else {
        let step = q.speed * sdt;
        while (step > 0 && q.path.length) {
          const t = q.path[0], d = dist(q, t);
          if (d < 1e-6) { q.path.shift(); continue; }
          q.dx = (t.x - q.x) / d; q.dy = (t.y - q.y) / d;
          if (d <= step) { q.x = t.x; q.y = t.y; step -= d; q.path.shift(); }
          else { q.x += q.dx * step; q.y += q.dy * step; step = 0; }
        }
        end = !q.path.length;
        if (inObst(q.x, q.y, q.r)) q.dead = true;
        q.minD = Math.min(q.minD, dist(q, b));
      }
      if (!q.dead && dist(q, b) < BR + q.r) { b.hp -= q.dmg; this.score += 10 * q.dmg; q.dead = q.hit = true; }
      if (end) q.dead = true;
    }
    for (const q of this.pb) if (q.dead && !q.hit && !q.mine && q.dmg >= 1 && q.minD < 40 && q.minD > 0) { this.score += 3; q.minD = 0; } // «почти попал», один раз
    this.pb = this.pb.filter(q => !q.dead);
  }

  updateEB(sdt: number) {
    const p = this.player;
    for (const e of this.eb) {
      e.x += e.dx * ESHOT * sdt; e.y += e.dy * ESHOT * sdt;
      if (!free(e.x, e.y, 7)) e.dead = true;
      else if (dist(e, p) < PR + 7) {
        e.dead = true;
        if (p.inv <= 0) { p.hp--; p.inv = 0.5; }
      }
    }
    this.eb = this.eb.filter(e => !e.dead);
  }

  launch() {
    if (this.over || this.cd > 0 || !this.pts.length) return;
    const p = this.player, path = this.pts.map(q => ({ ...q })), color = COLORS[this.spell];
    if (this.spell === 3) { // мины каждые 60 px вдоль ломаной
      let prev: Pt = { x: p.x, y: p.y }, acc = 0;
      for (const q of path) {
        const L = dist(prev, q);
        let s = 60 - acc;
        for (; s <= L && L > 0; s += 60) this.pb.push(mk({ x: prev.x + ((q.x - prev.x) * s) / L, y: prev.y + ((q.y - prev.y) * s) / L, r: 6, mine: true, life: 3, color }));
        acc = L - (s - 60);
        prev = q;
      }
    } else if (this.spell === 2) { // залп: по маленькому слабому снаряду в каждую точку
      for (const q of path) {
        const d = dist(p, q) || 1;
        this.pb.push(mk({ x: p.x, y: p.y, r: 4, dx: (q.x - p.x) / d, dy: (q.y - p.y) / d, path: [q], dmg: 0.5, speed: 700, color }));
      }
    } else {
      const d = dist(p, path[0]) || 1;
      this.pb.push(mk({ x: p.x, y: p.y, dx: (path[0].x - p.x) / d, dy: (path[0].y - p.y) / d, path, color }));
    }
    this.cd = 0.6;
    this.pts = [];
  }

  draw() {
    const g = this.g, p = this.player, b = this.bot, now = this.time.now;
    g.clear();
    g.fillStyle(0x14171f, 1); g.fillRect(AX, AY, AW, AH);
    g.lineStyle(2, 0x3a4256, 1); g.strokeRect(AX, AY, AW, AH);
    g.fillStyle(0x3a4256, 1); OBST.forEach(o => g.fillRect(o.x, o.y, o.w, o.h));

    // траектория: линия, точки, превью до курсора
    const col = COLORS[this.spell], m = this.input.activePointer;
    if (this.pts.length) {
      g.lineStyle(2, col, 0.6);
      let prev: Pt = p;
      for (const q of this.pts) { g.lineBetween(prev.x, prev.y, q.x, q.y); if (this.spell !== 2) prev = q; }
      if (this.pts.length < 8 && inArena(m.x, m.y, 0)) { g.lineStyle(2, col, 0.3); g.lineBetween(prev.x, prev.y, m.x, m.y); }
      g.fillStyle(col, 1); this.pts.forEach(q => g.fillCircle(q.x, q.y, 4));
    }

    for (const q of this.pb) { g.fillStyle(q.color, q.mine ? Math.min(1, q.life / 1 + 0.2) : 1); g.fillCircle(q.x, q.y, q.r); }
    g.fillStyle(0xff4455, 1); this.eb.forEach(e => g.fillCircle(e.x, e.y, 7));

    if (b.tele && !this.over) {
      const fl = 0.5 + 0.5 * Math.sin(now / 40);
      g.lineStyle(2, 0xff2244, fl); g.lineBetween(b.x, b.y, p.x, p.y); g.strokeCircle(b.x, b.y, BR + 6);
    }
    g.fillStyle(0xff5577, 1); g.fillCircle(b.x, b.y, BR);
    if (p.inv <= 0 || Math.floor(now / 60) % 2 === 0) { g.fillStyle(0x4da3ff, 1); g.fillCircle(p.x, p.y, PR); }

    // HUD: полоски HP сверху
    const bar = (x: number, w: number, f: number, c: number) => { g.fillStyle(0x222733, 1); g.fillRect(x, 20, w, 16); g.fillStyle(c, 1); g.fillRect(x, 20, w * Math.max(0, f), 16); };
    bar(560, 260, p.hp / 3, 0x4da3ff);
    bar(900, 340, b.hp / 10, 0xff5577);
    this.hud.setText(`Счёт ${this.score}   ${NAMES[this.spell]}${this.cd > 0 ? ' …' : ''}`);

    if (this.over) {
      g.fillStyle(0x000000, 0.7); g.fillRect(0, 0, W, H);
      this.big.setText(`${this.over === 'win' ? 'Победа' : 'Поражение'}\nСчёт: ${this.score}\nR — ещё раз`);
    }
    this.big.setVisible(!!this.over);
  }
}

new Phaser.Game({ type: Phaser.AUTO, width: W, height: H, parent: 'app', backgroundColor: '#0b0d12', scene: Main });