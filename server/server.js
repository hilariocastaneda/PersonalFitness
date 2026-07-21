const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const Anthropic = require('@anthropic-ai/sdk').default;
const OpenAI   = require('openai').default;
const { toFile } = require('openai');

const PORT      = process.env.PORT || 3003;
const BASE_DIR  = path.resolve(__dirname, '..');
const DATA_PATH = process.env.DATA_PATH || path.join(BASE_DIR, 'info.json');
const CLIENT_DIR = path.join(BASE_DIR, 'client');
const AI_MODEL = 'claude-opus-4-8';

// Bump this on every deploy that ships client-visible changes — the client
// polls /info on load and force-refreshes (clearing all caches) when this
// changes, so installed PWAs pick up new code without a manual reinstall.
const APP_VERSION = '1.6.1';

// ─── DEFAULT DATA ─────────────────────────────────────────────────────────────

// `met` = Metabolic Equivalent of Task, from the Compendium of Physical Activities
// (Ainsworth et al., 2011, Med. Sci. Sports Exerc.) — used by estimateCalories()
// client-side to burn-estimate each exercise without calling an AI.
const DEFAULT_EXERCISE_LIBRARY = [
  { id: "pushups", name: "Pushups", muscleGroup: "chest", equipment: "none", homeFriendly: true, defaultSets: 3, defaultReps: 12, met: 8.0, instructions: "Lie on the floor face down and place your hands about 36 inches apart while holding your torso up at arms length. Next, lower yourself downward until your chest almost touches the floor as you inhale. Now breathe out and press your upper body back up to the starting position while squeezing your chest. After a brief pause at the top contracted position, you can begin to lower yourself downward again for as many repetitions as needed.", image: "/images/system/exercise/pushups.jpg", video: null },
  { id: "dumbbell-bench-press", name: "Dumbbell Bench Press", muscleGroup: "chest", equipment: "dumbbells", homeFriendly: true, defaultSets: 3, defaultReps: 10, met: 6.0, instructions: "Lie down on a flat bench with a dumbbell in each hand resting on top of your thighs, palms facing each other. Lift the dumbbells to shoulder width and rotate your wrists so palms face away from you — this is your starting position. Push the dumbbells up as you breathe out, lock your arms and squeeze your chest at the top, then lower slowly. Repeat for the prescribed reps.", image: "/images/system/exercise/dumbbell-bench-press.jpg", video: null },
  { id: "barbell-bench-press-medium-grip", name: "Barbell Bench Press - Medium Grip", muscleGroup: "chest", equipment: "barbell", homeFriendly: false, defaultSets: 4, defaultReps: 8, met: 6.0, instructions: "Lie back on a flat bench. Using a medium grip, lift the bar from the rack and hold it straight over you with arms locked. Lower the bar slowly until it touches your middle chest, then push it back up as you breathe out, focusing on your chest muscles. Repeat for the prescribed reps, then re-rack the bar.", image: "/images/system/exercise/barbell-bench-press-medium-grip.jpg", video: null },
  { id: "pullups", name: "Pullups", muscleGroup: "back", equipment: "pullupBar", homeFriendly: true, defaultSets: 3, defaultReps: 8, met: 8.0, instructions: "Grab the pull-up bar with palms facing forward at a grip slightly wider than shoulder width. Pull your torso up until the bar approaches your upper chest, squeezing your back muscles. Slowly lower back to a full arm extension. Repeat for the prescribed reps.", image: "/images/system/exercise/pullups.jpg", video: null },
  { id: "bent-over-two-dumbbell-row", name: "Bent Over Two-Dumbbell Row", muscleGroup: "back", equipment: "dumbbells", homeFriendly: true, defaultSets: 3, defaultReps: 10, met: 6.0, instructions: "With a dumbbell in each hand, bend your knees slightly and bring your torso forward at the waist, keeping your back straight until almost parallel to the floor. Lift the dumbbells to your sides, keeping elbows close to your body, then squeeze your back at the top. Lower slowly and repeat.", image: "/images/system/exercise/bent-over-two-dumbbell-row.jpg", video: null },
  { id: "wide-grip-lat-pulldown", name: "Wide-Grip Lat Pulldown", muscleGroup: "back", equipment: "cableMachine", homeFriendly: false, defaultSets: 3, defaultReps: 10, met: 5.0, instructions: "Sit at a lat pulldown machine and grab the wide bar with palms facing forward. Lean back slightly and pull the bar down to your upper chest, squeezing your shoulder blades together. Slowly return to the starting position with arms fully extended. Repeat for the prescribed reps.", image: "/images/system/exercise/wide-grip-lat-pulldown.jpg", video: null },
  { id: "barbell-deadlift", name: "Barbell Deadlift", muscleGroup: "back", equipment: "barbell", homeFriendly: false, defaultSets: 4, defaultReps: 6, met: 6.0, instructions: "Stand in front of a loaded barbell with feet shoulder width apart. Keeping your back straight, bend your knees and hips to grasp the bar with an overhand grip. Push through your legs while straightening your torso to lift the bar, then reverse the motion to lower it back down. Repeat for the prescribed reps.", image: "/images/system/exercise/barbell-deadlift.jpg", video: null },
  { id: "bodyweight-squat", name: "Bodyweight Squat", muscleGroup: "legs", equipment: "none", homeFriendly: true, defaultSets: 3, defaultReps: 15, met: 5.0, instructions: "Stand with feet shoulder width apart. Flex your knees and hips, sitting back as if into a chair, keeping your head and chest up and knees tracking over your toes. Go as low as comfortable, then reverse the motion back to standing. Repeat for the prescribed reps.", image: "/images/system/exercise/bodyweight-squat.jpg", video: null },
  { id: "dumbbell-lunges", name: "Dumbbell Lunges", muscleGroup: "legs", equipment: "dumbbells", homeFriendly: true, defaultSets: 3, defaultReps: 12, met: 6.0, instructions: "Stand upright holding a dumbbell in each hand. Step forward with one leg and lower your upper body, keeping your torso upright and front shin roughly vertical. Push back up through your front heel to the starting position. Repeat, alternating legs.", image: "/images/system/exercise/dumbbell-lunges.jpg", video: null },
  { id: "barbell-squat", name: "Barbell Squat", muscleGroup: "legs", equipment: "barbell", homeFriendly: false, defaultSets: 4, defaultReps: 8, met: 6.0, instructions: "Set a barbell on a rack at shoulder height. Step under the bar, resting it across your upper back, and lift it off the rack. Step back and set your feet shoulder width apart. Lower by bending your knees and hips until thighs are roughly parallel to the floor, then drive back up to standing. Repeat for the prescribed reps.", image: "/images/system/exercise/barbell-squat.jpg", video: null },
  { id: "leg-press", name: "Leg Press", muscleGroup: "legs", equipment: "machine", homeFriendly: false, defaultSets: 3, defaultReps: 10, met: 5.0, instructions: "Sit on a leg press machine with feet on the platform at shoulder width. Release the safety bars and lower the platform until your knees form a 90-degree angle, then press back up through your heels without locking your knees. Repeat for the prescribed reps.", image: "/images/system/exercise/leg-press.jpg", video: null },
  { id: "plank", name: "Plank", muscleGroup: "core", equipment: "none", homeFriendly: true, defaultSets: 3, defaultReps: 1, met: 3.8, instructions: "Get into a prone position supported on your toes and forearms, elbows directly below your shoulders. Keep your body in a straight line from head to heels and hold the position for as long as comfortable.", image: "/images/system/exercise/plank.jpg", video: null },
  { id: "crunches", name: "Crunches", muscleGroup: "core", equipment: "none", homeFriendly: true, defaultSets: 3, defaultReps: 20, met: 3.8, instructions: "Lie on your back with knees bent and feet flat on the floor. Place your hands lightly beside your head. Curl your shoulders a few inches off the floor by contracting your abs, hold briefly, then lower back down slowly. Repeat for the prescribed reps.", image: "/images/system/exercise/crunches.jpg", video: null },
  { id: "cable-crunch", name: "Cable Crunch", muscleGroup: "core", equipment: "cableMachine", homeFriendly: false, defaultSets: 3, defaultReps: 15, met: 4.0, instructions: "Kneel below a high pulley with a rope attachment, holding the rope beside your face. With hips stationary, flex at the waist to curl down, contracting your abs, then slowly return to the starting position. Repeat for the prescribed reps.", image: "/images/system/exercise/cable-crunch.jpg", video: null },
  { id: "dumbbell-shoulder-press", name: "Dumbbell Shoulder Press", muscleGroup: "shoulders", equipment: "dumbbells", homeFriendly: true, defaultSets: 3, defaultReps: 10, met: 6.0, instructions: "Sit holding a dumbbell in each hand at shoulder height, palms facing forward. Press the dumbbells overhead until they nearly touch, then lower slowly back to shoulder height. Repeat for the prescribed reps.", image: "/images/system/exercise/dumbbell-shoulder-press.jpg", video: null },
  { id: "arnold-dumbbell-press", name: "Arnold Dumbbell Press", muscleGroup: "shoulders", equipment: "dumbbells", homeFriendly: true, defaultSets: 3, defaultReps: 10, met: 6.0, instructions: "Sit holding two dumbbells in front of your upper chest, palms facing you. Press the dumbbells overhead while rotating your palms to face forward. Reverse the rotation as you lower back to the starting position. Repeat for the prescribed reps.", image: "/images/system/exercise/arnold-dumbbell-press.jpg", video: null },
  { id: "barbell-shoulder-press", name: "Barbell Shoulder Press", muscleGroup: "shoulders", equipment: "barbell", homeFriendly: false, defaultSets: 3, defaultReps: 8, met: 6.0, instructions: "Hold a barbell at shoulder height with an overhand grip. Press the bar overhead until your arms are locked out, then lower it back to shoulder height under control. Repeat for the prescribed reps.", image: "/images/system/exercise/barbell-shoulder-press.jpg", video: null },
  { id: "dumbbell-bicep-curl", name: "Dumbbell Bicep Curl", muscleGroup: "arms", equipment: "dumbbells", homeFriendly: true, defaultSets: 3, defaultReps: 12, met: 4.0, instructions: "Stand holding a dumbbell in each hand at arm's length, palms facing forward. Curl the weights up while keeping your upper arms stationary, squeeze at the top, then lower slowly. Repeat for the prescribed reps.", image: "/images/system/exercise/dumbbell-bicep-curl.jpg", video: null },
  { id: "hammer-curls", name: "Hammer Curls", muscleGroup: "arms", equipment: "dumbbells", homeFriendly: true, defaultSets: 3, defaultReps: 12, met: 4.0, instructions: "Stand holding a dumbbell in each hand, palms facing your torso. Curl the weights up keeping your elbows stationary, squeeze at the top, then lower slowly. Repeat for the prescribed reps.", image: "/images/system/exercise/hammer-curls.jpg", video: null },
  { id: "barbell-curl", name: "Barbell Curl", muscleGroup: "arms", equipment: "barbell", homeFriendly: false, defaultSets: 3, defaultReps: 10, met: 4.0, instructions: "Stand holding a barbell with an underhand, shoulder-width grip. Curl the bar up while keeping your upper arms stationary, squeeze your biceps at the top, then lower slowly. Repeat for the prescribed reps.", image: "/images/system/exercise/barbell-curl.jpg", video: null },
  { id: "dips-triceps-version", name: "Dips - Triceps Version", muscleGroup: "arms", equipment: "none", homeFriendly: true, defaultSets: 3, defaultReps: 10, met: 8.0, instructions: "Support your body at arm's length above parallel bars. Lower yourself slowly, keeping your torso upright and elbows close to your body, until your upper arms are roughly parallel to the floor. Push back up to the starting position using your triceps. Repeat for the prescribed reps.", image: "/images/system/exercise/dips-triceps-version.jpg", video: null },
  { id: "triceps-pushdown", name: "Triceps Pushdown", muscleGroup: "arms", equipment: "cableMachine", homeFriendly: false, defaultSets: 3, defaultReps: 12, met: 4.0, instructions: "Stand at a high pulley with a bar attachment, upper arms close to your torso. Push the bar down until your arms are fully extended, keeping your upper arms stationary, then let it rise slowly back up. Repeat for the prescribed reps.", image: "/images/system/exercise/triceps-pushdown.jpg", video: null },
  { id: "mountain-climbers", name: "Mountain Climbers", muscleGroup: "cardio", equipment: "none", homeFriendly: true, defaultSets: 3, defaultReps: 20, met: 8.0, instructions: "Start in a push-up position. Drive one knee toward your chest, then quickly switch legs in a running motion while keeping your hands planted. Continue alternating at a brisk pace for the prescribed time.", image: "/images/system/exercise/mountain-climbers.jpg", video: null },
  { id: "jogging-treadmill", name: "Jogging, Treadmill", muscleGroup: "cardio", equipment: "treadmill", homeFriendly: false, defaultSets: 1, defaultReps: 1, met: 7.0, instructions: "Step onto the treadmill, select a program or manual setting, and jog at a steady pace, maintaining good posture. Adjust incline and speed to change intensity.", image: "/images/system/exercise/jogging-treadmill.jpg", video: null },
  { id: "bicycling-stationary", name: "Bicycling, Stationary", muscleGroup: "cardio", equipment: "bike", homeFriendly: false, defaultSets: 1, defaultReps: 1, met: 6.8, instructions: "Sit on the stationary bike and adjust the seat height. Select a resistance level or program and pedal at a steady cadence, using the handles to check your heart rate as needed.", image: "/images/system/exercise/bicycling-stationary.jpg", video: null },
];

// Fallback pool shown until the first successful sync from a free public
// quotes API (see fetchMotivationsFromApi) — and permanently, if that sync
// never succeeds (e.g. no outbound internet from the host).
const DEFAULT_MOTIVATIONS = [
  "Small steps every day add up to big results.",
  "Discipline is choosing between what you want now and what you want most.",
  "You don't have to be extreme, just consistent.",
  "The only bad workout is the one that didn't happen.",
  "Progress, not perfection.",
  "Your future self is watching you right now through memories.",
  "Motivation gets you started. Habit keeps you going.",
  "Every workout is progress, no matter how small.",
  "Take care of your body — it's the only place you have to live.",
  "A little progress each day adds up to big results.",
];

function defaultProfile() {
  return {
    completed: false,
    height: null, heightUnit: null,
    weight: null, weightUnit: null,
    measurements: { chest: null, waist: null, hips: null, shoulders: null, inseam: null },
    measurementsUnit: null,
    facePhoto: null,
    complexion: null,
    hairType: null,
    hairStyle: null,
    eyeColor: null,
    bodyShape: null,
    allergies: [],
    injuries: [],
    activityLevel: null,
    occupationType: null,
    sleepHours: null,
    dietType: null,
    goals: [],
    goalTargetDate: null,
    goalSetAt: null,
    equipment: [],
  };
}

function defaultWardrobeItemFields() {
  return {
    condition: null, fit: null, favorite: false, remarks: null,
    measurements: { chest: null, waist: null, length: null, shoulder: null },
    photos: [],
  };
}
function defaultOutfitFields() {
  return { remarks: null, aiRemarks: null, score: null, source: 'generated', photo: null, photos: [] };
}

// `photos` (array of {id, url, ai}) is the source of truth for both wardrobe
// items and outfits; the legacy singular `photo` field is kept in sync as the
// first photo's url so older code paths (and the mobile home-screen icon
// cache) that still read `.photo` keep working.
function mainPhoto(entity) { return entity.photos && entity.photos.length ? entity.photos[0].url : null; }
function addPhoto(entity, url, opts) {
  opts = opts || {};
  if (!entity.photos) entity.photos = [];
  const photo = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url, ai: !!opts.ai };
  entity.photos.push(photo);
  entity.photo = mainPhoto(entity);
  return photo;
}
function removePhoto(entity, photoId) {
  if (!entity.photos) return null;
  const idx = entity.photos.findIndex(p => p.id === photoId);
  if (idx === -1) return null;
  const [removed] = entity.photos.splice(idx, 1);
  entity.photo = mainPhoto(entity);
  return removed;
}

function defaultUser(name, opts) {
  opts = opts || {};
  return {
    name,
    pin: '0000',
    isAdmin: !!opts.isAdmin,
    isForPasswordReset: true,
    settings: {
      heightUnits: 'cm', weightUnits: 'kg', measurementUnits: 'cm',
      aiProvider: 'anthropic', apiKey: null, aiBaseUrl: null, aiModel: null,
      imageGenProvider: null, imageGenApiKey: null, imageGenModel: null,
    },
    profile: defaultProfile(),
    fitness: { plan: null, history: [] },
    habits: [],
    fashion: { wardrobe: [], outfitChecks: [], outfits: [], aiShoppingAdvice: null },
    aiUsage: { totalTokens: 0, dailyTokens: 0, dailyDate: null, log: [] },
  };
}

function defaultAiSettings() {
  return { enabled: true, dailyTokenLimit: 50000, hardTokenLimit: 1000000 };
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (_) {
    const defaults = {
      users: [defaultUser('admin', { isAdmin: true })],
      exerciseLibrary: DEFAULT_EXERCISE_LIBRARY,
      aiSettings: defaultAiSettings(),
    };
    saveData(defaults);
    return defaults;
  }
}
function saveData(data) { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2)); }

// Migrate existing records to include any newly added fields
(function validateSchema() {
  const data = loadData();
  let changed = false;
  if (!Array.isArray(data.exerciseLibrary) || data.exerciseLibrary.length === 0) {
    data.exerciseLibrary = DEFAULT_EXERCISE_LIBRARY; changed = true;
  } else {
    for (const ex of data.exerciseLibrary) if (ex.met === undefined) { const src = DEFAULT_EXERCISE_LIBRARY.find(d => d.id === ex.id); ex.met = src ? src.met : 5.0; changed = true; }
  }
  if (!data.aiSettings) { data.aiSettings = defaultAiSettings(); changed = true; }
  else for (const k of Object.keys(defaultAiSettings())) if (data.aiSettings[k] === undefined) { data.aiSettings[k] = defaultAiSettings()[k]; changed = true; }
  if (!data.motivations) { data.motivations = { items: DEFAULT_MOTIVATIONS.slice(), syncedAt: null }; changed = true; }
  for (const u of data.users) {
    const fresh = defaultUser(u.name);
    if (u.isAdmin === undefined) { u.isAdmin = false; changed = true; }
    if (u.isForPasswordReset === undefined) { u.isForPasswordReset = false; changed = true; }
    if (!u.settings) { u.settings = fresh.settings; changed = true; }
    else {
      if (u.settings.units && !u.settings.heightUnits) {
        u.settings.heightUnits = u.settings.units === 'imperial' ? 'in' : 'cm';
        u.settings.weightUnits = u.settings.units === 'imperial' ? 'lb' : 'kg';
        delete u.settings.units;
        changed = true;
      }
      for (const k of Object.keys(fresh.settings)) if (u.settings[k] === undefined) { u.settings[k] = fresh.settings[k]; changed = true; }
    }
    if (!u.profile) { u.profile = fresh.profile; changed = true; }
    else for (const k of Object.keys(fresh.profile)) if (u.profile[k] === undefined) { u.profile[k] = fresh.profile[k]; changed = true; }
    if (!u.fitness) { u.fitness = fresh.fitness; changed = true; }
    if (!u.habits) { u.habits = []; changed = true; }
    if (!u.fashion) { u.fashion = fresh.fashion; changed = true; }
    else {
      if (!u.fashion.outfitChecks) { u.fashion.outfitChecks = []; changed = true; }
      if (!u.fashion.outfits) { u.fashion.outfits = []; changed = true; }
      if (u.fashion.aiShoppingAdvice === undefined) { u.fashion.aiShoppingAdvice = null; changed = true; }
      for (const item of u.fashion.wardrobe) {
        const freshItem = defaultWardrobeItemFields();
        for (const k of Object.keys(freshItem)) if (item[k] === undefined) { item[k] = freshItem[k]; changed = true; }
        if (!item.photos.length && item.photo) { item.photos = [{ id: 'legacy', url: item.photo, ai: false }]; changed = true; }
      }
      for (const o of u.fashion.outfits) {
        const freshOutfit = defaultOutfitFields();
        for (const k of Object.keys(freshOutfit)) if (o[k] === undefined) { o[k] = freshOutfit[k]; changed = true; }
        if (!o.photos.length && o.photo) { o.photos = [{ id: 'legacy', url: o.photo, ai: false }]; changed = true; }
      }
    }
    if (!u.aiUsage) { u.aiUsage = fresh.aiUsage; changed = true; }
  }
  if (changed) saveData(data);
})();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function findUser(data, name) { return data.users.find(u => u.name === name); }

function requireUser(req, res, data) {
  const name = req.headers['x-user-name'];
  const user = name && findUser(data, name);
  if (!user) { res.status(401).json({ ok: false, error: 'Not logged in' }); return null; }
  if (normalizeProfileUnits(user)) saveData(data);
  return user;
}

function requireAdmin(req, res, data) {
  const user = requireUser(req, res, data);
  if (!user) return null;
  if (!user.isAdmin) { res.status(403).json({ ok: false, error: 'Admin only' }); return null; }
  return user;
}

function calcBmi(heightCm, weightKg) {
  if (!heightCm || !weightKg) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

// ─── UNIT CONVERSION ────────────────────────────────────────────────────────────
// Profile values are stored tagged with the unit they were entered in
// (heightUnit/weightUnit/measurementsUnit). Whenever the user's preferred
// display unit differs from the tag, we convert the stored value and update
// the tag — so the app "auto-converts" once, then stays consistent.

function round1(n) { return Math.round(n * 10) / 10; }
function convertLength(value, from, to) {
  if (value === null || value === undefined || from === to) return value;
  return round1(from === 'cm' ? value / 2.54 : value * 2.54);
}
function convertWeight(value, from, to) {
  if (value === null || value === undefined || from === to) return value;
  return round1(from === 'kg' ? value / 0.45359237 : value * 0.45359237);
}
function heightCm(height, unit) { if (height === null || height === undefined) return null; return unit === 'in' ? height * 2.54 : height; }
function weightKg(weight, unit) { if (weight === null || weight === undefined) return null; return unit === 'lb' ? weight * 0.45359237 : weight; }

// Converts any profile fields whose stored unit no longer matches the user's
// current setting. Returns true if anything changed (caller should saveData()).
function normalizeProfileUnits(user) {
  const p = user.profile, s = user.settings;
  let changed = false;
  if (p.height !== null && p.heightUnit && p.heightUnit !== s.heightUnits) {
    p.height = convertLength(p.height, p.heightUnit, s.heightUnits);
    p.heightUnit = s.heightUnits;
    changed = true;
  }
  if (p.weight !== null && p.weightUnit && p.weightUnit !== s.weightUnits) {
    p.weight = convertWeight(p.weight, p.weightUnit, s.weightUnits);
    p.weightUnit = s.weightUnits;
    changed = true;
  }
  if (p.measurementsUnit && p.measurementsUnit !== s.measurementUnits) {
    for (const k of Object.keys(p.measurements)) {
      p.measurements[k] = convertLength(p.measurements[k], p.measurementsUnit, s.measurementUnits);
    }
    p.measurementsUnit = s.measurementUnits;
    changed = true;
  }
  return changed;
}

const ACTIVITY_DAYS = { sedentary: 3, light: 3, moderate: 4, active: 5, veryActive: 6 };
const GOAL_REP_SCHEME = {
  strength:     { sets: 4, reps: 6 },
  muscleGain:   { sets: 3, reps: 10 },
  weightLoss:   { sets: 3, reps: 15 },
  endurance:    { sets: 3, reps: 18 },
  maintenance:  { sets: 3, reps: 12 },
};
// Which weekdays get a session, purely a function of how many days/week the
// activity level calls for — independent of which workout-type split the
// user picks (that only decides the *focus* assigned to each of these days).
const WEEKDAY_SCHEDULES = {
  3: ['Monday', 'Wednesday', 'Friday'],
  4: ['Monday', 'Tuesday', 'Thursday', 'Friday'],
  5: ['Monday', 'Tuesday', 'Wednesday', 'Friday', 'Saturday'],
  6: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

// Workout-type split styles offered on the Generate Plan screen. `cycle` is
// the sequence of focuses assigned to the week's training days in order,
// wrapping around if there are more days than entries (e.g. a bro split on a
// 3-day/week schedule just repeats the first 3 muscle groups that week).
const WORKOUT_TYPES = {
  fullBody:     { label: 'Full Body',              cycle: ['Full Body'] },
  upperLower:   { label: 'Upper / Lower Split',     cycle: ['Upper Body', 'Lower Body'] },
  pushPullLegs: { label: 'Push / Pull / Legs',       cycle: ['Push', 'Pull', 'Legs'] },
  broSplit:     { label: 'Bro Split (one muscle/day)', cycle: ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms'] },
  coreCardio:   { label: 'Core & Cardio Focus',      cycle: ['Core', 'Cardio'] },
};

const FOCUS_MUSCLE_GROUPS = {
  'Full Body': ['chest', 'back', 'legs', 'core', 'shoulders', 'arms'],
  'Upper Body': ['chest', 'back', 'shoulders', 'arms'],
  'Lower Body': ['legs', 'core'],
  'Push': ['chest', 'shoulders', 'arms'],
  'Pull': ['back', 'arms'],
  'Legs': ['legs', 'core'],
  'Chest': ['chest'],
  'Back': ['back'],
  'Shoulders': ['shoulders'],
  'Arms': ['arms'],
  'Core': ['core'],
  'Cardio': ['cardio'],
};

function generatePlan(user, exerciseLibrary, homeOnly, includeIds, workoutTypeKey) {
  const activityLevel = user.profile.activityLevel || 'light';
  const days = ACTIVITY_DAYS[activityLevel] || 3;
  const weekdays = WEEKDAY_SCHEDULES[days] || WEEKDAY_SCHEDULES[3];
  const workoutType = WORKOUT_TYPES[workoutTypeKey] || WORKOUT_TYPES.fullBody;
  const goal = (user.profile.goals && user.profile.goals[0]) || 'maintenance';
  const scheme = GOAL_REP_SCHEME[goal] || GOAL_REP_SCHEME.maintenance;
  const injuries = user.profile.injuries || [];
  const ownedEquipment = user.profile.equipment;
  const hasEquipmentFilter = Array.isArray(ownedEquipment) && ownedEquipment.length > 0;

  // Injury exclusion is always enforced as a safety constraint. `includeIds`
  // (the user's explicit picks from the Generate Plan options screen) narrows
  // the pool further when provided — an explicit pick is honored even if it
  // doesn't match owned equipment (e.g. they sometimes use a gym); otherwise
  // fall back to the homeOnly + owned-equipment filters.
  const pool = exerciseLibrary.filter(ex => !injuries.includes(ex.muscleGroup)
    && (includeIds && includeIds.length
        ? includeIds.includes(ex.id)
        : (!homeOnly || ex.homeFriendly) && (!hasEquipmentFilter || ex.equipment === 'none' || ownedEquipment.includes(ex.equipment))));

  const scheduleDays = weekdays.map((day, idx) => {
    const focus = workoutType.cycle[idx % workoutType.cycle.length];
    const groups = FOCUS_MUSCLE_GROUPS[focus] || [];
    const exercises = groups.map(group => {
      const candidates = pool.filter(ex => ex.muscleGroup === group);
      if (!candidates.length) return null;
      const ex = candidates[Math.floor(Math.random() * candidates.length)];
      return { exerciseId: ex.id, name: ex.name, sets: scheme.sets, reps: scheme.reps };
    }).filter(Boolean);
    return { day, focus, exercises };
  });

  return { generatedAt: new Date().toISOString(), homeOnly: !!homeOnly, goal, activityLevel, workoutType: workoutTypeKey || 'fullBody', days: scheduleDays };
}

const COMPLEXIONS = ['porcelain', 'fair', 'light', 'medium', 'tan', 'deep'];
const HAIR_TYPES = ['straight', 'wavy', 'curly', 'coily'];
const HAIR_STYLES = ['bald', 'short', 'medium', 'long'];
const EYE_COLORS = ['brown', 'blue', 'green', 'hazel', 'gray', 'amber'];
const COLOR_OPTIONS = ['black', 'white', 'gray', 'navy', 'blue', 'red', 'pink', 'purple', 'green', 'olive', 'yellow', 'orange', 'brown', 'beige', 'burgundy', 'teal', 'multicolor'];
const CONDITIONS = ['new', 'likeNew', 'good', 'worn', 'fair'];
const FITS = ['loose', 'fitted', 'exact', 'notFit'];

const COMPLEXION_PALETTES = {
  porcelain: ['navy', 'burgundy', 'emerald', 'soft pink', 'charcoal'],
  fair:      ['dusty blue', 'blush', 'lavender', 'taupe', 'forest green'],
  light:     ['coral', 'camel', 'teal', 'mustard', 'denim blue'],
  medium:    ['olive', 'rust', 'mustard', 'teal', 'chocolate brown'],
  tan:       ['terracotta', 'olive green', 'amber', 'cream', 'deep teal'],
  deep:      ['white', 'coral', 'royal blue', 'gold', 'fuchsia'],
};
const BODY_SHAPE_TIPS = {
  triangle:    'Balance shoulders with structured tops and darker bottoms.',
  invertedTriangle: 'Add volume below the waist; keep tops simple and unstructured.',
  rectangle:   'Create curves with belts, layering, and fitted waists.',
  hourglass:   'Favor fitted silhouettes that follow your natural waistline.',
  oval:        'Choose vertical lines and single-color outfits to elongate.',
};
const WARDROBE_CATEGORIES = ['top', 'bottom', 'outerwear', 'footwear', 'accessories', 'formal', 'activewear'];
// Categories offered when manually building an outfit (a subset/reframing of
// WARDROBE_CATEGORIES — outerwear/formal/activewear items still get suggested
// under whichever slot they best fit via category match, but the builder UI
// only asks for these four to keep the flow quick).
const OUTFIT_BUILDER_SLOTS = [
  { key: 'top', label: 'Top', categories: ['top'], required: true },
  { key: 'bottom', label: 'Bottom', categories: ['bottom'], required: true },
  { key: 'footwear', label: 'Shoes', categories: ['footwear'], required: false },
  { key: 'accessories', label: 'Accessories', categories: ['accessories'], required: false },
];

function buildFashionRecommendations(user) {
  const { complexion, bodyShape } = user.profile;
  const palette = COMPLEXION_PALETTES[complexion] || [];
  const tip = BODY_SHAPE_TIPS[bodyShape] || null;

  const counts = {};
  for (const cat of WARDROBE_CATEGORIES) counts[cat] = 0;
  for (const item of user.fashion.wardrobe) if (counts[item.category] !== undefined) counts[item.category]++;
  const gaps = WARDROBE_CATEGORIES.filter(cat => counts[cat] === 0);

  return { recommendedColors: palette, styleTip: tip, wardrobeGaps: gaps, wardrobeCounts: counts };
}

function sizeGuide(measurements, measurementUnits) {
  const toIn = (cm) => cm / 2.54;
  const chest = measurements.chest ? (measurementUnits === 'in' ? measurements.chest : toIn(measurements.chest)) : null;
  if (!chest) return null;
  let size = 'M';
  if (chest < 36) size = 'S';
  else if (chest < 40) size = 'M';
  else if (chest < 44) size = 'L';
  else size = 'XL';
  return { estimatedSize: size, basedOn: 'chest' };
}

// ─── AI (BYOK — each user supplies their own Anthropic API key) ───────────────

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

function aiClientFor(user) {
  const s = user.settings;
  if (!s.apiKey) return null;
  if (s.aiProvider === 'openai' || s.aiProvider === 'openai-compatible') {
    return {
      provider: 'openai',
      client: new OpenAI({ apiKey: s.apiKey, baseURL: s.aiProvider === 'openai-compatible' ? (s.aiBaseUrl || undefined) : undefined }),
      model: s.aiModel || OPENAI_DEFAULT_MODEL,
    };
  }
  return { provider: 'anthropic', client: new Anthropic({ apiKey: s.apiKey }), model: AI_MODEL };
}

function mediaTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
}
function imageFileData(filePath) {
  const data = fs.readFileSync(filePath).toString('base64');
  return { mediaType: mediaTypeForFile(filePath), data };
}

function firstTextBlock(message) {
  const block = message.content.find(b => b.type === 'text');
  return block ? block.text : '';
}

// ─── AI USAGE LIMITS ────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }

function resetDailyIfNeeded(user) {
  if (user.aiUsage.dailyDate !== todayStr()) {
    user.aiUsage.dailyDate = todayStr();
    user.aiUsage.dailyTokens = 0;
  }
}

const AI_LIMIT_MESSAGE = 'The AI usage limit is reached. Please contact administrator.';

// Returns null if the call is allowed, or an error message if it should be blocked.
function checkAiUsage(data, user) {
  if (!data.aiSettings.enabled) return 'AI features are currently disabled by the administrator.';
  resetDailyIfNeeded(user);
  if (user.aiUsage.totalTokens >= data.aiSettings.hardTokenLimit) return AI_LIMIT_MESSAGE;
  if (user.aiUsage.dailyTokens >= data.aiSettings.dailyTokenLimit) return AI_LIMIT_MESSAGE;
  return null;
}

function recordAiUsage(user, tokens, feature) {
  resetDailyIfNeeded(user);
  user.aiUsage.totalTokens += tokens;
  user.aiUsage.dailyTokens += tokens;
  user.aiUsage.log.push({ date: new Date().toISOString(), feature, tokens });
  if (user.aiUsage.log.length > 50) user.aiUsage.log = user.aiUsage.log.slice(-50);
}

// Runs one AI call across providers. `imagePath` is optional; `jsonShape` (if given)
// asks for strict JSON back (via Anthropic structured outputs or an OpenAI json_object
// response format) and the result is parsed for you. Returns { value, tokens }.
async function aiComplete(ai, { imagePath, text, maxTokens, jsonShape }) {
  if (ai.provider === 'anthropic') {
    const content = [];
    if (imagePath) { const img = imageFileData(imagePath); content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } }); }
    content.push({ type: 'text', text });
    const params = { model: ai.model, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
    if (jsonShape) params.output_config = { format: { type: 'json_schema', schema: jsonShape } };
    const message = await ai.client.messages.create(params);
    const raw = firstTextBlock(message);
    const tokens = (message.usage && (message.usage.input_tokens + message.usage.output_tokens)) || 0;
    return { value: jsonShape ? JSON.parse(raw) : raw, tokens };
  }

  // OpenAI / OpenAI-compatible
  const content = [];
  if (imagePath) { const img = imageFileData(imagePath); content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } }); }
  content.push({ type: 'text', text: jsonShape ? text + '\nRespond with a single JSON object only, no prose.' : text });
  const params = { model: ai.model, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  if (jsonShape) params.response_format = { type: 'json_object' };
  const completion = await ai.client.chat.completions.create(params);
  const raw = completion.choices[0].message.content || '';
  const tokens = (completion.usage && completion.usage.total_tokens) || 0;
  return { value: jsonShape ? JSON.parse(raw) : raw, tokens };
}

async function aiAnalyzeWardrobeItem(ai, item, profile) {
  const text = `Analyze this wardrobe item for a personal style app.\n` +
    `Item: ${item.name} (category: ${item.category}, size: ${item.size || 'unspecified'}).\n` +
    `Known metadata — color: ${item.color || 'unknown, infer from the photo if visible'}, condition: ${item.condition || 'unknown, infer from the photo if visible'}, fit on this person: ${item.fit || 'unspecified'}, notes: ${item.remarks || 'none'}.\n` +
    `Person: complexion=${profile.complexion || 'unspecified'}, bodyShape=${profile.bodyShape || 'unspecified'}.\n` +
    `Give an overall score from 1.0 to 5.0 (one decimal place) considering: how well the color suits their skin tone, apparent fabric quality/condition from the photo, how the stated fit works for their body shape, and general comfort/style. ` +
    `Then give a 1-2 sentence comment justifying the score.\n` +
    `Also return your best-guess color (one of: ${COLOR_OPTIONS.join(', ')}) and condition (one of: ${CONDITIONS.join(', ')}) ONLY if they were unknown above — otherwise echo the known value back unchanged.\n` +
    `JSON shape: {"color": "<string>", "condition": "<string>", "score": <number>, "comment": "<string>"}`;
  return aiComplete(ai, {
    imagePath: item.photo ? path.join(CLIENT_DIR, item.photo) : null,
    text, maxTokens: 300,
    jsonShape: {
      type: 'object',
      properties: { color: { type: 'string', enum: COLOR_OPTIONS }, condition: { type: 'string', enum: CONDITIONS }, score: { type: 'number' }, comment: { type: 'string' } },
      required: ['color', 'condition', 'score', 'comment'], additionalProperties: false,
    },
  });
}

async function aiScoreOutfit(ai, items, profile) {
  const text = `Rate this outfit for the person's skin tone and body shape, and give a short comment.\n` +
    `Outfit items: ${JSON.stringify(items.map(i => ({ name: i.name, category: i.category, color: i.color, fit: i.fit })))}\n` +
    `Person: complexion=${profile.complexion || 'unspecified'}, bodyShape=${profile.bodyShape || 'unspecified'}.\n` +
    `Give an overall score from 1.0 to 5.0 (one decimal place) and a 1-2 sentence comment on color coordination, fit, and style cohesion.\n` +
    `JSON shape: {"score": <number>, "comment": "<string>"}`;
  return aiComplete(ai, {
    text, maxTokens: 300,
    jsonShape: { type: 'object', properties: { score: { type: 'number' }, comment: { type: 'string' } }, required: ['score', 'comment'], additionalProperties: false },
  });
}

async function aiOutfitCheck(ai, photoPath, profile) {
  const text = `This is a photo of someone wearing an outfit. Their complexion is ${profile.complexion || 'unspecified'} and body shape is ${profile.bodyShape || 'unspecified'}. ` +
    `Give constructive, specific feedback on the outfit in 2-4 sentences — fit, color coordination, and one concrete suggestion for improvement.`;
  return aiComplete(ai, { imagePath: photoPath, text, maxTokens: 500 });
}

async function aiAnalyzeFace(ai, photoPath) {
  const text = `This is a photo of a person's face. Classify their appearance for a style-profile app.\n` +
    `complexion must be one of: ${COMPLEXIONS.join(', ')}.\n` +
    `hairType must be one of: ${HAIR_TYPES.join(', ')}.\n` +
    `hairStyle must be one of: ${HAIR_STYLES.join(', ')}.\n` +
    `eyeColor must be one of: ${EYE_COLORS.join(', ')}.\n` +
    `JSON shape: {"complexion": "<string>", "hairType": "<string>", "hairStyle": "<string>", "eyeColor": "<string>"}`;
  return aiComplete(ai, {
    imagePath: photoPath, text, maxTokens: 200,
    jsonShape: {
      type: 'object',
      properties: {
        complexion: { type: 'string', enum: COMPLEXIONS },
        hairType: { type: 'string', enum: HAIR_TYPES },
        hairStyle: { type: 'string', enum: HAIR_STYLES },
        eyeColor: { type: 'string', enum: EYE_COLORS },
      },
      required: ['complexion', 'hairType', 'hairStyle', 'eyeColor'], additionalProperties: false,
    },
  });
}

async function aiGenerateOutfit(ai, prompt, wardrobe, profile) {
  const wardrobeList = wardrobe.map(i => ({ id: i.id, name: i.name, category: i.category, color: i.color, size: i.size }));
  const text = `Here is a wardrobe (JSON): ${JSON.stringify(wardrobeList)}\n` +
    `Person: complexion=${profile.complexion || 'unspecified'}, bodyShape=${profile.bodyShape || 'unspecified'}.\n` +
    `Request: "${prompt}"\n` +
    `Pick a coherent outfit using only item ids from the wardrobe above (omit categories that aren't needed) and explain the reasoning in 1-2 sentences. ` +
    `Also give an overall score from 1.0 to 5.0 (one decimal place) for how well this outfit works for this person's complexion and body shape.\n` +
    `JSON shape: {"itemIds": [<string>...], "reasoning": "<string>", "score": <number>}`;
  return aiComplete(ai, {
    text, maxTokens: 500,
    jsonShape: { type: 'object', properties: { itemIds: { type: 'array', items: { type: 'string' } }, reasoning: { type: 'string' }, score: { type: 'number' } }, required: ['itemIds', 'reasoning', 'score'], additionalProperties: false },
  });
}

// Given a photo of a worn outfit, identifies each garment and either matches
// it to an existing wardrobe item (by id, so we "merge" rather than duplicate)
// or describes a new one to be created. Also scores the outfit as a whole.
async function aiLinkOutfitItems(ai, photoPath, wardrobe, profile) {
  const wardrobeList = wardrobe.map(i => ({ id: i.id, name: i.name, category: i.category, color: i.color }));
  const text = `This is a photo of an outfit someone is wearing. Identify each distinct garment/accessory visible (e.g. top, bottom, outerwear, footwear).\n` +
    `Here is the person's existing wardrobe catalog (JSON): ${JSON.stringify(wardrobeList)}\n` +
    `For each garment you see, decide whether it matches an existing catalog item (same category and same/very similar color) — if so set "id" to that item's id from the catalog above, exactly as given. If it does not match anything in the catalog, set "id" to an empty string and describe it: name, category (one of: ${WARDROBE_CATEGORIES.join(', ')}), color (one of: ${COLOR_OPTIONS.join(', ')}).\n` +
    `Also give an overall score from 1.0 to 5.0 (one decimal place) for how well this outfit works for the person (complexion=${profile.complexion || 'unspecified'}, bodyShape=${profile.bodyShape || 'unspecified'}), and a 1-2 sentence comment on color coordination, fit, and style cohesion.\n` +
    `JSON shape: {"garments": [{"id": "<string, may be empty>", "name": "<string>", "category": "<string>", "color": "<string>"}], "score": <number>, "comment": "<string>"}`;
  return aiComplete(ai, {
    imagePath: photoPath, text, maxTokens: 700,
    jsonShape: {
      type: 'object',
      properties: {
        garments: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string', enum: WARDROBE_CATEGORIES }, color: { type: 'string', enum: COLOR_OPTIONS } },
            required: ['id', 'name', 'category', 'color'], additionalProperties: false,
          },
        },
        score: { type: 'number' }, comment: { type: 'string' },
      },
      required: ['garments', 'score', 'comment'], additionalProperties: false,
    },
  });
}

// ─── AI IMAGE GENERATION (BYOK — separate provider from the text/vision AI) ───
//
// Generates a full-body "wearing this outfit" shot with the head cropped out.
// Provider is independent of the user's chat/vision aiProvider since only
// some providers can generate images at all (Anthropic can't).

function outfitImagePrompt(items) {
  const desc = items.map(i => (i.color ? i.color + ' ' : '') + i.name + ' (' + i.category + ')').join(', ');
  return 'Full-body studio product photo of a person wearing an outfit consisting of: ' + desc + '. '
    + 'Neutral seamless studio background, even lighting, realistic fabric texture and fit, standing pose. '
    + 'Frame the shot from the shoulders down to the feet — crop out and exclude the head and face entirely. '
    + 'No text, watermark, or logos.';
}

// Returns a Buffer of the generated image, or throws.
async function generateOutfitImage(settings, items) {
  const prompt = outfitImagePrompt(items);
  if (settings.imageGenProvider === 'openai') {
    const client = new OpenAI({ apiKey: settings.imageGenApiKey });
    const model = settings.imageGenModel || 'gpt-image-1';
    // Pure text-to-image can only guess at "a navy jacket" — it won't match the
    // actual garment. When the items have real photos, hand them to images.edit
    // as reference images instead, so the model composes the outfit from what's
    // actually in the wardrobe rather than a text description of it.
    const referencePaths = items.map(i => mainPhoto(i)).filter(Boolean).map(url => path.join(CLIENT_DIR, url));
    if (referencePaths.length) {
      // toFile() can't sniff the mimetype from a raw read stream — without an
      // explicit type it defaults to application/octet-stream, which the
      // images.edit endpoint rejects outright ("unsupported mimetype").
      const imageFiles = await Promise.all(referencePaths.map(p => toFile(fs.createReadStream(p), path.basename(p), { type: mediaTypeForFile(p) })));
      const result = await client.images.edit({
        model, image: imageFiles, size: '1024x1536', quality: 'high',
        prompt: prompt + ' The reference images show the actual garments — reproduce their exact color, pattern, and design rather than substituting similar-looking items.',
      });
      return Buffer.from(result.data[0].b64_json, 'base64');
    }
    const result = await client.images.generate({ model, prompt, size: '1024x1536', quality: 'high' });
    return Buffer.from(result.data[0].b64_json, 'base64');
  }
  if (settings.imageGenProvider === 'gemini') {
    const model = settings.imageGenModel || 'gemini-2.5-flash-image';
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.imageGenApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      let detail = bodyText;
      try { detail = JSON.parse(bodyText).error.message; } catch (_) { /* keep raw text */ }
      console.error('[image-gen] Gemini request failed:', resp.status, bodyText);
      throw new Error('Gemini image request failed (' + resp.status + '): ' + (detail || 'no details returned'));
    }
    const json = await resp.json();
    const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
    const imagePart = parts.find(p => p.inlineData);
    if (!imagePart) throw new Error('Gemini did not return an image');
    return Buffer.from(imagePart.inlineData.data, 'base64');
  }
  throw new Error('Image generation provider not configured');
}

// Best-effort: generates the outfit image and appends it to outfit.photos
// marked ai:true. Takes ids (not object references) and reloads data fresh
// right before writing, since the image call can take a while and this is a
// single-file datastore — minimizes (doesn't eliminate) lost-update races
// against other requests that might save in the meantime. Never throws.
async function generateAndAttachOutfitImage(userName, outfitId) {
  const data = loadData();
  const user = findUser(data, userName);
  if (!user) return { ok: false, error: 'user-not-found' };
  const outfit = user.fashion.outfits.find(o => o.id === outfitId);
  if (!outfit) return { ok: false, error: 'outfit-not-found' };
  if (!user.settings.imageGenProvider || !user.settings.imageGenApiKey) return { ok: false, error: 'not-configured' };
  const items = user.fashion.wardrobe.filter(i => outfit.itemIds.includes(i.id));
  if (!items.length) return { ok: false, error: 'no-items' };
  let buf;
  try {
    buf = await generateOutfitImage(user.settings, items);
  } catch (err) {
    console.error('[image-gen] generateAndAttachOutfitImage failed for outfit ' + outfitId + ':', err.message);
    return { ok: false, error: err.message };
  }
  const fresh = loadData();
  const freshUser = findUser(fresh, userName);
  const freshOutfit = freshUser && freshUser.fashion.outfits.find(o => o.id === outfitId);
  if (!freshOutfit) return { ok: false, error: 'outfit-not-found' };
  const dir = path.join(IMAGES_DIR, 'uploaded', sanitizeFolderName(userName), 'outfit');
  fs.mkdirSync(dir, { recursive: true });
  const filename = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.png';
  fs.writeFileSync(path.join(dir, filename), buf);
  const url = '/images/uploaded/' + sanitizeFolderName(userName) + '/outfit/' + filename;
  const photo = addPhoto(freshOutfit, url, { ai: true });
  saveData(fresh);
  return { ok: true, photo, outfit: freshOutfit };
}

async function aiShoppingRecommendations(ai, wardrobe, outfits, profile) {
  const wardrobeSummary = wardrobe.map(i => ({ name: i.name, category: i.category, color: i.color }));
  const outfitSummary = outfits.map(o => ({ items: o.items.map(i => i.name), score: o.score }));
  const text = `You are a personal stylist. Here is the person's current wardrobe (JSON): ${JSON.stringify(wardrobeSummary)}\n`
    + `Here are their saved outfits (JSON): ${JSON.stringify(outfitSummary)}\n`
    + `Person: complexion=${profile.complexion || 'unspecified'}, bodyShape=${profile.bodyShape || 'unspecified'}.\n`
    + `Based on what outfits they can already make and what's missing, give: (1) a 2-3 sentence summary of how well their wardrobe currently supports full outfits, `
    + `(2) a list of up to 5 specific items to buy next to unlock more outfit combinations, each with a short reason.\n`
    + `JSON shape: {"summary": "<string>", "shoppingList": [{"item": "<string>", "reason": "<string>"}]}`;
  return aiComplete(ai, {
    text, maxTokens: 600,
    jsonShape: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        shoppingList: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, reason: { type: 'string' } }, required: ['item', 'reason'], additionalProperties: false } },
      },
      required: ['summary', 'shoppingList'], additionalProperties: false,
    },
  });
}

// ─── FILE UPLOADS ──────────────────────────────────────────────────────────────
//
// images/
//   system/exercise/         — exercise reference photos (admin-managed)
//   uploaded/<username>/wardrobe/   — per-user wardrobe photos
//   uploaded/<username>/outfit/     — per-user outfit-check photos

const IMAGES_DIR = path.join(CLIENT_DIR, 'images');
const EXERCISE_IMAGES_DIR = path.join(IMAGES_DIR, 'system', 'exercise');
fs.mkdirSync(EXERCISE_IMAGES_DIR, { recursive: true });

function sanitizeFolderName(name) { return String(name).replace(/[^a-zA-Z0-9_-]/g, '_'); }

function uploadFilename(file) {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + ext;
}

function makeFixedUpload(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => cb(null, uploadFilename(file)),
  });
  return multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
}

// Per-user uploads: destination depends on the requesting user (X-User-Name header),
// created on demand.
function makeUserUpload(subfolder) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(IMAGES_DIR, 'uploaded', sanitizeFolderName(req.headers['x-user-name'] || 'unknown'), subfolder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, uploadFilename(file)),
  });
  return multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
}

const wardrobeUpload = makeUserUpload('wardrobe');
const outfitCheckUpload = makeUserUpload('outfit');
const faceUpload = makeUserUpload('face');
const exerciseImageUpload = makeFixedUpload(EXERCISE_IMAGES_DIR);

// ─── APP ──────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*', allowedHeaders: ['Content-Type', 'x-user-name'] }));
app.use(express.json());

// ─── STATIC FILES (local dev — nginx handles this in production) ──────────────

app.get('/', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));
app.get('/sw.js', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'sw.js')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'manifest.json')));
app.use('/icons', express.static(path.join(CLIENT_DIR, 'icons')));
app.use('/css', express.static(path.join(CLIENT_DIR, 'css')));
app.use('/js', express.static(path.join(CLIENT_DIR, 'js')));
app.use('/images', express.static(IMAGES_DIR));

app.get('/info', (req, res) => res.json({ version: APP_VERSION }));

// ─── AUTH ─────────────────────────────────────────────────────────────────────

app.get('/accounts', (req, res) => {
  const data = loadData();
  res.json({ ok: true, accounts: data.users.map(u => ({ name: u.name })) });
});

app.post('/login', (req, res) => {
  const { name, pin } = req.body || {};
  if (!name || pin === undefined) return res.status(400).json({ ok: false, error: 'Missing name or pin' });
  const data = loadData();
  const user = findUser(data, name);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  if (user.pin !== String(pin)) return res.status(401).json({ ok: false, error: 'Wrong PIN' });
  res.json({ ok: true, name: user.name, isAdmin: !!user.isAdmin, isForPasswordReset: !!user.isForPasswordReset });
});

app.post('/change-pin', (req, res) => {
  const { name, currentPin, newPin } = req.body || {};
  if (!newPin || !/^\d{4}$/.test(String(newPin))) return res.status(400).json({ ok: false, error: 'PIN must be 4 digits' });
  const data = loadData();
  const user = findUser(data, name);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  if (!user.isForPasswordReset && user.pin !== String(currentPin)) return res.status(401).json({ ok: false, error: 'Wrong current PIN' });
  user.pin = String(newPin);
  user.isForPasswordReset = false;
  saveData(data);
  res.json({ ok: true });
});

// ─── USER MANAGEMENT (admin) ──────────────────────────────────────────────────

app.get('/users', (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  res.json({ ok: true, users: data.users.map(u => ({ name: u.name, isAdmin: !!u.isAdmin, isForPasswordReset: !!u.isForPasswordReset })) });
});

app.post('/users', (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  const { name, isAdmin } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Name required' });
  const trimmed = name.trim();
  if (findUser(data, trimmed)) return res.status(409).json({ ok: false, error: 'User already exists' });
  data.users.push(defaultUser(trimmed, { isAdmin: !!isAdmin }));
  saveData(data);
  res.json({ ok: true });
});

app.put('/users/:name/admin', (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  const target = findUser(data, req.params.name);
  if (!target) return res.status(404).json({ ok: false, error: 'User not found' });
  target.isAdmin = !!(req.body && req.body.isAdmin);
  saveData(data);
  res.json({ ok: true });
});

// ─── ADMIN: AI MONITORING ──────────────────────────────────────────────────────

app.get('/manage/monitoring', (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  const users = data.users.map(u => {
    resetDailyIfNeeded(u);
    return { name: u.name, dailyTokens: u.aiUsage.dailyTokens, totalTokens: u.aiUsage.totalTokens, log: u.aiUsage.log.slice(-10).reverse() };
  });
  saveData(data); // persist any daily resets triggered above
  res.json({ ok: true, aiSettings: data.aiSettings, users });
});

app.put('/manage/ai-settings', (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  const { enabled, dailyTokenLimit, hardTokenLimit } = req.body || {};
  if (enabled !== undefined) data.aiSettings.enabled = !!enabled;
  if (dailyTokenLimit !== undefined) {
    const n = Number(dailyTokenLimit);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ ok: false, error: 'dailyTokenLimit must be a positive number' });
    data.aiSettings.dailyTokenLimit = n;
  }
  if (hardTokenLimit !== undefined) {
    const n = Number(hardTokenLimit);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ ok: false, error: 'hardTokenLimit must be a positive number' });
    data.aiSettings.hardTokenLimit = n;
  }
  saveData(data);
  res.json({ ok: true, aiSettings: data.aiSettings });
});

app.put('/manage/ai-usage/:name/reset', (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  const target = findUser(data, req.params.name);
  if (!target) return res.status(404).json({ ok: false, error: 'User not found' });
  target.aiUsage.totalTokens = 0;
  target.aiUsage.dailyTokens = 0;
  target.aiUsage.dailyDate = todayStr();
  saveData(data);
  res.json({ ok: true });
});

// ─── PROFILE + SETTINGS ────────────────────────────────────────────────────────

function publicSettings(settings) {
  return {
    heightUnits: settings.heightUnits,
    weightUnits: settings.weightUnits,
    measurementUnits: settings.measurementUnits,
    aiProvider: settings.aiProvider,
    aiBaseUrl: settings.aiBaseUrl,
    aiModel: settings.aiModel,
    apiKeyConfigured: !!settings.apiKey,
    imageGenProvider: settings.imageGenProvider,
    imageGenModel: settings.imageGenModel,
    imageGenApiKeyConfigured: !!settings.imageGenApiKey,
  };
}

function profileBmi(profile) {
  return calcBmi(heightCm(profile.height, profile.heightUnit), weightKg(profile.weight, profile.weightUnit));
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function countWorkoutSessions(history, sinceMs) {
  const seen = new Set();
  for (const h of history) {
    const t = new Date(h.date).getTime();
    if (isNaN(t) || t < sinceMs) continue;
    seen.add(h.sessionId || h.date.slice(0, 10));
  }
  return seen.size;
}

// A 1.0-5.0 fitness score (one decimal), computed without AI, from three
// evidence-based inputs:
//  - BMI category, per the WHO BMI classification
//  - workout consistency in the trailing 7 days, benchmarked against
//    ACSM/CDC physical-activity guidance (~3+ sessions/week for general fitness)
//  - pace toward the user's goal date (if set): actual vs. expected session
//    count, where "expected" comes from their activity level's recommended
//    weekly frequency (see ACTIVITY_DAYS) times weeks elapsed since the goal was set
function computeFitnessScore(user) {
  const p = user.profile;
  const bmi = profileBmi(p);
  let bmiScore = 3.0;
  if (bmi) {
    if (bmi >= 18.5 && bmi <= 24.9) bmiScore = 5.0;
    else if ((bmi >= 25 && bmi <= 29.9) || (bmi >= 17 && bmi < 18.5)) bmiScore = 3.5;
    else if ((bmi >= 30 && bmi <= 34.9) || (bmi >= 16 && bmi < 17)) bmiScore = 2.0;
    else bmiScore = 1.0;
  }

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const sessionsLast7 = countWorkoutSessions(user.fitness.history, now - WEEK_MS);
  const consistencyScore = sessionsLast7 >= 4 ? 5.0 : sessionsLast7 === 3 ? 4.0 : sessionsLast7 === 2 ? 3.0 : sessionsLast7 === 1 ? 2.0 : 1.0;

  let goalScore = consistencyScore;
  if (p.goals && p.goals[0] && p.goalTargetDate && p.goalSetAt) {
    const setAt = new Date(p.goalSetAt).getTime();
    const target = new Date(p.goalTargetDate).getTime();
    const recommendedPerWeek = ACTIVITY_DAYS[p.activityLevel] || 3;
    if (!isNaN(setAt) && !isNaN(target) && target > setAt) {
      const totalWeeks = (target - setAt) / WEEK_MS;
      const elapsedWeeks = clamp((now - setAt) / WEEK_MS, 0, totalWeeks);
      const expectedSessions = recommendedPerWeek * elapsedWeeks;
      const actualSessions = countWorkoutSessions(user.fitness.history, setAt);
      const ratio = expectedSessions > 0 ? actualSessions / expectedSessions : 1;
      goalScore = clamp(ratio, 0, 1) * 5;
    }
  }

  const overall = clamp(Math.round((0.4 * bmiScore + 0.4 * consistencyScore + 0.2 * goalScore) * 10) / 10, 0, 5);
  return { overall, bmiScore, consistencyScore, goalScore: Math.round(goalScore * 10) / 10, sessionsLast7 };
}

app.get('/profile', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, profile: user.profile, settings: publicSettings(user.settings), bmi: profileBmi(user.profile), fitnessScore: computeFitnessScore(user), aiEnabled: data.aiSettings.enabled });
});

app.put('/profile', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const prevGoal = (user.profile.goals || [])[0];
  Object.assign(user.profile, req.body || {}, { completed: true });
  // Track when the current goal was set so the fitness score can measure pace
  // toward the goal date; clear it if the goal itself is cleared.
  const newGoal = (user.profile.goals || [])[0];
  if (newGoal && (newGoal !== prevGoal || !user.profile.goalSetAt)) user.profile.goalSetAt = new Date().toISOString();
  if (!newGoal) user.profile.goalSetAt = null;
  // Tag whichever fields were just submitted with the unit the user is
  // currently viewing in — that's what the form's raw numbers are in.
  user.profile.heightUnit = user.settings.heightUnits;
  user.profile.weightUnit = user.settings.weightUnits;
  user.profile.measurementsUnit = user.settings.measurementUnits;
  saveData(data);
  res.json({ ok: true, profile: user.profile, bmi: profileBmi(user.profile), fitnessScore: computeFitnessScore(user) });
});

app.post('/profile/face-photo', faceUpload.single('photo'), async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  if (!req.file) return res.status(400).json({ ok: false, error: 'photo required' });
  user.profile.facePhoto = '/images/uploaded/' + sanitizeFolderName(req.headers['x-user-name']) + '/face/' + req.file.filename;
  let aiApplied = false;
  const ai = aiClientFor(user);
  if (ai && !checkAiUsage(data, user)) {
    try {
      const { value, tokens } = await aiAnalyzeFace(ai, path.join(CLIENT_DIR, user.profile.facePhoto));
      user.profile.complexion = value.complexion;
      user.profile.hairType = value.hairType;
      user.profile.hairStyle = value.hairStyle;
      user.profile.eyeColor = value.eyeColor;
      recordAiUsage(user, tokens, 'face-analysis');
      aiApplied = true;
    } catch (_) { /* photo is still saved even if AI classification fails */ }
  }
  saveData(data);
  res.json({ ok: true, profile: user.profile, aiApplied });
});

app.put('/settings/height-units', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const { heightUnits } = req.body || {};
  if (heightUnits !== 'cm' && heightUnits !== 'in') return res.status(400).json({ ok: false, error: 'heightUnits must be cm or in' });
  user.settings.heightUnits = heightUnits;
  normalizeProfileUnits(user);
  saveData(data);
  res.json({ ok: true, settings: publicSettings(user.settings), profile: user.profile, bmi: profileBmi(user.profile) });
});

app.put('/settings/weight-units', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const { weightUnits } = req.body || {};
  if (weightUnits !== 'kg' && weightUnits !== 'lb') return res.status(400).json({ ok: false, error: 'weightUnits must be kg or lb' });
  user.settings.weightUnits = weightUnits;
  normalizeProfileUnits(user);
  saveData(data);
  res.json({ ok: true, settings: publicSettings(user.settings), profile: user.profile, bmi: profileBmi(user.profile) });
});

app.put('/settings/measurement-units', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const { measurementUnits } = req.body || {};
  if (measurementUnits !== 'cm' && measurementUnits !== 'in') return res.status(400).json({ ok: false, error: 'measurementUnits must be cm or in' });
  user.settings.measurementUnits = measurementUnits;
  normalizeProfileUnits(user);
  saveData(data);
  res.json({ ok: true, settings: publicSettings(user.settings), profile: user.profile });
});

const AI_PROVIDERS = ['anthropic', 'openai', 'openai-compatible'];

app.put('/settings/ai', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const { provider, apiKey, baseUrl, model } = req.body || {};
  if (provider !== undefined) {
    if (!AI_PROVIDERS.includes(provider)) return res.status(400).json({ ok: false, error: 'Unknown provider' });
    user.settings.aiProvider = provider;
  }
  if (apiKey !== undefined) user.settings.apiKey = apiKey ? String(apiKey).trim() : null;
  if (baseUrl !== undefined) user.settings.aiBaseUrl = baseUrl ? String(baseUrl).trim() : null;
  if (model !== undefined) user.settings.aiModel = model ? String(model).trim() : null;
  saveData(data);
  res.json({ ok: true, settings: publicSettings(user.settings) });
});

const IMAGE_GEN_PROVIDERS = ['openai', 'gemini'];

app.put('/settings/image-gen', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const { provider, apiKey, model } = req.body || {};
  if (provider !== undefined) {
    if (provider !== null && provider !== '' && !IMAGE_GEN_PROVIDERS.includes(provider)) return res.status(400).json({ ok: false, error: 'Unknown image generation provider' });
    user.settings.imageGenProvider = provider || null;
  }
  if (apiKey !== undefined) user.settings.imageGenApiKey = apiKey ? String(apiKey).trim() : null;
  if (model !== undefined) user.settings.imageGenModel = model ? String(model).trim() : null;
  saveData(data);
  res.json({ ok: true, settings: publicSettings(user.settings) });
});

// ─── FITNESS ──────────────────────────────────────────────────────────────────

app.get('/exercises', (req, res) => {
  const data = loadData();
  const homeOnly = req.query.homeOnly === 'true';
  const list = homeOnly ? data.exerciseLibrary.filter(ex => ex.homeFriendly) : data.exerciseLibrary;
  res.json({ ok: true, exercises: list });
});

app.post('/exercises', exerciseImageUpload.single('image'), (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  const b = req.body || {};
  if (!b.name || !b.muscleGroup) return res.status(400).json({ ok: false, error: 'name and muscleGroup required' });
  const ex = {
    id: (b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) + '-' + Date.now().toString(36),
    name: b.name,
    muscleGroup: b.muscleGroup,
    equipment: b.equipment || 'none',
    homeFriendly: b.homeFriendly === 'true' || b.homeFriendly === true,
    defaultSets: Number(b.defaultSets) || 3,
    defaultReps: Number(b.defaultReps) || 10,
    met: Number(b.met) || 5.0,
    instructions: b.instructions || '',
    image: req.file ? '/images/system/exercise/' + req.file.filename : null,
    video: b.video || null,
  };
  data.exerciseLibrary.push(ex);
  saveData(data);
  res.json({ ok: true, exercise: ex });
});

app.put('/exercises/:id', exerciseImageUpload.single('image'), (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  const ex = data.exerciseLibrary.find(e => e.id === req.params.id);
  if (!ex) return res.status(404).json({ ok: false, error: 'Exercise not found' });
  const b = req.body || {};
  if (b.name !== undefined) ex.name = b.name;
  if (b.muscleGroup !== undefined) ex.muscleGroup = b.muscleGroup;
  if (b.equipment !== undefined) ex.equipment = b.equipment;
  if (b.homeFriendly !== undefined) ex.homeFriendly = b.homeFriendly === 'true' || b.homeFriendly === true;
  if (b.defaultSets !== undefined) ex.defaultSets = Number(b.defaultSets) || ex.defaultSets;
  if (b.defaultReps !== undefined) ex.defaultReps = Number(b.defaultReps) || ex.defaultReps;
  if (b.met !== undefined) ex.met = Number(b.met) || ex.met;
  if (b.instructions !== undefined) ex.instructions = b.instructions;
  if (b.video !== undefined) ex.video = b.video || null;
  if (req.file) ex.image = '/images/system/exercise/' + req.file.filename;
  saveData(data);
  res.json({ ok: true, exercise: ex });
});

app.delete('/exercises/:id', (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  const ex = data.exerciseLibrary.find(e => e.id === req.params.id);
  if (ex && ex.image) { try { fs.unlinkSync(path.join(CLIENT_DIR, ex.image)); } catch (_) {} }
  data.exerciseLibrary = data.exerciseLibrary.filter(e => e.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

// "Get Workouts" — refreshes the library against the built-in source list
// (DEFAULT_EXERCISE_LIBRARY, shipped with each app update). Existing entries
// are updated in place (custom reference photos are preserved); new ones from
// the source are added; exercises the admin added themselves are left alone.
app.post('/exercises/sync', (req, res) => {
  const data = loadData();
  const admin = requireAdmin(req, res, data); if (!admin) return;
  let added = 0, updated = 0;
  for (const src of DEFAULT_EXERCISE_LIBRARY) {
    const existing = data.exerciseLibrary.find(e => e.id === src.id);
    if (existing) {
      const { image, ...rest } = src;
      Object.assign(existing, rest);
      if (!existing.image) existing.image = src.image;
      updated++;
    } else {
      data.exerciseLibrary.push(Object.assign({}, src));
      added++;
    }
  }
  saveData(data);
  res.json({ ok: true, added, updated, exercises: data.exerciseLibrary });
});

app.get('/fitness/plan', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, plan: user.fitness.plan });
});

// Powers the Generate Plan options screen: which exercises should start
// checked. Recommendation = matches the homeOnly filter and doesn't touch an
// injured muscle group — the same safety/preference logic generatePlan() uses.
app.get('/fitness/plan/recommended-exercises', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const homeOnly = req.query.homeOnly === 'true';
  const injuries = user.profile.injuries || [];
  const ownedEquipment = user.profile.equipment;
  const hasEquipmentFilter = Array.isArray(ownedEquipment) && ownedEquipment.length > 0;
  const recommendedIds = data.exerciseLibrary
    .filter(ex => !injuries.includes(ex.muscleGroup) && (!homeOnly || ex.homeFriendly)
      && (!hasEquipmentFilter || ex.equipment === 'none' || ownedEquipment.includes(ex.equipment)))
    .map(ex => ex.id);
  res.json({ ok: true, recommendedIds });
});

app.get('/fitness/workout-types', (req, res) => {
  res.json({ ok: true, workoutTypes: Object.entries(WORKOUT_TYPES).map(([key, v]) => ({ key, label: v.label })) });
});

app.post('/fitness/plan/generate', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const homeOnly = !!(req.body && req.body.homeOnly);
  const includeIds = (req.body && Array.isArray(req.body.includeIds)) ? req.body.includeIds : null;
  const workoutType = (req.body && WORKOUT_TYPES[req.body.workoutType]) ? req.body.workoutType : 'fullBody';
  user.fitness.plan = generatePlan(user, data.exerciseLibrary, homeOnly, includeIds, workoutType);
  saveData(data);
  res.json({ ok: true, plan: user.fitness.plan });
});

app.get('/fitness/history', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, history: user.fitness.history });
});

app.post('/fitness/history', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const { exerciseId, sets, reps, weight, date, sessionId, durationSeconds } = req.body || {};
  if (!exerciseId) return res.status(400).json({ ok: false, error: 'exerciseId required' });
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    exerciseId, sets: sets || null, reps: reps || null, weight: weight || null,
    date: date || new Date().toISOString(),
    sessionId: sessionId || null, durationSeconds: durationSeconds || null,
  };
  user.fitness.history.push(entry);
  saveData(data);
  res.json({ ok: true, entry });
});

// ─── HABITS ───────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HABIT_RECURRENCE_TYPES = ['daily', 'weekly', 'once'];

function isValidRecurrence(r) {
  if (!r || !HABIT_RECURRENCE_TYPES.includes(r.type)) return false;
  if (r.type === 'weekly') return Array.isArray(r.days) && r.days.length > 0 && r.days.every(d => WEEKDAYS.includes(d));
  if (r.type === 'once') return typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date);
  return true;
}

app.get('/habits', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, habits: user.habits });
});

app.post('/habits', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const { name, durationMinutes, recurrence } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Name required' });
  const rec = recurrence || { type: 'daily' };
  if (!isValidRecurrence(rec)) return res.status(400).json({ ok: false, error: 'Invalid recurrence' });
  const habit = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    durationMinutes: Number(durationMinutes) > 0 ? Number(durationMinutes) : 10,
    recurrence: rec,
    completions: [],
    createdAt: new Date().toISOString(),
  };
  user.habits.push(habit);
  saveData(data);
  res.json({ ok: true, habit });
});

app.put('/habits/:id', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const habit = user.habits.find(h => h.id === req.params.id);
  if (!habit) return res.status(404).json({ ok: false, error: 'Habit not found' });
  const { name, durationMinutes, recurrence } = req.body || {};
  if (name !== undefined) { if (!name.trim()) return res.status(400).json({ ok: false, error: 'Name required' }); habit.name = name.trim(); }
  if (durationMinutes !== undefined) habit.durationMinutes = Number(durationMinutes) > 0 ? Number(durationMinutes) : habit.durationMinutes;
  if (recurrence !== undefined) {
    if (!isValidRecurrence(recurrence)) return res.status(400).json({ ok: false, error: 'Invalid recurrence' });
    habit.recurrence = recurrence;
  }
  saveData(data);
  res.json({ ok: true, habit });
});

app.delete('/habits/:id', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  user.habits = user.habits.filter(h => h.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

app.post('/habits/:id/complete', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const habit = user.habits.find(h => h.id === req.params.id);
  if (!habit) return res.status(404).json({ ok: false, error: 'Habit not found' });
  const date = (req.body && req.body.date) || todayStr();
  if (!habit.completions.includes(date)) habit.completions.push(date);
  saveData(data);
  res.json({ ok: true, habit });
});

app.delete('/habits/:id/complete/:date', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const habit = user.habits.find(h => h.id === req.params.id);
  if (!habit) return res.status(404).json({ ok: false, error: 'Habit not found' });
  habit.completions = habit.completions.filter(d => d !== req.params.date);
  saveData(data);
  res.json({ ok: true, habit });
});

// ─── MOTIVATIONS (shared across all users, refreshed from a free public API) ──

async function fetchMotivationsFromApi() {
  const resp = await fetch('https://zenquotes.io/api/quotes');
  if (!resp.ok) throw new Error('ZenQuotes request failed: ' + resp.status);
  const json = await resp.json();
  const items = json.map(q => (q.q || '').trim() + (q.a && q.a !== 'zenquotes.io' ? ' — ' + q.a : '')).filter(Boolean);
  if (!items.length) throw new Error('ZenQuotes returned no quotes');
  return items;
}

app.get('/motivations', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, motivations: data.motivations });
});

// Shared resource (not per-user) — any logged-in user can trigger a refresh,
// same as the initial boot-time sync below.
app.post('/motivations/sync', async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  try {
    const items = await fetchMotivationsFromApi();
    data.motivations = { items, syncedAt: new Date().toISOString() };
    saveData(data);
    res.json({ ok: true, motivations: data.motivations });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Failed to sync motivations: ' + err.message });
  }
});

// Best-effort one-time seed: only runs if this server has never successfully
// synced before (syncedAt null), so restarts don't keep re-fetching — that's
// what the Settings "Sync Motivations" button is for.
(async function seedMotivationsOnBoot() {
  const data = loadData();
  if (data.motivations && data.motivations.syncedAt) return;
  try {
    const items = await fetchMotivationsFromApi();
    const fresh = loadData();
    fresh.motivations = { items, syncedAt: new Date().toISOString() };
    saveData(fresh);
    console.log('[motivations] boot sync succeeded: ' + items.length + ' quotes');
  } catch (err) {
    console.error('[motivations] boot sync failed, keeping defaults:', err.message);
  }
})();

// ─── FASHION ──────────────────────────────────────────────────────────────────

app.get('/fashion/wardrobe', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, wardrobe: user.fashion.wardrobe });
});

function wardrobeMeasurementsFromBody(b, fallback) {
  fallback = fallback || { chest: null, waist: null, length: null, shoulder: null };
  return {
    chest: b['measurements.chest'] !== undefined ? (b['measurements.chest'] ? Number(b['measurements.chest']) : null) : fallback.chest,
    waist: b['measurements.waist'] !== undefined ? (b['measurements.waist'] ? Number(b['measurements.waist']) : null) : fallback.waist,
    length: b['measurements.length'] !== undefined ? (b['measurements.length'] ? Number(b['measurements.length']) : null) : fallback.length,
    shoulder: b['measurements.shoulder'] !== undefined ? (b['measurements.shoulder'] ? Number(b['measurements.shoulder']) : null) : fallback.shoulder,
  };
}

app.post('/fashion/wardrobe', wardrobeUpload.single('photo'), async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const b = req.body || {};
  if (!b.name || !b.category) return res.status(400).json({ ok: false, error: 'name and category required' });
  const item = Object.assign(defaultWardrobeItemFields(), {
    id: Date.now().toString(36), name: b.name, category: b.category, size: b.size || null, color: b.color || null,
    condition: b.condition || null, fit: b.fit || null,
    favorite: b.favorite === 'true' || b.favorite === true,
    remarks: b.remarks || null,
    measurements: wardrobeMeasurementsFromBody(b),
    aiScore: null, aiReason: null,
  });
  if (req.file) addPhoto(item, '/images/uploaded/' + sanitizeFolderName(user.name) + '/wardrobe/' + req.file.filename);
  user.fashion.wardrobe.push(item);
  saveData(data);
  res.json({ ok: true, item });

  const ai = aiClientFor(user);
  if (ai && !checkAiUsage(data, user)) {
    try {
      const { value, tokens } = await aiAnalyzeWardrobeItem(ai, item, user.profile);
      const fresh = loadData();
      const freshUser = findUser(fresh, user.name);
      const freshItem = freshUser.fashion.wardrobe.find(i => i.id === item.id);
      if (freshItem) {
        if (!freshItem.color) freshItem.color = value.color;
        if (!freshItem.condition) freshItem.condition = value.condition;
        freshItem.aiScore = Math.round(value.score * 10) / 10;
        freshItem.aiReason = value.comment;
      }
      recordAiUsage(freshUser, tokens, 'wardrobe-score');
      saveData(fresh);
    } catch (err) { /* scoring is best-effort; item stays without a score */ }
  }
});

app.put('/fashion/wardrobe/:id', wardrobeUpload.single('photo'), (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const item = user.fashion.wardrobe.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Item not found' });
  const b = req.body || {};
  if (b.name !== undefined) item.name = b.name;
  if (b.category !== undefined) item.category = b.category;
  if (b.size !== undefined) item.size = b.size || null;
  if (b.color !== undefined) item.color = b.color || null;
  if (b.condition !== undefined) item.condition = b.condition || null;
  if (b.fit !== undefined) item.fit = b.fit || null;
  if (b.favorite !== undefined) item.favorite = b.favorite === 'true' || b.favorite === true;
  if (b.remarks !== undefined) item.remarks = b.remarks || null;
  if (b.aiScore !== undefined) item.aiScore = b.aiScore === '' || b.aiScore === null ? null : Number(b.aiScore);
  item.measurements = wardrobeMeasurementsFromBody(b, item.measurements);
  if (req.file) addPhoto(item, '/images/uploaded/' + sanitizeFolderName(user.name) + '/wardrobe/' + req.file.filename);
  saveData(data);
  res.json({ ok: true, item });
});

app.post('/fashion/wardrobe/:id/photos', wardrobeUpload.single('photo'), (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const item = user.fashion.wardrobe.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Item not found' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'photo required' });
  const photo = addPhoto(item, '/images/uploaded/' + sanitizeFolderName(user.name) + '/wardrobe/' + req.file.filename);
  saveData(data);
  res.json({ ok: true, item, photo });
});

app.delete('/fashion/wardrobe/:id/photos/:photoId', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const item = user.fashion.wardrobe.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Item not found' });
  const removed = removePhoto(item, req.params.photoId);
  if (!removed) return res.status(404).json({ ok: false, error: 'Photo not found' });
  if (removed.url) { try { fs.unlinkSync(path.join(CLIENT_DIR, removed.url)); } catch (_) {} }
  saveData(data);
  res.json({ ok: true, item });
});

app.post('/fashion/wardrobe/:id/ai-fill', async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const item = user.fashion.wardrobe.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Item not found' });
  const ai = aiClientFor(user);
  if (!ai) return res.status(400).json({ ok: false, error: 'Add your API key in Settings first' });
  const usageError = checkAiUsage(data, user);
  if (usageError) return res.status(403).json({ ok: false, error: usageError });
  try {
    const { value, tokens } = await aiAnalyzeWardrobeItem(ai, item, user.profile);
    if (!item.color) item.color = value.color;
    if (!item.condition) item.condition = value.condition;
    item.aiScore = Math.round(value.score * 10) / 10;
    item.aiReason = value.comment;
    recordAiUsage(user, tokens, 'wardrobe-ai-fill');
    saveData(data);
    res.json({ ok: true, item });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'AI request failed: ' + err.message });
  }
});

app.get('/fashion/wardrobe/:id/score', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const item = user.fashion.wardrobe.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'Item not found' });
  res.json({ ok: true, aiScore: item.aiScore, aiReason: item.aiReason });
});

app.delete('/fashion/wardrobe/:id', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const item = user.fashion.wardrobe.find(i => i.id === req.params.id);
  if (item) for (const p of item.photos || []) { try { fs.unlinkSync(path.join(CLIENT_DIR, p.url)); } catch (_) {} }
  user.fashion.wardrobe = user.fashion.wardrobe.filter(i => i.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

app.get('/fashion/recommendations', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, ...buildFashionRecommendations(user), aiShoppingAdvice: user.fashion.aiShoppingAdvice });
});

// On-demand (not run on every page load, to avoid burning tokens per visit):
// analyzes existing outfits + wardrobe gaps and caches the advice.
app.post('/fashion/recommendations/ai-refresh', async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const ai = aiClientFor(user);
  if (!ai) return res.status(400).json({ ok: false, error: 'Add your API key in Settings first' });
  const usageError = checkAiUsage(data, user);
  if (usageError) return res.status(403).json({ ok: false, error: usageError });
  try {
    const outfits = user.fashion.outfits.map(o => ({ ...o, items: user.fashion.wardrobe.filter(i => o.itemIds.includes(i.id)) }));
    const { value, tokens } = await aiShoppingRecommendations(ai, user.fashion.wardrobe, outfits, user.profile);
    user.fashion.aiShoppingAdvice = { summary: value.summary, shoppingList: value.shoppingList, generatedAt: new Date().toISOString() };
    recordAiUsage(user, tokens, 'shopping-recommendations');
    saveData(data);
    res.json({ ok: true, aiShoppingAdvice: user.fashion.aiShoppingAdvice });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'AI request failed: ' + err.message });
  }
});

app.get('/fashion/size-guide', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, sizeGuide: sizeGuide(user.profile.measurements, user.settings.measurementUnits) });
});

app.post('/fashion/outfit-check', outfitCheckUpload.single('photo'), async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  if (!req.file) return res.status(400).json({ ok: false, error: 'Photo required' });
  const ai = aiClientFor(user);
  if (!ai) return res.status(400).json({ ok: false, error: 'Add your API key in Settings first' });
  const usageError = checkAiUsage(data, user);
  if (usageError) return res.status(403).json({ ok: false, error: usageError });
  try {
    const { value: feedback, tokens } = await aiOutfitCheck(ai, req.file.path, user.profile);
    const entry = { id: Date.now().toString(36), photo: '/images/uploaded/' + sanitizeFolderName(user.name) + '/outfit/' + req.file.filename, feedback, date: new Date().toISOString() };
    user.fashion.outfitChecks.push(entry);
    recordAiUsage(user, tokens, 'outfit-check');
    saveData(data);
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'AI request failed: ' + err.message });
  }
});

app.get('/fashion/outfit-checks', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  res.json({ ok: true, outfitChecks: user.fashion.outfitChecks });
});

app.delete('/fashion/outfit-checks/:id', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const entry = user.fashion.outfitChecks.find(c => c.id === req.params.id);
  if (entry && entry.photo) { try { fs.unlinkSync(path.join(CLIENT_DIR, entry.photo)); } catch (_) {} }
  user.fashion.outfitChecks = user.fashion.outfitChecks.filter(c => c.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

// Promotes an uploaded outfit-check photo into a saved Outfit: AI identifies
// each garment in the photo, links it to a matching wardrobe item if one
// exists (merge, no duplicate), or creates a new wardrobe item for it. The
// outfit-check entry is then removed — it becomes the Outfit, not a copy.
app.post('/fashion/outfit-checks/:id/promote', async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const check = user.fashion.outfitChecks.find(c => c.id === req.params.id);
  if (!check) return res.status(404).json({ ok: false, error: 'Outfit check not found' });
  const ai = aiClientFor(user);
  if (!ai) return res.status(400).json({ ok: false, error: 'Add your API key in Settings first' });
  const usageError = checkAiUsage(data, user);
  if (usageError) return res.status(403).json({ ok: false, error: usageError });
  try {
    const { value, tokens } = await aiLinkOutfitItems(ai, path.join(CLIENT_DIR, check.photo), user.fashion.wardrobe, user.profile);
    const itemIds = [];
    for (const g of value.garments) {
      let matched = g.id && user.fashion.wardrobe.find(i => i.id === g.id);
      if (!matched) {
        matched = Object.assign({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: g.name, category: g.category, size: null, color: g.color,
          aiScore: null, aiReason: null,
        }, defaultWardrobeItemFields());
        // Copy (not reuse) the check photo so this item and the outfit each own
        // an independent file — otherwise deleting one unlinks the other's photo.
        const wardrobeDir = path.join(IMAGES_DIR, 'uploaded', sanitizeFolderName(user.name), 'wardrobe');
        fs.mkdirSync(wardrobeDir, { recursive: true });
        const copyName = uploadFilename({ originalname: check.photo });
        fs.copyFileSync(path.join(CLIENT_DIR, check.photo), path.join(wardrobeDir, copyName));
        addPhoto(matched, '/images/uploaded/' + sanitizeFolderName(user.name) + '/wardrobe/' + copyName);
        user.fashion.wardrobe.push(matched);
      }
      if (!itemIds.includes(matched.id)) itemIds.push(matched.id);
    }
    const outfit = Object.assign(defaultOutfitFields(), {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      prompt: null, itemIds, reasoning: null,
      score: Math.round(value.score * 10) / 10, aiRemarks: value.comment,
      source: 'outfit-check', createdAt: new Date().toISOString(),
    });
    addPhoto(outfit, check.photo);
    user.fashion.outfits.push(outfit);
    user.fashion.outfitChecks = user.fashion.outfitChecks.filter(c => c.id !== check.id);
    recordAiUsage(user, tokens, 'promote-outfit-check');
    saveData(data);
    const items = user.fashion.wardrobe.filter(i => itemIds.includes(i.id));
    res.json({ ok: true, outfit: Object.assign({}, outfit, { items }) });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'AI request failed: ' + err.message });
  }
});

// "Generated outfits" (AI-picked) must be a genuinely wearable outfit — at
// least one top and one bottom. If the wardrobe can't supply both, refuse
// before even calling the AI rather than letting it return a partial outfit.
function hasTopAndBottom(wardrobe) {
  return wardrobe.some(i => i.category === 'top') && wardrobe.some(i => i.category === 'bottom');
}
const NEEDS_TOP_AND_BOTTOM_MESSAGE = 'Please upload a top and bottom to generate outfit.';

app.post('/fashion/generate-outfit', async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt required' });
  const ai = aiClientFor(user);
  if (!ai) return res.status(400).json({ ok: false, error: 'Add your API key in Settings first' });
  if (!hasTopAndBottom(user.fashion.wardrobe)) return res.status(400).json({ ok: false, error: NEEDS_TOP_AND_BOTTOM_MESSAGE });
  const usageError = checkAiUsage(data, user);
  if (usageError) return res.status(403).json({ ok: false, error: usageError });
  try {
    const { value, tokens } = await aiGenerateOutfit(ai, prompt, user.fashion.wardrobe, user.profile);
    const items = user.fashion.wardrobe.filter(i => value.itemIds.includes(i.id));
    const outfit = Object.assign(defaultOutfitFields(), { id: Date.now().toString(36), prompt, itemIds: items.map(i => i.id), reasoning: value.reasoning, score: Math.round(value.score * 10) / 10, createdAt: new Date().toISOString() });
    user.fashion.outfits.push(outfit);
    recordAiUsage(user, tokens, 'generate-outfit');
    saveData(data);
    res.json({ ok: true, outfit, items });
    generateAndAttachOutfitImage(user.name, outfit.id).catch(() => {});
  } catch (err) {
    res.status(502).json({ ok: false, error: 'AI request failed: ' + err.message });
  }
});

// Manual outfit builder: the client enforces top+bottom as required picks
// (shoes/accessories optional) via OUTFIT_BUILDER_SLOTS, but we re-validate
// server-side since this is the same "must be a full outfit" guarantee.
app.get('/fashion/outfit-builder-slots', (req, res) => res.json({ ok: true, slots: OUTFIT_BUILDER_SLOTS }));

app.post('/fashion/outfits/manual', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const itemIds = (req.body && Array.isArray(req.body.itemIds)) ? req.body.itemIds : [];
  const items = user.fashion.wardrobe.filter(i => itemIds.includes(i.id));
  if (!items.some(i => i.category === 'top') || !items.some(i => i.category === 'bottom')) {
    return res.status(400).json({ ok: false, error: NEEDS_TOP_AND_BOTTOM_MESSAGE });
  }
  const outfit = Object.assign(defaultOutfitFields(), {
    id: Date.now().toString(36), prompt: null, itemIds: items.map(i => i.id), reasoning: null,
    source: 'manual', createdAt: new Date().toISOString(),
  });
  user.fashion.outfits.push(outfit);
  saveData(data);
  res.json({ ok: true, outfit, items });
  generateAndAttachOutfitImage(user.name, outfit.id).catch(() => {});
});

app.get('/fashion/outfits', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const outfits = user.fashion.outfits.map(o => ({ ...o, items: user.fashion.wardrobe.filter(i => o.itemIds.includes(i.id)) }));
  res.json({ ok: true, outfits });
});

app.put('/fashion/outfits/:id', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const outfit = user.fashion.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ ok: false, error: 'Outfit not found' });
  const b = req.body || {};
  if (b.remarks !== undefined) outfit.remarks = b.remarks || null;
  if (b.score !== undefined) outfit.score = (b.score === null || b.score === '') ? null : Number(b.score);
  if (b.itemIds !== undefined) {
    if (!Array.isArray(b.itemIds)) return res.status(400).json({ ok: false, error: 'itemIds must be an array' });
    const valid = b.itemIds.filter(id => user.fashion.wardrobe.some(i => i.id === id));
    outfit.itemIds = valid;
  }
  saveData(data);
  res.json({ ok: true, outfit: Object.assign({}, outfit, { items: user.fashion.wardrobe.filter(i => outfit.itemIds.includes(i.id)) }) });
});

app.post('/fashion/outfits/:id/photos', outfitCheckUpload.single('photo'), (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const outfit = user.fashion.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ ok: false, error: 'Outfit not found' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'photo required' });
  const photo = addPhoto(outfit, '/images/uploaded/' + sanitizeFolderName(user.name) + '/outfit/' + req.file.filename);
  saveData(data);
  res.json({ ok: true, outfit: Object.assign({}, outfit, { items: user.fashion.wardrobe.filter(i => outfit.itemIds.includes(i.id)) }), photo });
});

app.delete('/fashion/outfits/:id/photos/:photoId', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const outfit = user.fashion.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ ok: false, error: 'Outfit not found' });
  const removed = removePhoto(outfit, req.params.photoId);
  if (!removed) return res.status(404).json({ ok: false, error: 'Photo not found' });
  if (removed.url) { try { fs.unlinkSync(path.join(CLIENT_DIR, removed.url)); } catch (_) {} }
  saveData(data);
  res.json({ ok: true, outfit: Object.assign({}, outfit, { items: user.fashion.wardrobe.filter(i => outfit.itemIds.includes(i.id)) }) });
});

// Manual (re)generate — unlike the best-effort auto-generation on creation,
// this surfaces the real error (e.g. "not configured") since it's user-initiated.
app.post('/fashion/outfits/:id/generate-image', async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const outfit = user.fashion.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ ok: false, error: 'Outfit not found' });
  if (!user.settings.imageGenProvider || !user.settings.imageGenApiKey) {
    return res.status(400).json({ ok: false, error: 'Configure an image generation provider (OpenAI or Gemini) in Settings first.' });
  }
  const result = await generateAndAttachOutfitImage(user.name, outfit.id);
  if (!result.ok) return res.status(502).json({ ok: false, error: 'Image generation failed: ' + result.error });
  const fresh = loadData();
  const freshUser = findUser(fresh, user.name);
  const freshOutfit = freshUser.fashion.outfits.find(o => o.id === outfit.id);
  res.json({ ok: true, outfit: Object.assign({}, freshOutfit, { items: freshUser.fashion.wardrobe.filter(i => freshOutfit.itemIds.includes(i.id)) }) });
});

app.post('/fashion/outfits/:id/ai-fill', async (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const outfit = user.fashion.outfits.find(o => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ ok: false, error: 'Outfit not found' });
  const ai = aiClientFor(user);
  if (!ai) return res.status(400).json({ ok: false, error: 'Add your API key in Settings first' });
  const usageError = checkAiUsage(data, user);
  if (usageError) return res.status(403).json({ ok: false, error: usageError });
  const items = user.fashion.wardrobe.filter(i => outfit.itemIds.includes(i.id));
  try {
    const { value, tokens } = await aiScoreOutfit(ai, items, user.profile);
    outfit.score = Math.round(value.score * 10) / 10;
    outfit.aiRemarks = value.comment;
    recordAiUsage(user, tokens, 'outfit-ai-fill');
    saveData(data);
    res.json({ ok: true, outfit: Object.assign({}, outfit, { items }) });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'AI request failed: ' + err.message });
  }
});

app.delete('/fashion/outfits/:id', (req, res) => {
  const data = loadData();
  const user = requireUser(req, res, data); if (!user) return;
  const outfit = user.fashion.outfits.find(o => o.id === req.params.id);
  if (outfit) for (const p of outfit.photos || []) { try { fs.unlinkSync(path.join(CLIENT_DIR, p.url)); } catch (_) {} }
  user.fashion.outfits = user.fashion.outfits.filter(o => o.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Fromesco server listening on :${PORT}`));
