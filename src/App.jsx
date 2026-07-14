import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

/* ---------- DB row ⇄ app shape ---------- */
const rowToMatch = (r) => ({
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
  halfPrompt: r.status === "Live" && !r.running && !r.on_break && r.elapsed_seconds >= ((r.duration_minutes || 90) * 30) && !r.second_half,
});

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
  return out;
};

/* ============================================================
   MATCHDAY — Community Football Website
   Flow: Captain creates → starts 90-min timer → at FULL TIME the
   site REQUESTS the final score from the captain → captain submits
   → result is published to the News Feed and bets are settled
   based on the captain's submitted score.
   Roles: Captain / Fan / Admin. Demo wallet = virtual coins.
   Demo OTP is always 1234.
   ============================================================ */

const T = {
  turf: "#0E4D3A",
  turfDeep: "#08301F",
  floodlight: "#FFD447",
  chalk: "#FAF7EF",
  night: "#10131A",
  live: "#E4572E",
  muted: "#7A8B83",
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
const DEFAULT_ODDS = { A: 1.8, Draw: 3.0, B: 1.8 };


export default function App() {
  const [screen, setScreen] = useState("auth");
  const [authStep, setAuthStep] = useState("form");
  const [authMode, setAuthMode] = useState("signup");
  const [form, setForm] = useState({ contact: "", name: "", role: "Fan", otp: "", password: "", password2: "" });
  const [rememberMe, setRememberMe] = useState(true);
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [users, setUsers] = useState([]);
  const [me, setMe] = useState(null);
  const [wallets, setWallets] = useState({});
  const [matches, setMatches] = useState([]);
  const [bets, setBets] = useState([]);
  const [page, setPage] = useState("feed"); // feed | mymatches | create | wallet | admin
  const [openMatch, setOpenMatch] = useState(null);
  const [betSlipFor, setBetSlipFor] = useState(null);
  const [viewCaptain, setViewCaptain] = useState(null);
  const [comingSoon, setComingSoon] = useState(null); // feature name or null
  const [feedbacks, setFeedbacks] = useState([]);
  const [follows, setFollows] = useState([]); // captain ids I follow
  const [adminPosts, setAdminPosts] = useState([]);
  const [adminPostText, setAdminPostText] = useState("");
  const [posterFor, setPosterFor] = useState(null);
  const [toast, setToast] = useState(null);
  const [demoSpeed, setDemoSpeed] = useState(false); // real time by default
  const [now, setNow] = useState(Date.now());
  const alertsFired = useRef({});

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3600); };

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  /* ---------- SESSION: restore login, react to auth changes ---------- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) loadMe(session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) loadMe(session.user.id);
      else { setMe(null); setScreen("auth"); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadMe = async (userId) => {
    const { data: p } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (!p) return;
    const meObj = { id: p.id, name: p.name, role: p.role, pin: p.pin, contactInfo: p.contact_info || "", joined: (p.created_at || "").slice(0, 10), contact: (await supabase.auth.getUser()).data.user?.email || "" };
    setMe(meObj);
    setScreen("site");
    setPage(p.role === "Admin" ? "admin" : "feed");
    refreshAll(meObj);
  };

  const refreshAll = async (meObj = me) => {
    if (!meObj) return;
    const [{ data: ms }, { data: w }, { data: bs }, { data: us }] = await Promise.all([
      supabase.from("matches").select("*").order("created_at", { ascending: false }),
      supabase.from("wallets").select("*").eq("user_id", meObj.id).single().then((r) => ({ data: r.data ? [r.data] : [] })),
      supabase.from("bets").select("*").eq("user_id", meObj.id),
      supabase.from("profiles").select("id, name, role, created_at, contact_info"),
    ]);
    const { data: fl } = await supabase.from("follows").select("captain_id").eq("fan_id", meObj.id);
    if (fl) setFollows(fl.map((x) => x.captain_id));
    const { data: ps } = await supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(20);
    if (ps) setAdminPosts(ps);
    if (ms) setMatches(ms.map(rowToMatch));
    if (w && w[0]) setWallets({ [meObj.id]: Number(w[0].balance) });
    if (bs) setBets(bs.map((b) => ({ id: b.id, userId: b.user_id, matchId: b.match_id, pick: b.pick, stake: Number(b.stake), odds: Number(b.odds), settled: b.settled, won: b.won })));
    if (us) setUsers(us.map((u) => ({ id: u.id, name: u.name, role: u.role, contact: "", contactInfo: u.contact_info || "", pin: null, joined: (u.created_at || "").slice(0, 10) })));
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
            if (i === -1) return [m, ...ms];
            const next = [...ms]; next[i] = m; return next;
          });
        }
      })
      .subscribe();
    const poll = setInterval(() => refreshAll(), 30000); // safety net
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
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

  /* ---------- TIMER: at 90' status becomes AwaitingScore and the
     site requests the final score from the captain ---------- */
  const pushCounter = useRef({});
  useEffect(() => {
    const iv = setInterval(() => {
      setMatches((ms) =>
        ms.map((m) => {
          if (m.status !== "Live") return m;
          const iAmCaptain = me && m.createdBy === me.id;
          const step = demoSpeed && iAmCaptain ? 60 : 1;

          /* Half-time break countdown */
          if (m.onBreak) {
            const left = Math.max(0, m.breakRemaining - step);
            if (!iAmCaptain) return { ...m, breakRemaining: left }; // fans: local display only
            if (left === 0) {
              notify(`▶ SECOND HALF — ${m.teamA.name} vs ${m.teamB.name}. Break over, timer resumed.`);
              patchMatch(m.id, { onBreak: false, breakRemaining: 0, running: true, secondHalf: true });
              return m;
            }
            pushCounter.current[m.id] = (pushCounter.current[m.id] || 0) + 1;
            if (pushCounter.current[m.id] % 15 === 0) patchMatch(m.id, { breakRemaining: left });
            return { ...m, breakRemaining: left };
          }

          if (!m.running) return m;
          const FULL = (m.duration || 90) * 60, HALF = FULL / 2;
          const next = Math.min(m.elapsed + step, FULL);

          /* Fans interpolate the clock locally between realtime updates */
          if (!iAmCaptain) return { ...m, elapsed: next };

          if (!alertsFired.current[m.id]) alertsFired.current[m.id] = {};

          /* 45' — pause and ask the captain about a half-time break */
          if (next >= HALF && !m.secondHalf && !alertsFired.current[m.id].half) {
            alertsFired.current[m.id].half = true;
            notify(`⏱ HALF TIME — ${m.teamA.name} vs ${m.teamB.name}. Captain: take a 10-minute break?`);
            patchMatch(m.id, { elapsed: HALF, running: false, halfPrompt: true });
            return { ...m, elapsed: HALF, running: false, halfPrompt: true };
          }

          if (next >= FULL && !alertsFired.current[m.id].full) {
            alertsFired.current[m.id].full = true;
            notify(`🏁 FULL TIME — ${m.teamA.name} vs ${m.teamB.name}. Captain, please submit the final score.`);
            patchMatch(m.id, { elapsed: next, running: false, status: "AwaitingScore" });
            return { ...m, elapsed: next, running: false, status: "AwaitingScore" };
          }

          /* Throttled push: every 15 ticks the true clock syncs to the database */
          pushCounter.current[m.id] = (pushCounter.current[m.id] || 0) + 1;
          if (pushCounter.current[m.id] % 15 === 0) patchMatch(m.id, { elapsed: next });
          return { ...m, elapsed: next };
        })
      );
    }, 1000);
    return () => clearInterval(iv);
  }, [demoSpeed, me]);

  /* ---------- AUTH ---------- */
  const submitAuth = async () => {
    const email = form.contact.trim().toLowerCase();
    if (!email) return notify("Enter your email address");
    if (!isValidEmail(email)) return notify("Please enter a valid email address (e.g. name@example.com)");

    if (authMode === "signup") {
      if (!form.name.trim() || !/^[A-Za-z ]{2,30}$/.test(form.name.trim())) return notify("Name can only contain letters (2–30 characters)");
      if (!isStrongPassword(form.password)) return notify("Password must be 8+ characters with letters and numbers");
      if (form.password !== form.password2) return notify("Passwords don't match");
      // Create the account with a password; a one-time email code verifies it
      const { error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: { data: { name: sanitizeText(form.name, 30).trim(), role: form.role } },
      });
      if (error) return notify(error.message);
      setForm({ ...form, contact: email });
      setOtpAttempts(0);
      setAuthStep("otp");
      notify(`📧 We emailed a 6-digit code to ${email} to verify your account`);
    } else {
      // Log in with password — no code needed
      if (!form.password) return notify("Enter your password");
      const { error } = await supabase.auth.signInWithPassword({ email, password: form.password });
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

  const verifyOtp = async () => {
    if (Date.now() < lockedUntil) {
      return notify(`Too many wrong codes. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s`);
    }
    if (!/^\d{6}$/.test(form.otp)) return notify("The code is 6 digits");
    const { error } = await supabase.auth.verifyOtp({ email: form.contact, token: form.otp, type: "signup" });
    if (error) {
      // some projects issue 'email' type codes instead of 'signup'
      const retry = await supabase.auth.verifyOtp({ email: form.contact, token: form.otp, type: "email" });
      if (retry.error) {
        const tries = otpAttempts + 1;
        setOtpAttempts(tries);
        if (tries >= MAX_OTP_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
          setOtpAttempts(0);
          return notify(`Too many wrong codes — locked for ${LOCKOUT_SECONDS} seconds`);
        }
        return notify(`Wrong or expired code (${MAX_OTP_ATTEMPTS - tries} attempts left)`);
      }
    }
    setForm({ contact: "", name: "", role: "Fan", otp: "", password: "", password2: "" });
    setAuthStep("form");
  };

  const forgotPassword = async () => {
    const email = form.contact.trim().toLowerCase();
    if (!isValidEmail(email)) return notify("Enter your email above first, then tap Forgot password");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) return notify(error.message);
    notify(`📧 Password reset link sent to ${email} — open it on this device`);
  };

  const logout = async () => { await supabase.auth.signOut(); setMe(null); setScreen("auth"); setOpenMatch(null); };

  useEffect(() => {
    if (rememberMe) return;
    const h = () => { supabase.auth.signOut(); };
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, [rememberMe]);

  /* ---------- MATCH ACTIONS ---------- */
  /* Optimistic local update + database write; realtime confirms for everyone */
  const patchMatch = (id, patch) => {
    setMatches((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
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
    patchMatch(m.id, { status: "Live", running: true });
    notify(`🟢 KICK OFF — ${m.teamA.name} vs ${m.teamB.name}`);
  };

  /* Captain submits final score → result published to feed → bets settle */
  const submitFinalScore = async (m, a, b, shootout = false, pa = 0, pb = 0, scorersA = "", scorersB = "") => {
    const { error } = await supabase.rpc("submit_result", {
      p_match_id: m.id, p_final_a: a, p_final_b: b,
      p_shootout: shootout, p_pens_a: shootout ? pa : null, p_pens_b: shootout ? pb : null,
    });
    if (error) return notify(error.message);
    await supabase.from("matches").update({ scorers_a: sanitizeText(scorersA, 150), scorers_b: sanitizeText(scorersB, 150) }).eq("id", m.id);
    const result = a > b ? "A" : b > a ? "B" : "Draw";
    const pensWinner = shootout ? (pa > pb ? "A" : pb > pa ? "B" : null) : null;
    const winnerText = pensWinner
      ? `${pensWinner === "A" ? m.teamA.name : m.teamB.name} win ${pa}–${pb} on penalties`
      : result === "Draw" ? "It ended in a draw" : `${result === "A" ? m.teamA.name : m.teamB.name} win`;
    notify(`📰 RESULT PUBLISHED: ${m.teamA.name} ${a}–${b} ${m.teamB.name}. ${winnerText}.`);
    refreshAll();
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

  const cancelBet = async (bet) => {
    const { error } = await supabase.rpc("cancel_bet", { p_bet_id: bet.id });
    if (error) return notify(error.message);
    notify(`Bet cancelled — ₦${bet.stake.toLocaleString()} refunded to your wallet`);
    refreshAll();
  };

  const placeBet = async (match, pick, stake) => {
    const { error } = await supabase.rpc("place_bet", { p_match_id: match.id, p_pick: pick, p_stake: stake });
    if (error) return notify(error.message);
    notify(`Bet placed: ₦${stake.toLocaleString()} on ${pick === "Draw" ? "Draw" : pick === "A" ? match.teamA.name : match.teamB.name}`);
    refreshAll();
  };

  const minute = (m) => Math.min(m.duration || 90, Math.floor(m.elapsed / 60));
  const myBal = me ? wallets[me.id] || 0 : 0;
  const pendingScores = me ? matches.filter((m) => m.status === "AwaitingScore" && m.createdBy === me.id) : [];

  /* ============================================================ STYLES */
  const css = `
    ${FONT}
    * { box-sizing: border-box; margin: 0; }
    .md-root { min-height: 100vh; background: ${T.night}; color: ${T.chalk}; font-family: 'Space Grotesk', sans-serif; }
    .display { font-family: 'Anton', sans-serif; letter-spacing: .02em; text-transform: uppercase; }
    .btn { border: 0; cursor: pointer; font-family: 'Space Grotesk', sans-serif; font-weight: 700; border-radius: 10px; padding: 12px 18px; font-size: 15px; transition: transform .08s; }
    .btn:active { transform: scale(.97); }
    .btn-gold { background: ${T.floodlight}; color: ${T.night}; }
    .btn-turf { background: ${T.turf}; color: ${T.chalk}; }
    .btn-ghost { background: transparent; color: ${T.chalk}; border: 1.5px solid #2c352f; }
    .btn-live { background: ${T.live}; color: #fff; }
    .input { width: 100%; padding: 13px 14px; border-radius: 10px; border: 1.5px solid #2c352f; background: #171c22; color: ${T.chalk}; font-size: 15px; font-family: 'Space Grotesk', sans-serif; outline: none; }
    .input:focus { border-color: ${T.floodlight}; }
    .card { background: #161b17; border: 1px solid #232b25; border-radius: 16px; padding: 18px; }
    .chip { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .scoreboard { background: ${T.turfDeep}; border: 2px solid ${T.turf}; border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pulse { animation: pulse 1.2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
    .topnav { display: flex; gap: 4px; }
    .topnav button { background: none; border: 0; color: ${T.muted}; font-family: 'Space Grotesk'; font-weight: 700; font-size: 14px; padding: 10px 16px; cursor: pointer; border-radius: 8px; }
    .topnav button.on { color: ${T.night}; background: ${T.floodlight}; }
    .topnav button:hover:not(.on) { color: ${T.chalk}; }
    .feedgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .hero { background: linear-gradient(160deg, ${T.turfDeep}, ${T.night}); border: 1px solid #232b25; border-radius: 20px; padding: 36px; margin-bottom: 24px; }
    .hero-title { font-size: 38px; line-height: 1.1; color: ${T.chalk}; }
    .banner { background: ${T.live}; color: #fff; border-radius: 12px; padding: 14px 18px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none } }
    .md-root { overflow-x: hidden; }
    .user-pill { display: flex; align-items: center; gap: 9px; }
    .user-pill-clickable { cursor: pointer; padding: 4px 8px; border-radius: 999px; border: 1px solid #2c352f; transition: all .12s; }
    .user-pill-clickable:hover { border-color: ${T.floodlight}; background: #161b17; }
    .user-pill-clickable:active { transform: scale(.97); }
    .user-avatar-simple { width: 36px; height: 36px; border-radius: 50%; background: ${T.turf}; display: flex; align-items: center; justify-content: center; font-family: 'Anton', sans-serif; font-size: 15px; color: ${T.floodlight}; flex-shrink: 0; border: 1.5px solid rgba(255, 212, 71, .4); }
    .user-logout { width: 30px; height: 30px; border-radius: 50%; border: 1px solid #2c352f; background: transparent; color: ${T.muted}; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all .12s; }
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

  /* ============================================================ AUTH */
  if (screen === "auth") {
    return (
      <div className="md-root" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px" }}>
        <style>{css}</style>
        <div style={{ maxWidth: 440, width: "100%" }}>
          <div className="display" style={{ fontSize: 52, color: T.floodlight, lineHeight: 1 }}>MatchDay</div>
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
              <input className="input" type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} placeholder={authMode === "signup" ? "Create password (8+ letters & numbers)" : "Password"} maxLength={64} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 64) })} />
              {authMode === "signup" && (
                <input className="input" type="password" autoComplete="new-password" placeholder="Confirm password" maxLength={64} value={form.password2} onChange={(e) => setForm({ ...form, password2: e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 64) })} />
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
                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                    ⚽ <b>Captains</b> host matches, run the timer, and publish the official scores — so captain accounts cannot place bets. 📣 <b>Fans</b> follow matches and bet from their wallet.
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
              <button className="btn btn-gold" onClick={submitAuth}>{authMode === "signup" ? "Create account" : "Log in"}</button>
              <div style={{ fontSize: 12, color: T.muted }}>
                🔒 {authMode === "signup"
                  ? "We'll email you a one-time code to verify your account. Your password is stored encrypted — we can never read it."
                  : "Protected by attempt lockouts and encrypted passwords."}
              </div>
            </div>
          ) : (
            <div className="card" style={{ display: "grid", gap: 12 }}>
              <div style={{ fontWeight: 700 }}>Verify your account — enter the code sent to {form.contact}</div>
              <div style={{ fontSize: 13, color: T.floodlight }}>Check your inbox (and spam folder) for the code.</div>
              <input className="input" type="password" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" maxLength={6} value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, "") })} />
              <div style={{ fontSize: 11, color: T.muted }}>🔒 Codes are single-use and entry locks after {MAX_OTP_ATTEMPTS} wrong attempts.</div>
              <button className="btn btn-gold" onClick={verifyOtp}>Verify & create account</button>
              <button className="btn btn-ghost" onClick={() => setAuthStep("form")}>Back</button>
            </div>
          )}
        </div>
        {toast && <Toast msg={toast} />}
      </div>
    );
  }

  /* ============================================================ WEBSITE */
  const published = matches.filter((m) => m.published);
  const upcoming = published.filter((m) => m.status === "Scheduled");
  const liveNow = published.filter((m) => m.status === "Live" || m.status === "AwaitingScore");
  const results = published.filter((m) => m.status === "ResultPublished");
  const mine = matches.filter((m) => m.createdBy === me.id);
  const myBets = bets.filter((b) => b.userId === me.id);

  return (
    <div className="md-root">
      <style>{css}</style>

      {/* ---------- TOP NAV (website header) ---------- */}
      <header style={{ borderBottom: "1px solid #232b25", position: "sticky", top: 0, background: T.night, zIndex: 40 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 12 }}>
            <div className="display" style={{ fontSize: 26, color: T.floodlight }}>MatchDay</div>
            <div className={`user-pill ${me.role !== "Admin" ? "user-pill-clickable" : ""}`} title="View profile" onClick={() => me.role !== "Admin" && setPage("profile")}>
              <div className="user-avatar-simple">{me.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{me.name}{me.role !== "Admin" && <span style={{ color: T.muted, fontWeight: 400 }}> ›</span>}</div>
                {me.role !== "Admin" && <div style={{ fontSize: 11, color: T.floodlight, fontWeight: 700, lineHeight: 1.2 }}>₦{myBal.toLocaleString()}</div>}
              </div>
              <button className="user-logout" title="Log out" onClick={(e) => { e.stopPropagation(); logout(); }}>⏻</button>
            </div>
          </div>
          <nav className="topnav">
            <button className={page === "feed" ? "on" : ""} onClick={() => setPage("feed")}>News Feed</button>
            {me.role !== "Admin" && <button className={page === "captains" ? "on" : ""} onClick={() => { setPage("captains"); setViewCaptain(null); }}>Captains</button>}
            {me.role === "Fan" && <button className={page === "bets" ? "on" : ""} onClick={() => setPage("bets")}>Bets{myBets.length > 0 ? ` (${myBets.length})` : ""}</button>}
            {me.role === "Captain" && <button className={page === "mymatches" || page === "create" ? "on" : ""} onClick={() => setPage("mymatches")}>My Matches</button>}
            {me.role !== "Admin" && <button className={page === "wallet" ? "on" : ""} onClick={() => setPage("wallet")}>Wallet</button>}
            {me.role === "Admin" && <button className={page === "admin" ? "on" : ""} onClick={() => setPage("admin")}>Admin</button>}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px 60px" }}>

        {/* KICK-OFF PERMISSION BANNER — scheduled time is due, captain decides */}
        {me.role === "Captain" && matches.filter((m) => m.status === "Scheduled" && m.createdBy === me.id && isDue(m)).map((m) => (
          <div key={"ko-" + m.id} className="banner" style={{ marginBottom: 16, background: "#0E4D3A" }}>
            <span>⚽ Kick-off time reached: {m.teamA.name} vs {m.teamB.name} ({m.time}). The match starts only when you say so.</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-gold" style={{ padding: "8px 14px" }} onClick={() => startMatch(m)}>▶ Start match</button>
              <button className="btn btn-ghost" style={{ padding: "8px 14px", borderColor: "rgba(255,255,255,.35)", color: "#fff" }} onClick={() => setOpenMatch(m.id)}>📅 Postpone</button>
            </div>
          </div>
        ))}

        {/* SCORE REQUEST BANNER — the site requests the final score */}
        {pendingScores.map((m) => (
          <div key={m.id} className="banner" style={{ marginBottom: 16 }}>
            <span>🏁 Full time: {m.teamA.name} vs {m.teamB.name}. Submit the final score to publish the result.</span>
            <button className="btn btn-gold" style={{ padding: "8px 14px" }} onClick={() => setOpenMatch(m.id)}>Submit final score</button>
          </div>
        ))}

        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: T.muted, marginBottom: 18 }}>
          <input type="checkbox" checked={demoSpeed} onChange={(e) => setDemoSpeed(e.target.checked)} />
          Testing mode: fast timer (1 second = 1 match minute). Leave off for real-time matches.
        </label>

        {/* ---------- NEWS FEED (homepage) ---------- */}
        {page === "feed" && (
          <>
            <div className="hero">
              <div className="display hero-title">
                Your community.<br /><span style={{ color: T.floodlight }}>Your matches. Live.</span>
              </div>
              <div style={{ color: T.muted, marginTop: 10, maxWidth: 520 }}>
                Follow published matches from local captains, watch scores update in real time, and back your team from your wallet. Results go live the moment the captain submits the final score.
              </div>
            </div>

            {/* Admin announcements */}
            {adminPosts.length > 0 && adminPosts.slice(0, 3).map((p) => (
              <div key={p.id} className="card" style={{ marginBottom: 12, borderColor: "#FFD447", borderWidth: 1.5 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span className="chip" style={{ background: T.floodlight, color: T.night }}>📢 MatchDay</span>
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
                    {followed.map((m) => <MatchCard key={"f" + m.id} m={m} minute={minute} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} onPlaceBet={() => setComingSoon("Betting")} canBetHint={me.role === "Fan" && (m.status === "Scheduled" || m.status === "Live")} myBetCount={0} />)}
                  </div>
                </>
              ) : null;
            })()}

            {liveNow.length > 0 && (
              <>
                <SectionTitle color={T.live}>● Live Now</SectionTitle>
                <div className="feedgrid" style={{ marginBottom: 28 }}>
                  {liveNow.map((m) => <MatchCard key={m.id} m={m} minute={minute} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} onPlaceBet={() => setComingSoon("Betting")} canBetHint={me.role === "Fan" && (m.status === "Scheduled" || m.status === "Live")} myBetCount={bets.filter((b) => b.userId === me.id && b.matchId === m.id).length} />)}
                </div>
              </>
            )}

            <SectionTitle color={T.floodlight}>Upcoming Matches</SectionTitle>
            {upcoming.length === 0 && <div className="card" style={{ color: T.muted, marginBottom: 28 }}>No upcoming published matches yet.</div>}
            <div className="feedgrid" style={{ marginBottom: 28 }}>
              {upcoming.map((m) => <MatchCard key={m.id} m={m} minute={minute} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} onPlaceBet={() => setComingSoon("Betting")} canBetHint={me.role === "Fan" && (m.status === "Scheduled" || m.status === "Live")} myBetCount={bets.filter((b) => b.userId === me.id && b.matchId === m.id).length} />)}
            </div>

            <SectionTitle color={T.chalk}>Results</SectionTitle>
            {results.length === 0 && <div className="card" style={{ color: T.muted }}>No results published yet. Results appear here once captains submit final scores.</div>}
            <div className="feedgrid">
              {results.map((m) => <MatchCard key={m.id} m={m} minute={minute} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} onPlaceBet={() => setComingSoon("Betting")} canBetHint={me.role === "Fan" && (m.status === "Scheduled" || m.status === "Live")} myBetCount={bets.filter((b) => b.userId === me.id && b.matchId === m.id).length} />)}
            </div>
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
              {mine.map((m) => <MatchCard key={m.id} m={m} minute={minute} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} mineView myBetCount={0} />)}
            </div>
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
                  duration_minutes: data.duration, published: true,
                });
                if (error) return notify(error.message);
                setPage("mymatches");
                refreshAll();
                notify("Match saved ✔ It's live on the News Feed for everyone to see.");
              }}
            />
          </div>
        )}

        {/* ---------- WALLET ---------- */}
        {/* ---------- BETS ---------- */}
        {/* ---------- PROFILE ---------- */}
        {page === "profile" && me.role !== "Admin" && (
          <ProfilePage
            me={me}
            wallet={myBal}
            stats={me.role === "Captain"
              ? { a: ["Matches created", matches.filter((x) => x.createdBy === me.id).length], b: ["Published", matches.filter((x) => x.createdBy === me.id && x.published).length], c: ["Live now", matches.filter((x) => x.createdBy === me.id && x.status === "Live").length] }
              : { a: ["Bets placed", myBets.length], b: ["Bets won", myBets.filter((x) => x.won).length], c: ["Total winnings", `₦${myBets.filter((x) => x.won).reduce((t, x) => t + Math.round(x.stake * x.odds), 0).toLocaleString()}`] }}
            onSave={updateProfile}
            notify={notify}
          />
        )}

        {/* ---------- CAPTAINS ---------- */}
        {page === "captains" && (
          <>
            {!viewCaptain ? (
              <>
                <div className="display" style={{ fontSize: 24, marginBottom: 6 }}>Captains</div>
                <div style={{ fontSize: 13, color: T.muted, marginBottom: 16 }}>Browse captains and find their matches. Tap a profile to see everything they've published.</div>
                <div className="feedgrid">
                  {users.filter((u) => u.role === "Captain").sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : 0)).map((c) => {
                    const theirs = matches.filter((x) => x.createdBy === c.id && x.published);
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
                          <span className="chip" style={{ background: "#232b25", color: T.floodlight }}>{publishedToday} match{publishedToday === 1 ? "" : "es"} today</span>
                          <span className="chip" style={{ background: "#232b25", color: T.chalk }}>{theirs.length} all-time</span>
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
              </>
            ) : (
              (() => {
                const c = users.find((u) => u.id === viewCaptain);
                const theirs = matches.filter((x) => x.createdBy === c.id && x.published);
                return (
                  <>
                    <button className="btn btn-ghost" style={{ marginBottom: 14, padding: "8px 14px", fontSize: 13 }} onClick={() => setViewCaptain(null)}>← All captains</button>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                      <div style={{ width: 60, height: 60, borderRadius: "50%", background: T.turf, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 26, color: T.floodlight }}>
                        {c.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="display" style={{ fontSize: 24 }}>{c.name}</div>
                        <div style={{ fontSize: 13, color: T.muted }}>{theirs.length} published match{theirs.length === 1 ? "" : "es"}</div>
                        {c.contactInfo && <div style={{ fontSize: 13, color: T.floodlight, marginTop: 4 }}>📞 Want to join the team? Contact: {c.contactInfo}</div>}
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
                      {theirs.filter((x) => x.status !== "ResultPublished").map((m) => <MatchCard key={m.id} m={m} minute={minute} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} onPlaceBet={() => setComingSoon("Betting")} canBetHint={me.role === "Fan" && (m.status === "Scheduled" || m.status === "Live")} myBetCount={0} />)}
                    </div>
                    {theirs.filter((x) => x.status === "ResultPublished").length > 0 && <SectionTitle color={T.chalk}>Past Games Record</SectionTitle>}
                    <div className="feedgrid">
                      {theirs.filter((x) => x.status === "ResultPublished").sort((a, b) => (a.date < b.date ? 1 : -1)).map((m) => <MatchCard key={m.id} m={m} minute={minute} onOpen={() => setOpenMatch(m.id)} onPoster={() => setPosterFor(m.id)} onPlaceBet={() => setComingSoon("Betting")} canBetHint={me.role === "Fan" && (m.status === "Scheduled" || m.status === "Live")} myBetCount={bets.filter((b) => b.userId === me.id && b.matchId === m.id).length} />)}
                    </div>
                  </>
                );
              })()
            )}
          </>
        )}

        {page === "bets" && me.role === "Fan" && (
          <div style={{ maxWidth: 560 }}>
            <div className="display" style={{ fontSize: 24, marginBottom: 16 }}>Bets</div>
            <ComingSoonCard
              feature="Betting"
              detail="Back your team with your wallet — pick a winner or draw at the captain's odds, manage your bet slip, and get paid out the moment results are published."
              onFeedback={async (msg) => { await supabase.from("feedback").insert({ user_id: me.id, feature: "Betting", message: msg }); notify("🙏 Thank you! Your feedback pushes this feature up our launch list."); }}
            />
          </div>
        )}

        {page === "wallet" && me.role !== "Admin" && (
          <div style={{ maxWidth: 560 }}>
            <div className="display" style={{ fontSize: 24, marginBottom: 16 }}>Wallet</div>
            <div className="card" style={{ textAlign: "center", padding: 30, marginBottom: 16 }}>
              <div style={{ color: T.muted, fontSize: 13 }}>Balance (demo coins)</div>
              <div className="display" style={{ fontSize: 44, color: T.floodlight }}>₦{myBal.toLocaleString()}</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn btn-turf" onClick={() => setComingSoon("Wallet funding")}>+ Top up</button>
                <button className="btn btn-ghost" onClick={() => setComingSoon("Withdrawals")}>↓ Withdraw</button>
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>Funding & withdrawals launch soon 🔜</div>
            </div>

            <div className="display" style={{ fontSize: 18, marginBottom: 10 }}>My Bets</div>
            {myBets.length === 0 && <div className="card" style={{ color: T.muted }}>No bets yet. Open a published match on the News Feed to place one.</div>}
            <div style={{ display: "grid", gap: 10 }}>
              {myBets.map((b) => {
                const m = matches.find((x) => x.id === b.matchId);
                const pickName = b.pick === "Draw" ? "Draw" : b.pick === "A" ? m.teamA.name : m.teamB.name;
                return (
                  <div key={b.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{m.teamA.name} vs {m.teamB.name}</div>
                      <div style={{ fontSize: 13, color: T.muted }}>₦{b.stake.toLocaleString()} on {pickName} @ {b.odds}x</div>
                    </div>
                    <span className="chip" style={{ background: b.settled ? (b.won ? T.turf : "#3a1f1a") : "#232b25", color: b.settled ? (b.won ? T.floodlight : T.live) : T.chalk }}>
                      {b.settled ? (b.won ? `Won ₦${Math.round(b.stake * b.odds).toLocaleString()}` : "Lost") : "Open"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------- ADMIN ---------- */}
        {page === "admin" && me.role === "Admin" && (
          <div style={{ maxWidth: 640 }}>
            <div className="display" style={{ fontSize: 24, marginBottom: 6 }}>Admin Panel</div>
            <div style={{ fontSize: 13, color: T.muted, marginBottom: 16 }}>
              Results are published from captain-submitted scores. Use this panel to correct a score if a dispute is raised — the correction re-runs payouts is not simulated here, so corrections are for record only in this demo.
            </div>

            <SectionTitle color={T.floodlight}>Published Results</SectionTitle>
            {matches.filter((m) => m.status === "ResultPublished").map((m) => (
              <div key={m.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{m.teamA.name} {m.finalA} – {m.finalB} {m.teamB.name}</div>
                  <div style={{ fontSize: 12, color: T.muted }}>{bets.filter((b) => b.matchId === m.id).length} bet(s) · settled</div>
                </div>
                <span className="chip" style={{ background: T.turf, color: T.floodlight }}>Published</span>
              </div>
            ))}

            <SectionTitle color={T.live}>Awaiting Captain Score</SectionTitle>
            {matches.filter((m) => m.status === "AwaitingScore").length === 0 && <div className="card" style={{ color: T.muted, marginBottom: 16 }}>No matches waiting on a captain's score.</div>}
            {matches.filter((m) => m.status === "AwaitingScore").map((m) => (
              <div key={m.id} className="card" style={{ marginBottom: 10, fontSize: 14 }}>
                {m.teamA.name} vs {m.teamB.name} — full time reached, captain has not yet submitted the score.
              </div>
            ))}

            {/* Site stats */}
            <div className="feedgrid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 18 }}>
              {[["Total users", users.length], ["Captains", users.filter((u) => u.role === "Captain").length], ["Fans", users.filter((u) => u.role === "Fan").length]].map(([l, v]) => (
                <div key={l} className="card" style={{ textAlign: "center", padding: 14 }}>
                  <div style={{ fontSize: 10, color: T.muted, letterSpacing: ".05em", textTransform: "uppercase", fontWeight: 700 }}>{l}</div>
                  <div className="display" style={{ fontSize: 26, color: T.floodlight }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Post to the news feed */}
            <div className="card" style={{ display: "grid", gap: 10, marginBottom: 18 }}>
              <div className="display" style={{ fontSize: 14, color: T.floodlight }}>📢 Post to News Feed</div>
              <textarea className="input" rows={3} maxLength={280} placeholder="Announcement for all users (e.g. Weekend tournament sign-ups open!)"
                value={adminPostText} onChange={(e) => setAdminPostText(sanitizeText(e.target.value, 280))} style={{ resize: "none", fontFamily: "'Space Grotesk', sans-serif" }} />
              <button className="btn btn-gold" disabled={!adminPostText.trim()} style={{ opacity: adminPostText.trim() ? 1 : .5 }}
                onClick={async () => {
                  const { error } = await supabase.from("posts").insert({ author_id: me.id, message: adminPostText.trim() });
                  if (error) return notify(error.message);
                  setAdminPostText("");
                  refreshAll();
                  notify("📢 Posted to the News Feed");
                }}>Post announcement</button>
            </div>

            <SectionTitle color={T.floodlight}>Feature Requests ({feedbacks.length})</SectionTitle>
            {feedbacks.length === 0 && <div className="card" style={{ color: T.muted, marginBottom: 16 }}>No feedback yet. Requests from the "coming soon" prompts land here.</div>}
            {feedbacks.map((f) => (
              <div key={f.id} className="card" style={{ marginBottom: 8, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span className="chip" style={{ background: "#232b25", color: T.floodlight }}>{f.feature}</span>
                  <span style={{ color: T.muted, fontSize: 11 }}>{users.find((u) => u.id === f.userId)?.name || "User"}</span>
                </div>
                <div style={{ color: T.chalk }}>{f.msg}</div>
              </div>
            ))}

            <SectionTitle color={T.chalk}>Users</SectionTitle>
            <div style={{ display: "grid", gap: 8 }}>
              {users.map((u) => (
                <div key={u.id} className="card" style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: 12 }}>
                  <span>{u.name} <span style={{ color: T.muted }}>· joined {u.joined}</span></span>
                  <span className="chip" style={{ background: "#232b25" }}>{u.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ---------- MATCH DETAIL ---------- */}
      {openMatch && (
        <MatchDetail
          m={matches.find((x) => x.id === openMatch)}
          me={me}
          minute={minute}
          myMatchBets={bets.filter((b) => b.userId === me.id && b.matchId === openMatch)}
          isDue={isDue}
          untilKickoff={untilKickoff}
          onClose={() => setOpenMatch(null)}
          onStart={startMatch}
          onPauseResume={(m, reason) => patchMatch(m.id, m.running ? { running: false, pauseReason: reason || "Paused by captain" } : { running: true, pauseReason: null })}
          onHalfTime={(m, takeBreak) => {
            if (takeBreak) {
              patchMatch(m.id, { halfPrompt: false, onBreak: true, breakRemaining: 600 });
              notify("☕ 10-minute half-time break started. Second half resumes automatically.");
            } else {
              patchMatch(m.id, { halfPrompt: false, running: true, secondHalf: true });
              notify("▶ Second half under way!");
            }
          }}
          onSetOdds={(m, odds) => patchMatch(m.id, { odds })}
          onPostpone={postponeMatch}
          onPublish={(m) => { patchMatch(m.id, { published: !m.published }); notify(m.published ? "Match unpublished — now private" : "Published to News Feed 📣"); }}
          onOpenSlip={() => { setOpenMatch(null); setComingSoon("Betting"); }}
          onSubmitScore={submitFinalScore}
          onPoster={() => setPosterFor(openMatch)}
        />
      )}

      {/* ---------- FOOTER ---------- */}
      <footer style={{ borderTop: "1px solid #232b25", marginTop: 40, background: "#0d1014" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ maxWidth: 300 }}>
            <div className="display" style={{ fontSize: 20, color: T.floodlight }}>MatchDay</div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>
              Community football. Host your matches, track them live, and publish results for the fans.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>Play fair</div>
            <div style={{ fontSize: 13, color: T.muted, maxWidth: 260, lineHeight: 1.5 }}>
              Captains publish official scores and cannot bet. Betting & wallet funding are coming soon — tell us if you want them fast!
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid #1a2019", padding: "14px 20px", textAlign: "center", fontSize: 12, color: T.muted }}>
          © {new Date().getFullYear()} MatchDay · Built for the community
        </div>
      </footer>

      {comingSoon && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setComingSoon(null)}>
          <div style={{ background: "#12161c", border: "1.5px solid #FFD447", borderRadius: 20, padding: 22, width: "100%", maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <ComingSoonCard
              feature={comingSoon}
              detail={comingSoon === "Betting"
                ? "Back your team with your wallet — pick a winner or draw at the captain's odds, and get paid out when results are published."
                : "Securely add money to your wallet and withdraw winnings straight to your bank, protected by your security PIN."}
              onFeedback={async (msg) => { await supabase.from("feedback").insert({ user_id: me.id, feature: comingSoon, message: msg }); setComingSoon(null); notify("🙏 Thank you! Your feedback pushes this feature up our launch list."); }}
              onClose={() => setComingSoon(null)}
            />
          </div>
        </div>
      )}

      {posterFor && <PosterModal m={matches.find((x) => x.id === posterFor)} onClose={() => setPosterFor(null)} notify={notify} />}
      {toast && <Toast msg={toast} />}
    </div>
  );
}

/* ============================================================ */

function SectionTitle({ children, color }) {
  return <div className="display" style={{ fontSize: 18, color, margin: "0 0 12px" }}>{children}</div>;
}

function Toast({ msg }) {
  return (
    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", background: "#FFD447", color: "#10131A", padding: "10px 18px", borderRadius: 12, fontWeight: 700, fontSize: 14, zIndex: 100, boxShadow: "0 8px 30px rgba(0,0,0,.5)", maxWidth: "90%" }}>
      {msg}
    </div>
  );
}

function StatusChip({ m }) {
  const map = {
    Scheduled: { bg: "#232b25", c: "#FAF7EF", t: "Scheduled" },
    Live: { bg: "#E4572E", c: "#fff", t: "● LIVE" },
    AwaitingScore: { bg: "#3a3320", c: "#FFD447", t: "Result Awaiting" },
    ResultPublished: { bg: "#0E4D3A", c: "#FFD447", t: "Result" },
  };
  const ht = m.status === "Live" && (m.halfPrompt || m.onBreak);
  const s = ht ? { bg: "#3a3320", c: "#FFD447", t: "⏸ Half Time" } : map[m.status];
  return <span className={`chip ${m.status === "Live" && !ht ? "pulse" : ""}`} style={{ background: s.bg, color: s.c }}>{s.t}</span>;
}

function MiniLogo({ team, size = 42 }) {
  return (
    <div className="mini-logo" style={{ width: size, height: size, borderRadius: "50%", background: team.color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: size * 0.42, color: "#fff", flexShrink: 0, border: "2px solid rgba(255,255,255,.25)" }}>
      {team.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
    </div>
  );
}

function MatchCard({ m, minute, onOpen, onPoster, onPlaceBet, mineView, canBetHint, myBetCount }) {
  const showScore = m.status === "ResultPublished";
  return (
    <div className="card" style={{ display: "grid", gap: 12, cursor: "pointer", alignContent: "start" }} onClick={onOpen}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <StatusChip m={m} />
        {m.postponed && m.status === "Scheduled" && <span className="chip" style={{ background: "#3a3320", color: "#FFD447" }}>📅 Rescheduled</span>}
      </div>
      <div className="scoreboard">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <MiniLogo team={m.teamA} />
          <div className="sb-name">{m.teamA.name}</div>
        </div>
        <div className="sb-center">
          {showScore ? (
            <div className="display" style={{ fontSize: 26, color: "#FFD447" }}>{m.finalA} – {m.finalB}</div>
          ) : m.status === "Live" && (m.halfPrompt || m.onBreak) ? (
            <>
              <div className="display" style={{ fontSize: 22, color: "#FFD447" }}>HT</div>
              <div style={{ fontSize: 11, color: "#FFD447", fontWeight: 700 }}>
                {m.onBreak ? `Break · ${Math.floor(m.breakRemaining / 60)}:${String(m.breakRemaining % 60).padStart(2, "0")}` : "Half-time break"}
              </div>
            </>
          ) : m.status === "Live" && !m.running ? (
            <>
              <div className="display" style={{ fontSize: 20, color: "#FFD447" }}>⏸</div>
              <div style={{ fontSize: 11, color: "#FFD447", fontWeight: 700 }}>{m.pauseReason || "Paused"}</div>
            </>
          ) : m.status === "Live" ? (
            <>
              <div className="display" style={{ fontSize: 22, color: "#E4572E" }}>LIVE</div>
              <div style={{ fontSize: 12, color: "#E4572E", fontWeight: 700 }}>{minute(m)}'</div>
            </>
          ) : m.status === "AwaitingScore" ? (
            <>
              <div className="display" style={{ fontSize: 20, color: "#FFD447" }}>FT</div>
              <div style={{ fontSize: 11, color: "#7A8B83", fontWeight: 700 }}>Result awaiting</div>
            </>
          ) : (
            <div className="display" style={{ fontSize: 18, color: "#FFD447" }}>{m.time}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
          <div className="sb-name" style={{ textAlign: "right" }}>{m.teamB.name}</div>
          <MiniLogo team={m.teamB} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#7A8B83", flexWrap: "wrap", gap: 8 }}>
        <span>📍 {m.location} · {m.date} · ⏱ {m.duration || 90}'</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {myBetCount > 0 && <span className="chip" style={{ background: "#0E4D3A", color: "#FFD447" }}>{myBetCount} bet{myBetCount > 1 ? "s" : ""}</span>}
          <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onPoster(); }}>🎨 Artwork</button>
          {canBetHint && <button className="btn btn-gold" style={{ padding: "6px 12px", fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onPlaceBet && onPlaceBet(); }}>Place Bet</button>}
        </div>
      </div>
    </div>
  );
}

function MatchDetail({ m, me, minute, myMatchBets = [], isDue, untilKickoff, onClose, onStart, onPauseResume, onHalfTime, onSetOdds, onPostpone, onPublish, onOpenSlip, onSubmitScore, onPoster }) {
  const [fa, setFa] = useState(0);
  const [fb, setFb] = useState(0);
  const [postponing, setPostponing] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [shootout, setShootout] = useState(false);
  const [scorersA, setScorersA] = useState("");
  const [scorersB, setScorersB] = useState("");
  const [pa, setPa] = useState(0);
  const [pb, setPb] = useState(0);
  useEffect(() => { setFa(0); setFb(0); setShootout(false); setPa(0); setPb(0); }, [m && m.id]);
  if (!m) return null;
  const isOwner = m.createdBy === me.id;
  const canBet = me.role === "Fan" && m.published && (m.status === "Scheduled" || m.status === "Live");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#12161c", borderRadius: 20, padding: 22, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 14 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <StatusChip m={m} />
          <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onClose}>✕ Close</button>
        </div>

        <div className="scoreboard" style={{ padding: 18 }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <MiniLogo team={m.teamA} size={54} />
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>{m.teamA.name}</div>
          </div>
          <div className="sb-center">
            <div className="display" style={{ fontSize: 38, color: m.status === "Live" ? (m.halfPrompt || m.onBreak ? "#FFD447" : "#E4572E") : "#FFD447" }}>
              {m.status === "ResultPublished" ? `${m.finalA} – ${m.finalB}` : m.status === "Live" ? (m.halfPrompt || m.onBreak ? "HT" : "LIVE") : m.status === "AwaitingScore" ? "FT" : "VS"}
            </div>
            {m.status === "Live" && (m.halfPrompt || m.onBreak) && (
              <div style={{ color: "#FFD447", fontWeight: 700, fontSize: 13 }}>
                {m.onBreak ? `Half-time break · ${Math.floor(m.breakRemaining / 60)}:${String(m.breakRemaining % 60).padStart(2, "0")} left` : "Half-time break"}
              </div>
            )}
            {m.status === "Live" && !m.halfPrompt && !m.onBreak && (m.running
              ? <div className="pulse" style={{ color: "#E4572E", fontWeight: 700 }}>{minute(m)}'</div>
              : <div style={{ color: "#FFD447", fontWeight: 700, fontSize: 13 }}>⏸ Paused{m.pauseReason ? ` — ${m.pauseReason}` : ""}</div>)}
            {m.status === "AwaitingScore" && <div style={{ color: "#7A8B83", fontWeight: 700, fontSize: 12 }}>Result awaiting</div>}
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <MiniLogo team={m.teamB} size={54} />
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>{m.teamB.name}</div>
          </div>
        </div>

        <div style={{ fontSize: 13, color: "#7A8B83" }}>📍 {m.location} · {m.date} at {m.time}</div>
        <div className="card" style={{ fontSize: 13, padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{m.teamA.name}</div>
          <div style={{ color: "#7A8B83" }}>{m.playersA}</div>
          <div style={{ fontWeight: 700, margin: "10px 0 4px" }}>{m.teamB.name}</div>
          <div style={{ color: "#7A8B83" }}>{m.playersB}</div>
        </div>

        {/* ARTWORK — visible to everyone, downloadable from the poster view */}
        <button className="btn btn-turf" onClick={onPoster}>🎨 View match artwork (download inside)</button>

        {/* MY BETS ON THIS MATCH */}
        {myMatchBets.length > 0 && (
          <div className="card" style={{ display: "grid", gap: 8, padding: 14 }}>
            <div className="display" style={{ fontSize: 13, color: "#FFD447" }}>Your bets on this match</div>
            {myMatchBets.map((b) => {
              const pickName = b.pick === "Draw" ? "Draw" : b.pick === "A" ? m.teamA.name : m.teamB.name;
              return (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <span>₦{b.stake.toLocaleString()} on {pickName} @ {b.odds}x</span>
                  <span className="chip" style={{ background: b.settled ? (b.won ? "#0E4D3A" : "#3a1f1a") : "#232b25", color: b.settled ? (b.won ? "#FFD447" : "#E4572E") : "#FAF7EF" }}>
                    {b.settled ? (b.won ? `Won ₦${Math.round(b.stake * b.odds).toLocaleString()}` : "Lost") : "Open"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* CAPTAIN CONTROLS */}
        {isOwner && me.role === "Captain" && (
          <div className="card" style={{ display: "grid", gap: 10 }}>
            <div className="display" style={{ fontSize: 14, color: "#FFD447" }}>Captain Controls</div>
            {m.status === "Scheduled" && (isDue(m) ? (
              <>
                <button className="btn btn-live" onClick={() => onStart(m)}>▶ Start Match (90-min timer)</button>
                <div style={{ fontSize: 12, color: "#7A8B83" }}>Kick-off time has been reached, but nothing starts without your consent — start when the teams are ready, or postpone below.</div>
              </>
            ) : (
              <div style={{ background: "#131a15", border: "1px solid #232b25", borderRadius: 12, padding: 12, textAlign: "center" }}>
                <div style={{ fontSize: 13, color: "#7A8B83" }}>🔒 Kick-off unlocks at <b style={{ color: "#FAF7EF" }}>{m.time}</b> on {m.date}</div>
                <div className="display" style={{ fontSize: 20, color: "#FFD447", marginTop: 4 }}>{untilKickoff(m)} to go</div>
              </div>
            ))}
            {m.status === "Scheduled" && (
              !postponing ? (
                <button className="btn btn-ghost" onClick={() => { setPostponing(true); setNewDate(m.date); setNewTime(m.time); }}>📅 Postpone this match</button>
              ) : (
                <div style={{ display: "grid", gap: 10, background: "#131a15", border: "1px solid #232b25", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#FFD447" }}>📅 Postpone — pick the new kick-off</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 4, fontWeight: 700 }}>📅 New date</div>
                      <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 4, fontWeight: 700 }}>🕐 New time</div>
                      <input className="input" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setPostponing(false)}>Cancel</button>
                    <button className="btn btn-gold" style={{ flex: 2 }} onClick={() => { onPostpone(m, newDate, newTime); setPostponing(false); }}>Confirm postponement</button>
                  </div>
                  <div style={{ fontSize: 11, color: "#7A8B83" }}>Fans see the updated schedule on the News Feed immediately.</div>
                </div>
              )
            )}
            {m.status === "Live" && m.halfPrompt && (
              <div style={{ display: "grid", gap: 10, background: "#1c1509", border: "1.5px solid #FFD447", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, color: "#FFD447" }}>⏱ HALF TIME — 45'. Pause for a 10-minute rest before the second half?</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onHalfTime(m, true)}>☕ Yes, 10-min break</button>
                  <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => onHalfTime(m, false)}>▶ No, start second half</button>
                </div>
              </div>
            )}
            {m.status === "Live" && m.onBreak && (
              <div style={{ background: "#1c1509", border: "1.5px solid #FFD447", borderRadius: 12, padding: 14, textAlign: "center" }}>
                <div style={{ fontWeight: 700, color: "#FFD447" }}>☕ Half-time break</div>
                <div className="display" style={{ fontSize: 30, color: "#FAF7EF" }}>
                  {Math.floor(m.breakRemaining / 60)}:{String(m.breakRemaining % 60).padStart(2, "0")}
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={() => onHalfTime(m, false)}>Skip break — start second half now</button>
              </div>
            )}
            {m.status === "Live" && !m.halfPrompt && !m.onBreak && (
              m.running ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>⏸ Pause timer — tell the fans why:</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["🤕 Injury", "🗣 Argument", "🌧 Weather", "⚠️ Pitch issue", "Other"].map((r) => (
                      <button key={r} className="btn btn-ghost" style={{ padding: "8px 12px", fontSize: 12 }} onClick={() => onPauseResume(m, r)}>{r}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "#7A8B83" }}>No live score is tracked. You'll upload the final result at full time.</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "#FFD447", fontWeight: 700 }}>⏸ Match paused{m.pauseReason ? ` — ${m.pauseReason}` : ""}</div>
                  <button className="btn btn-live" onClick={() => onPauseResume(m)}>▶ Resume match</button>
                </>
              )
            )}

            {/* SCORE SUBMISSION REQUEST — appears at full time */}
            {m.status === "AwaitingScore" && (
              <div style={{ display: "grid", gap: 10, background: "#1c1509", border: "1.5px solid #FFD447", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, color: "#FFD447" }}>🏁 Full time. Submit the final score to publish this result to the News Feed.</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 4 }}>{m.teamA.name}</div>
                    <input className="input" style={{ width: 80, textAlign: "center", fontSize: 22, fontWeight: 700 }} type="number" min="0" value={fa} onChange={(e) => setFa(Math.max(0, +e.target.value))} />
                  </div>
                  <div className="display" style={{ fontSize: 22, color: "#FFD447", marginTop: 18 }}>–</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 4 }}>{m.teamB.name}</div>
                    <input className="input" style={{ width: 80, textAlign: "center", fontSize: 22, fontWeight: 700 }} type="number" min="0" value={fb} onChange={(e) => setFb(Math.max(0, +e.target.value))} />
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
                      <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 4 }}>{m.teamA.name} pens</div>
                      <input className="input" style={{ width: 80, textAlign: "center", fontSize: 18, fontWeight: 700 }} type="number" min="0" value={pa} onChange={(e) => setPa(Math.max(0, +e.target.value))} />
                    </div>
                    <div className="display" style={{ fontSize: 18, color: "#FFD447", marginTop: 18 }}>–</div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 4 }}>{m.teamB.name} pens</div>
                      <input className="input" style={{ width: 80, textAlign: "center", fontSize: 18, fontWeight: 700 }} type="number" min="0" value={pb} onChange={(e) => setPb(Math.max(0, +e.target.value))} />
                    </div>
                  </div>
                )}
                <button className="btn btn-gold" onClick={() => onSubmitScore(m, fa, fb, shootout, pa, pb, scorersA, scorersB)}>Upload match result</button>
                <div style={{ fontSize: 12, color: "#7A8B83" }}>Your uploaded score is the official result. It publishes to the News Feed and settles all bets on the 90-minute score{shootout ? " (the shootout decides the match winner, shown on the result)" : ""}.</div>
              </div>
            )}

            {m.status !== "ResultPublished" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 13, color: "#7A8B83" }}>📣 All matches are public — this match is live on the News Feed for everyone to see.</div>
                {(m.status === "Scheduled" || m.status === "Live") && (
                  <div style={{ background: "#131a15", border: "1px solid #232b25", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#FFD447" }}>Set betting odds</div>
                    {[["A", `${m.teamA.name.split(" ")[0]} wins`], ["Draw", "Draw"], ["B", `${m.teamB.name.split(" ")[0]} wins`]].map(([k, label]) => (
                      <div key={k} style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <button className="btn btn-ghost" style={{ padding: "6px 14px", fontSize: 16 }} onClick={() => onSetOdds(m, { ...m.odds, [k]: Math.max(1.05, Math.round((m.odds[k] - 0.05) * 100) / 100) })}>−</button>
                            <span className="display" style={{ fontSize: 20, color: "#FFD447", minWidth: 58, textAlign: "center" }}>{Number(m.odds[k]).toFixed(2)}</span>
                            <button className="btn btn-ghost" style={{ padding: "6px 14px", fontSize: 16 }} onClick={() => onSetOdds(m, { ...m.odds, [k]: Math.min(50, Math.round((m.odds[k] + 0.05) * 100) / 100) })}>+</button>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {[1.50, 2.00, 2.50, 3.00].map((q) => (
                            <button key={q} className="btn btn-ghost" style={{ flex: 1, padding: "5px 4px", fontSize: 11 }} onClick={() => onSetOdds(m, { ...m.odds, [k]: q })}>{q.toFixed(2)}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: "#7A8B83" }}>Tap − / + to fine-tune in 0.05 steps, or tap a quick value. These odds apply when betting launches.</div>
                  </div>
                )}
              </div>
            )}
            <button className="btn btn-ghost" onClick={onPoster}>🎨 Generate match poster</button>
            <button className="btn btn-turf" onClick={() => {
              const lines = m.status === "ResultPublished"
                ? [`🏁 *FULL TIME* — ${m.teamA.name} ${m.finalA} - ${m.finalB} ${m.teamB.name}`,
                   m.shootout && m.pensWinner ? `(${m.pensWinner === "A" ? m.teamA.name : m.teamB.name} win ${m.pensA}-${m.pensB} on pens)` : "",
                   m.scorersA ? `⚽ ${m.teamA.name}: ${m.scorersA}` : "",
                   m.scorersB ? `⚽ ${m.teamB.name}: ${m.scorersB}` : "",
                   ``, `📍 ${m.location}`, `Hosted on MatchDay ⚽`]
                : [`⚽ *MATCH DAY!* ${m.teamA.name} vs ${m.teamB.name}`,
                   `📅 ${m.date} at ${m.time} (${m.duration || 90} mins)`, `📍 ${m.location}`, ``,
                   `*${m.teamA.name} squad:*`, m.playersA || "TBA", ``,
                   `*${m.teamB.name} squad:*`, m.playersB || "TBA", ``, `Come support! Hosted on MatchDay ⚽`];
              window.open(`https://wa.me/?text=${encodeURIComponent(lines.filter(Boolean).join("\n"))}`, "_blank");
            }}>💬 Share squad on WhatsApp</button>
          </div>
        )}

        {/* BETTING — handled in the Bet Slip window */}
        {canBet && (
          <button className="btn btn-gold" onClick={() => onOpenSlip(m.id)}>🎟 Place a bet — coming soon</button>
        )}
        {m.status === "AwaitingScore" && !isOwner && (
          <div className="card" style={{ fontSize: 13, color: "#7A8B83" }}>Full time — result awaiting. The score will appear here as soon as the captain uploads the match result.</div>
        )}
        {m.status === "ResultPublished" && (
          <div className="card" style={{ fontSize: 13, color: "#FFD447" }}>
            📰 Official result: {m.teamA.name} {m.finalA} – {m.finalB} {m.teamB.name}
            {m.shootout && m.pensWinner ? ` — ${m.pensWinner === "A" ? m.teamA.name : m.teamB.name} win ${m.pensA}–${m.pensB} on penalties.` : m.result === "Draw" ? " — Draw." : ` — ${m.result === "A" ? m.teamA.name : m.teamB.name} win.`} All bets settled on the 90-minute score.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- COMING SOON — feature gate with feedback ---------- */
function ComingSoonCard({ feature, detail, onFeedback, onClose }) {
  const [msg, setMsg] = useState("");
  return (
    <div style={{ display: "grid", gap: 12, textAlign: "center" }}>
      <div style={{ fontSize: 40 }}>🔜</div>
      <div className="display" style={{ fontSize: 20, color: "#FFD447" }}>{feature} is coming soon</div>
      <div style={{ fontSize: 13, color: "#7A8B83", lineHeight: 1.6 }}>{detail}</div>
      <div style={{ fontSize: 13, color: "#FAF7EF", fontWeight: 700 }}>Want it out very soon? Tell us 👇</div>
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

/* ---------- BET SLIP — the single window for all bet actions ---------- */
function BetSlip({ m, me, balance, myMatchBets, onPlace, onCancel, onClose }) {
  const [pick, setPick] = useState(null);
  const [stake, setStake] = useState(500);
  if (!m) return null;
  const bettable = (m.status === "Scheduled" || m.status === "Live") && m.published && me.role === "Fan";
  const pickName = (k) => (k === "Draw" ? "Draw" : k === "A" ? m.teamA.name : m.teamB.name);
  const canCancel = m.status === "Scheduled";

  return (
    <div>
      <div style={{ background: "#12161c", border: "1.5px solid #FFD447", borderRadius: 20, padding: 22, width: "100%", display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="display" style={{ fontSize: 18, color: "#FFD447" }}>🎟 Bet Slip</div>
          <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onClose}>✕ Close</button>
        </div>

        {/* Match info */}
        <div className="scoreboard" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <MiniLogo team={m.teamA} size={34} />
            <div className="sb-name" style={{ fontSize: 13 }}>{m.teamA.name}</div>
          </div>
          <div className="display" style={{ fontSize: 15, color: "#FFD447" }}>{m.status === "Live" ? "LIVE" : m.time}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
            <div className="sb-name" style={{ fontSize: 13, textAlign: "right" }}>{m.teamB.name}</div>
            <MiniLogo team={m.teamB} size={34} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#7A8B83", display: "flex", justifyContent: "space-between" }}>
          <span>📍 {m.location} · {m.date} · ⏱ {m.duration || 90}'</span>
          <span style={{ color: "#FFD447", fontWeight: 700 }}>Balance: ₦{balance.toLocaleString()}</span>
        </div>

        {/* Place a bet */}
        {bettable ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>1 · Choose your pick</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["A", `${m.teamA.name.split(" ")[0]} Win`, m.odds.A], ["Draw", "Draw", m.odds.Draw], ["B", `${m.teamB.name.split(" ")[0]} Win`, m.odds.B]].map(([k, label, odd]) => (
                <button key={k} className={`btn ${pick === k ? "btn-gold" : "btn-ghost"}`} style={{ flex: 1, fontSize: 12, padding: "10px 6px" }} onClick={() => setPick(k)}>
                  {label}<br /><span style={{ opacity: .7 }}>@{odd}x</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>2 · Set your stake</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[200, 500, 1000, 2000].map((v) => (
                <button key={v} className={`btn ${stake === v ? "btn-turf" : "btn-ghost"}`} style={{ flex: 1, padding: "8px 4px", fontSize: 12 }} onClick={() => setStake(v)}>₦{v.toLocaleString()}</button>
              ))}
            </div>
            <input className="input" type="number" min="50" max="1000000" step="50" value={stake} onChange={(e) => setStake(Math.min(1000000, Math.max(0, Math.floor(+e.target.value || 0))))} placeholder="Custom stake" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>3 · Confirm</div>
            <button className="btn btn-gold" disabled={!pick || !stake} style={{ opacity: pick && stake ? 1 : .5 }}
              onClick={() => { if (pick && stake) { onPlace(m, pick, stake); setPick(null); } }}>
              {pick ? `Place ₦${(stake || 0).toLocaleString()} on ${pickName(pick)} → returns ₦${Math.round((stake || 0) * m.odds[pick]).toLocaleString()}` : "Choose a pick to place your bet"}
            </button>
          </div>
        ) : (
          <div className="card" style={{ fontSize: 13, color: "#7A8B83" }}>
            {me.role === "Captain" ? "Captains publish official scores, so captain accounts can't place bets." : "Betting is closed for this match."}
          </div>
        )}

        {/* Your bets on this match + cancel */}
        <div style={{ display: "grid", gap: 8 }}>
          <div className="display" style={{ fontSize: 13, color: "#FFD447" }}>Your bets on this match</div>
          {myMatchBets.length === 0 && <div style={{ fontSize: 13, color: "#7A8B83" }}>No bets placed yet.</div>}
          {myMatchBets.map((b) => (
            <div key={b.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12 }}>
              <div style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 700 }}>₦{b.stake.toLocaleString()} on {pickName(b.pick)} @ {b.odds}x</div>
                <div style={{ color: "#7A8B83", fontSize: 12 }}>Returns ₦{Math.round(b.stake * b.odds).toLocaleString()} if it wins</div>
              </div>
              {!b.settled && canCancel ? (
                <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12, color: "#E4572E", borderColor: "#3a1f1a" }} onClick={() => onCancel(b)}>Cancel & refund</button>
              ) : (
                <span className="chip" style={{ background: b.settled ? (b.won ? "#0E4D3A" : "#3a1f1a") : "#232b25", color: b.settled ? (b.won ? "#FFD447" : "#E4572E") : "#FAF7EF" }}>
                  {b.settled ? (b.won ? "Won" : "Lost") : "Locked (live)"}
                </span>
              )}
            </div>
          ))}
          {canCancel && myMatchBets.some((b) => !b.settled) && (
            <div style={{ fontSize: 11, color: "#7A8B83" }}>Bets can be cancelled for a full refund any time before kick-off. Once the match goes live, they lock.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- PROFILE PAGE — edit name, manage security PIN ---------- */
function ProfilePage({ me, wallet, stats, onSave, notify }) {
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
    notify("Security PIN " + (me.pin ? "changed" : "set") + " ✔ It now protects your withdrawals.");
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="display" style={{ fontSize: 24, marginBottom: 16 }}>My Profile</div>

      {/* Identity card */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#0E4D3A", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Anton', sans-serif", fontSize: 28, color: "#FFD447", border: "2px solid rgba(255,212,71,.4)", flexShrink: 0 }}>
          {me.name.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{me.name}</div>
          <div style={{ fontSize: 13, color: "#7A8B83" }}>{me.contact}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <span className="chip" style={{ background: "#0E4D3A", color: "#FFD447" }}>{me.role}</span>
            <span className="chip" style={{ background: "#232b25", color: "#FAF7EF" }}>Joined {me.joined}</span>
            <span className="chip" style={{ background: "#232b25", color: "#FFD447" }}>₦{wallet.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="feedgrid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 14 }}>
        {[stats.a, stats.b, stats.c].map(([label, val]) => (
          <div key={label} className="card" style={{ textAlign: "center", padding: 12 }}>
            <div style={{ fontSize: 10, color: "#7A8B83", letterSpacing: ".05em", textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
            <div className="display" style={{ fontSize: 20, color: "#FFD447" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Captain team-join contact */}
      {me.role === "Captain" && (
        <div className="card" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          <div className="display" style={{ fontSize: 14, color: "#FFD447" }}>📞 Team Contact (shown to fans)</div>
          <div style={{ fontSize: 12, color: "#7A8B83" }}>Drop your phone/WhatsApp number so fans who want to join your team can reach you. Shown on your captain profile.</div>
          <input className="input" maxLength={60} placeholder="e.g. WhatsApp 0803 123 4567" value={contactInfo} onChange={(e) => setContactInfo(sanitizeText(e.target.value, 60))} />
          <button className="btn btn-gold" onClick={() => { onSave({ contactInfo }); notify("Team contact updated ✔ Fans can now see it on your profile."); }}>Save contact</button>
        </div>
      )}

      {/* Edit name */}
      <div className="card" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        <div className="display" style={{ fontSize: 14, color: "#FFD447" }}>Display Name</div>
        <input className="input" maxLength={30} value={name} onChange={(e) => setName(sanitizeText(e.target.value, 30))} />
        <button className="btn btn-gold" onClick={saveName}>Save name</button>
      </div>

      {/* Account details */}
      <div className="card" style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <div className="display" style={{ fontSize: 14, color: "#FFD447" }}>Account</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#7A8B83" }}>Email (login)</span><span>{me.contact}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "#7A8B83" }}>Account type</span><span>{me.role}</span>
        </div>
        <div style={{ fontSize: 11, color: "#7A8B83" }}>Your email is your secure login identity — changing it requires re-verification and arrives with the full launch. Roles are fixed at signup to keep betting fair.</div>
      </div>

      {/* Security PIN */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="display" style={{ fontSize: 14, color: "#FFD447" }}>🔒 Security PIN</div>
        <div style={{ fontSize: 12, color: "#7A8B83", lineHeight: 1.5 }}>
          Your login is passwordless (one-time email codes — nothing for hackers to steal). This 4-digit PIN is your second lock: it's required to withdraw funds from your wallet, so even someone holding your phone can't move your money.
          {me.pin ? " A PIN is currently active on your account." : " No PIN set yet — you'll need one before your first withdrawal."}
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
    teamAName: "", teamAColor: "#E4572E", teamBName: "", teamBColor: "#2E6BE4",
    playersA: "", playersB: "", location: "", date: "", time: "", duration: 90,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.teamAName && f.teamBName && f.location && f.date && f.time;

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div className="display" style={{ fontSize: 18, color: "#FFD447" }}>Create Match</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="Team A name" maxLength={24} value={f.teamAName} onChange={(e) => setF({ ...f, teamAName: sanitizeText(e.target.value, 24) })} />
        <input type="color" value={f.teamAColor} onChange={set("teamAColor")} style={{ width: 52, height: 48, border: 0, borderRadius: 10, background: "none", cursor: "pointer" }} title="Team A colour" />
      </div>
      <input className="input" placeholder="Team A players (comma separated)" maxLength={150} value={f.playersA} onChange={(e) => setF({ ...f, playersA: sanitizeText(e.target.value, 150) })} />
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="Team B name" maxLength={24} value={f.teamBName} onChange={(e) => setF({ ...f, teamBName: sanitizeText(e.target.value, 24) })} />
        <input type="color" value={f.teamBColor} onChange={set("teamBColor")} style={{ width: 52, height: 48, border: 0, borderRadius: 10, background: "none", cursor: "pointer" }} title="Team B colour" />
      </div>
      <input className="input" placeholder="Team B players (comma separated)" maxLength={150} value={f.playersB} onChange={(e) => setF({ ...f, playersB: sanitizeText(e.target.value, 150) })} />
      <input className="input" placeholder="Location (e.g. Campos Mini Stadium)" maxLength={60} value={f.location} onChange={(e) => setF({ ...f, location: sanitizeText(e.target.value, 60) })} />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 4, fontWeight: 700 }}>📅 Match date</div>
          <input className="input" type="date" value={f.date} onChange={set("date")} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 4, fontWeight: 700 }}>🕐 Kick-off time</div>
          <input className="input" type="time" value={f.time} onChange={set("time")} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: "#7A8B83", marginBottom: 6, fontWeight: 700 }}>⏱ Match duration</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[90, 60, 40].map((d) => (
            <button key={d} className={`btn ${f.duration === d ? "btn-gold" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setF({ ...f, duration: d })}>
              {d} mins
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#7A8B83", marginTop: 4 }}>Half time comes at {f.duration / 2} minutes.</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
        <button className="btn btn-gold" style={{ flex: 2, opacity: valid ? 1 : .5 }} disabled={!valid}
          onClick={() => valid && onSave({ teamA: { name: f.teamAName, color: f.teamAColor }, teamB: { name: f.teamBName, color: f.teamBColor }, playersA: f.playersA, playersB: f.playersB, location: f.location, date: f.date, time: f.time, duration: f.duration })}>
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
    a.download = `${m.teamA.name}-vs-${m.teamB.name}-poster.png`;
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
              <stop offset="0%" stopColor="#08301F" />
              <stop offset="100%" stopColor="#10131A" />
            </linearGradient>
          </defs>
          <rect width="400" height="500" fill="url(#bg)" />
          <circle cx="200" cy="250" r="90" fill="none" stroke="#FAF7EF" strokeOpacity="0.08" strokeWidth="2" />
          <line x1="0" y1="250" x2="400" y2="250" stroke="#FAF7EF" strokeOpacity="0.08" strokeWidth="2" />
          <rect x="130" y="0" width="140" height="55" fill="none" stroke="#FAF7EF" strokeOpacity="0.08" strokeWidth="2" />
          <rect x="130" y="445" width="140" height="55" fill="none" stroke="#FAF7EF" strokeOpacity="0.08" strokeWidth="2" />
          <text x="200" y="60" textAnchor="middle" fill="#FFD447" fontFamily="Anton, sans-serif" fontSize="30" letterSpacing="2">MATCHDAY</text>
          <text x="200" y="82" textAnchor="middle" fill="#FAF7EF" opacity="0.6" fontFamily="Space Grotesk, sans-serif" fontSize="12" letterSpacing="4">{isResult ? "FULL TIME RESULT" : "COMMUNITY FOOTBALL"}</text>
          <circle cx="110" cy="185" r="46" fill={m.teamA.color} stroke="#FAF7EF" strokeOpacity="0.3" strokeWidth="3" />
          <text x="110" y="197" textAnchor="middle" fill="#fff" fontFamily="Anton, sans-serif" fontSize="32">{initials(m.teamA)}</text>
          <circle cx="290" cy="185" r="46" fill={m.teamB.color} stroke="#FAF7EF" strokeOpacity="0.3" strokeWidth="3" />
          <text x="290" y="197" textAnchor="middle" fill="#fff" fontFamily="Anton, sans-serif" fontSize="32">{initials(m.teamB)}</text>
          {!isResult && <text x="200" y="197" textAnchor="middle" fill="#FFD447" fontFamily="Anton, sans-serif" fontSize="26">VS</text>}
          <text x="110" y="257" textAnchor="middle" fill="#FAF7EF" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="15">{m.teamA.name}</text>
          <text x="290" y="257" textAnchor="middle" fill="#FAF7EF" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="15">{m.teamB.name}</text>

          {isResult ? (
            <>
              {/* Final score — the centrepiece of a result poster */}
              <text x="200" y="352" textAnchor="middle" fill="#FFD447" fontFamily="Anton, sans-serif" fontSize="72" letterSpacing="4">{m.finalA} – {m.finalB}</text>
              <text x="200" y="386" textAnchor="middle" fill="#FAF7EF" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="16">
                {m.shootout && m.pensWinner ? `${(m.pensWinner === "A" ? m.teamA.name : m.teamB.name).toUpperCase()} WIN ${m.pensA}–${m.pensB} ON PENS` : m.result === "Draw" ? "MATCH DRAWN" : `${(m.result === "A" ? m.teamA.name : m.teamB.name).toUpperCase()} WIN`}
              </text>
              <rect x="60" y="400" width="280" height="2" fill="#FFD447" opacity="0.5" />
              {(m.scorersA || m.scorersB) && (
                <>
                  <text x="110" y="420" textAnchor="middle" fill="#FAF7EF" opacity="0.85" fontFamily="Space Grotesk, sans-serif" fontSize="10">⚽ {(m.scorersA || "—").slice(0, 34)}</text>
                  <text x="290" y="420" textAnchor="middle" fill="#FAF7EF" opacity="0.85" fontFamily="Space Grotesk, sans-serif" fontSize="10">⚽ {(m.scorersB || "—").slice(0, 34)}</text>
                </>
              )}
              <text x="200" y="440" textAnchor="middle" fill="#FAF7EF" opacity="0.75" fontFamily="Space Grotesk, sans-serif" fontSize="13">📍 {m.location} · {m.date}</text>
            </>
          ) : (
            <>
              <rect x="60" y="315" width="280" height="2" fill="#FFD447" opacity="0.5" />
              <text x="200" y="356" textAnchor="middle" fill="#FFD447" fontFamily="Anton, sans-serif" fontSize="24">{m.date}  ·  {m.time}</text>
              <text x="200" y="388" textAnchor="middle" fill="#FAF7EF" fontFamily="Space Grotesk, sans-serif" fontSize="15">📍 {m.location}</text>
            </>
          )}
          <text x="200" y="470" textAnchor="middle" fill="#FAF7EF" opacity="0.5" fontFamily="Space Grotesk, sans-serif" fontSize="11" letterSpacing="2">{isResult ? "HOSTED ON MATCHDAY" : "HOSTED ON MATCHDAY · COME SUPPORT YOUR TEAM"}</text>
        </svg>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
          <button className="btn btn-turf" style={{ flex: 1 }} onClick={() => toPng((png) => {
            const file = new File([png], "matchday-poster.png", { type: "image/png" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              navigator.share({ files: [file], title: "MatchDay", text: `${m.teamA.name} vs ${m.teamB.name} — hosted on MatchDay ⚽` }).catch(() => {});
            } else {
              notify("Sharing isn't supported on this browser — use Download instead");
            }
          })}>📤 Share</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={download}>⬇ Download</button>
        </div>
      </div>
    </div>
  );
}
