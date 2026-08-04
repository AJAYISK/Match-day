import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "./supabase.js";

/* ---------- DB row ⇄ app shape ---------- */
const rowToMatchBase = (r) => ({
  id: r.id,
  teamA: { name: r.team_a_name, color: r.team_a_color },
  teamB: { name: r.team_b_name, color: r.team_b_color },
  playersA: r.players_a || "",
  playersB: r.players_b || "",
  location: r.location,
  date: r.match_date,
  time: (r.match_time || "").slice(0, 5),
  status: r.status,
  published: r.published,
  createdBy: r.created_by,
  elapsed: r.elapsed_seconds,
  running: r.running,
  onBreak: r.on_break,
  breakRemaining: r.break_remaining,
  secondHalf: r.second_half,
  odds: { A: Number(r.odds_a), Draw: Number(r.odds_draw), B: Number(r.odds_b) },
  finalA: r.final_a,
  finalB: r.final_b,
  result: r.result,
  shootout: r.shootout,
  pensA: r.pens_a,
  pensB: r.pens_b,
  pensWinner: r.pens_winner,
  postponed: r.postponed,
  pauseReason: r.pause_reason,
  scorersA: r.scorers_a || "",
  scorersB: r.scorers_b || "",
  duration: r.duration_minutes || 90,
  liveA: r.live_a ?? 0,
  liveB: r.live_b ?? 0,
  badgeA: r.badge_a || "",
  badgeB: r.badge_b || "",
  cancelledAt: r.cancelled_at,
  streamUrl: r.stream_url || "",
  shares: r.shares ?? 0,
  timerStartedAt: r.timer_started_at,
  breakEndsAt: r.break_ends_at,
  awaitingSince: r.awaiting_since,
  shotsA: r.shots_a ?? 0,
  shotsB: r.shots_b ?? 0,
  shotsOnTargetA: r.shots_on_target_a ?? 0,
  shotsOnTargetB: r.shots_on_target_b ?? 0,
  cornersA: r.corners_a ?? 0,
  cornersB: r.corners_b ?? 0,
  foulsA: r.fouls_a ?? 0,
  foulsB: r.fouls_b ?? 0,
  offsidesA: r.offsides_a ?? 0,
  offsidesB: r.offsides_b ?? 0,
  possessionA: r.possession_a ?? 50,
});

/* Half-time prompt is a derived state, never stored */
const deriveHalfPrompt = (m) =>
  m.status === "Live" && !m.running && !m.onBreak && !m.secondHalf && m.elapsed >= ((m.duration || 90) * 30);

const rowToMatch = (r) => { const m = rowToMatchBase(r); m.halfPrompt = deriveHalfPrompt(m); return m; };

const matchToRow = (p) => {
  const out = {};
  if (p.date !== undefined) out.match_date = p.date;
  if (p.time !== undefined) out.match_time = p.time;
  if (p.status !== undefined) out.status = p.status;
  if (p.published !== undefined) out.published = p.published;
  if (p.elapsed !== undefined) out.elapsed_seconds = p.elapsed;
  if (p.running !== undefined) out.running = p.running;
  if (p.onBreak !== undefined) out.on_break = p.onBreak;
  if (p.breakRemaining !== undefined) out.break_remaining = p.breakRemaining;
  if (p.secondHalf !== undefined) out.second_half = p.secondHalf;
  if (p.odds !== undefined) { out.odds_a = p.odds.A; out.odds_draw = p.odds.Draw; out.odds_b = p.odds.B; }
  if (p.postponed !== undefined) out.postponed = p.postponed;
  if (p.pauseReason !== undefined) out.pause_reason = p.pauseReason;
  if (p.liveA !== undefined) out.live_a = p.liveA;
  if (p.liveB !== undefined) out.live_b = p.liveB;
  if (p.cancelledAt !== undefined) out.cancelled_at = p.cancelledAt;
  if (p.streamUrl !== undefined) out.stream_url = p.streamUrl;
  if (p.timerStartedAt !== undefined) out.timer_started_at = p.timerStartedAt;
  if (p.breakEndsAt !== undefined) out.break_ends_at = p.breakEndsAt;
  if (p.awaitingSince !== undefined) out.awaiting_since = p.awaitingSince;
  if (p.shotsA !== undefined) out.shots_a = p.shotsA;
  if (p.shotsB !== undefined) out.shots_b = p.shotsB;
  if (p.shotsOnTargetA !== undefined) out.shots_on_target_a = p.shotsOnTargetA;
  if (p.shotsOnTargetB !== undefined) out.shots_on_target_b = p.shotsOnTargetB;
  if (p.cornersA !== undefined) out.corners_a = p.cornersA;
  if (p.cornersB !== undefined) out.corners_b = p.cornersB;
  if (p.foulsA !== undefined) out.fouls_a = p.foulsA;
  if (p.foulsB !== undefined) out.fouls_b = p.foulsB;
  if (p.offsidesA !== undefined) out.offsides_a = p.offsidesA;
  if (p.offsidesB !== undefined) out.offsides_b = p.offsidesB;
  if (p.possessionA !== undefined) out.possession_a = p.possessionA;
  return out;
};

/* ============================================================
   AREA MATCH — Community Football Website
   Flow: Captain creates → starts 90-min timer → at FULL TIME the
   site REQUESTS the final score from the captain → captain submits
   → result is published to the News Feed
   based on the captain's submitted score.
   Roles: Captain / Fan / Admin.
   Demo OTP is always 1234.
   ============================================================ */

const T = {
  turf: "#14532D",
  turfDeep: "#0D3A1F",
  floodlight: "#E6B31E",
  chalk: "#F5F0E1",
  night: "#0C120E",
  live: "#E8442E",
  muted: "#8FA396",
};

/* ---------- DAY / NIGHT PALETTES ----------
   Two complete palettes keyed by the same names, so a screen written against
   these tokens works in both modes. Day mode isn't "night inverted" — gold goes
   muddy on white, so the accent becomes deep green, and red darkens so it
   doesn't vibrate. Built for direct sunlight at the pitch, where a bright
   screen has far less for glare to wash out. */
const PALETTES = {
  night: {
    bg: "#0A0D0A",           // page background
    surface: "#0E140F",      // cards and panels
    surfaceAlt: "#141c16",   // crest wells, insets
    line: "#243128",         // visible dividers
    lineSoft: "#151c16",     // hairline dividers
    text: "#F5F0E1",         // primary text
    textStrong: "#F7F4EA",   // headings
    textDim: "#B9C7BC",      // secondary text
    textFaint: "#7d8f83",    // tertiary
    textGhost: "#4e5c53",    // labels
    accent: "#E6B31E",       // primary accent
    accentSoft: "#D6A81D",   // accent on quieter elements
    onAccent: "#12160f",     // text on an accent-filled button
    accentInk: "#12160f",    // alias used by the stylesheet
    textMuted: "#8FA396",    // nav and secondary UI text
    liveInk: "#ffffff",      // text on a live-red fill
    live: "#E8442E",
    liveText: "#e8776a",
    win: "#5fcf87", winBg: "rgba(63,163,91,.16)", winLine: "rgba(63,163,91,.3)",
    draw: "#93a099", drawBg: "rgba(140,150,145,.14)", drawLine: "rgba(140,150,145,.25)",
    loss: "#e08a7d", lossBg: "rgba(198,80,63,.14)", lossLine: "rgba(198,80,63,.28)",
    crest: "#14532D",
  },
  day: {
    bg: "#FBFAF5",
    surface: "#FFFFFF",
    surfaceAlt: "#F1EFE4",
    line: "#ddd8c8",
    lineSoft: "#e6e1d2",
    text: "#0d1a12",
    textStrong: "#0a140e",
    textDim: "#3d4a42",
    textFaint: "#4a5a50",
    textGhost: "#6b7a70",
    accent: "#0f5c2e",
    accentSoft: "#0d7a3a",
    onAccent: "#FFFFFF",
    accentInk: "#FFFFFF",
    textMuted: "#4a5a50",
    liveInk: "#ffffff",
    live: "#B8121B",
    liveText: "#B8121B",
    win: "#0d6b33", winBg: "rgba(13,107,51,.12)", winLine: "rgba(13,107,51,.35)",
    draw: "#5a6a60", drawBg: "rgba(90,106,96,.10)", drawLine: "rgba(90,106,96,.3)",
    loss: "#a01620", lossBg: "rgba(160,22,32,.10)", lossLine: "rgba(160,22,32,.3)",
    crest: "#0f5c2e",
  },
};

/* ---------- DAY / NIGHT PALETTES ----------
   Night is what the app has always been. Day is built for direct sunlight at the
   pitch: a near-white surface leaves glare far less to wash out, and the accent
   moves from gold to deep green because gold goes muddy on white.
   Keys are shared, so a screen written against these swaps cleanly. */

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@400;500;700&display=swap');`;
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- SECURITY ---------- */
// Strict email format check (RFC-style practical pattern)
const isValidEmail = (v) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v.trim());
// Strip characters used in injection/XSS attempts, cap length
const sanitizeText = (v, max = 60) => v.replace(/[<>\\{}$`]/g, "").slice(0, max);
const isStrongPassword = (v) => /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,64}$/.test(v);
const MAX_OTP_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

const NG_STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara","FCT Abuja"];

/* Captured at the very first moment the code runs — before the auth
   client processes (and removes) the reset link's URL marker */
const RECOVERY_LANDING = typeof window !== "undefined" && (window.location.hash || "").includes("type=recovery");

const fmtDate = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  catch { return d; }
};

/* ---------- LIVE STREAM helpers ---------- */
const STREAM_DOMAINS = ["facebook.com", "fb.watch", "youtube.com", "youtu.be"];
const isValidStreamUrl = (v) => {
  try {
    const u = new URL(v.startsWith("http") ? v : `https://${v}`);
    return STREAM_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith("." + d));
  } catch { return false; }
};
const normalizeStreamUrl = (v) => (v.startsWith("http") ? v : `https://${v}`).slice(0, 300);
const youtubeEmbedId = (v) => {
  try {
    const u = new URL(v);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0];
    if (u.hostname.includes("youtube.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "live" || parts[0] === "embed") return parts[1] || null;
    }
    return null;
  } catch { return null; }
};

const fmtDay = (d) => {
  try { return new Date(d + "T00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  catch { return d; }
};

/* Jersey vector badges — same 12 choices as before, now consistent line-icon crests
   instead of platform-dependent emoji. Old matches saved with an emoji still resolve fine. */
const BADGES = ["ball", "lion", "eagle", "shield", "star", "fire", "leopard", "scorpion", "crown", "rocket", "bolt", "elephant"];

/* Six standard 11-a-side formations. Each slot has a label (position code, unique per formation)
   and x/y as percentages of the pitch — GK always deepest, attackers always furthest forward. */
/* Award types a captain can give — icon + label + a medal color used consistently across the UI and artwork */
const AWARD_TYPES = {
  motm: { label: "Man of the Match", icon: "⭐", medal: "#E6B31E", art: "motm" },
  golden_boot: { label: "Golden Boot", icon: "🥇", medal: "#E6B31E", art: "boot" },
  golden_glove: { label: "Golden Glove", icon: "🧤", medal: "#E6B31E", art: "glove" },
  golden_ball: { label: "Golden Ball", icon: "🏆", medal: "#E6B31E", art: "ball" },
  best_defender: { label: "Best Defender", icon: "🛡", medal: "#8FA396", art: "shield" },
  playmaker: { label: "Playmaker", icon: "🎯", medal: "#3FA35B", art: "playmaker" },
  best_young: { label: "Best Young Player", icon: "🌟", medal: "#E6B31E", art: "young" },
  fair_play: { label: "Fair Play Award", icon: "🤝", medal: "#8FA396", art: "fairplay" },
  most_improved: { label: "Most Improved", icon: "📈", medal: "#1DB954", art: "motm" },
  team_player: { label: "Team Player", icon: "🤝", medal: "#8FA396", art: "fairplay" },
};

/* Trophy illustrations — original flat-vector artwork with metallic gradients.
   Rendered at any size; used in award lists, the squad picker, and the award card. */
function TrophyIcon({ art, size = 24 }) {
  const gid = `tg-${art}-${size}`;
  const G = (
    <defs>
      <linearGradient id={`${gid}-d`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FDE9A8" /><stop offset="35%" stopColor="#E6B31E" /><stop offset="70%" stopColor="#9c7412" /><stop offset="100%" stopColor="#5e4409" />
      </linearGradient>
      <linearGradient id={`${gid}-v`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FDE9A8" /><stop offset="50%" stopColor="#E6B31E" /><stop offset="100%" stopColor="#8a6d1a" />
      </linearGradient>
      <radialGradient id={`${gid}-r`} cx="35%" cy="30%" r="70%">
        <stop offset="0%" stopColor="#FDE9A8" /><stop offset="45%" stopColor="#E6B31E" /><stop offset="100%" stopColor="#6b4f0c" />
      </radialGradient>
    </defs>
  );
  const shapes = {
    boot: (<>
      <path d="M22 78 C20 68 22 60 30 55 L34 40 C35 32 42 26 52 27 L64 30 C72 32 76 40 75 48 L74 60 C82 62 86 68 85 75 C85 79 82 80 78 80 L28 80 C24 80 22 80 22 78 Z" fill={`url(#${gid}-d)`} stroke="#4a3608" strokeWidth="1.5" />
      <path d="M55 34 L60 39 M62 37 L67 42 M69 40 L74 45" stroke="#4a3608" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="38" cy="42" rx="6" ry="4" fill="#FDE9A8" opacity="0.7" />
    </>),
    glove: (<>
      <path d="M38 88 L38 74 L62 74 L62 88 Z" fill="#3a2c08" />
      <path d="M30 40 C28 26 38 15 50 15 C62 15 71 26 70 40 L70 58 C70 66 65 70 58 70 L42 70 C35 70 30 66 30 58 Z" fill={`url(#${gid}-d)`} stroke="#4a3608" strokeWidth="1.5" />
      <path d="M38 20 L38 55 M46 16 L46 58 M54 16 L54 58 M62 20 L62 55" stroke="#4a3608" strokeWidth="2.2" strokeLinecap="round" />
    </>),
    ball: (<>
      <rect x="40" y="66" width="20" height="8" fill="#8a6d1a" />
      <path d="M28 74 L72 74 L66 82 L34 82 Z" fill="#5e4409" />
      <circle cx="50" cy="42" r="28" fill={`url(#${gid}-r)`} stroke="#4a3608" strokeWidth="1.5" />
      <path d="M50 22 L58 30 L55 40 L45 40 L42 30 Z" fill="#4a3608" opacity="0.55" />
      <ellipse cx="40" cy="30" rx="7" ry="5" fill="#FDE9A8" opacity="0.7" />
    </>),
    motm: (<>
      <rect x="42" y="66" width="16" height="16" fill="#5e4409" />
      <rect x="30" y="82" width="40" height="6" rx="2" fill="#3a2c08" />
      <path d="M50 16 L59 40 L84 42 L64 57 L71 81 L50 67 L29 81 L36 57 L16 42 L41 40 Z" fill={`url(#${gid}-v)`} stroke="#4a3608" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M50 16 L54 30 L50 40 L46 30 Z" fill="#FDE9A8" opacity="0.55" />
    </>),
    young: (<>
      <circle cx="50" cy="30" r="13" fill={`url(#${gid}-v)`} stroke="#4a3608" strokeWidth="1.5" />
      <path d="M28 78 C28 55 36 46 50 46 C64 46 72 55 72 78 Z" fill={`url(#${gid}-v)`} stroke="#4a3608" strokeWidth="1.5" />
      <path d="M50 8 L53 15 L50 22 L47 15 Z" fill="#FDE9A8" />
      <path d="M28 22 L34 26 M72 22 L66 26" stroke="#E6B31E" strokeWidth="2.5" strokeLinecap="round" />
    </>),
    fairplay: (<>
      <path d="M18 52 C22 44 30 44 36 50 L46 50 L58 38 C61 35 66 35 68 39 C70 42 69 45 67 47 L58 56" fill="none" stroke={`url(#${gid}-v)`} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M82 48 C78 40 70 40 64 46 L54 46 L42 34 C39 31 34 31 32 35 C30 38 31 41 33 43 L42 52" fill="none" stroke={`url(#${gid}-v)`} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="30" cy="47" r="4.5" fill="#E6B31E" /><circle cx="70" cy="47" r="4.5" fill="#E6B31E" />
    </>),
    shield: (<>
      <path d="M50 12 C62 20 74 22 74 22 L74 48 C74 68 62 80 50 88 C38 80 26 68 26 48 L26 22 C26 22 38 20 50 12 Z" fill={`url(#${gid}-v)`} stroke="#4a3608" strokeWidth="1.5" />
      <path d="M40 48 L47 56 L62 38" fill="none" stroke="#4a3608" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 12 C56 16 62 19 68 20 L68 24 L50 16Z" fill="#FDE9A8" opacity="0.6" />
    </>),
    playmaker: (<>
      <circle cx="50" cy="50" r="34" fill="none" stroke="#3a4a3e" strokeWidth="1.5" strokeDasharray="3 4" />
      <path d="M50 50 L26 30 M50 50 L74 30 M50 50 L22 60 M50 50 L78 60 M50 50 L50 80" stroke={`url(#${gid}-v)`} strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="50" r="9" fill={`url(#${gid}-v)`} stroke="#4a3608" strokeWidth="1.5" />
      <circle cx="26" cy="30" r="5" fill="#3FA35B" /><circle cx="74" cy="30" r="5" fill="#3FA35B" />
      <circle cx="22" cy="60" r="5" fill="#3FA35B" /><circle cx="78" cy="60" r="5" fill="#3FA35B" /><circle cx="50" cy="80" r="5" fill="#3FA35B" />
    </>),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
      {G}
      {shapes[art] || shapes.motm}
    </svg>
  );
}

const FORMATIONS = {
  "4-4-2": [
    { key: "GK", x: 50, y: 92 },
    { key: "LB", x: 15, y: 75 }, { key: "CB1", x: 38, y: 78 }, { key: "CB2", x: 62, y: 78 }, { key: "RB", x: 85, y: 75 },
    { key: "LM", x: 15, y: 50 }, { key: "CM1", x: 38, y: 52 }, { key: "CM2", x: 62, y: 52 }, { key: "RM", x: 85, y: 50 },
    { key: "ST1", x: 35, y: 22 }, { key: "ST2", x: 65, y: 22 },
  ],
  "4-3-3": [
    { key: "GK", x: 50, y: 92 },
    { key: "LB", x: 15, y: 75 }, { key: "CB1", x: 38, y: 78 }, { key: "CB2", x: 62, y: 78 }, { key: "RB", x: 85, y: 75 },
    { key: "CM1", x: 28, y: 55 }, { key: "CDM", x: 50, y: 60 }, { key: "CM2", x: 72, y: 55 },
    { key: "LW", x: 18, y: 24 }, { key: "ST", x: 50, y: 18 }, { key: "RW", x: 82, y: 24 },
  ],
  "3-5-2": [
    { key: "GK", x: 50, y: 92 },
    { key: "CB1", x: 28, y: 78 }, { key: "CB2", x: 50, y: 80 }, { key: "CB3", x: 72, y: 78 },
    { key: "LM", x: 10, y: 52 }, { key: "CM1", x: 33, y: 56 }, { key: "CDM", x: 50, y: 62 }, { key: "CM2", x: 67, y: 56 }, { key: "RM", x: 90, y: 52 },
    { key: "ST1", x: 38, y: 20 }, { key: "ST2", x: 62, y: 20 },
  ],
  "4-2-3-1": [
    { key: "GK", x: 50, y: 92 },
    { key: "LB", x: 15, y: 75 }, { key: "CB1", x: 38, y: 78 }, { key: "CB2", x: 62, y: 78 }, { key: "RB", x: 85, y: 75 },
    { key: "CDM1", x: 38, y: 60 }, { key: "CDM2", x: 62, y: 60 },
    { key: "LW", x: 18, y: 36 }, { key: "CAM", x: 50, y: 34 }, { key: "RW", x: 82, y: 36 },
    { key: "ST", x: 50, y: 15 },
  ],
  "5-3-2": [
    { key: "GK", x: 50, y: 92 },
    { key: "LWB", x: 8, y: 68 }, { key: "CB1", x: 28, y: 78 }, { key: "CB2", x: 50, y: 80 }, { key: "CB3", x: 72, y: 78 }, { key: "RWB", x: 92, y: 68 },
    { key: "CM1", x: 30, y: 52 }, { key: "CM2", x: 50, y: 56 }, { key: "CM3", x: 70, y: 52 },
    { key: "ST1", x: 38, y: 20 }, { key: "ST2", x: 62, y: 20 },
  ],
  "3-4-3": [
    { key: "GK", x: 50, y: 92 },
    { key: "CB1", x: 28, y: 78 }, { key: "CB2", x: 50, y: 80 }, { key: "CB3", x: 72, y: 78 },
    { key: "LM", x: 12, y: 52 }, { key: "CM1", x: 38, y: 56 }, { key: "CM2", x: 62, y: 56 }, { key: "RM", x: 88, y: 52 },
    { key: "LW", x: 18, y: 22 }, { key: "ST", x: 50, y: 16 }, { key: "RW", x: 82, y: 22 },
  ],
};
const LEGACY_BADGE_MAP = { "⚽": "ball", "🦁": "lion", "🦅": "eagle", "🛡️": "shield", "⭐": "star", "🔥": "fire", "🐆": "leopard", "🦂": "scorpion", "👑": "crown", "🚀": "rocket", "⚡": "bolt", "🐘": "elephant" };
const resolveBadgeIcon = (b) => (b && BADGES.includes(b)) ? b : (b && LEGACY_BADGE_MAP[b]) || null;
const BADGE_ICON_SCALE = { ball: 1.1, lion: 1.15, eagle: 1.3, shield: 1.2, star: 1.25, fire: 1.2, leopard: 1.15, scorpion: 1.2, crown: 1.2, rocket: 1.2, bolt: 1.3, elephant: 1.15 };
function BadgeIconPaths({ name }) {
  switch (name) {
    case "ball": return (<g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="0" cy="0" r="8.5" /><path d="M0 -4l3 2-1 3.5h-4l-1-3.5z" fill="#fff" stroke="none" />
      <path d="M0-8v4M0 4.5v4M-7.2-3.7l3.7 1.3M4.5-1.4l3.7-1.3M-6 5l3-3.5M6 5l-3-3.5" /></g>);
    case "lion": return (<g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0-8.5c1.8 1.8 2.6 3 2.6 5 0 2-1.1 3-2.6 3s-2.6-1-2.6-3c0-2 .8-3.2 2.6-5Z" transform="translate(0 -0.5)" />
      <path d="M-6.5 9c.6-4.3 2.2-6.3 6.5-6.3s5.9 2 6.5 6.3" /></g>);
    case "eagle": return (<g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0-9-6-2.5l3 1-2 3.2 4-.9-1 4.2 2-1.6 2 1.6-1-4.2 4 .9-2-3.2 3-1z" /></g>);
    case "shield": return (<g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0-8.5 6-6v5.5c0 4-2.6 6.7-6 8-3.4-1.3-6-4-6-8V-6z" /><path d="M-2.8 0 -0.8 2 2.8-2" /></g>);
    case "star": return (<g fill="#fff" stroke="none"><path d="M0-8.8 2.5-2.5 9-2l-5 4 1.6 6.5L0 5l-5.6 3.5L-4-2l-5-4 6.5-.5z" /></g>);
    case "fire": return (<g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 9c-3.3 0-5.7-2.2-5.7-5.4 0-2 1-3.3 1-3.3s.3 1.6 1.5 2.2c-.4-2-.1-4.3 2-6.5.3 1.6 1 2.6 2 3.4 1.4 1.1 2.9 2.3 2.9 4.6C3.7 7 3.3 9 0 9Z" /></g>);
    case "leopard": return (<g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-8 1c1-4 4-8 8-8s7 4 8 8" />
      <circle cx="-5" cy="0" r=".6" fill="#fff" stroke="none" /><circle cx="-1.5" cy="-1.5" r=".6" fill="#fff" stroke="none" />
      <circle cx="2" cy="-2" r=".6" fill="#fff" stroke="none" /><circle cx="5.5" cy="-0.5" r=".6" fill="#fff" stroke="none" />
      <path d="M-6 6l2-4M6 6l-2-4" /></g>);
    case "scorpion": return (<g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-3-6c-2 0-3.5 1.6-3.5 3.6 0 1.6 1 2.4 2 3-1 .3-2 1.2-2 2.6 0 1.6 1.3 2.6 2.8 2.6" />
      <path d="M3-6c2 0 3.5 1.6 3.5 3.6 0 1.6-1 2.4-2 3 1 .3 2 1.2 2 2.6 0 1.6-1.3 2.6-2.8 2.6" />
      <path d="M-3.5 5.8-6 11M3.5 5.8 6 11" /><circle cx="0" cy="0" r="2.4" /></g>);
    case "crown": return (<g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-7-3 -4.5-1 0-6l4.5 5L7-3l-1.5 8h-11z" /><path d="M-5.5 8h11" /></g>);
    case "rocket": return (<g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0-9c2.5 2 3.5 5 3.5 8.5 0 2-.5 3.6-1 4.8h-5c-.5-1.2-1-2.8-1-4.8C-3.5-4-2.5-7 0-9Z" />
      <path d="M-3.5 4.5-6.5 7l1.3 1M3.5 4.5l3 2.5-1.3 1" /><path d="M-1.7 7.3-3 12l3-1.5 3 1.5-1.3-4.7" /></g>);
    case "bolt": return (<g fill="#fff" stroke="none"><path d="M1-9-7 2.5h5.2L-2 10l9-12.5h-5.5z" /></g>);
    case "elephant": return (<g fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-2.5-3.5c-1.5-1.8-3.5-1.6-4.5 0-1 1.7.2 3 1.5 3.3" />
      <path d="M-5.7-.4C-7 .8-7.5 2.6-7 5c.4 2 2 3 4 3h6c2 0 3.6-1 4-3 .5-2.4 0-4.2-1.3-5.4" />
      <ellipse cx="1.5" cy="0" rx="5" ry="4.3" /></g>);
    default: return null;
  }
}


/* ---------- STATE PICKER — one component behind every state selector.
   Replaces the native <select>, whose dropdown is drawn by the OS and so can't
   be styled. Shows match counts where they're supplied, and a search box because
   37 states is too many to scroll comfortably. ---------- */
function StatePicker({ value, onChange, counts = null, allLabel = "All states", label = "Showing", disabled = false, placeholder = "Select your state…" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const options = allLabel ? ["All"].concat(NG_STATES) : NG_STATES;
  const shown = options.filter((st) => {
    if (!q.trim()) return true;
    const name = st === "All" ? allLabel : st;
    return name.toLowerCase().includes(q.trim().toLowerCase());
  });
  const display = value === "All" ? allLabel : (value || placeholder);
  const isPlaceholder = !value && !allLabel;

  const close = () => { setOpen(false); setQ(""); };

  return (
    <>
      <button type="button" disabled={disabled} onClick={() => !disabled && setOpen(true)}
        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", fontFamily: "inherit",
          background: "#131a15", border: "1px solid #2A3A2E", borderRadius: 10, padding: "9px 12px",
          opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(230,179,30,.12)", border: "1px solid rgba(230,179,30,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>📍</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 8, letterSpacing: "1.2px", textTransform: "uppercase", color: "#5a6a5f", fontWeight: 700 }}>{label}</span>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: isPlaceholder ? "#5a6a5f" : "#F5F0E1", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
        </span>
        <span style={{ color: "#8FA396", fontSize: 10, flexShrink: 0 }}>⌄</span>
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 96 }} />
          <div style={{ position: "fixed", left: 12, right: 12, bottom: 12, maxWidth: 430, margin: "0 auto", height: "62vh", display: "flex", flexDirection: "column", background: "#0E140F", border: "1px solid #243128", borderRadius: 14, overflow: "hidden", zIndex: 97, boxShadow: "0 -10px 30px rgba(0,0,0,.5)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 13px", borderBottom: "1px solid #1b241c", flexShrink: 0 }}>
              <div style={{ fontSize: 9.5, letterSpacing: "1.4px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700 }}>
                {allLabel ? "Filter by state" : "Select your state"}
              </div>
              <button type="button" onClick={close} style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 11, color: "#D6A81D", cursor: "pointer", fontWeight: 600, padding: 0 }}>Done</button>
            </div>

            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search states…"
              style={{ margin: "10px 13px", background: "#131a15", border: "1px solid #243128", borderRadius: 8, padding: "9px 11px", fontSize: 12, color: "#F5F0E1", fontFamily: "inherit", outline: "none", flexShrink: 0 }} />

            <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
              {shown.length === 0 && (
                <div style={{ padding: "22px 14px", textAlign: "center", fontSize: 11.5, color: "#5a6a5f" }}>No state matches "{q}"</div>
              )}
              {shown.map((st, i) => {
                const active = value === st;
                const n = counts && st !== "All" ? (counts[st] || 0) : null;
                return (
                  <button type="button" key={st} className="tappable"
                    onClick={() => { onChange(st); close(); }}
                    style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", fontFamily: "inherit", cursor: "pointer",
                      padding: "10px 13px", border: 0, borderBottom: i < shown.length - 1 ? "1px solid #121a14" : "none",
                      background: active ? "rgba(230,179,30,.07)" : "transparent",
                      color: active ? "#F7F4EA" : "#EDEAE0", fontSize: 12, fontWeight: active ? 600 : 400 }}>
                    <span style={{ fontSize: 11 }}>{st === "All" ? "🌍" : "📍"}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {st === "All" ? allLabel : st}
                    </span>
                    {n !== null && n > 0 && <span style={{ fontSize: 9.5, color: "#4e5c53", flexShrink: 0 }}>{n}</span>}
                    {active && <span style={{ color: "#E6B31E", fontSize: 11, flexShrink: 0 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function App() {
  const [screen, setScreen] = useState("auth");
  const screenRef = useRef("auth");
  useEffect(() => { screenRef.current = screen; }, [screen]);
  const recoveryPending = useRef(RECOVERY_LANDING);
  /* Strict mode: leaving the reset screen without saving signs the
     link's session out — no password change, no entry */
  useEffect(() => {
    if (!RECOVERY_LANDING) return;
    const bail = () => {
      if (recoveryPending.current) supabase.auth.signOut();
    };
    window.addEventListener("pagehide", bail);
    return () => window.removeEventListener("pagehide", bail);
  }, []);
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [authStep, setAuthStep] = useState("form");
  const [authMode, setAuthMode] = useState("signup");
  const [form, setForm] = useState({ contact: "", name: "", role: "Fan", otp: "", password: "", password2: "", state: "" });
  const [rememberMe, setRememberMe] = useState(true);
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [users, setUsers] = useState([]);
  const [me, setMe] = useState(null);
  const [matches, setMatches] = useState([]);
  const [page, setPage] = useState("feed"); // feed | mymatches | create | live | admin
  const [openMatch, setOpenMatch] = useState(null);
  /* ---------- REAL PAGE NAVIGATION — match detail / live view / team profile now
     behave like actual pages with working back button/gesture, not popups.
     closeStackRef holds a "how to close whatever's on top" function per depth;
     the browser's own history handles the back button (including Android's
     native back gesture inside the installed app) via the popstate listener. ---------- */
  const closeStackRef = useRef([]);
  const pushCloseable = (closeFn) => {
    closeStackRef.current.push(closeFn);
    window.history.pushState({ __sheetDepth: closeStackRef.current.length }, "");
  };
  useEffect(() => {
    const onPop = () => {
      const fn = closeStackRef.current.pop();
      if (fn) fn();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const goBackPage = () => {
    if (closeStackRef.current.length > 0) window.history.back();
  };
  const openMatchDetail = (id) => { setOpenMatch(id); pushCloseable(() => setOpenMatch(null)); };
  const openLiveDetail = (id) => { setLiveDetailFor(id); pushCloseable(() => setLiveDetailFor(null)); };
  const openTeamProfile = (id) => { setViewTeamId(id); pushCloseable(() => setViewTeamId(null)); };
  const openPlayerProfile = (id) => { setViewPlayerId(id); pushCloseable(() => setViewPlayerId(null)); };
  const [liveDetailFor, setLiveDetailFor] = useState(null); // matchId shown in the 🔴 Live pitch view
  const [liveTimeline, setLiveTimeline] = useState([]);     // fresh per-match events for that view
  const [goalAlertIds, setGoalAlertIds] = useState([]);     // matchIds the fan opted into goal alerts for
  const goalAlertIdsRef = useRef([]);
  useEffect(() => { goalAlertIdsRef.current = goalAlertIds; }, [goalAlertIds]);
  const [viewCaptain, setViewCaptain] = useState(null);
  /* Remembers which page opened the captain profile, so "back" returns where you came
     from rather than always dumping you in the captains directory. */
  const [captainCameFrom, setCaptainCameFrom] = useState(null);
  const [captainTab, setCaptainTab] = useState("overview");
  const [capStateFilter, setCapStateFilter] = useState("All");
  const [comingSoon, setComingSoon] = useState(null); // feature name or null
  const [feedbacks, setFeedbacks] = useState([]);
  const [savedTeams, setSavedTeams] = useState([]);
  const [teamRequests, setTeamRequests] = useState([]);
  const [teamSupporters, setTeamSupporters] = useState([]); // { fanId, teamId }
  const [playerAwards, setPlayerAwards] = useState([]);
  const [teamSearch, setTeamSearch] = useState("");
  const [myProfileTab, setMyProfileTab] = useState("overview");
  const [showLeaderboards, setShowLeaderboards] = useState(false);
  const [showFixtures, setShowFixtures] = useState(false);
  const [fixState, setFixState] = useState("All");
  const [lbTab, setLbTab] = useState("scorers");
  const [dreamTeamInput, setDreamTeamInput] = useState("");
  const [dreamTeamSlide, setDreamTeamSlide] = useState(0);
  const dreamTeamTouchX = useRef(0);
  const [playerCardFor, setPlayerCardFor] = useState(null);
  const [follows, setFollows] = useState([]); // captain ids I follow
  const [adminPosts, setAdminPosts] = useState([]);
  const [adminPostText, setAdminPostText] = useState("");
  const [onlineCount, setOnlineCount] = useState(1);
  const [followerCounts, setFollowerCounts] = useState({});
  const [events, setEvents] = useState([]); // live ticker
  const [myLikes, setMyLikes] = useState([]);
  const [likeCounts, setLikeCounts] = useState({});
  const [requests, setRequests] = useState([]); // match change requests
  const [adminSection, setAdminSection] = useState("newsfeed");
  const [adminViewUser, setAdminViewUser] = useState(null);
  const [supportLink, setSupportLink] = useState("");
  const [annes, setAnnes] = useState([]);
  const [annDraft, setAnnDraft] = useState("");
  const [supportDraft, setSupportDraft] = useState("");
  const [feedState, setFeedState] = useState("All");
  const [feedFollowedOnly, setFeedFollowedOnly] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const [liveStateFilter, setLiveStateFilter] = useState("All");
  const [liveFollowedOnly, setLiveFollowedOnly] = useState(false);
  const [seeMore, setSeeMore] = useState({});
  const [pwaPromptOpen, setPwaPromptOpen] = useState(false);
  /* Notification bell. Read state is persisted per item id, so "mark all read"
     survives a reload and dismissed items don't come back on the next render. */
  const [bellOpen, setBellOpen] = useState(false);
  const [readIds, setReadIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("am-read") || "[]"); } catch (e) { return []; }
  });
  const markRequestsSeen = async (ids) => {
    const reqIds = ids.filter((i) => i.startsWith("rr-")).map((i) => i.slice(3));
    if (reqIds.length === 0) return;
    const stamp = new Date().toISOString();
    setTeamRequests((rs) => rs.map((r) => (reqIds.includes(String(r.id)) ? { ...r, seenAt: stamp } : r)));
    try { await supabase.from("team_requests").update({ seen_at: stamp }).in("id", reqIds); }
    catch (e) { /* stays read locally; retried next time it's opened */ }
  };
  const markRead = (ids) => {
    markRequestsSeen(ids);
    setReadIds((prev) => {
      const next = Array.from(new Set(prev.concat(ids)));
      /* Keep the stored list from growing without bound as matches age out. */
      const trimmed = next.slice(-400);
      try { localStorage.setItem("am-read", JSON.stringify(trimmed)); } catch (e) { /* private mode */ }
      return trimmed;
    });
  };
  const [booting, setBooting] = useState(true);
  const [splashHeld, setSplashHeld] = useState(true); // keeps the full-bleed splash up for a minimum time, even on a fast connection
  useEffect(() => {
    const t = setTimeout(() => setSplashHeld(false), 1700);
    return () => clearTimeout(t);
  }, []);
  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const loginClicked = useRef(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [notifPromptOpen, setNotifPromptOpen] = useState(false);
  const [posterFor, setPosterFor] = useState(null);
  const [pendingScoreSlide, setPendingScoreSlide] = useState(0);
  const [statsPosterFor, setStatsPosterFor] = useState(null);
  const [lineupPosterFor, setLineupPosterFor] = useState(null);
  const [teamFormOpen, setTeamFormOpen] = useState(null); // null | "new" | teamId (editing)
  const [squadManageFor, setSquadManageFor] = useState(null); // teamId
  const [awardCardFor, setAwardCardFor] = useState(null); // award id
  const [viewTeamId, setViewTeamId] = useState(null); // public team profile viewer
  const [viewPlayerId, setViewPlayerId] = useState(null); // public player profile viewer
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());
  const alertsFired = useRef({});

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3600); };

  /* The clock drives live timers and countdowns. Ticking every second re-renders the
     whole app, so only do that when something on screen actually needs per-second
     accuracy — a running match. Otherwise a slow tick is plenty. */
  const needsFastClock = useMemo(
    () => matches.some((m) => m.status === "Live" || m.status === "AwaitingScore"),
    [matches]
  );
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), needsFastClock ? 1000 : 30000);
    return () => clearInterval(iv);
  }, [needsFastClock]);

  /* Recovery links carry their purpose in the URL — read it directly,
     immune to auth-event timing races */
  useEffect(() => {
    const h = window.location.hash || "";
    if (h.includes("type=recovery")) setScreen("recovery");
    if (h.includes("otp_expired") || h.includes("error=access_denied")) {
      notify("That reset link has expired or was already used — request a fresh one from Forgot password.");
    }
  }, []);

  /* ---------- SESSION: restore login, react to auth changes ---------- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (recoveryPending.current) { setScreen("recovery"); setBooting(false); return; }
      if (session) loadMe(session.user.id);
      else setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || recoveryPending.current) { setScreen("recovery"); setBooting(false); return; }
      if (session && screenRef.current !== "recovery") loadMe(session.user.id, event === "SIGNED_IN");
      else if (!session) { setMe(null); setScreen("auth"); setBooting(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadMe = async (userId, freshLogin = false) => {
    const { data: p } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (!p) {
      await supabase.auth.signOut();
      setBooting(false);
      notify("This account no longer exists. Contact the Area Match admin if you think this is a mistake.");
      return;
    }
    if (p.blocked) {
      await supabase.auth.signOut();
      setBooting(false);
      notify("🚫 This account has been blocked. Contact the Area Match admin.");
      return;
    }
    const meObj = { id: p.id, name: p.name, role: p.role, pin: p.pin, state: p.state || "", contactInfo: p.contact_info || "", joined: (p.created_at || "").slice(0, 10), contact: (await supabase.auth.getUser()).data.user?.email || "", contactPublic: !!p.contact_public, jerseyPattern: p.jersey_pattern || "solid", jerseyMain: p.jersey_main || "#E6B31E", jerseyTrim: p.jersey_trim || "#F5F0E1", positionPlayed: p.position_played || "", teamId: p.team_id || null, rosterName: p.roster_name || "", dreamTeams: p.dream_teams || [] };
    setMe(meObj);
    setScreen("site");
    setPage(p.role === "Admin" ? "admin" : "feed");
    supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", p.id).then(() => {});
    if (freshLogin && loginClicked.current) { notify("✔ Logged In Successfully"); loginClicked.current = false; }
    if (p.role === "Captain" && typeof Notification !== "undefined" && Notification.permission === "default") {
      setTimeout(() => setNotifPromptOpen(true), 1200);
    }
    if (freshLogin && !localStorage.getItem("me_pwa_prompted")) {
      setPwaPromptOpen(true);
      localStorage.setItem("me_pwa_prompted", "1");
    }
    await refreshAll(meObj);
    setBooting(false);
  };

  const refreshAll = async (meObj = me) => {
    if (!meObj) return;
    const [{ data: ms }, { data: us }] = await Promise.all([
      supabase.from("matches").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, name, role, created_at, contact_info, state, blocked, last_seen, email, team_id, roster_name, jersey_pattern, jersey_main, jersey_trim, position_played, contact_public, dream_teams"),
    ]);
    const { data: ev } = await supabase.from("match_events").select("*").order("created_at", { ascending: false }).limit(24);
    /* The quick "Live Updates" ticker (News Feed + Admin) shows real match events only —
       captain commentary is intentionally kept out of it and stays limited to the actual
       match's own live view, where it belongs alongside the full commentary feed. */
    if (ev) setEvents(ev.filter((e) => !/🎙/.test(e.message || "")).slice(0, 12));
    const { data: lk } = await supabase.from("likes").select("match_id, user_id");
    if (lk) {
      setMyLikes(lk.filter((x) => x.user_id === meObj.id).map((x) => x.match_id));
      const lc = {}; lk.forEach((x) => { lc[x.match_id] = (lc[x.match_id] || 0) + 1; });
      setLikeCounts(lc);
    }
    const { data: rq } = await supabase.from("match_requests").select("*").order("created_at", { ascending: false });
    if (rq) setRequests(rq);
    const { data: an } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
    if (an) setAnnes(an.filter((a) => Date.now() - new Date(a.created_at).getTime() < 86400000));
    const { data: st } = await supabase.from("site_settings").select("value").eq("key", "support_link").single();
    if (st) { setSupportLink(st.value || ""); setSupportDraft(st.value || ""); }
    const { data: fl } = await supabase.from("follows").select("captain_id").eq("fan_id", meObj.id);
    if (fl) setFollows(fl.map((x) => x.captain_id));
    const { data: allFl } = await supabase.from("follows").select("captain_id");
    if (allFl) {
      const counts = {};
      allFl.forEach((x) => { counts[x.captain_id] = (counts[x.captain_id] || 0) + 1; });
      setFollowerCounts(counts);
    }
    const { data: ps } = await supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(20);
    if (ps) setAdminPosts(ps);
    if (ms) setMatches(ms.map(rowToMatch));
    if (us) setUsers(us.map((u) => ({ id: u.id, name: u.name, role: u.role, contact: "", email: u.email || "", contactInfo: u.contact_info || "", state: u.state || "", blocked: !!u.blocked, lastSeen: u.last_seen, pin: null, joined: (u.created_at || "").slice(0, 10), teamId: u.team_id || null, rosterName: u.roster_name || "", jerseyPattern: u.jersey_pattern || "solid", jerseyMain: u.jersey_main || "#E6B31E", jerseyTrim: u.jersey_trim || "#F5F0E1", positionPlayed: u.position_played || "", contactPublic: !!u.contact_public, dreamTeams: u.dream_teams || [] })));
    const { data: savedTeamsRows } = await supabase.from("saved_teams").select("*").order("created_at", { ascending: false });
    if (savedTeamsRows) setSavedTeams(savedTeamsRows.map((t) => ({ id: t.id, captainId: t.captain_id, name: t.name, color: t.color, badge: t.badge || "", players: t.players || "", formation: t.formation || null, positions: t.positions || null, jerseyPattern: t.jersey_pattern || "solid", jerseyTrim: t.jersey_trim || "#F5F0E1", startingNames: t.starting_names || [], createdAt: t.created_at })));
    const { data: trRows } = await supabase.from("team_requests").select("*").order("created_at", { ascending: false });
    if (trRows) setTeamRequests(trRows.map((r) => ({ id: r.id, playerId: r.player_id, teamId: r.team_id, captainId: r.captain_id, kind: r.kind, rosterName: r.roster_name || "", status: r.status, createdAt: r.created_at, seenAt: r.seen_at || null })));
    const { data: tsRows } = await supabase.from("team_supporters").select("*");
    if (tsRows) setTeamSupporters(tsRows.map((r) => ({ fanId: r.fan_id, teamId: r.team_id })));
    const { data: paRows } = await supabase.from("player_awards").select("*").order("created_at", { ascending: false });
    if (paRows) setPlayerAwards(paRows.map((r) => ({ id: r.id, playerId: r.player_id, teamId: r.team_id, matchId: r.match_id, awardType: r.award_type, note: r.note || "", awardedBy: r.awarded_by, createdAt: r.created_at })));
    if (meObj.role === "Admin") {
      const { data: fb } = await supabase.from("feedback").select("*").order("created_at", { ascending: false });
      if (fb) setFeedbacks(fb.map((f) => ({ id: f.id, userId: f.user_id, feature: f.feature, msg: f.message, at: f.created_at })));
    }
  };

  /* ---------- REALTIME: fans see captains' updates instantly ---------- */
  useEffect(() => {
    if (!me) return;
    const channel = supabase
      .channel("matches-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, (payload) => {
        if (payload.eventType === "DELETE") {
          setMatches((ms) => ms.filter((m) => m.id !== payload.old.id));
        } else {
          const m = rowToMatch(payload.new);
          setMatches((ms) => {
            const i = ms.findIndex((x) => x.id === m.id);
            if (i !== -1 && goalAlertIdsRef.current.includes(m.id)) {
              const prev = ms[i];
              const prevGoals = (prev.liveA ?? 0) + (prev.liveB ?? 0);
              const nowGoals = (m.liveA ?? 0) + (m.liveB ?? 0);
              if (nowGoals > prevGoals) notify(`⚽ GOAL! ${m.teamA.name} ${m.liveA}–${m.liveB} ${m.teamB.name}`);
            }
            if (i === -1) return [m, ...ms];
            const next = [...ms]; next[i] = m; return next;
          });
        }
      })
      .subscribe();
    const poll = setInterval(() => refreshAll(), 30000); // safety net
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [me && me.id]);

  /* ---------- NOTIFICATIONS: reminders land as toast + device alert ---------- */
  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel("my-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` }, (payload) => {
        const msg = payload.new.message;
        notify(`🔔 ${msg}`);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try { new Notification("Area Match", { body: msg, icon: "/icon-512.png" }); } catch (e) {}
        }
        refreshAll(); // in case this notification means something about MY OWN data changed (e.g. a squad approval) — no manual reload needed
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me && me.id]);

  /* Network status — show the reconnecting animation when offline */
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  /* Heartbeat: keep last_seen fresh */
  useEffect(() => {
    if (!me) return;
    const iv = setInterval(() => {
      supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", me.id).then(() => {});
    }, 120000);
    return () => clearInterval(iv);
  }, [me && me.id]);

  /* ---------- PRESENCE: live count of users on the site ---------- */
  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel("online-users", { config: { presence: { key: me.id } } });
    ch.on("presence", { event: "sync" }, () => {
      setOnlineCount(Math.max(1, Object.keys(ch.presenceState()).length));
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED") await ch.track({ at: Date.now() });
    });
    return () => { supabase.removeChannel(ch); };
  }, [me && me.id]);

  /* A scheduled match can only be kicked off by its captain,
     and only once its scheduled date & time is due */
  const kickoffAt = (m) => new Date(`${m.date}T${m.time}`).getTime();
  const isDue = (m) => now >= kickoffAt(m);
  const untilKickoff = (m) => {
    const ms = kickoffAt(m) - now;
    if (ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), mm = mins % 60;
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  /* ---------- TIMESTAMP TIMER ENGINE ----------
     The clock is computed from WHEN it started, not from counting
     ticks — exact real time for captain and fans alike, immune to
     pauses, refreshes, and slow connections. */
  const liveElapsed = (m) => {
    if (m.status !== "Live") return m.elapsed;
    const FULL = (m.duration || 90) * 60, HALF = FULL / 2;
    let el = m.elapsed;
    if (m.running && m.timerStartedAt) {
      el = Math.min(FULL, m.elapsed + Math.max(0, Math.floor((now - new Date(m.timerStartedAt).getTime()) / 1000)));
    }
    /* Safety clamp: no viewer (including a captain whose own device missed the
       transition, e.g. phone locked at exactly 45') ever sees the clock run
       past half-time until the captain has actually started the second half. */
    if (!m.secondHalf) el = Math.min(el, HALF);
    return el;
  };
  const breakLeft = (m) => (m.onBreak && m.breakEndsAt ? Math.max(0, Math.floor((new Date(m.breakEndsAt).getTime() - now) / 1000)) : 0);

  /* Captain's client watches its own live matches and fires the
     half-time / full-time / break-over transitions */
  useEffect(() => {
    if (!me) return;
    matches.forEach((m) => {
      if (m.status !== "Live" || m.createdBy !== me.id) return;
      const FULL = (m.duration || 90) * 60, HALF = FULL / 2;
      if (!alertsFired.current[m.id]) alertsFired.current[m.id] = {};
      const el = liveElapsed(m);

      if (m.onBreak && m.breakEndsAt && breakLeft(m) === 0 && !alertsFired.current[m.id].breakDone) {
        alertsFired.current[m.id].breakDone = true;
        notify(`⏱ Break over — ${m.teamA.name} vs ${m.teamB.name}. Tap "Start second half" when your teams are ready.`);
        patchMatch(m.id, { onBreak: false, breakEndsAt: null, running: false });
        return;
      }
      if (m.running && el >= HALF && !m.secondHalf && !alertsFired.current[m.id].half) {
        alertsFired.current[m.id].half = true;
        notify(`⏱ HALF TIME — ${m.teamA.name} vs ${m.teamB.name}. Captain: take a 10-minute break?`);
        patchMatch(m.id, { elapsed: HALF, running: false, timerStartedAt: null });
        logEvent(m.id, `⏱ Half time: ${m.teamA.name} vs ${m.teamB.name}`, minute(m));
        return;
      }
      /* Recovery guard: if a match is somehow still running past half-time without the second
         half being started (e.g. the captain refreshed and the in-memory half-time flag was
         lost), stop the clock anyway. Without this, elapsed keeps climbing in the data even
         though the on-screen clock is visually clamped. */
      if (m.running && el >= HALF && !m.secondHalf && m.createdBy === me.id) {
        patchMatch(m.id, { elapsed: HALF, running: false, timerStartedAt: null });
        return;
      }
      /* Second-half nag: break over / half passed but captain hasn't restarted */
      if (!m.running && !m.onBreak && !m.secondHalf && el >= HALF && el < FULL && m.status === "Live") {
        const last = alertsFired.current[m.id].shNagAt || 0;
        if (now - last > 5 * 60000 && alertsFired.current[m.id].half) {
          alertsFired.current[m.id].shNagAt = now;
          if (last > 0) notify(`⏰ Captain — the second half of ${m.teamA.name} vs ${m.teamB.name} hasn't started yet. Tap "Start second half" when ready!`);
          else alertsFired.current[m.id].shNagAt = now;
        }
      }
      /* Full time can only trigger once the second half has actually been started by the captain.
         Without the m.secondHalf guard, a match left running through half-time could jump
         straight to full time even though the captain never approved the restart. */
      if (m.running && m.secondHalf && el >= FULL && !alertsFired.current[m.id].full) {
        alertsFired.current[m.id].full = true;
        notify(`🏁 FULL TIME — ${m.teamA.name} vs ${m.teamB.name}. Captain, please upload the result.`);
        patchMatch(m.id, { elapsed: FULL, running: false, timerStartedAt: null, status: "AwaitingScore", awaitingSince: new Date().toISOString() });
        /* No ticker announcement at full time — the result appears on the
           live updates only when the captain uploads the official score. */
      }
    });
  }, [now, me && me.id, matches]);

  /* Late-score nudge: 20 minutes after full time, remind the captain */
  useEffect(() => {
    if (!me) return;
    matches.forEach((m) => {
      if (m.status !== "AwaitingScore" || m.createdBy !== me.id || !m.awaitingSince) return;
      const mins = (now - new Date(m.awaitingSince).getTime()) / 60000;
      if (!alertsFired.current[m.id]) alertsFired.current[m.id] = {};
      if (mins >= 20 && !alertsFired.current[m.id].late) {
        alertsFired.current[m.id].late = true;
        notify(`⚠️ ${m.teamA.name} vs ${m.teamB.name} ended over 20 minutes ago — please upload the result now. Fans are waiting!`);
      }
    });
  }, [now, me && me.id, matches]);

  /* Kickoff missed: the scheduled date/time has passed but the captain never started the match */
  useEffect(() => {
    if (!me) return;
    matches.forEach((m) => {
      if (m.status !== "Scheduled" || m.createdBy !== me.id || !m.date || !m.time) return;
      const kickoffTime = new Date(`${m.date}T${m.time}`).getTime();
      if (!alertsFired.current[m.id]) alertsFired.current[m.id] = {};
      if (now > kickoffTime && !alertsFired.current[m.id].missedKickoff) {
        alertsFired.current[m.id].missedKickoff = true;
        notify(`⏰ ${m.teamA.name} vs ${m.teamB.name} was scheduled for ${m.time} on ${m.date} — that's already passed. Start it now, or reschedule/cancel it.`);
      }
    });
  }, [now, me && me.id, matches]);

  /* ---------- AUTH ---------- */
  const submitAuth = async () => {
    const email = form.contact.trim().toLowerCase();
    if (!email) return notify("Enter your email address");
    if (!isValidEmail(email)) return notify("Please enter a valid email address (e.g. name@example.com)");

    if (authMode === "signup") {
      if (!form.name.trim() || !/^[A-Za-z ]{2,30}$/.test(form.name.trim())) return notify("Name can only contain letters (2–30 characters)");
      if (!isStrongPassword(form.password)) return notify("Password must be 8+ characters with letters and numbers");
      if (form.password !== form.password2) return notify("Passwords don't match");
      if (!form.state) return notify("Select your state — it helps us show you matches near you");
      // Create the account with a password; a one-time email code verifies it
      setAuthBusy(true);
      loginClicked.current = true;
      const { error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: { data: { name: sanitizeText(form.name, 30).trim(), role: form.role, state: form.state } },
      });
      setAuthBusy(false);
      if (error) { loginClicked.current = false; return notify(error.message); }
      notify("✔ Account created — logging you in…");
    } else {
      // Log in with password — no code needed
      if (!form.password) return notify("Enter your password");
      loginClicked.current = true;
      setAuthBusy(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password: form.password });
      setAuthBusy(false);
      if (error) {
        if (Date.now() < lockedUntil) return notify(`Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s`);
        const tries = otpAttempts + 1;
        setOtpAttempts(tries);
        if (tries >= MAX_OTP_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
          setOtpAttempts(0);
          return notify(`Too many failed logins — locked for ${LOCKOUT_SECONDS} seconds`);
        }
        return notify(`Wrong email or password (${MAX_OTP_ATTEMPTS - tries} attempts left)`);
      }
      // session listener takes over
    }
  };

  /* Verify the 6-digit password-reset code, then open the new-password screen */
  const verifyResetCode = async () => {
    if (Date.now() < lockedUntil) {
      return notify(`Too many wrong codes. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s`);
    }
    if (!/^\d{6}$/.test(form.otp)) return notify("The code is 6 digits");
    recoveryPending.current = true; // route the sign-in straight to the new-password screen
    const { error } = await supabase.auth.verifyOtp({ email: form.contact.trim().toLowerCase(), token: form.otp, type: "recovery" });
    if (error) {
      recoveryPending.current = false;
      const tries = otpAttempts + 1;
      setOtpAttempts(tries);
      if (tries >= MAX_OTP_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
        setOtpAttempts(0);
        return notify(`Too many wrong codes — locked for ${LOCKOUT_SECONDS} seconds`);
      }
      return notify(`Wrong or expired code (${MAX_OTP_ATTEMPTS - tries} attempts left)`);
    }
    setOtpAttempts(0);
    setForm((f) => ({ ...f, otp: "" }));
    setAuthStep("form");
    setScreen("recovery");
  };

  const forgotPassword = async () => {
    const email = form.contact.trim().toLowerCase();
    if (!isValidEmail(email)) return notify("Enter your email above first, then tap Forgot password");
    const { data: exists } = await supabase.rpc("email_exists", { p_email: email });
    if (!exists) return notify("No Area Match account uses this email address. Check the spelling, or create a new account.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) return notify(error.message);
    setAuthStep("resetcode");
    notify(`📧 6-digit code sent to ${email} — enter it below`);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setMe(null); setScreen("auth"); setOpenMatch(null);
    setSeeMore({}); setFeedState("All"); setFeedFollowedOnly(false); // fresh feed for whoever logs in next
  };

  useEffect(() => {
    if (!liveDetailFor) { setLiveTimeline([]); return; }
    let cancelled = false;
    const load = () => supabase.from("match_events").select("*").eq("match_id", liveDetailFor)
      .order("created_at", { ascending: false }).limit(40)
      .then(({ data }) => { if (!cancelled && data) setLiveTimeline(data); });
    load();
    const t = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, [liveDetailFor]);

  useEffect(() => {
    if (rememberMe) return;
    const h = () => { supabase.auth.signOut(); };
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, [rememberMe]);

  /* ---------- MATCH ACTIONS ---------- */
  /* Optimistic local update + database write; realtime confirms for everyone */
  const patchMatch = (id, patch) => {
    setMatches((ms) => ms.map((m) => {
      if (m.id !== id) return m;
      const merged = { ...m, ...patch };
      merged.halfPrompt = deriveHalfPrompt(merged);
      return merged;
    }));
    const row = matchToRow(patch);
    if (Object.keys(row).length > 0) {
      supabase.from("matches").update(row).eq("id", id).then(({ error }) => {
        if (error) notify("Sync issue: " + error.message);
      });
    }
  };

  const postponeMatch = (m, newDate, newTime) => {
    if (m.createdBy !== me.id) return notify("Only this match's captain can postpone it");
    if (m.status !== "Scheduled") return notify("Only scheduled matches can be postponed");
    if (!newDate || !newTime) return notify("Pick the new date and time");
    if (new Date(`${newDate}T${newTime}`).getTime() <= Date.now()) return notify("The new kick-off must be in the future");
    patchMatch(m.id, { date: newDate, time: newTime, postponed: true });
    notify(`📅 Match postponed — ${m.teamA.name} vs ${m.teamB.name} now kicks off ${newDate} at ${newTime}. The News Feed is updated for the fans.`);
  };

  const startMatch = (m) => {
    if (m.createdBy !== me.id) return notify("Only this match's captain can start it");
    if (!isDue(m)) return notify(`Kick-off unlocks at ${m.time} on ${m.date}`);
    patchMatch(m.id, { status: "Live", running: true, elapsed: 0, liveA: 0, liveB: 0, secondHalf: false, timerStartedAt: new Date().toISOString() });
    notify(`🟢 KICK OFF — ${m.teamA.name} vs ${m.teamB.name}`);
    logEvent(m.id, `🟢 Kick off: ${m.teamA.name} vs ${m.teamB.name}`, 0);
  };

  /* Captain submits final score → result published to feed */
  const submitFinalScore = async (m, a, b, shootout = false, pa = 0, pb = 0, scorersA = "", scorersB = "") => {
    const { error } = await supabase.rpc("submit_result", {
      p_match_id: m.id, p_final_a: a, p_final_b: b,
      p_shootout: shootout, p_pens_a: shootout ? pa : null, p_pens_b: shootout ? pb : null,
    });
    if (error) return notify(error.message);
    await supabase.from("matches").update({ scorers_a: sanitizeText(scorersA, 150), scorers_b: sanitizeText(scorersB, 150), stream_url: null }).eq("id", m.id);
    const result = a > b ? "A" : b > a ? "B" : "Draw";
    const pensWinner = shootout ? (pa > pb ? "A" : pb > pa ? "B" : null) : null;
    const winnerText = pensWinner
      ? `${pensWinner === "A" ? m.teamA.name : m.teamB.name} win ${pa}–${pb} on penalties`
      : result === "Draw" ? "It ended in a draw" : `${result === "A" ? m.teamA.name : m.teamB.name} win`;
    notify(`📰 RESULT PUBLISHED: ${m.teamA.name} ${a}–${b} ${m.teamB.name}. ${winnerText}.`);
    logEvent(m.id, `📰 Match Over: ${m.teamA.name} ${a}-${b} ${m.teamB.name} — ${winnerText}`, minute(m));
    refreshAll();
  };

  /* min: the match minute this happened at, tagged as a "NN' " prefix so the Live view can show a time badge */
  const logEvent = (matchId, message, min) => {
    const tag = min !== undefined && min !== null ? `${min}' ` : "";
    supabase.from("match_events").insert({ match_id: matchId, message: (tag + message).slice(0, 120) }).then(() => {});
  };

  const toggleLike = async (m) => {
    if (myLikes.includes(m.id)) {
      await supabase.from("likes").delete().eq("user_id", me.id).eq("match_id", m.id);
      setMyLikes((l) => l.filter((x) => x !== m.id));
      setLikeCounts((c) => ({ ...c, [m.id]: Math.max(0, (c[m.id] || 1) - 1) }));
    } else {
      await supabase.from("likes").insert({ user_id: me.id, match_id: m.id });
      setMyLikes((l) => [...l, m.id]);
      setLikeCounts((c) => ({ ...c, [m.id]: (c[m.id] || 0) + 1 }));
    }
  };

  const toggleFollow = async (captainId) => {
    if (follows.includes(captainId)) {
      await supabase.from("follows").delete().eq("fan_id", me.id).eq("captain_id", captainId);
      setFollows((f) => f.filter((id) => id !== captainId));
      notify("Unfollowed");
    } else {
      await supabase.from("follows").insert({ fan_id: me.id, captain_id: captainId });
      setFollows((f) => [...f, captainId]);
      notify("🔔 Following! New matches from this captain will be highlighted for you on the News Feed.");
    }
  };

  const updateProfile = async (patch) => {
    const row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.pin !== undefined) row.pin = patch.pin;
    if (patch.contactInfo !== undefined) row.contact_info = sanitizeText(patch.contactInfo, 60);
    if (patch.contactPublic !== undefined) row.contact_public = patch.contactPublic;
    const { error } = await supabase.from("profiles").update(row).eq("id", me.id);
    if (error) return notify(error.message);
    setUsers((us) => us.map((u) => (u.id === me.id ? { ...u, ...patch } : u)));
    setMe((m) => ({ ...m, ...patch }));
  };

  const minute = (m) => Math.min(m.duration || 90, Math.floor(liveElapsed(m) / 60));
  /* Past results older than 30 days are retired from view (and purged nightly by the database) */
  const isFresh = (m) => m.status !== "ResultPublished" || (now - new Date(m.date).getTime()) < 30 * 86400000;
  const pendingScores = me ? matches.filter((m) => m.status === "AwaitingScore" && m.createdBy === me.id) : [];

  /* Bell feed — kick-off reminders and awaiting-score prompts are derived from
     match state rather than stored, so they stay accurate without extra SQL.
     Join requests come from real rows. Each needs a stable id so "read" sticks. */
  const bellItems = useMemo(() => {
    if (!me) return [];
    const out = [];

    /* ---- PLAYER ---- squad decisions and awards won */
    if (me.role === "Player") {
      (teamRequests || []).filter((r) => r.playerId === me.id && r.status !== "pending" && !r.seenAt).forEach((r) => {
        const t = savedTeams.find((x) => x.id === r.teamId);
        const ok = r.status === "approved";
        out.push({ id: "rr-" + r.id, kind: ok ? "approved" : "denied", icon: ok ? "✅" : "✕",
          title: ok ? "You're in the squad" : "Request not accepted",
          sub: t ? t.name : "Team", teamId: r.teamId, requestId: r.id,
          at: r.createdAt ? new Date(r.createdAt).getTime() : 0 });
      });
      /* Awards from the last 30 days — player_awards already carries the date,
         so no extra storage is needed for these. */
      const cutoff = now - 30 * 86400000;
      (playerAwards || []).filter((a) => a.playerId === me.id && a.createdAt &&
        new Date(a.createdAt).getTime() > cutoff).forEach((a) => {
        const info = AWARD_TYPES[a.awardType] || { label: a.awardType };
        out.push({ id: "aw-" + a.id, kind: "award", icon: "🏆",
          title: "You won " + info.label, sub: "Tap to view your honours",
          at: new Date(a.createdAt).getTime() });
      });
      return out.sort((a, b) => b.at - a.at);
    }

    if (me.role !== "Captain") return [];
    matches.forEach((m) => {
      if (m.createdBy !== me.id) return;
      if (m.status === "Scheduled" && isDue(m)) {
        out.push({ id: "ko-" + m.id, kind: "kickoff", icon: "⏰", title: "Kick-off reached",
          sub: `${m.teamA.name} vs ${m.teamB.name} · ${m.time}`, matchId: m.id,
          at: new Date(`${m.date}T${m.time}`).getTime() });
      }
      if (m.status === "AwaitingScore") {
        out.push({ id: "sc-" + m.id, kind: "score", icon: "🏁", title: "Result needed",
          sub: `${m.teamA.name} vs ${m.teamB.name}`, matchId: m.id,
          at: m.awaitingSince ? new Date(m.awaitingSince).getTime() : 0 });
      }
    });
    (teamRequests || []).filter((r) => r.status === "pending" &&
      savedTeams.some((t) => t.id === r.teamId && t.captainId === me.id)).forEach((r) => {
      const t = savedTeams.find((x) => x.id === r.teamId);
      out.push({ id: "rq-" + r.id, kind: "request", icon: "👤", title: "Player wants to join",
        sub: `${r.rosterName || (users.find((u) => u.id === r.playerId) || {}).name || "A player"} · ${t ? t.name : ""}`,
        at: r.createdAt ? new Date(r.createdAt).getTime() : 0 });
    });
    return out.sort((a, b) => b.at - a.at);
  }, [me, matches, teamRequests, savedTeams, playerAwards, now]);

  const unreadBell = bellItems.filter((n) => !readIds.includes(n.id));
  /* Hero card drifts on its own between the text card and the photo, no tap needed —
     randomized pace (3.5-6.5s) so it doesn't feel mechanical. Only runs while the feed
     is actually on screen; otherwise it would re-render the whole app for nothing. */
  useEffect(() => {
    if (page !== "feed") return;
    let timer;
    const loop = () => {
      setHeroSlide((s) => (s === 0 ? 1 : 0));
      timer = setTimeout(loop, 3500 + Math.random() * 3000);
    };
    timer = setTimeout(loop, 4500);
    return () => clearTimeout(timer);
  }, [page]);
  useEffect(() => {
    if (pendingScores.length <= 1) return;
    const t = setInterval(() => setPendingScoreSlide((i) => (i + 1) % pendingScores.length), 5000);
    return () => clearInterval(t);
  }, [pendingScores.length]);
  /* A saved team's record is derived from real published results — matched by team name + the
     same captain, since matches store team names as free text rather than a saved_team id. */
  /* A player's real record, resolved from published match results.
     Because a player is linked to exactly one team + one exact roster name, we can
     scan that team's published matches and count goals credited to that name.
     This runs the same way whether they joined fresh or claimed an existing name —
     which is what makes retroactive backfill work automatically: a claimed name
     immediately picks up every goal already recorded against it historically. */
  /* ---------- MATCH INDEX ----------
     Built once whenever matches change, instead of re-scanning every match for
     every player on every render. This is the difference between thousands of
     passes per second and one pass per data change. */
  const matchIndex = useMemo(() => {
    const parseScorers = (str) => {
      const out = [];
      (str || "").split(",").forEach((chunk) => {
        const part = chunk.trim();
        if (!part) return;
        const mm = /^(.*?)\s*x\s*(\d+)$/i.exec(part);
        out.push({ name: (mm ? mm[1] : part).trim().toLowerCase(), n: mm ? parseInt(mm[2], 10) : 1 });
      });
      return out;
    };
    /* byTeam: "captainId|teamname" -> published matches for that team, newest first */
    const byTeam = new Map();
    /* goalsByTeamPlayer: "captainId|teamname|playername" -> { goals, hatTricks } */
    const goalsByTeamPlayer = new Map();
    matches.forEach((m) => {
      if (m.status !== "ResultPublished") return;
      [[m.teamA.name, m.scorersA], [m.teamB.name, m.scorersB]].forEach(([teamName, scorers]) => {
        const tKey = `${m.createdBy}|${(teamName || "").trim().toLowerCase()}`;
        if (!byTeam.has(tKey)) byTeam.set(tKey, []);
        byTeam.get(tKey).push(m);
        parseScorers(scorers).forEach(({ name, n }) => {
          const pKey = `${tKey}|${name}`;
          const cur = goalsByTeamPlayer.get(pKey) || { goals: 0, hatTricks: 0 };
          cur.goals += n;
          if (n >= 3) cur.hatTricks += 1;
          goalsByTeamPlayer.set(pKey, cur);
        });
      });
    });
    byTeam.forEach((list) => list.sort((a, b) => (a.date < b.date ? 1 : -1)));
    return { byTeam, goalsByTeamPlayer };
  }, [matches]);

  const playerStats = (player) => {
    if (!player || !player.teamId || !player.rosterName) return { goals: 0, hatTricks: 0, matches: 0, team: null, ready: false };
    const team = savedTeams.find((t) => t.id === player.teamId);
    if (!team) return { goals: 0, hatTricks: 0, matches: 0, team: null, ready: false };
    const tKey = `${team.captainId}|${(team.name || "").trim().toLowerCase()}`;
    const played = matchIndex.byTeam.get(tKey) || [];
    const hit = matchIndex.goalsByTeamPlayer.get(`${tKey}|${player.rosterName.trim().toLowerCase()}`) || { goals: 0, hatTricks: 0 };
    return { goals: hit.goals, hatTricks: hit.hatTricks, matches: played.length, team, ready: true };
  };

  /* ---------- RICH PROFILE ENGINE ----------
     Everything the redesigned player profile needs, all derived from published match
     results — no new database columns. Returns per-match detail (not just totals),
     which is what makes form charts, streaks and standout performances possible. */
  const goalsForNameInMatch = (m, teamName, nameLc) => {
    const isA = m.teamA.name === teamName;
    const scorerStr = (isA ? m.scorersA : m.scorersB) || "";
    let n = 0;
    scorerStr.split(",").forEach((chunk) => {
      const part = chunk.trim();
      if (!part) return;
      const mm = /^(.*?)\s*x\s*(\d+)$/i.exec(part);
      const nm = (mm ? mm[1] : part).trim().toLowerCase();
      if (nm === nameLc) n += mm ? parseInt(mm[2], 10) : 1;
    });
    return n;
  };
  const playerProfileData = (player) => {
    const base = playerStats(player);
    if (!base.ready) return { ...base, history: [], streak: 0, lastBlank: null, standout: null, standing: null };
    const team = base.team;
    const nameLc = player.rosterName.trim().toLowerCase();
    const awardsForPlayer = playerAwards.filter((a) => a.playerId === player.id);

    /* Per-match history, newest first */
    const history = matches
      .filter((m) => m.status === "ResultPublished" && m.createdBy === team.captainId &&
        (m.teamA.name === team.name || m.teamB.name === team.name))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((m) => {
        const isA = m.teamA.name === team.name;
        const us = isA ? m.finalA : m.finalB, them = isA ? m.finalB : m.finalA;
        const outcome = m.shootout && m.pensWinner
          ? (m.pensWinner === (isA ? "A" : "B") ? "W" : "L")
          : us > them ? "W" : us < them ? "L" : "D";
        return {
          id: m.id, date: m.date, location: m.location,
          opponent: isA ? m.teamB.name : m.teamA.name,
          us, them, outcome,
          goals: goalsForNameInMatch(m, team.name, nameLc),
          award: awardsForPlayer.find((a) => a.matchId === m.id) || null,
        };
      });

    /* Scoring streak — consecutive most-recent matches with at least one goal */
    let streak = 0;
    for (const h of history) { if (h.goals > 0) streak++; else break; }
    const lastBlank = history.find((h) => h.goals === 0) || null;

    /* Standout performance — most goals, tie-broken by award, then by margin */
    const standout = history.filter((h) => h.goals > 0).sort((a, b) =>
      (b.goals - a.goals) || ((b.award ? 1 : 0) - (a.award ? 1 : 0)) || ((b.us - b.them) - (a.us - a.them))
    )[0] || null;

    /* Squad standing — rank among registered teammates on the same team */
    const teammates = users.filter((u) => u.role === "Player" && u.teamId === player.teamId && u.rosterName);
    const byGoals = teammates.map((u) => ({ id: u.id, goals: playerStats(u).goals }))
      .sort((a, b) => b.goals - a.goals);
    const byAwards = teammates.map((u) => ({ id: u.id, n: playerAwards.filter((a) => a.playerId === u.id).length }))
      .sort((a, b) => b.n - a.n);
    const scoredIn = history.filter((h) => h.goals > 0);
    const wonWhenScored = scoredIn.filter((h) => h.outcome === "W").length;
    const standing = {
      goalRank: byGoals.findIndex((x) => x.id === player.id) + 1,
      awardRank: byAwards.findIndex((x) => x.id === player.id) + 1,
      squadSize: teammates.length,
      winRateScoring: scoredIn.length > 0 ? Math.round((wonWhenScored / scoredIn.length) * 100) : null,
      wins: history.filter((h) => h.outcome === "W").length,
      draws: history.filter((h) => h.outcome === "D").length,
      losses: history.filter((h) => h.outcome === "L").length,
    };

    const perMatch = base.matches > 0 ? (base.goals / base.matches) : 0;
    return { ...base, history, streak, lastBlank, standout, standing, perMatch, awards: awardsForPlayer };
  };
  /* Auto-computed level — a weighted score from goals, hat-tricks, and awards, no manual input needed.
     Note: assists aren't tracked anywhere in the app yet (no attribution UI exists for them), so this
     is goals + hat-tricks + awards only — the honest scope of what's actually measurable right now. */
  const LEVEL_TIERS = [
    { name: "Novice", min: 0, icon: "🌱" },
    { name: "Rising Talent", min: 5, icon: "⚡" },
    { name: "Star", min: 15, icon: "⭐" },
    { name: "Top Star", min: 35, icon: "👑" },
  ];
  const playerLevel = (player) => {
    const stats = playerStats(player);
    const awardsCount = playerAwards.filter((a) => a.playerId === player.id).length;
    const score = stats.goals * 1 + stats.hatTricks * 2 + awardsCount * 3;
    let tierIdx = 0;
    for (let i = LEVEL_TIERS.length - 1; i >= 0; i--) { if (score >= LEVEL_TIERS[i].min) { tierIdx = i; break; } }
    const tier = LEVEL_TIERS[tierIdx];
    const next = LEVEL_TIERS[tierIdx + 1];
    const progress = next ? Math.min(1, (score - tier.min) / (next.min - tier.min)) : 1;
    return { score, tier, next, progress, awardsCount };
  };
  /* Player saves a kit/profile tweak — writes straight to their own profile row */
  const savePlayerKit = async (patch) => {
    setMe((prev) => ({ ...prev,
      jerseyPattern: patch.jersey_pattern ?? prev.jerseyPattern,
      jerseyMain: patch.jersey_main ?? prev.jerseyMain,
      jerseyTrim: patch.jersey_trim ?? prev.jerseyTrim,
      positionPlayed: patch.position_played ?? prev.positionPlayed,
      contactInfo: patch.contact_info ?? prev.contactInfo,
      contactPublic: patch.contact_public ?? prev.contactPublic,
      dreamTeams: patch.dream_teams ?? prev.dreamTeams,
    }));
    const { error } = await supabase.from("profiles").update(patch).eq("id", me.id);
    if (error) notify(error.message);
  };
  /* Player asks to join a squad — either as a new member, or claiming a name already on the roster */
  const requestToJoin = async (team, kind, rosterName) => {
    const { error } = await supabase.from("team_requests").insert({
      player_id: me.id, team_id: team.id, captain_id: team.captainId, kind, roster_name: rosterName, status: "pending",
    });
    if (error) return notify(error.message);
    await supabase.from("notifications").insert({
      user_id: team.captainId,
      message: kind === "claim"
        ? `👤 ${me.name} says they're "${rosterName}" in your ${team.name} squad — approve to link their profile.`
        : `👤 ${me.name} wants to join your ${team.name} squad.`,
    });
    notify(kind === "claim" ? `Claim sent — waiting for the captain to confirm you're "${rosterName}".` : "Request sent to the captain.");
    refreshAll();
  };
  /* Captain approves: links the player to the team + exact roster name (stats backfill happens automatically
     because playerStats() reads historical match results by that name) */
  /* Captain awards a player — visible on their profile, triggers a notification, and (for MOTM/Golden Boot etc.)
     feeds directly into their level progress since it's counted alongside goals in playerLevel(). */
  const saveSquadStarting = async (teamId, names) => {
    setSavedTeams((ts) => ts.map((t) => (t.id === teamId ? { ...t, startingNames: names } : t)));
    const { error } = await supabase.from("saved_teams").update({ starting_names: names }).eq("id", teamId);
    if (error) notify(error.message);
  };
  const giveAward = async (playerId, teamId, awardType, matchId = null) => {
    const { error } = await supabase.from("player_awards").insert({ player_id: playerId, team_id: teamId, match_id: matchId, award_type: awardType, awarded_by: me.id });
    if (error) return notify(error.message);
    const player = users.find((u) => u.id === playerId);
    await supabase.from("notifications").insert({
      user_id: playerId,
      message: `🏆 You've been awarded ${AWARD_TYPES[awardType]?.label || awardType}! Check your profile.`,
    });
    notify(`🏆 ${AWARD_TYPES[awardType]?.label || awardType} given to ${player ? player.name : "the player"}.`);
    refreshAll();
  };
  const toggleSupportTeam = async (teamId) => {
    const already = teamSupporters.some((s) => s.fanId === me.id && s.teamId === teamId);
    if (already) {
      await supabase.from("team_supporters").delete().eq("fan_id", me.id).eq("team_id", teamId);
      setTeamSupporters((s) => s.filter((x) => !(x.fanId === me.id && x.teamId === teamId)));
    } else {
      await supabase.from("team_supporters").insert({ fan_id: me.id, team_id: teamId });
      setTeamSupporters((s) => [...s, { fanId: me.id, teamId }]);
    }
  };
  const respondToRequest = async (req, approve) => {
    const team = savedTeams.find((t) => t.id === req.teamId);
    const player = users.find((u) => u.id === req.playerId);
    /* Clear the original "X wants to join" / "X claims to be Y" notification now that it's been acted on —
       matched by content since we didn't store the notification's own id on the request row. */
    if (player && team) {
      await supabase.from("notifications").delete().eq("user_id", req.captainId).ilike("message", `%${player.name}%${team.name}%`);
    }
    if (approve) {
      let rosterName = req.rosterName || (player ? player.name : "");
      if (team && req.kind === "join") {
        /* New member — append their name to the team roster if it isn't already there */
        const list = (team.players || "").split(",").map((s) => s.trim()).filter(Boolean);
        if (!list.some((n) => n.toLowerCase() === rosterName.toLowerCase())) {
          list.push(rosterName);
          await supabase.from("saved_teams").update({ players: list.join(", ") }).eq("id", team.id);
        }
      }
      const { data: updated, error } = await supabase.from("profiles").update({ team_id: req.teamId, roster_name: rosterName }).eq("id", req.playerId).select();
      if (error) return notify(error.message);
      if (!updated || updated.length === 0) return notify("⚠️ Couldn't link the player — a permissions issue may be blocking it. Try again after the latest update.");
      await supabase.from("notifications").insert({
        user_id: req.playerId,
        message: `✅ You're in! ${team ? team.name : "The captain"} approved you as "${rosterName}". Your goals are now tracked on your profile.`,
      });
    } else {
      await supabase.from("notifications").insert({
        user_id: req.playerId,
        message: `Your request to join ${team ? team.name : "the squad"} wasn't approved this time.`,
      });
    }
    const { data: updatedReq, error: reqErr } = await supabase.from("team_requests").update({ status: approve ? "approved" : "denied" }).eq("id", req.id).select();
    /* Surface the REAL database error rather than guessing at the cause — a vague
       "permissions issue" message previously hid a unique-constraint violation for days. */
    if (reqErr) return notify(`⚠️ ${reqErr.message}`);
    if (!updatedReq || updatedReq.length === 0) {
      return notify("⚠️ Couldn't update the request — no rows changed. It may have already been handled.");
    }
    /* Drop it from the local list right away so the Join Requests card updates instantly,
       rather than waiting on a refresh round-trip. */
    setTeamRequests((rs) => rs.filter((r) => r.id !== req.id));
    notify(approve ? "✅ Player added to your squad." : "Request denied.");
    refreshAll();
  };
  /* Cache team records for the life of this data — teamRecord gets called repeatedly
     (leaderboards, milestones, every team card) and each call used to re-scan matches. */
  const teamRecordCache = useMemo(() => new Map(), [matches, savedTeams]);
  const teamRecord = (team) => {
    if (!team) return { wins: 0, draws: 0, losses: 0, total: 0, rating: 0, ratingReady: false, results: [] };
    const cached = teamRecordCache.get(team.id);
    if (cached) return cached;
    const played = matchIndex.byTeam.get(`${team.captainId}|${(team.name || "").trim().toLowerCase()}`) || [];
    const results = played.map((m) => {
      const isA = m.teamA.name === team.name;
      const us = isA ? m.finalA : m.finalB, them = isA ? m.finalB : m.finalA;
      const outcome = m.shootout && m.pensWinner ? (m.pensWinner === (isA ? "A" : "B") ? "W" : "L") : us > them ? "W" : us < them ? "L" : "D";
      const opponent = isA ? m.teamB.name : m.teamA.name;
      return { match: m, outcome, us, them, opponent };
    });
    const wins = results.filter((r) => r.outcome === "W").length;
    const draws = results.filter((r) => r.outcome === "D").length;
    const losses = results.filter((r) => r.outcome === "L").length;
    const total = results.length;
    /* Weighted points formula: Win=3, Draw=1, Loss=0, scaled to a 5-star rating */
    const points = wins * 3 + draws * 1;
    const rating = total > 0 ? Math.round((points / (total * 3)) * 5 * 10) / 10 : 0;
    const out = { results, wins, draws, losses, total, rating, ratingReady: total >= 3 };
    teamRecordCache.set(team.id, out);
    return out;
  };

  /* These two must live ABOVE the booting/splash early return — React requires the
     same number of hooks on every render, and an early return between them would
     change that count and crash the app (React error #310). */
  const captainState = (m) => (users.find((u) => u.id === m.createdBy) || {}).state || "";

  /* How many published matches sit in each state — shown beside the state name
     so people can see where the activity actually is. Deliberately a plain
     function call, not a hook: it sits below an early return. */
  const stateCounts = (() => {
    const out = {};
    matches.forEach((m) => {
      if (!m.published) return;
      const st = captainState(m);
      if (st) out[st] = (out[st] || 0) + 1;
    });
    return out;
  })();

  const leaderboards = useMemo(() => {
    const scoped = matches.filter((m) => m.status === "ResultPublished" &&
      (feedState === "All" || captainState(m) === feedState));
    /* Goals per player name, resolved per team so identical names on different teams stay separate */
    const tally = {};
    scoped.forEach((m) => {
      [["A", m.teamA.name, m.scorersA], ["B", m.teamB.name, m.scorersB]].forEach(([, teamName, str]) => {
        (str || "").split(",").forEach((chunk) => {
          const part = chunk.trim();
          if (!part) return;
          const mm = /^(.*?)\s*x\s*(\d+)$/i.exec(part);
          const nm = (mm ? mm[1] : part).trim();
          if (!nm) return;
          const n = mm ? parseInt(mm[2], 10) : 1;
          const key = `${nm.toLowerCase()}|${teamName.toLowerCase()}`;
          if (!tally[key]) tally[key] = { name: nm, team: teamName, goals: 0 };
          tally[key].goals += n;
        });
      });
    });
    const topScorers = Object.values(tally).sort((a, b) => b.goals - a.goals).slice(0, 5);
    const teamForm = savedTeams
      .map((t) => ({ team: t, rec: teamRecord(t) }))
      .filter((x) => x.rec.ratingReady)
      .sort((a, b) => b.rec.rating - a.rec.rating)
      .slice(0, 5);
    const mostSupported = savedTeams
      .map((t) => ({ team: t, count: teamSupporters.filter((s) => s.teamId === t.id).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return { topScorers, teamForm, mostSupported };
  }, [matches, savedTeams, teamSupporters, feedState, matchIndex]);

  /* Milestones — notable things that happened recently, phrased as news */
  const milestones = useMemo(() => {
    const out = [];
    const registered = users.filter((u) => u.role === "Player" && u.teamId && u.rosterName);
    /* Goal milestones at meaningful thresholds */
    registered.forEach((p) => {
      const st = playerStats(p);
      if (!st.ready) return;
      const threshold = [50, 25, 15, 10, 5].find((t) => st.goals >= t);
      if (threshold) out.push({
        id: `g-${p.id}`, accent: "#D6A81D", weight: threshold,
        head: `${p.name} reached ${threshold} goals`,
        sub: st.team ? st.team.name : "",
        playerId: p.id,
      });
    });
    /* Team winning runs */
    savedTeams.forEach((t) => {
      const rec = teamRecord(t);
      let run = 0;
      for (const r of rec.results) { if (r.outcome === "W") run++; else break; }
      if (run >= 3) out.push({
        id: `w-${t.id}`, accent: "#3FA35B", weight: run * 4,
        head: `${t.name} on a ${run}-match winning run`,
        sub: "Unbeaten in their last " + run,
        teamId: t.id,
      });
    });
    /* Supporter milestones */
    savedTeams.forEach((t) => {
      const c = teamSupporters.filter((s) => s.teamId === t.id).length;
      const threshold = [100, 50, 25, 10].find((x) => c >= x);
      if (threshold) out.push({
        id: `s-${t.id}`, accent: "#4a7d9c", weight: threshold / 4,
        head: `${t.name} passed ${threshold} supporters`,
        sub: `${c} fans backing them`,
        teamId: t.id,
      });
    });
    return out.sort((a, b) => b.weight - a.weight).slice(0, 6);
  }, [users, savedTeams, teamSupporters, matchIndex]);

  const createSavedTeam = async (data) => {
    const { error } = await supabase.from("saved_teams").insert({ captain_id: me.id, name: data.name, color: data.color, badge: data.badge, players: data.players, formation: data.formation, positions: data.positions, jersey_pattern: data.jerseyPattern, jersey_trim: data.jerseyTrim });
    if (error) return notify(error.message);
    notify(`✔ ${data.name} saved to your teams.`);
    refreshAll();
  };
  const updateSavedTeam = async (id, data) => {
    const { error } = await supabase.from("saved_teams").update({ name: data.name, color: data.color, badge: data.badge, players: data.players, formation: data.formation, positions: data.positions, jersey_pattern: data.jerseyPattern, jersey_trim: data.jerseyTrim }).eq("id", id);
    if (error) return notify(error.message);
    notify("✔ Team updated.");
    refreshAll();
  };
  const deleteSavedTeam = async (id, name) => {
    if (!window.confirm(`Delete ${name} from your saved teams? This won't affect any past matches.`)) return;
    const { error } = await supabase.from("saved_teams").delete().eq("id", id);
    if (error) return notify(error.message);
    notify("🗑 Team removed.");
    refreshAll();
  };

  /* ============================================================ STYLES */
  const css = `
    ${FONT}
    * { box-sizing: border-box; margin: 0; }
    .md-root { min-height: 100vh; min-height: 100dvh; background: #0A0D0A; color: #F5F0E1; font-family: 'Space Grotesk', sans-serif; -webkit-user-select: none; user-select: none; }
    input, textarea, select { -webkit-user-select: text; user-select: text; }
    .display { font-family: 'Anton', sans-serif; letter-spacing: .02em; text-transform: uppercase; }
    .btn { border: 0; cursor: pointer; font-family: 'Space Grotesk', sans-serif; font-weight: 700; border-radius: 10px; padding: 12px 18px; font-size: 15px; transition: transform .08s; }
    .btn:active { transform: scale(.97); }
    .btn-gold { background: #E6B31E; color: #12160f; }
    .btn-turf { background: #14532D; color: #fff; }
    .btn-ghost { background: transparent; color: #F5F0E1; border: 1.5px solid #243128; }
    /* Immediate press feedback — without this, tapping a name feels unresponsive
       while the profile page mounts. */
    .tappable { transition: opacity .12s ease, transform .12s ease; -webkit-tap-highlight-color: transparent; }
    .tappable:active { opacity: .55; transform: scale(.985); }
    .btn-live { background: #E8442E; color: #ffffff; }
    .input { width: 100%; padding: 13px 14px; border-radius: 10px; border: 1.5px solid #243128; background: #141c16; color: #F5F0E1; font-size: 15px; font-family: 'Space Grotesk', sans-serif; outline: none; }
    .input:focus { border-color: #E6B31E; }
    .card { background: #0E140F; border: 1px solid #243128; border-radius: 16px; padding: 18px; }
    .chip { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .scoreboard { background: radial-gradient(circle at 50% -20%, rgba(245,240,225,.10), transparent 55%), repeating-linear-gradient(90deg, transparent 0 46px, rgba(245,240,225,.05) 46px 48px), ${T.turfDeep}; border: 2px solid ${T.turf}; border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pulse { animation: pulse 1.2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
    .topnav { display: flex; gap: 4px; flex-wrap: wrap; }
    .topnav button { background: none; border: 0; color: #8FA396; font-family: 'Space Grotesk'; font-weight: 700; font-size: 14px; padding: 10px 16px; cursor: pointer; border-radius: 8px; }
    .topnav button.on { color: #12160f; background: #E6B31E; }
    .topnav button:hover:not(.on) { color: #F5F0E1; }
    .feedgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .hero { background: radial-gradient(circle at 50% -30%, rgba(245,240,225,.08), transparent 55%), repeating-linear-gradient(90deg, transparent 0 46px, rgba(245,240,225,.04) 46px 48px), linear-gradient(160deg, ${T.turfDeep}, ${T.night}); border: 1px solid #243128; border-radius: 20px; padding: 36px; margin-bottom: 24px; }
    .hero-title { font-size: 38px; line-height: 1.1; color: #F7F4EA; }
    .banner { background: #E8442E; color: #ffffff; border-radius: 12px; padding: 14px 18px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none } }
    .md-root { overflow-x: hidden; }
    @keyframes spin { to { transform: rotate(360deg) } }
    .adm-wrap { display: flex; min-height: 100vh; }
    .adm-side { width: 216px; flex-shrink: 0; background: linear-gradient(180deg, #0c1512, #0d1014); border-right: 1px solid #243128; padding: 18px 12px; display: flex; flex-direction: column; gap: 18px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
    .adm-brand { display: flex; align-items: center; gap: 10px; padding: 4px 6px; }
    .adm-menu { display: flex; flex-direction: column; gap: 3px; }
    .adm-item { display: flex; align-items: center; gap: 10px; padding: 11px 12px; background: none; border: 0; border-left: 3px solid transparent; border-radius: 0 10px 10px 0; color: ${T.chalk}; font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; text-align: left; transition: background .15s; }
    .adm-item:hover { background: rgba(255, 212, 71, .06); }
    .adm-item.on { background: rgba(255, 212, 71, .1); border-left-color: ${T.floodlight}; color: ${T.floodlight}; font-weight: 700; }
    .adm-badge { margin-left: auto; background: ${T.live}; color: #fff; font-size: 10px; font-weight: 700; border-radius: 999px; padding: 2px 7px; }
    .adm-online { display: flex; align-items: center; gap: 8px; font-size: 12px; color: ${T.muted}; padding: 0 6px; }
    .adm-user { display: flex; align-items: center; gap: 10px; background: #12181420; border: 1px solid #243128; border-radius: 12px; padding: 10px; }
    .adm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .adm-topbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 22px 24px 14px; border-bottom: 1px solid #1a211c; position: sticky; top: 0; background: ${T.night}; z-index: 30; }
    .adm-pill { display: flex; align-items: center; gap: 6px; background: #131a15; border: 1px solid #243128; border-radius: 999px; padding: 7px 12px; font-size: 12px; }
    .adm-body { padding: 20px 24px 60px; max-width: 980px; }
    .adm-row { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #243128; background: #12161c; cursor: pointer; font-family: inherit; width: 100%; }
    .adm-row:hover { border-color: ${T.floodlight}; }
    @media (max-width: 760px) {
      .adm-side { width: 62px; padding: 14px 8px; }
      .adm-label { display: none; }
      .adm-item { justify-content: center; padding: 12px 8px; border-radius: 10px; border-left: 0; }
      .adm-item.on { border-left: 0; }
      .adm-badge { position: absolute; margin: 0; transform: translate(14px, -12px); }
      .adm-item { position: relative; }
      .adm-user { justify-content: center; padding: 8px; }
      .adm-avatar-full { display: none !important; }
      .adm-topbar, .adm-body { padding-left: 14px; padding-right: 14px; }
    }
    .user-pill { display: flex; align-items: center; gap: 9px; }
    .user-pill-clickable { cursor: pointer; padding: 4px 8px; border-radius: 999px; border: 1px solid #2A3A2E; transition: all .12s; }
    .user-pill-clickable:hover { border-color: ${T.floodlight}; background: #161E19; }
    .user-pill-clickable:active { transform: scale(.97); }
    .user-avatar-simple { width: 36px; height: 36px; border-radius: 50%; background: #14532D; display: flex; align-items: center; justify-content: center; font-family: 'Anton', sans-serif; font-size: 15px; color: #E6B31E; flex-shrink: 0; border: 1.5px solid rgba(255, 212, 71, .4); }
    .user-logout { width: 30px; height: 30px; border-radius: 50%; border: 1px solid #243128; background: transparent; color: #8FA396; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all .12s; }
    .user-logout:hover { color: ${T.live}; border-color: ${T.live}; }
    .card { max-width: 100%; min-width: 0; }
    .scoreboard { min-width: 0; }
    .scoreboard > div { min-width: 0; }
    .sb-name { font-weight: 700; font-size: 14px; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
    .sb-center { flex-shrink: 0; text-align: center; }
    @media (max-width: 640px) {
      .hero { padding: 22px }
      .hero-title { font-size: 27px }
      .topnav button { padding: 8px 10px; font-size: 12px }
      .user-avatar-simple { width: 32px; height: 32px; font-size: 13px }
      .user-pill { gap: 7px }
      .scoreboard { padding: 10px 8px; gap: 6px }
      .sb-name { font-size: 12px }
      .feedgrid { grid-template-columns: 1fr; gap: 12px }
      .card { padding: 14px }
      .btn { padding: 11px 14px; font-size: 14px }
    }
    @media (max-width: 400px) {
      .scoreboard { padding: 8px 6px; gap: 4px }
      .sb-name { font-size: 11px }
      .mini-logo { width: 32px !important; height: 32px !important; font-size: 13px !important }
    }
    @media (max-width: 380px) {
      .hero-title { font-size: 23px }
      .chip { font-size: 10px; padding: 3px 8px }
    }
    /* ---------- Fills the gap between the 640px and 400px breakpoints above ---------- */
    @media (max-width: 480px) {
      .topnav { gap: 4px; row-gap: 6px }
      .topnav button { padding: 7px 9px; font-size: 11.5px }
      header > div { padding: 10px 14px !important }
      .brand-title { font-size: 21px !important }
      .auth-title { font-size: 40px !important }
      .adm-brand .display { font-size: 14px !important }
    }
    /* ---------- Titles that were inline (so media queries couldn't reach them) now use these classes ---------- */
    .brand-title { white-space: nowrap; }
    .auth-title { white-space: nowrap; }
    /* ---------- Long unbroken text (emails, long names) never forces horizontal scroll ---------- */
    body, .card, .card * { overflow-wrap: break-word; }
    /* ---------- Wider general safety net ---------- */
    @media (max-width: 340px) {
      .brand-title { font-size: 18px !important }
      .btn { padding: 10px 12px; font-size: 13px }
      .input { padding: 11px 12px; font-size: 13px }
    }
  `;

  /* ============================================================ BOOT LOADER */
  if (booting || splashHeld) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 14,
        background: T.night,
        overflow: "hidden",
      }}>
        <style>{css}{`@keyframes spin { to { transform: rotate(360deg) } } .loader { width: 32px; height: 32px; border: 3px solid rgba(245,240,225,.2); border-top-color: ${T.floodlight}; border-radius: 50%; animation: spin .9s linear infinite; }`}</style>
        <svg width="96" height="96" viewBox="0 0 32 32" style={{ marginTop: -70 }}>
          <circle cx="16" cy="16" r="10" fill="none" stroke={T.floodlight} strokeWidth="1.8" />
          <path d="M16 9l5 3.6-2 6H13l-2-6z" fill={T.floodlight} />
        </svg>
        <div className="display" style={{ fontSize: 34, color: T.chalk, letterSpacing: ".5px" }}>AREA MATCH</div>
        <div style={{ fontSize: 11, color: T.floodlight, letterSpacing: ".2em", marginTop: -8 }}>COMMUNITY FOOTBALL</div>
        <div style={{ marginTop: 18 }}><div className="loader" /></div>
        <BootSlowNotice />
      </div>
    );
  }

  /* ============================================================ PASSWORD RECOVERY */
  if (screen === "recovery") {
    return (
      <div className="md-root" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px" }}>
        <style>{css}</style>
        <div style={{ maxWidth: 440, width: "100%" }}>
          <div className="display" style={{ fontSize: 40, color: T.floodlight, lineHeight: 1 }}>Reset Password</div>
          <div style={{ color: T.muted, marginTop: 8, marginBottom: 24 }}>Set a new password for your account.</div>
          <div className="card" style={{ display: "grid", gap: 12 }}>
            <PwInput autoComplete="new-password" placeholder="New password (8+ letters & numbers)"
              value={newPass} onChange={(e) => setNewPass(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 64))} />
            <PwInput autoComplete="new-password" placeholder="Confirm new password"
              value={newPass2} onChange={(e) => setNewPass2(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 64))} />
            <button className="btn btn-gold" onClick={async () => {
              if (!isStrongPassword(newPass)) return notify("Password must be 8+ characters with letters and numbers");
              if (newPass !== newPass2) return notify("Passwords don't match");
              const { error } = await supabase.auth.updateUser({ password: newPass });
              if (error) return notify(error.message);
              recoveryPending.current = false;
              setNewPass(""); setNewPass2("");
              notify("✔ Password updated — welcome back!");
              const { data: { session } } = await supabase.auth.getSession();
              if (session) loadMe(session.user.id); else setScreen("auth");
            }}>Save new password</button>
              <a href="https://wa.me/12704939553?text=Hi%2C%20I%20need%20help%20with%20my%20Area%20Match%20account" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.muted, textAlign: "center", textDecoration: "none" }}>
                Can't access your email? <b style={{ color: "#25D366" }}>💬 Contact support on WhatsApp</b>
              </a>
          </div>
        </div>
        {toast && <Toast msg={toast} />}
      </div>
    );
  }

  /* ============================================================ AUTH */
  if (screen === "auth") {
    return (
      <div className="md-root" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px" }}>
        <style>{css}</style>
        <div style={{ maxWidth: 440, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
            <svg width="44" height="44" viewBox="0 0 32 32" style={{ flexShrink: 0 }}><circle cx="16" cy="16" r="10" fill="none" stroke={T.floodlight} strokeWidth="2" /><path d="M16 9l5 3.6-2 6H13l-2-6z" fill={T.floodlight} /></svg>
            <div className="display auth-title" style={{ fontSize: 52, color: T.floodlight, lineHeight: 1 }}>Area Match</div>
          </div>
          <div style={{ color: T.muted, marginTop: 8, marginBottom: 16, fontSize: 17 }}>
            The community football website. Host matches, track them live, publish results for the fans.
          </div>
          <a href="/area-match.apk" download style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 13, color: T.floodlight, textDecoration: "none", fontWeight: 700 }}>
            📲 Download the Android app →
          </a>
          {authStep === "form" ? (
            <div className="card" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                {["signup", "login"].map((m) => (
                  <button key={m} className={`btn ${authMode === m ? "btn-gold" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setAuthMode(m)}>
                    {m === "signup" ? "Sign up" : "Log in"}
                  </button>
                ))}
              </div>
              <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="Email address" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value.slice(0, 254) })} />
              <PwInput autoComplete={authMode === "signup" ? "new-password" : "current-password"} placeholder={authMode === "signup" ? "Create password (8+ letters & numbers)" : "Password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 64) })} />
              {authMode === "signup" && (
                <PwInput autoComplete="new-password" placeholder="Confirm password" value={form.password2} onChange={(e) => setForm({ ...form, password2: e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 64) })} />
              )}
              {authMode === "signup" && (
                <>
                  <input className="input" placeholder="Your name (letters only)" maxLength={30} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.replace(/[^A-Za-z ]/g, "").slice(0, 30) })} />
                  <div style={{ display: "flex", gap: 6 }}>
                    {["Captain", "Fan", "Player"].map((r) => (
                      <button key={r} className={`btn ${form.role === r ? "btn-turf" : "btn-ghost"}`} style={{ flex: 1, padding: "10px 4px", fontSize: 12 }} onClick={() => setForm({ ...form, role: r })}>
                        {r === "Captain" ? "⚽ Captain" : r === "Fan" ? "📣 Fan" : "👤 Player"}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: -4, lineHeight: 1.4 }}>
                    {form.role === "Captain" ? "Host and manage your own matches."
                      : form.role === "Player" ? "Build your player profile, join a captain's squad, and track your goals."
                      : "Follow matches and captains near you."}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 4, fontWeight: 700 }}>📍 Your state (so we can show you matches near you)</div>
                    <StatePicker value={form.state} allLabel={null} label="Your state"
                      placeholder="Select your state…"
                      onChange={(st) => setForm({ ...form, state: st })} />
                  </div>
                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                    ⚽ <b>Captains</b> host matches, run the timer, and publish the official scores. 📣 <b>Fans</b> follow matches, like the big moments, and vote Man of the Match.
                  </div>
                </>
              )}
              {authMode === "login" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: T.chalk }}>
                    <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                    Remember me
                  </label>
                  <span style={{ color: T.floodlight, cursor: "pointer", fontWeight: 700 }} onClick={forgotPassword}>Forgot password?</span>
                </div>
              )}
              <button className="btn btn-gold" disabled={authBusy} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, opacity: authBusy ? .8 : 1 }} onClick={submitAuth}>
                {authBusy && <span style={{ width: 16, height: 16, border: "2.5px solid rgba(16,19,26,.3)", borderTopColor: "#0C120E", borderRadius: "50%", animation: "spin .8s linear infinite", display: "inline-block" }} />}
                {authBusy ? (authMode === "signup" ? "Creating account…" : "Logging in…") : (authMode === "signup" ? "Create account" : "Log in")}
              </button>
              <a href="https://wa.me/12704939553?text=Hi%2C%20I%20need%20help%20with%20my%20Area%20Match%20account" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.muted, textAlign: "center", textDecoration: "none" }}>
                Can't access your email? <b style={{ color: "#25D366" }}>💬 Contact support on WhatsApp</b>
              </a>
              <div style={{ fontSize: 12, color: T.muted }}>
                🔒 {authMode === "signup"
                  ? "No email verification needed — you're in immediately. Your password is stored encrypted; we can never read it."
                  : "Protected by attempt lockouts and encrypted passwords."}
              </div>
            </div>
          ) : (
            <div className="card" style={{ display: "grid", gap: 12 }}>
              <div style={{ fontWeight: 700 }}>Reset password — enter the 6-digit code sent to {form.contact}</div>
              <div style={{ fontSize: 13, color: T.floodlight }}>Check your inbox (and spam folder). The code expires shortly, so use it now.</div>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" maxLength={6} value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, "") })} />
              <div style={{ fontSize: 11, color: T.muted }}>🔒 Codes are single-use and entry locks after {MAX_OTP_ATTEMPTS} wrong attempts.</div>
              <button className="btn btn-gold" onClick={verifyResetCode}>Verify code →</button>
              <button className="btn btn-ghost" onClick={() => forgotPassword()}>Resend code</button>
              <button className="btn btn-ghost" onClick={() => { if (document.activeElement) document.activeElement.blur(); setAuthStep("form"); }}>Back</button>
            </div>
          )}
        </div>
        {toast && <Toast msg={toast} />}
      </div>
    );
  }

  /* ============================================================ WEBSITE */
  /* Comma-separated roster → clean name list; empty roster falls back to Player 1, Player 2… */
  const rosterNames = (str) => {
    const list = (str || "").split(",").map((s) => s.trim()).filter(Boolean);
    return list.length ? list : Array.from({ length: 7 }, (_, i) => `Player ${i + 1}`);
  };
  const publishedAll = matches.filter((m) => m.published && isFresh(m) && m.status !== "Cancelled");
  const published = publishedAll.filter((m) => m.status !== "AwaitingScore" &&
    (feedFollowedOnly ? follows.includes(m.createdBy) : (feedState === "All" || captainState(m) === feedState)));
  const awaitingResults = publishedAll.filter((m) => m.status === "AwaitingScore" &&
    (feedFollowedOnly ? follows.includes(m.createdBy) : (feedState === "All" || captainState(m) === feedState)));
  const inMyState = me && me.state ? publishedAll.filter((m) => captainState(m) === me.state && m.status !== "ResultPublished") : [];

  /* ---------- FEED INTELLIGENCE ----------
     Upcoming fixtures, auto-generated milestones and leaderboards — all derived from
     match results and profiles already in the database. No new tables needed. */
  /* Full fixture list — the feed shows a preview, the fixtures page shows all of it */
  const allUpcomingFixtures = matches
    .filter((m) => m.published && m.status === "Scheduled" && m.date && m.time &&
      new Date(`${m.date}T${m.time}`).getTime() > now)
    .sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));

  const upcomingFixtures = allUpcomingFixtures
    .filter((m) => (feedFollowedOnly ? follows.includes(m.createdBy) : (feedState === "All" || captainState(m) === feedState)))
    .slice(0, 4);

  /* Leaderboards — scoped to the same state/follow filter the rest of the feed uses */

  const capped = (key, list) => (seeMore[key] ? list : list.slice(0, 2));
  const SeeMoreBtn = ({ k, list }) => {
    if (list.length <= 2) return null;
    return seeMore[k] ? (
      <button className="btn btn-ghost" style={{ margin: "4px 0 20px", width: "100%" }} onClick={() => setSeeMore((x) => ({ ...x, [k]: false }))}>
        See less
      </button>
    ) : (
      <button className="btn btn-ghost" style={{ margin: "4px 0 20px", width: "100%" }} onClick={() => setSeeMore((x) => ({ ...x, [k]: true }))}>
        See more ({list.length - 2} more)
      </button>
    );
  };
  const upcoming = published.filter((m) => m.status === "Scheduled");
  const liveNow = published.filter((m) => m.status === "Live")
    .sort((a, b) => (myLikes.includes(b.id) ? 1 : 0) - (myLikes.includes(a.id) ? 1 : 0));
  const results = published.filter((m) => m.status === "ResultPublished");
  const mine = matches.filter((m) => m.createdBy === me.id);
  /* 🔴 Live tab — "Captains I follow" and state are alternate modes, not combinable filters:
     when follow mode is on, state is ignored entirely, and vice versa. */
  const liveForUser = matches.filter((m) => m.published && m.status === "Live" &&
    (liveFollowedOnly ? follows.includes(m.createdBy) : (liveStateFilter === "All" || captainState(m) === liveStateFilter)));
  const liveDetailMatch = liveDetailFor ? matches.find((m) => m.id === liveDetailFor) : null;

  return (
    <div className="md-root">
      <style>{css}</style>

      {/* ---------- TOP NAV (website header) ---------- */}
      {me.role === "Admin" ? (
        /* ==================== ADMIN DASHBOARD ==================== */
        <div className="adm-wrap">
          {/* SIDEBAR — the only navigation an admin needs */}
          <aside className="adm-side">
            <div className="adm-brand">
              <svg width="26" height="26" viewBox="0 0 32 32" style={{ flexShrink: 0 }}><circle cx="16" cy="16" r="10" fill="none" stroke={T.floodlight} strokeWidth="1.8" /><path d="M16 9l5 3.6-2 6H13l-2-6z" fill={T.floodlight} /></svg>
              <div className="adm-label">
                <div className="display" style={{ fontSize: 16, color: T.floodlight, lineHeight: 1 }}>AREA MATCH</div>
                <div style={{ fontSize: 9, color: T.muted, letterSpacing: ".22em", fontWeight: 700 }}>ADMIN CONTROL</div>
              </div>
            </div>

            <div className="adm-menu">
              {[["newsfeed", "📰", "Newsfeed"], ["active", "🟢", "Active Users"], ["post", "📢", "Post to Feed"], ["scores", "🏁", "Awaiting Scores"], ["requests", "📨", "Match Requests"], ["feedback", "💡", "Feature Requests"], ["newusers", "🆕", "New Users"], ["blocked", "🚫", "Blocked Users"], ["users", "👥", "Users & Blocking"], ["settings", "⚙️", "Settings"]].map(([k, icon, label]) => (
                <button key={k} className={`adm-item ${adminSection === k ? "on" : ""}`} onClick={() => setAdminSection(k)}>
                  <span style={{ fontSize: 17 }}>{icon}</span>
                  <span className="adm-label">{label}</span>
                  {k === "scores" && matches.filter((x) => x.status === "AwaitingScore").length > 0 && (
                    <span className="adm-badge">{matches.filter((x) => x.status === "AwaitingScore").length}</span>
                  )}
                  {k === "requests" && requests.filter((r) => r.status === "pending").length > 0 && (
                    <span className="adm-badge">{requests.filter((r) => r.status === "pending").length}</span>
                  )}
                </button>
              ))}
            </div>

            <div style={{ marginTop: "auto", display: "grid", gap: 10 }}>
              <div className="adm-online adm-label">
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1DB954", display: "inline-block" }} />
                {onlineCount} online now
              </div>
              <div className="adm-user">
                <div className="adm-avatar-full" style={{ width: 36, height: 36, borderRadius: 10, background: T.floodlight, color: T.night, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", flexShrink: 0 }}>
                  {me.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="adm-label" style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.name}</div>
                  <button onClick={logout} style={{ background: "none", border: 0, color: T.live, fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 700 }}>Log out →</button>
                </div>
                <button onClick={logout} title="Log out" style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid #2A3A2E", background: "transparent", color: T.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                    <line x1="12" y1="2" x2="12" y2="12" />
                  </svg>
                </button>
              </div>
            </div>
          </aside>

          {/* CONTENT */}
          <div className="adm-main">
            <div className="adm-topbar">
              <div>
                <div className="display" style={{ fontSize: 26, lineHeight: 1 }}>
                  {{ newsfeed: "Newsfeed", active: "Active Users", post: "Post to Feed", scores: "Awaiting Scores", requests: "Match Requests", feedback: "Feature Requests", users: "Users & Blocking", newusers: "New Users", blocked: "Blocked Users", settings: "Settings" }[adminSection]}
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{new Date(now).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["🟢", onlineCount, "online"], ["👥", users.length, "users"], ["⚽", matches.filter((x) => x.status === "Live").length, "live"]].map(([i, v, l]) => (
                  <div key={l} className="adm-pill"><span>{i}</span><b>{v}</b><span className="adm-label" style={{ color: T.muted }}>{l}</span></div>
                ))}
              </div>
            </div>

            <div className="adm-body">
              {adminSection === "newsfeed" && (
                <>
                  {adminPosts.map((p) => (
                    <div key={p.id} className="card" style={{ marginBottom: 10, borderColor: "#E6B31E" }}>
                      <span className="chip" style={{ background: T.floodlight, color: T.night }}>📢 Area Match</span>
                      <div style={{ fontSize: 14, marginTop: 8 }}>{p.message}</div>
                    </div>
                  ))}
                  {events.slice(0, 3).map((e) => (
                    <div key={e.id} className="card" style={{ marginBottom: 8, fontSize: 13, padding: 12, display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{e.message}</span>
                      <span style={{ color: T.muted, fontSize: 11, whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  ))}
                  <div className="feedgrid" style={{ marginTop: 12 }}>
                    {publishedAll.slice(0, 6).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                  </div>
                </>
              )}

              {adminSection === "active" && (
                <div style={{ display: "grid", gap: 8 }}>
                  {capped("admin-active", [...users].sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))).map((u) => {
                    const mins = u.lastSeen ? Math.floor((now - new Date(u.lastSeen).getTime()) / 60000) : null;
                    const online = mins !== null && mins < 3;
                    return (
                      <button key={u.id} className="card adm-row" onClick={() => setAdminViewUser(u.id)}>
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: T.turf, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", color: T.floodlight, position: "relative", flexShrink: 0 }}>
                          {u.name.slice(0, 1).toUpperCase()}
                          {online && <span style={{ position: "absolute", bottom: -2, right: -2, width: 11, height: 11, borderRadius: "50%", background: "#1DB954", border: "2px solid #161E19" }} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: T.chalk }}>{u.name} {u.blocked && <span className="chip" style={{ background: "#3a1f1a", color: T.live, marginLeft: 4 }}>Blocked</span>}</div>
                          <div style={{ fontSize: 12, color: T.muted }}>{u.role}{u.state ? ` · ${u.state}` : ""} · {online ? "🟢 online now" : mins === null ? "never seen" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`}</div>
                        </div>
                        <span style={{ color: T.muted }}>›</span>
                      </button>
                    );
                  })}
                  <SeeMoreBtn k="admin-active" list={users} />
                </div>
              )}

              {adminSection === "post" && (
                <div className="card" style={{ display: "grid", gap: 10, maxWidth: 560 }}>
                  <textarea className="input" rows={3} maxLength={280} placeholder="Announcement for all users"
                    value={adminPostText} onChange={(e) => setAdminPostText(sanitizeText(e.target.value, 280))} style={{ resize: "none", fontFamily: "'Space Grotesk', sans-serif" }} />
                  <button className="btn btn-gold" disabled={!adminPostText.trim()} style={{ opacity: adminPostText.trim() ? 1 : .5 }}
                    onClick={async () => {
                      const { error } = await supabase.from("posts").insert({ author_id: me.id, message: adminPostText.trim() });
                      if (error) return notify(error.message);
                      setAdminPostText("");
                      refreshAll();
                      notify("📢 Posted to the News Feed");
                    }}>Post announcement</button>
                  {capped("admin-posts", adminPosts).map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13, background: "#131a15", borderRadius: 10, padding: "8px 12px" }}>
                      <span style={{ flex: 1 }}>{p.message}</span>
                      <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11, color: T.live, borderColor: "#3a1f1a" }}
                        onClick={async () => { await supabase.from("posts").delete().eq("id", p.id); refreshAll(); notify("Announcement deleted"); }}>Delete</button>
                    </div>
                  ))}
                  <SeeMoreBtn k="admin-posts" list={adminPosts} />
                </div>
              )}

              {adminSection === "scores" && (
                <>
                  {matches.filter((m) => m.status === "AwaitingScore").length === 0 && <div className="card" style={{ color: T.muted }}>No matches waiting on a captain's score.</div>}
                  {capped("admin-scores", matches.filter((m) => m.status === "AwaitingScore")).map((m) => {
                    const mins = m.awaitingSince ? Math.floor((now - new Date(m.awaitingSince).getTime()) / 60000) : 0;
                    return (
                      <div key={m.id} className="card" style={{ marginBottom: 10, fontSize: 14, display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700 }}>{m.teamA.name} vs {m.teamB.name}</span>
                          <span className="chip" style={{ background: mins >= 25 ? "#3a1f1a" : "#243128", color: mins >= 25 ? T.live : T.chalk }}>waiting {mins} min{mins === 1 ? "" : "s"}</span>
                        </div>
                        <div style={{ fontSize: 12, color: T.muted }}>Waiting on the captain's official result. Send them a nudge:</div>
                        <button className="btn btn-gold" style={{ fontSize: 13 }} onClick={async () => {
                          const cap = users.find((u) => u.id === m.createdBy);
                          const { error } = await supabase.from("notifications").insert({
                            user_id: m.createdBy,
                            message: `Reminder from the admin: please upload the result for ${m.teamA.name} vs ${m.teamB.name} — fans are waiting!`,
                          });
                          if (error) return notify(error.message);
                          notify(`🔔 Reminder sent to ${cap ? cap.name : "the captain"}. Tap again to send another.`);
                        }}>🔔 Send reminder to captain</button>
                      </div>
                    );
                  })}
                  <SeeMoreBtn k="admin-scores" list={matches.filter((m) => m.status === "AwaitingScore")} />
                </>
              )}

              {adminSection === "requests" && (
                <>
                  {requests.filter((r) => r.status === "pending").length === 0 && <div className="card" style={{ color: T.muted }}>No pending requests.</div>}
                  {capped("admin-requests", requests.filter((r) => r.status === "pending")).map((r) => {
                    const m = matches.find((x) => x.id === r.match_id);
                    const cap = users.find((u) => u.id === r.captain_id);
                    if (!m) return null;
                    return (
                      <div key={r.id} className="card" style={{ marginBottom: 10, display: "grid", gap: 8, fontSize: 14 }}>
                        <div style={{ fontWeight: 700 }}>✏️ Score correction: {m.teamA.name} {m.finalA}–{m.finalB} {m.teamB.name}</div>
                        <div style={{ fontSize: 13, color: T.muted }}>From {cap ? cap.name : "captain"} — "{r.reason}"</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="btn btn-ghost" style={{ flex: 1, fontSize: 13 }} onClick={async () => {
                            await supabase.from("match_requests").update({ status: "denied" }).eq("id", r.id);
                            refreshAll(); notify("Request denied");
                          }}>Deny</button>
                          <button className="btn btn-gold" style={{ flex: 1, fontSize: 13 }} onClick={async () => {
                            await supabase.from("matches").update({ status: "AwaitingScore", awaiting_since: new Date().toISOString() }).eq("id", m.id);
                            await supabase.from("match_requests").update({ status: "approved" }).eq("id", r.id);
                            refreshAll();
                            notify("Approved — the captain can now upload the corrected score.");
                          }}>Approve</button>
                        </div>
                      </div>
                    );
                  })}
                  <SeeMoreBtn k="admin-requests" list={requests.filter((r) => r.status === "pending")} />
                </>
              )}

              {adminSection === "feedback" && (
                <>
                  {feedbacks.length === 0 && <div className="card" style={{ color: T.muted }}>No feedback yet. Requests from the "coming soon" prompts land here.</div>}
                  {capped("admin-feedback", feedbacks).map((f) => (
                    <div key={f.id} className="card" style={{ marginBottom: 8, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span className="chip" style={{ background: "#243128", color: T.floodlight }}>{f.feature}</span>
                        <span style={{ color: T.muted, fontSize: 11 }}>{users.find((u) => u.id === f.userId)?.name || "User"}</span>
                      </div>
                      <div style={{ color: T.chalk }}>{f.msg}</div>
                    </div>
                  ))}
                  <SeeMoreBtn k="admin-feedback" list={feedbacks} />
                </>
              )}

              {adminSection === "users" && (
                <>
                  <div className="feedgrid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", marginBottom: 14 }}>
                    {[["🟢 Online", onlineCount], ["Total", users.length], ["Captains", users.filter((u) => u.role === "Captain").length], ["Fans", users.filter((u) => u.role === "Fan").length]].map(([l, v]) => (
                      <div key={l} className="card" style={{ textAlign: "center", padding: 12 }}>
                        <div style={{ fontSize: 10, color: T.muted, letterSpacing: ".05em", textTransform: "uppercase", fontWeight: 700 }}>{l}</div>
                        <div className="display" style={{ fontSize: 22, color: T.floodlight }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {["Admin", "Captain", "Fan"].map((role) => {
                    const group = users.filter((u) => u.role === role);
                    return (
                      <div key={role} style={{ marginBottom: 16 }}>
                        <SectionTitle color={role === "Admin" ? T.floodlight : T.chalk}>{role}s ({group.length})</SectionTitle>
                        <div style={{ display: "grid", gap: 6 }}>
                          {capped("admin-users-" + role, group).map((u) => (
                            <div key={u.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, padding: 12, gap: 8 }}>
                              <button style={{ background: "none", border: 0, color: T.chalk, cursor: "pointer", textAlign: "left", minWidth: 0, padding: 0, fontFamily: "inherit", fontSize: 14 }} onClick={() => setAdminViewUser(u.id)}>
                                <span style={{ fontWeight: 700 }}>{u.name}</span>
                                <span style={{ color: T.muted, fontSize: 12 }}> · {u.state || "—"} · joined {u.joined}</span>
                              </button>
                              {u.role !== "Admin" && (
                                <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 11, color: u.blocked ? "#1DB954" : T.live, borderColor: u.blocked ? "#173a26" : "#3a1f1a", flexShrink: 0 }}
                                  onClick={async () => {
                                    await supabase.from("profiles").update({ blocked: !u.blocked }).eq("id", u.id);
                                    refreshAll();
                                    notify(u.blocked ? `${u.name} unblocked` : `${u.name} blocked — they can no longer log in`);
                                  }}>{u.blocked ? "Unblock" : "Block"}</button>
                              )}
                            </div>
                          ))}
                        </div>
                        <SeeMoreBtn k={"admin-users-" + role} list={group} />
                      </div>
                    );
                  })}
                </>
              )}
              {adminSection === "newusers" && (
                <div style={{ display: "grid", gap: 8 }}>
                  {(() => {
                    const fresh = users.filter((u) => u.joined && (Date.now() - new Date(u.joined).getTime()) <= 3 * 86400000);
                    if (fresh.length === 0) return <div className="card" style={{ color: T.muted }}>No new sign-ups in the last 3 days.</div>;
                    return (
                      <>
                        {capped("admin-newusers", fresh).map((u) => (
                          <button key={u.id} className="card adm-row" onClick={() => setAdminViewUser(u.id)}>
                            <div style={{ width: 38, height: 38, borderRadius: 12, background: T.turf, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", color: T.floodlight, flexShrink: 0 }}>{u.name.slice(0, 1).toUpperCase()}</div>
                            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: T.chalk }}>{u.name} <span className="chip" style={{ background: T.floodlight, color: T.night, marginLeft: 4 }}>NEW</span></div>
                              <div style={{ fontSize: 12, color: T.muted }}>{u.role} · {u.state || "—"} · {u.email || ""} · joined {u.joined}</div>
                            </div>
                            <span style={{ color: T.muted }}>›</span>
                          </button>
                        ))}
                        <SeeMoreBtn k="admin-newusers" list={fresh} />
                      </>
                    );
                  })()}
                </div>
              )}

              {adminSection === "blocked" && (
                <div style={{ display: "grid", gap: 8 }}>
                  {users.filter((u) => u.blocked).length === 0 && <div className="card" style={{ color: T.muted }}>No blocked users. 🎉</div>}
                  {capped("admin-blocked", users.filter((u) => u.blocked)).map((u) => (
                    <div key={u.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name} <span className="chip" style={{ background: "#3a1f1a", color: T.live, marginLeft: 4 }}>Blocked</span></div>
                        <div style={{ fontSize: 12, color: T.muted }}>{u.role} · {u.state || "—"} · {u.email || ""}</div>
                      </div>
                      <button className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 12, color: "#1DB954", borderColor: "#173a26", flexShrink: 0 }}
                        onClick={async () => {
                          await supabase.from("profiles").update({ blocked: false }).eq("id", u.id);
                          if (u.email) await supabase.from("blocked_emails").delete().eq("email", u.email.toLowerCase());
                          refreshAll();
                          notify(`✓ ${u.name} unblocked — they can log in and their email is free again.`);
                        }}>✓ Unblock</button>
                    </div>
                  ))}
                  <SeeMoreBtn k="admin-blocked" list={users.filter((u) => u.blocked)} />
                </div>
              )}

              {adminSection === "settings" && (
                <div className="card" style={{ display: "grid", gap: 10, maxWidth: 560 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.floodlight }}>💬 Customer Support Link</div>
                  <div style={{ fontSize: 12, color: T.muted }}>Shown in the footer for every user. Use a WhatsApp link (wa.me/234…), an email (mailto:support@…), or any web page. Leave empty to hide it.</div>
                  <input className="input" maxLength={200} placeholder="e.g. https://wa.me/2348031234567" value={supportDraft}
                    onChange={(e) => setSupportDraft(e.target.value.slice(0, 200))} />
                  <button className="btn btn-gold" onClick={async () => {
                    const { error } = await supabase.from("site_settings").upsert({ key: "support_link", value: supportDraft.trim() });
                    if (error) return notify(error.message);
                    setSupportLink(supportDraft.trim());
                    notify("✔ Support link updated for all users");
                  }}>Save support link</button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
      <>
      <header style={{ borderBottom: "1px solid #243128", position: "sticky", top: 0, background: T.night, zIndex: 40 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 12 }}>
            <div className="display brand-title" style={{ fontSize: 26, color: T.floodlight }}>Area Match</div>
            {(me.role === "Captain" || me.role === "Player") && (
              <div style={{ position: "relative", marginLeft: "auto", marginRight: 8 }}>
                <button title="Notifications"
                  onClick={() => { setBellOpen((v) => !v); }}
                  style={{ position: "relative", width: 34, height: 34, borderRadius: 10, cursor: "pointer",
                    background: bellOpen ? "rgba(230,179,30,.12)" : "none",
                    border: `1px solid ${bellOpen || unreadBell.length > 0 ? "#E6B31E" : "#2A3A2E"}`,
                    color: "#F5F0E1", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  🔔
                  {unreadBell.length > 0 && (
                    <span style={{ position: "absolute", top: -6, right: -6, background: "#E8442E", color: "#fff", fontSize: 9, fontWeight: 700, minWidth: 17, height: 17, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", border: "2px solid #0C120E" }}>
                      {unreadBell.length > 9 ? "9+" : unreadBell.length}
                    </span>
                  )}
                </button>
              </div>
            )}
            <div className={`user-pill ${me.role !== "Admin" ? "user-pill-clickable" : ""}`} title="View profile" onClick={() => me.role !== "Admin" && setPage("profile")}>
              <div className="user-avatar-simple">{me.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{me.name}{me.role !== "Admin" && <span style={{ color: T.muted, fontWeight: 400 }}> ›</span>}</div>
              </div>
              <button className="user-logout" title="Log out" onClick={(e) => { e.stopPropagation(); logout(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                  <line x1="12" y1="2" x2="12" y2="12" />
                </svg>
              </button>
            </div>
          </div>
          <nav className="topnav">
            <button className={page === "feed" ? "on" : ""} onClick={() => setPage("feed")}>News Feed</button>
            {(me.role === "Fan" || me.role === "Player") && <button className={page === "captains" ? "on" : ""} onClick={() => { setCaptainCameFrom(null); setPage("captains"); setViewCaptain(null); }}>Captains</button>}
            <button className={page === "live" ? "on" : ""} onClick={() => setPage("live")}>Live</button>
            {me.role === "Captain" && <button className={page === "mymatches" || page === "create" ? "on" : ""} onClick={() => setPage("mymatches")}>My Matches</button>}
            {me.role === "Player" && <button className={page === "myplayer" ? "on" : ""} onClick={() => setPage("myplayer")}>My Profile</button>}
            <button className={page === "about" ? "on" : ""} onClick={() => setPage("about")}>About</button>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px 60px" }}>

        {/* KICK-OFF PERMISSION BANNER — scheduled time is due, captain decides */}
        {me.role === "Captain" && (() => {
          const due = matches.filter((m) => m.status === "Scheduled" && m.createdBy === me.id && isDue(m));
          if (due.length === 0) return null;
          /* One compact line however many are due — the bell holds the detail. */
          return (
            <div className="tappable" onClick={() => setBellOpen(true)}
              style={{ background: "#0E140F", border: "1px solid #1b241c", borderLeft: "2px solid #D6A81D", borderRadius: "0 11px 11px 0", padding: 12, marginBottom: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 9, letterSpacing: "1.3px", textTransform: "uppercase", color: "#D6A81D", fontWeight: 700 }}>
                  {due.length === 1 ? "1 match ready" : `${due.length} matches ready`}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6, color: "#F7F4EA" }}>Kick-off time reached</div>
                <div style={{ fontSize: 10, color: "#7d8f83", marginTop: 3, lineHeight: 1.45 }}>
                  {due.length === 1
                    ? `${due[0].teamA.name} vs ${due[0].teamB.name} — tap to start or postpone.`
                    : "Tap to start them, or postpone."}
                </div>
              </div>
              <span style={{ fontSize: 11, color: "#4e5c53", flexShrink: 0 }}>›</span>
            </div>
          );
        })()}

        {/* SCORE REQUEST BANNER — carousel when a captain has more than one overdue score */}
        {pendingScores.length > 0 && (() => {
          const idx = pendingScoreSlide % pendingScores.length;
          const m = pendingScores[idx];
          const mins = m.awaitingSince ? Math.floor((now - new Date(m.awaitingSince).getTime()) / 60000) : 0;
          return (
            <div className="banner" style={{ marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span>
                  {mins >= 20 ? `⚠️ ${mins} MINUTES LATE — ` : "🏁 Full time: "}
                  {m.teamA.name} vs {m.teamB.name}. Upload the result to publish it.
                </span>
                <button className="btn btn-gold" style={{ padding: "8px 14px", flexShrink: 0 }} onClick={() => openMatchDetail(m.id)}>Upload result</button>
              </div>
              {pendingScores.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <button onClick={() => setPendingScoreSlide((i) => (i - 1 + pendingScores.length) % pendingScores.length)} style={{ background: "none", border: "1px solid rgba(255,255,255,.3)", color: "#fff", borderRadius: 8, width: 26, height: 26, fontSize: 13 }}>‹</button>
                  <div style={{ display: "flex", gap: 5 }}>
                    {pendingScores.map((_, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === idx ? "#fff" : "rgba(255,255,255,.35)" }} />)}
                  </div>
                  <button onClick={() => setPendingScoreSlide((i) => (i + 1) % pendingScores.length)} style={{ background: "none", border: "1px solid rgba(255,255,255,.3)", color: "#fff", borderRadius: 8, width: 26, height: 26, fontSize: 13 }}>›</button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ---------- NEWS FEED (homepage) ---------- */}
        {page === "feed" && (
          <>
            {/* LIVE TICKER */}
            {events.length > 0 && (
              <div style={{ background: "#141c16", border: `1px solid #243128`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "grid", gap: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#E8442E", letterSpacing: ".1em" }}>⚡ LIVE UPDATES</div>
                {events.slice(0, 3).map((e) => (
                  <div key={e.id} style={{ fontSize: 13, display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ flex: 1 }}>{e.message}</span>
                    <span style={{ color: "#7d8f83", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            )}

            {/* FILTERS */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ minWidth: 190, flex: "1 1 190px" }}>
                <StatePicker value={feedState} counts={stateCounts} disabled={feedFollowedOnly}
                  onChange={(st) => { setFeedFollowedOnly(false); setFeedState(st); }} />
              </div>
              {me.role === "Fan" && follows.length > 0 && (
                <button className={`btn ${feedFollowedOnly ? "btn-gold" : "btn-ghost"}`} style={{ padding: "9px 14px", fontSize: 13 }}
                  onClick={() => { setFeedFollowedOnly(!feedFollowedOnly); if (!feedFollowedOnly) setFeedState("All"); }}>🔔 Captains I follow</button>
              )}
            </div>

            <div className="hero-carousel" style={{ position: "relative", overflow: "hidden", borderRadius: 16, marginBottom: 20, height: 280 }}>
              <div className="hero" style={{ opacity: heroSlide === 0 ? 1 : 0, transition: "opacity 1s ease", position: "absolute", inset: 0, pointerEvents: heroSlide === 0 ? "auto" : "none", display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden", marginBottom: 0 }}>
                <div className="display hero-title">
                  Your community.<br /><span style={{ color: "#E6B31E" }}>Your matches. Live.</span>
                </div>
                <div style={{ color: "#7d8f83", marginTop: 10, maxWidth: 520 }}>
                  Follow published matches from local captains, and catch every score update the moment it happens on 🔴 Live. Results go live the moment the captain submits the final score.
                </div>
              </div>
              <div style={{ opacity: heroSlide === 1 ? 1 : 0, transition: "opacity 1s ease", position: "absolute", inset: 0, pointerEvents: heroSlide === 1 ? "auto" : "none", backgroundImage: "url('/hero-photo.jpeg')", backgroundSize: "cover", backgroundPosition: "center", borderRadius: 16 }}>
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(6,9,7,.15) 0%, rgba(6,9,7,.2) 55%, rgba(6,9,7,.9) 100%)", borderRadius: 16 }} />
                <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center" }}>
                  <div className="display" style={{ fontSize: 22, color: "#F5F0E1", lineHeight: 1.1 }}>YOUR COMMUNITY</div>
                  <div className="display" style={{ fontSize: 22, color: "#E6B31E", lineHeight: 1.1 }}>FOOTBALL LIVE</div>
                </div>
              </div>
            </div>

            {/* Admin announcements */}
            {adminPosts.length > 0 && adminPosts.slice(0, 3).map((p) => (
              <div key={p.id} className="card" style={{ marginBottom: 12, borderColor: "#E6B31E", borderWidth: 1.5 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span className="chip" style={{ background: "#E6B31E", color: "#0A0D0A" }}>📢 Area Match</span>
                  <span style={{ fontSize: 11, color: "#7d8f83" }}>{(p.created_at || "").slice(0, 10)}</span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>{p.message}</div>
              </div>
            ))}

            {/* Matches from captains you follow */}
            {me.role === "Fan" && follows.length > 0 && (() => {
              const followed = published.filter((m) => follows.includes(m.createdBy) && m.status !== "ResultPublished");
              return followed.length > 0 ? (
                <>
                  <SectionTitle color={"#E6B31E"}>🔔 From Captains You Follow</SectionTitle>
                  <div className="feedgrid" style={{ marginBottom: 28 }}>
                    {followed.map((m) => <MatchCard key={"f" + m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                  </div>
                </>
              ) : null;
            })()}

            {milestones.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 11, display: "flex", justifyContent: "space-between" }}>
                  <span>This week</span>
                  {milestones.length > 1 && <span style={{ color: "#4e5c53", letterSpacing: 0, textTransform: "none", fontSize: 10 }}>swipe →</span>}
                </div>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
                  {milestones.map((ms) => (
                    <div key={ms.id}
                      className="tappable" onClick={() => { if (ms.playerId) openPlayerProfile(ms.playerId); else if (ms.teamId) openTeamProfile(ms.teamId); }}
                      style={{ flexShrink: 0, width: 186, background: "#0E140F", border: `1px solid #243128`, borderLeft: `2px solid ${ms.accent}`, borderRadius: 9, padding: "10px 12px", cursor: "pointer" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.3, color: "#F7F4EA" }}>{ms.head}</div>
                      {ms.sub && <div style={{ fontSize: 9.5, color: "#7d8f83", marginTop: 3 }}>{ms.sub}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {liveNow.length > 0 && (
              <>
                <SectionTitle color={"#E8442E"}>● Live Now</SectionTitle>
                <div className="feedgrid" style={{ marginBottom: 28 }}>
                  {liveNow.map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                </div>
              </>
            )}

            {awaitingResults.length > 0 && (
              <>
                <SectionTitle color={"#E6B31E"}>⏳ Awaiting Results</SectionTitle>
                <div className="feedgrid" style={{ marginBottom: 28 }}>
                  {awaitingResults.map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                </div>
              </>
            )}

            {upcomingFixtures.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Coming up{feedState !== "All" ? ` in ${feedState}` : " near you"}</span>
                  {allUpcomingFixtures.length > upcomingFixtures.length && (
                    <span className="tappable" onClick={() => { setFixState(feedState); setShowFixtures(true); pushCloseable(() => setShowFixtures(false)); }}
                      style={{ color: "#D6A81D", letterSpacing: 0, textTransform: "none", fontSize: 10.5, fontWeight: 500, cursor: "pointer" }}>
                      All {allUpcomingFixtures.length} ›
                    </span>
                  )}
                </div>
                {upcomingFixtures.map((m) => {
                  const kickoff = new Date(`${m.date}T${m.time}`).getTime();
                  const hoursOut = (kickoff - now) / 3600000;
                  const d = new Date(kickoff);
                  const soon = hoursOut < 24;
                  return (
                    <div key={m.id} className="tappable" onClick={() => openMatchDetail(m.id)}
                      style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: `1px solid #151c16`, cursor: "pointer" }}>
                      <div style={{ width: 42, textAlign: "center", flexShrink: 0 }}>
                        <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 15, lineHeight: 1, color: soon ? "#D6A81D" : "#F7F4EA" }}>
                          {soon ? Math.max(1, Math.round(hoursOut)) : d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
                        </div>
                        <div style={{ fontSize: 8, color: "#4e5c53", letterSpacing: ".8px", textTransform: "uppercase", marginTop: 3 }}>
                          {soon ? "hrs" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name} vs {m.teamB.name}</div>
                        <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.location}</div>
                      </div>
                      <div style={{ fontSize: 9.5, color: "#D6A81D", fontWeight: 600, flexShrink: 0 }}>{m.time}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {feedState !== "All" && published.length === 0 && (
              <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: 22 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📍</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>No matches in {feedState} yet</div>
                <div style={{ fontSize: 13, color: "#7d8f83" }}>No captain has published a match in {feedState}. Check back soon, or switch to 🌍 All states to see everything.</div>
              </div>
            )}

            {inMyState.length > 0 && feedState === "All" && !feedFollowedOnly && (
              <>
                <SectionTitle color={"#E6B31E"}>📍 Matches in {me.state}</SectionTitle>
                <div className="feedgrid" style={{ marginBottom: 8 }}>
                  {capped("mystate", inMyState).map((m) => <MatchCard key={"st" + m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                </div>
                <SeeMoreBtn k="mystate" list={inMyState} />
              </>
            )}

            <SectionTitle color={"#E6B31E"}>Upcoming Matches</SectionTitle>
            {upcoming.length === 0 && <div className="card" style={{ color: "#7d8f83", marginBottom: 28 }}>No upcoming published matches yet.</div>}
            <div className="feedgrid" style={{ marginBottom: 8 }}>
              {capped("upcoming", upcoming).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
            </div>

            <SeeMoreBtn k="upcoming" list={upcoming} />

            <SectionTitle color={"#F5F0E1"}>Results</SectionTitle>
            {results.length === 0 && <div className="card" style={{ color: "#7d8f83" }}>No results published yet. Results appear here once captains submit final scores.</div>}
            <div className="feedgrid" style={{ marginBottom: 8 }}>
              {capped("results", results).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
            </div>
            <SeeMoreBtn k="results" list={results} />

            {(leaderboards.topScorers.length > 0 || leaderboards.teamForm.length > 0) && (
              <div className="tappable" onClick={() => { setShowLeaderboards(true); pushCloseable(() => setShowLeaderboards(false)); }}
                style={{ background: "#0E140F", border: `1px solid #243128`, borderRadius: 10, padding: 13, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "#F7F4EA" }}>Leaderboards</div>
                  <div style={{ fontSize: 9.5, color: "#7d8f83", marginTop: 2 }}>Top scorers · team form · most supported</div>
                </div>
                <div style={{ color: "#D6A81D", fontSize: 11 }}>View ›</div>
              </div>
            )}
          </>
        )}

        {/* ---------- MY MATCHES ---------- */}
        {page === "mymatches" && me.role === "Captain" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
              <div className="display" style={{ fontSize: 24 }}>My Matches</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setPage("myteams")}>🏷 My Teams</button>
                <button className="btn btn-gold" onClick={() => setPage("create")}>+ Create Match</button>
              </div>
            </div>
            {mine.length === 0 && <div className="card" style={{ color: T.muted }}>You haven't created any matches yet. Create your first one to get started.</div>}
            <div className="feedgrid">
              {capped("mymatches", mine).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} mineView />)}
            </div>
            <SeeMoreBtn k="mymatches" list={mine} />
          </>
        )}

        {/* ---------- MY TEAMS ---------- */}
        {/* ---------- MY PLAYER PROFILE ---------- */}
        {page === "myplayer" && me.role === "Player" && (() => {
          const pd = playerProfileData(me);
          const stats = pd;
          const lvl = playerLevel(me);
          const myAwards = playerAwards.filter((a) => a.playerId === me.id);
          const myPending = teamRequests.find((r) => r.playerId === me.id && r.status === "pending");
          const pendingTeam = myPending ? savedTeams.find((t) => t.id === myPending.teamId) : null;
          return (
            <div style={{ maxWidth: 560 }}>
              <div className="display" style={{ fontSize: 24, marginBottom: 4 }}>My Player Profile</div>
              <div style={{ color: T.muted, fontSize: 13, marginBottom: 16 }}>Your squad, your kit, your record.</div>

              <div style={{ position: "relative", padding: "6px 2px 0", overflow: "hidden", marginBottom: 18 }}>
                <div style={{ position: "absolute", top: -70, left: -10, width: 230, height: 200, background: "radial-gradient(ellipse, rgba(214,168,29,.10), transparent 68%)", pointerEvents: "none" }} />
                <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 15 }}>
                  <div style={{ flexShrink: 0, filter: "drop-shadow(0 4px 12px rgba(0,0,0,.5))" }}>
                    <Jersey pattern={me.jerseyPattern} main={me.jerseyMain} trim={me.jerseyTrim} size={54} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 25, lineHeight: 1.02, color: "#F7F4EA" }}>{me.name}</div>
                    <div style={{ fontSize: 11.5, color: "#7d8f83", marginTop: 7 }}>
                      {me.positionPlayed && <b style={{ color: "#B9C7BC", fontWeight: 600 }}>{me.positionPlayed}</b>}
                      {me.positionPlayed && stats.team ? " · " : ""}
                      {stats.team ? stats.team.name : "No squad yet"}
                      {me.state ? ` · ${me.state}` : ""}
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 9, background: "rgba(214,168,29,.10)", border: "1px solid rgba(214,168,29,.28)", borderRadius: 6, padding: "3px 9px", fontSize: 10, fontWeight: 600, color: "#D6A81D", letterSpacing: ".4px" }}>
                      {lvl.tier.icon} {lvl.tier.name.toUpperCase()}
                    </div>
                  </div>
                </div>

                <div style={{ position: "relative", display: "flex", marginTop: 20, borderTop: "1px solid #151c16", borderBottom: "1px solid #151c16" }}>
                  {[[(stats.matches > 0 ? (stats.goals / stats.matches) : 0).toFixed(2), "Goals / match", true], [stats.goals, "Goals", false], [stats.matches, "Matches", false]].map(([n, l, gold], i) => (
                    <div key={l} style={{ flex: 1, padding: "14px 4px", textAlign: "center", borderRight: i < 2 ? "1px solid #151c16" : "none" }}>
                      <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 21, color: gold ? "#D6A81D" : "#F7F4EA" }}>{n}</div>
                      <div style={{ fontSize: 8.5, color: "#5a6a5f", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>{l}</div>
                    </div>
                  ))}
                </div>

                {pd.streak > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 11, background: "#0E140F", border: "1px solid #1b241c", borderRadius: 10, padding: "12px 13px", marginTop: 16 }}>
                    <div style={{ width: 3, alignSelf: "stretch", background: "#D6A81D", borderRadius: 2 }} />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F7F4EA" }}>{pd.streak}-match scoring streak</div>
                      {pd.lastBlank && <div style={{ fontSize: 10.5, color: "#7d8f83", marginTop: 2 }}>Last blank — {pd.lastBlank.date} vs {pd.lastBlank.opponent}</div>}
                    </div>
                  </div>
                )}

                {pd.standing && pd.matches > 0 && (
                  <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
                    {[
                      [pd.standing.goalRank > 0 ? `#${pd.standing.goalRank}` : "—", "Top scorer"],
                      [pd.standing.awardRank > 0 ? `#${pd.standing.awardRank}` : "—", "Most awarded"],
                      [pd.standing.winRateScoring !== null ? `${pd.standing.winRateScoring}%` : "—", "Win rate scoring"],
                    ].map(([n, l]) => (
                      <div key={l} style={{ flex: 1, background: "#0E140F", border: "1px solid #1b241c", borderRadius: 10, padding: "13px 10px" }}>
                        <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 19, color: "#F7F4EA" }}>{n}</div>
                        <div style={{ fontSize: 9, color: "#5a6a5f", marginTop: 4, lineHeight: 1.35 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
                  <button onClick={async () => {
                    const txt = `${me.name}${stats.team ? ` — ${stats.team.name}` : ""}\n⚽ ${stats.goals} goals in ${stats.matches} matches on Area Match`;
                    try {
                      if (navigator.share) await navigator.share({ title: `${me.name} · Area Match`, text: txt, url: window.location.href });
                      else { await navigator.clipboard.writeText(`${txt}\n${window.location.href}`); notify("Profile copied — paste it anywhere 📋"); }
                    } catch (e) { /* dismissed */ }
                  }} style={{ flex: 1, borderRadius: 8, padding: 11, fontSize: 12, fontWeight: 600, fontFamily: "inherit", background: "none", border: "1px solid #1b241c", color: "#B9C7BC", cursor: "pointer" }}>Share profile</button>
                  {stats.ready && <button onClick={() => setPlayerCardFor(me.id)} style={{ flex: 1, borderRadius: 8, padding: 11, fontSize: 12, fontWeight: 600, fontFamily: "inherit", background: "#D6A81D", color: "#12160f", border: 0, cursor: "pointer" }}>Download card</button>}
                </div>
              </div>

              <div style={{ display: "flex", borderBottom: "1px solid #151c16", gap: 26, marginBottom: 18 }}>
                {[["overview", "Overview"], ["matches", "Matches"], ["honours", "Honours"], ["edit", "Edit"]].map(([key, lbl]) => (
                  <button key={key} onClick={() => setMyProfileTab(key)}
                    style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 12.5, color: myProfileTab === key ? "#F7F4EA" : "#5a6a5f", fontWeight: myProfileTab === key ? 600 : 500, padding: "13px 0", cursor: "pointer", borderBottom: `1.5px solid ${myProfileTab === key ? "#D6A81D" : "transparent"}`, marginBottom: -1 }}>
                    {lbl}
                  </button>
                ))}
              </div>

              {myProfileTab === "overview" && (
                <>
                  {pd.standout && (
                    <>
                      <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 13 }}>Standout performance</div>
                      <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 15, marginBottom: 22 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#D6A81D" }}>
                            {pd.standout.goals >= 3 ? "Hat-trick" : pd.standout.goals === 2 ? "Brace" : "Best game"}
                          </span>
                          <span style={{ fontSize: 9.5, color: "#4e5c53" }}>{pd.standout.date}</span>
                        </div>
                        <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 17, color: "#F7F4EA" }}>vs {pd.standout.opponent}</div>
                        <div style={{ fontSize: 10.5, color: "#7d8f83", marginTop: 3 }}>
                          {pd.standout.location}{pd.standout.location ? " · " : ""}{pd.standout.outcome === "W" ? "Won" : pd.standout.outcome === "L" ? "Lost" : "Drew"} {pd.standout.us}–{pd.standout.them}
                        </div>
                      </div>
                    </>
                  )}
                  {pd.history.length > 0 && (
                    <>
                      <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 13 }}>Recent form</div>
                      {(() => {
                        const form = pd.history.slice(0, 5).reverse();
                        const maxG = Math.max(1, ...form.map((f) => f.goals));
                        const abbrev = (s) => (s || "").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean)[0]?.slice(0, 3).toUpperCase() || "—";
                        return (
                          <div style={{ marginBottom: 22 }}>
                            <div style={{ display: "flex", gap: 7, alignItems: "flex-end", height: 52, marginBottom: 7 }}>
                              {form.map((f, i) => (
                                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, height: "100%", justifyContent: "flex-end" }}>
                                  <div style={{ fontSize: 9, color: "#5a6a5f", fontWeight: 600 }}>{f.goals}</div>
                                  <div style={{ width: "100%", borderRadius: 2, height: f.goals > 0 ? `${Math.max(18, (f.goals / maxG) * 78)}%` : "5%", background: f.goals > 0 ? "linear-gradient(180deg,#D6A81D,#8a6b12)" : "#161f18" }} />
                                </div>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: 7 }}>
                              {form.map((f, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 8.5, color: "#3f4b43" }}>{abbrev(f.opponent)}</div>)}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                  {pd.history.length === 0 && (
                    <div style={{ fontSize: 12.5, color: "#7d8f83", textAlign: "center", padding: "24px 0" }}>
                      No published matches yet — your stats appear once results are in.
                    </div>
                  )}
                </>
              )}

              {myProfileTab === "matches" && (
                <>
                  <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 13 }}>
                    {pd.history.length} appearance{pd.history.length === 1 ? "" : "s"}
                    {pd.standing ? ` · ${pd.standing.wins}W ${pd.standing.draws}D ${pd.standing.losses}L` : ""}
                  </div>
                  {pd.history.length === 0 && <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>No matches played yet.</div>}
                  {pd.history.map((h) => (
                    <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0", borderBottom: "1px solid #121a14" }}>
                      <div style={{ width: 19, height: 19, borderRadius: 4, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        background: h.outcome === "W" ? "rgba(63,163,91,.16)" : h.outcome === "L" ? "rgba(198,80,63,.14)" : "rgba(140,150,145,.14)",
                        color: h.outcome === "W" ? "#5fcf87" : h.outcome === "L" ? "#e08a7d" : "#93a099",
                        border: `1px solid ${h.outcome === "W" ? "rgba(63,163,91,.3)" : h.outcome === "L" ? "rgba(198,80,63,.28)" : "rgba(140,150,145,.25)"}` }}>{h.outcome}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, color: "#EDEAE0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.opponent}</div>
                        <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{h.date}{h.location ? ` · ${h.location}` : ""}</div>
                      </div>
                      <div style={{ fontSize: 10, color: h.goals > 0 ? "#D6A81D" : "#2f3a33", fontWeight: 700, letterSpacing: ".5px", flexShrink: 0 }}>{h.goals > 0 ? `${h.goals} G` : "—"}</div>
                      <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 12.5, color: "#7d8f83", width: 32, textAlign: "right", flexShrink: 0 }}>{h.us}–{h.them}</div>
                    </div>
                  ))}
                </>
              )}

              {myProfileTab === "honours" && (
                <>
                  <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 13 }}>
                    {myAwards.length} award{myAwards.length === 1 ? "" : "s"}
                  </div>
                  {myAwards.length === 0 && <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>No awards yet.</div>}
                  {myAwards.map((a) => {
                    const info = AWARD_TYPES[a.awardType] || { label: a.awardType, art: "motm" };
                    const inMatch = pd.history.find((h) => h.id === a.matchId);
                    return (
                      <div key={a.id} onClick={() => setAwardCardFor(a.id)}
                        style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                        <TrophyIcon art={info.art} size={26} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{info.label}</div>
                          <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>
                            {inMatch ? `vs ${inMatch.opponent} · ` : ""}{new Date(a.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, color: "#4e5c53" }}>›</span>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, margin: "24px 0 13px" }}>
                    {lvl.next ? `Progress to ${lvl.next.name}` : "Level"}
                  </div>
                  <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                      <span style={{ color: "#B9C7BC", fontWeight: 600 }}>{lvl.tier.icon} {lvl.tier.name}</span>
                      <span style={{ color: "#5a6a5f" }}>{lvl.next ? `${lvl.score} / ${lvl.next.min} pts` : `${lvl.score} pts`}</span>
                    </div>
                    <div style={{ height: 4, background: "#161f18", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${lvl.progress * 100}%`, height: "100%", background: "#D6A81D", borderRadius: 99 }} />
                    </div>
                    <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 9, lineHeight: 1.4 }}>
                      {lvl.next ? `${lvl.next.min - lvl.score} more points to reach ${lvl.next.name} — earn points from goals, hat-tricks and awards.` : "Highest level reached."}
                    </div>
                  </div>
                </>
              )}

              <div style={{ display: myProfileTab === "edit" ? "block" : "none" }}>
              {/* SQUAD STATUS */}
              <div className="card" style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 10 }}>My Squad</div>
                {stats.team ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <MiniLogo team={stats.team} badge={stats.team.badge} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{stats.team.name}</div>
                      <div style={{ fontSize: 11, color: T.muted }}>Listed as "{me.rosterName}"</div>
                    </div>
                    <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11, color: T.live, borderColor: "#3a1f1a" }}
                      onClick={async () => {
                        if (!window.confirm(`Leave ${stats.team.name}? Your goals stay on record, but you'll need to request again to rejoin.`)) return;
                        const { error } = await supabase.from("profiles").update({ team_id: null, roster_name: null }).eq("id", me.id);
                        if (error) return notify(error.message);
                        setMe((prev) => ({ ...prev, teamId: null, rosterName: "" }));
                        notify("You've left the squad.");
                        refreshAll();
                      }}>Leave</button>
                  </div>
                ) : myPending ? (
                  <div style={{ fontSize: 13, color: T.muted }}>
                    ⏳ Request sent to <b style={{ color: T.chalk }}>{pendingTeam ? pendingTeam.name : "a team"}</b> — waiting for the captain to approve.
                    <button className="btn btn-ghost" style={{ marginTop: 10, width: "100%", fontSize: 12 }}
                      onClick={async () => {
                        await supabase.from("team_requests").delete().eq("id", myPending.id);
                        notify("Request withdrawn.");
                        refreshAll();
                      }}>Withdraw request</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: T.muted }}>You're not in a squad yet — find your team below to request a spot.</div>
                )}
              </div>

              {/* JERSEY BUILDER */}
              <div className="card" style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 10 }}>My Kit</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {JERSEY_PATTERNS.map(([key, label]) => (
                    <button key={key} onClick={() => savePlayerKit({ jersey_pattern: key })}
                      style={{ background: me.jerseyPattern === key ? T.floodlight : "#131a15", color: me.jerseyPattern === key ? "#1a1405" : T.chalk, border: `1px solid ${me.jerseyPattern === key ? T.floodlight : "#243128"}`, borderRadius: 99, padding: "7px 12px", fontSize: 11.5, fontWeight: 700 }}>{label}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.muted }}>
                    Main
                    <input type="color" value={me.jerseyMain} onChange={(e) => savePlayerKit({ jersey_main: e.target.value })} style={{ width: 40, height: 32, border: 0, borderRadius: 8, background: "none", cursor: "pointer" }} />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.muted }}>
                    Trim
                    <input type="color" value={me.jerseyTrim} onChange={(e) => savePlayerKit({ jersey_trim: e.target.value })} style={{ width: 40, height: 32, border: 0, borderRadius: 8, background: "none", cursor: "pointer" }} />
                  </label>
                </div>
                <input className="input" placeholder="Position (e.g. Striker)" maxLength={20} value={me.positionPlayed}
                  onChange={(e) => savePlayerKit({ position_played: sanitizeText(e.target.value, 20) })} />
              </div>

              <div className="card" style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 10 }}>My Dream Team ⚽</div>
                <div style={{ fontSize: 10.5, color: T.muted, marginBottom: 10 }}>Real teams you admire — shown on your profile.</div>
                {me.dreamTeams.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {me.dreamTeams.length > 1 && (
                      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 8 }}>
                        {me.dreamTeams.map((_, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === dreamTeamSlide ? T.floodlight : "#3a4a3e" }} />)}
                      </div>
                    )}
                    <div onTouchStart={(e) => { dreamTeamTouchX.current = e.touches[0].clientX; }}
                      onTouchEnd={(e) => {
                        const dx = e.changedTouches[0].clientX - dreamTeamTouchX.current;
                        if (dx < -40) setDreamTeamSlide((i) => Math.min(me.dreamTeams.length - 1, i + 1));
                        if (dx > 40) setDreamTeamSlide((i) => Math.max(0, i - 1));
                      }}
                      style={{ background: "linear-gradient(160deg, #173d24, #0D3A1F)", border: "1px solid rgba(230,179,30,.2)", borderRadius: 14, padding: "22px 14px", textAlign: "center" }}>
                      <div style={{ fontSize: 26 }}>⭐</div>
                      <div className="display" style={{ fontSize: 18, color: T.floodlight, marginTop: 6 }}>{me.dreamTeams[dreamTeamSlide]}</div>
                      <button onClick={() => savePlayerKit({ dream_teams: me.dreamTeams.filter((_, i) => i !== dreamTeamSlide) })}
                        style={{ background: "none", border: "1px solid rgba(245,240,225,.25)", color: "#e08a7d", borderRadius: 99, padding: "4px 12px", fontSize: 11, marginTop: 12 }}>Remove</button>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" placeholder="e.g. Barcelona, Man United..." maxLength={30} value={dreamTeamInput} onChange={(e) => setDreamTeamInput(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn btn-gold" style={{ padding: "10px 14px" }}
                    onClick={() => {
                      const v = dreamTeamInput.trim();
                      if (!v || me.dreamTeams.length >= 8) return;
                      savePlayerKit({ dream_teams: [...me.dreamTeams, v] });
                      setDreamTeamInput("");
                      setDreamTeamSlide(me.dreamTeams.length);
                    }}>Add</button>
                </div>
              </div>

              {/* FIND A TEAM */}
              {!stats.team && !myPending && (
                <div className="card">
                  <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 10 }}>Find Your Team</div>
                  <input className="input" placeholder="🔍 Search a team…" value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} style={{ marginBottom: 10 }} />
                  {savedTeams.filter((t) => !teamSearch || t.name.toLowerCase().includes(teamSearch.toLowerCase())).slice(0, 8).map((t) => {
                    const cap = users.find((u) => u.id === t.captainId);
                    const rosterList = (t.players || "").split(",").map((p) => p.trim()).filter(Boolean);
                    return (
                      <div key={t.id} style={{ border: "1px solid #243128", borderRadius: 12, padding: 11, marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: rosterList.length ? 8 : 0 }}>
                          <MiniLogo team={t} badge={t.badge} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.name}</div>
                            <div style={{ fontSize: 10.5, color: T.muted }}>{cap ? cap.name : "Captain"}</div>
                          </div>
                          <button className="btn btn-gold" style={{ padding: "7px 11px", fontSize: 11 }}
                            onClick={() => requestToJoin(t, "join", me.name)}>Request to join</button>
                        </div>
                        {rosterList.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, color: T.muted, marginBottom: 5 }}>Already listed? Claim your name:</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {rosterList.map((nm) => (
                                <button key={nm} onClick={() => requestToJoin(t, "claim", nm)}
                                  style={{ background: "#131a15", border: "1px solid #243128", color: T.chalk, borderRadius: 99, padding: "5px 10px", fontSize: 11 }}>{nm}</button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            </div>
          );
        })()}

        {page === "myteams" && me.role === "Captain" && (
          <div style={{ maxWidth: 560 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div className="display" style={{ fontSize: 24 }}>My Teams</div>
              <button className="btn btn-gold" onClick={() => setTeamFormOpen("new")}>＋ Create Team</button>
            </div>
            <div style={{ color: T.muted, fontSize: 13, marginBottom: 16 }}>Build a squad once, reuse it for every match — no retyping names each time.</div>
            {teamRequests.filter((r) => r.captainId === me.id && r.status === "pending").length > 0 && (
              <div className="card" style={{ marginBottom: 14, border: "1px solid rgba(230,179,30,.35)" }}>
                <div style={{ fontSize: 11, color: T.floodlight, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 10, fontWeight: 700 }}>
                  👤 Join Requests ({teamRequests.filter((r) => r.captainId === me.id && r.status === "pending").length})
                </div>
                {capped("requests", teamRequests.filter((r) => r.captainId === me.id && r.status === "pending")).map((req) => {
                  const player = users.find((u) => u.id === req.playerId);
                  const team = savedTeams.find((t) => t.id === req.teamId);
                  return (
                    <div key={req.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #243128" }}>
                      <Jersey pattern={player?.jerseyPattern} main={player?.jerseyMain} trim={player?.jerseyTrim} size={30} />
                      <div className="tappable" style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => player && openPlayerProfile(player.id)}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: T.floodlight, textDecoration: "underline", textUnderlineOffset: 2 }}>{player ? player.name : "A player"} ›</div>
                        <div style={{ fontSize: 10.5, color: T.muted, display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                          <span style={{ background: req.kind === "claim" ? "rgba(230,179,30,.15)" : "rgba(63,163,91,.15)", color: req.kind === "claim" ? T.floodlight : "#3FA35B", padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>
                            {req.kind === "claim" ? "Claiming a name" : "New member"}
                          </span>
                          {req.kind === "claim" ? `"${req.rosterName}"` : ""} · {team ? team.name : "your squad"}
                        </div>
                      </div>
                      <button className="btn btn-gold" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => respondToRequest(req, true)}>✓</button>
                      <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11, color: T.live, borderColor: "#3a1f1a" }} onClick={() => respondToRequest(req, false)}>✕</button>
                    </div>
                  );
                })}
                <SeeMoreBtn k="requests" list={teamRequests.filter((r) => r.captainId === me.id && r.status === "pending")} />
              </div>
            )}
            {savedTeams.filter((t) => t.captainId === me.id).length === 0 && (
              <div className="card" style={{ color: T.muted }}>You haven't saved any teams yet. Create one to speed up hosting future matches.</div>
            )}
            <div style={{ display: "grid", gap: 10 }}>
              {savedTeams.filter((t) => t.captainId === me.id).map((t) => {
                const rec = teamRecord(t);
                return (
                  <div key={t.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => openTeamProfile(t.id)}>
                    <MiniLogo team={t} badge={t.badge} size={44} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                        {rec.ratingReady ? <span style={{ fontSize: 13 }}>{[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ color: i <= Math.round(rec.rating) ? T.floodlight : "#3a4a3e" }}>★</span>)} <span className="display" style={{ fontSize: 13, color: T.floodlight }}>{rec.rating}</span></span> : <span style={{ fontSize: 10, color: T.muted }}>Building record</span>}
                      </div>
                      {rec.ratingReady ? (
                        <>
                          <div style={{ display: "flex", gap: 1, marginTop: 6, borderRadius: 4, overflow: "hidden", height: 4 }}>
                            <div style={{ width: `${(rec.wins / rec.total) * 100}%`, background: "#3FA35B" }} />
                            <div style={{ width: `${(rec.draws / rec.total) * 100}%`, background: "#54615a" }} />
                            <div style={{ width: `${(rec.losses / rec.total) * 100}%`, background: "#C6503F" }} />
                          </div>
                          <div style={{ fontSize: 10.5, color: T.muted, marginTop: 4 }}>{rec.total} matches · {rec.wins}W · {rec.draws}D · {rec.losses}L</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 10.5, color: T.muted, marginTop: 4 }}>{rec.total} match{rec.total === 1 ? "" : "es"} played · {3 - rec.total} more for a rating</div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                      <button className="tappable" style={{ padding: "6px 11px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", background: "none", border: "1px solid #243128", color: "#B9C7BC", borderRadius: 8, cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); setSquadManageFor(t.id); }}>Awards</button>
                      <button className="tappable" style={{ padding: "6px 11px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", background: "none", border: "1px solid #243128", color: "#B9C7BC", borderRadius: 8, cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); setTeamFormOpen(t.id); }}>Edit</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------- CREATE ---------- */}
        {page === "create" && me.role === "Captain" && (
          <div style={{ maxWidth: 560 }}>
            <CreateMatch
              myTeams={savedTeams.filter((t) => t.captainId === me.id)}
              onCancel={() => setPage("mymatches")}
              onSave={async (data) => {
                const { error } = await supabase.from("matches").insert({
                  created_by: me.id,
                  team_a_name: data.teamA.name, team_a_color: data.teamA.color,
                  team_b_name: data.teamB.name, team_b_color: data.teamB.color,
                  players_a: data.playersA, players_b: data.playersB,
                  location: data.location, match_date: data.date, match_time: data.time,
                  badge_a: data.badgeA, badge_b: data.badgeB,
                  duration_minutes: data.duration, published: true,
                  stream_url: data.streamUrl || null,
                });
                if (error) return notify(error.message);
                setPage("mymatches");
                refreshAll();
                notify(data.streamUrl ? "Match saved ✔ Your live stream is attached — fans will see 🔴 Watch Live." : "Match saved ✔ It's live on the News Feed for everyone to see.");
              }}
            />
          </div>
        )}

        {/* ---------- WALLET ---------- */}
        {/* ---------- BETS ---------- */}
        {/* ---------- PROFILE ---------- */}
        {page === "about" && (
          <div style={{ maxWidth: 640 }}>
            <div className="hero" style={{ marginBottom: 20 }}>
              <div className="display" style={{ fontSize: 34, lineHeight: 1.05 }}>About <span style={{ color: T.floodlight }}>Area Match</span></div>
            </div>
            <a href="/area-match.apk" download style={{ textDecoration: "none" }}>
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, background: "linear-gradient(135deg, #14532D, #0D3A1F)", border: "1px solid " + T.floodlight }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(230,179,30,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>📲</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: T.chalk }}>Get the Area Match Android app</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>Full-screen, no browser bar — tap to download the APK</div>
                </div>
                <div className="btn btn-gold" style={{ flexShrink: 0, fontSize: 13, padding: "10px 16px" }}>Download</div>
              </div>
            </a>
            <div className="card" style={{ display: "grid", gap: 14, fontSize: 14, lineHeight: 1.7 }}>
              <div>
                <div style={{ fontWeight: 700, color: T.floodlight, marginBottom: 4 }}>⚽ Our Mission</div>
                Area Match exists to bring local community football to life. Every weekend, on pitches across Nigeria, brilliant football is played — and forgotten by Monday. We believe street and community matches deserve the same treatment as the big leagues: fixtures announced, kick-offs tracked live, results published, and heroes remembered.
              </div>
              <div>
                <div style={{ fontWeight: 700, color: T.floodlight, marginBottom: 4 }}>🧢 For Captains</div>
                Captains are the heartbeat of Area Match. Host your matches, publish your line-ups, run the official match clock, update live scores as the goals fly in, and upload the full-time result — complete with shareable artwork for your team's socials.
              </div>
              <div>
                <div style={{ fontWeight: 700, color: T.floodlight, marginBottom: 4 }}>📣 For Fans</div>
                Follow your favourite captains, find matches happening in your state, star the games you don't want to miss, and watch results roll in on the live feed. Community football finally has a home — and it's in your pocket.
              </div>
              <div>
                <div style={{ fontWeight: 700, color: T.floodlight, marginBottom: 4 }}>🇳🇬 Built for the Community</div>
                From Lagos to Kano, Enugu to Ibadan — if there's a pitch and two teams, there's a story worth telling. Area Match is built to tell it.
              </div>
              <div style={{ borderTop: "1px solid #243128", paddingTop: 12, fontSize: 12, color: T.muted, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span>Area Match — The community football website</span>
                <span style={{ color: T.floodlight, fontWeight: 700 }}>App Version 1.0</span>
              </div>
            </div>
          </div>
        )}

        {page === "profile" && me.role !== "Admin" && me.role === "Captain" && (
          <div className="card" style={{ display: "grid", gap: 10, marginBottom: 14, maxWidth: 560 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.floodlight, letterSpacing: ".08em", textTransform: "uppercase" }}>📣 Announcement to your fans</div>
            {(() => {
              const mineAnn = annes.find((a) => a.captain_id === me.id);
              return mineAnn ? (
                <>
                  <div style={{ fontSize: 14, background: "#131a15", borderRadius: 10, padding: "10px 12px" }}>{mineAnn.message}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>Live on your profile — disappears automatically 24 hours after posting. One announcement per day.</div>
                  <button className="btn btn-ghost" style={{ fontSize: 12, color: T.live, borderColor: "#3a1f1a" }} onClick={async () => {
                    await supabase.from("announcements").delete().eq("id", mineAnn.id);
                    refreshAll();
                    notify("Announcement removed");
                  }}>Remove announcement</button>
                </>
              ) : (
                <>
                  <textarea className="input" rows={2} maxLength={200} placeholder="e.g. Sunday's match is postponed to 5pm — same venue!"
                    value={annDraft} onChange={(e) => setAnnDraft(sanitizeText(e.target.value, 200))} style={{ resize: "none", fontFamily: "'Space Grotesk', sans-serif" }} />
                  <button className="btn btn-gold" disabled={!annDraft.trim()} style={{ opacity: annDraft.trim() ? 1 : .5 }} onClick={async () => {
                    const { error } = await supabase.from("announcements").insert({ captain_id: me.id, message: annDraft.trim() });
                    if (error) return notify(error.message);
                    setAnnDraft("");
                    refreshAll();
                    notify("📣 Posted! Your fans will see it on your profile for the next 24 hours.");
                  }}>Post announcement</button>
                  <div style={{ fontSize: 11, color: T.muted }}>One per day · auto-deletes after 24 hours · shown to fans on your captain profile.</div>
                </>
              );
            })()}
          </div>
        )}

        {page === "profile" && me.role !== "Admin" && (
          <ProfilePage
            me={me}
            follows={follows}
            users={users}
            onOpenCaptain={(id) => { setCaptainCameFrom("profile"); setPage("captains"); setViewCaptain(id); }}
            onOpenTeam={(id) => openTeamProfile(id)}
            onOpenMatch={(id) => openMatchDetail(id)}
            supportedTeams={(me.role === "Captain"
              ? savedTeams.filter((t) => t.captainId === me.id)
              : savedTeams.filter((t) => teamSupporters.some((s) => s.fanId === me.id && s.teamId === t.id))
            ).map((t) => {
              const rec = teamRecord(t);
              const last = rec.results.slice(0, 3).map((r) => r.outcome).join("");
              return { ...t, formLine: rec.total > 0 ? "Last 3: " + (last || "—") + " · " + rec.wins + "W " + rec.draws + "D " + rec.losses + "L" : "No results yet" };
            })}
            myUpcoming={(() => {
              const mine = me.role === "Captain"
                ? savedTeams.filter((t) => t.captainId === me.id)
                : savedTeams.filter((t) => teamSupporters.some((s) => s.fanId === me.id && s.teamId === t.id));
              const names = mine.map((t) => (t.name || "").trim().toLowerCase());
              if (names.length === 0) return [];
              return matches.filter((m) => m.published && m.status === "Scheduled" && m.date && m.time &&
                new Date(m.date + "T" + m.time).getTime() > now &&
                (names.includes((m.teamA.name || "").trim().toLowerCase()) || names.includes((m.teamB.name || "").trim().toLowerCase())))
                .sort((a, b) => new Date(a.date + "T" + a.time) - new Date(b.date + "T" + b.time));
            })()}
            stats={me.role === "Captain"
              ? { a: ["Matches created", matches.filter((x) => x.createdBy === me.id).length], b: ["Teams", savedTeams.filter((t) => t.captainId === me.id).length], c: ["Live now", matches.filter((x) => x.createdBy === me.id && x.status === "Live").length] }
              : { a: ["Captains followed", follows.length], b: ["Teams backed", teamSupporters.filter((s) => s.fanId === me.id).length], c: ["Member since", me.joined || "—"] }}
            onSave={updateProfile}
            notify={notify}
          />
        )}

        {/* ---------- CAPTAINS ---------- */}
        {page === "captains" && (
          <>
            {!viewCaptain ? (
              <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ maxWidth: 260 }}>
                  <StatePicker value={capStateFilter} allLabel="Captains in all states"
                    onChange={(st) => setCapStateFilter(st)} />
                </div>
              </div>
                <div className="display" style={{ fontSize: 24, marginBottom: 6 }}>Captains</div>
                <div style={{ fontSize: 13, color: T.muted, marginBottom: 16 }}>Browse captains and find their matches. Tap a profile to see everything they've published.</div>
                <div className="feedgrid">
                  {capped("captainsdir", users.filter((u) => u.role === "Captain" && (capStateFilter === "All" || u.state === capStateFilter)).sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : 0))).map((c) => {
                    const theirs = matches.filter((x) => x.createdBy === c.id && x.published && isFresh(x));
                    const today = new Date().toISOString().slice(0, 10);
                    const liveToday = theirs.filter((x) => x.date === today && (x.status === "Live" || x.status === "AwaitingScore")).length;
                    const publishedToday = theirs.filter((x) => x.date === today).length;
                    return (
                      <div key={c.id} className="card" style={{ cursor: "pointer", display: "grid", gap: 10 }} onClick={() => { setCaptainCameFrom(null); setViewCaptain(c.id); }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 48, height: 48, borderRadius: "50%", background: T.turf, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 20, color: T.floodlight }}>
                            {c.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                            <div style={{ fontSize: 12, color: T.muted }}>Captain</div>
                          </div>
                          {liveToday > 0 && <span className="chip pulse" style={{ background: T.live, color: "#fff", marginLeft: "auto" }}>● {liveToday} LIVE</span>}
                          {c.id === me.id && <span className="chip" style={{ background: T.floodlight, color: T.night, marginLeft: liveToday > 0 ? 0 : "auto" }}>You</span>}
                        </div>
                        <div style={{ display: "flex", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                          <span className="chip" style={{ background: "#243128", color: T.floodlight }}>{publishedToday} match{publishedToday === 1 ? "" : "es"} today</span>
                          <span className="chip" style={{ background: "#243128", color: T.chalk }}>{theirs.length} all-time</span>
                          {c.state && <span className="chip" style={{ background: "#243128", color: T.chalk }}>📍 {c.state}</span>}
                          <span className="chip" style={{ background: "#243128", color: T.floodlight }}>🔔 {followerCounts[c.id] || 0} follower{(followerCounts[c.id] || 0) === 1 ? "" : "s"}</span>
                        </div>
                        {c.contactInfo && <div style={{ fontSize: 12, color: T.muted }}>📞 Join the team: <span style={{ color: T.chalk }}>{c.contactInfo}</span></div>}
                        {me.role === "Fan" && c.id !== me.id && (
                          <button className={`btn ${follows.includes(c.id) ? "btn-turf" : "btn-gold"}`} style={{ padding: "8px 12px", fontSize: 13 }}
                            onClick={(e) => { e.stopPropagation(); toggleFollow(c.id); }}>
                            {follows.includes(c.id) ? "✓ Following" : "🔔 Follow"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <SeeMoreBtn k="captainsdir" list={users.filter((u) => u.role === "Captain" && (capStateFilter === "All" || u.state === capStateFilter))} />
              </>
            ) : (
              (() => {
                const c = users.find((u) => u.id === viewCaptain);
                if (!c) return null;
                const theirs = matches.filter((x) => x.createdBy === c.id && x.published && isFresh(x));
                const allTheirs = matches.filter((x) => x.createdBy === c.id && x.published);
                const finished = allTheirs.filter((x) => x.status === "ResultPublished" || x.status === "AwaitingScore");
                const publishedCount = allTheirs.filter((x) => x.status === "ResultPublished").length;
                const publishRate = finished.length > 0 ? Math.round((publishedCount / finished.length) * 100) : null;
                const streamed = allTheirs.filter((x) => x.streamUrl).length;
                const theirTeams = savedTeams.filter((t) => t.captainId === c.id);
                const followerCount = users.filter((u) => u.role === "Fan").length && follows.includes(c.id) ? 1 : 0;
                const liveNowMatch = allTheirs.find((x) => x.status === "Live");
                const upcoming = allTheirs.filter((x) => x.status === "Scheduled" && x.date && x.time &&
                  new Date(x.date + "T" + x.time).getTime() > now)
                  .sort((a, b) => new Date(a.date + "T" + a.time) - new Date(b.date + "T" + b.time));
                const venueMap = {};
                allTheirs.forEach((x) => { if (x.location) venueMap[x.location] = (venueMap[x.location] || 0) + 1; });
                const venues = Object.entries(venueMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
                const topPlayers = users
                  .filter((u) => u.role === "Player" && u.rosterName && theirTeams.some((t) => t.id === u.teamId))
                  .map((u) => ({ u, st: playerStats(u) }))
                  .filter((x) => x.st.goals > 0)
                  .sort((a, b) => b.st.goals - a.st.goals)
                  .slice(0, 5);
                const enoughForReliability = finished.length >= 5;
                const Lbl = ({ children, style }) => (
                  <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 12, ...style }}>{children}</div>
                );

                return (
                  <div style={{ maxWidth: 430 }}>
                    <button className="btn btn-ghost tappable" style={{ marginBottom: 14, padding: "8px 14px", fontSize: 13 }}
                      onClick={() => {
                        if (captainCameFrom === "profile") { setViewCaptain(null); setCaptainCameFrom(null); setPage("profile"); }
                        else setViewCaptain(null);
                      }}>
                      {captainCameFrom === "profile" ? "← Back to my profile" : "← All captains"}
                    </button>

                    <div style={{ position: "relative", overflow: "hidden", marginBottom: 2 }}>
                      <div style={{ position: "absolute", top: -70, left: -10, width: 230, height: 200, background: "radial-gradient(ellipse, rgba(214,168,29,.10), transparent 68%)", pointerEvents: "none" }} />
                      <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 14 }}>
                        <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#141c16", border: "1px solid #2a3d31", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 21, color: "#D6A81D", flexShrink: 0 }}>
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 23, lineHeight: 1.05, color: "#F7F4EA" }}>{c.name}</div>
                          <div style={{ fontSize: 11.5, color: "#7d8f83", marginTop: 6 }}>
                            Captain{c.state ? " · " + c.state : ""}
                          </div>
                          {enoughForReliability && publishRate !== null && publishRate >= 90 && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, background: "rgba(214,168,29,.10)", border: "1px solid rgba(214,168,29,.28)", borderRadius: 6, padding: "3px 9px", fontSize: 10, fontWeight: 600, color: "#D6A81D", letterSpacing: ".4px" }}>
                              ◆ ACTIVE ORGANISER
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ position: "relative", display: "flex", marginTop: 18, borderTop: "1px solid #151c16", borderBottom: "1px solid #151c16" }}>
                        {[[allTheirs.length, "Matches hosted", true], [theirTeams.length, "Teams", false], [venues.length, "Venues", false]].map(([n, l, gold], i) => (
                          <div key={l} style={{ flex: 1, padding: "13px 4px", textAlign: "center", borderRight: i < 2 ? "1px solid #151c16" : "none" }}>
                            <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 20, color: gold ? "#D6A81D" : "#F7F4EA" }}>{n}</div>
                            <div style={{ fontSize: 8.5, color: "#5a6a5f", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>{l}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ position: "relative", display: "flex", gap: 8, padding: "13px 0" }}>
                        {me.role === "Fan" && (
                          <button className="tappable" onClick={() => toggleFollow(c.id)}
                            style={{ flex: 1, borderRadius: 8, padding: 9, fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                              background: follows.includes(c.id) ? "none" : "#D6A81D",
                              border: follows.includes(c.id) ? "1px solid #1f2921" : 0,
                              color: follows.includes(c.id) ? "#B9C7BC" : "#12160f" }}>
                            {follows.includes(c.id) ? "✓ Following" : "Follow"}
                          </button>
                        )}
                        {c.contactInfo && (
                          <a href={"https://wa.me/" + (c.contactInfo || "").replace(/\D/g, "")} target="_blank" rel="noreferrer"
                            style={{ flex: 1, borderRadius: 8, padding: 9, fontSize: 11.5, fontWeight: 600, textAlign: "center", background: "none", border: "1px solid #1f2921", color: "#B9C7BC", textDecoration: "none" }}>
                            Contact
                          </a>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", borderBottom: "1px solid #151c16", gap: 22, marginBottom: 17 }}>
                      {[["overview", "Overview"], ["teams", "Teams"], ["matches", "Matches"]].map(([key, lbl]) => (
                        <button key={key} onClick={() => setCaptainTab(key)}
                          style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 12.5, color: captainTab === key ? "#F7F4EA" : "#5a6a5f", fontWeight: captainTab === key ? 600 : 500, padding: "12px 0", cursor: "pointer", borderBottom: "1.5px solid " + (captainTab === key ? "#D6A81D" : "transparent"), marginBottom: -1 }}>
                          {lbl}
                        </button>
                      ))}
                    </div>

                    {captainTab === "overview" && (
                      <>
                        {liveNowMatch && (
                          <div className="tappable" onClick={() => openMatchDetail(liveNowMatch.id)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 13px", background: "#0E140F", border: "1px solid #1b241c", borderLeft: "2px solid #E8442E", borderRadius: "0 10px 10px 0", marginBottom: 18, cursor: "pointer" }}>
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#E8442E" }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>Hosting live now</div>
                              <div style={{ fontSize: 10, color: "#7d8f83", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {liveNowMatch.teamA.name} vs {liveNowMatch.teamB.name}
                              </div>
                            </div>
                            <div style={{ marginLeft: "auto", fontFamily: "'Anton', sans-serif", fontSize: 15 }}>{liveNowMatch.liveA}–{liveNowMatch.liveB}</div>
                          </div>
                        )}

                        <Lbl>Reliability</Lbl>
                        {enoughForReliability ? (
                          <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 14, marginBottom: 20, display: "flex", gap: 14 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 19, color: "#D6A81D" }}>{publishRate}%</div>
                              <div style={{ fontSize: 9, color: "#5a6a5f", marginTop: 3, lineHeight: 1.35 }}>Results<br />published</div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 19, color: "#F7F4EA" }}>{finished.length}</div>
                              <div style={{ fontSize: 9, color: "#5a6a5f", marginTop: 3, lineHeight: 1.35 }}>Matches<br />completed</div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 19, color: "#F7F4EA" }}>{streamed}</div>
                              <div style={{ fontSize: 9, color: "#5a6a5f", marginTop: 3, lineHeight: 1.35 }}>Streamed<br />live</div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 16, textAlign: "center", marginBottom: 20 }}>
                            <div style={{ fontSize: 12.5, color: "#B9C7BC", fontWeight: 600 }}>Building reputation</div>
                            <div style={{ fontSize: 10.5, color: "#5a6a5f", marginTop: 5, lineHeight: 1.5 }}>Reliability shows once a captain has completed a few more matches.</div>
                          </div>
                        )}

                        {upcoming.length > 0 && (
                          <>
                            <Lbl>Upcoming</Lbl>
                            {upcoming.slice(0, 3).map((m) => {
                              const d = new Date(m.date + "T" + m.time);
                              return (
                                <div key={m.id} className="tappable" onClick={() => openMatchDetail(m.id)}
                                  style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                                  <div style={{ width: 40, textAlign: "center", flexShrink: 0 }}>
                                    <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 13 }}>{d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</div>
                                    <div style={{ fontSize: 8, color: "#4e5c53", marginTop: 2 }}>{d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name} vs {m.teamB.name}</div>
                                    <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{m.location}</div>
                                  </div>
                                  <div style={{ fontSize: 9.5, color: "#7d8f83", flexShrink: 0 }}>{m.time}</div>
                                </div>
                              );
                            })}
                          </>
                        )}

                        {venues.length > 0 && (
                          <>
                            <Lbl style={{ marginTop: 20 }}>Venues used</Lbl>
                            {venues.map((v) => (
                              <div key={v[0]} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #121a14" }}>
                                <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v[0]}</div>
                                <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 14, color: "#D6A81D" }}>{v[1]}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    )}

                    {captainTab === "teams" && (
                      <>
                        <Lbl>Teams managed</Lbl>
                        {theirTeams.length === 0 && <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>No teams created yet.</div>}
                        {theirTeams.map((t) => {
                          const rec = teamRecord(t);
                          const sup = teamSupporters.filter((s) => s.teamId === t.id).length;
                          return (
                            <div key={t.id} className="tappable" onClick={() => openTeamProfile(t.id)}
                              style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                              <MiniLogo team={t} badge={t.badge} size={30} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                                <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>
                                  {rec.ratingReady ? "★ " + rec.rating + " · " : ""}{sup} supporter{sup === 1 ? "" : "s"}
                                </div>
                                {rec.results.length > 0 && (
                                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                                    {rec.results.slice(0, 4).reverse().map((r, i) => (
                                      <div key={i} style={{ width: 18, height: 18, borderRadius: 4, fontSize: 8.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                                        background: r.outcome === "W" ? "rgba(63,163,91,.16)" : r.outcome === "L" ? "rgba(198,80,63,.14)" : "rgba(140,150,145,.14)",
                                        color: r.outcome === "W" ? "#5fcf87" : r.outcome === "L" ? "#e08a7d" : "#93a099" }}>{r.outcome}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <span style={{ fontSize: 10, color: "#4e5c53" }}>›</span>
                            </div>
                          );
                        })}

                        {topPlayers.length > 0 && (
                          <>
                            <Lbl style={{ marginTop: 22 }}>Top players across teams</Lbl>
                            {topPlayers.map((tp, i) => (
                              <div key={tp.u.id} className="tappable" onClick={() => openPlayerProfile(tp.u.id)}
                                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                                <div style={{ width: 15, fontFamily: "'Anton', sans-serif", fontSize: 12, color: "#D6A81D", flexShrink: 0 }}>{i + 1}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 500, color: "#D6A81D", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tp.u.name} ›</div>
                                  <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{tp.st.team ? tp.st.team.name : ""}</div>
                                </div>
                                <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 14, color: "#D6A81D" }}>{tp.st.goals}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    )}

                    {captainTab === "matches" && (
                      <>
                        {theirs.length === 0 && <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>This captain hasn't published any matches yet.</div>}
                        {theirs.filter((x) => x.status !== "ResultPublished").length > 0 && <Lbl>Current &amp; upcoming</Lbl>}
                        <div className="feedgrid" style={{ marginBottom: 20 }}>
                          {capped("captain-up-" + c.id, theirs.filter((x) => x.status !== "ResultPublished")).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                        </div>
                        <SeeMoreBtn k={"captain-up-" + c.id} list={theirs.filter((x) => x.status !== "ResultPublished")} />
                        {theirs.filter((x) => x.status === "ResultPublished").length > 0 && <Lbl>Past results</Lbl>}
                        <div className="feedgrid">
                          {capped("captain-past-" + c.id, theirs.filter((x) => x.status === "ResultPublished" && isFresh(x)).sort((a, b) => (a.date < b.date ? 1 : -1))).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => openMatchDetail(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                        </div>
                        <SeeMoreBtn k={"captain-past-" + c.id} list={theirs.filter((x) => x.status === "ResultPublished" && isFresh(x))} />
                      </>
                    )}
                  </div>
                );
              })()
            )}
          </>
        )}

        {/* ---------- HIGHLIGHTS ---------- */}
        {/* ---------- LIVE ---------- */}
        {page === "live" && (
          <div>
            <div className="display" style={{ fontSize: 24, marginBottom: 4 }}>🔴 Live</div>
            <div style={{ color: T.muted, fontSize: 13, marginBottom: 14 }}>
              Every live match — filter by state, or just the captains you follow.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ minWidth: 190, flex: "1 1 190px" }}>
                <StatePicker value={liveStateFilter} counts={stateCounts} disabled={liveFollowedOnly}
                  onChange={(st) => { setLiveFollowedOnly(false); setLiveStateFilter(st); }} />
              </div>
              {me.role === "Fan" && follows.length > 0 && (
                <button className={`btn ${liveFollowedOnly ? "btn-gold" : "btn-ghost"}`} style={{ padding: "9px 14px", fontSize: 13 }}
                  onClick={() => { setLiveFollowedOnly(!liveFollowedOnly); if (!liveFollowedOnly) setLiveStateFilter("All"); }}>🔔 Captains I follow</button>
              )}
            </div>
            {liveForUser.length === 0 && (
              <div className="card" style={{ color: T.muted }}>
                {liveFollowedOnly ? "None of the captains you follow are live right now." : liveStateFilter !== "All" ? `No live matches in ${liveStateFilter} right now.` : "Nothing live right now — check back on match day. ⚽"}
              </div>
            )}
            <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
              {capped("live", liveForUser).map((m) => (
                <MatchCard key={"lv" + m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => (me.role === "Captain" && m.createdBy === me.id ? openMatchDetail(m.id) : openLiveDetail(m.id))} onPoster={() => setPosterFor(m.id)} />
              ))}
            </div>
            <SeeMoreBtn k="live" list={liveForUser} />
          </div>
        )}

        {/* ---------- FEEDBACK ---------- */}
        {page === "feedbackpage" && me.role !== "Admin" && (
          <FeedbackPage
            myFeedback={feedbacks.filter((f) => f.userId === me.id)}
            onSend={async (msg) => {
              const { error } = await supabase.from("feedback").insert({ user_id: me.id, feature: "General", message: msg });
              if (error) return notify(error.message);
              notify("🙏 Thank you! Your note has been sent to the team.");
              refreshAll();
            }}
          />
        )}

        {/* ---------- ADMIN ---------- */}
      </main>

      {/* ---------- MATCH DETAIL ---------- */}
      {openMatch && (
        <MatchDetail
          m={matches.find((x) => x.id === openMatch)}
          me={me}
          linkedPlayers={users.filter((u) => u.role === "Player" && u.teamId && u.rosterName).map((u) => ({ ...u, teamName: (savedTeams.find((t) => t.id === u.teamId) || {}).name || "" }))}
          onOpenPlayer={(id) => openPlayerProfile(id)}
          allMatches={matches}
          onPosterLineup={() => setLineupPosterFor(openMatch)}
          matchAwards={playerAwards.filter((a) => a.matchId === openMatch)}
          notify={notify}
          minute={minute}
          breakLeft={breakLeft}
          captainName={(users.find((u) => u.id === (matches.find((x) => x.id === openMatch) || {}).createdBy) || {}).name || ""}
          isDue={isDue}
          untilKickoff={untilKickoff}
          onClose={goBackPage}
          onStart={startMatch}
          onPauseResume={(m, reason) => {
            if (m.running) {
              patchMatch(m.id, { running: false, elapsed: liveElapsed(m), timerStartedAt: null, pauseReason: reason || "Paused by captain" });
              logEvent(m.id, `⏸ Match Paused: ${(reason || "by captain")} — ${m.teamA.name} vs ${m.teamB.name}`, minute(m));
            } else {
              patchMatch(m.id, { running: true, timerStartedAt: new Date().toISOString(), pauseReason: null });
              logEvent(m.id, `▶ Match resumed: ${m.teamA.name} vs ${m.teamB.name}`, minute(m));
            }
          }}
          onLiveScore={(m, a, b, scorerA, scorerB) => {
            const wasA = m.liveA ?? 0, wasB = m.liveB ?? 0;
            const patch = { liveA: a, liveB: b };
            /* Every goal is at minimum a shot on target — bump both stats automatically so a captain
               isn't starting from zero on Shots/On Target; they can still fine-tune manually after. */
            if (a > wasA) { patch.shotsA = (m.shotsA ?? 0) + (a - wasA); patch.shotsOnTargetA = (m.shotsOnTargetA ?? 0) + (a - wasA); }
            if (b > wasB) { patch.shotsB = (m.shotsB ?? 0) + (b - wasB); patch.shotsOnTargetB = (m.shotsOnTargetB ?? 0) + (b - wasB); }
            patchMatch(m.id, patch);
            if (a > wasA) logEvent(m.id, `⚽ GOAL — ${m.teamA.name}! ${scorerA || "A player"} scores. ${a}-${b}`, minute(m));
            if (b > wasB) logEvent(m.id, `⚽ GOAL — ${m.teamB.name}! ${scorerB || "A player"} scores. ${a}-${b}`, minute(m));
            if (a <= wasA && b <= wasB) logEvent(m.id, `✏️ Score corrected: ${m.teamA.name} ${a}-${b} ${m.teamB.name}`, minute(m));
          }}
          onUpdateStats={(m, key, value) => patchMatch(m.id, { [key]: value })}
          onPostCommentary={(m, text) => logEvent(m.id, `🎙 ${text}`, minute(m))}
          onSetStream={(m, url) => {
            if (url === null) {
              patchMatch(m.id, { streamUrl: "" });
              notify("Stream link removed.");
              return;
            }
            if (!isValidStreamUrl(url)) return notify("That doesn't look like a Facebook or YouTube link. Paste the link from your live video.");
            const clean = normalizeStreamUrl(url);
            patchMatch(m.id, { streamUrl: clean });
            if (m.status === "Live") logEvent(m.id, `🔴 Live stream started: ${m.teamA.name} vs ${m.teamB.name} — watch now!`, minute(m));
            notify("🔴 Stream link saved — fans can now watch live!");
          }}
          onCancelMatch={(m) => {
            patchMatch(m.id, { status: "Cancelled", running: false, timerStartedAt: null, cancelledAt: new Date().toISOString() });
            logEvent(m.id, `❌ Match Cancelled: ${m.teamA.name} vs ${m.teamB.name}`, minute(m));
            notify("❌ Match cancelled. It will be removed automatically after 7 days.");
          }}
          onLike={() => toggleLike(matches.find((x) => x.id === openMatch))}
          liked={myLikes.includes(openMatch)}
          likeCount={likeCounts[openMatch] || 0}
          alreadyRequested={requests.some((r) => r.match_id === openMatch && r.captain_id === me.id && r.type === "rescore")}
          onDeleteMatch={async (m) => {
            await supabase.from("match_events").delete().eq("match_id", m.id);
            await supabase.from("likes").delete().eq("match_id", m.id);
            const { data: deleted, error } = await supabase.from("matches").delete().eq("id", m.id).select();
            if (error) return notify(error.message);
            if (!deleted || deleted.length === 0) return notify("⚠️ Couldn't delete the match — a permissions issue may be blocking it.");
            setMatches((ms) => ms.filter((x) => x.id !== m.id));
            setOpenMatch(null);
            notify("🗑 Match deleted.");
            refreshAll();
          }}
          onRequestChange={async (m, type, reason) => {
            const { error } = await supabase.from("match_requests").insert({ match_id: m.id, captain_id: me.id, type, reason: sanitizeText(reason, 200) });
            if (error) return notify(error.message);
            notify("📨 Request sent to the admin for approval.");
            refreshAll();
          }}
          onHalfTime={(m, takeBreak) => {
            if (takeBreak) {
              patchMatch(m.id, { onBreak: true, breakEndsAt: new Date(Date.now() + 10 * 60000).toISOString() });
              notify("☕ 10-minute half-time break started. Second half resumes automatically.");
            } else {
              patchMatch(m.id, { onBreak: false, breakEndsAt: null, running: true, secondHalf: true, timerStartedAt: new Date().toISOString() });
              notify("▶ Second half under way!");
            }
          }}
          onPostpone={postponeMatch}
          onPublish={(m) => { patchMatch(m.id, { published: !m.published }); notify(m.published ? "Match unpublished — now private" : "Published to News Feed 📣"); }}
          onSubmitScore={submitFinalScore}
          onPoster={() => setPosterFor(openMatch)}
        />
      )}

      {/* ---------- FOOTER ---------- */}
      <footer style={{ borderTop: "1px solid #243128", marginTop: 40, background: "#0d1014" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ maxWidth: 300 }}>
            <div className="display" style={{ fontSize: 20, color: T.floodlight }}>Area Match</div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>
              Community football. Host your matches, track them live, and publish results for the fans.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>Play fair</div>
            <div style={{ fontSize: 13, color: T.muted, maxWidth: 260, lineHeight: 1.5 }}>
              Captains publish official scores. Catch every match as it happens on 🔴 Live!
            </div>
          </div>
          {/* Footer links — Feedback moved here from the nav to keep the bar short */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.muted, marginBottom: 10 }}>More</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, alignItems: "flex-start" }}>
              {me.role !== "Admin" && (
                <button className="tappable" onClick={() => { setPage("feedbackpage"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  style={{ background: "none", border: 0, padding: 0, fontFamily: "inherit", fontSize: 13, color: T.floodlight, fontWeight: 700, cursor: "pointer" }}>
                  💬 Send feedback
                </button>
              )}
              <button className="tappable" onClick={() => { setPage("about"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                style={{ background: "none", border: 0, padding: 0, fontFamily: "inherit", fontSize: 13, color: T.muted, cursor: "pointer" }}>
                About Area Match
              </button>
              <a href="https://areamatch.com.ng" target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 13, color: T.muted, textDecoration: "none" }}>areamatch.com.ng</a>
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid #1a2019", padding: "14px 20px", textAlign: "center", fontSize: 12, color: T.muted }}>
          © {new Date().getFullYear()} Area Match · Built for the community
        </div>
              {supportLink && (
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px 10px", fontSize: 12 }}>
            <a href={supportLink.startsWith("http") || supportLink.startsWith("mailto:") ? supportLink : `https://${supportLink}`}
              target="_blank" rel="noopener noreferrer" style={{ color: T.floodlight, textDecoration: "none", fontWeight: 700 }}>
              💬 Contact Customer Support →
            </a>
          </div>
        )}
</footer>
      </>
      )}


      {notifPromptOpen && me && me.role === "Captain" && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 85, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#12161c", border: "1.5px solid #E6B31E", borderRadius: 20, padding: 22, width: "100%", maxWidth: 400, display: "grid", gap: 12, textAlign: "center" }}>
            <div style={{ fontSize: 40 }}>🔔</div>
            <div className="display" style={{ fontSize: 20, color: T.floodlight }}>Turn on notifications</div>
            <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6 }}>
              Captain, enable notifications so Area Match can remind you — <b style={{ color: T.chalk }}>it's in case you forget to update your match scores</b> after full time. Fans are waiting on your results!
            </div>
            <button className="btn btn-gold" onClick={async () => {
              try { await Notification.requestPermission(); } catch (e) {}
              setNotifPromptOpen(false);
            }}>Turn on notifications</button>
            <button className="btn btn-ghost" onClick={() => setNotifPromptOpen(false)}>Not now</button>
          </div>
        </div>
      )}

      {pwaPromptOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setPwaPromptOpen(false)}>
          <div style={{ background: "#12161c", border: "1.5px solid #E6B31E", borderRadius: 20, padding: 22, width: "100%", maxWidth: 400, display: "grid", gap: 12, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 40 }}>📲</div>
            <div className="display" style={{ fontSize: 20, color: T.floodlight }}>Install Area Match</div>
            <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, textAlign: "left" }}>
              Get the full app experience — Area Match on your home screen, full-screen, one tap away:
              <br /><br />
              <b style={{ color: T.chalk }}>iPhone (Safari):</b> tap the Share button (□↑) → <b style={{ color: T.chalk }}>Add to Home Screen</b>
              <br />
              <b style={{ color: T.chalk }}>Android (Chrome):</b> tap the ⋮ menu → <b style={{ color: T.chalk }}>Add to Home screen</b> / Install app
            </div>
            <button className="btn btn-gold" onClick={() => setPwaPromptOpen(false)}>Got it — I'll add it now</button>
            <button className="btn btn-ghost" onClick={() => setPwaPromptOpen(false)}>Maybe later</button>
          </div>
        </div>
      )}

      {comingSoon && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setComingSoon(null)}>
          <div style={{ background: "#12161c", border: "1.5px solid #E6B31E", borderRadius: 20, padding: 22, width: "100%", maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <ComingSoonCard
              feature={comingSoon}
              detail="This feature is on our launch list — tell us you want it and we'll move faster."
              onFeedback={async (msg) => { await supabase.from("feedback").insert({ user_id: me.id, feature: comingSoon, message: msg }); setComingSoon(null); notify("🙏 Thank you! Your feedback pushes this feature up our launch list."); }}
              onClose={() => setComingSoon(null)}
            />
          </div>
        </div>
      )}

      {posterFor && <PosterModal m={matches.find((x) => x.id === posterFor)} onClose={() => setPosterFor(null)} notify={notify} />}
      {statsPosterFor && <StatsPosterModal m={matches.find((x) => x.id === statsPosterFor)} onClose={() => setStatsPosterFor(null)} notify={notify} />}
      {lineupPosterFor && <LineupPosterModal m={matches.find((x) => x.id === lineupPosterFor)} onClose={() => setLineupPosterFor(null)} notify={notify} />}
      {/* NOTIFICATION PANEL — tap-outside closes it */}
      {bellOpen && (me.role === "Captain" || me.role === "Player") && (
        <>
          <div onClick={() => setBellOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 78, background: "transparent" }} />
          <div style={{ position: "fixed", top: 62, right: 12, width: 288, maxWidth: "calc(100vw - 24px)", maxHeight: "70vh", overflowY: "auto", background: "#0E140F", border: "1px solid #243128", borderRadius: 13, boxShadow: "0 14px 34px rgba(0,0,0,.6)", zIndex: 79 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 12px", borderBottom: "1px solid #1b241c", position: "sticky", top: 0, background: "#0E140F" }}>
              <div style={{ fontSize: 9.5, letterSpacing: "1.4px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700 }}>Notifications</div>
              {unreadBell.length > 0 && (
                <button onClick={() => markRead(bellItems.map((n) => n.id))}
                  style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 10, color: "#D6A81D", cursor: "pointer", padding: 0 }}>
                  Mark all read
                </button>
              )}
            </div>

            {bellItems.length === 0 && (
              <div style={{ padding: "26px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 11.5, color: "#B9C7BC", fontWeight: 600 }}>You're all caught up</div>
                <div style={{ fontSize: 9.5, color: "#5a6a5f", marginTop: 5, lineHeight: 1.5 }}>Kick-off reminders and join requests will show here.</div>
              </div>
            )}

            {bellItems.map((n, i) => {
              const unread = !readIds.includes(n.id);
              return (
                <div key={n.id}
                  style={{ display: "flex", gap: 9, padding: "10px 12px", borderBottom: i < bellItems.length - 1 ? "1px solid #121a14" : "none",
                    background: unread ? "rgba(214,168,29,.05)" : "transparent",
                    borderLeft: unread ? "2px solid #D6A81D" : "2px solid transparent" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: "#141c16", border: "1px solid #1f2a22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>{n.icon}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "#F7F4EA", lineHeight: 1.35 }}>{n.title}</div>
                    <div style={{ fontSize: 9.5, color: "#5a6a5f", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.sub}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                      {n.kind === "kickoff" && (
                        <button className="tappable" onClick={() => { markRead([n.id]); setBellOpen(false); const m = matches.find((x) => x.id === n.matchId); if (m) startMatch(m); }}
                          style={{ fontSize: 9.5, background: "#D6A81D", color: "#12160f", fontWeight: 700, padding: "4px 10px", borderRadius: 5, border: 0, fontFamily: "inherit", cursor: "pointer" }}>Start match</button>
                      )}
                      {(n.kind === "kickoff" || n.kind === "score") && (
                        <button className="tappable" onClick={() => { markRead([n.id]); setBellOpen(false); openMatchDetail(n.matchId); }}
                          style={{ fontSize: 9.5, background: "none", color: "#B9C7BC", fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: "1px solid #243128", fontFamily: "inherit", cursor: "pointer" }}>
                          {n.kind === "score" ? "Submit result" : "Open"}
                        </button>
                      )}
                      {n.kind === "approved" && (
                        <button className="tappable" onClick={() => { markRead([n.id]); setBellOpen(false); openTeamProfile(n.teamId); }}
                          style={{ fontSize: 9.5, background: "#D6A81D", color: "#12160f", fontWeight: 700, padding: "4px 10px", borderRadius: 5, border: 0, fontFamily: "inherit", cursor: "pointer" }}>View team</button>
                      )}
                      {n.kind === "award" && (
                        <button className="tappable" onClick={() => { markRead([n.id]); setBellOpen(false); openPlayerProfile(me.id); }}
                          style={{ fontSize: 9.5, background: "#D6A81D", color: "#12160f", fontWeight: 700, padding: "4px 10px", borderRadius: 5, border: 0, fontFamily: "inherit", cursor: "pointer" }}>View award</button>
                      )}
                      {n.kind === "request" && (
                        <button className="tappable" onClick={() => { markRead([n.id]); setBellOpen(false); setPage("myteams"); }}
                          style={{ fontSize: 9.5, background: "#D6A81D", color: "#12160f", fontWeight: 700, padding: "4px 10px", borderRadius: 5, border: 0, fontFamily: "inherit", cursor: "pointer" }}>Review</button>
                      )}
                      {unread && (
                        <button className="tappable" onClick={() => markRead([n.id])}
                          style={{ fontSize: 9.5, background: "none", color: "#4e5c53", padding: "4px 8px", borderRadius: 5, border: 0, fontFamily: "inherit", cursor: "pointer", marginLeft: "auto" }}>Mark read</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {showFixtures && (() => {
        const list = allUpcomingFixtures.filter((m) => fixState === "All" || captainState(m) === fixState);
        const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
        const today0 = startOfDay(now);
        const groupOf = (m) => {
          const k = startOfDay(new Date(m.date + "T" + m.time).getTime());
          const days = Math.round((k - today0) / 86400000);
          if (days <= 0) return "Today";
          if (days === 1) return "Tomorrow";
          if (days <= 7) return "This week";
          return "Later";
        };
        const order = ["Today", "Tomorrow", "This week", "Later"];
        const grouped = {};
        list.forEach((m) => { const g = groupOf(m); (grouped[g] = grouped[g] || []).push(m); });
        const statesWithFixtures = Array.from(new Set(allUpcomingFixtures.map((m) => captainState(m)).filter(Boolean)));
        return (
          <div style={{ position: "fixed", inset: 0, background: "#0A0D0A", zIndex: 91, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 17px", flexShrink: 0 }}>
              <button onClick={goBackPage} className="tappable" style={{ display: "flex", alignItems: "center", gap: 5, height: 29, padding: "0 12px", border: "1px solid #1b241c", borderRadius: 8, background: "none", color: "#B9C7BC", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}><span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Back</button>
              <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 15, color: "#F7F4EA", flex: 1 }}>Fixtures</div>
            </div>
            {statesWithFixtures.length > 1 && (
              <div style={{ padding: "0 17px 12px", display: "flex", gap: 6, overflowX: "auto", flexShrink: 0 }}>
                {["All"].concat(statesWithFixtures).map((st) => (
                  <button key={st} onClick={() => setFixState(st)}
                    style={{ flexShrink: 0, fontSize: 10.5, padding: "5px 12px", borderRadius: 99, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
                      background: fixState === st ? "#16211a" : "none",
                      border: "1px solid " + (fixState === st ? "#2a3d31" : "#1b241c"),
                      color: fixState === st ? "#EDEAE0" : "#5a6a5f", fontWeight: fixState === st ? 600 : 500 }}>
                    {st === "All" ? "All states" : st}
                  </button>
                ))}
              </div>
            )}
            <div style={{ height: 1, background: "#151c16", flexShrink: 0 }} />
            <div style={{ flex: 1, overflowY: "auto", maxWidth: 430, width: "100%", margin: "0 auto", padding: "6px 17px 24px" }}>
              {list.length === 0 && (
                <div style={{ fontSize: 12.5, color: "#7d8f83", textAlign: "center", padding: "30px 0" }}>
                  No scheduled fixtures{fixState !== "All" ? " in " + fixState : ""} right now.
                </div>
              )}
              {order.filter((g) => grouped[g]).map((g) => (
                <div key={g}>
                  <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#D6A81D", fontWeight: 700, margin: "18px 0 10px" }}>{g}</div>
                  {grouped[g].map((m) => {
                    const kickoff = new Date(m.date + "T" + m.time).getTime();
                    const hoursOut = (kickoff - now) / 3600000;
                    const d = new Date(kickoff);
                    const soon = hoursOut < 24;
                    return (
                      <div key={m.id} className="tappable" onClick={() => { setShowFixtures(false); openMatchDetail(m.id); }}
                        style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                        <div style={{ width: 42, textAlign: "center", flexShrink: 0 }}>
                          <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 14, lineHeight: 1, color: soon ? "#D6A81D" : "#F7F4EA" }}>
                            {soon ? Math.max(1, Math.round(hoursOut)) : d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
                          </div>
                          <div style={{ fontSize: 8, color: "#4e5c53", textTransform: "uppercase", marginTop: 3 }}>
                            {soon ? "hrs" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name} vs {m.teamB.name}</div>
                          <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.location}</div>
                        </div>
                        <div style={{ fontSize: 9.5, color: soon ? "#D6A81D" : "#7d8f83", fontWeight: 600, flexShrink: 0 }}>{m.time}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {list.length > 0 && (
                <div style={{ textAlign: "center", fontSize: 10.5, color: "#4e5c53", paddingTop: 16 }}>
                  {list.length} fixture{list.length === 1 ? "" : "s"}{fixState !== "All" ? " in " + fixState : " across all states"}
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {showLeaderboards && (
        <div style={{ position: "fixed", inset: 0, background: "#0A0D0A", zIndex: 91, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 17px", flexShrink: 0 }}>
            <button onClick={goBackPage} className="tappable" style={{ display: "flex", alignItems: "center", gap: 5, height: 29, padding: "0 12px", border: "1px solid #1b241c", borderRadius: 8, background: "none", color: "#B9C7BC", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}><span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Back</button>
            <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 15, color: "#F7F4EA", flex: 1 }}>Leaderboards</div>
          </div>
          <div style={{ display: "flex", padding: "0 17px", borderBottom: "1px solid #151c16", gap: 24 }}>
            {[["scorers", "Top scorers"], ["form", "Team form"], ["supported", "Most supported"]].map(([key, lbl]) => (
              <button key={key} onClick={() => setLbTab(key)}
                style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 12, color: lbTab === key ? "#F7F4EA" : "#5a6a5f", fontWeight: lbTab === key ? 600 : 500, padding: "12px 0", cursor: "pointer", borderBottom: `1.5px solid ${lbTab === key ? "#D6A81D" : "transparent"}`, marginBottom: -1 }}>
                {lbl}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", maxWidth: 430, width: "100%", margin: "0 auto", padding: "18px 17px 24px" }}>
            <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 13 }}>
              {feedState === "All" ? "All states" : feedState}
            </div>

            {lbTab === "scorers" && (
              leaderboards.topScorers.length === 0
                ? <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>No goals recorded yet.</div>
                : leaderboards.topScorers.map((s, i) => (
                    <div key={`${s.name}-${s.team}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14" }}>
                      <div style={{ width: 17, fontFamily: "'Anton', sans-serif", fontSize: 13, color: i < 3 ? "#D6A81D" : "#4e5c53", flexShrink: 0 }}>{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                        <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{s.team}</div>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 15, color: "#D6A81D" }}>{s.goals}</span>
                        <span style={{ fontSize: 8.5, color: "#4e5c53", letterSpacing: ".7px", textTransform: "uppercase", marginLeft: 3 }}>gls</span>
                      </div>
                    </div>
                  ))
            )}

            {lbTab === "form" && (
              leaderboards.teamForm.length === 0
                ? <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>No teams have played enough matches yet (3 minimum).</div>
                : leaderboards.teamForm.map((x, i) => (
                    <div key={x.team.id} onClick={() => { setShowLeaderboards(false); openTeamProfile(x.team.id); }}
                      style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                      <div style={{ width: 17, fontFamily: "'Anton', sans-serif", fontSize: 13, color: i < 3 ? "#D6A81D" : "#4e5c53", flexShrink: 0 }}>{i + 1}</div>
                      <MiniLogo team={x.team} badge={x.team.badge} size={26} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.team.name}</div>
                        <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{x.rec.wins}W {x.rec.draws}D {x.rec.losses}L · {x.rec.total} played</div>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 15, color: "#D6A81D" }}>{x.rec.rating}</span>
                        <span style={{ fontSize: 8.5, color: "#4e5c53", marginLeft: 3 }}>★</span>
                      </div>
                    </div>
                  ))
            )}

            {lbTab === "supported" && (
              leaderboards.mostSupported.length === 0
                ? <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>No teams have supporters yet.</div>
                : leaderboards.mostSupported.map((x, i) => {
                    const cap = users.find((u) => u.id === x.team.captainId);
                    return (
                      <div key={x.team.id} onClick={() => { setShowLeaderboards(false); openTeamProfile(x.team.id); }}
                        style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                        <div style={{ width: 17, fontFamily: "'Anton', sans-serif", fontSize: 13, color: i < 3 ? "#D6A81D" : "#4e5c53", flexShrink: 0 }}>{i + 1}</div>
                        <MiniLogo team={x.team} badge={x.team.badge} size={26} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.team.name}</div>
                          <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{cap ? cap.name : "Captain"}</div>
                        </div>
                        <div style={{ flexShrink: 0 }}>
                          <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 15, color: "#D6A81D" }}>{x.count}</span>
                          <span style={{ fontSize: 8.5, color: "#4e5c53", letterSpacing: ".7px", textTransform: "uppercase", marginLeft: 3 }}>fans</span>
                        </div>
                      </div>
                    );
                  })
            )}
          </div>
        </div>
      )}
      {viewPlayerId && (() => {
        const p = users.find((u) => u.id === viewPlayerId);
        if (!p) return null;
        const pd = playerProfileData(p);
        return (
          <PlayerProfilePage
            player={p}
            data={pd}
            level={playerLevel(p)}
            team={pd.team}
            onClose={goBackPage}
            onOpenCard={(id) => setPlayerCardFor(id)}
            onOpenAward={(id) => setAwardCardFor(id)}
            onOpenTeam={(id) => openTeamProfile(id)}
            onShareProfile={async () => {
              const txt = `${p.name}${pd.team ? ` — ${pd.team.name}` : ""}\n⚽ ${pd.goals} goals in ${pd.matches} matches on Area Match`;
              try {
                if (navigator.share) await navigator.share({ title: `${p.name} · Area Match`, text: txt, url: window.location.href });
                else { await navigator.clipboard.writeText(`${txt}\n${window.location.href}`); notify("Profile copied — paste it anywhere 📋"); }
              } catch (e) { /* user dismissed the share sheet — nothing to do */ }
            }}
          />
        );
      })()}
      {playerCardFor && (() => {
        const p = users.find((u) => u.id === playerCardFor) || (me.id === playerCardFor ? me : null);
        return p ? <PlayerCardModal player={p} stats={playerStats(p)} awards={playerAwards.filter((a) => a.playerId === p.id)} level={playerLevel(p)} onClose={() => setPlayerCardFor(null)} notify={notify} /> : null;
      })()}
      {awardCardFor && (() => {
        const award = playerAwards.find((a) => a.id === awardCardFor);
        if (!award) return null;
        const p = users.find((u) => u.id === award.playerId) || (me.id === award.playerId ? me : null);
        const team = savedTeams.find((t) => t.id === award.teamId);
        return <AwardCardModal award={award} player={p} team={team} onClose={() => setAwardCardFor(null)} notify={notify} />;
      })()}
      {teamFormOpen && (
        <TeamFormModal
          existing={teamFormOpen === "new" ? null : savedTeams.find((t) => t.id === teamFormOpen)}
          onSave={async (data) => {
            if (teamFormOpen === "new") await createSavedTeam(data);
            else await updateSavedTeam(teamFormOpen, data);
            setTeamFormOpen(null);
          }}
          onDelete={async (id, name) => { await deleteSavedTeam(id, name); setTeamFormOpen(null); }}
          onClose={() => setTeamFormOpen(null)}
        />
      )}
      {viewTeamId && savedTeams.find((t) => t.id === viewTeamId) && (
        <TeamProfileModal
          team={(() => {
            const t = savedTeams.find((x) => x.id === viewTeamId);
            return { ...t, captainName: (users.find((u) => u.id === t.captainId) || {}).name || "" };
          })()}
          record={teamRecord(savedTeams.find((t) => t.id === viewTeamId))}
          linkedPlayers={users.filter((u) => u.role === "Player" && u.teamId && u.rosterName).map((u) => ({ ...u, teamName: (savedTeams.find((t) => t.id === u.teamId) || {}).name || "" }))}
          onOpenPlayer={(id) => openPlayerProfile(id)}
          me={me}
          playerAwards={playerAwards}
          allMatches={matches}
          supporterCount={teamSupporters.filter((s) => s.teamId === viewTeamId).length}
          isSupporting={teamSupporters.some((s) => s.fanId === me.id && s.teamId === viewTeamId)}
          onToggleSupport={toggleSupportTeam}
          onClose={goBackPage}
        />
      )}
      {squadManageFor && savedTeams.find((t) => t.id === squadManageFor) && (
        <SquadManageModal
          team={savedTeams.find((t) => t.id === squadManageFor)}
          linkedPlayers={users.filter((u) => u.role === "Player" && u.teamId && u.rosterName).map((u) => ({ ...u, teamName: (savedTeams.find((t) => t.id === u.teamId) || {}).name || "" }))}
          playerLevel={playerLevel}
          playerStats={playerStats}
          playerAwards={playerAwards}
          onGiveAward={giveAward}
          onClose={() => setSquadManageFor(null)}
        />
      )}

      {liveDetailMatch && (
        <LiveMatchView
          m={liveDetailMatch}
          me={me}
          notify={notify}
          minute={minute}
          timeline={liveTimeline}
          alertsOn={goalAlertIds.includes(liveDetailMatch.id)}
          onToggleAlerts={() => setGoalAlertIds((ids) => ids.includes(liveDetailMatch.id) ? ids.filter((x) => x !== liveDetailMatch.id) : [...ids, liveDetailMatch.id])}
          onShare={() => { goBackPage(); setPosterFor(liveDetailMatch.id); }}
          onShareLineup={() => { goBackPage(); setLineupPosterFor(liveDetailMatch.id); }}
          allMatches={matches}
          onShareStats={() => { goBackPage(); setStatsPosterFor(liveDetailMatch.id); }}
          onClose={goBackPage}
        />
      )}
      {adminViewUser && me && me.role === "Admin" && (() => {
        const u = users.find((x) => x.id === adminViewUser);
        if (!u) return null;
        const theirMatches = matches.filter((x) => x.createdBy === u.id);
        const mins = u.lastSeen ? Math.floor((now - new Date(u.lastSeen).getTime()) / 60000) : null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setAdminViewUser(null)}>
            <div style={{ background: "#12161c", border: "1px solid #243128", borderRadius: 20, padding: 22, width: "100%", maxWidth: 420, display: "grid", gap: 14 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 54, height: 54, borderRadius: 16, background: T.turf, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 22, color: T.floodlight, position: "relative" }}>
                  {u.name.slice(0, 1).toUpperCase()}
                  {mins !== null && mins < 3 && <span style={{ position: "absolute", bottom: -2, right: -2, width: 13, height: 13, borderRadius: "50%", background: "#1DB954", border: "2px solid #12161c" }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="display" style={{ fontSize: 20 }}>{u.name}</div>
                  <div style={{ fontSize: 12, color: T.muted }}>{u.role} · 📍 {u.state || "no state"} {u.blocked && <span className="chip" style={{ background: "#3a1f1a", color: T.live, marginLeft: 4 }}>Blocked</span>}</div>
                  {u.email && <div style={{ fontSize: 12, color: T.floodlight, marginTop: 2, wordBreak: "break-all" }}>✉️ {u.email}</div>}
                </div>
                <button onClick={() => setAdminViewUser(null)} style={{ background: "none", border: 0, color: T.muted, fontSize: 22, cursor: "pointer" }}>✕</button>
              </div>
              <div className="feedgrid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[["Joined", u.joined || "—"], ["Last seen", mins === null ? "never" : mins < 3 ? "online" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`], u.role === "Captain" ? ["Followers", followerCounts[u.id] || 0] : ["Role", u.role]].map(([l, v]) => (
                  <div key={l} className="card" style={{ padding: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>{l}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
              {u.role === "Captain" && (
                <div style={{ fontSize: 13, color: T.muted }}>
                  ⚽ {theirMatches.length} match{theirMatches.length === 1 ? "" : "es"} created · {theirMatches.filter((x) => x.status === "Live").length} live now
                  {u.contactInfo && <div style={{ marginTop: 4 }}>📞 {u.contactInfo}</div>}
                </div>
              )}
              {u.role !== "Admin" && (
                <>
                  <button className="btn" style={{ background: u.blocked ? "#173a26" : "#3a1f1a", color: u.blocked ? "#1DB954" : T.live }}
                    onClick={async () => {
                      await supabase.from("profiles").update({ blocked: !u.blocked }).eq("id", u.id);
                      refreshAll();
                      if (u.email) {
                        if (u.blocked) await supabase.from("blocked_emails").delete().eq("email", u.email.toLowerCase());
                        else await supabase.from("blocked_emails").insert({ email: u.email.toLowerCase() });
                      }
                      refreshAll();
                      notify(u.blocked ? `${u.name} unblocked — email freed` : `${u.name} blocked — they can't log in or re-register with this email`);
                      setAdminViewUser(null);
                    }}>{u.blocked ? "✓ Unblock this user" : "🚫 Block this user"}</button>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: T.muted, flexShrink: 0 }}>Account type:</span>
                    <select className="input" style={{ padding: "8px 10px", fontSize: 13 }} value={u.role} onChange={async (e) => {
                      const newRole = e.target.value;
                      if (newRole === u.role) return;
                      const warn = newRole === "Admin"
                        ? `⚠️ Make ${u.name} an ADMIN? They will get FULL admin powers — same as you.`
                        : `Change ${u.name} from ${u.role} to ${newRole}?`;
                      if (!window.confirm(warn)) { e.target.value = u.role; return; }
                      await supabase.from("profiles").update({ role: newRole }).eq("id", u.id);
                      refreshAll();
                      notify(`${u.name} is now a ${newRole}.`);
                    }}>
                      {["Fan", "Captain", "Player", "Admin"].map((r2) => <option key={r2} value={r2}>{r2}</option>)}
                    </select>
                  </div>
                  <button className="btn btn-ghost" style={{ color: T.live, borderColor: "#3a1f1a", fontSize: 12 }}
                    onClick={async () => {
                      if (!window.confirm(`Permanently delete ${u.name} and ALL their data (matches, follows, bets, wallet)? This cannot be undone.`)) return;
                      const theirs = matches.filter((x) => x.createdBy === u.id).map((x) => x.id);
                      for (const mid of theirs) {
                        await supabase.from("match_events").delete().eq("match_id", mid);
                        await supabase.from("likes").delete().eq("match_id", mid);
                        await supabase.from("match_requests").delete().eq("match_id", mid);
                        await supabase.from("bets").delete().eq("match_id", mid);
                        await supabase.from("transactions").delete().eq("match_id", mid);
                        await supabase.from("matches").delete().eq("id", mid);
                      }
                      await supabase.from("likes").delete().eq("user_id", u.id);
                      await supabase.from("follows").delete().eq("fan_id", u.id);
                      await supabase.from("follows").delete().eq("captain_id", u.id);
                      await supabase.from("bets").delete().eq("user_id", u.id);
                      await supabase.from("transactions").delete().eq("user_id", u.id);
                      await supabase.from("feedback").delete().eq("user_id", u.id);
                      await supabase.from("notifications").delete().eq("user_id", u.id);
                      await supabase.from("wallets").delete().eq("user_id", u.id);
                      const { error } = await supabase.from("profiles").delete().eq("id", u.id);
                      if (error) return notify(error.message);
                      setAdminViewUser(null);
                      refreshAll();
                      notify(`🗑 ${u.name} deleted from the database.`);
                    }}>🗑 Delete this user from the database</button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {offline && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(13,16,20,.88)", zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <div style={{ width: 46, height: 46, border: "4px solid #243128", borderTopColor: "#E6B31E", borderRadius: "50%", animation: "spin .9s linear infinite" }} />
          <div className="display" style={{ fontSize: 18, color: T.floodlight }}>No connection</div>
          <div style={{ fontSize: 13, color: T.muted }}>Reconnecting to Area Match…</div>
        </div>
      )}
      {toast && <Toast msg={toast} />}
    </div>
  );
}

/* ============================================================ */

function SectionTitle({ children, color }) {
  return <div className="display" style={{ fontSize: 18, color, margin: "0 0 12px" }}>{children}</div>;
}

function BootSlowNotice() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  if (!slow) return null;
  return (
    <div style={{ fontSize: 13, color: "#8FA396", textAlign: "center", maxWidth: 280, lineHeight: 1.5 }}>
      This is taking longer than usual — your network may be slow. Hang tight, we're still loading…
    </div>
  );
}

function PwInput({ value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input className="input" type={show ? "text" : "password"} autoComplete={autoComplete} placeholder={placeholder} maxLength={64}
        style={{ paddingRight: 46 }} value={value} onChange={onChange} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} title={show ? "Hide password" : "Show password"}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: 0, color: "#8FA396", cursor: "pointer", padding: 8, display: "flex", alignItems: "center" }}>
        {show ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        )}
      </button>
    </div>
  );
}

function Toast({ msg }) {
  return (
    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", background: "#E6B31E", color: "#0C120E", padding: "10px 18px", borderRadius: 12, fontWeight: 700, fontSize: 14, zIndex: 100, boxShadow: "0 8px 30px rgba(0,0,0,.5)", maxWidth: "90%" }}>
      {msg}
    </div>
  );
}

function StatusChip({ m }) {
  const map = {
    Scheduled: { bg: "#243128", c: "#F5F0E1", t: "Scheduled" },
    Live: { bg: "#E8442E", c: "#ffffff", t: "● LIVE" },
    AwaitingScore: { bg: "#141c16", c: "#E6B31E", t: "Result Awaiting" },
    ResultPublished: { bg: "#14532D", c: "#E6B31E", t: "Result" },
    Cancelled: { bg: "rgba(198,80,63,.14)", c: "#E8442E", t: "❌ Cancelled" },
  };
  const ht = m.status === "Live" && (m.halfPrompt || m.onBreak);
  const s = ht ? { bg: "#141c16", c: "#E6B31E", t: "⏸ Half Time" } : map[m.status];
  return <span className={`chip ${m.status === "Live" && !ht ? "pulse" : ""}`} style={{ background: s.bg, color: s.c }}>{s.t}</span>;
}

/* ---------- Shared "How to go live" instructions — used at match creation AND during the match ---------- */
function StreamHelpModal({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", border: "1.5px solid #E6B31E", borderRadius: 20, padding: 22, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div className="display" style={{ fontSize: 18, color: "#E6B31E" }}>📖 How to go live</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, display: "grid", gap: 10 }}>
          <div><b style={{ color: "#E6B31E" }}>1.</b> No Facebook <b>Page</b> for your team yet? Create one free — Facebook → Menu → Pages → Create Page. Takes about 2 minutes.</div>
          <div><b style={{ color: "#E6B31E" }}>2.</b> <b style={{ color: "#E8442E" }}>Important:</b> go live <b>from your Page</b>, not your personal profile — Pages reliably give you a copyable link; personal profiles often don't.</div>
          <div><b style={{ color: "#E6B31E" }}>3.</b> On the Page, tap <b>Live</b> and set the audience to <b>Public 🌍</b>.</div>
          <div><b style={{ color: "#E6B31E" }}>4.</b> Start your broadcast.</div>
          <div><b style={{ color: "#E6B31E" }}>5.</b> Tap <b>Share → Copy Link</b>.</div>
          <div><b style={{ color: "#E6B31E" }}>6.</b> Come back here, paste the link and hit <b>Save</b> — fans will see 🔴 Watch Live instantly.</div>
          <div style={{ borderTop: "1px solid #243128", paddingTop: 10, color: "#8FA396", fontSize: 12 }}>
            💡 Tips: streaming ~90 minutes uses around 1.5–2GB of data. Prop your phone steady or let a teammate film — you're also running the match! YouTube also works reliably if you'd rather use that instead of Facebook.
          </div>
        </div>
        <button className="btn btn-gold" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

/* ---------- MY TEAMS — create/edit form ---------- */
function TeamFormModal({ existing, onSave, onDelete, onClose }) {
  const [name, setName] = useState(existing ? existing.name : "");
  const [color, setColor] = useState(existing ? existing.color : "#E6B31E");
  const [badge, setBadge] = useState(existing ? existing.badge : "ball");
  const [jerseyPattern, setJerseyPattern] = useState(existing ? existing.jerseyPattern || "solid" : "solid");
  const [jerseyTrim, setJerseyTrim] = useState(existing ? existing.jerseyTrim || "#F5F0E1" : "#F5F0E1");
  const [players, setPlayers] = useState(existing ? existing.players : "");
  const [formation, setFormation] = useState(existing ? existing.formation : null);
  const [positions, setPositions] = useState(existing && existing.positions ? existing.positions : {});
  const [activeSlot, setActiveSlot] = useState(null);
  const valid = name.trim().length > 0;
  const roster = players.split(",").map((s) => s.trim()).filter(Boolean);
  const usedNames = Object.values(positions);

  const pickFormation = (f) => { setFormation(f); setPositions({}); setActiveSlot(null); };
  const assign = (slotKey, playerName) => { setPositions((p) => ({ ...p, [slotKey]: playerName })); setActiveSlot(null); };
  const clearSlot = (slotKey) => { setPositions((p) => { const n = { ...p }; delete n[slotKey]; return n; }); setActiveSlot(null); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", border: "1.5px solid #243128", borderRadius: 20, padding: 22, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div className="display" style={{ fontSize: 18, color: "#E6B31E" }}>{existing ? "Edit Team" : "Create Team"}</div>
        <input className="input" placeholder="Team name" maxLength={24} value={name} onChange={(e) => setName(sanitizeText(e.target.value, 24))} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#8FA396" }}>Color:</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 52, height: 40, border: 0, borderRadius: 10, background: "none", cursor: "pointer" }} />
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {BADGES.map((b) => (
            <button key={b} className={`btn ${badge === b ? "btn-gold" : "btn-ghost"}`} style={{ padding: "5px 7px" }} onClick={() => setBadge(b)}>
              <MiniLogo team={{ name: "", color: badge === b ? "#1a1405" : "#3a4a3e" }} badge={b} size={24} />
            </button>
          ))}
        </div>

        <div style={{ borderTop: "1px solid #243128", paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#E6B31E", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 8 }}>👕 Team Jersey</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
            <Jersey pattern={jerseyPattern} main={color} trim={jerseyTrim} size={54} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {JERSEY_PATTERNS.map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setJerseyPattern(key)}
                    style={{ background: jerseyPattern === key ? "#E6B31E" : "#131a15", color: jerseyPattern === key ? "#1a1405" : "#F5F0E1", border: `1px solid ${jerseyPattern === key ? "#E6B31E" : "#243128"}`, borderRadius: 99, padding: "5px 10px", fontSize: 10.5, fontWeight: 700 }}>{label}</button>
                ))}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#8FA396" }}>
                Trim color
                <input type="color" value={jerseyTrim} onChange={(e) => setJerseyTrim(e.target.value)} style={{ width: 32, height: 28, border: 0, borderRadius: 6, background: "none", cursor: "pointer" }} />
              </label>
            </div>
          </div>
        </div>
        <textarea className="input" rows={3} placeholder="Squad — comma separated names (e.g. Tunde, Emeka, Ibrahim)" maxLength={300}
          value={players} onChange={(e) => setPlayers(e.target.value.slice(0, 300))} />

        <div style={{ borderTop: "1px solid #243128", paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#E6B31E", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 8 }}>⚽ Formation (optional)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {Object.keys(FORMATIONS).map((f) => (
              <button key={f} type="button" onClick={() => pickFormation(f)}
                style={{ background: formation === f ? "#E6B31E" : "#131a15", color: formation === f ? "#1a1405" : "#F5F0E1", border: `1px solid ${formation === f ? "#E6B31E" : "#243128"}`, borderRadius: 99, padding: "7px 12px", fontSize: 12, fontWeight: 700 }}>{f}</button>
            ))}
            {formation && <button type="button" onClick={() => pickFormation(null)} style={{ background: "none", border: "1px solid #3a1f1a", color: "#E8442E", borderRadius: 99, padding: "7px 12px", fontSize: 12 }}>Remove</button>}
          </div>

          {formation && roster.length === 0 && <div style={{ fontSize: 12, color: "#8FA396" }}>Add your squad names above first, then assign them to positions here.</div>}

          {formation && roster.length > 0 && (
            <>
              <div style={{ position: "relative", width: "100%", aspectRatio: "0.72", borderRadius: 12, overflow: "hidden", background: "repeating-linear-gradient(0deg, #1c6b3a 0 20px, #17602f 20px 40px)", border: "2px solid rgba(245,240,225,.4)", marginBottom: 10 }}>
                <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1.5, background: "rgba(245,240,225,.4)" }} />
                <div style={{ position: "absolute", width: "22%", aspectRatio: "1", border: "1.5px solid rgba(245,240,225,.4)", borderRadius: "50%", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }} />
                {FORMATIONS[formation].map((slot) => {
                  const filled = positions[slot.key];
                  return (
                    <div key={slot.key} onClick={() => setActiveSlot(slot.key)}
                      style={{ position: "absolute", left: `${slot.x}%`, top: `${slot.y}%`, transform: "translate(-50%,-50%)", width: "16%", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }}>
                      <svg width="60%" viewBox="0 0 100 116" style={{ filter: activeSlot === slot.key ? "drop-shadow(0 0 3px #fff)" : "none" }}>
                        <path d={JERSEY_PATH} fill={filled ? "#E6B31E" : "#131a15"} stroke={filled ? "#0f3620" : "#3a4a3e"} strokeWidth="4" strokeDasharray={filled ? "0" : "6 5"} />
                      </svg>
                      <div style={{ fontSize: 7.5, textAlign: "center", lineHeight: 1.1, color: filled ? "#F5F0E1" : "#8FA396", fontWeight: 700, marginTop: 2, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {filled || slot.key}
                      </div>
                    </div>
                  );
                })}
              </div>
              {activeSlot && (
                <div style={{ background: "#131a15", border: "1px solid #243128", borderRadius: 12, padding: 10, marginBottom: 4 }}>
                  <div style={{ fontSize: 10, color: "#8FA396", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Assign {activeSlot}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {roster.map((p) => (
                      <button key={p} type="button" onClick={() => assign(activeSlot, p)}
                        style={{ opacity: usedNames.includes(p) && positions[activeSlot] !== p ? 0.35 : 1, background: positions[activeSlot] === p ? "rgba(230,179,30,.15)" : "#0f1511", border: `1px solid ${positions[activeSlot] === p ? "#E6B31E" : "#243128"}`, color: "#F5F0E1", borderRadius: 99, padding: "6px 11px", fontSize: 11.5 }}>{p}</button>
                    ))}
                    {positions[activeSlot] && <button type="button" onClick={() => clearSlot(activeSlot)} style={{ background: "none", border: "1px solid #3a1f1a", color: "#E8442E", borderRadius: 99, padding: "6px 11px", fontSize: 11.5 }}>✕ Clear</button>}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: "#8FA396" }}>{Object.keys(positions).length}/11 positions assigned. Fans will see whatever's filled in — the rest is fine to leave blank.</div>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {existing && <button className="btn btn-ghost" style={{ color: "#E8442E", borderColor: "#3a1f1a" }} onClick={() => onDelete(existing.id, existing.name)}>🗑 Delete</button>}
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" style={{ flex: 2, opacity: valid ? 1 : .5 }} disabled={!valid}
            onClick={() => valid && onSave({ name: name.trim(), color, badge, players, formation, positions: formation ? positions : null, jerseyPattern, jerseyTrim })}>{existing ? "Save changes" : "Create team"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- AWARDS — give recognition to registered players. Substitution used
   to live here too; it now belongs to the team Edit screen, leaving this page
   to do one thing well. ---------- */
function SquadManageModal({ team, linkedPlayers, playerLevel, playerStats, playerAwards, onGiveAward, onClose }) {
  const [awardMenuFor, setAwardMenuFor] = useState(null);
  const [tab, setTab] = useState("give");
  const roster = (team.players || "").split(",").map((p) => p.trim()).filter(Boolean);
  const withLink = roster.map((name) => ({ name, linked: linkedPlayers.find((pl) =>
    pl.rosterName.trim().toLowerCase() === name.trim().toLowerCase() &&
    (pl.teamName || "").trim().toLowerCase() === (team.name || "").trim().toLowerCase()) }));

  /* Registered players first, then by goals — the ones most likely to deserve
     something sit at the top rather than in roster order. */
  const registered = withLink.filter((p) => p.linked).sort((a, b) => {
    const ga = playerStats(a.linked).goals, gb = playerStats(b.linked).goals;
    return gb - ga;
  });
  const unregistered = withLink.filter((p) => !p.linked);

  const teamAwards = playerAwards.filter((a) => a.teamId === team.id);
  const recent = [...teamAwards].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 8);

  const Lbl = ({ children, style }) => (
    <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 11, ...style }}>{children}</div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0A0D0A", zIndex: 92, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 16px", flexShrink: 0 }}>
        <button onClick={onClose} className="tappable" style={{ display: "flex", alignItems: "center", gap: 5, height: 29, padding: "0 12px", border: "1px solid #1b241c", borderRadius: 8, background: "none", color: "#B9C7BC", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Back
        </button>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", maxWidth: 430, width: "100%", margin: "0 auto" }}>
        {/* Hero */}
        <div style={{ position: "relative", padding: "4px 16px 0", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -70, left: -10, width: 230, height: 200, background: "radial-gradient(ellipse, rgba(214,168,29,.10), transparent 68%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 14 }}>
            <MiniLogo team={team} badge={team.badge} size={46} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 21, lineHeight: 1.05, color: "#F7F4EA" }}>Awards</div>
              <div style={{ fontSize: 11.5, color: "#7d8f83", marginTop: 5 }}>{team.name}</div>
            </div>
          </div>
          <div style={{ position: "relative", display: "flex", marginTop: 16, borderTop: "1px solid #151c16", borderBottom: "1px solid #151c16" }}>
            {[[teamAwards.length, "Given", true], [registered.length, "Eligible", false], [roster.length, "Squad", false]].map((f, i) => (
              <div key={f[1]} style={{ flex: 1, padding: "12px 4px", textAlign: "center", borderRight: i < 2 ? "1px solid #151c16" : "none" }}>
                <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 19, color: f[2] ? "#D6A81D" : "#F7F4EA" }}>{f[0]}</div>
                <div style={{ fontSize: 8.5, color: "#5a6a5f", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>{f[1]}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", padding: "0 16px", borderBottom: "1px solid #151c16", gap: 22 }}>
          {[["give", "Give award"], ["recent", "Recently given"]].map((t) => (
            <button key={t[0]} onClick={() => setTab(t[0])}
              style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 12.5, color: tab === t[0] ? "#F7F4EA" : "#5a6a5f", fontWeight: tab === t[0] ? 600 : 500, padding: "12px 0", cursor: "pointer", borderBottom: "1.5px solid " + (tab === t[0] ? "#D6A81D" : "transparent"), marginBottom: -1 }}>
              {t[1]}
            </button>
          ))}
        </div>

        <div style={{ padding: "17px 16px 24px" }}>
          {tab === "give" && (
            <>
              {registered.length === 0 && (
                <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 12.5, color: "#B9C7BC", fontWeight: 600 }}>No registered players yet</div>
                  <div style={{ fontSize: 10.5, color: "#5a6a5f", marginTop: 5, lineHeight: 1.5 }}>Players need an Area Match account before they can receive awards.</div>
                </div>
              )}

              {registered.length > 0 && <Lbl>Tap a player to award them</Lbl>}
              {registered.map((p) => {
                const linked = p.linked;
                const stats = playerStats(linked);
                const lvl = playerLevel ? playerLevel(linked) : null;
                const mine = playerAwards.filter((a) => a.playerId === linked.id);
                const open = awardMenuFor === linked.id;
                return (
                  <div key={linked.id} style={{ borderBottom: "1px solid #121a14" }}>
                    <div className="tappable" onClick={() => setAwardMenuFor(open ? null : linked.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", cursor: "pointer" }}>
                      <Jersey pattern={linked.jerseyPattern} main={linked.jerseyMain} trim={linked.jerseyTrim} size={22} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F7F4EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>
                          {stats.goals} goal{stats.goals === 1 ? "" : "s"} · {stats.matches} match{stats.matches === 1 ? "" : "es"}
                          {lvl && lvl.tier ? ` · ${lvl.tier.name}` : ""}
                        </div>
                        {mine.length > 0 && (
                          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                            {mine.slice(0, 6).map((a) => {
                              const info = AWARD_TYPES[a.awardType] || { art: "motm" };
                              return <TrophyIcon key={a.id} art={info.art} size={15} />;
                            })}
                            {mine.length > 6 && <span style={{ fontSize: 9, color: "#4e5c53", alignSelf: "center" }}>+{mine.length - 6}</span>}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: open ? "#D6A81D" : "#4e5c53", flexShrink: 0 }}>{open ? "⌃" : "⌄"}</span>
                    </div>

                    {open && (
                      <div style={{ paddingBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        {Object.entries(AWARD_TYPES).map(([key, info]) => (
                          <button key={key} className="tappable"
                            onClick={() => { onGiveAward(linked.id, team.id, key); setAwardMenuFor(null); }}
                            style={{ display: "flex", alignItems: "center", gap: 7, background: "#0E140F", border: "1px solid #1b241c", borderRadius: 9, padding: "8px 9px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                            <TrophyIcon art={info.art} size={18} />
                            <span style={{ fontSize: 10, color: "#EDEAE0", fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {unregistered.length > 0 && (
                <>
                  <Lbl style={{ marginTop: 22 }}>Not on Area Match · {unregistered.length}</Lbl>
                  <div style={{ fontSize: 10.5, color: "#5a6a5f", lineHeight: 1.5, marginBottom: 10 }}>
                    These players can't receive awards until they create an account.
                  </div>
                  {unregistered.map((p, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#8FA396", padding: "8px 0", borderBottom: i < unregistered.length - 1 ? "1px solid #121a14" : "none" }}>{p.name}</div>
                  ))}
                </>
              )}
            </>
          )}

          {tab === "recent" && (
            <>
              {recent.length === 0 && (
                <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 12.5, color: "#B9C7BC", fontWeight: 600 }}>No awards given yet</div>
                  <div style={{ fontSize: 10.5, color: "#5a6a5f", marginTop: 5, lineHeight: 1.5 }}>Awards you give will be listed here, and appear on the player's profile.</div>
                </div>
              )}
              {recent.map((a) => {
                const info = AWARD_TYPES[a.awardType] || { label: a.awardType, art: "motm" };
                const who = linkedPlayers.find((pl) => pl.id === a.playerId);
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14" }}>
                    <TrophyIcon art={info.art} size={26} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F7F4EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who ? who.name : "Player"}</div>
                      <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{info.label}</div>
                    </div>
                    {a.createdAt && (
                      <div style={{ fontSize: 9, color: "#3f4b43", flexShrink: 0 }}>
                        {new Date(a.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- TEAM PROFILE — tabbed, stats-led, matching the player profile language ---------- */
function TeamProfileModal({ team, record, onClose, linkedPlayers = [], onOpenPlayer, me, supporterCount = 0, isSupporting = false, onToggleSupport, playerAwards = [], allMatches = [] }) {
  const [tab, setTab] = useState("overview");
  const [squadView, setSquadView] = useState("list");
  if (!team) return null;

  const roster = (team.players || "").split(",").map((p) => p.trim()).filter(Boolean);
  const linkFor = (name) => linkedPlayers.find((pl) =>
    pl.rosterName.trim().toLowerCase() === name.trim().toLowerCase() &&
    (pl.teamName || "").trim().toLowerCase() === (team.name || "").trim().toLowerCase());

  const results = record.results || [];
  const winRate = record.total > 0 ? Math.round((record.wins / record.total) * 100) : null;
  const goalsFor = results.reduce((a, r) => a + (r.us || 0), 0);
  const perMatch = record.total > 0 ? (goalsFor / record.total).toFixed(1) : "0.0";

  /* Longest winning run across their history */
  let bestRun = 0, run = 0;
  [...results].reverse().forEach((r) => { if (r.outcome === "W") { run++; bestRun = Math.max(bestRun, run); } else run = 0; });

  /* Biggest win — largest margin, tie-broken by goals scored */
  const biggestWin = results.filter((r) => r.outcome === "W")
    .sort((a, b) => ((b.us - b.them) - (a.us - a.them)) || (b.us - a.us))[0] || null;

  /* Awards won by players registered to this team */
  const squadAwards = playerAwards.filter((a) => a.teamId === team.id).length;
  const newTeam = record.total < 3;

  const Label = ({ children, style }) => (
    <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 12, ...style }}>{children}</div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0A0D0A", zIndex: 90, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 16px", flexShrink: 0 }}>
        <button onClick={onClose} className="tappable" style={{ display: "flex", alignItems: "center", gap: 5, height: 28, padding: "0 12px", border: "1px solid #1f2921", borderRadius: 8, background: "none", color: "#B9C7BC", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}><span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Back</button>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", maxWidth: 430, width: "100%", margin: "0 auto" }}>
        {/* Hero */}
        <div style={{ position: "relative", padding: "4px 16px 0", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -70, left: -10, width: 230, height: 200, background: "radial-gradient(ellipse, rgba(214,168,29,.10), transparent 68%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 14 }}>
            <MiniLogo team={team} badge={team.badge} size={52} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 24, lineHeight: 1.03, color: "#F7F4EA" }}>{team.name}</div>
              <div style={{ fontSize: 11.5, color: "#7d8f83", marginTop: 6 }}>
                {team.captainName ? <>Captained by <b style={{ color: "#B9C7BC", fontWeight: 600 }}>{team.captainName}</b></> : "Community team"}
              </div>
              {record.ratingReady && (
                <div style={{ fontSize: 13, letterSpacing: 1.5, marginTop: 8, color: "#D6A81D" }}>
                  {"★".repeat(Math.round(record.rating))}<span style={{ color: "#2a3630" }}>{"★".repeat(Math.max(0, 5 - Math.round(record.rating)))}</span>
                  <span style={{ fontFamily: "'Anton', sans-serif", fontSize: 12, marginLeft: 6 }}>{record.rating}</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ position: "relative", display: "flex", marginTop: 18, borderTop: "1px solid #151c16", borderBottom: "1px solid #151c16" }}>
            {[[winRate !== null ? `${winRate}%` : "—", "Win rate", true], [perMatch, "Goals / match", false], [record.total, "Played", false]].map(([n, l, gold], i) => (
              <div key={l} style={{ flex: 1, padding: "13px 4px", textAlign: "center", borderRight: i < 2 ? "1px solid #151c16" : "none" }}>
                <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 20, color: gold ? "#D6A81D" : "#F7F4EA" }}>{n}</div>
                <div style={{ fontSize: 8.5, color: "#5a6a5f", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>{l}</div>
              </div>
            ))}
          </div>

          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "13px 0" }}>
            <div style={{ fontSize: 11.5, color: "#7d8f83" }}><b style={{ color: "#F7F4EA", fontWeight: 600 }}>{supporterCount}</b> supporter{supporterCount === 1 ? "" : "s"}</div>
            {me && me.role !== "Captain" && onToggleSupport && (
              <button className="tappable" onClick={() => onToggleSupport(team.id)}
                style={{ marginLeft: "auto", border: `1px solid ${isSupporting ? "#D6A81D" : "#2a3d31"}`, background: isSupporting ? "#D6A81D" : "none", color: isSupporting ? "#12160f" : "#EDEAE0", borderRadius: 99, padding: "6px 13px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {isSupporting ? "✓ Supporting" : "Support"}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", padding: "0 16px", borderBottom: "1px solid #151c16", gap: 22 }}>
          {[["overview", "Overview"], ["squad", "Squad"], ["record", "Record"]].map(([key, lbl]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 12.5, color: tab === key ? "#F7F4EA" : "#5a6a5f", fontWeight: tab === key ? 600 : 500, padding: "12px 0", cursor: "pointer", borderBottom: `1.5px solid ${tab === key ? "#D6A81D" : "transparent"}`, marginBottom: -1 }}>
              {lbl}
            </button>
          ))}
        </div>

        <div style={{ padding: "17px 16px 24px" }}>
          {/* ---------- OVERVIEW ---------- */}
          {tab === "overview" && (
            <>
              {results.length > 0 && (
                <>
                  <Label>Recent form</Label>
                  <div style={{ display: "flex", gap: 5, marginBottom: 20 }}>
                    {results.slice(0, 5).reverse().map((r, i) => (
                      <div key={i} style={{ width: 22, height: 22, borderRadius: 5, fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                        background: r.outcome === "W" ? "rgba(63,163,91,.16)" : r.outcome === "L" ? "rgba(198,80,63,.14)" : "rgba(140,150,145,.14)",
                        color: r.outcome === "W" ? "#5fcf87" : r.outcome === "L" ? "#e08a7d" : "#93a099",
                        border: `1px solid ${r.outcome === "W" ? "rgba(63,163,91,.3)" : r.outcome === "L" ? "rgba(198,80,63,.28)" : "rgba(140,150,145,.25)"}` }}>{r.outcome}</div>
                    ))}
                  </div>
                </>
              )}

              {biggestWin && (
                <>
                  <Label>Biggest win</Label>
                  <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 14, marginBottom: 20 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#D6A81D" }}>{biggestWin.us}–{biggestWin.them}</div>
                    <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 16, marginTop: 8, color: "#F7F4EA" }}>vs {biggestWin.opponent}</div>
                    <div style={{ fontSize: 10.5, color: "#7d8f83", marginTop: 3 }}>{biggestWin.match.date}{biggestWin.match.location ? ` · ${biggestWin.match.location}` : ""}</div>
                  </div>
                </>
              )}

              <Label>Team honours</Label>
              {newTeam ? (
                <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 12.5, color: "#B9C7BC", fontWeight: 600 }}>Building their record</div>
                  <div style={{ fontSize: 10.5, color: "#5a6a5f", marginTop: 5, lineHeight: 1.5 }}>
                    Honours appear once this team has played a few more matches.
                  </div>
                </div>
              ) : (
                <>
                  {[
                    ["Longest winning run", bestRun > 0 ? `${bestRun} in a row` : "None yet", bestRun],
                    ["Goals scored", `Across ${record.total} matches`, goalsFor],
                    ["Player awards won", "Across the squad", squadAwards],
                  ].map(([name, sub, val]) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14" }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: "#141c16", border: "1px solid #1f2a22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <TrophyIcon art="motm" size={17} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{name}</div>
                        <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{sub}</div>
                      </div>
                      <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 14, color: "#D6A81D" }}>{val}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* ---------- SQUAD ---------- */}
          {tab === "squad" && (
            <>
              {team.formation && team.positions && (
                <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                  {[["list", "List"], ["pitch", "Pitch"]].map(([key, lbl]) => (
                    <button key={key} onClick={() => setSquadView(key)}
                      style={{ fontSize: 10.5, padding: "5px 12px", borderRadius: 99, fontFamily: "inherit", cursor: "pointer",
                        background: squadView === key ? "#16211a" : "none",
                        border: `1px solid ${squadView === key ? "#2a3d31" : "#1b241c"}`,
                        color: squadView === key ? "#EDEAE0" : "#5a6a5f", fontWeight: squadView === key ? 600 : 500 }}>{lbl}</button>
                  ))}
                </div>
              )}

              {squadView === "pitch" && team.formation && team.positions ? (
                <>
                  <Label>Formation · {team.formation}</Label>
                  <div style={{ position: "relative", width: "100%", aspectRatio: "0.78", borderRadius: 10, background: "repeating-linear-gradient(0deg,#16301d 0 18px,#123018 18px 36px)", border: "1px solid #223a29" }}>
                    <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(245,240,225,.2)" }} />
                    {(FORMATIONS[team.formation] || []).map((slot) => {
                      const filled = team.positions[slot.key];
                      if (!filled) return null;
                      return (
                        <div key={slot.key} style={{ position: "absolute", left: `${slot.x}%`, top: `${slot.y}%`, transform: "translate(-50%,-50%)", width: "16%", display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <svg width="60%" viewBox="0 0 100 116"><path d={JERSEY_PATH} fill="#D6A81D" stroke="#0f3620" strokeWidth="4" /></svg>
                          <div style={{ fontSize: 7, textAlign: "center", lineHeight: 1.1, color: "#EDEAE0", fontWeight: 600, marginTop: 2, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filled}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <Label>Squad · {roster.length} player{roster.length === 1 ? "" : "s"}</Label>
                  {roster.length === 0 && <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>No squad listed yet.</div>}
                  {roster.map((name, i) => {
                    const linked = linkFor(name);
                    const g = linked ? (linked._goals !== undefined ? linked._goals : null) : null;
                    return (
                      <div key={i} className={linked ? "tappable" : ""}
                        onClick={() => linked && onOpenPlayer && onOpenPlayer(linked.id)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #121a14", cursor: linked ? "pointer" : "default" }}>
                        {linked && <Jersey pattern={linked.jerseyPattern} main={linked.jerseyMain} trim={linked.jerseyTrim} size={18} />}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500, color: linked ? "#D6A81D" : "#EDEAE0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {name}{linked ? " ›" : ""}
                          </div>
                          {!linked && <div style={{ fontSize: 9, color: "#3f4b43", marginTop: 2 }}>not on Area Match</div>}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {/* ---------- RECORD ---------- */}
          {tab === "record" && (
            <>
              <Label>{record.total} match{record.total === 1 ? "" : "es"} · {record.wins}W {record.draws}D {record.losses}L</Label>
              {results.length === 0 && <div style={{ fontSize: 12.5, color: "#7d8f83", padding: "10px 0" }}>No published results yet.</div>}
              {results.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14" }}>
                  <div style={{ width: 19, height: 19, borderRadius: 4, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    background: r.outcome === "W" ? "rgba(63,163,91,.16)" : r.outcome === "L" ? "rgba(198,80,63,.14)" : "rgba(140,150,145,.14)",
                    color: r.outcome === "W" ? "#5fcf87" : r.outcome === "L" ? "#e08a7d" : "#93a099",
                    border: `1px solid ${r.outcome === "W" ? "rgba(63,163,91,.3)" : r.outcome === "L" ? "rgba(198,80,63,.28)" : "rgba(140,150,145,.25)"}` }}>{r.outcome}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.opponent}</div>
                    <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{r.match.date}{r.match.location ? ` · ${r.match.location}` : ""}</div>
                  </div>
                  <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 13, color: "#7d8f83", width: 34, textAlign: "right", flexShrink: 0 }}>{r.us}–{r.them}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- PLAYER PROFILE — a real page, reachable from anywhere a name is clickable ---------- */
/* ---------- PLAYER PROFILE — tabbed, stats-led. A real page, not a popup. ---------- */
const PP = { gold: "#D6A81D", ink: "#F7F4EA", body: "#EDEAE0", dim: "#7d8f83", faint: "#5a6a5f", ghost: "#4e5c53", panel: "#0E140F", line: "#1b241c", hair: "#151c16", bg: "#0A0D0A" };

function PlayerProfilePage({ player, data, level, team, onClose, onOpenCard, onOpenAward, onOpenTeam, onShareProfile }) {
  const [tab, setTab] = useState("overview");
  if (!player) return null;
  const { history = [], streak = 0, lastBlank, standout, standing, perMatch = 0, awards = [], goals = 0, matches = 0 } = data || {};
  const form = history.slice(0, 5).reverse(); // oldest→newest for the chart
  const maxGoals = Math.max(1, ...form.map((f) => f.goals));
  const abbrev = (s) => (s || "").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean)[0]?.slice(0, 3).toUpperCase() || "—";

  const Label = ({ children, style }) => (
    <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: PP.ghost, fontWeight: 700, marginBottom: 13, ...style }}>{children}</div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: PP.bg, zIndex: 90, display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 17px", flexShrink: 0 }}>
        <button onClick={onClose} className="tappable" style={{ display: "flex", alignItems: "center", gap: 5, height: 29, padding: "0 12px", border: `1px solid ${PP.line}`, borderRadius: 8, background: "none", color: PP.dim, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}><span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Back</button>
        <div style={{ flex: 1 }} />
        <button onClick={onShareProfile} title="Share profile" style={{ width: 29, height: 29, border: `1px solid ${PP.line}`, borderRadius: 8, background: "none", color: PP.gold, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", maxWidth: 430, width: "100%", margin: "0 auto" }}>
        {/* Hero — persists across tabs */}
        <div style={{ position: "relative", padding: "6px 17px 0", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -70, left: -10, width: 230, height: 200, background: "radial-gradient(ellipse, rgba(214,168,29,.10), transparent 68%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 15 }}>
            <div style={{ flexShrink: 0, filter: "drop-shadow(0 4px 12px rgba(0,0,0,.5))" }}>
              <Jersey pattern={player.jerseyPattern} main={player.jerseyMain} trim={player.jerseyTrim} size={54} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 25, lineHeight: 1.02, color: PP.ink }}>{player.name}</div>
              <div style={{ fontSize: 11.5, color: PP.dim, marginTop: 7 }}>
                {player.positionPlayed && <b style={{ color: "#B9C7BC", fontWeight: 600 }}>{player.positionPlayed}</b>}
                {player.positionPlayed && team ? " · " : ""}
                {team && <span onClick={() => onOpenTeam && onOpenTeam(team.id)} style={{ cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>{team.name}</span>}
                {player.state ? ` · ${player.state}` : ""}
              </div>
              {level && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 9, background: "rgba(214,168,29,.10)", border: "1px solid rgba(214,168,29,.28)", borderRadius: 6, padding: "3px 9px", fontSize: 10, fontWeight: 600, color: PP.gold, letterSpacing: ".4px" }}>
                  {level.tier.icon} {level.tier.name.toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* Key figures */}
          <div style={{ position: "relative", display: "flex", marginTop: 20, borderTop: `1px solid ${PP.hair}`, borderBottom: `1px solid ${PP.hair}` }}>
            {[[perMatch.toFixed(2), "Goals / match", true], [goals, "Goals", false], [matches, "Matches", false]].map(([n, l, gold], i) => (
              <div key={l} style={{ flex: 1, padding: "14px 4px", textAlign: "center", borderRight: i < 2 ? `1px solid ${PP.hair}` : "none" }}>
                <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 21, color: gold ? PP.gold : PP.ink }}>{n}</div>
                <div style={{ fontSize: 8.5, color: PP.faint, letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", padding: "0 17px", borderBottom: `1px solid ${PP.hair}`, gap: 26 }}>
          {[["overview", "Overview"], ["matches", "Matches"], ["honours", "Honours"]].map(([key, lbl]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 12.5, color: tab === key ? PP.ink : PP.faint, fontWeight: tab === key ? 600 : 500, padding: "13px 0", position: "relative", cursor: "pointer", borderBottom: `1.5px solid ${tab === key ? PP.gold : "transparent"}`, marginBottom: -1 }}>
              {lbl}
            </button>
          ))}
        </div>

        <div style={{ padding: "18px 17px 22px" }}>
          {/* ---------- OVERVIEW ---------- */}
          {tab === "overview" && (
            <>
              {streak > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 11, background: PP.panel, border: `1px solid ${PP.line}`, borderRadius: 10, padding: "12px 13px", marginBottom: 20 }}>
                  <div style={{ width: 3, alignSelf: "stretch", background: PP.gold, borderRadius: 2 }} />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: PP.ink }}>{streak}-match scoring streak</div>
                    {lastBlank && <div style={{ fontSize: 10.5, color: PP.dim, marginTop: 2 }}>Last blank — {lastBlank.date} vs {lastBlank.opponent}</div>}
                  </div>
                </div>
              )}

              {form.length > 0 && (
                <>
                  <Label>Recent form</Label>
                  <div style={{ display: "flex", gap: 7, alignItems: "flex-end", height: 52, marginBottom: 7 }}>
                    {form.map((f, i) => (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, height: "100%", justifyContent: "flex-end" }}>
                        <div style={{ fontSize: 9, color: PP.faint, fontWeight: 600 }}>{f.goals}</div>
                        <div style={{ width: "100%", borderRadius: 2, height: f.goals > 0 ? `${Math.max(18, (f.goals / maxGoals) * 78)}%` : "5%", background: f.goals > 0 ? "linear-gradient(180deg,#D6A81D,#8a6b12)" : "#161f18" }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 7 }}>
                    {form.map((f, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 8.5, color: "#3f4b43" }}>{abbrev(f.opponent)}</div>)}
                  </div>
                </>
              )}

              {standout && (
                <>
                  <Label style={{ marginTop: 22 }}>Standout performance</Label>
                  <div style={{ background: PP.panel, border: `1px solid ${PP.line}`, borderRadius: 11, padding: 15 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: PP.gold }}>
                        {standout.goals >= 3 ? "Hat-trick" : standout.goals === 2 ? "Brace" : "Best game"}
                      </span>
                      <span style={{ fontSize: 9.5, color: PP.ghost }}>{standout.date}</span>
                    </div>
                    <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 17, color: PP.ink }}>vs {standout.opponent}</div>
                    <div style={{ fontSize: 10.5, color: PP.dim, marginTop: 3 }}>
                      {standout.location}{standout.location ? " · " : ""}{standout.outcome === "W" ? "Won" : standout.outcome === "L" ? "Lost" : "Drew"} {standout.us}–{standout.them}
                    </div>
                    <div style={{ display: "flex", marginTop: 13, paddingTop: 12, borderTop: "1px solid #171f18" }}>
                      {[[standout.goals, "Goals"], [standout.award ? (AWARD_TYPES[standout.award.awardType]?.label.split(" ").map((w) => w[0]).join("") || "★") : "—", "Award"], [`${standout.us}–${standout.them}`, "Result"]].map(([n, l]) => (
                        <div key={l} style={{ flex: 1 }}>
                          <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 15, color: PP.gold }}>{n}</div>
                          <div style={{ fontSize: 8.5, color: PP.ghost, letterSpacing: ".9px", textTransform: "uppercase", marginTop: 2 }}>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {standing && (
                <>
                  <Label style={{ marginTop: 22 }}>Squad standing</Label>
                  <div style={{ display: "flex", gap: 9 }}>
                    {[
                      [standing.goalRank > 0 ? `#${standing.goalRank}` : "—", "Top scorer"],
                      [standing.awardRank > 0 ? `#${standing.awardRank}` : "—", "Most awarded"],
                      [standing.winRateScoring !== null ? `${standing.winRateScoring}%` : "—", "Win rate when he scores"],
                    ].map(([n, l]) => (
                      <div key={l} style={{ flex: 1, background: PP.panel, border: `1px solid ${PP.line}`, borderRadius: 10, padding: "13px 10px" }}>
                        <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 19, color: PP.ink }}>{n}</div>
                        <div style={{ fontSize: 9, color: PP.faint, marginTop: 4, lineHeight: 1.35 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {history.length === 0 && (
                <div style={{ fontSize: 12.5, color: PP.dim, textAlign: "center", padding: "24px 0" }}>
                  No published matches yet — stats appear once results are in.
                </div>
              )}
            </>
          )}

          {/* ---------- MATCHES ---------- */}
          {tab === "matches" && (
            <>
              <Label>
                {history.length} appearance{history.length === 1 ? "" : "s"}
                {standing ? ` · ${standing.wins}W ${standing.draws}D ${standing.losses}L` : ""}
              </Label>
              {history.length === 0 && <div style={{ fontSize: 12.5, color: PP.dim, padding: "10px 0" }}>No matches played yet.</div>}
              {history.map((h) => (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 0", borderBottom: `1px solid #121a14` }}>
                  <div style={{ width: 19, height: 19, borderRadius: 4, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    background: h.outcome === "W" ? "rgba(63,163,91,.16)" : h.outcome === "L" ? "rgba(198,80,63,.14)" : "rgba(140,150,145,.14)",
                    color: h.outcome === "W" ? "#5fcf87" : h.outcome === "L" ? "#e08a7d" : "#93a099",
                    border: `1px solid ${h.outcome === "W" ? "rgba(63,163,91,.3)" : h.outcome === "L" ? "rgba(198,80,63,.28)" : "rgba(140,150,145,.25)"}` }}>{h.outcome}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: PP.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.opponent}</div>
                    <div style={{ fontSize: 9.5, color: PP.ghost, marginTop: 2 }}>{h.date}{h.location ? ` · ${h.location}` : ""}</div>
                  </div>
                  <div style={{ fontSize: 10, color: h.goals > 0 ? PP.gold : "#2f3a33", fontWeight: 700, letterSpacing: ".5px", flexShrink: 0 }}>{h.goals > 0 ? `${h.goals} G` : "—"}</div>
                  <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 12.5, color: PP.dim, width: 32, textAlign: "right", flexShrink: 0 }}>{h.us}–{h.them}</div>
                </div>
              ))}
            </>
          )}

          {/* ---------- HONOURS ---------- */}
          {tab === "honours" && (
            <>
              <Label>{awards.length} award{awards.length === 1 ? "" : "s"}</Label>
              {awards.length === 0 && <div style={{ fontSize: 12.5, color: PP.dim, padding: "10px 0" }}>No awards yet.</div>}
              {awards.map((a) => {
                const info = AWARD_TYPES[a.awardType] || { label: a.awardType, art: "motm" };
                const inMatch = history.find((h) => h.id === a.matchId);
                return (
                  <div key={a.id} onClick={() => onOpenAward(a.id)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: `1px solid #121a14`, cursor: "pointer" }}>
                    <TrophyIcon art={info.art} size={26} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{info.label}</div>
                      <div style={{ fontSize: 9.5, color: PP.ghost, marginTop: 2 }}>
                        {inMatch ? `vs ${inMatch.opponent} · ` : ""}{new Date(a.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: PP.ghost }}>›</span>
                  </div>
                );
              })}

              {level && (
                <>
                  <Label style={{ marginTop: 24 }}>{level.next ? `Progress to ${level.next.name}` : "Level"}</Label>
                  <div style={{ background: PP.panel, border: `1px solid ${PP.line}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                      <span style={{ color: "#B9C7BC", fontWeight: 600 }}>{level.tier.icon} {level.tier.name}</span>
                      <span style={{ color: PP.faint }}>{level.next ? `${level.score} / ${level.next.min} pts` : `${level.score} pts`}</span>
                    </div>
                    <div style={{ height: 4, background: "#161f18", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${level.progress * 100}%`, height: "100%", background: PP.gold, borderRadius: 99 }} />
                    </div>
                    <div style={{ fontSize: 9.5, color: PP.ghost, marginTop: 9, lineHeight: 1.4 }}>
                      {level.next
                        ? <>{level.next.min - level.score} more points to reach <span style={{ color: "#B9C7BC" }}>{level.next.name}</span> — earn points from goals, hat-tricks and awards.</>
                        : "Highest level reached."}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ display: "flex", gap: 9, padding: "0 17px 22px" }}>
          <button onClick={onShareProfile} style={{ flex: 1, borderRadius: 8, padding: 11, textAlign: "center", fontSize: 12, fontWeight: 600, fontFamily: "inherit", background: "none", border: `1px solid ${PP.line}`, color: "#B9C7BC", cursor: "pointer" }}>Share profile</button>
          <button onClick={() => onOpenCard(player.id)} style={{ flex: 1, borderRadius: 8, padding: 11, textAlign: "center", fontSize: 12, fontWeight: 600, fontFamily: "inherit", background: PP.gold, color: "#12160f", border: 0, cursor: "pointer" }}>Download card</button>
        </div>
      </div>
    </div>
  );
}


/* ---------- JERSEY — flat vector kit graphic, five patterns ---------- */
const JERSEY_PATTERNS = [
  ["solid", "Solid"], ["vstripes", "V-Stripes"], ["hstripes", "H-Stripes"], ["halves", "Halves"], ["sleeves", "Sleeves"],
];
const JERSEY_PATH = "M50 8 L36 0 L20 10 L2 26 L14 40 L24 32 L24 108 Q50 116 76 108 L76 32 L86 40 L98 26 L80 10 L64 0 Z";
function Jersey({ pattern = "solid", main = "#E6B31E", trim = "#F5F0E1", size = 60 }) {
  const clipId = `jc-${pattern}-${main.replace("#", "")}-${trim.replace("#", "")}-${size}`;
  return (
    <svg width={size} height={size * 1.16} viewBox="0 0 100 116" style={{ flexShrink: 0 }}>
      <defs><clipPath id={clipId}><path d={JERSEY_PATH} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="100" height="116" fill={main} />
        {pattern === "vstripes" && [10, 38, 66, 94].map((x) => <rect key={x} x={x} width="14" height="116" fill={trim} />)}
        {pattern === "hstripes" && [26, 54, 82].map((y) => <rect key={y} y={y} width="100" height="14" fill={trim} />)}
        {pattern === "halves" && <rect x="50" width="50" height="116" fill={trim} />}
        {pattern === "sleeves" && (<>
          <path d="M20 10 L2 26 L14 40 L24 32 L24 44 L20 10Z" fill={trim} />
          <path d="M80 10 L98 26 L86 40 L76 32 L76 44 L80 10Z" fill={trim} />
        </>)}
      </g>
      <path d={JERSEY_PATH} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="2" />
      <path d="M38 2 Q50 12 62 2" fill="none" stroke={pattern === "solid" ? trim : "rgba(0,0,0,.45)"} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function MiniLogo({ team, badge, size = 42 }) {
  const icon = resolveBadgeIcon(badge);
  if (!icon) {
    return (
      <div className="mini-logo" style={{ width: size, height: size, borderRadius: "50%", background: team.color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: size * 0.42, color: "#fff", flexShrink: 0, border: "2px solid rgba(255,255,255,.25)" }}>
        {team.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <svg width={size} height={size * 1.06} viewBox="0 0 100 106" style={{ flexShrink: 0, filter: "drop-shadow(0 2px 5px rgba(0,0,0,.35))" }}>
      <path d="M50 9 L39 2 Q30 -1 22 6 L3 23 L15 36 L23 28 L23 99 Q50 106 77 99 L77 28 L85 36 L97 23 L78 6 Q70 -1 61 2 Z" fill={team.color} stroke="rgba(245,240,225,.35)" strokeWidth="2" />
      <path d="M40 4 Q50 14 60 4" fill="none" stroke="rgba(12,18,14,.5)" strokeWidth="2.4" />
      <g transform={`translate(50 50) scale(${BADGE_ICON_SCALE[icon] || 1.2})`}>
        <BadgeIconPaths name={icon} />
      </g>
    </svg>
  );
}

function MatchCard({ m, minute, breakLeft, onOpen, onPoster, mineView }) {
  const showScore = m.status === "ResultPublished";
  return (
    <div className="card" style={{ display: "grid", gap: 12, cursor: "pointer", alignContent: "start" }} onClick={onOpen}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <StatusChip m={m} />
        {m.postponed && m.status === "Scheduled" && <span className="chip" style={{ background: "#141c16", color: "#E6B31E" }}>📅 Rescheduled</span>}
      </div>
      <div className="scoreboard">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <MiniLogo team={m.teamA} badge={m.badgeA} />
          <div className="sb-name">{m.teamA.name}</div>
        </div>
        <div className="sb-center">
          {showScore ? (
            <div className="display" style={{ fontSize: 26, color: "#E6B31E" }}>{m.finalA} – {m.finalB}</div>
          ) : m.status === "Live" && (m.halfPrompt || m.onBreak) ? (
            <>
              <div className="display" style={{ fontSize: 22, color: "#E6B31E" }}>HT</div>
              <div style={{ fontSize: 11, color: "#E6B31E", fontWeight: 700 }}>
                {m.onBreak ? `Break · ${Math.floor(breakLeft(m) / 60)}:${String(breakLeft(m) % 60).padStart(2, "0")}` : "Half-time break"}
              </div>
            </>
          ) : m.status === "Live" && !m.running ? (
            <>
              <div className="display" style={{ fontSize: 24, color: "#F5F0E1" }}>{m.liveA ?? 0} – {m.liveB ?? 0}</div>
              <div style={{ fontSize: 11, color: "#E6B31E", fontWeight: 700 }}>⏸ {m.pauseReason || "Paused"}</div>
            </>
          ) : m.status === "Live" ? (
            <>
              <div className="display" style={{ fontSize: 24, color: "#E8442E" }}>{m.liveA ?? 0} – {m.liveB ?? 0}</div>
              <div className="pulse" style={{ fontSize: 12, color: "#E8442E", fontWeight: 700 }}>LIVE {minute(m)}'</div>
              {m.streamUrl && <div className="chip pulse" style={{ background: "#E8442E", color: "#ffffff", fontSize: 9, marginTop: 2 }}>🔴 LIVE STREAM</div>}
            </>
          ) : m.status === "AwaitingScore" ? (
            <>
              <div className="display" style={{ fontSize: 20, color: "#E6B31E" }}>FT</div>
              <div style={{ fontSize: 11, color: "#7d8f83", fontWeight: 700 }}>Result awaiting</div>
            </>
          ) : (
            <div className="display" style={{ fontSize: 18, color: "#E6B31E" }}>{m.time}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
          <div className="sb-name" style={{ textAlign: "right" }}>{m.teamB.name}</div>
          <MiniLogo team={m.teamB} badge={m.badgeB} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#7d8f83", flexWrap: "wrap", gap: 8 }}>
        <span>📍 {m.location} · {m.date} · ⏱ {m.duration || 90}'</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onPoster(); }}>🎨 Artwork</button>
        </div>
      </div>
    </div>
  );
}

function MatchDetail({ m, me, linkedPlayers = [], onOpenPlayer, allMatches = [], onPosterLineup, matchAwards = [], minute, breakLeft, captainName, isDue, untilKickoff, alreadyRequested, onClose, onStart, onPauseResume, onLiveScore, onSetStream, onCancelMatch, onDeleteMatch, onLike, liked, likeCount, onRequestChange, onHalfTime, onPostpone, onPublish, onSubmitScore, onPoster, notify, onUpdateStats, onPostCommentary }) {
  const [fa, setFa] = useState("");
  const [fb, setFb] = useState("");
  const [postponing, setPostponing] = useState(false);
  const [la, setLa] = useState("");
  const [lb, setLb] = useState("");
  const [scorerA, setScorerA] = useState("");
  const [scorerB, setScorerB] = useState("");
  useEffect(() => { setScorerA(""); setScorerB(""); }, [la, lb]);
  /* Comma-separated roster → clean name list; empty roster falls back to Player 1, Player 2… */
  const rosterNames = (str) => {
    const list = (str || "").split(",").map((s) => s.trim()).filter(Boolean);
    return list.length ? list : Array.from({ length: 7 }, (_, i) => `Player ${i + 1}`);
  };
  const [reqOpen, setReqOpen] = useState(false);
  const [streamInput, setStreamInput] = useState("");
  const [ctrlTab, setCtrlTab] = useState("score"); // score | stats | commentary | stream — captain's live-match control tabs
  const [detailTab, setDetailTab] = useState("summary"); // summary | lineups | form — what fans and captains browse
  const [commentaryInput, setCommentaryInput] = useState("");
  const shareStream = async (m) => {
    const text = `🔴 Watch ${m.teamA.name} vs ${m.teamB.name} live: ${m.streamUrl}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Area Match — Live", text, url: m.streamUrl }); return; } catch (_) { /* user cancelled — no error needed */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      notify("🔗 Stream link copied — paste it anywhere to share!");
    } catch (_) {
      notify("Couldn't copy automatically — long-press the link above to copy it.");
    }
  };
  const [streamHelpOpen, setStreamHelpOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setStreamInput(m ? m.streamUrl || "" : ""); setWatchOpen(false); }, [m && m.id]);
  const [reqReason, setReqReason] = useState("");
  useEffect(() => { if (m) { setLa(String(m.liveA ?? 0)); setLb(String(m.liveB ?? 0)); } }, [m && m.id, m && m.liveA, m && m.liveB]);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [shootout, setShootout] = useState(false);
  const [scorersA, setScorersA] = useState("");
  const [recapEvents, setRecapEvents] = useState([]);
  const [sheetCard, setSheetCard] = useState(0);
  const sheetTouchX = useRef(0);
  useEffect(() => {
    if (m.status === "Scheduled" || m.status === "Cancelled") { setRecapEvents([]); return; }
    const load = () => supabase.from("match_events").select("*").eq("match_id", m.id).order("created_at", { ascending: true })
      .then(({ data }) => { if (data) setRecapEvents(data); });
    load();
    if (m.status !== "Live") return; // no need to poll once the match is over — history doesn't change
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [m.id, m.status]);
  const [scorersB, setScorersB] = useState("");
  const [scorerTallyA, setScorerTallyA] = useState({});
  const [scorerTallyB, setScorerTallyB] = useState({});
  /* Turns {"Tunde": 2, "Kola": 1} into "Tunde x2, Kola" — same format the rest of the app already expects */
  const tallyToStr = (tally) => Object.entries(tally).filter(([, n]) => n > 0).map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(", ");
  const bumpTally = (setTally, setStr) => (name, delta) => {
    setTally((prev) => {
      const next = { ...prev, [name]: Math.max(0, (prev[name] || 0) + delta) };
      setStr(tallyToStr(next));
      return next;
    });
  };
  const [unknowns, setUnknowns] = useState([]); // [{name, team, tag: null|'sub'|'pen'}]
  const [pa, setPa] = useState("");
  const [pb, setPb] = useState("");
  useEffect(() => { setFa(""); setFb(""); setShootout(false); setPa(""); setPb(""); setScorersA(""); setScorersB(""); setScorerTallyA({}); setScorerTallyB({}); }, [m && m.id]);
  if (!m) return null;
  const isOwner = m.createdBy === me.id;

  return (
    <div style={{ position: "fixed", inset: 0, background: T.night, zIndex: 50, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #243128", flexShrink: 0 }}>
        <button onClick={onClose} className="tappable" style={{ background: "none", border: "1px solid #243128", color: T.chalk, borderRadius: 10, height: 34, padding: "0 13px", display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}><span style={{ fontSize: 16, lineHeight: 1 }}>‹</span> Back</button>
        <div className="display" style={{ fontSize: 15, color: T.floodlight, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name} vs {m.teamB.name}</div>
        <StatusChip m={m} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 14, maxWidth: 560, width: "100%", margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "4px 0 6px" }}>
          {(() => {
            const live = m.status === "Live";
            const onBreakNow = live && (m.halfPrompt || m.onBreak);
            const paused = live && !m.running && !onBreakNow;
            let chipText, chipColor, chipBg, chipBorder;
            if (onBreakNow) {
              chipText = m.onBreak ? "HALF TIME · " + Math.floor(breakLeft(m) / 60) + ":" + String(breakLeft(m) % 60).padStart(2, "0") : "HALF TIME";
              chipColor = "#EBC65C"; chipBg = "rgba(214,168,29,.12)"; chipBorder = "rgba(214,168,29,.35)";
            } else if (paused) {
              chipText = "PAUSED"; chipColor = "#EBC65C"; chipBg = "rgba(214,168,29,.12)"; chipBorder = "rgba(214,168,29,.35)";
            } else if (live) {
              chipText = "LIVE · " + minute(m) + "\u2032"; chipColor = "#e8776a"; chipBg = "rgba(232,68,46,.12)"; chipBorder = "rgba(232,68,46,.35)";
            } else if (m.status === "ResultPublished") {
              chipText = "FULL TIME"; chipColor = "#7d8f83"; chipBg = "#141c16"; chipBorder = "#24302a";
            } else if (m.status === "AwaitingScore") {
              chipText = "AWAITING RESULT"; chipColor = "#EBC65C"; chipBg = "rgba(214,168,29,.10)"; chipBorder = "rgba(214,168,29,.3)";
            } else if (m.status === "Cancelled") {
              chipText = "CANCELLED"; chipColor = "#e08a7d"; chipBg = "rgba(198,80,63,.12)"; chipBorder = "rgba(198,80,63,.3)";
            } else {
              const untilText = typeof untilKickoff === "function" ? untilKickoff(m) : null;
              chipText = untilText ? String(untilText).toUpperCase() + " TO GO" : "SCHEDULED"; chipColor = "#7d8f83"; chipBg = "#141c16"; chipBorder = "#24302a";
            }
            const scoreText = m.status === "ResultPublished" ? (m.finalA + "\u2013" + m.finalB)
              : live ? ((m.liveA ?? 0) + "\u2013" + (m.liveB ?? 0))
              : m.status === "AwaitingScore" ? "FT" : m.status === "Cancelled" ? "\u2014" : "VS";
            return (
              <>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: chipBg, border: "1px solid " + chipBorder, borderRadius: 5, padding: "3px 10px", fontSize: 9.5, fontWeight: 700, color: chipColor, letterSpacing: "1.4px", marginBottom: 14 }}>
                  {live && !onBreakNow && !paused && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#E8442E", display: "inline-block" }} />}
                  {chipText}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                    <MiniLogo team={m.teamA} badge={m.badgeA} size={30} />
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name}</div>
                  </div>
                  <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 36, color: live ? "#D6A81D" : "#F7F4EA", flexShrink: 0 }}>{scoreText}</div>
                  <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                    <MiniLogo team={m.teamB} badge={m.badgeB} size={30} />
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamB.name}</div>
                  </div>
                </div>
                <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 12, letterSpacing: ".4px" }}>
                  {m.location}{m.date ? " \u00b7 " + m.date : ""}{m.time ? " at " + m.time : ""}
                </div>
                {captainName && (
                  <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 4, letterSpacing: ".4px" }}>
                    Hosted by <span style={{ color: "#B9C7BC", fontWeight: 600 }}>{captainName}</span>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* GOALS — who scored, readable at a glance. Published results only. */}
        {m.status === "ResultPublished" && (m.scorersA || m.scorersB) && (() => {
          const parse = (str, teamName, isOurs) => (str || "").split(",").map((c) => c.trim()).filter(Boolean).map((part) => {
            const mm = /^(.*?)\s*x\s*(\d+)$/i.exec(part);
            return { name: (mm ? mm[1] : part).trim(), n: mm ? parseInt(mm[2], 10) : 1, teamName, isOurs };
          });
          const goals = parse(m.scorersA, m.teamA.name, true).concat(parse(m.scorersB, m.teamB.name, false));
          if (goals.length === 0) return null;
          return (
            <div>
              <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 11 }}>Goals</div>
              {goals.map((g, i) => {
                const linked = linkedPlayers.find((pl) =>
                  pl.rosterName.trim().toLowerCase() === g.name.trim().toLowerCase() &&
                  (pl.teamName || "").trim().toLowerCase() === (g.teamName || "").trim().toLowerCase());
                return (
                  <div key={i} className={linked ? "tappable" : ""}
                    onClick={() => linked && onOpenPlayer && onOpenPlayer(linked.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #121a14", cursor: linked ? "pointer" : "default" }}>
                    <span style={{ fontSize: 13, flexShrink: 0 }}>⚽</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: linked ? 600 : 500, color: g.isOurs ? "#F7F4EA" : "#B9C7BC", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {g.name}{g.n > 1 ? ` ×${g.n}` : ""}
                      </div>
                      <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{g.teamName}</div>
                    </div>
                    {linked && <span style={{ fontSize: 9, color: "#4e5c53", flexShrink: 0 }}>›</span>}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* MAN OF THE MATCH — only the award a captain actually gave for this match */}
        {matchAwards.length > 0 && (
          <div>
            <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 11 }}>Awarded this match</div>
            {matchAwards.map((a) => {
              const info = AWARD_TYPES[a.awardType] || { label: a.awardType, art: "motm" };
              const player = linkedPlayers.find((pl) => pl.id === a.playerId);
              return (
                <div key={a.id} className={player ? "tappable" : ""}
                  onClick={() => player && onOpenPlayer && onOpenPlayer(player.id)}
                  style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderBottom: "1px solid #121a14", cursor: player ? "pointer" : "default" }}>
                  <TrophyIcon art={info.art} size={26} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F7F4EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {player ? player.name : "Player"}
                    </div>
                    <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{info.label}</div>
                  </div>
                  {player && <span style={{ fontSize: 9, color: "#4e5c53", flexShrink: 0 }}>›</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* TEAM SHEETS — swipeable: card 1 rosters, card 2 form & past games */}
        {(() => {
          const teamGames = (teamName) => allMatches
            .filter((x) => x.status === "ResultPublished" && x.createdBy === m.createdBy && (x.teamA.name === teamName || x.teamB.name === teamName))
            .sort((a, b) => (a.date < b.date ? 1 : -1));
          const gamesA = teamGames(m.teamA.name), gamesB = teamGames(m.teamB.name);
          const outcome = (game, teamName) => {
            const isA = game.teamA.name === teamName;
            const us = isA ? game.finalA : game.finalB, them = isA ? game.finalB : game.finalA;
            if (game.shootout && game.pensWinner) return game.pensWinner === (isA ? "A" : "B") ? "W" : "L";
            return us > them ? "W" : us < them ? "L" : "D";
          };
          return (
            <div className="card" style={{ fontSize: 13, padding: 14 }}>
              <div style={{ display: "flex", gap: 20, borderBottom: "1px solid #151c16", marginBottom: 14 }}>
                {[[0, "Line-ups"], [1, "Form"]].map((t) => (
                  <button key={t[0]} onClick={() => setSheetCard(t[0])}
                    style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 12, color: sheetCard === t[0] ? "#F7F4EA" : "#5a6a5f", fontWeight: sheetCard === t[0] ? 600 : 500, padding: "10px 0", cursor: "pointer", borderBottom: "1.5px solid " + (sheetCard === t[0] ? "#D6A81D" : "transparent"), marginBottom: -1 }}>
                    {t[1]}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex" }}
                onTouchStart={(e) => { sheetTouchX.current = e.touches[0].clientX; }}
                onTouchEnd={(e) => {
                  const dx = e.changedTouches[0].clientX - sheetTouchX.current;
                  if (dx < -40) setSheetCard(1);
                  if (dx > 40) setSheetCard(0);
                }}>
                {sheetCard === 0 ? (
                  [[m.teamA, m.badgeA, m.playersA], [m.teamB, m.badgeB, m.playersB]].map(([team, badge, players], i) => {
                    const names = (players || "").split(",").map((p) => p.trim()).filter(Boolean);
                    return (
                      <React.Fragment key={i}>
                        {i === 1 && <div style={{ width: 1, background: "#243128", margin: "0 12px" }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <MiniLogo team={team} badge={badge} size={24} />
                            <span style={{ fontWeight: 700, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.name}</span>
                          </div>
                          {names.length > 0
                            ? names.map((p, j) => {
                                const linked = linkedPlayers.find((pl) => pl.rosterName.trim().toLowerCase() === p.trim().toLowerCase() && (pl.teamName || "").trim().toLowerCase() === (team.name || "").trim().toLowerCase());
                                if (!linked) return <div key={j} style={{ fontSize: 12.5, padding: "6px 0", color: "#8FA396", borderBottom: "1px solid #121a14", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>;
                                return (
                                  <div key={j} className="tappable" onClick={() => onOpenPlayer && onOpenPlayer(linked.id)}
                                    style={{ fontSize: 12.5, padding: "6px 0", color: "#F7F4EA", fontWeight: 600, cursor: "pointer", borderBottom: "1px solid #121a14", display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                                    <span style={{ marginLeft: "auto", fontSize: 9, color: "#4e5c53", flexShrink: 0 }}>›</span>
                                  </div>
                                );
                              })
                            : <div style={{ color: "#8FA396", fontSize: 12 }}>Squad to be announced</div>}
                        </div>
                      </React.Fragment>
                    );
                  })
                ) : (
                  [[m.teamA, gamesA], [m.teamB, gamesB]].map(([team, games], i) => (
                    <React.Fragment key={i}>
                      {i === 1 && <div style={{ width: 1, background: "#243128", margin: "0 12px" }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.name}</div>
                        {games.length === 0 && <div style={{ fontSize: 11.5, color: "#8FA396" }}>No past results yet.</div>}
                        {games.length > 0 && (
                          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                            {games.slice(0, 5).map((g, k) => {
                              const o = outcome(g, team.name);
                              return <div key={k} style={{ width: 19, height: 19, borderRadius: 4, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                                background: o === "W" ? "rgba(63,163,91,.16)" : o === "L" ? "rgba(198,80,63,.14)" : "rgba(140,150,145,.14)",
                                color: o === "W" ? "#5fcf87" : o === "L" ? "#e08a7d" : "#93a099",
                                border: "1px solid " + (o === "W" ? "rgba(63,163,91,.3)" : o === "L" ? "rgba(198,80,63,.28)" : "rgba(140,150,145,.25)") }}>{o}</div>;
                            })}
                          </div>
                        )}
                        {games.slice(0, 3).map((g, k) => {
                          const isA = g.teamA.name === team.name;
                          const opp = isA ? g.teamB.name : g.teamA.name;
                          const us = isA ? g.finalA : g.finalB, them = isA ? g.finalB : g.finalA;
                          return (
                            <div key={k} style={{ fontSize: 11, padding: "4px 0", borderBottom: k < 2 ? "1px solid #243128" : "none", display: "flex", justifyContent: "space-between" }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>vs {opp}</span>
                              <span className="display" style={{ color: "#E6B31E", flexShrink: 0, marginLeft: 6 }}>{us}–{them}</span>
                            </div>
                          );
                        })}
                      </div>
                    </React.Fragment>
                  ))
                )}
              </div>
            </div>
          );
        })()}

        {/* STREAM INSTRUCTIONS MODAL */}
        {streamHelpOpen && <StreamHelpModal onClose={() => setStreamHelpOpen(false)} />}

        {/* WATCH LIVE — fans, tap to expand */}
        {m.streamUrl && m.status === "Live" && !isOwner && (
          youtubeEmbedId(m.streamUrl) ? (
            !watchOpen ? (
              <button className="btn btn-live pulse" onClick={() => setWatchOpen(true)}>▶ Watch Live Stream</button>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 12, overflow: "hidden", background: "#000" }}>
                  <iframe src={`https://www.youtube.com/embed/${youtubeEmbedId(m.streamUrl)}?autoplay=1`} title="Live stream"
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                    allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                </div>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setWatchOpen(false)}>✕ Close stream</button>
                <div style={{ fontSize: 11, color: "#8FA396", textAlign: "center" }}>Streaming uses mobile data</div>
              </div>
            )
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <a href={m.streamUrl} target="_blank" rel="noopener noreferrer" className="btn btn-live pulse" style={{ flex: 2, textAlign: "center", textDecoration: "none" }}>
                ▶ Watch Live on Facebook
              </a>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => shareStream(m)}>📤 Share</button>
            </div>
          )
        )}
        {m.streamUrl && m.status === "Live" && !isOwner && !watchOpen && (
          <div style={{ fontSize: 11, color: "#8FA396", marginTop: -8, textAlign: "center" }}>Streaming uses mobile data</div>
        )}

        {/* ADMIN — strip a bad stream link */}
        {me.role === "Admin" && m.streamUrl && (
          <button className="btn btn-ghost" style={{ color: "#E8442E", borderColor: "#3a1f1a", fontSize: 12 }}
            onClick={() => onSetStream(m, null)}>🛡 Remove stream link (admin)</button>
        )}


        {/* SCORE CORRECTION — captain, once per match, admin approval */}
        {isOwner && me.role === "Captain" && m.status === "ResultPublished" && (
          alreadyRequested ? (
            <div style={{ fontSize: 12, color: "#8FA396" }}>✔ You've already requested a score correction for this match — each match can only be corrected once.</div>
          ) : !reqOpen ? (
            <button className="btn btn-ghost" onClick={() => setReqOpen(true)}>✏️ Request score correction</button>
          ) : (
            <div className="card" style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#E6B31E" }}>Request a score correction (needs admin approval — one request per match)</div>
              <textarea className="input" rows={2} maxLength={200} placeholder="Reason (required)" value={reqReason}
                onChange={(e) => setReqReason(e.target.value)} style={{ resize: "none", fontFamily: "'Space Grotesk', sans-serif" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setReqOpen(false)}>Cancel</button>
                <button className="btn btn-gold" style={{ flex: 2, opacity: reqReason.trim() ? 1 : .5 }} disabled={!reqReason.trim()}
                  onClick={() => { onRequestChange(m, "rescore", reqReason.trim()); setReqOpen(false); setReqReason(""); }}>Send request</button>
              </div>
            </div>
          )
        )}

        {/* DELETE — captain's own match, or any match for the admin */}
        {((isOwner && me.role === "Captain") || me.role === "Admin") && m.status !== "Live" && (
          <button className="btn btn-ghost" style={{ color: "#E8442E", borderColor: "#3a1f1a" }}
            onClick={() => { if (window.confirm("Delete this match permanently? This can't be undone.")) onDeleteMatch(m); }}>🗑 Delete this match</button>
        )}

        {/* ARTWORK — visible to everyone, downloadable from the poster view */}
        <button className="btn btn-turf" onClick={onPoster}>🎨 View match artwork (download inside)</button>

        {/* CAPTAIN CONTROLS */}
        {isOwner && me.role === "Captain" && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <div className="display" style={{ fontSize: 14, color: "#E6B31E" }}>Captain Controls</div>
            {m.status === "Live" && (
              <div style={{ display: "flex", gap: 4, background: "#0f1511", borderRadius: 10, padding: 4 }}>
                {[["score", "Score"], ["stats", "Stats"], ["commentary", "Commentary"], ["stream", "Stream"]].map(([key, label]) => (
                  <button key={key} onClick={() => setCtrlTab(key)}
                    style={{ flex: 1, background: ctrlTab === key ? "#E6B31E" : "none", color: ctrlTab === key ? "#1a1405" : "#8FA396", border: "none", borderRadius: 7, padding: "8px 4px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          {/* LIVE STREAM — captain attaches a Facebook/YouTube live link */}
          {isOwner && me.role === "Captain" && (m.status === "Scheduled" || (m.status === "Live" && ctrlTab === "stream")) && (
            <div className="card" style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#E6B31E", letterSpacing: ".12em", textTransform: "uppercase" }}>🔴 Live Stream</div>
                <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setStreamHelpOpen(true)}>📖 How to go live — step by step</button>
              </div>
              <input className="input" maxLength={300} placeholder="Paste your Facebook live video link here"
                value={streamInput} onChange={(e) => setStreamInput(e.target.value.slice(0, 300))} />
              <div style={{ display: "flex", gap: 8 }}>
                {m.streamUrl && (
                  <button className="btn btn-ghost" style={{ flex: 1, color: "#E8442E", borderColor: "#3a1f1a", fontSize: 13 }}
                    onClick={() => { onSetStream(m, null); setStreamInput(""); }}>Remove</button>
                )}
                <button className="btn btn-gold" style={{ flex: 2, fontSize: 13, opacity: streamInput.trim() ? 1 : .5 }} disabled={!streamInput.trim()}
                  onClick={() => onSetStream(m, streamInput.trim())}>{m.streamUrl ? "Update stream link" : "Save stream link"}</button>
              </div>
            </div>
          )}
            {m.status === "Scheduled" && (isDue(m) ? (
              <>
                <button className="btn btn-live" onClick={() => onStart(m)}>▶ Start Match (90-min timer)</button>
                <div style={{ fontSize: 12, color: "#8FA396" }}>Kick-off time has been reached, but nothing starts without your consent — start when the teams are ready, or postpone below.</div>
              </>
            ) : (
              <div style={{ background: "#131a15", border: "1px solid #243128", borderRadius: 12, padding: 12, textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "#8FA396" }}>🔒 Kick-off unlocks at <b style={{ color: "#F5F0E1" }}>{m.time}</b> on {m.date}</div>
                <div className="display" style={{ fontSize: 20, color: "#E6B31E", marginTop: 4 }}>{untilKickoff(m)} to go</div>
              </div>
            ))}
            {m.status === "Scheduled" && (
              !postponing ? (
                <button className="btn btn-ghost" onClick={() => { setPostponing(true); setNewDate(m.date); setNewTime(m.time); }}>📅 Postpone this match</button>
              ) : (
                <div style={{ display: "grid", gap: 10, background: "#131a15", border: "1px solid #243128", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E6B31E" }}>📅 Postpone — pick the new kick-off</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4, fontWeight: 700 }}>📅 New date</div>
                      <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4, fontWeight: 700 }}>🕐 New time</div>
                      <input className="input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setPostponing(false)}>Cancel</button>
                    <button className="btn btn-gold" style={{ flex: 2 }} onClick={() => { onPostpone(m, newDate, newTime); setPostponing(false); }}>Confirm postponement</button>
                  </div>
                  <div style={{ fontSize: 11, color: "#8FA396" }}>Fans see the updated schedule on the News Feed immediately.</div>
                </div>
              )
            )}
            {m.status === "Live" && ctrlTab === "score" && m.halfPrompt && (
              <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderLeft: "2px solid #D6A81D", borderRadius: "0 11px 11px 0", padding: 14 }}>
                <div style={{ fontSize: 9, letterSpacing: "1.4px", textTransform: "uppercase", color: "#D6A81D", fontWeight: 700 }}>Half time</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 7, color: "#F7F4EA" }}>Ready for the second half?</div>
                <div style={{ fontSize: 10, color: "#7d8f83", marginTop: 4, lineHeight: 1.45 }}>Take a break or restart the clock when both teams are back on the pitch.</div>
                <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
                  <button className="tappable" onClick={() => onHalfTime(m, false)}
                    style={{ flex: 1, borderRadius: 8, padding: 10, fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", background: "#D6A81D", color: "#12160f", border: 0, cursor: "pointer" }}>Start second half</button>
                  <button className="tappable" onClick={() => onHalfTime(m, true)}
                    style={{ flex: 1, borderRadius: 8, padding: 10, fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", background: "none", border: "1px solid #1f2921", color: "#B9C7BC", cursor: "pointer" }}>10-min break</button>
                </div>
              </div>
            )}
            {m.status === "Live" && ctrlTab === "score" && m.onBreak && (
              <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderLeft: "2px solid #D6A81D", borderRadius: "0 11px 11px 0", padding: 14 }}>
                <div style={{ fontSize: 9, letterSpacing: "1.4px", textTransform: "uppercase", color: "#D6A81D", fontWeight: 700 }}>Break in progress</div>
                <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 26, color: "#D6A81D", margin: "10px 0 4px" }}>
                  {Math.floor(breakLeft(m) / 60)}:{String(breakLeft(m) % 60).padStart(2, "0")}
                </div>
                <div style={{ fontSize: 10, color: "#7d8f83", lineHeight: 1.45 }}>Second half starts when you're ready — the clock stays paused until then.</div>
                <button className="tappable" onClick={() => onHalfTime(m, false)}
                  style={{ width: "100%", marginTop: 12, borderRadius: 8, padding: 10, fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", background: "#D6A81D", color: "#12160f", border: 0, cursor: "pointer" }}>Start second half now</button>
              </div>
            )}
            {m.status === "Live" && ctrlTab === "score" && !m.halfPrompt && !m.onBreak && (
              m.running ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>⏸ Pause timer — tell the fans why:</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["🤕 Injury", "🎯 Penalty", "🗣 Argument", "🌧 Weather", "⚠️ Pitch issue", "Other"].map((r) => (
                      <button key={r} className="btn btn-ghost" style={{ padding: "8px 12px", fontSize: 12 }} onClick={() => onPauseResume(m, r)}>{r}</button>
                    ))}
                  </div>
                  {/* LIVE SCORE — single-digit inputs, clearable */}
                  <div style={{ background: "#131a15", border: "1px solid #243128", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#E6B31E", letterSpacing: ".12em", textTransform: "uppercase" }}>⚽ Live Score</div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#8FA396", marginBottom: 4 }}>{m.teamA.name.split(" ")[0]}</div>
                        <input className="input" inputMode="numeric" maxLength={1} style={{ width: 64, textAlign: "center", fontSize: 24, fontWeight: 700 }}
                          value={la} onChange={(e) => setLa(e.target.value.replace(/[^0-9]/g, "").slice(0, 1))} />
                      </div>
                      <div className="display" style={{ fontSize: 22, color: "#E6B31E", marginTop: 16 }}>–</div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#8FA396", marginBottom: 4 }}>{m.teamB.name.split(" ")[0]}</div>
                        <input className="input" inputMode="numeric" maxLength={1} style={{ width: 64, textAlign: "center", fontSize: 24, fontWeight: 700 }}
                          value={lb} onChange={(e) => setLb(e.target.value.replace(/[^0-9]/g, "").slice(0, 1))} />
                      </div>
                    </div>
                    {la !== "" && +la > (m.liveA ?? 0) && (
                      <div>
                        <div style={{ fontSize: 11, color: "#8FA396", marginBottom: 6 }}>⚽ Who scored for {m.teamA.name}?</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {rosterNames(m.playersA).map((p) => (
                            <button key={p} type="button" onClick={() => setScorerA(p)}
                              style={{ background: scorerA === p ? "rgba(230,179,30,.15)" : "#131a15", border: `1px solid ${scorerA === p ? "#E6B31E" : "#243128"}`, color: scorerA === p ? "#E6B31E" : "#F5F0E1", borderRadius: 99, padding: "7px 13px", fontSize: 12.5 }}>{p}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {lb !== "" && +lb > (m.liveB ?? 0) && (
                      <div>
                        <div style={{ fontSize: 11, color: "#8FA396", marginBottom: 6 }}>⚽ Who scored for {m.teamB.name}?</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {rosterNames(m.playersB).map((p) => (
                            <button key={p} type="button" onClick={() => setScorerB(p)}
                              style={{ background: scorerB === p ? "rgba(230,179,30,.15)" : "#131a15", border: `1px solid ${scorerB === p ? "#E6B31E" : "#243128"}`, color: scorerB === p ? "#E6B31E" : "#F5F0E1", borderRadius: 99, padding: "7px 13px", fontSize: 12.5 }}>{p}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button className="btn btn-gold"
                      disabled={la === "" || lb === "" || (+la > (m.liveA ?? 0) && !scorerA) || (+lb > (m.liveB ?? 0) && !scorerB)}
                      onClick={() => { onLiveScore(m, +la, +lb, scorerA, scorerB); setScorerA(""); setScorerB(""); }}>Update</button>
                  </div>
                  <button className="btn btn-ghost" style={{ color: "#E8442E", borderColor: "#3a1f1a" }}
                    onClick={() => { if (window.confirm("Cancel this match? Fans will be told and it's removed after 7 days.")) onCancelMatch(m); }}>❌ Cancel match</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "#E6B31E", fontWeight: 700 }}>⏸ Match paused{m.pauseReason ? ` — ${m.pauseReason}` : ""}</div>
                  <button className="btn btn-live" onClick={() => onPauseResume(m)}>▶ Resume match</button>
                </>
              )
            )}

            {/* STATS TAB — simple +/- steppers, no typing */}
            {m.status === "Live" && ctrlTab === "stats" && (
              <div style={{ display: "grid", gap: 4 }}>
                {[
                  ["shotsA", "shotsB", "Shots", "🔵"],
                  ["shotsOnTargetA", "shotsOnTargetB", "On Target", "🎯"],
                  ["cornersA", "cornersB", "Corners", "⛳"],
                  ["foulsA", "foulsB", "Fouls", "🟨"],
                  ["offsidesA", "offsidesB", "Offsides", "🚩"],
                ].map(([keyA, keyB, label, icon]) => (
                  <div key={keyA} style={{ padding: "8px 0", borderBottom: "1px solid #1a201c" }}>
                    <div style={{ fontSize: 12.5, marginBottom: 6 }}>{icon} {label}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "#8FA396", width: 76, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name}</span>
                      <button className="btn btn-ghost" style={{ width: 26, height: 26, padding: 0, fontSize: 14 }} onClick={() => onUpdateStats(m, keyA, Math.max(0, (m[keyA] ?? 0) - 1))}>−</button>
                      <span className="display" style={{ fontSize: 14, width: 20, textAlign: "center" }}>{m[keyA] ?? 0}</span>
                      <button className="btn btn-ghost" style={{ width: 26, height: 26, padding: 0, fontSize: 14 }} onClick={() => onUpdateStats(m, keyA, (m[keyA] ?? 0) + 1)}>+</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "#8FA396", width: 76, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamB.name}</span>
                      <button className="btn btn-ghost" style={{ width: 26, height: 26, padding: 0, fontSize: 14 }} onClick={() => onUpdateStats(m, keyB, Math.max(0, (m[keyB] ?? 0) - 1))}>−</button>
                      <span className="display" style={{ fontSize: 14, width: 20, textAlign: "center" }}>{m[keyB] ?? 0}</span>
                      <button className="btn btn-ghost" style={{ width: 26, height: 26, padding: 0, fontSize: 14 }} onClick={() => onUpdateStats(m, keyB, (m[keyB] ?? 0) + 1)}>+</button>
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid #243128", marginTop: 6, paddingTop: 10 }}>
                  <div style={{ fontSize: 12.5, marginBottom: 6 }}>⏱ Possession — {m.teamA.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button className="btn btn-ghost" style={{ width: 26, height: 26, padding: 0, fontSize: 14 }} onClick={() => onUpdateStats(m, "possessionA", Math.max(0, (m.possessionA ?? 50) - 5))}>−</button>
                    <span className="display" style={{ fontSize: 14, width: 34, textAlign: "center" }}>{m.possessionA ?? 50}%</span>
                    <button className="btn btn-ghost" style={{ width: 26, height: 26, padding: 0, fontSize: 14 }} onClick={() => onUpdateStats(m, "possessionA", Math.min(100, (m.possessionA ?? 50) + 5))}>+</button>
                    <span style={{ fontSize: 11, color: "#8FA396", marginLeft: "auto" }}>{m.teamB.name}: {100 - (m.possessionA ?? 50)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* COMMENTARY TAB — real captain commentary, posted straight to the fan-facing live feed */}
            {m.status === "Live" && ctrlTab === "commentary" && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#E6B31E", letterSpacing: ".12em", textTransform: "uppercase" }}>Add live commentary</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} maxLength={140} placeholder="e.g. Tunde nearly finds the top corner!"
                    value={commentaryInput} onChange={(e) => setCommentaryInput(e.target.value)} />
                  <button className="btn btn-gold" disabled={!commentaryInput.trim()} style={{ opacity: commentaryInput.trim() ? 1 : .5 }}
                    onClick={() => { if (commentaryInput.trim()) { onPostCommentary(m, commentaryInput.trim()); setCommentaryInput(""); } }}>Post</button>
                </div>
                <div style={{ fontSize: 10.5, color: "#8FA396", lineHeight: 1.4 }}>Fans see this instantly in the live timeline. Don't have time to type? We'll keep the commentary flowing automatically.</div>
              </div>
            )}


            {/* SCORE SUBMISSION REQUEST — appears at full time */}
            {m.status === "AwaitingScore" && (() => {
              const goalLog = recapEvents
                .map((e) => {
                  const mm0 = /^(\d+)'\s+(.*)$/.exec(e.message || "");
                  const min = mm0 ? mm0[1] : null, text = mm0 ? mm0[2] : (e.message || "");
                  const gm = /GOAL — .+?! (.+?) scores\. (\d+)-(\d+)/.exec(text);
                  return gm ? { min, name: gm[1], a: gm[2], b: gm[3] } : null;
                })
                .filter(Boolean);
              return (
                <>
                  {goalLog.length > 0 && (
                    <div className="card" style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 11, color: "#8FA396", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>What happened during the match</div>
                      {goalLog.map((g, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < goalLog.length - 1 ? "1px solid #243128" : "none", fontSize: 12.5 }}>
                          <span>⚽ {g.name}</span><span style={{ color: "#8FA396" }}>{g.min}'</span>
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid #E6B31E", fontSize: 12.5 }}>
                        <span>Score logged during play</span>
                        <span className="display" style={{ color: "#E6B31E" }}>{goalLog[goalLog.length - 1].a}–{goalLog[goalLog.length - 1].b}</span>
                      </div>
                    </div>
                  )}
              <div style={{ display: "grid", gap: 10, background: "#1c1509", border: "1.5px solid #E6B31E", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, color: "#E6B31E" }}>🏁 Full time. Submit the final score to publish this result to the News Feed.</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4 }}>{m.teamA.name}</div>
                    <input className="input" style={{ width: 80, textAlign: "center", fontSize: 22, fontWeight: 700 }} inputMode="numeric" maxLength={2} placeholder="0" value={fa} onChange={(e) => setFa(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
                  </div>
                  <div className="display" style={{ fontSize: 22, color: "#E6B31E", marginTop: 18 }}>–</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4 }}>{m.teamB.name}</div>
                    <input className="input" style={{ width: 80, textAlign: "center", fontSize: 22, fontWeight: 700 }} inputMode="numeric" maxLength={2} placeholder="0" value={fb} onChange={(e) => setFb(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#8FA396", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>{m.teamA.name} — who scored?</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {rosterNames(m.playersA).map((name) => {
                      const n = scorerTallyA[name] || 0;
                      return (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, background: n > 0 ? "rgba(230,179,30,.12)" : "#131a15", border: `1px solid ${n > 0 ? "#E6B31E" : "#243128"}`, borderRadius: 99, padding: "7px 7px 7px 12px", fontSize: 13 }}>
                          <span>{name}</span>
                          {n > 0 && (
                            <>
                              <button type="button" style={{ width: 20, height: 20, borderRadius: "50%", border: 0, background: "rgba(198,80,63,.2)", color: "#e08a7d", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                                onClick={() => bumpTally(setScorerTallyA, setScorersA)(name, -1)}>−</button>
                              <span className="display" style={{ fontSize: 13, color: "#E6B31E", minWidth: 14, textAlign: "center" }}>{n}</span>
                            </>
                          )}
                          <button type="button" style={{ width: 20, height: 20, borderRadius: "50%", border: 0, background: "rgba(230,179,30,.2)", color: "#E6B31E", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            onClick={() => bumpTally(setScorerTallyA, setScorersA)(name, 1)}>+</button>
                          {n >= 3 && <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(230,179,30,.18)", color: "#E6B31E", padding: "3px 8px", borderRadius: 6 }}>🎩 Hat-trick!</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#8FA396", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>{m.teamB.name} — who scored?</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {rosterNames(m.playersB).map((name) => {
                      const n = scorerTallyB[name] || 0;
                      return (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, background: n > 0 ? "rgba(230,179,30,.12)" : "#131a15", border: `1px solid ${n > 0 ? "#E6B31E" : "#243128"}`, borderRadius: 99, padding: "7px 7px 7px 12px", fontSize: 13 }}>
                          <span>{name}</span>
                          {n > 0 && (
                            <>
                              <button type="button" style={{ width: 20, height: 20, borderRadius: "50%", border: 0, background: "rgba(198,80,63,.2)", color: "#e08a7d", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                                onClick={() => bumpTally(setScorerTallyB, setScorersB)(name, -1)}>−</button>
                              <span className="display" style={{ fontSize: 13, color: "#E6B31E", minWidth: 14, textAlign: "center" }}>{n}</span>
                            </>
                          )}
                          <button type="button" style={{ width: 20, height: 20, borderRadius: "50%", border: 0, background: "rgba(230,179,30,.2)", color: "#E6B31E", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            onClick={() => bumpTally(setScorerTallyB, setScorersB)(name, 1)}>+</button>
                          {n >= 3 && <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(230,179,30,.18)", color: "#E6B31E", padding: "3px 8px", borderRadius: 6 }}>🎩 Hat-trick!</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                  <input type="checkbox" checked={shootout} onChange={(e) => setShootout(e.target.checked)} />
                  ⚽ Match went to a penalty shootout
                </label>
                {shootout && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4 }}>{m.teamA.name} pens</div>
                      <input className="input" style={{ width: 80, textAlign: "center", fontSize: 18, fontWeight: 700 }} inputMode="numeric" placeholder="0" maxLength={2} value={pa} onChange={(e) => setPa(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
                    </div>
                    <div className="display" style={{ fontSize: 18, color: "#E6B31E", marginTop: 18 }}>–</div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4 }}>{m.teamB.name} pens</div>
                      <input className="input" style={{ width: 80, textAlign: "center", fontSize: 18, fontWeight: 700 }} inputMode="numeric" placeholder="0" maxLength={2} value={pb} onChange={(e) => setPb(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
                    </div>
                  </div>
                )}
                <button className="btn btn-gold" disabled={fa === "" || fb === ""} onClick={() => {
                  if (fa === "" || fb === "") return;
                  /* Check scorer names against the starting squads */
                  const squad = (list) => (list || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
                  const parseNames = (str) => (str || "").split(",").map((x) => x.trim().replace(/\s*x\d+$/i, "").replace(/\s*\((sub|pen)\)$/i, "")).filter(Boolean);
                  const inSquad = (name, list) => squad(list).some((p) => p.includes(name.toLowerCase()) || name.toLowerCase().includes(p));
                  const found = [];
                  parseNames(scorersA).forEach((n) => { if (!inSquad(n, m.playersA)) found.push({ name: n, team: "A", tag: null }); });
                  parseNames(scorersB).forEach((n) => { if (!inSquad(n, m.playersB)) found.push({ name: n, team: "B", tag: null }); });
                  const unresolved = found.filter((f) => !unknowns.find((u) => u.name === f.name && u.team === f.team && u.tag));
                  if (unresolved.length > 0) {
                    setUnknowns(found.map((f) => unknowns.find((u) => u.name === f.name && u.team === f.team) || f));
                    return;
                  }
                  /* Append (sub)/(pen) tags to the resolved names */
                  const tagUp = (str) => (str || "").split(",").map((x) => {
                    const clean = x.trim();
                    const base = clean.replace(/\s*x\d+$/i, "").replace(/\s*\((sub|pen)\)$/i, "");
                    const u = unknowns.find((k) => k.name.toLowerCase() === base.toLowerCase() && k.tag);
                    return u ? `${clean} (${u.tag})` : clean;
                  }).filter(Boolean).join(", ");
                  onSubmitScore(m, +fa, +fb, shootout, +pa || 0, +pb || 0, tagUp(scorersA), tagUp(scorersB));
                  setUnknowns([]);
                }}>Upload match result</button>
                {unknowns.filter((u) => !u.tag).length > 0 && (
                  <div style={{ display: "grid", gap: 10, background: "#1c1509", border: "1.5px solid #E6B31E", borderRadius: 12, padding: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#E6B31E" }}>Some scorers aren't in the starting squads — who are they?</div>
                    {unknowns.map((u, i) => (
                      <div key={u.team + u.name} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{u.name} <span style={{ color: "#8FA396", fontWeight: 400 }}>({u.team === "A" ? m.teamA.name : m.teamB.name})</span></span>
                        <button className={`btn ${u.tag === "sub" ? "btn-gold" : "btn-ghost"}`} style={{ padding: "6px 12px", fontSize: 12 }}
                          onClick={() => setUnknowns(unknowns.map((x, j) => (j === i ? { ...x, tag: "sub" } : x)))}>🔁 Substitute</button>
                        <button className={`btn ${u.tag === "pen" ? "btn-gold" : "btn-ghost"}`} style={{ padding: "6px 12px", fontSize: 12 }}
                          onClick={() => setUnknowns(unknowns.map((x, j) => (j === i ? { ...x, tag: "pen" } : x)))}>🎯 Penalty taker</button>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: "#8FA396" }}>Choose for each name, then tap Upload match result again.</div>
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#8FA396" }}>Your uploaded score is the official result. It publishes to the News Feed on the 90-minute score{shootout ? " (the shootout decides the match winner, shown on the result)" : ""}.</div>
              </div>
                </>
              );
            })()}

            {m.status !== "ResultPublished" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 13, color: "#8FA396" }}>📣 All matches are public — this match is live on the News Feed for everyone to see.</div>
              </div>
            )}
            <div style={{ borderTop: "1px solid #243128", paddingTop: 12, display: "grid", gap: 8 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, letterSpacing: ".06em" }} onClick={() => setMoreOpen(!moreOpen)}>
                {moreOpen ? "▴ Hide options" : "⋯ More options"}
              </button>
              {moreOpen && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#8FA396", letterSpacing: ".12em", textTransform: "uppercase" }}>Share & Promote</div>
                  <button className="btn btn-ghost" onClick={onPoster}>🎨 Generate match poster</button>
                  <button className="btn btn-ghost" onClick={onPosterLineup}>🧑‍🤝‍🧑 Generate lineup card</button>
            <button className="btn btn-turf" onClick={() => {
              const lines = m.status === "ResultPublished"
                ? [`🏁 *FULL TIME* — ${m.teamA.name} ${m.finalA} - ${m.finalB} ${m.teamB.name}`,
                   m.shootout && m.pensWinner ? `(${m.pensWinner === "A" ? m.teamA.name : m.teamB.name} win ${m.pensA}-${m.pensB} on penalties)` : "",
                   m.scorersA ? `⚽ ${m.teamA.name}: ${m.scorersA}` : "",
                   m.scorersB ? `⚽ ${m.teamB.name}: ${m.scorersB}` : "",
                   ``, `📍 ${m.location}`, `Hosted on Area Match ⚽`]
                : [`⚽ *MATCH DAY!* ${m.teamA.name} vs ${m.teamB.name}`,
                   `📅 ${m.date} at ${m.time} (${m.duration || 90} mins)`, `📍 ${m.location}`, ``,
                   `*${m.teamA.name} squad:*`, m.playersA || "TBA", ``,
                   `*${m.teamB.name} squad:*`, m.playersB || "TBA", ``, `Come support! Hosted on Area Match ⚽`];
              window.open(`https://wa.me/?text=${encodeURIComponent(lines.filter(Boolean).join("\n"))}`, "_blank");
            }}>💬 Share squad on WhatsApp</button>
                </>
              )}
            </div>
          </div>
        )}

        {m.status === "AwaitingScore" && !isOwner && (
          <div className="card" style={{ fontSize: 13, color: "#8FA396" }}>Full time — result awaiting. The score will appear here as soon as the captain uploads the match result.</div>
        )}
        {m.status === "ResultPublished" && (
          <div className="card" style={{ fontSize: 13, color: "#E6B31E" }}>
            📰 Official result: {m.teamA.name} {m.finalA} – {m.finalB} {m.teamB.name}
            {m.shootout && m.pensWinner ? ` — ${m.pensWinner === "A" ? m.teamA.name : m.teamB.name} win ${m.pensA}–${m.pensB} on penalties.` : m.result === "Draw" ? " — Draw." : ` — ${m.result === "A" ? m.teamA.name : m.teamB.name} win.`}
          </div>
        )}
      </div>
    </div>
  );
}
/* ---------- LIVE MATCH VIEW — read-only pitch-style broadcast page for the 🔴 Live tab ---------- */
/* Playful, clearly-fictional color commentary — never a record of what actually happened.
   Real events (goals, cards, KO/HT) only ever come from the captain's timeline. */
const COMMENTARY_TEMPLATES = [
  "{p1} picks it up in midfield and looks for an opening.",
  "{p1} plays a lovely ball through to {p2}.",
  "Corner ball — {p1} whips it in, but it's cleared.",
  "{p1} tries a shot from distance… just over the bar!",
  "Good tackle from {p1} to break up the attack.",
  "{p1} shows real pace down the wing — ball goes out for a corner.",
  "The referee blows for a foul — {p1} felt that one in midfield.",
  "{p2} covers well to deny {p1} a clean sight of goal.",
  "Neat one-two between {p1} and {p2}.",
  "{p1} wins a free-kick in a promising position.",
  "Chance! {p1}'s effort deflects just wide of the post.",
  "{p1} holds the ball up well under pressure from {p2}.",
  "Long ball forward — {p1} chases it down.",
  "{p1} tries to thread it through, but {p2} reads it well.",
  "The fans are on their feet as {p1} surges forward.",
];
const genCommentary = (m, rosterNames) => {
  const t = COMMENTARY_TEMPLATES[Math.floor(Math.random() * COMMENTARY_TEMPLATES.length)];
  const teamNames = Math.random() < 0.5 ? rosterNames(m.playersA) : rosterNames(m.playersB);
  const p1 = teamNames[Math.floor(Math.random() * teamNames.length)];
  let p2 = teamNames[Math.floor(Math.random() * teamNames.length)];
  if (p2 === p1 && teamNames.length > 1) p2 = teamNames[(teamNames.indexOf(p1) + 1) % teamNames.length];
  return t.replace(/\{p1\}/g, p1).replace(/\{p2\}/g, p2);
};

function LiveMatchView({ m, me, notify, minute, timeline, alertsOn, onToggleAlerts, onShare, onShareStats, onShareLineup, allMatches = [], onClose }) {
  const [commentary, setCommentary] = useState([]);
  const [watching, setWatching] = useState(1);
  const rosterNames = (str) => {
    const list = (str || "").split(",").map((s) => s.trim()).filter(Boolean);
    return list.length ? list : Array.from({ length: 7 }, (_, i) => `Player ${i + 1}`);
  };

  /* Real "Watching" count — presence channel scoped to this exact match.
     Counts only people who genuinely have this match's Live view open right now. */
  const [watchers, setWatchers] = useState([]);
  const [liveTab, setLiveTab] = useState("stats");
  /* Head-to-head — past published meetings between these exact two teams */
  const h2hGames = (allMatches || [])
    .filter((g) => g.id !== m.id && g.status === "ResultPublished" &&
      ((g.teamA.name === m.teamA.name && g.teamB.name === m.teamB.name) ||
       (g.teamA.name === m.teamB.name && g.teamB.name === m.teamA.name)))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const h2hRecord = h2hGames.reduce((acc, g) => {
    const aIsHome = g.teamA.name === m.teamA.name;
    const aScore = aIsHome ? g.finalA : g.finalB;
    const bScore = aIsHome ? g.finalB : g.finalA;
    if (aScore > bScore) acc.aWins++;
    else if (bScore > aScore) acc.bWins++;
    else acc.draws++;
    return acc;
  }, { aWins: 0, bWins: 0, draws: 0 });
  const liveCardTouchX = useRef(0);
  const [showWatchers, setShowWatchers] = useState(false);
  const [showScorers, setShowScorers] = useState(false);
  /* Pulls scorer names AND which team they scored for, straight out of the existing
     "GOAL — Team! Name scores." event text — no new data needed */
  const scorerEvents = timeline
    .map((e) => { const mm = /GOAL — (.+?)! (.+?) scores\./.exec(e.message || ""); return mm ? { team: mm[1], name: mm[2] } : null; })
    .filter(Boolean)
    .reverse();
  const scorerNamesA = scorerEvents.filter((s) => s.team === m.teamA.name).map((s) => s.name);
  const scorerNamesB = scorerEvents.filter((s) => s.team === m.teamB.name).map((s) => s.name);
  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel(`watch-${m.id}`, { config: { presence: { key: me.id } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
      const names = Object.values(state).map((arr) => (arr[0] && arr[0].name) || "Someone");
      setWatchers(names);
      setWatching(Math.max(1, names.length));
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED") await ch.track({ at: Date.now(), name: me.name });
    });
    return () => { supabase.removeChannel(ch); };
  }, [m.id, me && me.id]);

  useEffect(() => {
    setCommentary([]);
    if (m.status !== "Live" || m.onBreak || !m.running) return;
    const fire = () => setCommentary((c) => [{ id: "c" + Date.now(), text: genCommentary(m, rosterNames), min: minute(m), ts: Date.now() }, ...c].slice(0, 12));
    const t = setInterval(fire, 22000 + Math.random() * 14000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, m.status, m.onBreak, m.running, m.playersA, m.playersB]);

  /* Real events are stored as "NN' message" — split that leading tag off to show as its own badge */
  const splitMinute = (msg) => {
    const mm = /^(\d+)'\s+(.*)$/.exec(msg || "");
    return mm ? { min: mm[1], text: mm[2] } : { min: null, text: msg };
  };
  /* Colors the "GOAL — Team!" / "Kick off:" / "Half time:" style lead-in gold, rest stays plain */
  const splitLeadIn = (text) => {
    const bang = text.indexOf("!");
    const colon = text.indexOf(":");
    let cut = -1;
    if (bang !== -1 && (colon === -1 || bang < colon)) cut = bang + 1;
    else if (colon !== -1) cut = colon + 1;
    if (cut === -1) return { lead: null, rest: text };
    return { lead: text.slice(0, cut), rest: text.slice(cut) };
  };

  /* Interleave real events (fact) with generated commentary (flavor), newest first, same visual treatment */
  const feed = [
    ...timeline.map((e) => {
      const s = splitMinute(e.message);
      const isRealCommentary = s.text.startsWith("🎙 ");
      return { id: e.id, text: isRealCommentary ? s.text.slice(2) : s.text, min: s.min, ts: new Date(e.created_at).getTime(), kind: isRealCommentary ? "commentary" : "event" };
    }),
    ...commentary.map((c) => ({ id: c.id, text: c.text, min: c.min, ts: c.ts, kind: "commentary" })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div style={{ position: "fixed", inset: 0, background: T.night, zIndex: 80, display: "flex", flexDirection: "column" }}>
      <div style={{ maxWidth: 460, width: "100%", margin: "0 auto", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #243128" }}>
          <button onClick={onClose} className="tappable" style={{ background: "none", border: "1px solid #243128", color: T.chalk, borderRadius: 10, height: 34, padding: "0 13px", display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}><span style={{ fontSize: 16, lineHeight: 1 }}>‹</span> Back</button>
          <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name} vs {m.teamB.name}</div>
            <div style={{ fontSize: 10, color: "#8FA396", letterSpacing: ".1em" }}>{(m.location || "").toUpperCase()}</div>
          </div>
          <span style={{ width: 34 }} />
        </div>

        <div className="scoreboard" style={{ borderRadius: 0, border: 0, borderBottom: "1px solid #243128", flexDirection: "column", gap: 10, padding: "18px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 11, letterSpacing: ".15em", color: "rgba(245,240,225,.75)" }}>
            <span className="chip pulse" style={{ background: T.live, color: "#fff" }}>🔴 LIVE</span>
            <span>📍 {m.location}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, width: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
              <MiniLogo team={m.teamA} badge={m.badgeA} size={48} />
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: "center" }}>{m.teamA.name}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div className="display" style={{ fontSize: 46, color: T.chalk, whiteSpace: "nowrap" }}>{m.liveA ?? 0} <span style={{ color: T.floodlight }}>–</span> {m.liveB ?? 0}</div>
              <span className="chip" style={{ background: "rgba(0,0,0,.3)", color: T.floodlight }}>{minute(m)}'</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
              <MiniLogo team={m.teamB} badge={m.badgeB} size={48} />
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: "center" }}>{m.teamB.name}</span>
            </div>
          </div>
        </div>

        {m.streamUrl && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #243128", background: "rgba(232,68,46,.08)" }}>
            <a href={m.streamUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", flex: 1, minWidth: 0 }}>
              <span className="chip pulse" style={{ background: T.live, color: "#fff", flexShrink: 0 }}>🔴 LIVE</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.chalk }}>
                  {/facebook\.com|fb\.watch/.test(m.streamUrl) ? "Watching live on Facebook" : "Watching live"}
                </div>
                <div style={{ fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>The captain is streaming this match — tap to watch →</div>
              </div>
            </a>
            <button style={{ background: "none", border: "1px solid #3a1f1a", color: T.chalk, borderRadius: 10, padding: "8px 10px", fontSize: 12, flexShrink: 0 }}
              onClick={async () => {
                const text = `🔴 Watch ${m.teamA.name} vs ${m.teamB.name} live: ${m.streamUrl}`;
                if (navigator.share) { try { await navigator.share({ title: "Area Match — Live", text, url: m.streamUrl }); return; } catch (_) {} }
                try { await navigator.clipboard.writeText(text); notify("🔗 Stream link copied — paste it anywhere to share!"); }
                catch (_) { notify("Couldn't copy automatically — long-press the link above to copy it."); }
              }}>📤</button>
          </div>
        )}

        <div style={{ display: "flex", borderBottom: showWatchers || showScorers ? "none" : "1px solid #243128" }}>
          <div style={{ flex: 1, textAlign: "center", padding: "12px 4px", borderRight: "1px solid #243128", cursor: "pointer" }} onClick={() => { setShowWatchers(!showWatchers); setShowScorers(false); }}>
            <div className="display" style={{ fontSize: 18, color: T.floodlight }}>👀 {watching}</div>
            <div style={{ fontSize: 10, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase" }}>Watching</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "12px 4px", cursor: "pointer" }} onClick={() => { setShowScorers(!showScorers); setShowWatchers(false); }}>
            <div className="display" style={{ fontSize: 18, color: T.floodlight }}>{(m.liveA ?? 0) + (m.liveB ?? 0)}</div>
            <div style={{ fontSize: 10, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase" }}>Goals</div>
          </div>
        </div>
        {showWatchers && (
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #243128" }}>
            <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>Currently Watching ({watchers.length})</div>
            {watchers.map((n, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 13 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: T.turf, color: T.floodlight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{n.slice(0, 1).toUpperCase()}</div>
                {n}
              </div>
            ))}
          </div>
        )}
        {showScorers && (
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #243128" }}>
            <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>Scorers</div>
            {scorerEvents.length === 0 && <div style={{ fontSize: 13, color: T.muted }}>No goals yet.</div>}
            {scorerEvents.length > 0 && (
              <div style={{ display: "flex" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name}</div>
                  {scorerNamesA.length === 0 && <div style={{ fontSize: 11.5, color: T.muted }}>—</div>}
                  {scorerNamesA.map((n, i) => <div key={i} style={{ fontSize: 12.5, padding: "4px 0" }}>⚽ {n}</div>)}
                </div>
                <div style={{ width: 1, background: "#243128", margin: "0 12px" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamB.name}</div>
                  {scorerNamesB.length === 0 && <div style={{ fontSize: 11.5, color: T.muted }}>—</div>}
                  {scorerNamesB.map((n, i) => <div key={i} style={{ fontSize: 12.5, padding: "4px 0" }}>⚽ {n}</div>)}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ padding: 14, borderBottom: "1px solid #243128" }}>
          <div style={{ display: "flex", borderBottom: "1px solid #243128", marginBottom: 14 }}>
            {[["stats", "Info"], ["commentary", "Commentary"], ["lineups", "Line-ups"], ["h2h", "H2H"]].map(([key, label]) => (
              <button key={key} onClick={() => setLiveTab(key)}
                style={{ flex: 1, background: "none", border: 0, borderBottom: `2px solid ${liveTab === key ? T.chalk : "transparent"}`, color: liveTab === key ? T.chalk : T.muted, fontWeight: liveTab === key ? 700 : 500, fontSize: 12.5, padding: "10px 2px", fontFamily: "inherit", cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
          <div onTouchStart={(e) => { liveCardTouchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const order = ["stats", "commentary", "lineups", "h2h"];
              const i = order.indexOf(liveTab);
              const dx = e.changedTouches[0].clientX - liveCardTouchX.current;
              if (dx < -40 && i < order.length - 1) setLiveTab(order[i + 1]);
              if (dx > 40 && i > 0) setLiveTab(order[i - 1]);
            }}>
            {liveTab === "stats" ? (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span>{m.possessionA ?? 50}%</span><span style={{ color: T.muted }}>Possession</span><span>{100 - (m.possessionA ?? 50)}%</span>
                  </div>
                  <div style={{ height: 5, background: "#243128", borderRadius: 99, overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${m.possessionA ?? 50}%`, background: T.floodlight }} />
                    <div style={{ width: `${100 - (m.possessionA ?? 50)}%`, background: "#243128" }} />
                  </div>
                </div>
                {[
                  [m.shotsA, "Shots", m.shotsB],
                  [m.shotsOnTargetA, "On Target", m.shotsOnTargetB],
                  [m.cornersA, "Corners", m.cornersB],
                  [m.foulsA, "Fouls", m.foulsB],
                  [m.offsidesA, "Offsides", m.offsidesB],
                ].map(([a, label, b]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", padding: "7px 0" }}>
                    <span className="display" style={{ fontSize: 15, color: T.floodlight, width: 40, textAlign: "left" }}>{a ?? 0}</span>
                    <span style={{ flex: 1, fontSize: 11, color: T.muted, textAlign: "center", textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
                    <span className="display" style={{ fontSize: 15, color: T.floodlight, width: 40, textAlign: "right" }}>{b ?? 0}</span>
                  </div>
                ))}
                <button style={{ width: "100%", marginTop: 10, background: "none", border: "1px solid #243128", color: T.floodlight, borderRadius: 10, padding: "9px", fontSize: 12, fontWeight: 700 }}
                  onClick={onShareStats}>🎨 Share stats card</button>
                <button style={{ width: "100%", marginTop: 8, background: "none", border: "1px solid #243128", color: T.floodlight, borderRadius: 10, padding: "9px", fontSize: 12, fontWeight: 700 }}
                  onClick={onShareLineup}>🧑‍🤝‍🧑 Generate lineup card</button>
              </>
            ) : liveTab === "lineups" ? (
              <div style={{ display: "flex" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name}</div>
                  {rosterNames(m.playersA).map((p) => <div key={p} style={{ fontSize: 12, padding: "5px 0", color: T.chalk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>)}
                </div>
                <div style={{ width: 1, background: "#243128", margin: "0 12px" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamB.name}</div>
                  {rosterNames(m.playersB).map((p) => <div key={p} style={{ fontSize: 12, padding: "5px 0", color: T.chalk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>)}
                </div>
              </div>
            ) : liveTab === "commentary" ? (
              <div style={{ display: "grid", gap: 8, maxHeight: 340, overflowY: "auto" }}>
                {feed.length === 0 && <div style={{ fontSize: 13, color: T.muted }}>Commentary will appear here as the match unfolds.</div>}
                {feed.map((e) => {
                  const { lead, rest } = e.kind === "event" ? splitLeadIn(e.text) : { lead: null, rest: e.text };
                  return (
                    <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#161E19", border: "1px solid #243128", borderRadius: 12, padding: "10px 12px" }}>
                      {e.min !== null && e.min !== undefined && (
                        <span className="display" style={{ fontSize: 13, color: T.floodlight, background: "rgba(230,179,30,.1)", borderRadius: 8, padding: "3px 7px", flexShrink: 0, minWidth: 32, textAlign: "center" }}>{e.min}'</span>
                      )}
                      <span style={{ fontSize: 13, color: T.chalk, paddingTop: 1 }}>
                        {e.kind === "commentary" ? (<>🎙 {rest}</>) : lead ? (<><b style={{ color: T.floodlight }}>{lead}</b>{rest}</>) : rest}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 10, textAlign: "center" }}>Head to Head</div>
                {h2hGames.length === 0 ? (
                  <div style={{ fontSize: 13, color: T.muted, textAlign: "center", padding: "10px 0" }}>These two teams haven't met before on Area Match.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 1, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
                      {[[h2hRecord.aWins, m.teamA.name, "#3FA35B"], [h2hRecord.draws, "Draws", "#54615a"], [h2hRecord.bWins, m.teamB.name, "#C6503F"]].map(([n, label, color]) => (
                        <div key={label} style={{ flex: 1, background: "rgba(0,0,0,.25)", padding: "11px 4px", textAlign: "center" }}>
                          <div className="display" style={{ fontSize: 19, color }}>{n}</div>
                          <div style={{ fontSize: 8.5, color: T.muted, letterSpacing: 1, textTransform: "uppercase", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    {h2hGames.slice(0, 5).map((g) => (
                      <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #243128", fontSize: 12.5 }}>
                        <span style={{ color: T.muted, fontSize: 11 }}>{g.date}</span>
                        <span className="display" style={{ color: T.floodlight }}>{g.finalA}–{g.finalB}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {m.status === "Live" && !m.running && !m.halfPrompt && !m.onBreak && (
          <div style={{ margin: "0 16px 10px", background: "rgba(230,179,30,.1)", border: "1px solid rgba(230,179,30,.3)", borderRadius: 10, padding: "10px 12px", fontSize: 11.5, color: T.floodlight, textAlign: "center" }}>
            ⏸ Match paused — commentary will resume when play restarts
          </div>
        )}

        <div style={{ display: "flex", gap: 8, padding: "12px 16px 16px", borderTop: "1px solid #243128" }}>
          <button className={`btn ${alertsOn ? "btn-gold" : "btn-ghost"}`} style={{ flex: 1 }} onClick={onToggleAlerts}>
            {alertsOn ? "✓ Alerts on" : "🔔 Get goal alerts"}
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onShare}>↗ Share</button>
        </div>
      </div>
    </div>
  );
}
/* ---------- COMING SOON — feature gate with feedback ---------- */
/* ---------- FEEDBACK — open box for feature requests, complaints, anything ---------- */
function FeedbackPage({ myFeedback, onSend }) {
  const [msg, setMsg] = useState("");
  return (
    <div style={{ maxWidth: 560 }}>
      <div className="display" style={{ fontSize: 24, marginBottom: 4 }}>💬 Feedback</div>
      <div style={{ color: "#8FA396", fontSize: 13, marginBottom: 18 }}>Something not working right? An idea for the next update? Tell us here — we read everything.</div>
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <textarea className="input" rows={5} maxLength={500} placeholder="e.g. It would be great if..."
          value={msg} onChange={(e) => setMsg(e.target.value.slice(0, 500))} />
        <div style={{ fontSize: 11, color: "#8FA396", textAlign: "right" }}>{msg.length}/500</div>
        <button className="btn btn-gold" disabled={!msg.trim()} style={{ opacity: msg.trim() ? 1 : .5 }}
          onClick={() => { if (msg.trim()) { onSend(msg.trim()); setMsg(""); } }}>Send feedback</button>
      </div>
      {myFeedback.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: ".15em", color: "#8FA396", textTransform: "uppercase", marginBottom: 10 }}>What you've sent before</div>
          <div style={{ display: "grid", gap: 8 }}>
            {myFeedback.map((f) => (
              <div key={f.id} className="card" style={{ fontSize: 13, color: "#F5F0E1" }}>{f.msg}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComingSoonCard({ feature, detail, onFeedback, onClose }) {
  const [msg, setMsg] = useState("");
  return (
    <div style={{ display: "grid", gap: 12, textAlign: "center" }}>
      <div style={{ fontSize: 40 }}>🔜</div>
      <div className="display" style={{ fontSize: 20, color: "#E6B31E" }}>{feature} is coming soon</div>
      <div style={{ fontSize: 13, color: "#8FA396", lineHeight: 1.6 }}>{detail}</div>
      <div style={{ fontSize: 13, color: "#F5F0E1", fontWeight: 700 }}>Want it out very soon? Tell us 👇</div>
      <textarea className="input" rows={3} maxLength={300} placeholder="e.g. Yes! I want to bet on my community matches..."
        value={msg} onChange={(e) => setMsg(sanitizeText(e.target.value, 300))} style={{ resize: "none", fontFamily: "'Space Grotesk', sans-serif" }} />
      <button className="btn btn-gold" disabled={!msg.trim()} style={{ opacity: msg.trim() ? 1 : .5 }}
        onClick={() => { if (msg.trim()) { onFeedback(msg.trim()); setMsg(""); } }}>
        Send feedback
      </button>
      {onClose && <button className="btn btn-ghost" onClick={onClose}>Maybe later</button>}
    </div>
  );
}

/* ---------- PROFILE PAGE — edit name, manage security PIN ---------- */
function ProfilePage({ me, stats, onSave, notify, follows = [], users = [], onOpenCaptain, supportedTeams = [], myUpcoming = [], onOpenTeam, onOpenMatch }) {
  const [selfTab, setSelfTab] = useState("overview");
  const [name, setName] = useState(me.name);
  const [contactInfo, setContactInfo] = useState(me.contactInfo || "");
  const [curPin, setCurPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const digits = (v) => v.replace(/\D/g, "").slice(0, 4);

  const saveName = () => {
    const clean = sanitizeText(name, 30).trim();
    if (clean.length < 2) return notify("Name must be at least 2 characters");
    onSave({ name: clean });
    notify("Name updated ✔");
  };

  const savePin = () => {
    if (me.pin && curPin !== me.pin) return notify("Current PIN is incorrect");
    if (!/^\d{4}$/.test(newPin)) return notify("PIN must be exactly 4 digits");
    if (newPin !== confirmPin) return notify("New PIN entries don't match");
    onSave({ pin: newPin });
    setCurPin(""); setNewPin(""); setConfirmPin("");
    notify("Security PIN " + (me.pin ? "changed" : "set") + " ✔ Keep it private — it verifies you with support.");
  };

  return (
    <div style={{ maxWidth: 430 }}>
      {/* Hero — same language as the player/captain/team profiles */}
      <div style={{ position: "relative", overflow: "hidden", marginBottom: 2 }}>
        <div style={{ position: "absolute", top: -70, left: -10, width: 230, height: 200, background: "radial-gradient(ellipse, rgba(214,168,29,.10), transparent 68%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#141c16", border: "1px solid #2a3d31", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 21, color: me.role === "Fan" ? "#7ab0cf" : "#D6A81D", flexShrink: 0 }}>
            {me.name.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 23, lineHeight: 1.05, color: "#F7F4EA" }}>{me.name}</div>
            <div style={{ fontSize: 11.5, color: "#7d8f83", marginTop: 6 }}>
              {me.role}{me.state ? " · " + me.state : ""}{me.joined ? " · Since " + me.joined : ""}
            </div>
            {me.role === "Fan" && supportedTeams.length > 0 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, background: "rgba(74,125,156,.10)", border: "1px solid rgba(74,125,156,.3)", borderRadius: 6, padding: "3px 9px", fontSize: 10, fontWeight: 600, color: "#7ab0cf", letterSpacing: ".4px" }}>
                ◆ TRUE SUPPORTER
              </div>
            )}
          </div>
        </div>

        <div style={{ position: "relative", display: "flex", marginTop: 18, borderTop: "1px solid #151c16", borderBottom: "1px solid #151c16" }}>
          {[stats.a, stats.b, stats.c].map((s, i) => (
            <div key={s[0]} style={{ flex: 1, padding: "13px 4px", textAlign: "center", borderRight: i < 2 ? "1px solid #151c16" : "none" }}>
              <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 20, color: i === 0 ? "#D6A81D" : "#F7F4EA" }}>{s[1]}</div>
              <div style={{ fontSize: 8.5, color: "#5a6a5f", letterSpacing: "1.1px", textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>{s[0]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #151c16", gap: 22, marginTop: 13, marginBottom: 17 }}>
        {[["overview", "Overview"]].concat(me.role === "Fan" ? [["following", "Following"]] : []).concat([["settings", "Settings"]]).map((t) => (
          <button key={t[0]} onClick={() => setSelfTab(t[0])}
            style={{ background: "none", border: 0, fontFamily: "inherit", fontSize: 12.5, color: selfTab === t[0] ? "#F7F4EA" : "#5a6a5f", fontWeight: selfTab === t[0] ? 600 : 500, padding: "12px 0", cursor: "pointer", borderBottom: "1.5px solid " + (selfTab === t[0] ? "#D6A81D" : "transparent"), marginBottom: -1 }}>
            {t[1]}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {selfTab === "overview" && (
        <>
          {supportedTeams.length > 0 ? (
            <>
              <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 12 }}>My teams</div>
              {supportedTeams.map((t) => (
                <div key={t.id} className="tappable" onClick={() => onOpenTeam && onOpenTeam(t.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                  <MiniLogo team={t} badge={t.badge} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{t.formLine || "Supporting"}</div>
                  </div>
                  <span style={{ fontSize: 10, color: "#4e5c53" }}>›</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 16, textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, color: "#B9C7BC", fontWeight: 600 }}>
                {me.role === "Captain" ? "No teams created yet" : "No teams backed yet"}
              </div>
              <div style={{ fontSize: 10.5, color: "#5a6a5f", marginTop: 5, lineHeight: 1.5 }}>
                {me.role === "Captain"
                  ? "Create a team from My Teams to reuse the same squad across matches."
                  : "Tap Support on any team profile to follow their season here."}
              </div>
            </div>
          )}

          {myUpcoming.length > 0 && (
            <>
              <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, margin: "22px 0 12px" }}>Your teams play next</div>
              {myUpcoming.slice(0, 4).map((m) => {
                const d = new Date(m.date + "T" + m.time);
                return (
                  <div key={m.id} className="tappable" onClick={() => onOpenMatch && onOpenMatch(m.id)}
                    style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                    <div style={{ width: 40, textAlign: "center", flexShrink: 0 }}>
                      <div style={{ fontFamily: "'Anton', sans-serif", fontSize: 13, color: "#D6A81D" }}>{d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</div>
                      <div style={{ fontSize: 8, color: "#4e5c53", marginTop: 2 }}>{d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name} vs {m.teamB.name}</div>
                      <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{m.location} · {m.time}</div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {/* FOLLOWING */}
      {selfTab === "following" && (
        <>
          <div style={{ fontSize: 9.5, letterSpacing: "1.5px", textTransform: "uppercase", color: "#4e5c53", fontWeight: 700, marginBottom: 12 }}>
            Captains I follow{follows.length > 0 ? " · " + follows.length : ""}
          </div>
          {follows.length === 0 && (
            <div style={{ background: "#0E140F", border: "1px solid #1b241c", borderRadius: 11, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 12.5, color: "#B9C7BC", fontWeight: 600 }}>Not following anyone yet</div>
              <div style={{ fontSize: 10.5, color: "#5a6a5f", marginTop: 5, lineHeight: 1.5 }}>Follow a captain to see their matches first in your feed.</div>
            </div>
          )}
          {follows.map((id) => {
            const cap = users.find((u) => u.id === id);
            if (!cap) return null;
            return (
              <div key={id} className="tappable" onClick={() => onOpenCaptain && onOpenCaptain(id)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid #121a14", cursor: "pointer" }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#141c16", border: "1px solid #2a3d31", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 12, color: "#D6A81D", flexShrink: 0 }}>
                  {cap.name.slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cap.name}</div>
                  {cap.state && <div style={{ fontSize: 9.5, color: "#4e5c53", marginTop: 2 }}>{cap.state}</div>}
                </div>
                <span style={{ fontSize: 10, color: "#4e5c53" }}>›</span>
              </div>
            );
          })}
        </>
      )}

      {/* SETTINGS */}
      <div style={{ display: selfTab === "settings" ? "block" : "none" }}>


      {/* Captain team-join contact */}
      {me.role === "Captain" && (
        <div className="card" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 14, color: "#E6B31E" }}>📞 Team Contact (shown to fans)</div>
          <div style={{ fontSize: 12, color: "#8FA396" }}>Drop your phone/WhatsApp number so fans who want to join your team can reach you. Shown on your captain profile.</div>
          <input className="input" maxLength={60} placeholder="e.g. WhatsApp 0803 123 4567" value={contactInfo} onChange={(e) => setContactInfo(sanitizeText(e.target.value, 60))} />
          <button className="btn btn-gold" onClick={() => { onSave({ contactInfo }); notify("Team contact updated ✔ Fans can now see it on your profile."); }}>Save contact</button>
        </div>
      )}

      {/* Player contact — opt-in publish, off by default */}
      {me.role === "Player" && (
        <div className="card" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 14, color: "#E6B31E" }}>📞 Contact (Optional)</div>
          <input className="input" maxLength={60} placeholder="e.g. WhatsApp 0803 123 4567" value={contactInfo} onChange={(e) => setContactInfo(sanitizeText(e.target.value, 60))} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#8FA396", cursor: "pointer" }}>
            <input type="checkbox" checked={!!me.contactPublic} onChange={(e) => onSave({ contactPublic: e.target.checked })} />
            Publish my contact publicly on my profile
          </label>
          <div style={{ fontSize: 10.5, color: "#8FA396", lineHeight: 1.4 }}>Off by default — only visible to others if you turn this on.</div>
          <button className="btn btn-gold" onClick={() => { onSave({ contactInfo }); notify("Contact updated ✔"); }}>Save contact</button>
        </div>
      )}

      {/* Edit name */}
      <div className="card" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        <div className="display" style={{ fontSize: 14, color: "#E6B31E" }}>Display Name</div>
        <input className="input" maxLength={30} value={name} onChange={(e) => setName(sanitizeText(e.target.value, 30))} />
        <button className="btn btn-gold" onClick={saveName}>Save name</button>
      </div>

      {/* Account details */}
      <div className="card" style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <div className="display" style={{ fontSize: 14, color: "#E6B31E" }}>Account</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#8FA396" }}>Email (login)</span><span>{me.contact}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#8FA396" }}>Account type</span><span>{me.role}</span>
        </div>
        <div style={{ fontSize: 11, color: "#8FA396" }}>Your email is your secure login identity — changing it requires re-verification and arrives with the full launch. Roles are fixed at signup to keep betting fair.</div>
      </div>

      {/* Security PIN */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="display" style={{ fontSize: 14, color: "#E6B31E" }}>🔒 Security PIN</div>
        <div style={{ fontSize: 12, color: "#8FA396", lineHeight: 1.5 }}>
          This 4-digit PIN is your identity check. If you ever lose access to your email and contact support to recover your account, quoting this PIN proves the account is really yours.
          {me.pin ? " A PIN is currently active on your account." : " No PIN set yet — we recommend setting one."}
        </div>
        {me.pin && <input className="input" type="password" inputMode="numeric" placeholder="Current PIN" maxLength={4} value={curPin} onChange={(e) => setCurPin(digits(e.target.value))} />}
        <input className="input" type="password" inputMode="numeric" placeholder="New 4-digit PIN" maxLength={4} value={newPin} onChange={(e) => setNewPin(digits(e.target.value))} />
        <input className="input" type="password" inputMode="numeric" placeholder="Confirm new PIN" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(digits(e.target.value))} />
        <button className="btn btn-gold" onClick={savePin}>{me.pin ? "Change PIN" : "Set PIN"}</button>
      </div>
      </div>
    </div>
  );
}

function CreateMatch({ onSave, onCancel, myTeams = [] }) {
  const [f, setF] = useState({
    teamAName: "", teamAColor: "#E6B31E", teamBName: "", teamBColor: "#1DB954",
    badgeA: "⚽", badgeB: "🦁",
    playersA: "", playersB: "", location: "", date: "", time: "", duration: 90,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isPastDateTime = f.date && f.time && new Date(`${f.date}T${f.time}`).getTime() < Date.now();
  const countA = f.playersA.split(",").map((s) => s.trim()).filter(Boolean).length;
  const countB = f.playersB.split(",").map((s) => s.trim()).filter(Boolean).length;
  const playersMismatch = countA > 0 && countB > 0 && countA !== countB;
  const valid = f.teamAName && f.teamBName && f.location && f.date && f.time && !isPastDateTime && !playersMismatch;
  const [wantsStream, setWantsStream] = useState(null); // null | "no" | "yes"
  const [streamInput, setStreamInput] = useState("");
  const [streamHelpOpen, setStreamHelpOpen] = useState(false);
  const streamValid = isValidStreamUrl(streamInput.trim());
  const [pickedTeamA, setPickedTeamA] = useState(null); // saved team id, or null if typing fresh
  const [pickedTeamB, setPickedTeamB] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(null); // "A" | "B" | null — which side's picker sheet is open
  const applyTeam = (side, team) => {
    if (side === "A") { setPickedTeamA(team.id); setF((prev) => ({ ...prev, teamAName: team.name, teamAColor: team.color, badgeA: team.badge, playersA: team.players })); }
    else { setPickedTeamB(team.id); setF((prev) => ({ ...prev, teamBName: team.name, teamBColor: team.color, badgeB: team.badge, playersB: team.players })); }
    setPickerOpen(null);
  };
  const clearTeam = (side) => {
    if (side === "A") { setPickedTeamA(null); setF((prev) => ({ ...prev, teamAName: "", teamAColor: "#E6B31E", badgeA: "ball", playersA: "" })); }
    else { setPickedTeamB(null); setF((prev) => ({ ...prev, teamBName: "", teamBColor: "#1DB954", badgeB: "lion", playersB: "" })); }
  };

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div className="display" style={{ fontSize: 18, color: "#E6B31E" }}>Create Match</div>

      {myTeams.length > 0 && (
        <div style={{ display: "grid", gap: 10, background: "#131a15", border: "1px solid #243128", borderRadius: 12, padding: 12 }}>
          {[["A", pickedTeamA], ["B", pickedTeamB]].map(([side, picked]) => {
            const team = picked ? myTeams.find((t) => t.id === picked) : null;
            return (
              <div key={side}>
                <div style={{ fontSize: 10, color: "#8FA396", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Team {side}</div>
                <div style={{ background: "#0f1511", border: "1px solid #243128", borderRadius: 10, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  onClick={() => setPickerOpen(pickerOpen === side ? null : side)}>
                  {team ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <MiniLogo team={team} badge={team.badge} size={28} />
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{team.name}</span>
                    </div>
                  ) : <span style={{ color: "#8FA396", fontSize: 13 }}>Select a saved team…</span>}
                  <span style={{ color: "#8FA396" }}>▾</span>
                </div>
                {picked && <div style={{ fontSize: 11, color: "#E6B31E", textAlign: "center", marginTop: 4, textDecoration: "underline", cursor: "pointer" }} onClick={() => clearTeam(side)}>or type a new team instead</div>}
                {pickerOpen === side && (
                  <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                    {myTeams.map((t) => {
                      const otherSidePicked = side === "A" ? pickedTeamB : pickedTeamA;
                      const isTakenByOtherSide = otherSidePicked === t.id;
                      return (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, border: "1px solid #243128", borderRadius: 10, cursor: isTakenByOtherSide ? "default" : "pointer", opacity: isTakenByOtherSide ? 0.35 : 1 }}
                          onClick={() => !isTakenByOtherSide && applyTeam(side, t)}>
                          <MiniLogo team={t} badge={t.badge} size={26} />
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</span>
                          {isTakenByOtherSide && <span style={{ fontSize: 11, color: "#8FA396", marginLeft: "auto" }}>already Team {side === "A" ? "B" : "A"}</span>}
                        </div>
                      );
                    })}
                    {!picked && <div style={{ fontSize: 11, color: "#8FA396", textAlign: "center", cursor: "pointer" }} onClick={() => setPickerOpen(null)}>or type a new team instead ↓</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="Team A name" maxLength={24} value={f.teamAName} onChange={(e) => setF({ ...f, teamAName: sanitizeText(e.target.value, 24) })} />
        <input type="color" value={f.teamAColor} onChange={set("teamAColor")} style={{ width: 52, height: 48, border: 0, borderRadius: 10, background: "none", cursor: "pointer" }} title="Team A colour" />
      </div>
      <input className="input" placeholder="Team A players (comma separated)" maxLength={150} value={f.playersA} onChange={(e) => setF({ ...f, playersA: sanitizeText(e.target.value, 150) })} />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#8FA396", marginRight: 4 }}>Badge:</span>
        {BADGES.map((b) => <button key={"a" + b} className={`btn ${f.badgeA === b ? "btn-gold" : "btn-ghost"}`} style={{ padding: "5px 7px", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setF({ ...f, badgeA: b })}><MiniLogo team={{ name: "", color: f.badgeA === b ? "#1a1405" : "#3a4a3e" }} badge={b} size={24} /></button>)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="Team B name" maxLength={24} value={f.teamBName} onChange={(e) => setF({ ...f, teamBName: sanitizeText(e.target.value, 24) })} />
        <input type="color" value={f.teamBColor} onChange={set("teamBColor")} style={{ width: 52, height: 48, border: 0, borderRadius: 10, background: "none", cursor: "pointer" }} title="Team B colour" />
      </div>
      <input className="input" placeholder="Team B players (comma separated)" maxLength={150} value={f.playersB} onChange={(e) => setF({ ...f, playersB: sanitizeText(e.target.value, 150) })} />
      {playersMismatch && (
        <div style={{ fontSize: 11, color: "#e08a7d", marginTop: -6, lineHeight: 1.4 }}>⚠️ Squads must have equal numbers — Team A has {countA}, Team B has {countB}. Doesn't need to be 11, just equal.</div>
      )}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#8FA396", marginRight: 4 }}>Badge:</span>
        {BADGES.map((b) => <button key={"b" + b} className={`btn ${f.badgeB === b ? "btn-gold" : "btn-ghost"}`} style={{ padding: "5px 7px", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setF({ ...f, badgeB: b })}><MiniLogo team={{ name: "", color: f.badgeB === b ? "#1a1405" : "#3a4a3e" }} badge={b} size={24} /></button>)}
      </div>
      <input className="input" placeholder="Location (e.g. Campos Mini Stadium)" maxLength={60} value={f.location} onChange={(e) => setF({ ...f, location: sanitizeText(e.target.value, 60) })} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4, fontWeight: 700 }}>📅 Match date</div>
          <input className="input" type="date" value={f.date} onChange={set("date")} />
          {isPastDateTime && (
            <div style={{ fontSize: 11, color: "#e08a7d", marginTop: 6, lineHeight: 1.4 }}>⚠️ This date and time have already passed — pick a time in the future to save.</div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4, fontWeight: 700 }}>🕐 Kick-off time</div>
          <input className="input" type="time" value={f.time} onChange={set("time")} />
          {isPastDateTime && (
            <div style={{ fontSize: 11, color: "#e08a7d", marginTop: 6, lineHeight: 1.4 }}>⚠️ Already passed for today's date.</div>
          )}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 6, fontWeight: 700 }}>⏱ Match duration</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[90, 60, 40].map((d) => (
            <button key={d} className={`btn ${f.duration === d ? "btn-gold" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setF({ ...f, duration: d })}>
              {d} mins
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#8FA396", marginTop: 4 }}>Half time comes at {f.duration / 2} minutes.</div>
      </div>

      {/* LIVE STREAM — optional at creation; captains can always add/change this later too */}
      <div className="card" style={{ display: "grid", gap: 10, background: "#131a15" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#E6B31E", letterSpacing: ".12em", textTransform: "uppercase" }}>🔴 Live Stream</div>
        <div style={{ fontSize: 13 }}>Want to stream this match live?</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn ${wantsStream === "no" ? "btn-gold" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setWantsStream("no")}>No thanks</button>
          <button className={`btn ${wantsStream === "yes" ? "btn-gold" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setWantsStream("yes")}>Yes, add a link</button>
        </div>
        {wantsStream === "yes" && (
          <>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setStreamHelpOpen(true)}>📖 How to go live — step by step</button>
            <input className="input" maxLength={300} placeholder="Paste your Facebook live video link here"
              value={streamInput} onChange={(e) => setStreamInput(e.target.value.slice(0, 300))} />
            {streamInput.trim() && !streamValid && <div style={{ fontSize: 11, color: "#E8442E" }}>That doesn't look like a Facebook or YouTube link yet — paste it once you're live, or leave blank and add it later.</div>}
            <div style={{ fontSize: 11, color: "#8FA396" }}>Not live yet? No problem — leave this blank and add your link anytime once the match is under way.</div>
          </>
        )}
        {wantsStream === "no" && <div style={{ fontSize: 11, color: "#8FA396" }}>No stream for now — you can still add one anytime while the match is live.</div>}
      </div>
      {streamHelpOpen && <StreamHelpModal onClose={() => setStreamHelpOpen(false)} />}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
        <button className="btn btn-gold" style={{ flex: 2, opacity: valid ? 1 : .5 }} disabled={!valid}
          onClick={() => valid && onSave({ teamA: { name: f.teamAName, color: f.teamAColor }, teamB: { name: f.teamBName, color: f.teamBColor }, badgeA: f.badgeA, badgeB: f.badgeB, playersA: f.playersA, playersB: f.playersB, location: f.location, date: f.date, time: f.time, duration: f.duration, streamUrl: wantsStream === "yes" && streamValid ? normalizeStreamUrl(streamInput.trim()) : "" })}>
          Save as Scheduled
        </button>
      </div>
    </div>
  );
}

function PosterModal({ m, onClose, notify }) {
  const svgRef = useRef(null);
  if (!m) return null;
  const initials = (t) => t.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  /* Draws the same jersey badge used across the app, sized for the 400x500 poster SVG */
  const PosterBadge = ({ cx, cy, team, badge }) => {
    const icon = resolveBadgeIcon(badge);
    if (!icon) {
      return (
        <>
          <circle cx={cx} cy={cy} r="46" fill={team.color} stroke="#F5F0E1" strokeOpacity="0.3" strokeWidth="3" />
          <text x={cx} y={cy + 12} textAnchor="middle" fill="#fff" fontFamily="Anton, sans-serif" fontSize="32">{initials(team)}</text>
        </>
      );
    }
    return (
      <g transform={`translate(${cx} ${cy})`}>
        <path d="M0 -50 L-14 -60 Q-27 -63 -37 -55 L-64 -35 L-48 -18 L-36 -28 L-36 55 Q0 63 36 55 L36 -28 L48 -18 L64 -35 L37 -55 Q27 -63 14 -60 Z"
          transform="scale(0.62)" fill={team.color} stroke="#F5F0E1" strokeOpacity="0.3" strokeWidth="3" />
        <g transform={`scale(${(BADGE_ICON_SCALE[icon] || 1.2) * 0.62})`}>
          <BadgeIconPaths name={icon} />
        </g>
      </g>
    );
  };

  const toPng = (cb) => {
    const svg = svgRef.current;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800; canvas.height = 1000;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 800, 1000);
      canvas.toBlob((png) => { URL.revokeObjectURL(url); cb(png); });
    };
    img.src = url;
  };

  const bumpShares = () => { supabase.rpc("increment_shares", { p_match_id: m.id }).then(() => {}); };
  const download = () => toPng((png) => {
    bumpShares();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = `${m.teamA.name}-vs-${m.teamB.name}-match-era.png`;
    a.click();
    notify("Poster downloaded — share it on WhatsApp, IG or TikTok 📲");
  });

  const isResult = m.status === "ResultPublished";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", borderRadius: 20, padding: 16, maxWidth: 400, width: "100%", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <svg ref={svgRef} viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", borderRadius: 12 }}>
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0D3A1F" />
              <stop offset="100%" stopColor="#0C120E" />
            </linearGradient>
          </defs>
          <rect width="400" height="500" fill="url(#bg)" />
          <circle cx="200" cy="250" r="90" fill="none" stroke="#F5F0E1" strokeOpacity="0.08" strokeWidth="2" />
          <line x1="0" y1="250" x2="400" y2="250" stroke="#F5F0E1" strokeOpacity="0.08" strokeWidth="2" />
          <rect x="130" y="0" width="140" height="55" fill="none" stroke="#F5F0E1" strokeOpacity="0.08" strokeWidth="2" />
          <rect x="130" y="445" width="140" height="55" fill="none" stroke="#F5F0E1" strokeOpacity="0.08" strokeWidth="2" />
          <text x="200" y="60" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="30" letterSpacing="2">AREA MATCH</text>
          <text x="200" y="82" textAnchor="middle" fill="#F5F0E1" opacity="0.6" fontFamily="Space Grotesk, sans-serif" fontSize="12" letterSpacing="4">{isResult ? "FULL TIME RESULT" : "COMMUNITY FOOTBALL"}</text>
          <PosterBadge cx={110} cy={185} team={m.teamA} badge={m.badgeA} />
          <PosterBadge cx={290} cy={185} team={m.teamB} badge={m.badgeB} />
          {!isResult && <text x="200" y="197" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="26">VS</text>}
          <text x="110" y="257" textAnchor="middle" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize={m.teamA.name.length > 16 ? 10 : m.teamA.name.length > 12 ? 12.5 : 15}>{m.teamA.name}</text>
          <text x="290" y="257" textAnchor="middle" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize={m.teamB.name.length > 16 ? 10 : m.teamB.name.length > 12 ? 12.5 : 15}>{m.teamB.name}</text>

          {isResult ? (
            <>
              {/* Final score — the centrepiece of a result poster */}
              <text x="200" y="352" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="72" letterSpacing="4">{m.finalA} – {m.finalB}</text>
              <text x="200" y="386" textAnchor="middle" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="16">
                {m.shootout && m.pensWinner ? `${(m.pensWinner === "A" ? m.teamA.name : m.teamB.name).toUpperCase()} WIN ${m.pensA}–${m.pensB} ON PENALTIES` : m.result === "Draw" ? "MATCH DRAWN" : `${(m.result === "A" ? m.teamA.name : m.teamB.name).toUpperCase()} WIN`}
              </text>
              <rect x="60" y="400" width="280" height="2" fill="#E6B31E" opacity="0.5" />
              {(m.scorersA || m.scorersB) && (
                <>
                  <text x="110" y="420" textAnchor="middle" fill="#F5F0E1" opacity="0.85" fontFamily="Space Grotesk, sans-serif" fontSize="10">⚽ {(m.scorersA || "—").length > 34 ? `${(m.scorersA || "").slice(0, 32)}…` : (m.scorersA || "—")}</text>
                  <text x="290" y="420" textAnchor="middle" fill="#F5F0E1" opacity="0.85" fontFamily="Space Grotesk, sans-serif" fontSize="10">⚽ {(m.scorersB || "—").length > 34 ? `${(m.scorersB || "").slice(0, 32)}…` : (m.scorersB || "—")}</text>
                  {((m.scorersA || "").length > 34 || (m.scorersB || "").length > 34) && (
                    <text x="200" y="434" textAnchor="middle" fill="#8FA396" opacity="0.7" fontFamily="Space Grotesk, sans-serif" fontSize="8" fontStyle="italic">Full squad on the lineup card →</text>
                  )}
                </>
              )}
              <text x="200" y="440" textAnchor="middle" fill="#F5F0E1" opacity="0.75" fontFamily="Space Grotesk, sans-serif" fontSize="11">📍 {m.location} · {fmtDate(m.date)}</text>
            </>
          ) : (
            <>
              <rect x="60" y="315" width="280" height="2" fill="#E6B31E" opacity="0.5" />
              <text x="200" y="345" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="15">{fmtDate(m.date)}  ·  {m.time}</text>
              <text x="200" y="368" textAnchor="middle" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontSize="13">📍 {m.location}</text>
            </>
          )}
          <text x="200" y="470" textAnchor="middle" fill="#F5F0E1" opacity="0.5" fontFamily="Space Grotesk, sans-serif" fontSize="11" letterSpacing="2">{isResult ? "HOSTED ON AREA MATCH" : "HOSTED ON AREA MATCH · COME SUPPORT YOUR TEAM"}</text>
        </svg>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
          <button className="btn btn-turf" style={{ flex: 1 }} onClick={() => toPng((png) => {
            const file = new File([png], "match-era-poster.png", { type: "image/png" });
            bumpShares();
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              navigator.share({ files: [file], title: "Area Match", text: `${m.teamA.name} vs ${m.teamB.name} — hosted on Area Match ⚽` }).catch(() => {});
            } else {
              notify("Sharing isn't supported on this browser — use Download instead");
            }
          })}>📤 Share</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={download}>⬇ Download</button>
        </div>
        {(m.shares || 0) > 0 && <div style={{ fontSize: 11, color: "#8FA396", textAlign: "center" }}>🎨 Shared {m.shares} time{m.shares === 1 ? "" : "s"}</div>}
      </div>
    </div>
  );
}

/* ---------- SHAREABLE STATS ARTWORK — dedicated card just for the stat line ---------- */
/* ---------- PLAYER CARD — cinematic downloadable achievement artwork ---------- */
function PlayerCardModal({ player, stats, onClose, notify, awards = [], level }) {
  const svgRef = useRef(null);
  if (!player) return null;
  const download = () => {
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1000; canvas.height = 1410;
      canvas.getContext("2d").drawImage(img, 0, 0, 1000, 1410);
      canvas.toBlob((png) => {
        URL.revokeObjectURL(url);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(png);
        a.download = `${player.name}-area-match.png`;
        a.click();
        notify("Player card downloaded 📲");
      });
    };
    img.src = url;
  };

  const perMatch = stats && stats.matches > 0 ? (stats.goals / stats.matches).toFixed(2) : "0.00";
  const nameParts = (player.name || "").trim().split(/\s+/);
  const line1 = nameParts[0] || "";
  const line2 = nameParts.slice(1).join(" ");
  const nameSize = (s) => (s.length > 12 ? 30 : s.length > 9 ? 36 : 43);
  const roleLine = [player.positionPlayed, stats && stats.team ? stats.team.name : null].filter(Boolean).join(" · ").toUpperCase();

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", borderRadius: 20, padding: 16, maxWidth: 340, width: "100%", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        {(player.state || (player.contactPublic && player.contactInfo)) && (
          <div style={{ display: "flex", gap: 10, fontSize: 12, color: "#8FA396", justifyContent: "center", flexWrap: "wrap" }}>
            {player.state && <span>📍 {player.state}</span>}
            {player.contactPublic && player.contactInfo && <span>📞 {player.contactInfo}</span>}
          </div>
        )}
        <svg ref={svgRef} viewBox="0 0 500 705" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", borderRadius: 14 }}>
          <defs>
            <linearGradient id="pcBase" x1="0.2" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stopColor="#16241b" /><stop offset="38%" stopColor="#0f1a14" />
              <stop offset="72%" stopColor="#0a110d" /><stop offset="100%" stopColor="#070c09" />
            </linearGradient>
            <radialGradient id="pcHalo" cx="50%" cy="30%" r="46%">
              <stop offset="0%" stopColor="#D6A81D" stopOpacity=".22" />
              <stop offset="55%" stopColor="#D6A81D" stopOpacity=".05" />
              <stop offset="100%" stopColor="#D6A81D" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="pcMetal" x1="0.1" y1="0" x2="0.9" y2="1">
              <stop offset="0%" stopColor="#FBEFC0" /><stop offset="22%" stopColor="#E3BC42" />
              <stop offset="46%" stopColor="#C4941A" /><stop offset="64%" stopColor="#E8C860" />
              <stop offset="82%" stopColor="#A87C12" /><stop offset="100%" stopColor="#6d4f0b" />
            </linearGradient>
            <linearGradient id="pcSheen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity=".38" />
              <stop offset="38%" stopColor="#fff" stopOpacity=".04" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="pcRule" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#D6A81D" stopOpacity="0" />
              <stop offset="50%" stopColor="#D6A81D" stopOpacity=".6" />
              <stop offset="100%" stopColor="#D6A81D" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="pcEdge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#D6A81D" stopOpacity=".55" />
              <stop offset="35%" stopColor="#D6A81D" stopOpacity=".12" />
              <stop offset="70%" stopColor="#D6A81D" stopOpacity=".12" />
              <stop offset="100%" stopColor="#D6A81D" stopOpacity=".55" />
            </linearGradient>
            <filter id="pcBlur"><feGaussianBlur stdDeviation="16" /></filter>
            <filter id="pcDrop"><feDropShadow dx="0" dy="7" stdDeviation="11" floodColor="#000" floodOpacity=".55" /></filter>
            <clipPath id="pcClip"><rect width="500" height="705" rx="22" /></clipPath>
          </defs>

          <g clipPath="url(#pcClip)">
            <rect width="500" height="705" fill="url(#pcBase)" />

            {/* concentric pitch arcs */}
            <g fill="none" stroke="#F5F0E1" opacity="0.045">
              <circle cx="250" cy="248" r="112" strokeWidth="1" />
              <circle cx="250" cy="248" r="158" strokeWidth="1" />
              <circle cx="250" cy="248" r="206" strokeWidth="1" />
              <circle cx="250" cy="248" r="258" strokeWidth="1" />
            </g>
            {/* turf mow lines */}
            <g opacity="0.028">
              <rect x="40" width="26" height="705" fill="#F5F0E1" />
              <rect x="132" width="26" height="705" fill="#F5F0E1" />
              <rect x="224" width="26" height="705" fill="#F5F0E1" />
              <rect x="316" width="26" height="705" fill="#F5F0E1" />
              <rect x="408" width="26" height="705" fill="#F5F0E1" />
            </g>

            <ellipse cx="250" cy="252" rx="190" ry="180" fill="url(#pcHalo)" filter="url(#pcBlur)" />

            <text x="38" y="48" fill="#D6A81D" fontFamily="Anton, sans-serif" fontSize="13.5" letterSpacing="3.6">AREA MATCH</text>
            <text x="462" y="48" textAnchor="end" fill="#55655c" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="10" letterSpacing="2">PLAYER CARD</text>
            <line x1="38" y1="64" x2="462" y2="64" stroke="#1d2a22" />

            {level && (
              <>
                <rect x="199" y="88" width="102" height="23" rx="4" fill="#D6A81D" fillOpacity="0.10" stroke="#D6A81D" strokeOpacity="0.34" />
                <text x="250" y="104" textAnchor="middle" fill="#EBC65C" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="10.5" letterSpacing="2.4">
                  {level.tier.name.toUpperCase()}
                </text>
              </>
            )}

            <g transform="translate(178,132) scale(1.44)" filter="url(#pcDrop)">
              <path d={JERSEY_PATH} fill="url(#pcMetal)" />
              <path d={JERSEY_PATH} fill="url(#pcSheen)" />
              <path d={JERSEY_PATH} fill="none" stroke="#4a3608" strokeWidth="1.4" />
              <path d="M38 2 Q50 12 62 2" fill="none" stroke="#3a2b06" strokeWidth="4.2" strokeLinecap="round" />
              <path d="M28 40 L28 100" stroke="#fff" strokeOpacity="0.12" strokeWidth="2" />
            </g>

            <text x="250" y={line2 ? 342 : 364} textAnchor="middle" fill="#F9F6EC" fontFamily="Anton, sans-serif" fontSize={nameSize(line1)} letterSpacing=".6">{line1.toUpperCase()}</text>
            {line2 && <text x="250" y="385" textAnchor="middle" fill="#F9F6EC" fontFamily="Anton, sans-serif" fontSize={nameSize(line2)} letterSpacing=".6">{line2.toUpperCase()}</text>}

            <line x1="112" y1="408" x2="228" y2="408" stroke="url(#pcRule)" />
            <line x1="272" y1="408" x2="388" y2="408" stroke="url(#pcRule)" />
            <path d="M250 402 L256 408 L250 414 L244 408 Z" fill="#D6A81D" />
            <text x="250" y="434" textAnchor="middle" fill="#93a89a" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize={roleLine.length > 32 ? 8.5 : 10.5} letterSpacing="3">
              {roleLine.length > 42 ? roleLine.slice(0, 40) + "…" : roleLine}
            </text>

            <text x="250" y="508" textAnchor="middle" fill="#D6A81D" fontFamily="Anton, sans-serif" fontSize="58">{perMatch}</text>
            <text x="250" y="530" textAnchor="middle" fill="#6f8377" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="9.5" letterSpacing="3">GOALS PER MATCH</text>

            <line x1="38" y1="562" x2="462" y2="562" stroke="#1a241d" />
            <line x1="179" y1="576" x2="179" y2="634" stroke="#1a241d" />
            <line x1="321" y1="576" x2="321" y2="634" stroke="#1a241d" />
            <line x1="38" y1="646" x2="462" y2="646" stroke="#1a241d" />

            <text x="108" y="608" textAnchor="middle" fill="#F9F6EC" fontFamily="Anton, sans-serif" fontSize="28">{stats ? stats.goals : 0}</text>
            <text x="108" y="628" textAnchor="middle" fill="#55655c" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="8.5" letterSpacing="1.8">GOALS</text>
            <text x="250" y="608" textAnchor="middle" fill="#F9F6EC" fontFamily="Anton, sans-serif" fontSize="28">{stats ? stats.matches : 0}</text>
            <text x="250" y="628" textAnchor="middle" fill="#55655c" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="8.5" letterSpacing="1.8">MATCHES</text>
            <text x="392" y="608" textAnchor="middle" fill="#F9F6EC" fontFamily="Anton, sans-serif" fontSize="28">{awards.length}</text>
            <text x="392" y="628" textAnchor="middle" fill="#55655c" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="8.5" letterSpacing="1.8">AWARDS</text>

            <text x="250" y="678" textAnchor="middle" fill="#3f4d45" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="9" letterSpacing="3">AREAMATCH.COM.NG</text>

            <rect x="1" y="1" width="498" height="703" rx="21" fill="none" stroke="url(#pcEdge)" strokeWidth="1.5" />
          </g>
        </svg>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={download}>⬇ Download</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- AWARD ARTWORK — cinematic, with a medal and ribbon, distinct from the player stat card ---------- */
function AwardCardModal({ award, player, team, onClose, notify }) {
  const svgRef = useRef(null);
  if (!award || !player) return null;
  const info = AWARD_TYPES[award.awardType] || { label: award.awardType, icon: "🏆", medal: "#E6B31E" };
  const download = () => {
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1000; canvas.height = 1240;
      canvas.getContext("2d").drawImage(img, 0, 0, 1000, 1240);
      canvas.toBlob((png) => {
        URL.revokeObjectURL(url);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(png);
        a.download = `${player.name}-${info.label.replace(/\s+/g, "-").toLowerCase()}-area-match.png`;
        a.click();
        notify("Award card downloaded 📲");
      });
    };
    img.src = url;
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 96, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", borderRadius: 20, padding: 16, maxWidth: 340, width: "100%", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <svg ref={svgRef} viewBox="0 0 500 620" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", borderRadius: 12 }}>
          <defs>
            <radialGradient id="acSpot" cx="50%" cy="28%" r="80%">
              <stop offset="0%" stopColor="#1c1006" /><stop offset="55%" stopColor="#0D0A05" /><stop offset="100%" stopColor="#050403" />
            </radialGradient>
            <radialGradient id="acGlow" cx="50%" cy="30%" r="30%">
              <stop offset="0%" stopColor={info.medal} stopOpacity="0.5" /><stop offset="100%" stopColor={info.medal} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="acMedal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={info.medal} /><stop offset="100%" stopColor="#8a6d1a" />
            </linearGradient>
            <filter id="acBlur"><feGaussianBlur stdDeviation="22" /></filter>
          </defs>

          <rect width="500" height="620" fill="url(#acSpot)" />
          <g opacity="0.15">
            <polygon points="100,0 160,0 40,620 -20,620" fill={info.medal} />
            <polygon points="340,0 400,0 480,620 420,620" fill={info.medal} />
          </g>
          <ellipse cx="250" cy="220" rx="180" ry="180" fill="url(#acGlow)" filter="url(#acBlur)" />

          <text x="250" y="46" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="20" letterSpacing="4">AREA MATCH</text>

          <polygon points="220,140 280,140 300,300 250,270 200,300" fill="#8a1f1f" />
          <polygon points="220,140 280,140 300,300 250,270 200,300" fill="#000" opacity="0.15" />

          <circle cx="250" cy="220" r="90" fill="url(#acMedal)" stroke="#F5F0E1" strokeWidth="3" />
          <circle cx="250" cy="220" r="72" fill="none" stroke="#0C120E" strokeWidth="2" strokeDasharray="4 5" opacity="0.4" />
          <text x="250" y="245" textAnchor="middle" fontSize="72">{info.icon}</text>

          <text x="250" y="360" textAnchor="middle" fill={info.medal} fontFamily="Anton, sans-serif" fontSize="26" letterSpacing="1">{info.label.toUpperCase()}</text>
          <text x="250" y="392" textAnchor="middle" fill="#F5F0E1" fontFamily="Anton, sans-serif" fontSize={player.name.length > 18 ? 20 : player.name.length > 13 ? 26 : 32}>{player.name.toUpperCase()}</text>
          <text x="250" y="416" textAnchor="middle" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="13">{team ? (team.name.length > 30 ? team.name.slice(0, 28) + "…" : team.name) : ""}</text>

          <line x1="140" y1="450" x2="360" y2="450" stroke="#F5F0E1" strokeOpacity="0.15" />
          <text x="250" y="480" textAnchor="middle" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="12">
            {award.createdAt ? new Date(award.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : ""}
          </text>

          <text x="250" y="592" textAnchor="middle" fill="#8FA396" opacity="0.6" fontFamily="Space Grotesk, sans-serif" fontSize="10" letterSpacing="3">AWARDED ON AREA MATCH</text>
        </svg>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={download}>⬇ Download</button>
        </div>
      </div>
    </div>
  );
}

function StatsPosterModal({ m, onClose, notify }) {
  const svgRef = useRef(null);
  if (!m) return null;
  const PosterBadge = ({ cx, cy, team, badge }) => {
    const icon = resolveBadgeIcon(badge);
    if (!icon) return null;
    return (
      <g transform={`translate(${cx} ${cy})`}>
        <path d="M0 -50 L-14 -60 Q-27 -63 -37 -55 L-64 -35 L-48 -18 L-36 -28 L-36 55 Q0 63 36 55 L36 -28 L48 -18 L64 -35 L37 -55 Q27 -63 14 -60 Z"
          transform="scale(0.45)" fill={team.color} stroke="#F5F0E1" strokeOpacity="0.3" strokeWidth="3" />
        <g transform={`scale(${(BADGE_ICON_SCALE[icon] || 1.2) * 0.45})`}><BadgeIconPaths name={icon} /></g>
      </g>
    );
  };
  const toPng = (cb) => {
    const svg = svgRef.current;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800; canvas.height = 1000;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 800, 1000);
      canvas.toBlob((png) => { URL.revokeObjectURL(url); cb(png); });
    };
    img.src = url;
  };
  const download = () => toPng((png) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = `${m.teamA.name}-vs-${m.teamB.name}-stats-area-match.png`;
    a.click();
    notify("Stats card downloaded 📲");
  });
  const poss = m.possessionA ?? 50;
  const rows = [
    [m.shotsA ?? 0, "SHOTS", m.shotsB ?? 0],
    [m.shotsOnTargetA ?? 0, "ON TARGET", m.shotsOnTargetB ?? 0],
    [m.cornersA ?? 0, "CORNERS", m.cornersB ?? 0],
    [m.foulsA ?? 0, "FOULS", m.foulsB ?? 0],
    [m.offsidesA ?? 0, "OFFSIDES", m.offsidesB ?? 0],
  ];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", borderRadius: 20, padding: 16, maxWidth: 340, width: "100%", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <svg ref={svgRef} viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", borderRadius: 12 }}>
          <defs>
            <linearGradient id="sbg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0D3A1F" /><stop offset="100%" stopColor="#0C120E" />
            </linearGradient>
          </defs>
          <rect width="400" height="500" fill="url(#sbg)" />
          <text x="200" y="45" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="22" letterSpacing="2">AREA MATCH</text>
          <text x="200" y="63" textAnchor="middle" fill="#F5F0E1" opacity="0.6" fontFamily="Space Grotesk, sans-serif" fontSize="9" letterSpacing="3">MATCH STATS</text>

          <PosterBadge cx={90} cy={100} team={m.teamA} badge={m.badgeA} />
          <PosterBadge cx={310} cy={100} team={m.teamB} badge={m.badgeB} />
          <text x="90" y="140" textAnchor="middle" fill="#F5F0E1" fontWeight="700" fontFamily="Space Grotesk, sans-serif" fontSize={m.teamA.name.length > 14 ? 9 : m.teamA.name.length > 10 ? 11 : 13}>{m.teamA.name}</text>
          <text x="310" y="140" textAnchor="middle" fill="#F5F0E1" fontWeight="700" fontFamily="Space Grotesk, sans-serif" fontSize={m.teamB.name.length > 14 ? 9 : m.teamB.name.length > 10 ? 11 : 13}>{m.teamB.name}</text>
          <text x="200" y="112" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="20">{m.liveA ?? m.finalA ?? 0}–{m.liveB ?? m.finalB ?? 0}</text>

          <line x1="30" y1="160" x2="370" y2="160" stroke="#F5F0E1" strokeOpacity="0.1" />

          <text x="200" y="185" textAnchor="middle" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="10" letterSpacing="2">POSSESSION</text>
          <rect x="30" y="193" width={Math.max(2, poss * 3.4)} height="8" rx="4" fill="#E6B31E" />
          <rect x={30 + poss * 3.4} y="193" width={Math.max(2, (100 - poss) * 3.4)} height="8" rx="4" fill="#243128" />
          <text x="30" y="213" fill="#F5F0E1" fontFamily="Anton, sans-serif" fontSize="13">{poss}%</text>
          <text x="370" y="213" textAnchor="end" fill="#F5F0E1" fontFamily="Anton, sans-serif" fontSize="13">{100 - poss}%</text>

          {rows.map(([a, label, b], i) => (
            <g key={label}>
              <text x="35" y={250 + i * 35} fontFamily="Anton, sans-serif" fontSize="16" fill="#E6B31E">{a}</text>
              <text x="365" y={250 + i * 35} textAnchor="end" fontFamily="Anton, sans-serif" fontSize="16" fill="#E6B31E">{b}</text>
              <text x="200" y={248 + i * 35} textAnchor="middle" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="10" letterSpacing="1">{label}</text>
            </g>
          ))}

          <text x="200" y="460" textAnchor="middle" fill="#F5F0E1" opacity="0.5" fontFamily="Space Grotesk, sans-serif" fontSize="10">📍 {m.location}</text>
          <text x="200" y="478" textAnchor="middle" fill="#8FA396" opacity="0.5" fontFamily="Space Grotesk, sans-serif" fontSize="9" letterSpacing="2">HOSTED ON AREA MATCH</text>
        </svg>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={download}>⬇ Download</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- LINEUP ARTWORK — dedicated card for rosters, so the score poster never gets crowded ---------- */
function LineupPosterModal({ m, onClose, notify }) {
  const svgRef = useRef(null);
  if (!m) return null;
  const namesA = (m.playersA || "").split(",").map((s) => s.trim()).filter(Boolean);
  const namesB = (m.playersB || "").split(",").map((s) => s.trim()).filter(Boolean);
  const maxShown = 12; // beyond this, cap with "+N more" rather than shrinking text illegibly
  const rowH = 24;
  const nameStartY = 140;
  const rowsShown = (n) => Math.min(n, maxShown) + (n > maxShown ? 1 : 0); // +1 row if a "+N more" line is needed
  const maxRows = Math.max(rowsShown(namesA.length), rowsShown(namesB.length), 1);
  const lastRowY = nameStartY + (maxRows - 1) * rowH;   // exact y of the final row actually drawn
  const dividerBottomY = lastRowY + 16;                  // divider ends just past the last row, not a guess
  const footerY1 = dividerBottomY + 34;
  const footerY2 = dividerBottomY + 52;
  const totalH = footerY2 + 24;

  const download = () => {
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800; canvas.height = totalH * 2;
      canvas.getContext("2d").drawImage(img, 0, 0, 800, totalH * 2);
      canvas.toBlob((png) => {
        URL.revokeObjectURL(url);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(png);
        a.download = `${m.teamA.name}-vs-${m.teamB.name}-lineups-area-match.png`;
        a.click();
        notify("Lineup card downloaded 📲");
      });
    };
    img.src = url;
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", borderRadius: 20, padding: 16, maxWidth: 360, width: "100%", display: "grid", gap: 12, maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <svg ref={svgRef} viewBox={`0 0 400 ${totalH}`} xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", borderRadius: 12 }}>
          <defs>
            <linearGradient id="lubg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0D3A1F" /><stop offset="100%" stopColor="#0C120E" />
            </linearGradient>
          </defs>
          <rect width="400" height={totalH} fill="url(#lubg)" />
          <text x="200" y="42" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="20" letterSpacing="2">AREA MATCH</text>
          <text x="200" y="60" textAnchor="middle" fill="#F5F0E1" opacity="0.6" fontFamily="Space Grotesk, sans-serif" fontSize="9" letterSpacing="3">TEAM LINEUPS</text>

          <text x="105" y="100" textAnchor="middle" fill="#F5F0E1" fontWeight="700" fontFamily="Space Grotesk, sans-serif" fontSize="14">{m.teamA.name}</text>
          <text x="295" y="100" textAnchor="middle" fill="#F5F0E1" fontWeight="700" fontFamily="Space Grotesk, sans-serif" fontSize="14">{m.teamB.name}</text>
          <line x1="200" y1="80" x2="200" y2={dividerBottomY} stroke="#F5F0E1" strokeOpacity="0.1" />
          <line x1="30" y1="115" x2="370" y2="115" stroke="#F5F0E1" strokeOpacity="0.1" />

          {namesA.length === 0 && <text x="105" y="140" textAnchor="middle" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="13">Squad TBA</text>}
          {namesA.slice(0, maxShown).map((n, i) => (
            <text key={"a" + i} x="30" y={140 + i * rowH} textAnchor="start" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontSize="14">{n.length > 18 ? n.slice(0, 17) + "…" : n}</text>
          ))}
          {namesA.length > maxShown && <text x="30" y={140 + maxShown * rowH} textAnchor="start" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="12" fontStyle="italic">+{namesA.length - maxShown} more</text>}

          {namesB.length === 0 && <text x="295" y="140" textAnchor="middle" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="13">Squad TBA</text>}
          {namesB.slice(0, maxShown).map((n, i) => (
            <text key={"b" + i} x="370" y={140 + i * rowH} textAnchor="end" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontSize="14">{n.length > 18 ? n.slice(0, 17) + "…" : n}</text>
          ))}
          {namesB.length > maxShown && <text x="370" y={140 + maxShown * rowH} textAnchor="end" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="12" fontStyle="italic">+{namesB.length - maxShown} more</text>}

          <text x="200" y={footerY1} textAnchor="middle" fill="#F5F0E1" opacity="0.5" fontFamily="Space Grotesk, sans-serif" fontSize="10">📍 {m.location}</text>
          <text x="200" y={footerY2} textAnchor="middle" fill="#8FA396" opacity="0.5" fontFamily="Space Grotesk, sans-serif" fontSize="9" letterSpacing="2">HOSTED ON AREA MATCH</text>
        </svg>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={download}>⬇ Download</button>
        </div>
      </div>
    </div>
  );
}
