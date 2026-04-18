const pad = (n) => String(n).padStart(2, "0");

export const fmtTime = (ms) => {
  if (ms < 0) ms = 0;
  return pad(Math.floor(ms / 60000)) + ":" + pad(Math.floor((ms % 60000) / 1000)) + "." + pad(Math.floor((ms % 1000) / 10));
};

export const fmtSplit = (ms) => {
  if (ms < 0) ms = 0;
  return ms < 60000 ? Math.floor(ms / 1000) + "." + pad(Math.floor((ms % 1000) / 10)) : fmtTime(ms);
};

export const STORAGE_KEY = "beacon_split_v6";

export const PRESET_DISTANCES = ["200m", "400m", "800m", "1200m", "1600m", "Half Mile", "1 Mile", "3K", "5K"];

export const DIST_METERS = {
  "200m": 200, "400m": 400, "800m": 800, "1200m": 1200, "1600m": 1600, "3200m": 3200,
  "Half Mile": 805, "1 Mile": 1609, "Quarter Mile": 402, "3K": 3000, "5K": 5000,
  "4x800": 3200, "800": 800, "1600": 1600, "3200": 3200,
};

export const EVENT_COLORS = { "800": "#F39C12", "1600": "#D4A017", "3200": "#27ae60", "4x800": "#a855f7" };

export const TEAM_COLORS = { boys: "#4a9eff", girls: "#ff7eb3" };

export const GROUP_COLORS = ["#FF5722", "#4a9eff", "#ff7eb3", "#27ae60", "#f0a500", "#a855f7", "#14b8a6", "#f43f5e", "#fb923c", "#84cc16"];

export const PACE_KEYS = [
  { k: "thrSafe", l: "LT Safe" },
  { k: "thrMed", l: "LT Med" },
  { k: "cv", l: "CV" },
  { k: "vo2Safe", l: "VO2 Safe" },
  { k: "vo2Med", l: "VO2 Med" },
];

export const EVT_ORDER = { "4x800": 0, "800": 1, "1600": 2, "3200": 3 };

export const getSplitsToFinish = (ev, sd, distOverride) => {
  const rd = distOverride || DIST_METERS[ev] || DIST_METERS[ev + "m"] || 0;
  const s = DIST_METERS[sd] || 0;
  if (!rd || !s || s >= rd) return 0;
  return Math.round(rd / s);
};

export const isRelayRace = (race) => race.event === "4x800" || !!race.relay;

/* Accepts "1:23.45", "1:23", "83.45", or "83" — returns ms or null. */
export const parseTimeStr = (str) => {
  const s = (str || "").trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length === 2) {
    const mm = parseInt(parts[0]);
    const rest = parts[1].split(".");
    const ss = parseInt(rest[0]) || 0;
    const cs = rest[1] ? parseInt((rest[1] + "00").slice(0, 2)) : 0;
    if (isNaN(mm)) return null;
    return mm * 60000 + ss * 1000 + cs * 10;
  }
  if (parts.length === 1) {
    const rest2 = s.split(".");
    const sec = parseInt(rest2[0]) || 0;
    const cs2 = rest2[1] ? parseInt((rest2[1] + "00").slice(0, 2)) : 0;
    return sec * 1000 + cs2 * 10;
  }
  return null;
};

export const THEMES = {
  dark: { name: "Dark", bg: "#07090e", card: "#0b0f18", border: "#1a2233", text: "#ffffff", muted: "#6a7a90", dim: "#1a2233", timerBg: "#050709", accent: "#FF5722", splitClr: "#7aff8a", timeClr: "#b0c4d8", oldSplit: "#90b8dd" },
  midnight: { name: "Midnight", bg: "#0a0e1a", card: "#0f1526", border: "#1e2d50", text: "#f0f2ff", muted: "#7888b8", dim: "#1e2d50", timerBg: "#080c16", accent: "#7B68EE", splitClr: "#99ccff", timeClr: "#b0bbdd", oldSplit: "#a0b8ee" },
  forest: { name: "Forest", bg: "#0a100e", card: "#0e1a14", border: "#1e3828", text: "#f0fff0", muted: "#5a9a68", dim: "#1e3828", timerBg: "#080e0c", accent: "#66BB6A", splitClr: "#b9f6ca", timeClr: "#90c8a0", oldSplit: "#a0d8b0" },
  ember: { name: "Ember", bg: "#1a0a0a", card: "#221010", border: "#3a1818", text: "#ffe8e0", muted: "#9a6060", dim: "#3a1818", timerBg: "#140808", accent: "#ff6b35", splitClr: "#ffab91", timeClr: "#d0a090", oldSplit: "#c09080" },
  ocean: { name: "Ocean", bg: "#0a1520", card: "#0e1c2c", border: "#1a3050", text: "#e0f0ff", muted: "#5588aa", dim: "#1a3050", timerBg: "#081420", accent: "#00bcd4", splitClr: "#80deea", timeClr: "#90b8d0", oldSplit: "#a0c8e0" },
  slate: { name: "Slate", bg: "#1e293b", card: "#273449", border: "#3d5060", text: "#f1f5f9", muted: "#8a9eb8", dim: "#3d5060", timerBg: "#1a2435", accent: "#f97316", splitClr: "#fdd835", timeClr: "#b0c4d8", oldSplit: "#c0d0e0" },
  light: { name: "Light", bg: "#f5f6f2", card: "#ffffff", border: "#bbb", text: "#111", muted: "#555", dim: "#e0e0e0", timerBg: "#eaeaea", accent: "#d84315", splitClr: "#1b5e20", timeClr: "#333", oldSplit: "#444" },
  outdoor: { name: "Outdoor", bg: "#ffffff", card: "#f8f8f4", border: "#999", text: "#000000", muted: "#444", dim: "#ddd", timerBg: "#f0f0ec", accent: "#d32f2f", splitClr: "#1a6b1a", timeClr: "#222", oldSplit: "#333" },
  cream: { name: "Cream", bg: "#fdf8f0", card: "#fff9f2", border: "#d4c4aa", text: "#2a2018", muted: "#8a7a60", dim: "#e8dcc8", timerBg: "#f4eee4", accent: "#c75000", splitClr: "#2e7d32", timeClr: "#4a3a28", oldSplit: "#5a4a38" },
  overcast: { name: "Overcast", bg: "#e8eaee", card: "#f0f2f5", border: "#b0b8c4", text: "#1a1e28", muted: "#6a7488", dim: "#d0d4dc", timerBg: "#dde0e6", accent: "#1565c0", splitClr: "#1b5e20", timeClr: "#2a3040", oldSplit: "#3a4050" },
  track: { name: "Track", bg: "#c23b22", card: "#d44a30", border: "#a03020", text: "#ffffff", muted: "#ffccbb", dim: "#a03020", timerBg: "#b03020", accent: "#ffffff", splitClr: "#ffff00", timeClr: "#ffe0d0", oldSplit: "#ffd0c0" },
};
