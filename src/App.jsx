import React, { useState, useEffect, useRef } from "react";
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
  const [liveDetailFor, setLiveDetailFor] = useState(null); // matchId shown in the 🔴 Live pitch view
  const [liveTimeline, setLiveTimeline] = useState([]);     // fresh per-match events for that view
  const [goalAlertIds, setGoalAlertIds] = useState([]);     // matchIds the fan opted into goal alerts for
  const goalAlertIdsRef = useRef([]);
  useEffect(() => { goalAlertIdsRef.current = goalAlertIds; }, [goalAlertIds]);
  const [viewCaptain, setViewCaptain] = useState(null);
  const [capStateFilter, setCapStateFilter] = useState("All");
  const [comingSoon, setComingSoon] = useState(null); // feature name or null
  const [feedbacks, setFeedbacks] = useState([]);
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
  const [seeMore, setSeeMore] = useState({});
  const [pwaPromptOpen, setPwaPromptOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const loginClicked = useRef(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [notifPromptOpen, setNotifPromptOpen] = useState(false);
  const [posterFor, setPosterFor] = useState(null);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());
  const alertsFired = useRef({});

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3600); };

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

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
    const meObj = { id: p.id, name: p.name, role: p.role, pin: p.pin, state: p.state || "", contactInfo: p.contact_info || "", joined: (p.created_at || "").slice(0, 10), contact: (await supabase.auth.getUser()).data.user?.email || "" };
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
      supabase.from("profiles").select("id, name, role, created_at, contact_info, state, blocked, last_seen, email"),
    ]);
    const { data: ev } = await supabase.from("match_events").select("*").order("created_at", { ascending: false }).limit(12);
    if (ev) setEvents(ev);
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
    if (us) setUsers(us.map((u) => ({ id: u.id, name: u.name, role: u.role, contact: "", email: u.email || "", contactInfo: u.contact_info || "", state: u.state || "", blocked: !!u.blocked, lastSeen: u.last_seen, pin: null, joined: (u.created_at || "").slice(0, 10) })));
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
    if (m.running && m.timerStartedAt) {
      const FULL = (m.duration || 90) * 60;
      return Math.min(FULL, m.elapsed + Math.max(0, Math.floor((now - new Date(m.timerStartedAt).getTime()) / 1000)));
    }
    return m.elapsed;
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
      /* Second-half nag: break over / half passed but captain hasn't restarted */
      if (!m.running && !m.onBreak && !m.secondHalf && el >= HALF && el < FULL && m.status === "Live") {
        const last = alertsFired.current[m.id].shNagAt || 0;
        if (now - last > 5 * 60000 && alertsFired.current[m.id].half) {
          alertsFired.current[m.id].shNagAt = now;
          if (last > 0) notify(`⏰ Captain — the second half of ${m.teamA.name} vs ${m.teamB.name} hasn't started yet. Tap "Start second half" when ready!`);
          else alertsFired.current[m.id].shNagAt = now;
        }
      }
      if (m.running && el >= FULL && !alertsFired.current[m.id].full) {
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
    patchMatch(m.id, { status: "Live", running: true, elapsed: 0, liveA: 0, liveB: 0, timerStartedAt: new Date().toISOString() });
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
    const { error } = await supabase.from("profiles").update(row).eq("id", me.id);
    if (error) return notify(error.message);
    setUsers((us) => us.map((u) => (u.id === me.id ? { ...u, ...patch } : u)));
    setMe((m) => ({ ...m, ...patch }));
  };

  const minute = (m) => Math.min(m.duration || 90, Math.floor(liveElapsed(m) / 60));
  /* Past results older than 30 days are retired from view (and purged nightly by the database) */
  const isFresh = (m) => m.status !== "ResultPublished" || (now - new Date(m.date).getTime()) < 30 * 86400000;
  const pendingScores = me ? matches.filter((m) => m.status === "AwaitingScore" && m.createdBy === me.id) : [];

  /* ============================================================ STYLES */
  const css = `
    ${FONT}
    * { box-sizing: border-box; margin: 0; }
    .md-root { min-height: 100vh; min-height: 100dvh; background: ${T.night}; color: ${T.chalk}; font-family: 'Space Grotesk', sans-serif; -webkit-user-select: none; user-select: none; }
    input, textarea, select { -webkit-user-select: text; user-select: text; }
    .display { font-family: 'Anton', sans-serif; letter-spacing: .02em; text-transform: uppercase; }
    .btn { border: 0; cursor: pointer; font-family: 'Space Grotesk', sans-serif; font-weight: 700; border-radius: 10px; padding: 12px 18px; font-size: 15px; transition: transform .08s; }
    .btn:active { transform: scale(.97); }
    .btn-gold { background: ${T.floodlight}; color: ${T.night}; }
    .btn-turf { background: ${T.turf}; color: ${T.chalk}; }
    .btn-ghost { background: transparent; color: ${T.chalk}; border: 1.5px solid #2A3A2E; }
    .btn-live { background: ${T.live}; color: #fff; }
    .input { width: 100%; padding: 13px 14px; border-radius: 10px; border: 1.5px solid #2A3A2E; background: #121814; color: ${T.chalk}; font-size: 15px; font-family: 'Space Grotesk', sans-serif; outline: none; }
    .input:focus { border-color: ${T.floodlight}; }
    .card { background: #161E19; border: 1px solid #243128; border-radius: 16px; padding: 18px; }
    .chip { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .scoreboard { background: radial-gradient(circle at 50% -20%, rgba(245,240,225,.10), transparent 55%), repeating-linear-gradient(90deg, transparent 0 46px, rgba(245,240,225,.05) 46px 48px), ${T.turfDeep}; border: 2px solid ${T.turf}; border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pulse { animation: pulse 1.2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
    .topnav { display: flex; gap: 4px; }
    .topnav button { background: none; border: 0; color: ${T.muted}; font-family: 'Space Grotesk'; font-weight: 700; font-size: 14px; padding: 10px 16px; cursor: pointer; border-radius: 8px; }
    .topnav button.on { color: ${T.night}; background: ${T.floodlight}; }
    .topnav button:hover:not(.on) { color: ${T.chalk}; }
    .feedgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .hero { background: radial-gradient(circle at 50% -30%, rgba(245,240,225,.08), transparent 55%), repeating-linear-gradient(90deg, transparent 0 46px, rgba(245,240,225,.04) 46px 48px), linear-gradient(160deg, ${T.turfDeep}, ${T.night}); border: 1px solid #243128; border-radius: 20px; padding: 36px; margin-bottom: 24px; }
    .hero-title { font-size: 38px; line-height: 1.1; color: ${T.chalk}; }
    .banner { background: ${T.live}; color: #fff; border-radius: 12px; padding: 14px 18px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
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
      .adm-topbar, .adm-body { padding-left: 14px; padding-right: 14px; }
    }
    .user-pill { display: flex; align-items: center; gap: 9px; }
    .user-pill-clickable { cursor: pointer; padding: 4px 8px; border-radius: 999px; border: 1px solid #2A3A2E; transition: all .12s; }
    .user-pill-clickable:hover { border-color: ${T.floodlight}; background: #161E19; }
    .user-pill-clickable:active { transform: scale(.97); }
    .user-avatar-simple { width: 36px; height: 36px; border-radius: 50%; background: ${T.turf}; display: flex; align-items: center; justify-content: center; font-family: 'Anton', sans-serif; font-size: 15px; color: ${T.floodlight}; flex-shrink: 0; border: 1.5px solid rgba(255, 212, 71, .4); }
    .user-logout { width: 30px; height: 30px; border-radius: 50%; border: 1px solid #2A3A2E; background: transparent; color: ${T.muted}; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all .12s; }
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
  `;

  /* ============================================================ BOOT LOADER */
  if (booting) {
    return (
      <div className="md-root" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <style>{css}{`@keyframes spin { to { transform: rotate(360deg) } } .loader { width: 46px; height: 46px; border: 4px solid #243128; border-top-color: #E6B31E; border-radius: 50%; animation: spin .9s linear infinite; }`}</style>
        <div className="display" style={{ fontSize: 34, color: T.floodlight }}>Area Match</div>
        <div className="loader" />
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
              <a href="https://wa.me/12704939553?text=Hi%2C%20I%20need%20help%20with%20my%20Match%20Era%20account" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.muted, textAlign: "center", textDecoration: "none" }}>
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
            <div className="display" style={{ fontSize: 52, color: T.floodlight, lineHeight: 1 }}>Area Match</div>
          </div>
          <div style={{ color: T.muted, marginTop: 8, marginBottom: 30, fontSize: 17 }}>
            The community football website. Host matches, track them live, publish results for the fans.
          </div>
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
                  <div style={{ display: "flex", gap: 8 }}>
                    {["Captain", "Fan"].map((r) => (
                      <button key={r} className={`btn ${form.role === r ? "btn-turf" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setForm({ ...form, role: r })}>
                        {r === "Captain" ? "⚽ Captain" : "📣 Fan"}
                      </button>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 4, fontWeight: 700 }}>📍 Your state (so we can show you matches near you)</div>
                    <select className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                      <option value="">Select your state…</option>
                      {NG_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
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
              <a href="https://wa.me/12704939553?text=Hi%2C%20I%20need%20help%20with%20my%20Match%20Era%20account" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: T.muted, textAlign: "center", textDecoration: "none" }}>
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
  const captainState = (m) => (users.find((u) => u.id === m.createdBy) || {}).state || "";
  const publishedAll = matches.filter((m) => m.published && isFresh(m) && m.status !== "Cancelled");
  const published = publishedAll.filter((m) =>
    (feedState === "All" || captainState(m) === feedState) &&
    (!feedFollowedOnly || follows.includes(m.createdBy)));
  const inMyState = me && me.state ? publishedAll.filter((m) => captainState(m) === me.state && m.status !== "ResultPublished") : [];
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
  const liveNow = published.filter((m) => m.status === "Live" || m.status === "AwaitingScore")
    .sort((a, b) => (myLikes.includes(b.id) ? 1 : 0) - (myLikes.includes(a.id) ? 1 : 0));
  const results = published.filter((m) => m.status === "ResultPublished");
  const mine = matches.filter((m) => m.createdBy === me.id);
  /* 🔴 Live tab — every currently-live match in the fan's state or from a followed captain */
  const liveForUser = matches.filter((m) => m.published && m.status === "Live" &&
    (me.role === "Admin" || captainState(m) === me.state || follows.includes(m.createdBy)));
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
                <div style={{ width: 36, height: 36, borderRadius: 10, background: T.floodlight, color: T.night, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", flexShrink: 0 }}>
                  {me.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="adm-label" style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.name}</div>
                  <button onClick={logout} style={{ background: "none", border: 0, color: T.live, fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 700 }}>Log out →</button>
                </div>
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
                    {publishedAll.slice(0, 6).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                  </div>
                </>
              )}

              {adminSection === "active" && (
                <div style={{ display: "grid", gap: 8 }}>
                  {[...users].sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || "")).map((u) => {
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
                  {adminPosts.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13, background: "#131a15", borderRadius: 10, padding: "8px 12px" }}>
                      <span style={{ flex: 1 }}>{p.message}</span>
                      <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 11, color: T.live, borderColor: "#3a1f1a" }}
                        onClick={async () => { await supabase.from("posts").delete().eq("id", p.id); refreshAll(); notify("Announcement deleted"); }}>Delete</button>
                    </div>
                  ))}
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
                  {feedbacks.map((f) => (
                    <div key={f.id} className="card" style={{ marginBottom: 8, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span className="chip" style={{ background: "#243128", color: T.floodlight }}>{f.feature}</span>
                        <span style={{ color: T.muted, fontSize: 11 }}>{users.find((u) => u.id === f.userId)?.name || "User"}</span>
                      </div>
                      <div style={{ color: T.chalk }}>{f.msg}</div>
                    </div>
                  ))}
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
                          {group.map((u) => (
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
                    return fresh.map((u) => (
                      <button key={u.id} className="card adm-row" onClick={() => setAdminViewUser(u.id)}>
                        <div style={{ width: 38, height: 38, borderRadius: 12, background: T.turf, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", color: T.floodlight, flexShrink: 0 }}>{u.name.slice(0, 1).toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: T.chalk }}>{u.name} <span className="chip" style={{ background: T.floodlight, color: T.night, marginLeft: 4 }}>NEW</span></div>
                          <div style={{ fontSize: 12, color: T.muted }}>{u.role} · {u.state || "—"} · {u.email || ""} · joined {u.joined}</div>
                        </div>
                        <span style={{ color: T.muted }}>›</span>
                      </button>
                    ));
                  })()}
                </div>
              )}

              {adminSection === "blocked" && (
                <div style={{ display: "grid", gap: 8 }}>
                  {users.filter((u) => u.blocked).length === 0 && <div className="card" style={{ color: T.muted }}>No blocked users. 🎉</div>}
                  {users.filter((u) => u.blocked).map((u) => (
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="24" height="24" viewBox="0 0 32 32" style={{ flexShrink: 0 }}><circle cx="16" cy="16" r="10" fill="none" stroke={T.floodlight} strokeWidth="1.8" /><path d="M16 9l5 3.6-2 6H13l-2-6z" fill={T.floodlight} /></svg>
              <div className="display" style={{ fontSize: 26, color: T.floodlight }}>Area Match</div>
            </div>
            <div className={`user-pill ${me.role !== "Admin" ? "user-pill-clickable" : ""}`} title="View profile" onClick={() => me.role !== "Admin" && setPage("profile")}>
              <div className="user-avatar-simple">{me.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{me.name}{me.role !== "Admin" && <span style={{ color: T.muted, fontWeight: 400 }}> ›</span>}</div>
              </div>
              <button className="user-logout" title="Log out" onClick={(e) => { e.stopPropagation(); logout(); }}>⏻</button>
            </div>
          </div>
          <nav className="topnav">
            <button className={page === "feed" ? "on" : ""} onClick={() => setPage("feed")}>News Feed</button>
            {me.role === "Fan" && <button className={page === "captains" ? "on" : ""} onClick={() => { setPage("captains"); setViewCaptain(null); }}>Captains</button>}
            <button className={page === "live" ? "on" : ""} onClick={() => setPage("live")}>Live</button>
            {me.role === "Captain" && <button className={page === "mymatches" || page === "create" ? "on" : ""} onClick={() => setPage("mymatches")}>My Matches</button>}
            <button className={page === "about" ? "on" : ""} onClick={() => setPage("about")}>About</button>
            {me.role !== "Admin" && <button className={page === "feedbackpage" ? "on" : ""} onClick={() => setPage("feedbackpage")}>Feedback</button>}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px 60px" }}>

        {/* KICK-OFF PERMISSION BANNER — scheduled time is due, captain decides */}
        {me.role === "Captain" && matches.filter((m) => m.status === "Scheduled" && m.createdBy === me.id && isDue(m)).map((m) => (
          <div key={"ko-" + m.id} className="banner" style={{ marginBottom: 16, background: "#14532D" }}>
            <span>⚽ Kick-off time reached: {m.teamA.name} vs {m.teamB.name} ({m.time}). The match starts only when you say so.</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-gold" style={{ padding: "8px 14px" }} onClick={() => startMatch(m)}>▶ Start match</button>
              <button className="btn btn-ghost" style={{ padding: "8px 14px", borderColor: "rgba(255,255,255,.35)", color: "#fff" }} onClick={() => setOpenMatch(m.id)}>📅 Postpone</button>
            </div>
          </div>
        ))}

        {/* SCORE REQUEST BANNER — the site requests the final score */}
        {pendingScores.map((m) => {
          const mins = m.awaitingSince ? Math.floor((now - new Date(m.awaitingSince).getTime()) / 60000) : 0;
          return (
            <div key={m.id} className="banner" style={{ marginBottom: 16 }}>
              <span>
                {mins >= 20 ? `⚠️ ${mins} MINUTES LATE — ` : "🏁 Full time: "}
                {m.teamA.name} vs {m.teamB.name}. Upload the result to publish it.
              </span>
              <button className="btn btn-gold" style={{ padding: "8px 14px" }} onClick={() => setOpenMatch(m.id)}>Upload result</button>
            </div>
          );
        })}

        {/* ---------- NEWS FEED (homepage) ---------- */}
        {page === "feed" && (
          <>
            {/* LIVE TICKER */}
            {events.length > 0 && (
              <div style={{ background: "#131a15", border: "1px solid #243128", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "grid", gap: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.live, letterSpacing: ".1em" }}>⚡ LIVE UPDATES</div>
                {events.slice(0, 3).map((e) => (
                  <div key={e.id} style={{ fontSize: 13, display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ flex: 1 }}>{e.message}</span>
                    <span style={{ color: T.muted, fontSize: 11, whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            )}

            {/* FILTERS */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
              <select className="input" style={{ width: "auto", padding: "9px 12px", fontSize: 13 }} value={feedState} onChange={(e) => setFeedState(e.target.value)}>
                <option value="All">🌍 All states</option>
                {NG_STATES.map((st) => <option key={st} value={st}>📍 {st}</option>)}
              </select>
              {me.role === "Fan" && follows.length > 0 && (
                <button className={`btn ${feedFollowedOnly ? "btn-gold" : "btn-ghost"}`} style={{ padding: "9px 14px", fontSize: 13 }}
                  onClick={() => setFeedFollowedOnly(!feedFollowedOnly)}>🔔 Captains I follow</button>
              )}
            </div>

            <div className="hero">
              <div className="display hero-title">
                Your community.<br /><span style={{ color: T.floodlight }}>Your matches. Live.</span>
              </div>
              <div style={{ color: T.muted, marginTop: 10, maxWidth: 520 }}>
                Follow published matches from local captains, and catch every score update the moment it happens on 🔴 Live. Results go live the moment the captain submits the final score.
              </div>
            </div>

            {/* Admin announcements */}
            {adminPosts.length > 0 && adminPosts.slice(0, 3).map((p) => (
              <div key={p.id} className="card" style={{ marginBottom: 12, borderColor: "#E6B31E", borderWidth: 1.5 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span className="chip" style={{ background: T.floodlight, color: T.night }}>📢 Area Match</span>
                  <span style={{ fontSize: 11, color: T.muted }}>{(p.created_at || "").slice(0, 10)}</span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>{p.message}</div>
              </div>
            ))}

            {/* Matches from captains you follow */}
            {me.role === "Fan" && follows.length > 0 && (() => {
              const followed = published.filter((m) => follows.includes(m.createdBy) && m.status !== "ResultPublished");
              return followed.length > 0 ? (
                <>
                  <SectionTitle color={T.floodlight}>🔔 From Captains You Follow</SectionTitle>
                  <div className="feedgrid" style={{ marginBottom: 28 }}>
                    {followed.map((m) => <MatchCard key={"f" + m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                  </div>
                </>
              ) : null;
            })()}

            {liveNow.length > 0 && (
              <>
                <SectionTitle color={T.live}>● Live Now</SectionTitle>
                <div className="feedgrid" style={{ marginBottom: 28 }}>
                  {liveNow.map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                </div>
              </>
            )}

            {feedState !== "All" && published.length === 0 && (
              <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: 22 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📍</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>No matches in {feedState} yet</div>
                <div style={{ fontSize: 13, color: T.muted }}>No captain has published a match in {feedState}. Check back soon, or switch to 🌍 All states to see everything.</div>
              </div>
            )}

            {inMyState.length > 0 && feedState === "All" && !feedFollowedOnly && (
              <>
                <SectionTitle color={T.floodlight}>📍 Matches in {me.state}</SectionTitle>
                <div className="feedgrid" style={{ marginBottom: 8 }}>
                  {capped("mystate", inMyState).map((m) => <MatchCard key={"st" + m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                </div>
                <SeeMoreBtn k="mystate" list={inMyState} />
              </>
            )}

            <SectionTitle color={T.floodlight}>Upcoming Matches</SectionTitle>
            {upcoming.length === 0 && <div className="card" style={{ color: T.muted, marginBottom: 28 }}>No upcoming published matches yet.</div>}
            <div className="feedgrid" style={{ marginBottom: 8 }}>
              {capped("upcoming", upcoming).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} />)}
            </div>

            <SeeMoreBtn k="upcoming" list={upcoming} />

            <SectionTitle color={T.chalk}>Results</SectionTitle>
            {results.length === 0 && <div className="card" style={{ color: T.muted }}>No results published yet. Results appear here once captains submit final scores.</div>}
            <div className="feedgrid" style={{ marginBottom: 8 }}>
              {capped("results", results).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} />)}
            </div>
            <SeeMoreBtn k="results" list={results} />
          </>
        )}

        {/* ---------- MY MATCHES ---------- */}
        {page === "mymatches" && me.role === "Captain" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div className="display" style={{ fontSize: 24 }}>My Matches</div>
              <button className="btn btn-gold" onClick={() => setPage("create")}>+ Create Match</button>
            </div>
            {mine.length === 0 && <div className="card" style={{ color: T.muted }}>You haven't created any matches yet. Create your first one to get started.</div>}
            <div className="feedgrid">
              {capped("mymatches", mine).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} mineView />)}
            </div>
            <SeeMoreBtn k="mymatches" list={mine} />
          </>
        )}

        {/* ---------- CREATE ---------- */}
        {page === "create" && me.role === "Captain" && (
          <div style={{ maxWidth: 560 }}>
            <CreateMatch
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
            stats={me.role === "Captain"
              ? { a: ["Matches created", matches.filter((x) => x.createdBy === me.id).length], b: ["🔔 Followers", followerCounts[me.id] || 0], c: ["Live now", matches.filter((x) => x.createdBy === me.id && x.status === "Live").length] }
              : { a: ["🔔 Captains followed", follows.length], b: ["💛 Likes given", myLikes.length], c: ["🏁 Results seen", results.length] }}
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
                <select className="input" style={{ width: "auto", padding: "9px 12px", fontSize: 13 }} value={capStateFilter} onChange={(e) => setCapStateFilter(e.target.value)}>
                  <option value="All">🌍 Captains in all states</option>
                  {NG_STATES.map((st) => <option key={st} value={st}>📍 {st}</option>)}
                </select>
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
                      <div key={c.id} className="card" style={{ cursor: "pointer", display: "grid", gap: 10 }} onClick={() => setViewCaptain(c.id)}>
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
                const theirs = matches.filter((x) => x.createdBy === c.id && x.published && isFresh(x));
                return (
                  <>
                    <button className="btn btn-ghost" style={{ marginBottom: 14, padding: "8px 14px", fontSize: 13 }} onClick={() => setViewCaptain(null)}>← All captains</button>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                      <div style={{ width: 60, height: 60, borderRadius: "50%", background: T.turf, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 26, color: T.floodlight }}>
                        {c.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="display" style={{ fontSize: 24 }}>{c.name}</div>
                        <div style={{ fontSize: 13, color: T.muted }}>{theirs.length} published match{theirs.length === 1 ? "" : "es"} · 🔔 {followerCounts[c.id] || 0} follower{(followerCounts[c.id] || 0) === 1 ? "" : "s"}</div>
                        {c.contactInfo && <div style={{ fontSize: 13, color: T.floodlight, marginTop: 4 }}>📞 Want to join the team? Contact: {c.contactInfo}</div>}
                        {(() => { const a = annes.find((x) => x.captain_id === c.id); return a ? (
                          <div style={{ fontSize: 13, background: "#1c1509", border: "1px solid #E6B31E", borderRadius: 10, padding: "8px 12px", marginTop: 8 }}>
                            📣 <b style={{ color: T.floodlight }}>Announcement:</b> {a.message}
                          </div>
                        ) : null; })()}
                      </div>
                      {me.role === "Fan" && c.id !== me.id && (
                        <button className={`btn ${follows.includes(c.id) ? "btn-turf" : "btn-gold"}`} onClick={() => toggleFollow(c.id)}>
                          {follows.includes(c.id) ? "✓ Following" : "🔔 Follow"}
                        </button>
                      )}
                    </div>
                    {theirs.length === 0 && <div className="card" style={{ color: T.muted }}>This captain hasn't published any matches yet.</div>}
                    {theirs.filter((x) => x.status !== "ResultPublished").length > 0 && <SectionTitle color={T.floodlight}>Current & Upcoming</SectionTitle>}
                    <div className="feedgrid" style={{ marginBottom: 20 }}>
                      {capped("captain-up-" + c.id, theirs.filter((x) => x.status !== "ResultPublished")).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                    </div>
                    <SeeMoreBtn k={"captain-up-" + c.id} list={theirs.filter((x) => x.status !== "ResultPublished")} />
                    {theirs.filter((x) => x.status === "ResultPublished").length > 0 && <SectionTitle color={T.chalk}>Past Games Record</SectionTitle>}
                    <div className="feedgrid">
                      {capped("captain-past-" + c.id, theirs.filter((x) => x.status === "ResultPublished" && isFresh(x)).sort((a, b) => (a.date < b.date ? 1 : -1))).map((m) => <MatchCard key={m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} />)}
                    </div>
                    <SeeMoreBtn k={"captain-past-" + c.id} list={theirs.filter((x) => x.status === "ResultPublished" && isFresh(x))} />
                  </>
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
            <div style={{ color: T.muted, fontSize: 13, marginBottom: 18 }}>
              {me.role === "Admin" ? "Every match live right now." : "Live matches in your state, and from captains you follow."}
            </div>
            {liveForUser.length === 0 && (
              <div className="card" style={{ color: T.muted }}>Nothing live right now — check back on match day. ⚽</div>
            )}
            <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
              {capped("live", liveForUser).map((m) => (
                <MatchCard key={"lv" + m.id} m={m} minute={minute} breakLeft={breakLeft} onOpen={() => setLiveDetailFor(m.id)} onPoster={() => setPosterFor(m.id)} />
              ))}
            </div>
            <SeeMoreBtn k="live" list={liveForUser} />
          </div>
        )}

        {/* ---------- FEEDBACK ---------- */}
        {page === "feedbackpage" && me.role !== "Admin" && (
          <FeedbackPage
            myFeedback={feedbacks.filter((f) => f.user_id === me.id)}
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
          minute={minute}
          breakLeft={breakLeft}
          captainName={(users.find((u) => u.id === (matches.find((x) => x.id === openMatch) || {}).createdBy) || {}).name || ""}
          isDue={isDue}
          untilKickoff={untilKickoff}
          onClose={() => setOpenMatch(null)}
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
            patchMatch(m.id, { liveA: a, liveB: b });
            if (a > wasA) logEvent(m.id, `⚽ GOAL — ${m.teamA.name}! ${scorerA || "A player"} scores. ${a}-${b}`, minute(m));
            if (b > wasB) logEvent(m.id, `⚽ GOAL — ${m.teamB.name}! ${scorerB || "A player"} scores. ${a}-${b}`, minute(m));
            if (a <= wasA && b <= wasB) logEvent(m.id, `✏️ Score corrected: ${m.teamA.name} ${a}-${b} ${m.teamB.name}`, minute(m));
          }}
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
            const { error } = await supabase.from("matches").delete().eq("id", m.id);
            if (error) return notify(error.message);
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

      {liveDetailMatch && (
        <LiveMatchView
          m={liveDetailMatch}
          me={me}
          minute={minute}
          timeline={liveTimeline}
          alertsOn={goalAlertIds.includes(liveDetailMatch.id)}
          onToggleAlerts={() => setGoalAlertIds((ids) => ids.includes(liveDetailMatch.id) ? ids.filter((x) => x !== liveDetailMatch.id) : [...ids, liveDetailMatch.id])}
          onShare={() => { setLiveDetailFor(null); setPosterFor(liveDetailMatch.id); }}
          onClose={() => setLiveDetailFor(null)}
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
                      {["Fan", "Captain", "Admin"].map((r2) => <option key={r2} value={r2}>{r2}</option>)}
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
    Live: { bg: "#E8442E", c: "#fff", t: "● LIVE" },
    AwaitingScore: { bg: "#3a3320", c: "#E6B31E", t: "Result Awaiting" },
    ResultPublished: { bg: "#14532D", c: "#E6B31E", t: "Result" },
    Cancelled: { bg: "#3a1f1a", c: "#E8442E", t: "❌ Cancelled" },
  };
  const ht = m.status === "Live" && (m.halfPrompt || m.onBreak);
  const s = ht ? { bg: "#3a3320", c: "#E6B31E", t: "⏸ Half Time" } : map[m.status];
  return <span className={`chip ${m.status === "Live" && !ht ? "pulse" : ""}`} style={{ background: s.bg, color: s.c }}>{s.t}</span>;
}

/* ---------- Shared "How to go live" instructions — used at match creation AND during the match ---------- */
function StreamHelpModal({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", border: "1.5px solid #E6B31E", borderRadius: 20, padding: 22, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div className="display" style={{ fontSize: 18, color: "#E6B31E" }}>📖 How to go live</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, display: "grid", gap: 10 }}>
          <div><b style={{ color: "#E6B31E" }}>1.</b> Open <b>Facebook</b> and tap <b>Live</b> (where you'd normally write a post).</div>
          <div><b style={{ color: "#E6B31E" }}>2.</b> <b style={{ color: "#E8442E" }}>Important:</b> set the audience to <b>Public 🌍</b> — not Friends — or fans won't be able to watch.</div>
          <div><b style={{ color: "#E6B31E" }}>3.</b> Start your broadcast.</div>
          <div><b style={{ color: "#E6B31E" }}>4.</b> On your live video, tap <b>Share → Copy Link</b>.</div>
          <div><b style={{ color: "#E6B31E" }}>5.</b> Come back here, paste the link and hit <b>Save</b> — fans will see 🔴 Watch Live instantly.</div>
          <div style={{ borderTop: "1px solid #243128", paddingTop: 10, color: "#8FA396", fontSize: 12 }}>
            💡 Tips: streaming ~90 minutes uses around 1.5–2GB of data. Prop your phone steady or let a teammate film — you're also running the match! YouTube links work too if you have a channel.
          </div>
        </div>
        <button className="btn btn-gold" onClick={onClose}>Got it</button>
      </div>
    </div>
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
        {m.postponed && m.status === "Scheduled" && <span className="chip" style={{ background: "#3a3320", color: "#E6B31E" }}>📅 Rescheduled</span>}
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
              {m.streamUrl && <div className="chip pulse" style={{ background: "#E8442E", color: "#fff", fontSize: 9, marginTop: 2 }}>🔴 LIVE STREAM</div>}
            </>
          ) : m.status === "AwaitingScore" ? (
            <>
              <div className="display" style={{ fontSize: 20, color: "#E6B31E" }}>FT</div>
              <div style={{ fontSize: 11, color: "#8FA396", fontWeight: 700 }}>Result awaiting</div>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#8FA396", flexWrap: "wrap", gap: 8 }}>
        <span>📍 {m.location} · {m.date} · ⏱ {m.duration || 90}'</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onPoster(); }}>🎨 Artwork</button>
        </div>
      </div>
    </div>
  );
}

function MatchDetail({ m, me, minute, breakLeft, captainName, isDue, untilKickoff, alreadyRequested, onClose, onStart, onPauseResume, onLiveScore, onSetStream, onCancelMatch, onDeleteMatch, onLike, liked, likeCount, onRequestChange, onHalfTime, onPostpone, onPublish, onSubmitScore, onPoster }) {
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
  const [scorersB, setScorersB] = useState("");
  const [unknowns, setUnknowns] = useState([]); // [{name, team, tag: null|'sub'|'pen'}]
  const [pa, setPa] = useState("");
  const [pb, setPb] = useState("");
  useEffect(() => { setFa(""); setFb(""); setShootout(false); setPa(""); setPb(""); }, [m && m.id]);
  if (!m) return null;
  const isOwner = m.createdBy === me.id;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", borderRadius: 20, padding: 22, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 14 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <StatusChip m={m} />
          <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onClose}>✕ Close</button>
        </div>

        <div className="scoreboard" style={{ padding: 18 }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <MiniLogo team={m.teamA} badge={m.badgeA} size={54} />
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>{m.teamA.name}</div>
          </div>
          <div className="sb-center">
            <div className="display" style={{ fontSize: 38, color: m.status === "Live" ? (m.halfPrompt || m.onBreak ? "#E6B31E" : "#E8442E") : "#E6B31E" }}>
              {m.status === "ResultPublished" ? `${m.finalA} – ${m.finalB}` : m.status === "Live" ? (m.halfPrompt || m.onBreak ? `HT ${m.liveA ?? 0}–${m.liveB ?? 0}` : `${m.liveA ?? 0} – ${m.liveB ?? 0}`) : m.status === "AwaitingScore" ? "FT" : m.status === "Cancelled" ? "❌" : "VS"}
            </div>
            {m.status === "Live" && (m.halfPrompt || m.onBreak) && (
              <div style={{ color: "#E6B31E", fontWeight: 700, fontSize: 13 }}>
                {m.onBreak ? `Half-time break · ${Math.floor(breakLeft(m) / 60)}:${String(breakLeft(m) % 60).padStart(2, "0")} left` : "Half-time break"}
              </div>
            )}
            {m.status === "Live" && !m.halfPrompt && !m.onBreak && (m.running
              ? <div className="pulse" style={{ color: "#E8442E", fontWeight: 700 }}>LIVE · {minute(m)}'</div>
              : <div style={{ color: "#E6B31E", fontWeight: 700, fontSize: 13 }}>⏸ Paused{m.pauseReason ? ` — ${m.pauseReason}` : ""}</div>)}
            {m.status === "AwaitingScore" && <div style={{ color: "#8FA396", fontWeight: 700, fontSize: 12 }}>Result awaiting</div>}
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <MiniLogo team={m.teamB} badge={m.badgeB} size={54} />
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>{m.teamB.name}</div>
          </div>
        </div>

        <div style={{ fontSize: 13, color: "#8FA396" }}>📍 {m.location} · {m.date} at {m.time}</div>
        {captainName && <div style={{ fontSize: 13, color: "#8FA396" }}>🧢 Hosted by Captain <span style={{ color: "#E6B31E", fontWeight: 700 }}>{captainName}</span></div>}

        {/* TEAM SHEETS */}
        <div className="card" style={{ fontSize: 13, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8FA396", letterSpacing: ".08em", textTransform: "uppercase" }}>Team Sheets</div>
          {[[m.teamA, m.badgeA, m.playersA], [m.teamB, m.badgeB, m.playersB]].map(([team, badge, players], i) => (
            <div key={i}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <MiniLogo team={team} badge={badge} size={26} />
                <span style={{ fontWeight: 700 }}>{team.name}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(players || "").split(",").map((p) => p.trim()).filter(Boolean).length > 0
                  ? (players || "").split(",").map((p) => p.trim()).filter(Boolean).map((p, j) => (
                      <span key={j} className="chip" style={{ background: "#243128", color: "#F5F0E1", fontWeight: 500 }}>{p}</span>
                    ))
                  : <span style={{ color: "#8FA396" }}>Squad to be announced</span>}
              </div>
            </div>
          ))}
        </div>

        {/* LIVE STREAM — captain attaches a Facebook/YouTube live link */}
        {isOwner && me.role === "Captain" && (m.status === "Scheduled" || m.status === "Live") && (
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
            <a href={m.streamUrl} target="_blank" rel="noopener noreferrer" className="btn btn-live pulse" style={{ textAlign: "center", textDecoration: "none" }}>
              ▶ Watch Live on Facebook
            </a>
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

        {/* STAR — pin this match to the top of your feed */}
        {m.status === "Live" && (
          <button className={`btn ${liked ? "btn-gold" : "btn-ghost"}`} onClick={onLike}>
            {liked ? "★ Starred" : "☆ Star this match"} · {likeCount}
          </button>
        )}
        {m.status === "Live" && <div style={{ fontSize: 11, color: "#8FA396", marginTop: -6 }}>Starred matches appear at the top of your News Feed for quick access.</div>}

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
            {m.status === "Live" && m.halfPrompt && (
              <div style={{ display: "grid", gap: 10, background: "#1c1509", border: "1.5px solid #E6B31E", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, color: "#E6B31E" }}>⏱ HALF TIME — the second half only starts when you say so.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => onHalfTime(m, true)}>☕ 10-min break</button>
                  <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onHalfTime(m, false)}>▶ Start second half</button>
                </div>
              </div>
            )}
            {m.status === "Live" && m.onBreak && (
              <div style={{ background: "#1c1509", border: "1.5px solid #E6B31E", borderRadius: 12, padding: 14, textAlign: "center" }}>
                <div style={{ fontWeight: 700, color: "#E6B31E" }}>☕ Half-time break</div>
                <div className="display" style={{ fontSize: 30, color: "#F5F0E1" }}>
                  {Math.floor(breakLeft(m) / 60)}:{String(breakLeft(m) % 60).padStart(2, "0")}
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={() => onHalfTime(m, false)}>Skip break — start second half now</button>
              </div>
            )}
            {m.status === "Live" && !m.halfPrompt && !m.onBreak && (
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
                        <div style={{ fontSize: 11, color: "#8FA396", marginBottom: 4 }}>⚽ Who scored for {m.teamA.name}?</div>
                        <select className="input" value={scorerA} onChange={(e) => setScorerA(e.target.value)}>
                          <option value="">Select scorer…</option>
                          {rosterNames(m.playersA).map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    )}
                    {lb !== "" && +lb > (m.liveB ?? 0) && (
                      <div>
                        <div style={{ fontSize: 11, color: "#8FA396", marginBottom: 4 }}>⚽ Who scored for {m.teamB.name}?</div>
                        <select className="input" value={scorerB} onChange={(e) => setScorerB(e.target.value)}>
                          <option value="">Select scorer…</option>
                          {rosterNames(m.playersB).map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
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

            {/* SCORE SUBMISSION REQUEST — appears at full time */}
            {m.status === "AwaitingScore" && (
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
                <input className="input" placeholder={`${m.teamA.name} goal scorers (e.g. Tunde x2, Kola)`} maxLength={150} value={scorersA} onChange={(e) => setScorersA(e.target.value)} />
                <input className="input" placeholder={`${m.teamB.name} goal scorers`} maxLength={150} value={scorersB} onChange={(e) => setScorersB(e.target.value)} />
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
            )}

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

function LiveMatchView({ m, me, minute, timeline, alertsOn, onToggleAlerts, onShare, onClose }) {
  const [commentary, setCommentary] = useState([]);
  const [watching, setWatching] = useState(1);
  const rosterNames = (str) => {
    const list = (str || "").split(",").map((s) => s.trim()).filter(Boolean);
    return list.length ? list : Array.from({ length: 7 }, (_, i) => `Player ${i + 1}`);
  };

  /* Real "Watching" count — presence channel scoped to this exact match.
     Counts only people who genuinely have this match's Live view open right now. */
  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel(`watch-${m.id}`, { config: { presence: { key: me.id } } });
    ch.on("presence", { event: "sync" }, () => {
      setWatching(Math.max(1, Object.keys(ch.presenceState()).length));
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED") await ch.track({ at: Date.now() });
    });
    return () => { supabase.removeChannel(ch); };
  }, [m.id, me && me.id]);

  useEffect(() => {
    setCommentary([]);
    if (m.status !== "Live" || m.onBreak) return;
    const fire = () => setCommentary((c) => [{ id: "c" + Date.now(), text: genCommentary(m, rosterNames), min: minute(m), ts: Date.now() }, ...c].slice(0, 12));
    const t = setInterval(fire, 22000 + Math.random() * 14000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, m.status, m.onBreak, m.playersA, m.playersB]);

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
    ...timeline.map((e) => { const s = splitMinute(e.message); return { id: e.id, text: s.text, min: s.min, ts: new Date(e.created_at).getTime(), kind: "event" }; }),
    ...commentary.map((c) => ({ id: c.id, text: c.text, min: c.min, ts: c.ts, kind: "commentary" })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 80, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 460, width: "100%", padding: 0, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #243128" }}>
          <button className="btn btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}>‹</button>
          <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.teamA.name} vs {m.teamB.name}</div>
            <div style={{ fontSize: 10, color: "#8FA396", letterSpacing: ".1em" }}>{(m.location || "").toUpperCase()}</div>
          </div>
          <span style={{ width: 30 }} />
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
          <a href={m.streamUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #243128", textDecoration: "none", background: "rgba(232,68,46,.08)" }}>
            <span className="chip pulse" style={{ background: T.live, color: "#fff", flexShrink: 0 }}>🔴 LIVE</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.chalk }}>
                {/facebook\.com|fb\.watch/.test(m.streamUrl) ? "Watching live on Facebook" : "Watching live"}
              </div>
              <div style={{ fontSize: 11, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>The captain is streaming this match — tap to watch →</div>
            </div>
          </a>
        )}

        <div style={{ display: "flex", borderBottom: "1px solid #243128" }}>
          <div style={{ flex: 1, textAlign: "center", padding: "12px 4px", borderRight: "1px solid #243128" }}>
            <div className="display" style={{ fontSize: 18, color: T.floodlight }}>👀 {watching}</div>
            <div style={{ fontSize: 10, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase" }}>Watching</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "12px 4px" }}>
            <div className="display" style={{ fontSize: 18, color: T.floodlight }}>{(m.liveA ?? 0) + (m.liveB ?? 0)}</div>
            <div style={{ fontSize: 10, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase" }}>Goals</div>
          </div>
        </div>

        <div style={{ fontSize: 11, letterSpacing: ".15em", color: T.muted, textTransform: "uppercase", padding: "14px 16px 6px" }}>Match timeline</div>
        <div style={{ display: "grid", gap: 8, padding: "0 16px 16px", maxHeight: 340, overflowY: "auto" }}>
          {feed.length === 0 && <div style={{ fontSize: 13, color: T.muted }}>Events will appear here as the match unfolds.</div>}
          {feed.map((e) => {
            const { lead, rest } = e.kind === "event" ? splitLeadIn(e.text) : { lead: null, rest: e.text };
            return (
              <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#161E19", border: "1px solid #243128", borderRadius: 12, padding: "10px 12px" }}>
                {e.min !== null && e.min !== undefined && (
                  <span className="display" style={{ fontSize: 13, color: T.floodlight, background: "rgba(230,179,30,.1)", borderRadius: 8, padding: "3px 7px", flexShrink: 0, minWidth: 32, textAlign: "center" }}>{e.min}'</span>
                )}
                <span style={{ fontSize: 13, color: T.chalk, paddingTop: 1 }}>
                  {e.kind === "commentary" ? (
                    <>🎙 {rest}</>
                  ) : lead ? (
                    <><b style={{ color: T.floodlight }}>{lead}</b>{rest}</>
                  ) : rest}
                </span>
              </div>
            );
          })}
        </div>

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
              <div key={f.id} className="card" style={{ fontSize: 13, color: "#F5F0E1" }}>{f.message}</div>
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
function ProfilePage({ me, stats, onSave, notify }) {
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
    <div style={{ maxWidth: 560 }}>
      <div className="display" style={{ fontSize: 24, marginBottom: 16 }}>My Profile</div>

      {/* Identity card */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#14532D", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 28, color: "#E6B31E", border: "2px solid rgba(255,212,71,.4)", flexShrink: 0 }}>
          {me.name.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{me.name}</div>
          <div style={{ fontSize: 13, color: "#8FA396" }}>{me.contact}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <span className="chip" style={{ background: "#14532D", color: "#E6B31E" }}>{me.role}</span>
            <span className="chip" style={{ background: "#243128", color: "#F5F0E1" }}>Joined {me.joined}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="feedgrid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 14 }}>
        {[stats.a, stats.b, stats.c].map(([label, val]) => (
          <div key={label} className="card" style={{ textAlign: "center", padding: 12 }}>
            <div style={{ fontSize: 10, color: "#8FA396", letterSpacing: ".05em", textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
            <div className="display" style={{ fontSize: 20, color: "#E6B31E" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Captain team-join contact */}
      {me.role === "Captain" && (
        <div className="card" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 14, color: "#E6B31E" }}>📞 Team Contact (shown to fans)</div>
          <div style={{ fontSize: 12, color: "#8FA396" }}>Drop your phone/WhatsApp number so fans who want to join your team can reach you. Shown on your captain profile.</div>
          <input className="input" maxLength={60} placeholder="e.g. WhatsApp 0803 123 4567" value={contactInfo} onChange={(e) => setContactInfo(sanitizeText(e.target.value, 60))} />
          <button className="btn btn-gold" onClick={() => { onSave({ contactInfo }); notify("Team contact updated ✔ Fans can now see it on your profile."); }}>Save contact</button>
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
  );
}

function CreateMatch({ onSave, onCancel }) {
  const [f, setF] = useState({
    teamAName: "", teamAColor: "#E6B31E", teamBName: "", teamBColor: "#1DB954",
    badgeA: "⚽", badgeB: "🦁",
    playersA: "", playersB: "", location: "", date: "", time: "", duration: 90,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.teamAName && f.teamBName && f.location && f.date && f.time;
  const [wantsStream, setWantsStream] = useState(null); // null | "no" | "yes"
  const [streamInput, setStreamInput] = useState("");
  const [streamHelpOpen, setStreamHelpOpen] = useState(false);
  const streamValid = isValidStreamUrl(streamInput.trim());

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div className="display" style={{ fontSize: 18, color: "#E6B31E" }}>Create Match</div>
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
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#8FA396", marginRight: 4 }}>Badge:</span>
        {BADGES.map((b) => <button key={"b" + b} className={`btn ${f.badgeB === b ? "btn-gold" : "btn-ghost"}`} style={{ padding: "5px 7px", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setF({ ...f, badgeB: b })}><MiniLogo team={{ name: "", color: f.badgeB === b ? "#1a1405" : "#3a4a3e" }} badge={b} size={24} /></button>)}
      </div>
      <input className="input" placeholder="Location (e.g. Campos Mini Stadium)" maxLength={60} value={f.location} onChange={(e) => setF({ ...f, location: sanitizeText(e.target.value, 60) })} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4, fontWeight: 700 }}>📅 Match date</div>
          <input className="input" type="date" value={f.date} onChange={set("date")} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#8FA396", marginBottom: 4, fontWeight: 700 }}>🕐 Kick-off time</div>
          <input className="input" type="time" value={f.time} onChange={set("time")} />
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
          <text x="110" y="257" textAnchor="middle" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="15">{m.teamA.name}</text>
          <text x="290" y="257" textAnchor="middle" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="15">{m.teamB.name}</text>

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
                  <text x="110" y="420" textAnchor="middle" fill="#F5F0E1" opacity="0.85" fontFamily="Space Grotesk, sans-serif" fontSize="10">⚽ {(m.scorersA || "—").slice(0, 34)}</text>
                  <text x="290" y="420" textAnchor="middle" fill="#F5F0E1" opacity="0.85" fontFamily="Space Grotesk, sans-serif" fontSize="10">⚽ {(m.scorersB || "—").slice(0, 34)}</text>
                </>
              )}
              <text x="200" y="440" textAnchor="middle" fill="#F5F0E1" opacity="0.75" fontFamily="Space Grotesk, sans-serif" fontSize="11">📍 {m.location} · {fmtDate(m.date)}</text>
            </>
          ) : (
            <>
              <rect x="60" y="315" width="280" height="2" fill="#E6B31E" opacity="0.5" />
              <text x="200" y="345" textAnchor="middle" fill="#E6B31E" fontFamily="Anton, sans-serif" fontSize="15">{fmtDate(m.date)}  ·  {m.time}</text>
              <text x="200" y="368" textAnchor="middle" fill="#F5F0E1" fontFamily="Space Grotesk, sans-serif" fontSize="13">📍 {m.location}</text>
              {/* LINE-UPS — for fans sharing before kick-off */}
              {(() => {
                const names = (str) => (str || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 6);
                const nA = names(m.playersA), nB = names(m.playersB);
                const extraA = Math.max(0, (m.playersA || "").split(",").filter((x) => x.trim()).length - 6);
                const extraB = Math.max(0, (m.playersB || "").split(",").filter((x) => x.trim()).length - 6);
                if (nA.length === 0 && nB.length === 0) return null;
                return (
                  <>
                    <text x="110" y="392" textAnchor="middle" fill="#E6B31E" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="10" letterSpacing="1">LINE-UP</text>
                    <text x="290" y="392" textAnchor="middle" fill="#E6B31E" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="10" letterSpacing="1">LINE-UP</text>
                    {nA.map((p, i) => (
                      <text key={"a" + i} x="110" y={404 + i * 11} textAnchor="middle" fill="#F5F0E1" opacity="0.85" fontFamily="Space Grotesk, sans-serif" fontSize="9.5">{p.slice(0, 20)}</text>
                    ))}
                    {extraA > 0 && <text x="110" y={404 + nA.length * 11} textAnchor="middle" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="9">+{extraA} more</text>}
                    {nB.map((p, i) => (
                      <text key={"b" + i} x="290" y={404 + i * 11} textAnchor="middle" fill="#F5F0E1" opacity="0.85" fontFamily="Space Grotesk, sans-serif" fontSize="9.5">{p.slice(0, 20)}</text>
                    ))}
                    {extraB > 0 && <text x="290" y={404 + nB.length * 11} textAnchor="middle" fill="#8FA396" fontFamily="Space Grotesk, sans-serif" fontSize="9">+{extraB} more</text>}
                  </>
                );
              })()}
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
