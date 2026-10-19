// Карта (арена, препятствия, геометрия) и внутриигровые события
// (полёт снарядов, попадания, счёт, конец партии).
import type Phaser from 'phaser';
import type { Player, PlayerShot } from './player';
import type { Bot, BotShot } from './bot';

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Gfx = Phaser.GameObjects.Graphics;

export const W = 1280, H = 720;
export const AX = 40, AY = 60, AW = 1200, AH = 640; // арена
export const TS = 0.4;                               // замедление времени

export const OBSTACLES: Rect[] = [
  { x: 200, y: 300, w: 50, h: 160 }, { x: 1030, y: 300, w: 50, h: 160 }, { x: 590, y: 320, w: 100, h: 120 },
  { x: 560, y: 140, w: 160, h: 30 }, { x: 560, y: 590, w: 160, h: 30 },
];

// ---------- геометрия ----------
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

const hitsRect = (x: number, y: number, r: number, o: Rect) => {
  const cx = Math.max(o.x, Math.min(x, o.x + o.w)), cy = Math.max(o.y, Math.min(y, o.y + o.h));
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
};
export const inArena = (x: number, y: number, r: number) =>
  x >= AX + r && x <= AX + AW - r && y >= AY + r && y <= AY + AH - r;
export const inObstacle = (x: number, y: number, r: number) => OBSTACLES.some(o => hitsRect(x, y, r, o));
/** Круг радиуса r целиком в арене и не задевает препятствия. */
export const isFree = (x: number, y: number, r: number) => inArena(x, y, r) && !inObstacle(x, y, r);

/** Сдвиг с «скольжением» вдоль стен: каждая ось проверяется отдельно. */
export function slide(e: Pt, dx: number, dy: number, r: number) {
  if (isFree(e.x + dx, e.y, r)) e.x += dx;
  if (isFree(e.x, e.y + dy, r)) e.y += dy;
}

export function drawMap(g: Gfx) {
  g.fillStyle(0x14171f, 1); g.fillRect(AX, AY, AW, AH);
  g.lineStyle(2, 0x3a4256, 1); g.strokeRect(AX, AY, AW, AH);
  g.fillStyle(0x3a4256, 1); OBSTACLES.forEach(o => g.fillRect(o.x, o.y, o.w, o.h));
}

// ---------- состояние партии и события ----------
export interface Game {
  player: Player;
  bot: Bot;
  playerShots: PlayerShot[];
  botShots: BotShot[];
  score: number;
  over: '' | 'win' | 'lose';
}

/** Снаряды игрока: полёт по ломаной, жизнь мин, препятствия, попадания и «почти попал». */
export function updatePlayerShots(game: Game, dt: number, sdt: number) {
  const bot = game.bot;
  for (const s of game.playerShots) {
    if (s.dead) continue;
    let reachedEnd = false;
    if (s.mine) {
      s.life -= dt; // мины живут в реальном времени
      if (s.life <= 0) s.dead = true;
    } else {
      followPath(s, s.speed * sdt);
      reachedEnd = !s.path.length;
      if (inObstacle(s.x, s.y, s.r)) s.dead = true;
      s.minDist = Math.min(s.minDist, dist(s, bot));
    }
    if (!s.dead && dist(s, bot) < bot.r + s.r) {
      bot.hp -= s.dmg;
      game.score += 10 * s.dmg;
      s.dead = s.hit = true;
    }
    if (reachedEnd) s.dead = true; // сначала попадание, потом исчезновение в конце пути
  }
  // «почти попал»: +3 один раз за снаряд, который погиб без попадания, но прошёл в 40 px от бота
  for (const s of game.playerShots) {
    if (s.dead && !s.hit && !s.mine && s.dmg >= 1 && s.minDist < 40) { game.score += 3; s.minDist = Infinity; }
  }
  game.playerShots = game.playerShots.filter(s => !s.dead);
}

function followPath(s: PlayerShot, step: number) {
  while (step > 0 && s.path.length) {
    const t = s.path[0], d = dist(s, t);
    if (d < 1e-6) { s.path.shift(); continue; }
    s.dx = (t.x - s.x) / d; s.dy = (t.y - s.y) / d;
    if (d <= step) { s.x = t.x; s.y = t.y; step -= d; s.path.shift(); }
    else { s.x += s.dx * step; s.y += s.dy * step; step = 0; }
  }
}

/** Снаряды бота: полёт, исчезновение о стены, урон игроку с кадрами неуязвимости. */
export function updateBotShots(game: Game, sdt: number) {
  const p = game.player;
  for (const s of game.botShots) {
    s.x += s.dx * s.speed * sdt;
    s.y += s.dy * s.speed * sdt;
    if (!isFree(s.x, s.y, s.r)) s.dead = true;
    else if (dist(s, p) < p.r + s.r) {
      s.dead = true;
      if (p.inv <= 0) { p.hp--; p.inv = 0.5; }
    }
  }
  game.botShots = game.botShots.filter(s => !s.dead);
}

export function checkEnd(game: Game) {
  if (game.bot.hp <= 0) game.over = 'win';
  else if (game.player.hp <= 0) game.over = 'lose';
}
