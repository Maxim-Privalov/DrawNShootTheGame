// Сцена Phaser: ввод, пауза, подсказки, порядок обновления, HUD. Логика — в map.ts, player.ts, bot.ts.
import Phaser from 'phaser';
import { W, H, AX, TS, drawMap, updateStage, updatePlayerShots, updateBotShots, updateContact, checkEnd, type Game, type Gfx } from './map';
import { SPELLS, newPlayer, updatePlayer, clickAt, cancelPath, launch, drawPlayer, type SpellId } from './player';
import { newBot, updateBot, drawBot } from './bot';

const SPELL_KEYS: Record<string, SpellId> = { Digit1: 'line', Digit2: 'volley', Digit3: 'wall' };
const SPELL_ORDER = Object.values(SPELL_KEYS);
const LEGEND = 'WASD — ход | ЛКМ — поставить точку | ЛКМ по игроку — сбросить | ПКМ / Esc — отмена | Enter — запуск | 1 / 2 / 3 — заклинание | P — пауза | R — рестарт';
const INTRO = 'КАК ИГРАТЬ\n\nЛКМ по арене — ставить точки атаки (до 8)\nEnter — запустить атаку\n1 / 2 / 3 — выбрать заклинание\nWASD — двигаться,  P — пауза';
const INTRO_SECONDS = 8; // последняя секунда — плавное исчезновение
const PLAYER_BAR = { x: 560, w: 260 }, BOT_BAR = { x: 900, w: 340 };
const TEXT = { fontFamily: 'monospace', fontSize: '18px', color: '#e6e6e6' };

const newGame = (): Game => ({ player: newPlayer(), bot: newBot(), playerShots: [], botShots: [], score: 0, over: '', stageBanner: 0 });

function drawBar(g: Gfx, bar: { x: number; w: number }, frac: number, color: number) {
  g.fillStyle(0x222733, 1); g.fillRect(bar.x, 20, bar.w, 16);
  g.fillStyle(color, 1); g.fillRect(bar.x, 20, bar.w * Math.max(0, frac), 16);
}

/** Показывает текст, пока seconds > 0; в последнюю секунду плавно гасит. */
const fade = (text: Phaser.GameObjects.Text, seconds: number) => text.setVisible(seconds > 0).setAlpha(Math.min(1, seconds));

class Main extends Phaser.Scene {
  round = newGame();
  paused = false;
  introLeft = INTRO_SECONDS;
  keys = new Set<string>();
  g!: Gfx;
  hud!: Phaser.GameObjects.Text;
  banner!: Phaser.GameObjects.Text;
  intro!: Phaser.GameObjects.Text;
  stageText!: Phaser.GameObjects.Text;

  create() {
    this.g = this.add.graphics();
    this.hud = this.add.text(AX, 6, '', { ...TEXT, lineSpacing: 4 });
    this.add.text(AX, H - 20, LEGEND, { ...TEXT, fontSize: '13px', color: '#9aa3b8' });
    this.banner = this.add.text(W / 2, H / 2, '', { ...TEXT, fontSize: '48px', color: '#ffffff', align: 'center', lineSpacing: 12 }).setOrigin(0.5).setVisible(false);
    this.intro = this.add.text(W / 2, 230, INTRO, { ...TEXT, fontSize: '24px', align: 'center', lineSpacing: 10, backgroundColor: '#000000dd', padding: { x: 32, y: 24 } }).setOrigin(0.5);
    this.stageText = this.add.text(W / 2, 150, 'STAGE 2', { ...TEXT, fontSize: '96px', color: '#ff2222', fontStyle: 'bold' }).setOrigin(0.5).setVisible(false);
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (this.round.over || this.paused) return;
      if (ptr.rightButtonDown()) cancelPath(this.round.player);
      else clickAt(this.round.player, { x: ptr.x, y: ptr.y });
    });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      const { player, playerShots, over } = this.round;
      this.keys.add(e.code);
      if (e.code === 'KeyR') { this.round = newGame(); this.paused = false; return; }
      if (e.code === 'KeyP') { if (!over) this.paused = !this.paused; return; }
      if (this.paused) return;
      if (e.code === 'Escape') cancelPath(player);
      else if (e.code === 'Enter' && !over) {
        launch(player, playerShots);
        this.introLeft = Math.min(this.introLeft, 1); // после первого запуска подсказка уходит
      } else if (SPELL_KEYS[e.code]) player.spell = SPELL_KEYS[e.code];
    });
    this.input.keyboard!.on('keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta, 50) / 1000; // реальное время (кулдауны, телеграф)
    const sdt = dt * TS;                   // замедленное время (движение)
    const game = this.round;
    if (!game.over && !this.paused) {
      updateStage(game, dt);
      updatePlayer(game.player, this.keys, dt, sdt);
      updateBot(game.bot, game.player, game.playerShots, game.botShots, dt, sdt);
      updatePlayerShots(game, dt, sdt);
      updateBotShots(game, sdt);
      updateContact(game, dt);
      checkEnd(game);
      this.introLeft = Math.max(0, this.introLeft - dt);
    }
    this.draw();
  }

  draw() {
    const g = this.g, game = this.round, { player, bot } = game, now = this.time.now;
    g.clear();
    drawMap(g);
    drawBot(g, bot, player, game.botShots, now, !game.over);
    drawPlayer(g, player, game.playerShots, this.input.activePointer, now);

    // HUD: полоски HP (маркер на шкале бота — начало фазы 2), счёт и заклинания с клавишами
    drawBar(g, PLAYER_BAR, player.hp / player.maxHp, 0x4da3ff);
    drawBar(g, BOT_BAR, bot.hp / bot.maxHp, 0xff5577);
    g.fillStyle(0xffffff, 1); g.fillRect(BOT_BAR.x + BOT_BAR.w / 2 - 1, 15, 3, 26);
    const spells = SPELL_ORDER.map((id, i) => {
      const label = `${i + 1} ${SPELLS[id].name}`;
      return id === player.spell ? `[${label}]` : ` ${label} `;
    }).join(' ');
    this.hud.setText(`Счёт ${game.score}\n${spells}${player.cd > 0 ? '  …' : ''}`);

    fade(this.stageText, game.stageBanner);
    fade(this.intro, this.introLeft);

    const message = game.over
      ? `${game.over === 'win' ? 'Победа' : 'Поражение'}\nСчёт: ${game.score}\nR — ещё раз`
      : this.paused ? 'Пауза\nP — продолжить\nR — заново' : '';
    if (message) {
      g.fillStyle(0x000000, 0.7); g.fillRect(0, 0, W, H);
      this.banner.setText(message);
    }
    this.banner.setVisible(!!message);
  }
}

new Phaser.Game({ type: Phaser.AUTO, width: W, height: H, parent: 'app', backgroundColor: '#0b0d12', scene: Main });