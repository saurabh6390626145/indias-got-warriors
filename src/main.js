import './style.css';
import '@fontsource/orbitron/latin-500.css';
import '@fontsource/orbitron/latin-700.css';
import '@fontsource/orbitron/latin-800.css';
import '@fontsource/orbitron/latin-900.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import { ARENA, HEROES, HERO_COLORS, PROGRESSION_REWARDS, WEAPONS, WORLD_SCALE } from './game-data.js';
// The roster is shared with the server so selection and sprite mappings stay aligned.
const CARD_REFERENCE_HERO = HEROES.find((hero) => hero.name === 'Nira');
function heroDisplayName(heroId) {
  return HEROES.find((hero) => hero.name === heroId)?.displayName || heroId;
}
const CARD_REFERENCE_HEIGHT = (CARD_REFERENCE_HERO.visualBounds.bottom - CARD_REFERENCE_HERO.visualBounds.top) / CARD_REFERENCE_HERO.spriteSourceSize;
function heroCardScale(hero) {
  const visibleHeight = (hero.visualBounds.bottom - hero.visualBounds.top) / hero.spriteSourceSize;
  return CARD_REFERENCE_HEIGHT / visibleHeight;
}
function projectedSpriteHeight(hero) {
  const { left, top, right, bottom } = hero.visualBounds;
  const center = hero.spriteSourceSize / 2;
  const projected = [top - center, bottom - center];
  return (Math.max(...projected) - Math.min(...projected)) / hero.spriteSourceSize;
}
const GAMEPLAY_SPRITE_BASE_SIZE = 66;
const GAMEPLAY_REFERENCE_HEIGHT = projectedSpriteHeight(CARD_REFERENCE_HERO);
const HERO_SPRITES = Object.freeze(Object.fromEntries(HEROES.map((hero) => [hero.name, {
  src: hero.sprite,
  size: GAMEPLAY_SPRITE_BASE_SIZE * GAMEPLAY_REFERENCE_HEIGHT / projectedSpriteHeight(hero),
  sourceSize: hero.spriteSourceSize,
  visualBounds: hero.visualBounds,
}])));
const heroSpriteCache = new Map();
for (const [hero, sprite] of Object.entries(HERO_SPRITES)) {
  const image = new Image();
  image.addEventListener('error', () => console.warn(`[INDIA'S GOT WARRIORS] Could not load ${sprite.src}; using the procedural player fallback for ${hero}.`), { once: true });
  image.src = sprite.src;
  heroSpriteCache.set(hero, image);
}
const $ = (selector) => document.querySelector(selector);
const landingView = $('#landing-view');
const lobbyView = $('#lobby-view');
const gameView = $('#game-view');
const nameInput = $('#player-name');
const codeInput = $('#room-code');
const errorBox = $('#form-error');
const connectionLabel = $('#connection-label');
const canvas = $('#arena-canvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = $('#minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');
const minimapStaticCanvas = document.createElement('canvas');
const minimapStaticCtx = minimapStaticCanvas.getContext('2d');
const touchControlsElement = $('#touch-controls');
const movePad = $('#move-pad');
const moveKnob = $('#move-knob');
const aimPad = $('#aim-pad');
const aimKnob = $('#aim-knob');
const stickElements = { move: { pad: movePad, knob: moveKnob }, aim: { pad: aimPad, knob: aimKnob } };
const stickPointers = { move: null, aim: null };
const touchDebugBadge = $('#touch-debug');
const touchDebugEnabled = new URLSearchParams(location.search).get('debug') === '1';
const SHOT_RENDER_MS = 360;
const BULLET_VISUAL_SPEED = 3600;
const BULLET_TRAIL_LENGTH = 58;
const BULLET_IMPACT_MS = 100;
const GUNSHOT_AUDIBLE_RADIUS = 1250;
const TOUCH_STICK_SIZE_KEY = 'rift-arena-touch-stick-size';
const ROOM_SESSION_KEY = 'igw-room-session-v1';
const ROUND_TIMER_ELEMENT = $('#round-timer');
function readRoomSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ROOM_SESSION_KEY) || 'null');
    return saved && typeof saved.token === 'string' && typeof saved.roomCode === 'string' ? saved : null;
  } catch { return null; }
}
function persistRoomSession(session) {
  roomSession = session;
  try {
    if (session) sessionStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(ROOM_SESSION_KEY);
  } catch { /* In-memory reconnect remains available while this page is open. */ }
}
let savedTouchStickSize = 130;
try { savedTouchStickSize = Number(localStorage.getItem(TOUCH_STICK_SIZE_KEY)); } catch { /* Use the default if storage is restricted. */ }
let touchStickSize = Number.isFinite(savedTouchStickSize) && savedTouchStickSize >= 80 && savedTouchStickSize <= 160 ? savedTouchStickSize : 130;
let socket;
let roomSession = readRoomSession();
let playerId = '';
let room = null;
let queuedAction = null;
let selectedHero = 'Morrow';
let ready = false;
let reconnectTimer;
let serverClockOffsetMs = 0;
let frameWidth = 800;
let frameHeight = 500;
let canvasLeft = 0;
let canvasTop = 0;
let pixelRatio = 1;
let minimapPixelRatio = 1;
let minimapCssWidth = 0;
let minimapCssHeight = 0;
let touchControlSafeBounds = [];
let arenaFrameRequest = 0;
let touchControlsShown = null;
let matchGestureHandlersAttached = false;
let camera = { x: 0, y: 0 };
let renderedSelfAim = null;
let lastArenaFrameAt = 0;
let aimPoint = { x: 0, y: 0 };
let firing = false;
let reloadQueued = false;
let mobileAim = null;
let mobileMoveAim = null;
let mobileRightActive = false;
let mobileAwmFireUntil = 0;
let firstTouchSeen = false;
let lastTouchPointerEvent = 'none';
const touchDebugErrors = [];
let touchDebugLastRenderAt = 0;
const shotFirstSeenAt = new Map();
const seenMilestoneIds = new Set();
let killMilestoneTimer = 0;
let playerSnapshotHistory = [];
let lobbyPlayerSignature = '';
let heroCardSignature = '';
let matchFeedSignature = '';
let resultsSignature = '';
let lastRenderedPhase = null;
const stickGeometry = { move: null, aim: null };
let arenaArtCache = new Map();
let arenaArtCachePixelRatio = 0;
const districtLabelWidths = new Map();
let gameAudioContext = null;
let gameAudioBus = null;
const gameSoundBuffers = new Map();
const gameSoundLoadPromises = new Map();
const activeSoundVoices = new Map();
let gameAudioUnlocked = false;
const LOCAL_PLAYER_SPEED = 275;
const LOCAL_PLAYER_RADIUS = 19;
let predictedSelfPosition = null;
let lastPredictionFrameAt = 0;
let menuOpen = false;
let inActiveMatch = false;
let armoryOpen = false;
const pressed = new Set();
const lastInput = { x: 0, y: 0, aim: 0, fire: false, reload: false };

function loadWeaponSound(weapon) {
  if (!gameAudioContext || !weapon?.soundAsset) return Promise.resolve(null);
  if (gameSoundBuffers.has(weapon.id)) return Promise.resolve(gameSoundBuffers.get(weapon.id));
  if (gameSoundLoadPromises.has(weapon.id)) return gameSoundLoadPromises.get(weapon.id);
  const loading = fetch(weapon.soundAsset)
    .then((response) => { if (!response.ok) throw new Error(`Audio request failed (${response.status}).`); return response.arrayBuffer(); })
    .then((data) => gameAudioContext.decodeAudioData(data))
    .then((buffer) => { gameSoundBuffers.set(weapon.id, buffer); return buffer; })
    .catch((error) => {
      gameSoundLoadPromises.delete(weapon.id);
      console.warn(`[INDIA'S GOT WARRIORS] ${weapon.name} firing sound could not load.`, error);
      return null;
    });
  gameSoundLoadPromises.set(weapon.id, loading);
  return loading;
}

function unlockGameAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!gameAudioContext) {
    try {
      gameAudioContext = new AudioContextClass();
      gameAudioBus = gameAudioContext.createGain();
      gameAudioBus.gain.value = .48;
      const limiter = gameAudioContext.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.knee.value = 10;
      limiter.ratio.value = 8;
      limiter.attack.value = .003;
      limiter.release.value = .12;
      gameAudioBus.connect(limiter);
      limiter.connect(gameAudioContext.destination);
    } catch (error) {
      console.warn('[INDIA\'S GOT WARRIORS] Game audio could not initialize.', error);
      return;
    }
  }
  Object.values(WEAPONS).forEach(loadWeaponSound);
  if (gameAudioContext.state !== 'running') {
    gameAudioContext.resume().then(() => { gameAudioUnlocked = gameAudioContext.state === 'running'; }).catch(() => {});
  } else gameAudioUnlocked = true;
}

document.addEventListener('pointerdown', unlockGameAudio, { capture: true, passive: true });
document.addEventListener('touchstart', unlockGameAudio, { capture: true, passive: true });
document.addEventListener('keydown', unlockGameAudio, { capture: true });

function playWeaponFireSound(shot, listener, receivedAt = performance.now()) {
  if (!gameAudioContext || !listener) return;
  if (!gameAudioUnlocked) {
    if (gameAudioContext.state === 'running') gameAudioUnlocked = true;
    else if (gameAudioContext.state === 'suspended') {
      gameAudioContext.resume().then(() => {
        gameAudioUnlocked = gameAudioContext.state === 'running';
        if (gameAudioUnlocked && performance.now() - receivedAt <= 280) playWeaponFireSound(shot, listener, receivedAt);
      }).catch(() => {});
      return;
    } else return;
  }
  const weapon = WEAPONS[shot.weaponId] || WEAPONS.cinder;
  const distance = Math.hypot(shot.x1 - listener.x, shot.y1 - listener.y);
  if (!Number.isFinite(distance) || distance > GUNSHOT_AUDIBLE_RADIUS) return;
  const attenuation = 1 - .72 * (distance / GUNSHOT_AUDIBLE_RADIUS);
  const playBuffer = (buffer) => {
    if (!buffer || !gameAudioUnlocked || gameAudioContext.state !== 'running' || performance.now() - receivedAt > 280) return;
    const now = gameAudioContext.currentTime;
    const voices = activeSoundVoices.get(weapon.id) || [];
    const voiceLimit = weapon.maxAudioVoices || 3;
    while (voices.length >= voiceLimit) {
      const olderVoice = voices.shift();
      const currentGain = olderVoice.gain.gain.value;
      olderVoice.gain.gain.cancelScheduledValues(now);
      olderVoice.gain.gain.setTargetAtTime(currentGain * .3, now, .008);
    }

    const shotGain = gameAudioContext.createGain();
    shotGain.gain.setValueAtTime(attenuation * (weapon.soundGain || 1), now);
    const panner = gameAudioContext.createStereoPanner ? gameAudioContext.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, (shot.x1 - listener.x) / 420));
      shotGain.connect(panner);
      panner.connect(gameAudioBus);
    } else shotGain.connect(gameAudioBus);

    const source = gameAudioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = weapon.soundPitch * (0.985 + Math.random() * 0.03);
    source.connect(shotGain);
    const voice = { source, gain: shotGain };
    voices.push(voice);
    activeSoundVoices.set(weapon.id, voices);
    source.onended = () => {
      const currentVoices = activeSoundVoices.get(weapon.id) || [];
      activeSoundVoices.set(weapon.id, currentVoices.filter((entry) => entry !== voice));
      source.disconnect(); shotGain.disconnect(); panner?.disconnect();
    };
    source.start(now);
  };

  const buffer = gameSoundBuffers.get(weapon.id);
  if (buffer) playBuffer(buffer);
  else loadWeaponSound(weapon).then(playBuffer);
}

function playKillMilestoneSound(label) {
  if (!gameAudioContext || !gameAudioBus || !gameAudioUnlocked || gameAudioContext.state !== 'running') return;
  const notes = label === 'TRIPLE KILL' ? [640, 820, 1040] : [700, 940];
  const start = gameAudioContext.currentTime;
  notes.forEach((frequency, index) => {
    const oscillator = gameAudioContext.createOscillator();
    const gain = gameAudioContext.createGain();
    const at = start + index * .075;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * .78, at + .16);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(index === notes.length - 1 ? .105 : .07, at + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .24);
    oscillator.connect(gain);
    gain.connect(gameAudioBus);
    oscillator.start(at);
    oscillator.stop(at + .25);
    oscillator.addEventListener('ended', () => { oscillator.disconnect(); gain.disconnect(); }, { once: true });
  });
}

if (touchDebugEnabled) {
  touchDebugBadge.classList.remove('hidden');
  touchDebugBadge.classList.add('is-enabled');
  setInterval(updateTouchDebugBadge, 150);
}
window.addEventListener('error', (event) => recordTouchDebugError(`JS error: ${event.message || 'unknown'}${event.lineno ? ` @${event.lineno}:${event.colno || 0}` : ''}`));
window.addEventListener('unhandledrejection', (event) => recordTouchDebugError(`Promise rejection: ${String(event.reason?.message || event.reason || 'unknown')}`));
function hasTouchCapability() {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || firstTouchSeen;
}
function syncTouchControls(gameActive) {
  const show = gameActive && hasTouchCapability();
  if (show !== touchControlsShown) {
    touchControlsShown = show;
    document.body.classList.toggle('touch-device', show);
    touchControlsElement.classList.toggle('touch-controls-enabled', show);
    if (show) {
      touchControlsElement.style.display = 'block';
      touchControlsElement.style.visibility = 'visible';
      touchControlsElement.style.opacity = '1';
    } else {
      touchControlsElement.style.removeProperty('display');
      touchControlsElement.style.removeProperty('visibility');
      touchControlsElement.style.removeProperty('opacity');
    }
    refreshTouchControlBounds();
    refreshStickGeometry();
  }
  updateTouchDebugBadge();
}
function recordTouchInput(event) {
  if (!touchDebugEnabled) {
    if (event.type === 'touchstart' || event.pointerType === 'touch' || event.pointerType === 'pen') {
      firstTouchSeen = true;
      if (room?.phase === 'playing') syncTouchControls(true);
    }
    return;
  }
  lastTouchPointerEvent = event.type.startsWith('pointer') ? `${event.type} (${event.pointerType || 'unknown'})` : event.type;
  if (event.type === 'touchstart' || event.pointerType === 'touch' || event.pointerType === 'pen') {
    firstTouchSeen = true;
    if (room?.phase === 'playing') syncTouchControls(true);
  }
  updateTouchDebugBadge();
}
const touchInputEvents = touchDebugEnabled
  ? ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']
  : ['pointerdown', 'touchstart'];
for (const eventName of touchInputEvents) document.addEventListener(eventName, recordTouchInput, { capture: true, passive: true });
function recordTouchDebugError(message) {
  touchDebugErrors.unshift(message);
  touchDebugErrors.length = Math.min(touchDebugErrors.length, 3);
  updateTouchDebugBadge();
}
function updateTouchDebugBadge() {
  if (!touchDebugEnabled || !touchDebugBadge) return;
  const renderNow = performance.now();
  if (renderNow - touchDebugLastRenderAt < 100) return;
  touchDebugLastRenderAt = renderNow;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const element = document.querySelector('#touch-controls');
  const style = element ? getComputedStyle(element) : null;
  const rect = element?.getBoundingClientRect();
  const box = rect ? `${rect.x.toFixed(0)},${rect.y.toFixed(0)} ${rect.width.toFixed(0)}×${rect.height.toFixed(0)}` : 'n/a';
  const latestShot = room?.shots?.at(-1);
  const shotClockAge = latestShot ? Date.now() - latestShot.at : null;
  const shotSeenAt = latestShot ? shotFirstSeenAt.get(latestShot.id) : null;
  const localShotAge = shotSeenAt == null ? 'n/a' : `${Math.round(performance.now() - shotSeenAt)}ms`;
  const gate = document.querySelector('#fullscreen-gate');
  const gateStyle = gate ? getComputedStyle(gate) : null;
  const gateRect = gate?.getBoundingClientRect();
  const gateBox = gateRect ? `${gateRect.x.toFixed(0)},${gateRect.y.toFixed(0)} ${gateRect.width.toFixed(0)}×${gateRect.height.toFixed(0)}` : 'n/a';
  touchDebugBadge.textContent = [
    `viewport ${window.innerWidth}×${window.innerHeight} | coarse ${coarse} | hover:none ${noHover} | maxTouch ${navigator.maxTouchPoints}`,
    `match ${document.body.classList.contains('match-active')} | touch-ui ${document.body.classList.contains('touch-device')} | controls ${Boolean(element)}`,
    `display ${style?.display || 'n/a'} | opacity ${style?.opacity || 'n/a'} | visibility ${style?.visibility || 'n/a'} | z ${style?.zIndex || 'n/a'} | box ${box}`,
    `fullscreen gate ${gateStyle?.display || 'n/a'} / ${gateStyle?.visibility || 'n/a'} / z ${gateStyle?.zIndex || 'n/a'} | box ${gateBox}`,
    `last event: ${lastTouchPointerEvent}`,
    `shots ${room?.shots?.length || 0} | server clock age ${shotClockAge == null ? 'n/a' : `${shotClockAge}ms`} | local tracer age ${localShotAge}`,
    ...(touchDebugErrors.length ? touchDebugErrors.map((error) => error.slice(0, 180)) : ['JS errors: none']),
  ].join('\n');
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const backendUrl = (import.meta.env.PUBLIC_BACKEND_URL || import.meta.env.VITE_SERVER_URL || '').replace(/\/+$/, '');
  const endpoint = backendUrl
    ? backendUrl.replace(/^http/, 'ws') + '/ws'
    : `${protocol}//${location.host}/ws`;
  const nextSocket = new WebSocket(endpoint);
  socket = nextSocket;
  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket) return;
    connectionLabel.textContent = 'ARENA ONLINE';
    connectionLabel.classList.add('is-bold-target');
    document.body.classList.add('connected');
    if (roomSession?.token) {
      // Pre-disconnect actions and input are stale; resume the authoritative room first.
      queuedAction = null;
      nextSocket.send(JSON.stringify({ event: 'rejoinRoom', sessionToken: roomSession.token }));
      return;
    }
    if (queuedAction) { const action = queuedAction; queuedAction = null; send(action.event, action.data); }
  });
  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) return;
    socket = null;
    connectionLabel.textContent = 'RECONNECTING';
    connectionLabel.classList.remove('is-bold-target');
    document.body.classList.remove('connected');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1400);
  });
  nextSocket.addEventListener('message', ({ data }) => {
    if (socket !== nextSocket) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.event === 'rejoinFailed') {
      persistRoomSession(null);
      queuedAction = null;
      resetToEntry();
      showError(message.message || 'Your room is no longer available. Create or join another room.');
      return;
    }
    if (message.event === 'error') {
      showError(message.message);
      if (room && !lobbyView.classList.contains('hidden')) $('#lobby-message').textContent = message.message;
      return;
    }
    if (message.event === 'joinedRoom') {
      if (message.sessionToken && message.room?.code) {
        persistRoomSession({ token: message.sessionToken, roomCode: message.room.code });
      }
      queuedAction = null;
      resetLocalMatchInput();
      playerId = message.playerId;
      room = message.room;
      syncServerClock(room);
      seenMilestoneIds.clear();
      for (const milestone of room.milestones || []) seenMilestoneIds.add(milestone.id);
      rememberShotReceiptTimes(room);
      rememberPlayerSnapshot(room);
      const self = room.players.find((entry) => entry.id === playerId);
      selectedHero = self?.hero || 'Morrow';
      ready = Boolean(self?.ready);
      errorBox.textContent = '';
      history.replaceState({}, '', `/?room=${room.code}${touchDebugEnabled ? '&debug=1' : ''}`);
      updateView();
    } else if (message.event === 'roomState') {
      room = message.room;
      syncServerClock(room);
      showNewKillMilestones(room.milestones || []);
      rememberShotReceiptTimes(room, true);
      rememberPlayerSnapshot(room);
      updateView();
    } else if (message.event === 'leftRoom') {
      persistRoomSession(null);
      resetToEntry();
    }
  });
}

function send(event, data = {}, queueIfDisconnected = true) {
  const payload = { event, ...data };
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  else if (queueIfDisconnected) queuedAction = { event, data };
}

function resetLocalMatchInput() {
  releaseTouchInputs();
  pressed.clear();
  firing = false;
  reloadQueued = false;
  mobileAim = null;
  mobileMoveAim = null;
  mobileRightActive = false;
  mobileAwmFireUntil = 0;
  renderedSelfAim = null;
  predictedSelfPosition = null;
  lastPredictionFrameAt = 0;
  playerSnapshotHistory = [];
  lastInput.x = 0; lastInput.y = 0; lastInput.fire = false; lastInput.reload = false;
}

function requestLeaveRoom() {
  const session = roomSession;
  persistRoomSession(null);
  if (socket?.readyState === WebSocket.OPEN) {
    send('leaveRoom', {}, false);
  } else if (session?.token) {
    queuedAction = { event: 'leaveSession', data: { sessionToken: session.token } };
    connect();
  } else {
    queuedAction = { event: 'leaveRoom', data: {} };
    connect();
  }
}

function syncServerClock(snapshot) {
  const serverNow = Number(snapshot?.serverNow);
  if (Number.isFinite(serverNow)) serverClockOffsetMs = serverNow - performance.now();
}

function renderRoundTimer(frameAt = performance.now()) {
  if (!ROUND_TIMER_ELEMENT || room?.phase !== 'playing' || !Number.isFinite(room.roundEndsAt)) return;
  const remainingMs = Math.max(0, room.roundEndsAt - (frameAt + serverClockOffsetMs));
  const seconds = Math.ceil(remainingMs / 1000);
  const display = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (ROUND_TIMER_ELEMENT.textContent !== display) ROUND_TIMER_ELEMENT.textContent = display;
  ROUND_TIMER_ELEMENT.classList.toggle('is-critical', remainingMs <= 30_000);
  ROUND_TIMER_ELEMENT.setAttribute('datetime', `PT${seconds}S`);
}

function showError(message) { errorBox.textContent = message; }

function showNewKillMilestones(milestones) {
  for (const milestone of milestones) {
    if (!milestone?.id || seenMilestoneIds.has(milestone.id)) continue;
    seenMilestoneIds.add(milestone.id);
    if (room?.phase !== 'playing') continue;
    const player = room.players.find((entry) => entry.id === milestone.playerId);
    const label = milestone.label || milestone.text || '';
    if (label !== 'DOUBLE KILL' && label !== 'TRIPLE KILL') continue;
    $('#kill-milestone-title').textContent = `${label}!`;
    $('#kill-milestone-player').textContent = player?.name || '';
    playKillMilestoneSound(label);
    const banner = $('#kill-milestone');
    banner.classList.remove('hidden', 'is-visible');
    void banner.offsetWidth;
    banner.classList.add('is-visible');
    clearTimeout(killMilestoneTimer);
    killMilestoneTimer = setTimeout(() => { banner.classList.remove('is-visible'); banner.classList.add('hidden'); }, 1000);
  }
}

function formatMatchTime(milliseconds) {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderRoundResults() {
  const results = room?.roundResults;
  const winner = room?.players.find((entry) => entry.id === results?.winnerId);
  $('#winner-title').textContent = winner ? `${winner.name.toUpperCase()} WINS` : 'ROUND DRAW';
  $('#winner-subtitle').textContent = winner ? `ROUND WINNER · ${heroDisplayName(winner.hero)}` : 'No contender remained in the arena.';
  $('#results-round').textContent = `ROUND ${String(results?.roundNumber || room?.roundNumber || 1).padStart(2, '0')} · ${formatMatchTime(results?.durationMs)}`;

  const roundStats = results?.stats || [];
  $('#round-results-list').innerHTML = roundStats.length ? roundStats.map((stat) => `
    <article class="round-stat-card ${stat.playerId === playerId ? 'is-self' : ''}">
      <strong class="result-player">${escapeHtml(stat.playerName)}${stat.playerId === playerId ? '<small>YOU</small>' : ''}</strong>
      <span><small>KILLS</small><b>${stat.kills}</b></span>
      <span><small>DAMAGE</small><b>${Math.round(stat.damageDealt).toLocaleString()}</b></span>
      <span><small>ACCURACY</small><b>${Number(stat.accuracy).toFixed(0)}%</b></span>
      <span><small>RESULT</small><b>${escapeHtml(stat.result || (stat.playerId === results?.winnerId ? 'VICTORY' : 'ELIMINATED'))}</b></span>
    </article>`).join('') : '<p class="results-empty">Round statistics are not available.</p>';

  const topFragger = results?.topFragger;
  $('#top-fragger-name').textContent = topFragger?.playerName || 'NO FRAGGER';
  $('#top-fragger-kills').textContent = Number(topFragger?.kills || 0).toLocaleString();
  $('#top-fragger-damage').textContent = Math.round(topFragger?.damageDealt || 0).toLocaleString();
  const ownStats = roundStats.find((stat) => stat.playerId === playerId);
  $('#personal-result-name').textContent = ownStats?.playerName || 'PLAYER';
  $('#personal-result-label').textContent = ownStats?.result || 'NO RESULT';
  $('#personal-result-kills').textContent = Number(ownStats?.kills || 0).toLocaleString();
  $('#personal-result-damage').textContent = Math.round(ownStats?.damageDealt || 0).toLocaleString();
  $('#personal-result-accuracy').textContent = `${Number(ownStats?.accuracy || 0).toFixed(0)}%`;

  const leaderboard = room?.sessionLeaderboard || [];
  $('#session-leaderboard').innerHTML = leaderboard.length ? leaderboard.map((entry, index) => `
    <div class="leaderboard-row ${entry.id === playerId ? 'is-self' : ''}">
      <span class="leaderboard-rank">${String(index + 1).padStart(2, '0')}</span>
      <strong>${escapeHtml(entry.name)}</strong><span>${Number(entry.kills).toLocaleString()} K</span>
      <span>${Number(entry.damage).toLocaleString()} DMG</span><b>${Number(entry.points).toLocaleString()} PTS</b>
    </div>`).join('') : '<p class="results-empty">No session scores yet.</p>';

  const connectedPlayers = (room?.players || []).filter((entry) => entry.connected !== false);
  const readyCount = connectedPlayers.filter((entry) => entry.ready).length;
  const selfReady = connectedPlayers.some((entry) => entry.id === playerId && entry.ready);
  $('#play-again').classList.remove('hidden');
  $('#play-again').classList.toggle('is-ready', selfReady);
  $('#play-again').setAttribute('aria-pressed', String(selfReady));
  $('#play-again').title = selfReady ? 'Cancel your readiness for the next round' : 'Ready up for the next round';
  $('#results-waiting').classList.remove('hidden');
  $('#results-waiting').textContent = connectedPlayers.length < 2
    ? `WAITING FOR ANOTHER PLAYER · ${readyCount}/${connectedPlayers.length} READY`
    : `NEXT ROUND READY · ${readyCount}/${connectedPlayers.length}`;
  $('#winner-armory').classList.remove('hidden');
}

function renderHeroCards() {
  const signature = JSON.stringify([selectedHero, ready, room?.players.map((entry) => [entry.id, entry.name, entry.hero]) || []]);
  if (signature === heroCardSignature) return;
  heroCardSignature = signature;
  $('#hero-grid').innerHTML = HEROES.map((hero, index) => {
    const owner = room?.players.find((entry) => entry.hero === hero.name && entry.id !== playerId);
    const selected = selectedHero === hero.name;
    const disabled = Boolean(owner) || ready;
    const availability = owner ? `IN USE · ${escapeHtml(owner.name)}` : selected ? 'SELECTED' : 'AVAILABLE';
    return `
    <button class="hero-card ${hero.color} ${selected ? 'selected' : ''} ${owner ? 'is-taken' : ''}" data-hero="${hero.name}" aria-pressed="${selected}" ${disabled ? 'disabled' : ''} title="${owner ? `${escapeHtml(hero.displayName)} is selected by ${escapeHtml(owner.name)}` : ready ? 'Unready before changing your contender' : `Select ${escapeHtml(hero.displayName)}`}" >
      <span class="hero-card-top"><span>${hero.role}</span><span class="hero-card-index">0${index + 1}</span></span>
      <span class="hero-portrait" aria-hidden="true"><img src="${hero.sprite}" alt="" draggable="false" style="--hero-card-scale:${heroCardScale(hero).toFixed(3)}" onerror="this.hidden=true" /><b>${hero.mark}</b></span>
      <span class="hero-card-bottom"><strong>${escapeHtml(hero.displayName)}</strong><span>${hero.line}</span></span>
      <span class="hero-availability">${availability}</span>
    </button>`;
  }).join('');
  document.querySelectorAll('[data-hero]').forEach((button) => button.addEventListener('click', () => {
    if (ready || button.disabled) return;
    send('selectHero', { hero: button.dataset.hero });
  }));
}

function renderLobby() {
  if (!room) return;
  $('#room-code-display').textContent = room.code;
  $('#player-count').textContent = `${String(room.players.length).padStart(2, '0')} / 04`;
  const self = room.players.find((entry) => entry.id === playerId);
  if (self) { selectedHero = self.hero; ready = self.ready; }
  const playerSignature = JSON.stringify([room.hostId, room.players.map((player) => [player.id, player.name, player.hero, player.ready, player.connected])]);
  if (playerSignature !== lobbyPlayerSignature) {
    lobbyPlayerSignature = playerSignature;
    $('#player-list').innerHTML = Array.from({ length: 4 }, (_, index) => {
    const player = room.players[index];
    if (!player) return `<div class="player-slot empty-slot"><span class="slot-num">0${index + 1}</span><span class="slot-vacant"><i></i><span class="slot-vacant-details"><strong>OPEN SEAT</strong><small>WAITING</small></span></span></div>`;
    const hero = HEROES.find((entry) => entry.name === player.hero) || HEROES[0];
    const isHost = player.id === room.hostId;
    const state = player.connected === false ? 'RECONNECTING' : player.ready ? 'READY' : 'NOT READY';
    return `<div class="player-slot ${player.id === playerId ? 'is-self' : ''}"><span class="slot-num">0${index + 1}</span><span class="slot-avatar ${hero.color}">${hero.mark}</span><span class="slot-details"><strong>${escapeHtml(player.name)}${player.id === playerId ? ' <small>(YOU)</small>' : ''}</strong><span class="slot-meta"><span class="slot-role">${hero.role}</span>${isHost ? '<span class="slot-host">HOST</span>' : ''}</span></span><span class="slot-state ${player.ready ? 'is-ready' : ''} ${player.connected === false ? 'is-offline' : ''}">${state}</span></div>`;
    }).join('');
  }
  const readyButton = $('#ready-button');
  if (readyButton.dataset.readyValue !== String(ready)) {
    readyButton.dataset.readyValue = String(ready);
    readyButton.innerHTML = `<span>${ready ? 'NOT READY' : 'READY UP'}</span><span class="button-arrow">↗</span>`;
  }
  const allReady = room.players.length >= 2 && room.players.every((entry) => entry.ready && entry.connected !== false);
  $('#lobby-message').textContent = allReady ? 'Crew is ready. Host can open the drop.' : room.players.length < 2 ? 'Waiting for your crew to arrive.' : `${room.players.length} here · waiting on the crew.`;
  const launch = $('#launch-match');
  launch.disabled = room.hostId !== playerId || !allReady;
  launch.title = room.hostId !== playerId ? 'Waiting for the room host' : !allReady ? 'Everyone readies up to launch' : 'Launch the arena';
  renderHeroCards();
}

function renderArmory() {
  if (!room) return;
  const self = room.players.find((entry) => entry.id === playerId);
  const points = self?.points || 0;
  $('#armory-points').textContent = points.toLocaleString();
  $('#weapon-grid').innerHTML = Object.values(WEAPONS).map((weapon) => {
    const unlocked = points >= weapon.unlockPoints;
    const selected = self?.weaponId === weapon.id;
    const status = selected ? 'EQUIPPED' : unlocked ? 'UNLOCKED' : `LOCKED · ${weapon.unlockPoints.toLocaleString()} PTS`;
    return `<article class="weapon-card ${unlocked ? 'is-unlocked' : 'is-locked'} ${selected ? 'is-selected' : ''}">
      <div class="weapon-card-head"><span class="weapon-level">LEVEL ${weapon.level}</span><span class="weapon-status">${status}</span></div>
      <div class="weapon-art" aria-hidden="true"><img class="weapon-art-image" src="${weapon.artwork}" alt="" draggable="false"></div>
      <h2>${weapon.name}</h2><p class="weapon-class">${weapon.className}</p><p class="weapon-description">${weapon.description}</p>
      <dl class="weapon-stats"><div><dt>DAMAGE</dt><dd>${weapon.damage}</dd></div><div><dt>FIRE RATE</dt><dd>${(1000 / weapon.fireRateMs).toFixed(1)} /s</dd></div><div><dt>MAG</dt><dd>${weapon.magazineSize}</dd></div><div><dt>RELOAD</dt><dd>${(weapon.reloadMs / 1000).toFixed(2)}s</dd></div><div><dt>RANGE</dt><dd>${weapon.range}m</dd></div><div><dt>SPREAD</dt><dd>${weapon.spreadDegrees.toFixed(1)}°</dd></div><div><dt>TRACER</dt><dd>${weapon.projectileSpeed}px/s</dd></div></dl>
      ${unlocked ? `<button class="button weapon-select-button ${selected ? 'is-equipped' : ''}" data-select-weapon="${weapon.id}" type="button" ${selected ? 'disabled' : ''}><span>${selected ? 'EQUIPPED' : 'SELECT LOADOUT'}</span>${selected ? '' : '<span class="button-arrow">↗</span>'}</button>` : `<div class="weapon-lock-note">UNLOCK AT ${weapon.unlockPoints.toLocaleString()} POINTS</div>`}
    </article>`;
  }).join('');
  document.querySelectorAll('[data-select-weapon]').forEach((button) => button.addEventListener('click', () => {
    if (!room || room.phase === 'playing') return;
    send('selectWeapon', { weaponId: button.dataset.selectWeapon });
  }));
}

function updateView() {
  if (!room) return;
  const phaseChanged = room.phase !== lastRenderedPhase;
  const gameWasHidden = gameView.classList.contains('hidden');
  if (room.phase === 'playing') armoryOpen = false;
  const gameActive = room.phase === 'playing' || room.phase === 'finished';
  const showingArmory = armoryOpen && room.phase !== 'playing';
  const justEnteredMatch = gameActive && !inActiveMatch;
  inActiveMatch = gameActive;
  gameView.classList.toggle('results-active', room.phase === 'finished');
  document.body.classList.toggle('match-active', gameActive);
  document.documentElement.classList.toggle('match-active', gameActive);
  syncTouchControls(room.phase === 'playing');
  setMatchGestureHandling(gameActive);
  if (room.phase === 'finished' && menuOpen) setMatchMenu(false);
  if (!gameActive && menuOpen) setMatchMenu(false);
  const focused = document.activeElement;
  if (landingView.contains(focused) || (gameActive && lobbyView.contains(focused)) || (!gameActive && gameView.contains(focused))) focused.blur?.();
  landingView.classList.toggle('hidden', true);
  lobbyView.classList.toggle('hidden', gameActive || showingArmory);
  $('#weapon-view').classList.toggle('hidden', !showingArmory);
  gameView.classList.toggle('hidden', !gameActive || showingArmory);
  if (gameActive) {
    renderGameHud();
    if (gameWasHidden || phaseChanged) resizeCanvas();
  }
  else renderLobby();
  if (showingArmory) renderArmory();
  if (justEnteredMatch) requestAnimationFrame(showFullscreenGateForMatch);
  lastRenderedPhase = room.phase;
  if (room.phase === 'playing') startArenaLoop();
  else stopArenaLoop();
}

function renderGameHud() {
  if (!room) return;
  $('#minimap-canvas').parentElement.classList.toggle('hidden', room.phase === 'finished');
  const self = room.players.find((entry) => entry.id === playerId);
  const alive = room.players.filter((entry) => entry.alive).length;
  const matchCount = `${String(alive).padStart(2, '0')} ${alive === 1 ? 'CONTENDER' : 'CONTENDERS'}`;
  const matchCountElement = $('#match-count');
  if (matchCountElement.textContent !== matchCount) matchCountElement.textContent = matchCount;
  const feed = (room.feed || []).slice(-4).reverse();
  const nextFeedSignature = feed.map((entry) => `${entry.kind}:${entry.text}`).join('|');
  if (nextFeedSignature !== matchFeedSignature) {
    matchFeedSignature = nextFeedSignature;
    $('#match-feed').innerHTML = feed.map((entry) => `<div class="feed-line ${entry.kind}"><i></i>${escapeHtml(entry.text)}</div>`).join('');
  }
  const banner = $('#elimination-banner');
  if (self && !self.alive && room.phase === 'playing') {
    banner.textContent = 'ELIMINATED · WATCH THE REMAINING CONTENDERS';
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');
  if (self) {
    $('#ammo-count').innerHTML = `${self.ammo ?? 0} <small>/ ${self.reserve ?? 0}</small>`;
    const weapon = WEAPONS[self.weaponId] || WEAPONS.cinder;
    $('#weapon-label').textContent = weapon.name;
    $('#weapon-level').textContent = `LEVEL ${weapon.level}`;
    $('#points-count').textContent = (self.points || 0).toLocaleString();
  }
  if (room.phase === 'finished') {
    const nextResultsSignature = JSON.stringify([room.roundResults, room.sessionLeaderboard, room.players.map((player) => [player.id, player.ready])]);
    if (nextResultsSignature !== resultsSignature) {
      resultsSignature = nextResultsSignature;
      renderRoundResults();
    }
    $('#winner-overlay').classList.remove('hidden');
  } else {
    $('#winner-overlay').classList.add('hidden');
    $('#winner-armory').classList.add('hidden');
    $('#results-waiting').classList.add('hidden');
  }
}

function escapeHtml(value) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

function resetToEntry() {
  stopArenaLoop();
  setMatchGestureHandling(false);
  if (gameView.contains(document.activeElement) || lobbyView.contains(document.activeElement)) document.activeElement.blur?.();
  releaseTouchInputs();
  room = null; playerId = ''; ready = false; firing = false; mobileAim = null; mobileMoveAim = null; mobileRightActive = false; mobileAwmFireUntil = 0; menuOpen = false; armoryOpen = false; predictedSelfPosition = null; lastPredictionFrameAt = 0; playerSnapshotHistory = []; shotFirstSeenAt.clear();
  lobbyPlayerSignature = ''; heroCardSignature = ''; matchFeedSignature = ''; resultsSignature = '';
  document.body.classList.remove('match-active');
  document.body.classList.remove('touch-device');
  touchControlsElement.classList.remove('touch-controls-enabled');
  document.documentElement.classList.remove('match-active');
  inActiveMatch = false;
  lastRenderedPhase = null;
  hideFullscreenGate();
  leaveFullscreenIfActive();
  $('#match-menu').classList.add('hidden');
  $('#match-menu-toggle').setAttribute('aria-expanded', 'false');
  history.replaceState({}, '', touchDebugEnabled ? '/?debug=1' : '/');
  gameView.classList.add('hidden'); lobbyView.classList.add('hidden'); landingView.classList.remove('hidden');
  showError('');
}

function isIOSDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
}

function showFullscreenGateForMatch() {
  if (!inActiveMatch || !window.matchMedia('(pointer: coarse)').matches) return;
  const gate = $('#fullscreen-gate');
  const iosHint = $('#ios-home-hint');
  const enterButton = $('#enter-fullscreen');
  const continueButton = $('#continue-browser');
  const message = $('#fullscreen-message');
  if (isStandaloneApp()) { gate.classList.add('hidden'); return; }
  if (isIOSDevice()) {
    message.textContent = "For the clearest play, add this game to your Home Screen and launch it from there.";
    iosHint.classList.remove('hidden');
    enterButton.classList.add('hidden');
    continueButton.classList.remove('hidden');
  } else {
    message.textContent = 'Tap below to enter fullscreen. Landscape mode works best.';
    iosHint.classList.add('hidden');
    enterButton.classList.remove('hidden');
    continueButton.classList.remove('hidden');
  }
  gate.classList.remove('hidden');
  updateTouchDebugBadge();
}

function hideFullscreenGate() { $('#fullscreen-gate').classList.add('hidden'); updateTouchDebugBadge(); }

async function enterMatchFullscreen() {
  const root = document.documentElement;
  try {
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) throw new Error('Fullscreen is unavailable in this browser.');
    await request.call(root);
    hideFullscreenGate();
    try { await screen.orientation?.lock?.('landscape'); } catch { /* Browser or device does not allow orientation locking. */ }
  } catch {
    $('#fullscreen-message').textContent = 'Fullscreen is unavailable here. Rotate your phone to landscape and continue.';
    $('#continue-browser').classList.remove('hidden');
  }
}

function leaveFullscreenIfActive() {
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  try { screen.orientation?.unlock?.(); } catch { /* Optional browser API. */ }
}

$('#enter-fullscreen').addEventListener('click', enterMatchFullscreen);
$('#continue-browser').addEventListener('click', hideFullscreenGate);
document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) hideFullscreenGate(); resizeCanvas(); });
document.addEventListener('webkitfullscreenchange', () => { if (document.webkitFullscreenElement) hideFullscreenGate(); resizeCanvas(); });

function preventMatchGesture(event) {
  if (!document.body.classList.contains('match-active')) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('#weapon-view, .match-menu-card, #winner-overlay')) return;
  if (event.type === 'touchmove' && !target?.closest('#arena-canvas, .canvas-wrap, #touch-controls, .touch-action-buttons, .touch-stick, .match-hud')) return;
  if (event.cancelable) event.preventDefault();
}
function setMatchGestureHandling(active) {
  if (active === matchGestureHandlersAttached) return;
  matchGestureHandlersAttached = active;
  if (active) {
    document.addEventListener('gesturestart', preventMatchGesture, { passive: false });
    document.addEventListener('gesturechange', preventMatchGesture, { passive: false });
    document.addEventListener('touchmove', preventMatchGesture, { passive: false });
    document.addEventListener('contextmenu', preventMatchGesture);
  } else {
    document.removeEventListener('gesturestart', preventMatchGesture);
    document.removeEventListener('gesturechange', preventMatchGesture);
    document.removeEventListener('touchmove', preventMatchGesture);
    document.removeEventListener('contextmenu', preventMatchGesture);
  }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  frameWidth = rect.width;
  frameHeight = rect.height;
  canvasLeft = rect.left;
  canvasTop = rect.top;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const canvasWidth = Math.round(frameWidth * pixelRatio);
  const canvasHeight = Math.round(frameHeight * pixelRatio);
  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }
  resizeMinimapCanvas();
  refreshTouchControlBounds();
  refreshStickGeometry();
}

function resizeMinimapCanvas() {
  const rect = minimapCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (rect.width === minimapCssWidth && rect.height === minimapCssHeight && dpr === minimapPixelRatio) return;
  minimapCssWidth = rect.width;
  minimapCssHeight = rect.height;
  minimapPixelRatio = dpr;
  minimapCanvas.width = Math.round(minimapCssWidth * dpr);
  minimapCanvas.height = Math.round(minimapCssHeight * dpr);
  minimapStaticCanvas.width = minimapCanvas.width;
  minimapStaticCanvas.height = minimapCanvas.height;
  drawMinimapStaticMap(minimapCssWidth, minimapCssHeight, dpr);
}

function refreshTouchControlBounds() {
  touchControlSafeBounds = [];
  if (!document.body.classList.contains('touch-device')) return;
  const canvasRect = { left: canvasLeft, top: canvasTop };
  for (const element of [movePad, aimPad]) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    touchControlSafeBounds.push({
      left: bounds.left - canvasRect.left - 12,
      top: bounds.top - canvasRect.top - 12,
      right: bounds.right - canvasRect.left + 12,
      bottom: bounds.bottom - canvasRect.top + 12,
    });
  }
}

function refreshStickGeometry() {
  for (const type of ['move', 'aim']) {
    const bounds = stickElements[type].pad.getBoundingClientRect();
    stickGeometry[type] = bounds.width && bounds.height ? {
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      max: Math.min(bounds.width, bounds.height) * .34,
    } : null;
  }
}

function localPositionCollides(x, y) {
  if (x < LOCAL_PLAYER_RADIUS || y < LOCAL_PLAYER_RADIUS || x > ARENA.width - LOCAL_PLAYER_RADIUS || y > ARENA.height - LOCAL_PLAYER_RADIUS) return true;
  for (const cover of ARENA.cover) {
    if (x + LOCAL_PLAYER_RADIUS > cover.x && x - LOCAL_PLAYER_RADIUS < cover.x + cover.w &&
      y + LOCAL_PLAYER_RADIUS > cover.y && y - LOCAL_PLAYER_RADIUS < cover.y + cover.h) return true;
  }
  return false;
}

function getPredictedSelf(authoritativeSelf, frameTime, input = getInput()) {
  if (!authoritativeSelf) return null;
  if (!predictedSelfPosition || room?.phase !== 'playing' || !authoritativeSelf.alive) {
    predictedSelfPosition = { x: authoritativeSelf.x, y: authoritativeSelf.y };
    lastPredictionFrameAt = frameTime;
    return { ...authoritativeSelf, ...predictedSelfPosition };
  }
  const dt = Math.min(.05, Math.max(0, (frameTime - lastPredictionFrameAt) / 1000));
  lastPredictionFrameAt = frameTime;
  const inputLength = Math.hypot(input.x, input.y);
  if (inputLength > .0001 && dt > 0) {
    const speedScale = Math.min(1, inputLength);
    const stepX = input.x / inputLength * LOCAL_PLAYER_SPEED * dt * speedScale;
    const stepY = input.y / inputLength * LOCAL_PLAYER_SPEED * dt * speedScale;
    if (!localPositionCollides(predictedSelfPosition.x + stepX, predictedSelfPosition.y)) predictedSelfPosition.x += stepX;
    if (!localPositionCollides(predictedSelfPosition.x, predictedSelfPosition.y + stepY)) predictedSelfPosition.y += stepY;
  }
  const errorX = authoritativeSelf.x - predictedSelfPosition.x;
  const errorY = authoritativeSelf.y - predictedSelfPosition.y;
  if (Math.hypot(errorX, errorY) > 120) {
    predictedSelfPosition.x = authoritativeSelf.x;
    predictedSelfPosition.y = authoritativeSelf.y;
  } else {
    const correctionRate = inputLength > .0001 ? 2.6 : 6;
    const correction = 1 - Math.exp(-correctionRate * dt);
    predictedSelfPosition.x += errorX * correction;
    predictedSelfPosition.y += errorY * correction;
  }
  return { ...authoritativeSelf, ...predictedSelfPosition };
}

function rememberPlayerSnapshot(snapshot) {
  const players = new Map();
  for (const player of snapshot.players || []) {
    if (Number.isFinite(player.x) && Number.isFinite(player.y)) players.set(player.id, { x: player.x, y: player.y, aim: Number.isFinite(player.aim) ? player.aim : 0 });
  }
  const receivedAt = performance.now();
  if (players.size) playerSnapshotHistory.push({ at: receivedAt, players });
  const cutoff = receivedAt - 1000;
  while (playerSnapshotHistory.length && playerSnapshotHistory[0].at < cutoff) playerSnapshotHistory.shift();
  if (playerSnapshotHistory.length > 24) playerSnapshotHistory.splice(0, playerSnapshotHistory.length - 24);
}

function interpolateRemotePlayer(player, renderAt) {
  let before = null;
  let after = null;
  for (const entry of playerSnapshotHistory) {
    if (!entry.players.has(player.id)) continue;
    if (entry.at <= renderAt) before = entry;
    if (entry.at >= renderAt) { after = entry; break; }
  }
  if (!before && !after) return player;
  if (!before) before = after;
  if (!after) after = before;
  const from = before.players.get(player.id);
  const to = after.players.get(player.id);
  if (!from || !to || before === after) return { ...player, ...from };
  if (Math.hypot(to.x - from.x, to.y - from.y) > 200) return { ...player, ...to };
  const span = after.at - before.at;
  const amount = span > 0 ? Math.max(0, Math.min(1, (renderAt - before.at) / span)) : 1;
  let aimDelta = to.aim - from.aim;
  while (aimDelta > Math.PI) aimDelta -= Math.PI * 2;
  while (aimDelta < -Math.PI) aimDelta += Math.PI * 2;
  return {
    ...player,
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    aim: from.aim + aimDelta * amount,
  };
}

function districtLabelOverlapsTouchControls(screenBounds) {
  if (!document.body.classList.contains('touch-device')) return false;
  return touchControlSafeBounds.some((safe) => screenBounds.left < safe.right && screenBounds.right > safe.left &&
    screenBounds.top < safe.bottom && screenBounds.bottom > safe.top);
}

function drawShotTracers() {
  const frameAt = performance.now();
  for (const shot of room.shots || []) {
    let firstSeen = shotFirstSeenAt.get(shot.id);
    if (firstSeen == null) { firstSeen = frameAt; shotFirstSeenAt.set(shot.id, firstSeen); }
    const age = frameAt - firstSeen;
    if (age < 0 || age > SHOT_RENDER_MS) continue;
    const dx = shot.x2 - shot.x1;
    const dy = shot.y2 - shot.y1;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance < 0.01) continue;
    const directionX = dx / distance;
    const directionY = dy / distance;
    const muzzleOffset = Math.min(23, distance * .28);
    const flightDistance = distance - muzzleOffset;
    const startX = shot.x1 + directionX * muzzleOffset;
    const startY = shot.y1 + directionY * muzzleOffset;
    const travelMs = Math.max(105, flightDistance / (shot.speed || BULLET_VISUAL_SPEED) * 1000);
    const flightProgress = Math.min(1, age / travelMs);
    if (flightProgress < 1) {
      const headDistance = flightDistance * flightProgress;
      const tailDistance = Math.max(0, headDistance - BULLET_TRAIL_LENGTH);
      const headX = startX + directionX * headDistance;
      const headY = startY + directionY * headDistance;
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,151,74,.88)';
      ctx.lineWidth = 4;
      ctx.shadowBlur = 17; ctx.shadowColor = '#ff9a50';
      ctx.beginPath();
      ctx.moveTo(startX + directionX * tailDistance, startY + directionY * tailDistance);
      ctx.lineTo(headX, headY); ctx.stroke();
      ctx.strokeStyle = '#fff4c6'; ctx.lineWidth = 1.7; ctx.shadowBlur = 8; ctx.shadowColor = '#fff0b0';
      ctx.beginPath();
      ctx.moveTo(startX + directionX * tailDistance, startY + directionY * tailDistance);
      ctx.lineTo(headX, headY); ctx.stroke();
      ctx.fillStyle = '#fffbe5'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(headX, headY, 2.8, 0, Math.PI * 2); ctx.fill();
    } else if (shot.wall || shot.hit) {
      const impactAge = age - travelMs;
      if (impactAge <= BULLET_IMPACT_MS) {
        ctx.globalAlpha = 1 - impactAge / BULLET_IMPACT_MS;
        ctx.fillStyle = shot.wall ? '#ffe0a0' : '#ffad91';
        ctx.shadowBlur = 14; ctx.shadowColor = shot.wall ? '#ffc178' : '#ff7955';
        ctx.beginPath(); ctx.arc(shot.x2, shot.y2, 3.5 + impactAge / 55, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = shot.wall ? '#ffc178' : '#ff9a77'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(shot.x2 - 5, shot.y2); ctx.lineTo(shot.x2 + 5, shot.y2);
        ctx.moveTo(shot.x2, shot.y2 - 5); ctx.lineTo(shot.x2, shot.y2 + 5);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  }
}

function startArenaLoop() {
  if (arenaFrameRequest || document.hidden || room?.phase !== 'playing' || gameView.classList.contains('hidden')) return;
  arenaFrameRequest = requestAnimationFrame(drawArena);
}

function stopArenaLoop() {
  if (arenaFrameRequest) cancelAnimationFrame(arenaFrameRequest);
  arenaFrameRequest = 0;
  lastArenaFrameAt = 0;
}

function drawArena() {
  arenaFrameRequest = 0;
  if (document.hidden || room?.phase !== 'playing' || gameView.classList.contains('hidden')) return;
  const frameAt = performance.now();
  renderRoundTimer(frameAt);
  const frameDt = lastArenaFrameAt ? Math.min(.05, Math.max(0, (frameAt - lastArenaFrameAt) / 1000)) : 1 / 60;
  lastArenaFrameAt = frameAt;
  const serverSelf = room.players.find((entry) => entry.id === playerId);
  const frameInput = getInput();
  const predictedSelf = getPredictedSelf(serverSelf, frameAt, frameInput);
  let self = predictedSelf;
  if (predictedSelf) {
    const desiredAim = frameInput.aim;
    if (Number.isFinite(desiredAim)) {
      if (!Number.isFinite(renderedSelfAim)) renderedSelfAim = Number.isFinite(serverSelf?.aim) ? serverSelf.aim : desiredAim;
      let aimDelta = desiredAim - renderedSelfAim;
      while (aimDelta > Math.PI) aimDelta -= Math.PI * 2;
      while (aimDelta < -Math.PI) aimDelta += Math.PI * 2;
      // Smooth only the local rendered facing; server input and shot authority stay unchanged.
      renderedSelfAim += aimDelta * (1 - Math.exp(-24 * frameDt));
      self = { ...predictedSelf, aim: renderedSelfAim };
    }
  } else renderedSelfAim = null;
  const focus = self || room.players[0];
  if (!focus) return;
  const targetX = Math.max(0, Math.min(ARENA.width - frameWidth, focus.x - frameWidth / 2));
  const targetY = Math.max(0, Math.min(ARENA.height - frameHeight, focus.y - frameHeight / 2));
  const cameraBlend = 1 - Math.exp(-9 * frameDt);
  camera.x += (targetX - camera.x) * cameraBlend;
  camera.y += (targetY - camera.y) * cameraBlend;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, frameWidth, frameHeight);
  ctx.fillStyle = '#151a17';
  ctx.fillRect(0, 0, frameWidth, frameHeight);
  const visible = { x: camera.x - 90, y: camera.y - 90, w: frameWidth + 180, h: frameHeight + 180 };
  ctx.save();
  ctx.translate(-camera.x, -camera.y);
  ctx.fillStyle = '#17201a';
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  const glow = ctx.createRadialGradient(ARENA.width / 2, ARENA.height / 2, 80 * WORLD_SCALE, ARENA.width / 2, ARENA.height / 2, 1020 * WORLD_SCALE);
  glow.addColorStop(0, 'rgba(104,139,76,.11)'); glow.addColorStop(1, 'rgba(104,139,76,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  ctx.strokeStyle = 'rgba(199,221,177,.045)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.max(0, Math.floor(visible.x / 60) * 60); x <= Math.min(ARENA.width, visible.x + visible.w); x += 60) { ctx.moveTo(x, Math.max(0, visible.y)); ctx.lineTo(x, Math.min(ARENA.height, visible.y + visible.h)); }
  for (let y = Math.max(0, Math.floor(visible.y / 60) * 60); y <= Math.min(ARENA.height, visible.y + visible.h); y += 60) { ctx.moveTo(Math.max(0, visible.x), y); ctx.lineTo(Math.min(ARENA.width, visible.x + visible.w), y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(195,221,163,.16)'; ctx.lineWidth = 2; ctx.strokeRect(15, 15, ARENA.width - 30, ARENA.height - 30);
  drawArenaDecorations();
  for (const landmark of ARENA.landmarks) if (landmark.x >= visible.x - 180 && landmark.x <= visible.x + visible.w + 180 && landmark.y >= visible.y - 180 && landmark.y <= visible.y + visible.h + 180) drawCachedArenaArt('landmark', landmark);
  for (const cover of ARENA.cover) if (rectsOverlap(visible, cover)) drawCachedArenaArt('cover', cover);
  for (const area of ARENA.areas) {
    if (!area.label || !rectsOverlap(visible, area.bounds)) continue;
    ctx.save();
    ctx.font = '700 11px Orbitron, Arial, sans-serif';
    ctx.letterSpacing = '.25px';
    let width = districtLabelWidths.get(area.name);
    if (width == null) {
      width = ctx.measureText(area.name).width + 24;
      districtLabelWidths.set(area.name, width);
    }
    const height = 28;
    const screenX = area.label.x - camera.x;
    const screenY = area.label.y - camera.y;
    const screenBounds = { left: screenX - width / 2, right: screenX + width / 2, top: screenY - height / 2, bottom: screenY + height / 2 };
    if (screenBounds.right < 0 || screenBounds.left > frameWidth || screenBounds.bottom < 0 || screenBounds.top > frameHeight || districtLabelOverlapsTouchControls(screenBounds)) {
      ctx.restore();
      continue;
    }
    const tagX = area.label.x - width / 2;
    const tagY = area.label.y - height / 2;
    ctx.shadowColor = 'rgba(0,0,0,.72)'; ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(7,13,9,.9)';
    ctx.strokeStyle = 'rgba(201,243,108,.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(tagX, tagY, width, height, 5); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eff6e5'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(area.name, area.label.x, area.label.y);
    ctx.fillStyle = 'rgba(201,243,108,.9)'; ctx.fillRect(area.label.x - 12, tagY + height - 3, 24, 1);
    ctx.restore();
  }
  const remoteRenderAt = frameAt - 100;
  for (const player of room.players) {
    const renderedPlayer = player.id === playerId ? self : interpolateRemotePlayer(player, remoteRenderAt);
    if (renderedPlayer.x < visible.x - 70 || renderedPlayer.x > visible.x + visible.w + 70 || renderedPlayer.y < visible.y - 70 || renderedPlayer.y > visible.y + visible.h + 70) continue;
    drawPlayer(renderedPlayer, player.id === playerId);
  }
  drawShotTracers();
  ctx.restore();
  drawOffscreenPlayerArrow(self);
  drawMinimap(self);
  const zone = ARENA.areas.find((area) => focus.x >= area.bounds.x && focus.x <= area.bounds.x + area.bounds.w && focus.y >= area.bounds.y && focus.y <= area.bounds.y + area.bounds.h);
  const mapLabel = zone?.name || 'THE GLASSWAKE';
  const mapLabelElement = $('#map-label');
  if (mapLabelElement.textContent !== mapLabel) mapLabelElement.textContent = mapLabel;
  arenaFrameRequest = requestAnimationFrame(drawArena);
}

function rememberShotReceiptTimes(snapshot, playNewShotSounds = false) {
  const receivedAt = performance.now();
  const activeIds = new Set();
  const listener = playNewShotSounds && snapshot.phase === 'playing'
    ? snapshot.players.find((player) => player.id === playerId && player.alive)
    : null;
  for (const shot of snapshot.shots || []) {
    activeIds.add(shot.id);
    if (!shotFirstSeenAt.has(shot.id)) {
      shotFirstSeenAt.set(shot.id, receivedAt);
      if (listener) playWeaponFireSound(shot, listener);
    }
  }
  for (const [id, firstSeen] of shotFirstSeenAt) {
    if (!activeIds.has(id) && receivedAt - firstSeen > 1000) shotFirstSeenAt.delete(id);
  }
}

function drawMinimap(self) {
  if (!minimapCssWidth || !minimapCssHeight || !self) return;
  const width = minimapCssWidth;
  const height = minimapCssHeight;
  const scale = Math.min(width / ARENA.width, height / ARENA.height);
  minimapCtx.setTransform(minimapPixelRatio, 0, 0, minimapPixelRatio, 0, 0);
  minimapCtx.clearRect(0, 0, width, height);
  minimapCtx.drawImage(minimapStaticCanvas, 0, 0, width, height);

  // The viewport rectangle tracks the same camera and canvas dimensions as the arena view.
  const viewX = camera.x * scale;
  const viewY = camera.y * scale;
  const viewW = Math.min(frameWidth, ARENA.width) * scale;
  const viewH = Math.min(frameHeight, ARENA.height) * scale;
  minimapCtx.fillStyle = 'rgba(236,246,220,.08)';
  minimapCtx.fillRect(viewX, viewY, viewW, viewH);
  minimapCtx.strokeStyle = 'rgba(242,249,232,.9)'; minimapCtx.lineWidth = width <= 130 ? 1.6 : 1.25;
  minimapCtx.strokeRect(viewX, viewY, viewW, viewH);

  const selfX = self.x * scale;
  const selfY = self.y * scale;
  for (const player of room.players) {
    const x = player.x * scale;
    const y = player.y * scale;
    if (player.id === playerId) continue;
    minimapCtx.beginPath(); minimapCtx.arc(x, y, Math.max(2.8, height * .024), 0, Math.PI * 2);
    if (!player.alive) minimapCtx.fillStyle = '#858b82';
    else if (self.team != null && player.team != null && self.team === player.team) minimapCtx.fillStyle = '#78d8d7';
    else minimapCtx.fillStyle = '#ff7955';
    minimapCtx.fill();
  }
  minimapCtx.beginPath(); minimapCtx.arc(selfX, selfY, Math.max(3.4, height * .03), 0, Math.PI * 2);
  minimapCtx.fillStyle = '#d8ff87'; minimapCtx.shadowColor = '#c9f36c'; minimapCtx.shadowBlur = 7; minimapCtx.fill(); minimapCtx.shadowBlur = 0;
  const facing = Number.isFinite(self.aim) ? self.aim : lastInput.aim;
  minimapCtx.strokeStyle = '#f5ffe4'; minimapCtx.lineWidth = 1.5;
  minimapCtx.beginPath(); minimapCtx.moveTo(selfX, selfY); minimapCtx.lineTo(selfX + Math.cos(facing) * 7, selfY + Math.sin(facing) * 7); minimapCtx.stroke();
}

function drawMinimapStaticMap(width, height, dpr) {
  const map = minimapStaticCtx;
  map.setTransform(dpr, 0, 0, dpr, 0, 0);
  map.clearRect(0, 0, width, height);
  map.fillStyle = '#121a14'; map.fillRect(0, 0, width, height);
  const scale = Math.min(width / ARENA.width, height / ARENA.height);
  for (const area of ARENA.areas) {
    map.fillStyle = 'rgba(225,238,211,.035)'; map.fillRect(area.bounds.x * scale, area.bounds.y * scale, area.bounds.w * scale, area.bounds.h * scale);
    if (width > 130) {
      map.fillStyle = 'rgba(236,245,226,.74)'; map.font = `600 ${Math.max(5.5, height * .052)}px Rajdhani, Arial, sans-serif`; map.textAlign = 'left'; map.textBaseline = 'top';
      map.fillText(area.name, area.x * scale, area.y * scale, width * .48);
    }
  }
  map.fillStyle = 'rgba(180,197,169,.52)';
  for (const wall of ARENA.cover) map.fillRect(wall.x * scale, wall.y * scale, Math.max(1, wall.w * scale), Math.max(1, wall.h * scale));
  map.strokeStyle = 'rgba(222,238,209,.72)'; map.lineWidth = 1; map.strokeRect(.5, .5, width - 1, height - 1);
}

function drawOffscreenPlayerArrow(self) {
  if (!self) return;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const player of room.players) {
    if (player.id === playerId || !player.alive) continue;
    const distance = Math.hypot(player.x - self.x, player.y - self.y);
    if (distance < nearestDistance) { nearest = player; nearestDistance = distance; }
  }
  if (!nearest) return;
  const targetX = nearest.x - camera.x;
  const targetY = nearest.y - camera.y;
  if (targetX >= 0 && targetX <= frameWidth && targetY >= 0 && targetY <= frameHeight) return;
  const angle = Math.atan2(nearest.y - self.y, nearest.x - self.x);
  const dx = Math.cos(angle); const dy = Math.sin(angle);
  const cx = frameWidth / 2; const cy = frameHeight / 2; const padding = 30;
  const tx = (frameWidth / 2 - padding) / Math.max(Math.abs(dx), .0001);
  const ty = (frameHeight / 2 - padding) / Math.max(Math.abs(dy), .0001);
  const distance = Math.min(tx, ty);
  const x = cx + dx * distance; const y = cy + dy * distance;
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = '#ffb18e'; ctx.shadowColor = 'rgba(0,0,0,.95)'; ctx.shadowBlur = 5;
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -7); ctx.lineTo(-4, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function rectsOverlap(a, b) { return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y; }

function drawArenaDecorations() {
  const centerX = ARENA.width / 2;
  const centerY = ARENA.height / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(201,243,108,.2)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(centerX, centerY, 122 * WORLD_SCALE, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(centerX, centerY, 154 * WORLD_SCALE, Math.PI * .12, Math.PI * .46); ctx.stroke();
  ctx.strokeStyle = 'rgba(201,243,108,.12)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - 200 * WORLD_SCALE); ctx.lineTo(centerX, centerY - 140 * WORLD_SCALE);
  ctx.moveTo(centerX, centerY + 140 * WORLD_SCALE); ctx.lineTo(centerX, centerY + 200 * WORLD_SCALE);
  ctx.moveTo(centerX - 200 * WORLD_SCALE, centerY); ctx.lineTo(centerX - 140 * WORLD_SCALE, centerY);
  ctx.moveTo(centerX + 140 * WORLD_SCALE, centerY); ctx.lineTo(centerX + 200 * WORLD_SCALE, centerY);
  ctx.stroke();
  ctx.restore();
}

function drawLandmark(landmark, target = ctx) {
  target.save();
  target.translate(landmark.x, landmark.y);
  target.scale(WORLD_SCALE, WORLD_SCALE);
  target.strokeStyle = 'rgba(201,243,108,.25)'; target.fillStyle = 'rgba(201,243,108,.035)'; target.lineWidth = 2;
  if (landmark.kind === 'glass-array') {
    for (let i = 0; i < 5; i++) { target.beginPath(); target.moveTo(-110 + i * 48, 78); target.lineTo(-72 + i * 48, -76); target.lineTo(-42 + i * 48, 78); target.closePath(); target.fill(); target.stroke(); }
  } else if (landmark.kind === 'foundry-stack') {
    for (let i = 0; i < 3; i++) { const x = -92 + i * 74; target.fillRect(x, -85 + (i % 2) * 22, 48, 160 - (i % 2) * 22); target.strokeRect(x, -85 + (i % 2) * 22, 48, 160 - (i % 2) * 22); target.beginPath(); target.arc(x + 24, -85 + (i % 2) * 22, 12, Math.PI, 0); target.stroke(); }
  } else if (landmark.kind === 'spindle') {
    target.beginPath(); target.moveTo(-72, 82); target.lineTo(-24, -90); target.lineTo(24, -90); target.lineTo(72, 82); target.closePath(); target.fill(); target.stroke();
    target.beginPath(); target.moveTo(-48, 18); target.lineTo(48, -18); target.moveTo(-34, 58); target.lineTo(34, 30); target.stroke();
  } else if (landmark.kind === 'basin') {
    [92, 66, 38].forEach((radius, index) => { target.beginPath(); target.ellipse(0, 12, radius, radius * .48, 0, 0, Math.PI * 2); target.stroke(); if (index === 0) { target.beginPath(); target.moveTo(-92, 12); target.lineTo(-55, 78); target.lineTo(55, 78); target.lineTo(92, 12); target.stroke(); } });
  } else {
    target.beginPath(); target.arc(0, 0, 100, 0, Math.PI * 2); target.stroke(); target.beginPath(); target.arc(0, 0, 75, 0, Math.PI * 2); target.stroke();
    target.beginPath(); target.moveTo(-100, 0); target.lineTo(100, 0); target.moveTo(0, -100); target.lineTo(0, 100); target.stroke();
  }
  target.fillStyle = 'rgba(239,246,229,.9)'; target.font = '600 12px Rajdhani, Arial, sans-serif'; target.letterSpacing = '1px'; target.textAlign = 'center'; target.shadowColor = 'rgba(5,9,6,.95)'; target.shadowBlur = 6; target.fillText(landmark.label, 0, 112);
  target.restore();
}

function drawCover(cover, target = ctx) {
  target.save();
  target.shadowColor = 'rgba(0,0,0,.4)'; target.shadowBlur = 16; target.shadowOffsetY = 8;
  target.fillStyle = cover.kind === 'core' ? '#30402d' : cover.kind === 'crate' ? '#303a31' : '#28312b';
  target.strokeStyle = cover.kind === 'core' ? 'rgba(201,243,108,.5)' : cover.kind === 'barrier' ? 'rgba(120,216,215,.32)' : 'rgba(211,226,199,.28)';
  target.lineWidth = cover.kind === 'core' ? 2 : 1.25;
  target.beginPath();
  if (cover.kind === 'pillar' || cover.kind === 'core') target.roundRect(cover.x, cover.y, cover.w, cover.h, Math.min(cover.w, cover.h) * .22);
  else if (cover.kind === 'crate') { target.moveTo(cover.x + 10, cover.y); target.lineTo(cover.x + cover.w - 10, cover.y); target.lineTo(cover.x + cover.w, cover.y + 10); target.lineTo(cover.x + cover.w, cover.y + cover.h - 10); target.lineTo(cover.x + cover.w - 10, cover.y + cover.h); target.lineTo(cover.x + 10, cover.y + cover.h); target.lineTo(cover.x, cover.y + cover.h - 10); target.lineTo(cover.x, cover.y + 10); target.closePath(); }
  else target.roundRect(cover.x, cover.y, cover.w, cover.h, cover.kind === 'rail' ? Math.min(cover.h / 2, 12) : 5);
  target.fill(); target.stroke();
  target.shadowBlur = 0; target.shadowOffsetY = 0;
  target.strokeStyle = 'rgba(201,243,108,.13)'; target.beginPath(); target.moveTo(cover.x + 8, cover.y + 7); target.lineTo(cover.x + cover.w - 8, cover.y + 7); target.stroke();
  if (cover.kind === 'core') { target.strokeStyle = 'rgba(201,243,108,.3)'; target.beginPath(); target.arc(cover.x + cover.w / 2, cover.y + cover.h / 2, Math.min(cover.w, cover.h) * .24, 0, Math.PI * 2); target.stroke(); }
  if (cover.kind === 'crate') { target.strokeStyle = 'rgba(225,237,215,.16)'; target.beginPath(); target.moveTo(cover.x + 12, cover.y + 12); target.lineTo(cover.x + cover.w - 12, cover.y + cover.h - 12); target.moveTo(cover.x + cover.w - 12, cover.y + 12); target.lineTo(cover.x + 12, cover.y + cover.h - 12); target.stroke(); }
  target.restore();
}

function drawCachedArenaArt(kind, item) {
  if (arenaArtCachePixelRatio !== pixelRatio) {
    for (const cached of arenaArtCache.values()) { cached.canvas.width = 0; cached.canvas.height = 0; }
    arenaArtCache.clear();
    arenaArtCachePixelRatio = pixelRatio;
  }
  let cached = arenaArtCache.get(item);
  if (cached) {
    arenaArtCache.delete(item);
    arenaArtCache.set(item, cached);
  } else {
    const pad = kind === 'landmark' ? Math.ceil(160 * WORLD_SCALE) : 64;
    const width = (kind === 'landmark' ? 0 : item.w) + pad * 2;
    const height = (kind === 'landmark' ? 0 : item.h) + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * pixelRatio);
    canvas.height = Math.ceil(height * pixelRatio);
    const target = canvas.getContext('2d');
    target.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    target.translate(pad - item.x, pad - item.y);
    if (kind === 'landmark') drawLandmark(item, target);
    else drawCover(item, target);
    cached = { canvas, left: item.x - pad, top: item.y - pad, width: canvas.width / pixelRatio, height: canvas.height / pixelRatio };
    arenaArtCache.set(item, cached);
    if (arenaArtCache.size > 24) {
      const oldest = arenaArtCache.keys().next().value;
      const evicted = arenaArtCache.get(oldest);
      arenaArtCache.delete(oldest);
      evicted.canvas.width = 0; evicted.canvas.height = 0;
    }
  }
  ctx.drawImage(cached.canvas, cached.left, cached.top, cached.width, cached.height);
}

function drawPlayer(player, isSelf) {
  const color = HERO_COLORS[player.hero] || HERO_COLORS.Morrow;
  const sprite = HERO_SPRITES[player.hero] || HERO_SPRITES.Morrow;
  const image = heroSpriteCache.get(player.hero) || heroSpriteCache.get('Morrow');
  const facing = Number.isFinite(player.aim) ? player.aim : (isSelf ? lastInput.aim : 0);
  ctx.save();
  ctx.globalAlpha = player.alive ? 1 : .28;
  ctx.fillStyle = 'rgba(0,0,0,.46)'; ctx.beginPath(); ctx.ellipse(player.x, player.y + 8, 25, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = isSelf ? 'rgba(244,255,201,.72)' : `${color.fill}99`; ctx.lineWidth = isSelf ? 2 : 1.5;
  ctx.beginPath(); ctx.arc(player.x, player.y, 33 + (isSelf ? Math.sin(Date.now() / 260) * 1.5 : 0), 0, Math.PI * 2); ctx.stroke();
  if (image?.complete && image.naturalWidth > 0) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(facing);
    ctx.drawImage(image, -sprite.size / 2, -sprite.size / 2, sprite.size, sprite.size);
    ctx.restore();
  } else {
    drawProceduralPlayer(player, color, facing, isSelf);
  }
  if (player.alive) {
    // Anchor to the rotated non-transparent sprite bounds, not an assumed character height.
    const health = Math.max(0, Math.min(100, Number(player.health) || 0));
    const spriteTop = getPlayerSpriteTop(player, sprite, image, facing);
    const barY = spriteTop - 14; // 8px bar + 6px visible gap above the sprite.
    ctx.fillStyle = 'rgba(5,8,6,.94)'; ctx.fillRect(player.x - 24, barY, 48, 8);
    ctx.strokeStyle = 'rgba(238,246,229,.82)'; ctx.lineWidth = 1; ctx.strokeRect(player.x - 23.5, barY + .5, 47, 7);
    ctx.fillStyle = health > 45 ? color.fill : '#ff7955'; ctx.fillRect(player.x - 21, barY + 3, 42 * health / 100, 3);
  }
  ctx.fillStyle = isSelf ? '#f4ffd9' : '#f0f4e9'; ctx.font = '700 14px Orbitron, "Arial Black", sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(6,10,7,.94)'; ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 5; ctx.strokeText(player.name, player.x, player.y - 53); ctx.fillText(player.name, player.x, player.y - 53); ctx.shadowBlur = 0;
  ctx.restore();
}

function getPlayerSpriteTop(player, sprite, image, facing) {
  const bounds = image?.complete && image.naturalWidth > 0
    ? sprite.visualBounds
    : { left: -12, top: -16, right: 32, bottom: 19 };
  if (!bounds) return player.y;
  const scaleX = image?.complete && image.naturalWidth > 0 ? sprite.size / image.naturalWidth : 1;
  const scaleY = image?.complete && image.naturalHeight > 0 ? sprite.size / image.naturalHeight : 1;
  const centerX = image?.complete && image.naturalWidth > 0 ? image.naturalWidth / 2 : 0;
  const centerY = image?.complete && image.naturalHeight > 0 ? image.naturalHeight / 2 : 0;
  const cos = Math.cos(facing); const sin = Math.sin(facing);
  const corners = [
    [bounds.left, bounds.top], [bounds.right, bounds.top],
    [bounds.left, bounds.bottom], [bounds.right, bounds.bottom],
  ];
  let top = Infinity;
  for (const [x, y] of corners) {
    const localX = (x - centerX) * scaleX;
    const localY = (y - centerY) * scaleY;
    top = Math.min(top, localX * sin + localY * cos);
  }
  return player.y + top;
}

function drawProceduralPlayer(player, color, facing, isSelf) {
  // Compact top-down fallback: helmet, body, arms and a gun, with no letter marker.
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(facing);
  ctx.fillStyle = color.fill; ctx.strokeStyle = isSelf ? '#f4ffc9' : color.edge; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 3, 12, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d9d2c4'; ctx.beginPath(); ctx.arc(-2, -8, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#292d2b'; ctx.fillRect(2, -2, 14, 5);
  ctx.fillStyle = '#b7beb9'; ctx.fillRect(10, -2, 19, 4);
  ctx.fillStyle = '#3f4743'; ctx.fillRect(25, -1, 7, 2);
  ctx.restore();
}

function getInput() {
  if (menuOpen) return { x: 0, y: 0, aim: lastInput.aim, fire: false, reload: false };
  let x = (pressed.has('d') || pressed.has('arrowright') ? 1 : 0) - (pressed.has('a') || pressed.has('arrowleft') ? 1 : 0);
  let y = (pressed.has('s') || pressed.has('arrowdown') ? 1 : 0) - (pressed.has('w') || pressed.has('arrowup') ? 1 : 0);
  if (window.mobileMove) { x = window.mobileMove.x; y = window.mobileMove.y; }
  const player = room?.players.find((entry) => entry.id === playerId);
  let aim = lastInput.aim;
  if (player) {
    if (document.body.classList.contains('touch-device')) {
      const moveMagnitude = Math.hypot(x, y);
      if (mobileRightActive && mobileAim !== null) aim = mobileAim;
      else if (moveMagnitude > .12 && mobileMoveAim !== null) aim = mobileMoveAim;
      else if (mobileAim !== null) aim = mobileAim;
    }
    else if (aimPoint.active) aim = Math.atan2(aimPoint.y + camera.y - player.y, aimPoint.x + camera.x - player.x);
    else {
      let nearest = null;
      let nearestDistanceSquared = Infinity;
      for (const target of room.players) {
        if (!target.alive || target.id === playerId) continue;
        const dx = target.x - player.x; const dy = target.y - player.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < nearestDistanceSquared) { nearest = target; nearestDistanceSquared = distanceSquared; }
      }
      if (nearest) aim = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    }
  }
  const selectedWeapon = player ? WEAPONS[player.weaponId] || WEAPONS.cinder : null;
  const mobileShouldFire = mobileRightActive && Boolean(selectedWeapon) && selectedWeapon.id !== 'longwake';
  const mobileAwmShot = mobileAwmFireUntil > performance.now();
  return { x, y, aim, fire: firing || mobileShouldFire || mobileAwmShot || pressed.has(' '), reload: reloadQueued };
}

function setMatchMenu(open) {
  if (!room || (room.phase !== 'playing' && room.phase !== 'finished')) return;
  menuOpen = open;
  $('#match-menu').classList.toggle('hidden', !open);
  $('#match-menu-toggle').setAttribute('aria-expanded', String(open));
  if (open) {
    releaseTouchInputs(); pressed.clear(); firing = false; reloadQueued = false;
    const self = room.players.find((entry) => entry.id === playerId);
    if (room.phase === 'playing' && self?.alive) send('input', { x: 0, y: 0, aim: lastInput.aim, fire: false, reload: false }, false);
    $('#resume-match').focus();
  } else {
    document.activeElement.blur?.();
    if (room.phase === 'playing') send('input', { x: 0, y: 0, aim: lastInput.aim, fire: false, reload: false }, false);
  }
}

setInterval(() => {
  if (room?.phase !== 'playing') return;
  const input = getInput();
  if (input.x !== lastInput.x || input.y !== lastInput.y || input.aim !== lastInput.aim || input.fire !== lastInput.fire || input.reload !== lastInput.reload) {
    send('input', input, false);
    lastInput.x = input.x; lastInput.y = input.y; lastInput.aim = input.aim; lastInput.fire = input.fire;
    lastInput.reload = input.reload;
  }
  reloadQueued = false;
}, 33);

function isTextEntryTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, button, a[href], [contenteditable="true"], [role="button"]'));
}

window.addEventListener('keydown', (event) => {
  // Android and synthetic keyboard events may not include a key value.
  if (typeof event.key !== 'string' || event.key.length === 0) return;
  const key = event.key.toLowerCase();
  if (key === 'escape' && room && (room.phase === 'playing' || room.phase === 'finished')) {
    event.preventDefault();
    setMatchMenu(!menuOpen);
    return;
  }
  const movementKey = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key);
  if (movementKey && isInteractiveTarget(document.activeElement)) return;
  if (movementKey) {
    event.preventDefault();
    pressed.add(key);
  }
  if (key === 'r' && !event.repeat && room?.phase === 'playing' && !isTextEntryTarget(document.activeElement)) reloadQueued = true;
});
window.addEventListener('keyup', (event) => {
  if (typeof event.key !== 'string' || event.key.length === 0) return;
  pressed.delete(event.key.toLowerCase());
});
window.addEventListener('focusin', (event) => { if (isInteractiveTarget(event.target)) pressed.clear(); });
window.addEventListener('blur', () => { releaseTouchInputs(); pressed.clear(); firing = false; });
canvas.addEventListener('pointermove', (event) => {
  aimPoint = { x: event.clientX - canvasLeft, y: event.clientY - canvasTop, active: true };
});
canvas.addEventListener('pointerdown', (event) => { if (event.pointerType === 'mouse') { firing = true; canvas.setPointerCapture(event.pointerId); } });
canvas.addEventListener('pointerup', (event) => { if (event.pointerType === 'mouse') firing = false; });
canvas.addEventListener('pointerleave', () => { firing = false; });
function requestReload(event) {
  if (room?.phase === 'playing') reloadQueued = true;
  event.currentTarget.blur();
}
$('#desktop-reload').addEventListener('click', requestReload);
function beginStick(type, event) {
  if (event.pointerType === 'mouse' || menuOpen) return;
  event.preventDefault();
  const { pad } = stickElements[type];
  if (stickPointers[type] !== null) return;
  stickPointers[type] = event.pointerId;
  pad.classList.add('is-active');
  try { pad.setPointerCapture(event.pointerId); } catch { /* Capture is optional if the pointer already ended. */ }
  if (type === 'aim') {
    mobileRightActive = true;
    const self = room?.players.find((entry) => entry.id === playerId);
    if ((self?.weaponId || 'cinder') === 'longwake') mobileAwmFireUntil = performance.now() + 140;
  }
  updateStick(type, event);
}
function moveStick(type, event) {
  const { pad } = stickElements[type];
  if (stickPointers[type] !== event.pointerId) return;
  event.preventDefault();
  updateStick(type, event);
}
function endStick(type, event) {
  if (stickPointers[type] !== event.pointerId) return;
  const { pad, knob } = stickElements[type];
  stickPointers[type] = null;
  pad.classList.remove('is-active');
  knob.style.transform = '';
  if (type === 'move') window.mobileMove = null;
  else mobileRightActive = false;
}
function updateStick(type, event) {
  const { pad, knob } = stickElements[type];
  const geometry = stickGeometry[type] || (() => {
    const bounds = pad.getBoundingClientRect();
    return stickGeometry[type] = { centerX: bounds.left + bounds.width / 2, centerY: bounds.top + bounds.height / 2, max: Math.min(bounds.width, bounds.height) * .34 };
  })();
  const dx = event.clientX - geometry.centerX;
  const dy = event.clientY - geometry.centerY;
  const max = geometry.max;
  const distance = Math.hypot(dx, dy) || 1;
  const scale = Math.min(1, max / distance);
  const knobX = dx * scale; const knobY = dy * scale;
  knob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  const deadZone = .12;
  const normalized = Math.min(1, distance / max);
  const strength = normalized <= deadZone ? 0 : (normalized - deadZone) / (1 - deadZone);
  const stickX = dx / distance;
  const stickY = dy / distance;
  if (normalized > deadZone && Number.isFinite(dx) && Number.isFinite(dy)) {
    const angle = Math.atan2(dy, dx);
    if (Number.isFinite(angle)) {
      if (type === 'aim') mobileAim = angle;
      else mobileMoveAim = angle;
    }
  }
  if (type === 'move') window.mobileMove = { x: stickX * strength, y: stickY * strength };
}
function releaseTouchInputs() {
  for (const type of ['move', 'aim']) {
    const { pad, knob } = stickElements[type];
    const pointerId = stickPointers[type];
    if (pointerId !== null) { try { if (pad.hasPointerCapture(pointerId)) pad.releasePointerCapture(pointerId); } catch { /* Ignore an already released pointer. */ } }
    stickPointers[type] = null;
    pad.classList.remove('is-active');
    knob.style.transform = '';
  }
  window.mobileMove = null;
  mobileRightActive = false;
  mobileAwmFireUntil = 0;
}
function applyTouchStickSize(size) {
  touchStickSize = Math.max(80, Math.min(160, Number(size) || 130));
  document.documentElement.style.setProperty('--touch-stick-size', `${touchStickSize}px`);
  $('#touch-stick-size').value = String(touchStickSize);
  $('#touch-stick-size-value').textContent = `${touchStickSize}px`;
}
applyTouchStickSize(touchStickSize);
$('#touch-stick-size').addEventListener('input', (event) => {
  applyTouchStickSize(event.currentTarget.value);
  try { localStorage.setItem(TOUCH_STICK_SIZE_KEY, String(touchStickSize)); } catch { /* Settings still apply for this session. */ }
});
movePad.addEventListener('pointerdown', (event) => beginStick('move', event));
movePad.addEventListener('pointermove', (event) => moveStick('move', event));
movePad.addEventListener('pointerup', (event) => endStick('move', event));
movePad.addEventListener('pointercancel', (event) => endStick('move', event));
movePad.addEventListener('lostpointercapture', (event) => endStick('move', event));
aimPad.addEventListener('pointerdown', (event) => beginStick('aim', event));
aimPad.addEventListener('pointermove', (event) => moveStick('aim', event));
aimPad.addEventListener('pointerup', (event) => endStick('aim', event));
aimPad.addEventListener('pointercancel', (event) => endStick('aim', event));
aimPad.addEventListener('lostpointercapture', (event) => endStick('aim', event));

$('#create-room').addEventListener('click', () => {
  showError('');
  if (!nameInput.value.trim()) { nameInput.focus(); showError('Add a callsign first.'); return; }
  send('createRoom', { name: nameInput.value.trim() });
});
$('#join-room').addEventListener('click', () => {
  showError('');
  if (!nameInput.value.trim()) { nameInput.focus(); showError('Add a callsign first.'); return; }
  if (codeInput.value.trim().length < 5) { codeInput.focus(); showError('Enter the five-character room code.'); return; }
  send('joinRoom', { name: nameInput.value.trim(), code: codeInput.value.trim() });
});
$('#ready-button').addEventListener('click', () => send('setReady', { ready: !ready }));
$('#launch-match').addEventListener('click', () => send('startMatch'));
$('#play-again').addEventListener('click', () => {
  const self = room?.players.find((entry) => entry.id === playerId);
  if (room?.phase === 'finished' && self) send('setReady', { ready: !self.ready });
});
$('#open-armory').addEventListener('click', () => { armoryOpen = true; updateView(); });
$('#winner-armory').addEventListener('click', () => { armoryOpen = true; updateView(); });
$('#back-from-armory').addEventListener('click', () => { armoryOpen = false; updateView(); });
$('#leave-room').addEventListener('click', requestLeaveRoom);
$('#exit-match').addEventListener('click', requestLeaveRoom);
$('#match-menu-toggle').addEventListener('click', () => setMatchMenu(!menuOpen));
$('#resume-match').addEventListener('click', () => setMatchMenu(false));
$('#leave-match').addEventListener('click', () => { setMatchMenu(false); requestLeaveRoom(); });
async function copyRoomCodeWithFallback(value) {
  const area = document.createElement('textarea');
  area.value = value; area.setAttribute('readonly', ''); area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed'; area.style.left = '-10000px'; area.style.top = '0'; area.style.opacity = '0';
  document.body.append(area); area.focus(); area.select(); area.setSelectionRange(0, value.length);
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  area.remove();
  return copied;
}

function buildShareResultText() {
  const results = room?.roundResults;
  const own = results?.stats?.find((stat) => stat.playerId === playerId);
  if (!own) return '';
  const top = results?.topFragger;
  return [
    "INDIA'S GOT WARRIORS",
    own.playerName,
    `${own.kills} KILLS · ${Math.round(own.damageDealt)} DAMAGE · ${Number(own.accuracy).toFixed(0)}% ACCURACY`,
    `RESULT: ${own.result || 'COMPLETE'}`,
    top ? `🏆 TOP FRAGGER: ${top.playerName} · ${top.kills} KILLS · ${Math.round(top.damageDealt)} DAMAGE` : '',
  ].filter(Boolean).join('\n');
}

$('#share-result').addEventListener('click', async () => {
  const text = buildShareResultText();
  if (!text) return;
  const feedback = $('#share-result-feedback');
  let message = '';
  if (navigator.share) {
    try {
      await navigator.share({ title: "INDIA'S GOT WARRIORS RESULT", text });
      message = 'READY TO SHARE';
    } catch (error) {
      if (error?.name === 'AbortError') return;
      let copied = false;
      try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch { copied = false; }
      if (!copied) copied = await copyRoomCodeWithFallback(text);
      message = copied ? 'RESULT COPIED' : 'SHARING UNAVAILABLE';
    }
  } else {
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch { copied = false; }
    if (!copied) copied = await copyRoomCodeWithFallback(text);
    message = copied ? 'RESULT COPIED' : 'COPY UNAVAILABLE';
  }
  feedback.textContent = message;
  setTimeout(() => { feedback.textContent = ''; }, 2200);
});

$('#copy-code').addEventListener('click', async () => {
  if (!room?.code) return;
  const copyHint = $('#copy-hint');
  copyHint.classList.remove('is-bold-target');
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(room.code); copied = true; }
  } catch { copied = false; }
  if (!copied) copied = await copyRoomCodeWithFallback(room.code);
  copyHint.textContent = copied ? 'COPIED' : `ROOM CODE: ${room.code}`;
  setTimeout(() => {
    if (!room) return;
    copyHint.textContent = 'SEND THIS TO YOUR CREW';
    copyHint.classList.add('is-bold-target');
  }, 1500);
});
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
nameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#create-room').click(); });
codeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#join-room').click(); });
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);
window.visualViewport?.addEventListener('resize', resizeCanvas, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopArenaLoop();
  else { lastArenaFrameAt = 0; startArenaLoop(); }
});
const invitedCode = new URLSearchParams(location.search).get('room');
if (invitedCode) codeInput.value = invitedCode.toUpperCase().slice(0, 5);
resizeCanvas();
connect();
