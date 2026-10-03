export const WORLD_SCALE = 0.82;
const SOURCE_WORLD_SIZE = Object.freeze({ width: 4500, height: 3000 });
export const WORLD_SIZE = Object.freeze({
  width: Math.round(SOURCE_WORLD_SIZE.width * WORLD_SCALE),
  height: Math.round(SOURCE_WORLD_SIZE.height * WORLD_SCALE),
});

// Card sizing uses each square source size plus its visible bounds, so weapon width does not set character scale.
export const HEROES = Object.freeze([
  Object.freeze({ name: 'Morrow', displayName: 'Narendra M', role: 'THE BULWARK', color: 'morrow', mark: 'M', line: 'Built to hold the line.', sprite: '/assets/sprites/vanguard-top.png', spriteSourceSize: 320, visualBounds: { left: 92, top: 57, right: 313, bottom: 223 } }),
  Object.freeze({ name: 'Sable', displayName: 'Rahul G', role: 'THE WAYFINDER', color: 'sable', mark: 'S', line: 'Gone before the echo.', sprite: '/assets/sprites/chimera-top.png', spriteSourceSize: 320, visualBounds: { left: 87, top: 77, right: 300, bottom: 218 } }),
  Object.freeze({ name: 'Kite', displayName: 'Akhilesh Y', role: 'THE SPARK', color: 'kite', mark: 'K', line: 'A little chaos travels far.', sprite: '/assets/sprites/spark-mech-top.png', spriteSourceSize: 320, visualBounds: { left: 112, top: 59, right: 288, bottom: 229 } }),
  // Nira's rifle is about 0.36 radians clockwise from east in the PNG; the renderer compensates around the canvas center.
  Object.freeze({ name: 'Nira', displayName: 'Maya DI', role: 'THE SENTINEL', color: 'nira', mark: 'N', line: 'A steady light in the breach.', sprite: '/assets/sprites/nira-top.png', spriteSourceSize: 320, visualBounds: { left: 7, top: 28, right: 320, bottom: 293 } }),
]);

export const ARENA = {
  name: 'THE GLASSWAKE',
  width: WORLD_SIZE.width,
  height: WORLD_SIZE.height,
  areas: [
    { name: 'HUSHGLASS YARD', x: 520, y: 330, label: { x: 1000, y: 450 }, bounds: { x: 120, y: 100, w: 2130, h: 1400 } },
    { name: 'COPPERLINE FOUNDRY', x: 2670, y: 330, label: { x: 3500, y: 470 }, bounds: { x: 2250, y: 100, w: 2130, h: 1400 } },
    { name: 'SPINDLE WALK', x: 520, y: 2600, label: { x: 1000, y: 2105 }, bounds: { x: 120, y: 1500, w: 2130, h: 1400 } },
    { name: 'LANTERN BASIN', x: 2670, y: 2600, label: { x: 3500, y: 2045 }, bounds: { x: 2250, y: 1500, w: 2130, h: 1400 } },
  ],
  // Decorative landmarks provide navigation; solid cover below remains the collision source.
  landmarks: [
    { x: 1050, y: 690, kind: 'glass-array', label: 'THE PRISM RACK' },
    { x: 3420, y: 690, kind: 'foundry-stack', label: 'EMBER STACKS' },
    { x: 1050, y: 2260, kind: 'spindle', label: 'THE WINDING SPIRE' },
    { x: 3420, y: 2260, kind: 'basin', label: 'LANTERN WELL' },
    { x: 2240, y: 1500, kind: 'crossing', label: 'GLASSWAKE CROSSING' },
  ],
  // World-unit rectangles are authoritative for movement, wall collision and shot rays.
  cover: [
    // Hushglass Yard: broken glass beds, low rails and narrow service lanes.
    { x: 300, y: 300, w: 250, h: 42, kind: 'rail' }, { x: 720, y: 260, w: 52, h: 230, kind: 'pillar' },
    { x: 1180, y: 310, w: 188, h: 82, kind: 'crate' }, { x: 1580, y: 280, w: 280, h: 38, kind: 'rail' },
    { x: 230, y: 590, w: 72, h: 210, kind: 'barrier' }, { x: 470, y: 650, w: 220, h: 54, kind: 'block' },
    { x: 820, y: 570, w: 95, h: 95, kind: 'core' }, { x: 1260, y: 610, w: 310, h: 44, kind: 'rail' },
    { x: 1710, y: 540, w: 52, h: 260, kind: 'pillar' }, { x: 340, y: 960, w: 290, h: 48, kind: 'rail' },
    { x: 800, y: 930, w: 140, h: 88, kind: 'crate' }, { x: 1200, y: 1010, w: 250, h: 56, kind: 'block' },
    { x: 1600, y: 930, w: 190, h: 44, kind: 'rail' },

    // Copperline Foundry: long casting tables and staggered furnace housings.
    { x: 2680, y: 300, w: 245, h: 50, kind: 'rail' }, { x: 3090, y: 270, w: 62, h: 255, kind: 'pillar' },
    { x: 3500, y: 305, w: 195, h: 100, kind: 'core' }, { x: 3950, y: 280, w: 270, h: 42, kind: 'rail' },
    { x: 2800, y: 590, w: 170, h: 86, kind: 'crate' }, { x: 3220, y: 620, w: 300, h: 48, kind: 'barrier' },
    { x: 3690, y: 570, w: 72, h: 225, kind: 'pillar' }, { x: 4120, y: 600, w: 190, h: 64, kind: 'block' },
    { x: 2740, y: 960, w: 290, h: 46, kind: 'rail' }, { x: 3190, y: 925, w: 110, h: 110, kind: 'core' },
    { x: 3580, y: 1000, w: 230, h: 72, kind: 'crate' }, { x: 4020, y: 930, w: 270, h: 42, kind: 'rail' },

    // Spindle Walk: low winding walls, offset pylons, and open traversable bends.
    { x: 280, y: 1850, w: 255, h: 42, kind: 'rail' }, { x: 710, y: 1790, w: 58, h: 245, kind: 'pillar' },
    { x: 1110, y: 1870, w: 220, h: 88, kind: 'crate' }, { x: 1540, y: 1810, w: 275, h: 44, kind: 'barrier' },
    { x: 220, y: 2170, w: 76, h: 215, kind: 'pillar' }, { x: 450, y: 2250, w: 310, h: 48, kind: 'rail' },
    { x: 850, y: 2160, w: 105, h: 105, kind: 'core' }, { x: 1220, y: 2290, w: 270, h: 68, kind: 'block' },
    { x: 1660, y: 2160, w: 65, h: 255, kind: 'barrier' }, { x: 310, y: 2580, w: 260, h: 64, kind: 'crate' },
    { x: 770, y: 2520, w: 300, h: 42, kind: 'rail' }, { x: 1200, y: 2670, w: 190, h: 94, kind: 'core' },
    { x: 1570, y: 2560, w: 260, h: 46, kind: 'rail' },

    // Lantern Basin: broad loops around the landmark, with cover beside the lane entrances.
    { x: 2690, y: 1840, w: 280, h: 42, kind: 'rail' }, { x: 3110, y: 1790, w: 64, h: 250, kind: 'pillar' },
    { x: 3510, y: 1860, w: 210, h: 96, kind: 'core' }, { x: 3950, y: 1810, w: 280, h: 52, kind: 'barrier' },
    { x: 2780, y: 2170, w: 175, h: 95, kind: 'crate' }, { x: 3200, y: 2250, w: 300, h: 44, kind: 'rail' },
    { x: 3680, y: 2150, w: 78, h: 230, kind: 'pillar' }, { x: 4100, y: 2240, w: 190, h: 72, kind: 'block' },
    { x: 2700, y: 2560, w: 300, h: 48, kind: 'rail' }, { x: 3150, y: 2520, w: 110, h: 110, kind: 'core' },
    { x: 3560, y: 2670, w: 210, h: 90, kind: 'crate' }, { x: 3980, y: 2560, w: 270, h: 42, kind: 'rail' },

  // Central cover links the four district layouts into one traversable arena.
    { x: 1900, y: 1260, w: 150, h: 42, kind: 'rail' }, { x: 2450, y: 1260, w: 150, h: 42, kind: 'rail' },
    { x: 1900, y: 1695, w: 150, h: 42, kind: 'rail' }, { x: 2450, y: 1695, w: 150, h: 42, kind: 'rail' },
    { x: 2070, y: 1370, w: 88, h: 155, kind: 'barrier' }, { x: 2350, y: 1530, w: 100, h: 90, kind: 'core' },
    { x: 1480, y: 1430, w: 140, h: 72, kind: 'crate' }, { x: 2880, y: 1430, w: 140, h: 72, kind: 'crate' },
  ],
  // Four corner spawns keep the opening encounter spread across the arena.
  spawns: [
    { x: 400, y: 420 }, { x: 4100, y: 420 }, { x: 450, y: 2700 }, { x: 4100, y: 2700 },
  ],
};

function scaleArenaLayout(scale) {
  const scalePoint = (point) => {
    point.x = Math.round(point.x * scale);
    point.y = Math.round(point.y * scale);
  };
  for (const area of ARENA.areas) {
    scalePoint(area);
    scalePoint(area.label);
    area.bounds.x = Math.round(area.bounds.x * scale);
    area.bounds.y = Math.round(area.bounds.y * scale);
    area.bounds.w = Math.round(area.bounds.w * scale);
    area.bounds.h = Math.round(area.bounds.h * scale);
  }
  for (const landmark of ARENA.landmarks) scalePoint(landmark);
  for (const cover of ARENA.cover) {
    cover.x = Math.round(cover.x * scale);
    cover.y = Math.round(cover.y * scale);
    cover.w = Math.round(cover.w * scale);
    cover.h = Math.round(cover.h * scale);
  }
  for (const spawn of ARENA.spawns) scalePoint(spawn);
}

scaleArenaLayout(WORLD_SCALE);

export const HERO_COLORS = {
  Morrow: { fill: '#c9f36c', edge: '#f0ffb9' },
  Sable: { fill: '#78d8d7', edge: '#c1ffff' },
  Kite: { fill: '#ff8b61', edge: '#ffd0b7' },
  Nira: { fill: '#bd91ee', edge: '#ead7ff' },
};

export const WEAPONS = Object.freeze({
  cinder: Object.freeze({
    id: 'cinder', name: 'UMP45', className: 'COMPACT SMG', artwork: '/assets/weapons/ump45.svg', level: 1, unlockPoints: 0,
    description: 'A compact automatic profile with a folding stock and broad magazine.', damage: 13, fireRateMs: 300,
    magazineSize: 24, reloadMs: 1000, projectileSpeed: 3600, spreadDegrees: 0.6, range: 620, reserveAmmo: 96, soundAsset: '/assets/audio/ump45-fire.wav', soundPitch: 1, soundGain: 0.92, maxAudioVoices: 3,
  }),
  drift: Object.freeze({
    id: 'drift', name: 'M416', className: 'ASSAULT RIFLE', artwork: '/assets/weapons/m416.svg', level: 2, unlockPoints: 180,
    description: 'A balanced shoulder rifle with a long railed handguard and adjustable stock.', damage: 7, fireRateMs: 100,
    magazineSize: 48, reloadMs: 1350, projectileSpeed: 3200, spreadDegrees: 3.8, range: 410, reserveAmmo: 144, soundAsset: '/assets/audio/m416-fire.wav', soundPitch: 1.12, soundGain: 0.98, maxAudioVoices: 3,
  }),
  meridian: Object.freeze({
    id: 'meridian', name: 'GROZA', className: 'BULLPUP RIFLE', artwork: '/assets/weapons/groza.svg', level: 3, unlockPoints: 480,
    description: 'A compact bullpup layout keeps the magazine behind the forward grip.', damage: 12, fireRateMs: 200,
    magazineSize: 36, reloadMs: 1250, projectileSpeed: 3900, spreadDegrees: 1.7, range: 570, reserveAmmo: 108, soundAsset: '/assets/audio/groza-fire.wav', soundPitch: 0.97, soundGain: 1.04, maxAudioVoices: 3,
  }),
  longwake: Object.freeze({
    id: 'longwake', name: 'AWM', className: 'BOLT-ACTION SNIPER', artwork: '/assets/weapons/awm.svg', level: 4, unlockPoints: 1000,
    description: 'A precision bolt-action profile with a long barrel and high-mounted optic.', damage: 20, fireRateMs: 450,
    magazineSize: 10, reloadMs: 1650, projectileSpeed: 4700, spreadDegrees: 0.55, range: 760, reserveAmmo: 60, soundAsset: '/assets/audio/awm-fire.wav', soundPitch: 0.86, soundGain: 1.32, maxAudioVoices: 2,
  }),
});

export const PROGRESSION_REWARDS = Object.freeze({
  damagePointsPerHp: 5,
  elimination: 90,
  winner: 150,
});
