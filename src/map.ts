// Карта (арена, препятствия, геометрия) и внутриигровые события
// (полёт снарядов, попадания, счёт, фазы, конец партии).
import type Phaser from 'phaser';
import type { Player, PlayerShot } from './player';
import type { Bot, BotShot } from './bot';

export type Pt = { x: number; y: number };
export type Circle = Pt & { r: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Gfx = Phaser.GameObjects.Graphics;

export const W = 1280, H = 720;
export const AX = 40, AY = 60, AW = 1200, AH = 640; // арена
export const TS = 0.4;                               // замедление времени

const INVULN_TIME = 0.5;                             // неуязвимость игрока после урона, сек
const CONTACT_COOLDOWN = 1;                          // кулдаун урона от столкновения, сек
const RAM_DAMAGE = 1, RAM_DAMAGE_STAGE2 = 2;         // урон тарана
const STAGE_BANNER_TIME = 3;                         // сколько показывать «STAGE 2», сек

export const OBSTACLES: Rect[] = [
  { x: 200, y: 300, w: 50, h: 160 }, { x: 1030, y: 300, w: 50, h: 160 }, { x: 590, y: 320, w: 100, h: 120 },
  { x: 560, y: 140, w: 160, h: 30 }, { x: 560, y: 590, w: 160, h: 30 },
];

// ---------- геометрия ----------
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Единичный вектор от `from` к `to` (нулевой, если точки совпадают). */
export function dirTo(from: Pt, to: Pt): Pt {
  const d = dist(from, to) || 1;
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

/** Круги касаются или пересекаются. */
export const touches = (a: Circle, b: Circle) => dist(a, b) < a.r + b.r;

const closestPoint = (o: Rect, x: number, y: number): Pt => ({ x: clamp(x, o.x, o.x + o.w), y: clamp(y, o.y, o.y + o.h) });
const hitsRect = (x: number, y: number, r: number, o: Rect) => {
  const c = closestPoint(o, x, y);
  return (x - c.x) ** 2 + (y - c.y) ** 2 < r * r;
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

/** Выталкивает круг радиуса r из стен и препятствий (нужно, когда объект вырос). */
export function pushOut(e: Pt, r: number) {
  e.x = clamp(e.x, AX + r, AX + AW - r);
  e.y = clamp(e.y, AY + r, AY + AH - r);
  for (const o of OBSTACLES) {
    if (!hitsRect(e.x, e.y, r, o)) continue;
    const c = closestPoint(o, e.x, e.y);
    if (dist(e, c) > 1e-6) { const u = dirTo(c, e); e.x = c.x + u.x * r; e.y = c.y + u.y * r; }
    else e.y = o.y - r;
  }
}

// ---------- отрисовка ----------
/** Залитый круг — единственный «спрайт» игры. */
export function disc(g: Gfx, c: Circle, color: number, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillCircle(c.x, c.y, c.r);
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
  stageBanner: number;  // сколько ещё показывать надпись «STAGE 2», сек
}

const alive = <T extends { dead: boolean }>(items: T[]) => items.filter(i => !i.dead);

/** Игрок получает урон и короткую неуязвимость (мигание). */
function hurtPlayer(p: Player, damage: number) {
  p.hp -= damage;
  p.inv = Math.max(p.inv, INVULN_TIME);
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
    if (!s.dead && touches(s, bot)) {
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
  game.playerShots = alive(game.playerShots);
}

function followPath(s: PlayerShot, step: number) {
  while (step > 0 && s.path.length) {
    const t = s.path[0], d = dist(s, t);
    if (d < 1e-6) { s.path.shift(); continue; }
    ({ x: s.dx, y: s.dy } = dirTo(s, t));
    if (d <= step) { s.x = t.x; s.y = t.y; step -= d; s.path.shift(); }
    else { s.x += s.dx * step; s.y += s.dy * step; step = 0; }
  }
}

/** Снаряды бота: полёт, исчезновение о стены, урон игроку. */
export function updateBotShots(game: Game, sdt: number) {
  const p = game.player;
  for (const s of game.botShots) {
    s.x += s.dx * s.speed * sdt;
    s.y += s.dy * s.speed * sdt;
    if (!isFree(s.x, s.y, s.r)) s.dead = true;
    else if (touches(s, p)) {
      s.dead = true;
      if (p.inv <= 0) hurtPlayer(p, 1);
    }
  }
  game.botShots = alive(game.botShots);
}

/** Когда у бота остаётся половина здоровья, он переходит во вторую фазу: стрельба прекращается, показывается надпись. */
export function updateStage(game: Game, dt: number) {
  game.stageBanner = Math.max(0, game.stageBanner - dt);
  if (game.bot.stage === 1 && game.bot.hp <= game.bot.maxHp / 2) {
    game.bot.stage = 2;
    game.botShots = [];
    game.stageBanner = STAGE_BANNER_TIME;
  }
}

/** Таран: столкновение бота с игроком ранит только игрока, не чаще раза в секунду. */
export function updateContact(game: Game, dt: number) {
  const { bot, player } = game;
  bot.contactCd = Math.max(0, bot.contactCd - dt);
  if (bot.contactCd > 0 || !touches(bot, player)) return;
  hurtPlayer(player, bot.stage === 2 ? RAM_DAMAGE_STAGE2 : RAM_DAMAGE);
  bot.contactCd = CONTACT_COOLDOWN;
}

export function checkEnd(game: Game) {
  if (game.bot.hp <= 0) game.over = 'win';
  else if (game.player.hp <= 0) game.over = 'lose';
}