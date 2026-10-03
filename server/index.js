import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { ARENA, HEROES, PROGRESSION_REWARDS, WEAPONS, WORLD_SCALE } from '../src/game-data.js';

const PORT = Number(process.env.PORT || 3001);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HERO_NAMES = new Set(HEROES.map((hero) => hero.name));
const ROOMS_LIMIT = 4;
const TICK_MS = 50;
const PLAYER_RADIUS = 19;
const PLAYER_SPEED = 275;
const MAX_HEALTH = 100;
const REGEN_DELAY_MS = 3000;
const REGEN_PER_SECOND = 5;
const ROUND_DURATION_MS = 4 * 60 * 1000;
const RECONNECT_GRACE_MS = 30_000;
const KILL_STREAK_WINDOW_MS = 8000;
const MIN_SPAWN_SEPARATION = Math.round(900 * WORLD_SCALE);
const SHOT_SNAPSHOT_MS = 650;
const SHOT_SNAPSHOT_LIMIT = 32;
const rooms = new Map();
const peers = new Map();
const sessions = new Map();

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      healthRegeneration: { maximum: MAX_HEALTH, delayMs: REGEN_DELAY_MS, healthPerSecond: REGEN_PER_SECOND },
    }));
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 2048 });

function send(socket, event, data = {}) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, ...data }));
}

function roomCode() {
  let code;
  do { code = Array.from(randomBytes(5), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join(''); }
  while (rooms.has(code));
  return code;
}

function publicRoom(room, serverNow = Date.now()) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    winnerId: room.winnerId,
    roundNumber: room.roundNumber,
    roundStartedAt: room.roundStartedAt,
    roundDurationMs: ROUND_DURATION_MS,
    roundEndsAt: room.roundStartedAt ? room.roundStartedAt + ROUND_DURATION_MS : null,
    serverNow,
    roundResults: room.roundResults,
    sessionLeaderboard: getSessionLeaderboard(room),
    milestones: room.milestones.slice(-8),
    feed: room.feed.slice(-4),
    shots: room.shots.slice(-SHOT_SNAPSHOT_LIMIT),
    players: [...room.players.values()].map(({ id, name, hero, ready, socket, x, y, health, alive, ammo, reserve, reloading, kills, damageDealt, shotsFired, hits, survivalMs, weaponId, points, roundPoints, sessionStats, input }) => ({
      id, name, hero, ready, x, y, health, alive, ammo, reserve, reloading, kills, damageDealt, shotsFired, hits, survivalMs, weaponId, points, roundPoints,
      connected: socket?.readyState === WebSocket.OPEN,
      accuracy: shotsFired > 0 ? (hits / shotsFired) * 100 : 0,
      sessionStats: { kills: sessionStats?.kills || 0, damageDealt: sessionStats?.damageDealt || 0 },
      // Aim is replicated only so clients can orient the selected top-down sprite.
      aim: input?.aim ?? 0,
    })),
  };
}

function getSessionLeaderboard(room) {
  return [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    kills: player.sessionStats?.kills || 0,
    damage: player.sessionStats?.damageDealt || 0,
    points: player.points || 0,
  })).sort((a, b) => b.points - a.points || b.kills - a.kills || b.damage - a.damage || compareNames(a, b));
}

function broadcast(room) {
  const serverNow = Date.now();
  const snapshot = publicRoom(room, serverNow);
  for (const player of room.players.values()) send(player.socket, 'roomState', { room: snapshot });
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18);
}

function newRoom(code, hostId) {
  return { code, hostId, players: new Map(), phase: 'lobby', winnerId: null, roundNumber: 0, roundStartedAt: 0, roundResults: null, feed: [], milestones: [], shots: [] };
}

function firstAvailableHero(room) {
  const occupied = new Set([...room.players.values()].map((player) => player.hero));
  return HEROES.find((hero) => !occupied.has(hero.name))?.name || HEROES[0].name;
}

function hasUniqueHeroes(room) {
  const selected = [...room.players.values()].map((player) => player.hero);
  return selected.every((hero) => HERO_NAMES.has(hero)) && new Set(selected).size === selected.length;
}

function everyoneReadyAndConnected(room) {
  return [...room.players.values()].every((player) => player.ready && player.socket?.readyState === WebSocket.OPEN);
}

function makePlayer(name, room) {
  const sessionToken = randomBytes(32).toString('hex');
  const player = {
    id: randomBytes(12).toString('hex'),
    sessionToken,
    name,
    hero: firstAvailableHero(room),
    ready: false,
    socket: null,
    weaponId: 'cinder',
    points: 0,
    roundPoints: 0,
    damagePointRemainder: 0,
    sessionStats: { kills: 0, damageDealt: 0 },
    input: { x: 0, y: 0, aim: 0, fire: false, reload: false },
    disconnectTimer: null,
  };
  sessions.set(sessionToken, { roomCode: room.code, playerId: player.id });
  return player;
}

function attachPlayerSocket(room, player, socket) {
  const previousSocket = player.socket;
  if (previousSocket && previousSocket !== socket) {
    peers.delete(previousSocket);
    if (previousSocket.readyState === WebSocket.OPEN || previousSocket.readyState === WebSocket.CONNECTING) {
      previousSocket.close(4001, 'This room session reconnected elsewhere.');
    }
  }
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  player.socket = socket;
  player.disconnectedAt = 0;
  peers.set(socket, { roomCode: room.code, playerId: player.id });
}

function addFeed(room, text, kind = 'event', extra = {}) {
  const entry = { id: randomBytes(4).toString('hex'), text, kind, at: Date.now(), ...extra };
  room.feed.push(entry);
  if (kind === 'milestone') room.milestones.push(entry);
  room.feed = room.feed.slice(-8);
  room.milestones = room.milestones.slice(-8);
}

function compareNames(a, b) { return a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id); }
function playerAccuracy(player) { return player.shotsFired > 0 ? player.hits / player.shotsFired * 100 : 0; }

function buildTopFragger(players) {
  const top = [...players].sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt || compareNames(a, b))[0];
  return top ? { playerId: top.id, playerName: top.name, kills: top.kills || 0, damageDealt: top.damageDealt || 0 } : null;
}

function finishRound(room, winnerId, now) {
  if (room.phase !== 'playing') return;
  const durationMs = Math.max(0, Math.min(ROUND_DURATION_MS, now - room.roundStartedAt));
  room.phase = 'finished';
  room.winnerId = winnerId;
  for (const player of room.players.values()) {
    if (player.alive) player.survivalMs = durationMs;
    else if (!Number.isFinite(player.survivalMs)) player.survivalMs = Math.max(0, (player.eliminatedAt || now) - room.roundStartedAt);
  }
  const winner = room.players.get(winnerId);
  if (winner) awardPoints(winner, PROGRESSION_REWARDS.winner);
  const stats = [...room.players.values()].map((player) => ({
    playerId: player.id,
    playerName: player.name,
    hero: player.hero,
    result: player.id === winnerId ? 'VICTORY' : player.alive ? 'SURVIVED' : 'ELIMINATED',
    kills: player.kills || 0,
    damageDealt: player.damageDealt || 0,
    shotsFired: player.shotsFired || 0,
    hits: player.hits || 0,
    accuracy: playerAccuracy(player),
    survivalMs: player.survivalMs || 0,
    points: player.roundPoints || 0,
  }));
  room.roundResults = { roundNumber: room.roundNumber, winnerId: winnerId || null, startedAt: room.roundStartedAt, endedAt: now, durationMs, stats, topFragger: buildTopFragger([...room.players.values()]) };
  addFeed(room, winner ? `${winner.name} wins Round ${room.roundNumber}.` : `Round ${room.roundNumber} ends in a draw.`, winner ? 'win' : 'event');
}

function resolveMatchEnd(room, now = Date.now()) {
  if (room.phase !== 'playing') return;
  const alive = [...room.players.values()].filter((player) => player.alive);
  if (alive.length <= 1) {
    finishRound(room, alive[0]?.id || null, now);
  }
}

function finishTimedRound(room, now) {
  const contenders = [...room.players.values()].filter((player) => player.alive)
    .sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt || b.points - a.points || compareNames(a, b));
  finishRound(room, contenders[0]?.id || null, now);
}

function removePlayer(room, player, { preserveSocket = null, announce = true } = {}) {
  if (!room || room.players.get(player.id) !== player) return false;
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  sessions.delete(player.sessionToken);
  const previousSocket = player.socket;
  if (previousSocket) {
    peers.delete(previousSocket);
    player.socket = null;
    if (previousSocket !== preserveSocket && (previousSocket.readyState === WebSocket.OPEN || previousSocket.readyState === WebSocket.CONNECTING)) {
      previousSocket.close(4002, 'This room session has ended.');
    }
  }
  const wasHost = room.hostId === player.id;
  room.players.delete(player.id);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return true;
  }
  if (wasHost) {
    // Keep host control with the earliest connected remaining contender.
    const successor = [...room.players.values()].find((entry) => entry.socket?.readyState === WebSocket.OPEN)
      || room.players.values().next().value;
    room.hostId = successor.id;
  }
  if (announce && room.phase === 'playing' && player.alive) {
    addFeed(room, `${player.name} left the arena.`, 'event');
    if (!wasHost) resolveMatchEnd(room, Date.now());
  }
  if (room.phase === 'finished' && room.players.size >= 2 && hasUniqueHeroes(room) && everyoneReadyAndConnected(room)) startMatch(room);
  else broadcast(room);
  return true;
}

function disconnectPlayer(socket) {
  const peer = peers.get(socket);
  if (!peer) return;
  peers.delete(socket);
  const room = rooms.get(peer.roomCode);
  const player = room?.players.get(peer.playerId);
  // Replacing a connection removes its peer mapping before the old socket closes.
  if (!room || !player || player.socket !== socket) return;
  player.socket = null;
  player.disconnectedAt = Date.now();
  player.input = { ...player.input, x: 0, y: 0, fire: false, reload: false };
  clearTimeout(player.disconnectTimer);
  player.disconnectTimer = setTimeout(() => {
    if (room.players.get(player.id) !== player || player.socket) return;
    removePlayer(room, player);
  }, RECONNECT_GRACE_MS);
  player.disconnectTimer.unref?.();
  broadcast(room);
}

function fail(socket, message) { send(socket, 'error', { message }); }

function getWeapon(player) { return WEAPONS[player.weaponId] || WEAPONS.cinder; }

function awardPoints(player, points) {
  const awarded = Math.max(0, Math.floor(points));
  player.points = (player.points || 0) + awarded;
  player.roundPoints = (player.roundPoints || 0) + awarded;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function chooseRoundSpawns(count) {
  const anchors = shuffle(ARENA.spawns);
  const chosen = [];
  for (const anchor of anchors.slice(0, count)) {
    let spawn = null;
    for (let attempt = 0; attempt < 80 && !spawn; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = randomInt(Math.round(25 * WORLD_SCALE), Math.round(111 * WORLD_SCALE));
      const candidate = { x: Math.round(anchor.x + Math.cos(angle) * radius), y: Math.round(anchor.y + Math.sin(angle) * radius) };
      if (collides(candidate.x, candidate.y)) continue;
      if (chosen.some((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) < MIN_SPAWN_SEPARATION)) continue;
      spawn = candidate;
    }
    chosen.push(spawn || anchor);
  }
  return chosen;
}

function startMatch(room) {
  const now = Date.now();
  room.phase = 'playing';
  room.winnerId = null;
  room.roundNumber += 1;
  room.roundStartedAt = now;
  room.roundResults = null;
  room.feed = [];
  room.milestones = [];
  room.shots = [];
  const spawns = chooseRoundSpawns(room.players.size);
  let index = 0;
  for (const player of room.players.values()) {
    const spawn = spawns[index++ % spawns.length];
    player.x = spawn.x;
    player.y = spawn.y;
    player.health = MAX_HEALTH;
    player.lastDamageAt = now;
    player.alive = true;
    const weapon = getWeapon(player);
    player.ammo = weapon.magazineSize;
    player.reserve = weapon.reserveAmmo;
    player.reloading = false;
    player.reloadAt = 0;
    player.reloadRequested = false;
    player.lastShot = 0;
    player.input = { x: 0, y: 0, aim: 0, fire: false, reload: false };
    player.kills = 0;
    player.damageDealt = 0;
    player.shotsFired = 0;
    player.hits = 0;
    player.survivalMs = 0;
    player.eliminatedAt = 0;
    player.killStreak = 0;
    player.lastKillAt = 0;
    player.roundPoints = 0;
    player.ready = false;
  }
  addFeed(room, `${room.players.size} contenders enter ${ARENA.name}.`);
  broadcast(room);
}

function collides(x, y) {
  if (x < PLAYER_RADIUS || y < PLAYER_RADIUS || x > ARENA.width - PLAYER_RADIUS || y > ARENA.height - PLAYER_RADIUS) return true;
  return ARENA.cover.some(({ x: cx, y: cy, w, h }) =>
    x + PLAYER_RADIUS > cx && x - PLAYER_RADIUS < cx + w && y + PLAYER_RADIUS > cy && y - PLAYER_RADIUS < cy + h);
}

function hasLineOfSight(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  for (const block of ARENA.cover) {
    let tMin = 0;
    let tMax = 1;
    for (const [origin, delta, min, max] of [[x1, dx, block.x, block.x + block.w], [y1, dy, block.y, block.y + block.h]]) {
      if (Math.abs(delta) < 0.0001) { if (origin < min || origin > max) { tMin = 2; break; } }
      else {
        const a = (min - origin) / delta;
        const b = (max - origin) / delta;
        tMin = Math.max(tMin, Math.min(a, b));
        tMax = Math.min(tMax, Math.max(a, b));
      }
    }
    if (tMin <= tMax && tMax >= 0 && tMin <= 1) return false;
  }
  return true;
}

function rayRectDistance(originX, originY, directionX, directionY, rect, maxDistance) {
  let near = 0;
  let far = maxDistance;
  for (const [origin, direction, min, max] of [
    [originX, directionX, rect.x, rect.x + rect.w],
    [originY, directionY, rect.y, rect.y + rect.h],
  ]) {
    if (Math.abs(direction) < 0.000001) {
      if (origin < min || origin > max) return null;
      continue;
    }
    const first = (min - origin) / direction;
    const second = (max - origin) / direction;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  return far >= 0 && near <= maxDistance ? Math.max(0, near) : null;
}

function firstWallHit(originX, originY, directionX, directionY, range) {
  let distance = range;
  let hit = false;
  const bounds = 15;
  const edges = [
    directionX < -0.000001 ? (bounds - originX) / directionX : Infinity,
    directionX > 0.000001 ? (ARENA.width - bounds - originX) / directionX : Infinity,
    directionY < -0.000001 ? (bounds - originY) / directionY : Infinity,
    directionY > 0.000001 ? (ARENA.height - bounds - originY) / directionY : Infinity,
  ];
  for (const edgeDistance of edges) {
    if (edgeDistance >= 0 && edgeDistance < distance) { distance = edgeDistance; hit = true; }
  }
  for (const cover of ARENA.cover) {
    const coverDistance = rayRectDistance(originX, originY, directionX, directionY, cover, distance);
    if (coverDistance !== null && coverDistance < distance) { distance = coverDistance; hit = true; }
  }
  return { distance, hit };
}

function shoot(room, shooter, now) {
  const weapon = getWeapon(shooter);
  if (!shooter.input.fire || !shooter.alive || shooter.reloading || now - shooter.lastShot < weapon.fireRateMs) return;
  if (shooter.ammo <= 0) {
    if (shooter.reserve > 0) { shooter.reloading = true; shooter.reloadAt = now + weapon.reloadMs; }
    return;
  }
  shooter.lastShot = now;
  shooter.ammo -= 1;
  shooter.shotsFired += 1;
  const spread = weapon.spreadDegrees * Math.PI / 180;
  const angle = shooter.input.aim + (Math.random() * 2 - 1) * spread;
  const vx = Math.cos(angle);
  const vy = Math.sin(angle);
  const wall = firstWallHit(shooter.x, shooter.y, vx, vy, weapon.range);
  let hit = null;
  let hitAlong = Infinity;
  let hitDistance = Infinity;
  for (const target of room.players.values()) {
    if (!target.alive || target.id === shooter.id) continue;
    const rx = target.x - shooter.x;
    const ry = target.y - shooter.y;
    const along = rx * vx + ry * vy;
    if (along < 0 || along > wall.distance || along > hitAlong) continue;
    const across = Math.abs(rx * vy - ry * vx);
    if (across <= PLAYER_RADIUS + 5 && hasLineOfSight(shooter.x, shooter.y, target.x, target.y)) {
      hit = target;
      hitAlong = along;
      hitDistance = Math.hypot(rx, ry);
    }
  }
  const endDistance = hit ? hitDistance : wall.distance;
  const endX = shooter.x + vx * endDistance;
  const endY = shooter.y + vy * endDistance;
  room.shots.push({
    id: randomBytes(3).toString('hex'), x1: shooter.x, y1: shooter.y,
    x2: hit ? hit.x : endX, y2: hit ? hit.y : endY,
    at: now, hit: Boolean(hit), wall: !hit && wall.hit, speed: weapon.projectileSpeed, weaponId: weapon.id,
  });
  room.shots = room.shots.slice(-SHOT_SNAPSHOT_LIMIT);
  if (hit) {
    hit.lastDamageAt = now;
    shooter.hits += 1;
    const actualDamage = Math.min(hit.health, weapon.damage);
    hit.health = Math.max(0, hit.health - actualDamage);
    shooter.damageDealt += actualDamage;
    shooter.sessionStats.damageDealt += actualDamage;
    const damageForPoints = actualDamage + (shooter.damagePointRemainder || 0);
    awardPoints(shooter, Math.floor(damageForPoints / PROGRESSION_REWARDS.damagePointsPerHp));
    shooter.damagePointRemainder = damageForPoints % PROGRESSION_REWARDS.damagePointsPerHp;
    if (hit.health === 0) {
      hit.alive = false;
      hit.eliminatedAt = now;
      hit.survivalMs = Math.max(0, now - room.roundStartedAt);
      hit.killStreak = 0;
      hit.lastKillAt = 0;
      shooter.kills += 1;
      shooter.sessionStats.kills += 1;
      shooter.killStreak = now - shooter.lastKillAt <= KILL_STREAK_WINDOW_MS ? shooter.killStreak + 1 : 1;
      shooter.lastKillAt = now;
      awardPoints(shooter, PROGRESSION_REWARDS.elimination);
      addFeed(room, `${shooter.name} outlasts ${hit.name}.`, 'elimination');
      if (shooter.killStreak === 2) addFeed(room, 'DOUBLE KILL', 'milestone', { playerId: shooter.id, label: 'DOUBLE KILL' });
      else if (shooter.killStreak === 3) addFeed(room, 'TRIPLE KILL', 'milestone', { playerId: shooter.id, label: 'TRIPLE KILL' });
      resolveMatchEnd(room, now);
    } else addFeed(room, `${shooter.name} tags ${hit.name}.`, 'hit');
  }
}

function tickRoom(room, now) {
  if (room.phase !== 'playing') return;
  if (now >= room.roundStartedAt + ROUND_DURATION_MS) {
    finishTimedRound(room, now);
    room.shots = room.shots.filter((shot) => now - shot.at < SHOT_SNAPSHOT_MS);
    broadcast(room);
    return;
  }
  const dt = TICK_MS / 1000;
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    if (player.killStreak > 0 && now - player.lastKillAt > KILL_STREAK_WINDOW_MS) player.killStreak = 0;
    // Recover safely if a room/player was created before the regen timestamp existed.
    if (!Number.isFinite(player.lastDamageAt)) player.lastDamageAt = now;
    if (player.reloading && now >= player.reloadAt) {
      const weapon = getWeapon(player);
      const loaded = Math.min(weapon.magazineSize - player.ammo, player.reserve);
      player.ammo += loaded;
      player.reserve -= loaded;
      player.reloading = false;
    }
    const { x: inputX, y: inputY } = player.input;
    const inputLength = Math.hypot(inputX, inputY);
    const length = inputLength || 1;
    // Preserve partial analog-stick deflection, while capping diagonals at full speed.
    const movementScale = Math.min(1, inputLength);
    const stepX = (inputX / length) * PLAYER_SPEED * dt * movementScale;
    const stepY = (inputY / length) * PLAYER_SPEED * dt * movementScale;
    if (!collides(player.x + stepX, player.y)) player.x += stepX;
    if (!collides(player.x, player.y + stepY)) player.y += stepY;
    const weapon = getWeapon(player);
    if (player.reloadRequested && !player.reloading && player.ammo < weapon.magazineSize && player.reserve > 0) {
      player.reloading = true;
      player.reloadAt = now + weapon.reloadMs;
    }
    player.reloadRequested = false;
    shoot(room, player, now);
    if (room.phase !== 'playing') break;
  }
  if (room.phase === 'playing') {
    for (const player of room.players.values()) {
      if (player.alive && player.health < MAX_HEALTH && now - player.lastDamageAt >= REGEN_DELAY_MS) {
        player.health = Math.min(MAX_HEALTH, player.health + REGEN_PER_SECOND * dt);
      }
    }
  }
  room.shots = room.shots.filter((shot) => now - shot.at < SHOT_SNAPSHOT_MS);
  broadcast(room);
}

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { fail(socket, 'That message could not be read.'); return; }
    if (!message || typeof message.event !== 'string') return;
    const peer = peers.get(socket);

    if (message.event === 'rejoinRoom') {
      if (peer) return fail(socket, 'This connection is already in a room.');
      const token = typeof message.sessionToken === 'string' ? message.sessionToken : '';
      const session = sessions.get(token);
      const room = session && rooms.get(session.roomCode);
      const player = room?.players.get(session?.playerId);
      if (!player || player.sessionToken !== token) {
        sessions.delete(token);
        send(socket, 'rejoinFailed', { message: 'Your room is no longer available. Create or join another room.' });
        return;
      }
      attachPlayerSocket(room, player, socket);
      send(socket, 'joinedRoom', { playerId: player.id, sessionToken: player.sessionToken, resumed: true, room: publicRoom(room) });
      broadcast(room);
      return;
    }

    if (message.event === 'leaveSession') {
      const token = typeof message.sessionToken === 'string' ? message.sessionToken : '';
      const session = sessions.get(token);
      const room = session && rooms.get(session.roomCode);
      const player = room?.players.get(session?.playerId);
      if (player && player.sessionToken === token) removePlayer(room, player, { preserveSocket: socket });
      send(socket, 'leftRoom');
      return;
    }

    if (message.event === 'createRoom') {
      if (peer) return fail(socket, 'Leave your current room before creating another.');
      const name = cleanName(message.name);
      if (!name) return fail(socket, 'Add a callsign first.');
      const code = roomCode();
      const room = newRoom(code, '');
      const player = makePlayer(name, room);
      room.hostId = player.id;
      room.players.set(player.id, player);
      rooms.set(code, room);
      attachPlayerSocket(room, player, socket);
      send(socket, 'joinedRoom', { playerId: player.id, sessionToken: player.sessionToken, resumed: false, room: publicRoom(room) });
      broadcast(room);
      return;
    }

    if (message.event === 'joinRoom') {
      if (peer) return fail(socket, 'Leave your current room before joining another.');
      const name = cleanName(message.name);
      const code = typeof message.code === 'string' ? message.code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
      if (!name) return fail(socket, 'Add a callsign first.');
      const room = rooms.get(code);
      if (!room) return fail(socket, 'We could not find that room. Check the code and try again.');
      if (room.phase === 'playing') return fail(socket, 'That match is already underway. Join after the round.');
      if (room.players.size >= ROOMS_LIMIT) return fail(socket, 'That room has all four seats filled.');
      const player = makePlayer(name, room);
      room.players.set(player.id, player);
      attachPlayerSocket(room, player, socket);
      send(socket, 'joinedRoom', { playerId: player.id, sessionToken: player.sessionToken, resumed: false, room: publicRoom(room) });
      broadcast(room);
      return;
    }

    if (!peer) return fail(socket, 'Join a room first.');
    const room = rooms.get(peer.roomCode);
    const player = room?.players.get(peer.playerId);
    if (!room || !player) return fail(socket, 'That room is no longer available.');

    if (message.event === 'selectHero') {
      if (room.phase !== 'lobby' && room.phase !== 'finished') return fail(socket, 'Contenders are locked during a match.');
      if (!HERO_NAMES.has(message.hero)) return fail(socket, 'That contender is not available.');
      const owner = [...room.players.values()].find((entry) => entry.id !== player.id && entry.hero === message.hero);
      if (owner) return fail(socket, `${message.hero} is already in use. Choose another contender.`);
      player.hero = message.hero;
      player.ready = false;
      broadcast(room);
    } else if (message.event === 'selectWeapon') {
      if (room.phase !== 'lobby' && room.phase !== 'finished') return fail(socket, 'Loadouts are locked during a match.');
      const weapon = typeof message.weaponId === 'string' ? WEAPONS[message.weaponId] : null;
      if (!weapon || !Object.hasOwn(WEAPONS, message.weaponId)) return fail(socket, 'That weapon is not available.');
      if ((player.points || 0) < weapon.unlockPoints) return fail(socket, 'You need more session points to unlock that weapon.');
      player.weaponId = weapon.id;
      player.ready = false;
      broadcast(room);
    } else if (message.event === 'setReady') {
      if (room.phase === 'playing') return;
      if (room.phase !== 'lobby' && room.phase !== 'finished') return fail(socket, 'Ready status is locked right now.');
      player.ready = Boolean(message.ready);
      if (room.phase === 'finished' && room.players.size >= 2 && hasUniqueHeroes(room) && everyoneReadyAndConnected(room)) {
        startMatch(room);
        return;
      }
      broadcast(room);
    } else if (message.event === 'startMatch') {
      if (room.hostId !== player.id) return fail(socket, 'Only the room host can launch the arena.');
      if (room.players.size < 2) return fail(socket, 'At least two contenders are needed for a round.');
      if (!hasUniqueHeroes(room)) return fail(socket, 'Every contender must use a different character before the match starts.');
      if (room.phase !== 'lobby') return fail(socket, 'This room cannot launch a round right now.');
      if (!everyoneReadyAndConnected(room)) return fail(socket, 'Everyone connected needs to ready up before the drop.');
      startMatch(room);
    } else if (message.event === 'input') {
      if (room.phase !== 'playing' || !player.alive) return;
      if (message.reload && !player.input.reload) player.reloadRequested = true;
      player.input = {
        x: Number.isFinite(message.x) ? Math.max(-1, Math.min(1, message.x)) : 0,
        y: Number.isFinite(message.y) ? Math.max(-1, Math.min(1, message.y)) : 0,
        aim: Number.isFinite(message.aim) ? message.aim : player.input.aim,
        fire: Boolean(message.fire),
        reload: Boolean(message.reload),
      };
    } else if (message.event === 'leaveRoom') {
      removePlayer(room, player, { preserveSocket: socket });
      send(socket, 'leftRoom');
    }
  });
  socket.on('close', () => disconnectPlayer(socket));
  socket.on('error', () => disconnectPlayer(socket));
});

setInterval(() => { const now = Date.now(); for (const room of rooms.values()) tickRoom(room, now); }, TICK_MS);
httpServer.listen(PORT, '0.0.0.0', () => console.log(`INDIA'S GOT WARRIORS room server listening on ${PORT}`));

