// Игрок: движение WASD, рисование траектории, три спелла, снаряды игрока.
import { dist, dirTo, slide, inArena, inObstacle, disc, type Pt, type Gfx } from './map';
import { PLAYER, SPELL } from './config';


export type SpellId = 'line' | 'volley' | 'wall';
export const SPELLS: Record<SpellId, { name: string; color: number }> = {
  line: { name: 'Линия', color: 0xffffff },   // один снаряд по ломаной
  volley: { name: 'Залп', color: 0x66ccff },  // по слабому снаряду в каждую точку
  wall: { name: 'Стена', color: 0xffdd33 },   // мины вдоль ломаной
};

export interface PlayerShot {
  x: number; y: number; r: number; dx: number; dy: number; speed: number;
  path: Pt[];        // оставшиеся точки маршрута
  dmg: number; mine: boolean; life: number; color: number;
  minDist: number;   // минимальная дистанция до бота за время полёта (для «почти попал»)
  hit: boolean; dead: boolean;
}

export interface Player {
  x: number; y: number; r: number; hp: number; maxHp: number;
  inv: number;       // оставшаяся неуязвимость, сек
  pts: Pt[];         // рисуемая траектория
  spell: SpellId;
  cd: number;        // кулдаун запуска, сек
}

export const newPlayer = (): Player =>
  ({ x: PLAYER.start.x, y: PLAYER.start.y, r: PLAYER.radius, hp: PLAYER.hp, maxHp: PLAYER.hp, inv: 0, pts: [], spell: 'line', cd: 0 });

const newShot = (o: Partial<PlayerShot>): PlayerShot => ({
  x: 0, y: 0, r: SPELL.line.radius, dx: 0, dy: 0, speed: SPELL.line.speed, path: [], dmg: SPELL.line.damage, mine: false, life: 0,
  color: 0xffffff, minDist: Infinity, hit: false, dead: false, ...o,
});

// ---------- движение ----------
export function updatePlayer(p: Player, keys: Set<string>, dt: number, sdt: number) {
  p.cd = Math.max(0, p.cd - dt);   // кулдаун и неуязвимость — в реальном времени
  p.inv = Math.max(0, p.inv - dt);
  const mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const my = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
  const len = Math.hypot(mx, my);   // нормализация диагоналей
  if (len) slide(p, (mx / len) * PLAYER.speed * sdt, (my / len) * PLAYER.speed * sdt, p.r);
}

// ---------- траектория ----------
export const cancelPath = (p: Player) => { p.pts = []; };

/** ЛКМ: по игроку — начать заново, по пустому месту — добавить точку. */
export function clickAt(p: Player, m: Pt) {
  if (dist(m, p) <= p.r + 6) cancelPath(p);
  else if (p.pts.length < SPELL.maxPoints && inArena(m.x, m.y, 0) && !inObstacle(m.x, m.y, 0)) p.pts.push(m);
}

// ---------- запуск спеллов ----------
export function launch(p: Player, shots: PlayerShot[]) {
  if (p.cd > 0 || !p.pts.length) return;
  const path = p.pts.map(q => ({ ...q }));
  const color = SPELLS[p.spell].color;
  if (p.spell === 'wall') placeMines(p, path, color, shots);
  else if (p.spell === 'volley') for (const q of path) shots.push(aimedShot(p, q, { r: SPELL.volley.radius, path: [q], dmg: SPELL.volley.damage, speed: SPELL.volley.speed, color }));
  else shots.push(aimedShot(p, path[0], { path, color }));
  p.cd = SPELL.cooldown;
  cancelPath(p);
}

/** Снаряд из позиции игрока, летящий к точке `to`. */
function aimedShot(from: Pt, to: Pt, o: Partial<PlayerShot>): PlayerShot {
  const u = dirTo(from, to);
  return newShot({ x: from.x, y: from.y, dx: u.x, dy: u.y, ...o });
}

/** Мины каждые 60 px вдоль ломаной, начиная от игрока. */
function placeMines(p: Player, path: Pt[], color: number, shots: PlayerShot[]) {
  let prev: Pt = { x: p.x, y: p.y }, carry = 0;
  for (const q of path) {
    const len = dist(prev, q);
    let s = SPELL.wall.spacing - carry;
    for (; s <= len && len > 0; s += SPELL.wall.spacing) {
      shots.push(newShot({ x: prev.x + ((q.x - prev.x) * s) / len, y: prev.y + ((q.y - prev.y) * s) / len, r: SPELL.wall.radius, mine: true, life: SPELL.wall.life, color }));
    }
    carry = len - (s - SPELL.wall.spacing);
    prev = q;
  }
}

// ---------- отрисовка ----------
export function drawPlayer(g: Gfx, p: Player, shots: PlayerShot[], mouse: Pt, now: number) {
  const color = SPELLS[p.spell].color;
  if (p.pts.length) {
    // «залп» бьёт из игрока в каждую точку, остальные спеллы идут по ломаной
    let prev: Pt = p;
    g.lineStyle(2, color, 0.6);
    for (const q of p.pts) { g.lineBetween(prev.x, prev.y, q.x, q.y); if (p.spell !== 'volley') prev = q; }
    if (p.pts.length < SPELL.maxPoints && inArena(mouse.x, mouse.y, 0)) {
      g.lineStyle(2, color, 0.3); g.lineBetween(prev.x, prev.y, mouse.x, mouse.y);
    }
    p.pts.forEach(q => disc(g, { ...q, r: 4 }, color));
  }
  for (const s of shots) disc(g, s, s.color, s.mine ? Math.min(1, s.life + 0.2) : 1);
  if (p.inv <= 0 || Math.floor(now / 60) % 2 === 0) disc(g, p, 0x4da3ff);
}
