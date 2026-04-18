import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { loadData, saveTimerSession, loadTimerSession, IS_COACH_BUILD } from "./firebase.js";
import RaceCard from "./RaceCard";
import {
  fmtTime,
  fmtSplit,
  STORAGE_KEY,
  PRESET_DISTANCES,
  EVENT_COLORS,
  TEAM_COLORS,
  GROUP_COLORS,
  PACE_KEYS,
  EVT_ORDER,
  THEMES,
  isRelayRace,
} from "./splitTimerUtils";

export default function SplitTimer(props) {
  const {
    onRaceFinish,
    onDeleteHistory,
    meets: parentMeets = [],
    roster: parentRoster = [],
    raceResults = [],
    cmRole = "head",
    navigateToResultsMeet,
  } = props;

  const [screen, setScreen] = useState("setup");
  const [mode, setMode] = useState("meet");
  const [theme, setThemeState] = useState(localStorage.getItem("beacon_theme") || "dark");
  const setTheme = (t) => {
    setThemeState(t);
    localStorage.setItem("beacon_theme", t);
  };
  const [beepOn, setBeepState] = useState(localStorage.getItem("beacon_beep") === "1");
  const setBeep = (v) => {
    setBeepState(v);
    localStorage.setItem("beacon_beep", v ? "1" : "0");
  };
  const T = useMemo(() => THEMES[theme] || THEMES.dark, [theme]);
  const [allAthletes, setAllAthletes] = useState([]);
  const [races, setRaces] = useState([]);
  const [splitLabel, setSplitLabel] = useState("400m");
  const [customLabel, setCustomLabel] = useState("");
  const [woName, setWoName] = useState("");
  const [fbPaces, setFbPaces] = useState({});
  const [fbStatus, setFbStatus] = useState("connecting");
  const [importedMeetId, setImportedMeetId] = useState(null);
  const [histOpen, setHistOpen] = useState(false);
  const [expandedRace, setExpandedRace] = useState(null);
  const [woGroups, setWoGroups] = useState([]);
  const [newGrpName, setNewGrpName] = useState("");
  const [paceKey, setPaceKey] = useState("thrSafe");
  const [paceTol, setPaceTol] = useState(14);
  const [ahName, setAhName] = useState("");
  const [ahRelay, setAhRelay] = useState(false);
  const [ahLegs, setAhLegs] = useState(4);
  const [ahDist, setAhDist] = useState("");
  const [ahTeam, setAhTeam] = useState("boys");
  const [ahRunners, setAhRunners] = useState([]);
  const [ahOpen, setAhOpen] = useState(false);
  const sessionDate = useRef(new Date().toISOString().slice(0, 10)).current;

  useEffect(() => {
    const l = document.createElement("link");
    l.href = "https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;600;700;800;900&display=swap";
    l.rel = "stylesheet";
    document.head.appendChild(l);
    return () => document.head.removeChild(l);
  }, []);

  useEffect(() => {
    if (parentRoster.length > 0) {
      const clean = parentRoster
        .filter((a) => a.name && !a.name.toLowerCase().includes("coach"))
        .map((a) => ({ id: String(a.id), name: a.name, team: a.team || "boys" }));
      setAllAthletes(clean);
      const pm = {};
      parentRoster.forEach((a) => {
        if (a.name && a.paces) pm[a.name] = a.paces;
      });
      setFbPaces(pm);
      setFbStatus("ok");
    } else {
      loadData("roster-v3")
        .then((val) => {
          const raw = val ? JSON.parse(val) : null;
          if (!Array.isArray(raw)) {
            setFbStatus("offline");
            return;
          }
          const pm = {};
          raw.forEach((a) => {
            if (a.name && a.paces) pm[a.name] = a.paces;
          });
          setFbPaces(pm);
          setFbStatus("ok");
          setAllAthletes(
            raw
              .filter((a) => a.name && !a.name.toLowerCase().includes("coach"))
              .map((a) => ({ id: String(a.id), name: a.name, team: a.team || "boys" }))
          );
        })
        .catch(() => setFbStatus("offline"));
    }
  }, [parentRoster]);

  /* Cloud sync: key by coach role + session date so a dead phone can be
     recovered on another device. Local always wins on boot; remote is only
     consulted when local is empty. */
  const cloudKey = cmRole + "_" + sessionDate;
  const [cloudStatus, setCloudStatus] = useState("idle");
  const cloudWriteRef = useRef(null);
  const cloudRestoreTriedRef = useRef(false);

  const applySnapshot = useCallback((d) => {
    if (!d || !d.races || !d.races.length) return false;
    setRaces(d.races);
    if (d.splitLabel) setSplitLabel(d.splitLabel);
    if (d.customLabel) setCustomLabel(d.customLabel);
    if (d.mode) setMode(d.mode);
    if (d.importedMeetId) setImportedMeetId(d.importedMeetId);
    setScreen("race");
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tryLocalThenCloud = async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const d = JSON.parse(saved);
          if (applySnapshot(d)) return;
        }
      } catch {
        /* ignore corrupt storage */
      }
      if (!IS_COACH_BUILD || cloudRestoreTriedRef.current) return;
      cloudRestoreTriedRef.current = true;
      setCloudStatus("syncing");
      const remote = await loadTimerSession(cloudKey);
      if (cancelled) return;
      if (remote && remote.value) {
        try {
          const d = JSON.parse(remote.value);
          if (applySnapshot(d)) setCloudStatus("restored");
          else setCloudStatus("idle");
        } catch {
          setCloudStatus("idle");
        }
      } else {
        setCloudStatus("idle");
      }
    };
    tryLocalThenCloud();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot, cloudKey]);

  useEffect(() => {
    if (!races.length) return;
    const payload = JSON.stringify({ races, splitLabel, customLabel, mode, importedMeetId, savedAt: Date.now() });
    try {
      localStorage.setItem(STORAGE_KEY, payload);
    } catch {
      /* ignore storage errors */
    }
    /* Debounce cloud writes to 3s so rapid tap sequences don't burn quota. */
    if (!IS_COACH_BUILD) return;
    if (cloudWriteRef.current) clearTimeout(cloudWriteRef.current);
    cloudWriteRef.current = setTimeout(async () => {
      setCloudStatus("syncing");
      const ok = await saveTimerSession(cloudKey, payload);
      setCloudStatus(ok ? "synced" : "offline");
    }, 3000);
    return () => {
      if (cloudWriteRef.current) clearTimeout(cloudWriteRef.current);
    };
  }, [races, splitLabel, customLabel, mode, importedMeetId, cloudKey]);

  const rosterMap = useMemo(() => {
    const m = {};
    allAthletes.forEach((a) => {
      m[String(a.id)] = a;
    });
    return m;
  }, [allAthletes]);

  const label = customLabel.trim() || splitLabel;
  const boys = useMemo(() => allAthletes.filter((a) => a.team === "boys"), [allAthletes]);
  const girls = useMemo(() => allAthletes.filter((a) => a.team === "girls"), [allAthletes]);

  const updateRace = useCallback((raceId, updates) => {
    setRaces((prev) => prev.map((r) => (r.id === raceId ? { ...r, ...updates } : r)));
  }, []);

  const buildRaceResult = useCallback(
    (race) => {
      const runners = (race.runnerIds || []).map((rid) => {
        const ath = rosterMap[String(rid)];
        const sp = (race.splits || {})[rid] || [];
        const ft = sp.length > 0 ? sp[sp.length - 1].total : race.elapsed || 0;
        const isDnf = !!(race.dnf || {})[rid];
        return { id: rid, name: ath ? ath.name : "Unknown", team: ath ? ath.team : "", splits: sp, finalTime: ft, dnf: isDnf };
      });
      const result = {
        meetId: race.meetId || "",
        meetName: race.meetName || "Session",
        meetDate: race.meetDate || sessionDate,
        event: race.event || race.label || label,
        team: race.team || "",
        heat: race.heat || 0,
        runners,
        elapsed: race.elapsed || 0,
        type: mode,
        splitLabel: race.splitLabel || label,
        sortKey:
          (EVT_ORDER[race.event] !== undefined ? EVT_ORDER[race.event] : 9) * 1000 +
          (race.team === "boys" ? 0 : 100) +
          (race.heat || 1),
      };
      if (race.relay) result.relay = true;
      if (race.distanceM) result.distanceM = race.distanceM;
      return result;
    },
    [rosterMap, sessionDate, label, mode]
  );

  const saveOneRace = useCallback(
    (race) => {
      if (race.saved) return;
      const result = buildRaceResult(race);
      if (onRaceFinish) onRaceFinish(result);
      updateRace(race.id, { saved: true });
    },
    [buildRaceResult, onRaceFinish, updateRace]
  );

  const matchesMode = useCallback(
    (r) => {
      const rType = r.type || (r.meetId ? "meet" : null);
      return rType === mode;
    },
    [mode]
  );

  const saveAllUnsaved = () => {
    const unsaved = races.filter(
      (r) => matchesMode(r) && r.status === "done" && !r.saved && Object.keys(r.splits || {}).length > 0
    );
    unsaved.sort((a, b) => (buildRaceResult(a).sortKey || 0) - (buildRaceResult(b).sortKey || 0));
    unsaved.forEach((race) => {
      const result = buildRaceResult(race);
      if (onRaceFinish) onRaceFinish(result);
    });
    setRaces((prev) =>
      prev.map((r) =>
        matchesMode(r) && r.status === "done" && !r.saved && Object.keys(r.splits || {}).length > 0
          ? { ...r, saved: true }
          : r
      )
    );
  };

  const clearSession = () => {
    setRaces((prev) => prev.filter((r) => !matchesMode(r)));
    if (mode === "meet") setImportedMeetId(null);
    setScreen("setup");
  };

  const parsePace = (s) => {
    if (!s) return null;
    const clean = s.replace(/\/mi$/, "").trim();
    const pts = clean.split(":");
    if (pts.length !== 2) return null;
    const m = parseInt(pts[0]);
    const sc = parseInt(pts[1]);
    if (isNaN(m) || isNaN(sc)) return null;
    return m * 60 + sc;
  };

  const fmtPaceSec = (s) => {
    const m = Math.floor(s / 60);
    const sc = Math.round(s % 60);
    return m + ":" + (sc < 10 ? "0" : "") + sc;
  };

  const importPaceGroups = () => {
    const withPace = allAthletes
      .map((a) => {
        const p = fbPaces[a.name];
        return { ath: a, sec: parsePace(p && p[paceKey]) };
      })
      .filter((x) => x.sec !== null)
      .sort((a, b) => a.sec - b.sec);
    const used = {};
    const groups = [];
    for (let i = 0; i < withPace.length; i++) {
      if (used[withPace[i].ath.id]) continue;
      const grp = [withPace[i]];
      used[withPace[i].ath.id] = true;
      for (let j = i + 1; j < withPace.length; j++) {
        if (used[withPace[j].ath.id]) continue;
        if (withPace[j].sec - grp[grp.length - 1].sec <= paceTol) {
          grp.push(withPace[j]);
          used[withPace[j].ath.id] = true;
        }
      }
      const avg = Math.round(grp.reduce((s, x) => s + x.sec, 0) / grp.length);
      groups.push({
        id: "pg_" + Date.now() + "_" + i,
        name: fmtPaceSec(avg) + "/mi",
        color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
        runnerIds: grp.map((x) => String(x.ath.id)),
      });
    }
    setWoGroups(groups);
  };

  const resolveTeamCoaches = (evtData, team) => {
    if (evtData && evtData.coaches && evtData.coaches[team]) return evtData.coaches[team];
    if (evtData && evtData.assignedCoaches && evtData.assignedCoaches.length > 0) return evtData.assignedCoaches;
    return ["head", "asst"];
  };

  const importMeetEvents = (meet) => {
    if (!meet || !meet.lineup) return;
    const athTeam = {};
    allAthletes.forEach((a) => {
      athTeam[String(a.id)] = a.team;
    });
    const newRaces = [];
    let ts = Date.now();
    const customEvts = meet.customEvents || [];
    const ceMap = {};
    customEvts.forEach((c) => {
      ceMap[c.name] = c;
    });
    Object.entries(meet.lineup).forEach(([evtKey, evtData]) => {
      const allIds = (evtData.runners || []).map((r) => String(r));
      if (!allIds.length) return;
      const ce = ceMap[evtKey];
      const evtIsRelay = evtKey === "4x800" || (ce && ce.relay);
      const evtLegs = evtKey === "4x800" ? 4 : ce && ce.relay ? ce.legs || 4 : 0;
      const evtDistM = ce ? ce.distanceM || 0 : 0;
      const runnerAssign = evtData.runnerAssign || {};
      const numHeats = evtIsRelay ? 1 : Math.max(1, evtData.heats || 1);
      const heatAssign = evtData.heatAssign || {};
      const defaultSplit = evtIsRelay
        ? evtLegs > 0 && evtDistM > 0
          ? Math.round(evtDistM / evtLegs) + "m"
          : evtKey === "4x800"
            ? "800m"
            : label
        : label;
      ["boys", "girls"].forEach((team) => {
        const teamCoaches = resolveTeamCoaches(evtData, team);
        if (teamCoaches.indexOf(cmRole) === -1) return;
        const isShared = teamCoaches.length === 2;
        let teamIds = allIds.filter((r) => athTeam[r] === team);
        if (!teamIds.length) return;
        if (isShared) {
          teamIds = teamIds.filter((rid) => (runnerAssign[rid] || "head") === cmRole);
          if (!teamIds.length) return;
        }
        for (let hi = 0; hi < numHeats; hi++) {
          const heatNum = hi + 1;
          const heatIds = numHeats === 1 ? teamIds : teamIds.filter((rid) => (heatAssign[rid] || 1) === heatNum);
          if (!heatIds.length) continue;
          const heatLabel = numHeats > 1 ? " H" + heatNum : "";
          const teamLabel = team === "boys" ? "Boys" : "Girls";
          const raceObj = {
            id: "r_" + evtKey + "_" + team[0] + "_h" + heatNum + "_" + ts++,
            event: evtKey,
            team,
            label: evtKey + " " + teamLabel + heatLabel,
            approxTime: evtData.approxTime || "",
            runnerIds: heatIds,
            splits: {},
            elapsed: 0,
            status: "ready",
            finished: {},
            meetName: meet.name || "Meet",
            meetId: meet.id || "",
            meetDate: meet.date || "",
            heat: heatNum,
            splitLabel: defaultSplit,
            assignedCoaches: teamCoaches,
            shared: isShared,
            type: "meet",
          };
          if (evtIsRelay) raceObj.relay = true;
          if (evtLegs) raceObj.legs = evtLegs;
          if (evtDistM) raceObj.distanceM = evtDistM;
          newRaces.push(raceObj);
        }
      });
    });
    newRaces.sort((a, b) => {
      const ea = EVT_ORDER[a.event] !== undefined ? EVT_ORDER[a.event] : 9;
      const eb = EVT_ORDER[b.event] !== undefined ? EVT_ORDER[b.event] : 9;
      if (ea !== eb) return ea - eb;
      if (a.team !== b.team) return a.team === "boys" ? -1 : 1;
      return (a.heat || 1) - (b.heat || 1);
    });
    setRaces((prev) =>
      prev
        .filter((r) => {
          const t = r.type || (r.meetId ? "meet" : null);
          return t !== "meet";
        })
        .concat(newRaces)
    );
    setImportedMeetId(meet.id || meet.name);
  };

  const startWorkout = () => {
    const name = woName.trim() || "Workout";
    const newRaces = woGroups.map((g, gi) => ({
      id: "wo_" + Date.now() + "_" + gi,
      event: name,
      team: "",
      label: g.name,
      color: g.color,
      runnerIds: g.runnerIds,
      splits: {},
      elapsed: 0,
      status: "ready",
      finished: {},
      meetName: name,
      meetDate: sessionDate,
      type: "workout",
      splitLabel: label,
    }));
    setRaces((prev) => prev.filter((r) => r.type !== "workout").concat(newRaces));
  };

  const resetAll = () => {
    setRaces((prev) =>
      prev.filter((r) => {
        const rType = r.type || (r.meetId ? "meet" : null);
        return rType !== mode;
      })
    );
    if (mode === "meet") setImportedMeetId(null);
  };

  const today = new Date().toISOString().slice(0, 10);
  const meetsWithLineups = useMemo(() => {
    const filtered = (parentMeets.length > 0 ? parentMeets : []).filter(
      (m) => m && m.lineup && m.date >= today && Object.values(m.lineup).some((e) => (e.runners || []).length > 0)
    );
    filtered.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    return filtered;
  }, [parentMeets, today]);

  const modeRaces = useMemo(
    () =>
      races.filter((r) => {
        const rType = r.type || (r.meetId ? "meet" : null);
        return rType === mode;
      }),
    [races, mode]
  );

  const modeFilteredResults = useMemo(
    () => raceResults.filter((r) => (r.type || "meet") === mode),
    [raceResults, mode]
  );

  const { histBySession, histKeys } = useMemo(() => {
    const bySession = {};
    modeFilteredResults.forEach((r) => {
      const key = (r.meetName || "Session") + "\u2014" + (r.meetDate || "");
      if (!bySession[key]) {
        bySession[key] = {
          name: r.meetName || "Session",
          date: r.meetDate || "",
          type: r.type || "meet",
          meetKey: r.meetId || r.meetName || "Unknown",
          races: [],
          headCount: 0,
          asstCount: 0,
        };
      }
      bySession[key].races.push(r);
      if (r.savedBy === "asst") bySession[key].asstCount++;
      else bySession[key].headCount++;
    });
    const keys = Object.keys(bySession).sort((a, b) => (bySession[b].date || "").localeCompare(bySession[a].date || ""));
    return { histBySession: bySession, histKeys: keys };
  }, [modeFilteredResults]);

  const unsavedByMeet = useMemo(() => {
    const counts = {};
    races.forEach((r) => {
      if (r.status !== "done" || r.saved || Object.keys(r.splits || {}).length === 0) return;
      const rType = r.type || (r.meetId ? "meet" : mode);
      if (rType !== mode) return;
      const key = (r.meetName || "Session") + "\u2014" + (r.meetDate || "");
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [races, mode]);

  const allSaved =
    modeRaces.length > 0 && modeRaces.every((r) => r.saved || !r.splits || Object.keys(r.splits).length === 0);
  const anyHasSplits = modeRaces.some((r) => Object.keys(r.splits || {}).length > 0);

  /* ── SETUP ── */
  if (screen === "setup") {
    return (
      <div style={{ background: T.bg, minHeight: "100vh", fontFamily: "'Barlow Condensed',sans-serif", color: T.text }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid " + T.border, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 26, background: T.accent, borderRadius: 2 }} />
          <div>
            <div style={{ fontSize: 9, letterSpacing: 4, color: T.accent, textTransform: "uppercase" }}>Concordia Beacons</div>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>Split Timer</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <select value={theme} onChange={(e) => setTheme(e.target.value)} style={{ background: T.card, border: "1px solid " + T.border, color: T.text, padding: "3px 8px", borderRadius: 3, fontFamily: "inherit", fontSize: 10 }}>
              {Object.keys(THEMES).map((k) => (
                <option key={k} value={k}>{THEMES[k].name}</option>
              ))}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: fbStatus === "ok" ? "#27ae60" : fbStatus === "connecting" ? "#f0a500" : T.muted }} />
              <span style={{ fontSize: 9, color: T.muted, letterSpacing: 1 }}>{fbStatus === "ok" ? "LIVE" : "..."}</span>
              {IS_COACH_BUILD && cloudStatus !== "idle" ? (
                <span title={cloudStatus === "restored" ? "Restored from cloud" : cloudStatus === "synced" ? "Saved to cloud" : cloudStatus === "syncing" ? "Syncing to cloud..." : "Offline — writes queued"} style={{ fontSize: 9, color: cloudStatus === "offline" ? "#ef4444" : cloudStatus === "syncing" ? "#f0a500" : "#5ddb6a", letterSpacing: 1, fontWeight: 700 }}>
                  {cloudStatus === "restored" ? "RESTORED" : cloudStatus === "synced" ? "CLOUD" : cloudStatus === "syncing" ? "SYNC" : "OFFLINE"}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div style={{ padding: "16px 14px", maxWidth: 600, margin: "0 auto" }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", borderBottom: "2px solid " + T.border, marginBottom: 16 }}>
            {[{ k: "meet", l: "Meet Races" }, { k: "workout", l: "Workout" }, { k: "open", l: "Open Timer" }].map((m) => (
              <button key={m.k} onClick={() => setMode(m.k)} style={{ padding: "8px 16px", background: "none", border: "none", borderBottom: "2px solid " + (mode === m.k ? T.accent : "transparent"), color: mode === m.k ? T.accent : T.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: -2 }}>
                {m.l}
              </button>
            ))}
          </div>
          {/* Split distance */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: T.accent, textTransform: "uppercase", marginBottom: 6 }}>Split Distance</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
              {PRESET_DISTANCES.map((d) => {
                const on = splitLabel === d && !customLabel.trim();
                return (
                  <button key={d} onClick={() => { setSplitLabel(d); setCustomLabel(""); }} style={{ padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, background: on ? T.accent : "transparent", color: on ? T.bg : T.muted, border: "1px solid " + (on ? T.accent : T.dim) }}>
                    {d}
                  </button>
                );
              })}
            </div>
            <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Custom label..." style={{ width: "100%", boxSizing: "border-box", background: T.card, border: "1px solid " + (customLabel.trim() ? T.accent : T.border), color: T.text, padding: "6px 12px", borderRadius: 3, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
          </div>

          {/* ── MEET MODE ── */}
          {mode === "meet" ? (
            <div>
              <div style={{ fontSize: 9, letterSpacing: 4, color: T.accent, textTransform: "uppercase", marginBottom: 8 }}>Upcoming Meets with Lineups</div>
              {meetsWithLineups.length === 0 ? (
                <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic", padding: "12px", background: T.card, borderRadius: 4, border: "1px solid " + T.border }}>
                  No upcoming meets with lineups. Assign runners on Meet Schedule first.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {meetsWithLineups.map((meet) => {
                    const isA = importedMeetId === (meet.id || meet.name);
                    const evts = Object.entries(meet.lineup || {}).filter((e) => (e[1].runners || []).length > 0);
                    const isNext = meetsWithLineups[0] && (meetsWithLineups[0].id || meetsWithLineups[0].name) === (meet.id || meet.name);
                    return (
                      <div key={meet.id || meet.name} style={{ background: T.card, border: "1px solid " + (isA ? "#2d7a35" : isNext ? T.accent + "44" : T.border), borderRadius: 4, padding: "10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{meet.name}</div>
                              {isNext ? (
                                <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: T.accent + "22", color: T.accent, fontWeight: 700 }}>NEXT</span>
                              ) : null}
                            </div>
                            <div style={{ fontSize: 10, color: T.muted }}>{meet.date || ""} — {evts.map((e) => e[0]).join(", ")}</div>
                          </div>
                          <button onClick={() => importMeetEvents(meet)} style={{ padding: "6px 14px", background: isA ? "#1a3a1a" : T.accent, color: isA ? "#5ddb6a" : T.bg, border: "1px solid " + (isA ? "#2d7a35" : T.accent), borderRadius: 3, cursor: "pointer", fontSize: 12, fontWeight: 900, fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase" }}>
                            {isA ? "\u2713 Imported" : "Import"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Ad-hoc event creation */}
              <div style={{ marginTop: 12, background: T.card, border: "1px solid " + T.border, borderLeft: "3px solid #a855f7", borderRadius: 4, padding: "12px 14px" }}>
                <div onClick={() => setAhOpen(!ahOpen)} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>+ Add Event Manually</div>
                  <span style={{ fontSize: 10, color: T.muted }}>{ahOpen ? "[-]" : "[+]"}</span>
                </div>
                {ahOpen ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10, color: T.muted, marginBottom: 8 }}>Add a race not in the imported lineup (e.g. 4x400, open 400).</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
                      <input value={ahName} onChange={(e) => setAhName(e.target.value)} placeholder="Event name (e.g. 4x400)" style={{ flex: "1 1 100px", background: T.timerBg, border: "1px solid " + T.border, color: T.text, padding: "6px 10px", borderRadius: 3, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: T.muted, cursor: "pointer" }}>
                        <input type="checkbox" checked={ahRelay} onChange={() => { setAhRelay(!ahRelay); setAhRunners([]); }} /> Relay
                      </label>
                      {ahRelay ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <span style={{ fontSize: 10, color: T.muted }}>Legs:</span>
                          <input type="number" min="2" max="10" value={ahLegs} onChange={(e) => { setAhLegs(parseInt(e.target.value) || 4); setAhRunners([]); }} style={{ width: 40, background: T.timerBg, border: "1px solid " + T.border, color: T.text, padding: "3px 5px", borderRadius: 3, fontSize: 11, textAlign: "center", fontFamily: "inherit" }} />
                        </div>
                      ) : null}
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <span style={{ fontSize: 10, color: T.muted }}>Dist (m):</span>
                        <input type="number" min="0" value={ahDist} onChange={(e) => setAhDist(e.target.value)} placeholder="e.g. 1600" style={{ width: 65, background: T.timerBg, border: "1px solid " + T.border, color: T.text, padding: "3px 5px", borderRadius: 3, fontSize: 11, textAlign: "center", fontFamily: "inherit" }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      {[{ k: "boys", l: "Boys", c: "#4a9eff" }, { k: "girls", l: "Girls", c: "#ff7eb3" }].map((t) => (
                        <button key={t.k} onClick={() => { setAhTeam(t.k); setAhRunners([]); }} style={{ padding: "4px 12px", borderRadius: 3, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: ahTeam === t.k ? t.c + "22" : "transparent", color: ahTeam === t.k ? t.c : T.muted, border: "1px solid " + (ahTeam === t.k ? t.c : T.dim) }}>
                          {t.l}
                        </button>
                      ))}
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>Select runners{ahRelay ? " (max " + ahLegs + " for relay)" : ""}:</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {allAthletes.filter((a) => a.team === ahTeam).map((a) => {
                          const isIn = ahRunners.includes(String(a.id));
                          const atCap = ahRelay && ahRunners.length >= ahLegs && !isIn;
                          return (
                            <button key={a.id} disabled={atCap} onClick={() => {
                              if (isIn) setAhRunners(ahRunners.filter((x) => x !== String(a.id)));
                              else setAhRunners(ahRunners.concat([String(a.id)]));
                            }} style={{ padding: "3px 8px", borderRadius: 3, fontSize: 11, fontWeight: isIn ? 700 : 500, cursor: atCap ? "not-allowed" : "pointer", fontFamily: "inherit", background: isIn ? (ahTeam === "boys" ? "#4a9eff" : "#ff7eb3") + "18" : "transparent", border: "1px solid " + (isIn ? (ahTeam === "boys" ? "#4a9eff" : "#ff7eb3") + "44" : T.dim), color: atCap ? T.dim : isIn ? T.text : T.muted, opacity: atCap ? 0.4 : 1 }}>
                              {isIn ? "\u2713 " : ""}{a.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button disabled={!ahName.trim() || ahRunners.length === 0} onClick={() => {
                      const distM = parseInt(ahDist) || 0;
                      const legs = ahRelay ? Math.max(1, ahLegs) : 0;
                      const splitDist = ahRelay && legs > 0 && distM > 0 ? Math.round(distM / legs) + "m" : label;
                      const raceObj = {
                        id: "ah_" + ahName.trim() + "_" + ahTeam + "_" + Date.now(),
                        event: ahName.trim(),
                        team: ahTeam,
                        label: ahName.trim() + " " + (ahTeam === "boys" ? "Boys" : "Girls"),
                        runnerIds: ahRunners.slice(),
                        splits: {},
                        elapsed: 0,
                        status: "ready",
                        finished: {},
                        meetName: importedMeetId || "Meet",
                        meetDate: sessionDate,
                        type: "meet",
                        splitLabel: splitDist,
                      };
                      if (ahRelay) { raceObj.relay = true; raceObj.legs = legs; }
                      if (distM) raceObj.distanceM = distM;
                      setRaces((prev) => prev.concat([raceObj]));
                      setAhName(""); setAhRelay(false); setAhLegs(4); setAhDist(""); setAhRunners([]);
                    }} style={{ padding: "8px 16px", borderRadius: 4, background: ahName.trim() && ahRunners.length > 0 ? "#a855f7" : "rgba(255,255,255,0.06)", border: "none", color: ahName.trim() && ahRunners.length > 0 ? "#fff" : T.muted, fontSize: 12, fontWeight: 900, cursor: ahName.trim() && ahRunners.length > 0 ? "pointer" : "not-allowed", fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase" }}>
                      Add Race Card
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ── WORKOUT MODE ── */}
          {mode === "workout" ? (
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 9, letterSpacing: 4, color: T.accent, textTransform: "uppercase", marginBottom: 6 }}>Workout Name</div>
                <input value={woName} onChange={(e) => setWoName(e.target.value)} placeholder="e.g. 4x400 @ Threshold" style={{ width: "100%", boxSizing: "border-box", background: T.card, border: "1px solid " + (woName.trim() ? T.accent : T.border), color: T.text, padding: "8px 12px", borderRadius: 3, fontSize: 14, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderLeft: "3px solid #4a9eff", borderRadius: 4, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 6 }}>Import Pace Groups</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  <select value={paceKey} onChange={(e) => setPaceKey(e.target.value)} style={{ background: T.timerBg, border: "1px solid " + T.border, color: T.text, padding: "5px 8px", borderRadius: 3, fontFamily: "inherit", fontSize: 12 }}>
                    {PACE_KEYS.map((p) => (<option key={p.k} value={p.k}>{p.l}</option>))}
                  </select>
                  <select value={paceTol} onChange={(e) => setPaceTol(parseInt(e.target.value))} style={{ background: T.timerBg, border: "1px solid " + T.border, color: T.text, padding: "5px 8px", borderRadius: 3, fontFamily: "inherit", fontSize: 12 }}>
                    {[2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map((t) => (<option key={t} value={t}>{t}s</option>))}
                  </select>
                  <button onClick={importPaceGroups} style={{ padding: "5px 12px", background: "#4a9eff", color: T.bg, border: "none", borderRadius: 3, cursor: "pointer", fontSize: 12, fontWeight: 900, fontFamily: "inherit" }}>Generate</button>
                </div>
              </div>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderLeft: "3px solid " + T.accent, borderRadius: 4, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 6 }}>Manual Groups</div>
                <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
                  <input value={newGrpName} onChange={(e) => setNewGrpName(e.target.value)} onKeyDown={(e) => {
                    if (e.key === "Enter" && newGrpName.trim()) {
                      setWoGroups((prev) => prev.concat([{ id: "mg_" + Date.now(), name: newGrpName.trim(), color: GROUP_COLORS[prev.length % GROUP_COLORS.length], runnerIds: [] }]));
                      setNewGrpName("");
                    }
                  }} placeholder="Group name..." style={{ flex: 1, background: T.timerBg, border: "1px solid " + T.border, color: T.text, padding: "6px 10px", borderRadius: 3, fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                  <button onClick={() => {
                    if (newGrpName.trim()) {
                      setWoGroups((prev) => prev.concat([{ id: "mg_" + Date.now(), name: newGrpName.trim(), color: GROUP_COLORS[prev.length % GROUP_COLORS.length], runnerIds: [] }]));
                      setNewGrpName("");
                    }
                  }} style={{ padding: "6px 12px", background: T.accent, color: T.bg, border: "none", borderRadius: 3, cursor: "pointer", fontSize: 12, fontWeight: 900, fontFamily: "inherit" }}>+ Group</button>
                </div>
              </div>
              {woGroups.map((g) => {
                const members = g.runnerIds.map((rid) => rosterMap[rid]).filter(Boolean);
                const available = allAthletes.filter((a) => !g.runnerIds.includes(String(a.id)));
                return (
                  <div key={g.id} style={{ background: T.card, border: "1px solid " + T.border, borderLeft: "3px solid " + g.color, borderRadius: 4, padding: "10px 12px", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} />
                        <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{g.name}</span>
                        <span style={{ fontSize: 10, color: T.muted }}>{members.length}</span>
                      </div>
                      <button onClick={() => {
                        if (confirm("Remove group " + g.name + "?")) setWoGroups((prev) => prev.filter((x) => x.id !== g.id));
                      }} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>{"\u00D7"}</button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                      {members.map((a) => (
                        <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", background: g.color + "18", border: "1px solid " + g.color + "44", borderRadius: 3, fontSize: 11, fontWeight: 700, color: T.text }}>
                          {a.name}
                          <button onClick={() => {
                            setWoGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, runnerIds: x.runnerIds.filter((r) => r !== String(a.id)) } : x)));
                          }} style={{ background: "none", border: "none", color: g.color, cursor: "pointer", fontSize: 12, padding: 0 }}>{"\u00D7"}</button>
                        </span>
                      ))}
                    </div>
                    <select value="" onChange={(e) => {
                      if (e.target.value) {
                        const rid = e.target.value;
                        setWoGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, runnerIds: x.runnerIds.concat([rid]) } : x)));
                      }
                    }} style={{ width: "100%", background: T.timerBg, border: "1px solid " + T.border, color: T.muted, padding: "4px 8px", borderRadius: 3, fontFamily: "inherit", fontSize: 11 }}>
                      <option value="">+ Add runner...</option>
                      {available.map((a) => (<option key={a.id} value={String(a.id)}>{a.name} ({a.team})</option>))}
                    </select>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* ── OPEN MODE ── */}
          {mode === "open" ? (
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 9, letterSpacing: 4, color: T.accent, textTransform: "uppercase", marginBottom: 6 }}>Session Label</div>
                <input value={woName} onChange={(e) => setWoName(e.target.value)} placeholder="e.g. Practice, Time Trial..." style={{ width: "100%", boxSizing: "border-box", background: T.card, border: "1px solid " + (woName.trim() ? T.accent : T.border), color: T.text, padding: "8px 12px", borderRadius: 3, fontSize: 14, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div style={{ background: T.card, border: "1px solid " + T.border, borderLeft: "3px solid " + T.accent, borderRadius: 4, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: T.text, marginBottom: 8 }}>Select Runners</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[{ label: "Boys", list: boys, clr: "#4a9eff" }, { label: "Girls", list: girls, clr: "#ff7eb3" }].map((grp) => {
                    const openR = races.find((r) => r.type === "open");
                    const selected = (openR && openR.runnerIds) || [];
                    return (
                      <div key={grp.label} style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: grp.clr, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{grp.label}</div>
                        {grp.list.map((a) => {
                          const isIn = selected.includes(String(a.id));
                          return (
                            <button key={a.id} onClick={() => {
                              setRaces((prev) => {
                                const others = prev.filter((r) => r.type !== "open");
                                const existing = prev.find((r) => r.type === "open");
                                const base = existing || {
                                  id: "open_" + Date.now(),
                                  event: woName.trim() || "Open",
                                  team: "",
                                  label: woName.trim() || "Open Timer",
                                  runnerIds: [],
                                  splits: {},
                                  elapsed: 0,
                                  status: "ready",
                                  finished: {},
                                  meetName: woName.trim() || "Open Timer",
                                  meetDate: sessionDate,
                                  type: "open",
                                };
                                let ids = (base.runnerIds || []).slice();
                                if (isIn) ids = ids.filter((x) => x !== String(a.id));
                                else ids.push(String(a.id));
                                return others.concat([{ ...base, runnerIds: ids, event: woName.trim() || "Open", label: woName.trim() || "Open Timer", meetName: woName.trim() || "Open Timer" }]);
                              });
                            }} style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 8px", marginBottom: 2, borderRadius: 3, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: isIn ? 700 : 500, background: isIn ? grp.clr + "18" : "transparent", border: "1px solid " + (isIn ? grp.clr + "44" : T.dim), color: isIn ? T.text : T.muted }}>
                              {isIn ? "\u2713 " : ""}{a.name}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => {
                  const allIds = allAthletes.map((a) => String(a.id));
                  const newOpen = {
                    id: "open_" + Date.now(),
                    event: woName.trim() || "Open",
                    team: "",
                    label: woName.trim() || "Open Timer",
                    runnerIds: allIds,
                    splits: {},
                    elapsed: 0,
                    status: "ready",
                    finished: {},
                    meetName: woName.trim() || "Open Timer",
                    meetDate: sessionDate,
                    type: "open",
                  };
                  setRaces((prev) => prev.filter((r) => r.type !== "open").concat([newOpen]));
                }} style={{ marginTop: 8, padding: "4px 10px", background: "transparent", color: T.muted, border: "1px solid " + T.dim, borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>Select All</button>
              </div>
            </div>
          ) : null}

          {/* Race preview */}
          {modeRaces.length > 0 ? (
            <div style={{ marginTop: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 9, letterSpacing: 4, color: T.accent, textTransform: "uppercase", marginBottom: 6 }}>
                {mode === "workout" ? "Workout Groups" : mode === "open" ? "Open Timer Session" : "Race Cards"} ({modeRaces.length}){" "}
                <span style={{ fontSize: 8, color: T.muted, fontStyle: "italic", letterSpacing: 0, textTransform: "none" }}>tap to expand, drag to reorder runners</span>
              </div>
              {modeRaces.map((r) => {
                const evClr = EVENT_COLORS[r.event] || r.color || T.accent;
                const isExp = expandedRace === r.id;
                const rRunners = (r.runnerIds || []).map((rid) => rosterMap[rid] || rosterMap[String(rid)]).filter(Boolean);
                const previewMoveRunner = (fromI, toI) => {
                  if (fromI === toI) return;
                  const ids = (r.runnerIds || []).slice();
                  const item = ids.splice(fromI, 1)[0];
                  ids.splice(toI, 0, item);
                  updateRace(r.id, { runnerIds: ids });
                };
                const previewRemoveRunner = (rid) => {
                  const ids = (r.runnerIds || []).filter((x) => x !== rid);
                  updateRace(r.id, { runnerIds: ids });
                };
                const previewAddRunner = (rid) => {
                  if ((r.runnerIds || []).includes(rid)) return;
                  updateRace(r.id, { runnerIds: (r.runnerIds || []).concat([rid]) });
                };
                return (
                  <div key={r.id} style={{ marginBottom: 4, background: T.card, border: "1px solid " + (isExp ? evClr + "44" : T.border), borderLeft: "3px solid " + evClr, borderRadius: 4, overflow: "hidden" }}>
                    <div onClick={() => setExpandedRace(isExp ? null : r.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", cursor: "pointer" }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: evClr }}>{r.label || r.event}</span>
                      {r.team ? <span style={{ fontSize: 10, fontWeight: 700, color: TEAM_COLORS[r.team] || evClr }}>{r.team}</span> : null}
                      <span style={{ fontSize: 10, color: T.muted, flex: 1 }}>{rRunners.length} runners</span>
                      <span style={{ fontSize: 10, color: T.muted }}>{isExp ? "\u25B2" : "\u25BC"}</span>
                    </div>
                    {isExp ? (
                      <div style={{ padding: "4px 10px 8px", borderTop: "1px solid " + T.border }}>
                        {rRunners.map((ath, ai) => (
                          <div key={ath.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(ai)); e.dataTransfer.effectAllowed = "move"; }} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => { e.preventDefault(); const from = parseInt(e.dataTransfer.getData("text/plain")); if (!isNaN(from)) previewMoveRunner(from, ai); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", marginBottom: 2, borderRadius: 3, background: T.timerBg, border: "1px solid " + T.border, cursor: "grab" }}>
                            <span style={{ fontSize: 10, color: T.muted }}>{"\u2630"}</span>
                            {isRelayRace(r) ? <span style={{ fontSize: 9, fontWeight: 700, color: evClr, padding: "0 4px", borderRadius: 2, background: evClr + "18" }}>Leg {ai + 1}</span> : null}
                            <span style={{ fontSize: 12, fontWeight: 700, color: T.text, flex: 1 }}>{ath.name}</span>
                            <span style={{ fontSize: 9, color: TEAM_COLORS[ath.team] || T.muted }}>{ath.team}</span>
                            <button onClick={(e) => { e.stopPropagation(); previewRemoveRunner(ath.id); }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12, padding: "0 2px", fontFamily: "inherit" }}>{"\u00D7"}</button>
                          </div>
                        ))}
                        <select value="" onChange={(e) => { if (e.target.value) previewAddRunner(e.target.value); }} style={{ width: "100%", marginTop: 4, background: T.timerBg, border: "1px dashed " + T.accent + "44", color: T.muted, padding: "4px 8px", borderRadius: 3, fontFamily: "inherit", fontSize: 11 }}>
                          <option value="">+ Add runner...</option>
                          {allAthletes.filter((a) => !(r.runnerIds || []).includes(String(a.id))).map((a) => (<option key={a.id} value={String(a.id)}>{a.name} ({a.team})</option>))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <button onClick={() => { if (confirm("Clear all race cards?")) resetAll(); }} style={{ marginTop: 4, padding: "3px 8px", background: "transparent", color: T.muted, border: "1px solid " + T.dim, borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>Clear</button>
            </div>
          ) : null}

          {/* Begin */}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {mode === "meet" ? (
              <button onClick={() => { if (modeRaces.length) setScreen("race"); }} disabled={!modeRaces.length} style={{ flex: 1, padding: "13px", borderRadius: 3, cursor: modeRaces.length ? "pointer" : "not-allowed", background: modeRaces.length ? T.accent : T.card, color: modeRaces.length ? T.bg : T.muted, border: "1px solid " + (modeRaces.length ? T.accent : T.border), fontSize: 15, fontWeight: 900, fontFamily: "inherit", letterSpacing: 3, textTransform: "uppercase" }}>
                {modeRaces.length ? "Begin \u2192" : "Import a meet"}
              </button>
            ) : null}
            {mode === "workout" ? (
              <button onClick={() => {
                if (woGroups.length > 0) { startWorkout(); setScreen("race"); }
                else if (modeRaces.length > 0) { setScreen("race"); }
              }} disabled={!woGroups.length && !modeRaces.length} style={{ flex: 1, padding: "13px", borderRadius: 3, cursor: woGroups.length || modeRaces.length ? "pointer" : "not-allowed", background: woGroups.length || modeRaces.length ? T.accent : T.card, color: woGroups.length || modeRaces.length ? T.bg : T.muted, border: "1px solid " + (woGroups.length || modeRaces.length ? T.accent : T.border), fontSize: 15, fontWeight: 900, fontFamily: "inherit", letterSpacing: 3, textTransform: "uppercase" }}>
                {modeRaces.length ? "Resume Workout \u2192" : woGroups.length ? "Start Workout \u2192" : "Create groups"}
              </button>
            ) : null}
            {mode === "open" ? (() => {
              const ok = modeRaces.length > 0 && (modeRaces[0].runnerIds || []).length > 0;
              return (
                <button onClick={() => { if (ok) setScreen("race"); }} disabled={!ok} style={{ flex: 1, padding: "13px", borderRadius: 3, cursor: ok ? "pointer" : "not-allowed", background: ok ? T.accent : T.card, color: ok ? T.bg : T.muted, border: "1px solid " + (ok ? T.accent : T.border), fontSize: 15, fontWeight: 900, fontFamily: "inherit", letterSpacing: 3, textTransform: "uppercase" }}>
                  {ok ? "Start Timer \u2192" : "Select runners"}
                </button>
              );
            })() : null}
          </div>

          {/* ── HISTORY ── */}
          <div style={{ marginTop: 24 }}>
            <button onClick={() => setHistOpen(!histOpen)} style={{ width: "100%", padding: "10px 14px", background: T.card, border: "1px solid " + T.border, borderRadius: 4, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "inherit" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: T.accent, letterSpacing: 1 }}>
                {mode === "workout" ? "Workout History" : mode === "open" ? "Open Timer History" : "Saved Meets"} ({histKeys.length})
              </span>
              <span style={{ fontSize: 10, color: T.muted }}>{histOpen ? "[-]" : "[+]"}</span>
            </button>
            {histOpen ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#3498DB18", border: "1px dashed #3498DB66", borderRadius: 3, cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#3498DB", fontFamily: "inherit" }}>
                    {"\u2B07 Import JSON"}
                    <input
                      type="file"
                      accept="application/json,.json"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files && e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          try {
                            const parsed = JSON.parse(ev.target.result);
                            if (!Array.isArray(parsed)) {
                              alert("Expected a JSON array of race results.");
                              return;
                            }
                            const dedupKey = (r) =>
                              (r.meetId || r.meetName || "") + "|" + (r.meetDate || "") + "|" + (r.event || "") + "|" + (r.team || "") + "|" + (r.heat || 0);
                            const existing = new Set(raceResults.map(dedupKey));
                            let added = 0;
                            let skipped = 0;
                            parsed.forEach((r) => {
                              if (!r || typeof r !== "object") return;
                              if (existing.has(dedupKey(r))) {
                                skipped++;
                                return;
                              }
                              existing.add(dedupKey(r));
                              if (onRaceFinish) onRaceFinish(r);
                              added++;
                            });
                            alert("Imported " + added + " race(s). Skipped " + skipped + " duplicate(s).");
                          } catch (err) {
                            alert("Failed to parse JSON: " + err.message);
                          }
                          e.target.value = "";
                        };
                        reader.readAsText(file);
                      }}
                    />
                  </label>
                </div>
                {histKeys.length === 0 ? (
                  <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic", padding: "12px" }}>
                    {mode === "workout" ? "No saved workouts yet." : mode === "open" ? "No saved open timer sessions yet." : "No saved meets yet."}
                  </div>
                ) : null}
                {histKeys.map((key) => {
                  const sess = histBySession[key];
                  const unsaved = unsavedByMeet[key] || 0;
                  return (
                    <div key={key} style={{ marginBottom: 12, background: T.card, border: "1px solid " + T.border, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ padding: "8px 12px", borderBottom: "1px solid " + T.border, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span>{sess.name}</span>
                            {unsaved > 0 ? (
                              <span title={unsaved + " race(s) in the timer haven't been saved yet"} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#f0a50022", color: "#f0a500", border: "1px solid #f0a50066", fontWeight: 800, letterSpacing: 0.5 }}>
                                {"\u26A0 " + unsaved + " UNSAVED"}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 10, color: T.muted, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 1 }}>
                            <span>{sess.date}</span>
                            <span>{"\u00B7"}</span>
                            <span>{sess.races.length} race{sess.races.length !== 1 ? "s" : ""}</span>
                            {sess.headCount > 0 || sess.asstCount > 0 ? <span>{"\u00B7"}</span> : null}
                            {sess.headCount > 0 ? <span style={{ color: "#5ddb6a" }}>{sess.headCount} head</span> : null}
                            {sess.headCount > 0 && sess.asstCount > 0 ? <span style={{ color: T.muted }}>{","}</span> : null}
                            {sess.asstCount > 0 ? <span style={{ color: "#3498DB" }}>{sess.asstCount} asst</span> : null}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {mode === "meet" && navigateToResultsMeet ? (
                            <button onClick={() => navigateToResultsMeet(sess.meetKey)} title="Open this meet in the Race Results tab" style={{ background: "#27ae6018", border: "1px solid #27ae6044", color: "#27ae60", borderRadius: 3, padding: "3px 8px", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}>View in Results</button>
                          ) : null}
                          <button onClick={() => {
                            const rows = [["Race", "Place", "Athlete", "Team", "Split #", "Split Time", "Total Time"]];
                            sess.races.forEach((race) => {
                              const evLabel = (race.event || "") + (race.team ? " " + race.team : "");
                              const runners = (race.runners || []).slice().sort((a, b) => (a.finalTime || 999999) - (b.finalTime || 999999));
                              runners.forEach((r, ri) => {
                                const sp = r.splits || [];
                                if (!sp.length) rows.push([evLabel, ri + 1, r.name, r.team || "", "", "", ""]);
                                else sp.forEach((s, si) => rows.push([si === 0 ? evLabel : "", si === 0 ? ri + 1 : "", si === 0 ? r.name : "", si === 0 ? r.team || "" : "", si + 1, fmtSplit(s.split), fmtTime(s.total)]));
                              });
                            });
                            const csv = rows.map((r) => r.map((v) => '"' + v + '"').join(",")).join("\n");
                            const el = document.createElement("a");
                            el.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                            el.download = "results_" + sess.name.replace(/\s+/g, "_") + "_" + (sess.date || "").replace(/\s+/g, "") + ".csv";
                            el.click();
                          }} style={{ background: T.accent + "18", border: "1px solid " + T.accent + "44", color: T.accent, borderRadius: 3, padding: "3px 8px", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}>CSV</button>
                          <button onClick={() => {
                            const payload = JSON.stringify(sess.races, null, 2);
                            const el = document.createElement("a");
                            el.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
                            el.download = "results_" + sess.name.replace(/\s+/g, "_") + "_" + (sess.date || "").replace(/\s+/g, "") + ".json";
                            el.click();
                          }} title="Export as JSON — preserves all data for cross-device merge" style={{ background: "#a855f718", border: "1px solid #a855f744", color: "#a855f7", borderRadius: 3, padding: "3px 8px", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}>JSON</button>
                          <button onClick={() => {
                            if (confirm("Delete " + sess.name + "?")) {
                              if (onDeleteHistory) {
                                const keep = raceResults.filter((r) => !((r.meetName || "Session") + "\u2014" + (r.meetDate || "") === key));
                                onDeleteHistory(keep);
                              }
                            }
                          }} style={{ background: "rgba(239,68,68,0.1)", border: "none", color: "#ef4444", borderRadius: 3, padding: "3px 8px", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}>Delete</button>
                        </div>
                      </div>
                      {sess.races.slice().sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0)).map((race) => {
                        const evClr = EVENT_COLORS[race.event] || T.accent;
                        const isRelay = race.event === "4x800" || !!race.relay;
                        const runners = isRelay
                          ? (race.runners || []).slice()
                          : (race.runners || []).slice().sort((a, b) => (a.finalTime || 999999) - (b.finalTime || 999999));
                        const maxSplits = runners.reduce((m, r) => Math.max(m, (r.splits || []).length), 0);
                        const teamTotal = isRelay ? runners.reduce((m, r) => (r.finalTime > m ? r.finalTime : m), 0) : 0;
                        return (
                          <div key={race.id || race.event + race.team} style={{ padding: "8px 12px", borderBottom: "1px solid " + T.dim }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: evClr }}>{race.event}</span>
                              {race.team ? <span style={{ fontSize: 10, fontWeight: 700, color: TEAM_COLORS[race.team] || evClr }}>{race.team}</span> : null}
                              {race.heat > 1 ? <span style={{ fontSize: 9, color: T.muted }}>H{race.heat}</span> : null}
                              {race.savedBy ? (
                                <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 2, background: race.savedBy === "asst" ? "#3498DB18" : "#27ae6018", color: race.savedBy === "asst" ? "#3498DB" : "#27ae60" }}>
                                  {race.savedBy === "asst" ? "Asst" : "Head"}
                                </span>
                              ) : null}
                              <button onClick={() => {
                                if (confirm("Delete this race?")) {
                                  if (onDeleteHistory) {
                                    const keep = raceResults.filter((r2) => r2.id !== race.id);
                                    onDeleteHistory(keep);
                                  }
                                }
                              }} style={{ marginLeft: "auto", background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 10, padding: 0 }}>x</button>
                            </div>
                            {isRelay ? (
                              <div>
                                {runners.map((r, ri) => {
                                  const sps = r.splits || [];
                                  const lastSp = sps.length > 0 ? sps[sps.length - 1] : null;
                                  const legSumMs = sps.reduce((a, s) => a + (s.split || 0), 0);
                                  const hasMulti = sps.length > 1;
                                  return (
                                    <div key={r.id || ri} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                                      <span style={{ width: 36, fontSize: 10, fontWeight: 700, color: evClr, textAlign: "center" }}>Leg {ri + 1}</span>
                                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: T.text }}>{r.name}</span>
                                      <span style={{ fontSize: 13, fontWeight: 700, color: T.splitClr || T.text, fontFamily: "'Share Tech Mono',monospace", width: 65, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.1 }} title={hasMulti ? sps.map((s) => fmtSplit(s.split)).join(" / ") : ""}>
                                        <span>{lastSp ? fmtSplit(legSumMs) : "--"}</span>
                                        {hasMulti ? <span style={{ fontSize: 8, color: T.muted, opacity: 0.7 }}>{sps.map((s) => fmtSplit(s.split)).join("/")}</span> : null}
                                      </span>
                                      <span style={{ fontSize: 13, fontWeight: 700, color: T.timeClr, fontFamily: "'Share Tech Mono',monospace", minWidth: 65, textAlign: "right" }}>{lastSp ? fmtTime(lastSp.total) : "--"}</span>
                                    </div>
                                  );
                                })}
                                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", marginTop: 3, borderRadius: 3, background: evClr + "15", border: "1px solid " + evClr + "55" }}>
                                  <span style={{ width: 36, fontSize: 10, fontWeight: 900, color: evClr, textAlign: "center", letterSpacing: 1 }}>TOTAL</span>
                                  <span style={{ flex: 1, fontSize: 10, color: T.muted }}>4x800 Team</span>
                                  <span style={{ width: 65, fontSize: 10, color: T.muted, textAlign: "center" }}>{"\u2014"}</span>
                                  <span style={{ fontSize: 14, fontWeight: 900, color: evClr, fontFamily: "'Share Tech Mono',monospace", minWidth: 65, textAlign: "right" }}>{teamTotal ? fmtTime(teamTotal) : "--"}</span>
                                </div>
                              </div>
                            ) : (
                              runners.map((r, ri) => {
                                const sps = r.splits || [];
                                return (
                                  <div key={r.id || ri} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                                    <span style={{ width: 18, fontSize: 10, fontWeight: 700, color: ri === 0 ? evClr : T.muted, textAlign: "center" }}>{ri + 1}</span>
                                    <span style={{ flex: 1, fontSize: 11, fontWeight: ri === 0 ? 700 : 500, color: ri === 0 ? evClr : T.muted }}>{r.name}</span>
                                    {maxSplits > 0
                                      ? Array.from({ length: maxSplits }, (_, si) => {
                                          const s = sps[si];
                                          return (
                                            <span key={si} style={{ fontSize: 13, fontWeight: 700, color: T.oldSplit || T.timeClr, fontFamily: "'Share Tech Mono',monospace", width: 55, textAlign: "center" }}>
                                              {s ? fmtSplit(s.split) : ""}
                                            </span>
                                          );
                                        })
                                      : null}
                                    <span style={{ fontSize: 14, fontWeight: 800, color: ri === 0 ? "#5ddb6a" : T.timeClr, fontFamily: "'Share Tech Mono',monospace", minWidth: 65, textAlign: "right" }}>
                                      {r.finalTime ? fmtTime(r.finalTime) : "--"}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  /* ── RACE SCREEN ── */
  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: "'Barlow Condensed',sans-serif", color: T.text }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid " + T.border, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: T.bg, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setScreen("setup")} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 10, fontFamily: "inherit", letterSpacing: 2, textTransform: "uppercase", padding: 0 }}>{"\u2190"} Setup</button>
          <span style={{ fontSize: 12, fontWeight: 800, color: T.accent, letterSpacing: 2, textTransform: "uppercase" }}>{label}</span>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <button onClick={() => setBeep(!beepOn)} title={beepOn ? "Beep on" : "Beep off"} style={{ padding: "6px 10px", background: beepOn ? T.accent + "22" : "transparent", color: beepOn ? T.accent : T.muted, border: "1px solid " + (beepOn ? T.accent + "66" : T.border), borderRadius: 3, cursor: "pointer", fontSize: 14, fontFamily: "inherit", lineHeight: 1 }}>
            {beepOn ? "\uD83D\uDD0A" : "\uD83D\uDD07"}
          </button>
          {anyHasSplits && !allSaved ? (
            <button onClick={saveAllUnsaved} style={{ padding: "6px 14px", background: "#3498DB", color: T.bg, border: "none", borderRadius: 3, cursor: "pointer", fontSize: 12, fontWeight: 900, fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase" }}>Save All</button>
          ) : null}
          {allSaved && anyHasSplits ? (
            <button onClick={clearSession} style={{ padding: "6px 14px", background: "#27ae60", color: T.bg, border: "none", borderRadius: 3, cursor: "pointer", fontSize: 12, fontWeight: 900, fontFamily: "inherit", letterSpacing: 1, textTransform: "uppercase" }}>Done - Clear</button>
          ) : null}
        </div>
      </div>
      <div style={{ padding: "8px 10px" }}>
        {modeRaces.map((race) => (
          <RaceCard
            key={race.id}
            race={race}
            rosterMap={rosterMap}
            paces={fbPaces}
            onUpdateRace={updateRace}
            onSaveRace={saveOneRace}
            splitLabel={label}
            T={T}
            allAthletes={allAthletes}
            beepOn={beepOn}
          />
        ))}
      </div>
    </div>
  );
}
