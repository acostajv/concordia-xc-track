import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue } from "firebase/database";

// ─── FIREBASE ────────────────────────────────────────────────────────────────
let db;
try {
  const app = initializeApp({
    apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  }, "split-timer");
  db = getDatabase(app);
} catch (e) { console.warn("Firebase unavailable", e); }

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const pad    = (n) => String(n).padStart(2, "0");
const fmtTime  = (ms) => { if (ms < 0) ms = 0; return `${pad(Math.floor(ms/60000))}:${pad(Math.floor((ms%60000)/1000))}.${pad(Math.floor((ms%1000)/10))}`; };
const fmtSplit = (ms) => { if (ms < 0) ms = 0; return ms < 60000 ? `${Math.floor(ms/1000)}.${pad(Math.floor((ms%1000)/10))}` : fmtTime(ms); };
const safeJSON = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

const STORAGE_KEY       = "beacon_split_v3";
const PRESET_DISTANCES  = ["200m","400m","800m","1200m","1600m","Quarter Mile","Half Mile","1 Mile","3K","5K"];
const GROUP_COLORS      = ["#FF5722","#4a9eff","#ff7eb3","#27ae60","#f0a500","#a855f7","#14b8a6","#f43f5e","#fb923c","#84cc16"];
const EVENT_COLORS      = { "800":"#4a9eff", "1600":"#f0a500", "3200":"#27ae60", "4x800":"#a855f7" };

const DEFAULT_ATHLETES = [
  { id:1,  name:"AJ Johnson",       team:"boys"  },
  { id:2,  name:"Andre Adamsson",   team:"boys"  },
  { id:3,  name:"Calvin Rogers",    team:"boys"  },
  { id:4,  name:"Declan Bevers",    team:"boys"  },
  { id:5,  name:"Elias Olson",      team:"boys"  },
  { id:6,  name:"Gabriel Gfrerer",  team:"boys"  },
  { id:7,  name:"Jacob Seeman",     team:"boys"  },
  { id:8,  name:"Jake Smith",       team:"boys"  },
  { id:9,  name:"Lincoln Bednar",   team:"boys"  },
  { id:10, name:"Reidar Bednar",    team:"boys"  },
  { id:11, name:"Thomas Veum",      team:"boys"  },
  { id:12, name:"Will Sullivan",    team:"boys"  },
  { id:13, name:"Alethea Rieke",    team:"girls" },
  { id:14, name:"Annika Robertson", team:"girls" },
  { id:15, name:"Arianna James",    team:"girls" },
  { id:16, name:"Eden Johnson",     team:"girls" },
  { id:17, name:"Elise Erickson",   team:"girls" },
  { id:18, name:"Ella Hipkins",     team:"girls" },
  { id:19, name:"Jade Schutte",     team:"girls" },
  { id:20, name:"Leah Gfrerer",     team:"girls" },
  { id:21, name:"Lilah Day",        team:"girls" },
  { id:22, name:"Marian Steward",   team:"girls" },
  { id:23, name:"Tristen Yost",     team:"girls" },
  { id:24, name:"Vienna Lecher",    team:"girls" },
];

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
function exportCSV(athletes, groups, splits, label, date) {
  const gMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  const rows = [["Athlete","Team","Group","Split #","Distance","Split Time","Total Time"]];
  athletes.forEach((a) => {
    const sp  = splits[a.id] || [];
    const grp = a.groupId ? (gMap[a.groupId] || "") : "";
    if (!sp.length) { rows.push([a.name, a.team||"", grp, "", label, "", ""]); }
    else sp.forEach((s,i) => rows.push([a.name, a.team||"", grp, i+1, label, fmtSplit(s.split), fmtTime(s.total)]));
  });
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const el = document.createElement("a");
  el.href = URL.createObjectURL(new Blob([csv], { type:"text/csv" }));
  el.download = `splits_${label.replace(/\s+/g,"_")}_${date}.csv`;
  el.click();
}

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function PacePill({ label, value, color }) {
  if (!value) return null;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:2, padding:"1px 5px",
      borderRadius:2, background:`${color}14`, border:`1px solid ${color}35` }}>
      <span style={{ color, fontWeight:800, fontSize:9, letterSpacing:0.5 }}>{label}</span>
      <span style={{ color:"#aaa", fontFamily:"'Share Tech Mono',monospace", fontSize:10 }}>{value}</span>
    </span>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function SplitTimer() {
  const [screen, setScreen]         = useState("setup");
  const [athletes, setAthletes]     = useState(DEFAULT_ATHLETES);
  const [groups, setGroups]         = useState([]);   // {id,name,color,source:"manual"|"training"|"meet"}
  const [newName, setNewName]       = useState("");
  const [newTeam, setNewTeam]       = useState("boys");
  const [splitLabel, setSplitLabel] = useState("400m");
  const [customLabel, setCustomLabel] = useState("");
  const [setupTab, setSetupTab]     = useState("import");  // "import" | "roster" | "manual"

  // Firebase data
  const [fbRoster, setFbRoster]     = useState([]);   // raw athlete objects from training app
  const [fbMeets, setFbMeets]       = useState([]);   // raw meets from training app
  const [fbPaces, setFbPaces]       = useState({});   // name → paces map
  const [fbStatus, setFbStatus]     = useState(db ? "connecting" : "offline");

  // Import UI state
  const [importedTraining, setImportedTraining] = useState(false);
  const [importedMeetId, setImportedMeetId]     = useState(null);  // which meet's events were imported
  const [newGroupName, setNewGroupName]         = useState("");
  const [assignGroupId, setAssignGroupId]       = useState("");

  // Race state
  const [isRunning, setIsRunning]   = useState(false);
  const [elapsed, setElapsed]       = useState(0);
  const [splits, setSplits]         = useState({});
  const [flashMap, setFlashMap]     = useState({});
  const [activeGroup, setActiveGroup] = useState("all");
  const [toast, setToast]           = useState("");

  const startRef   = useRef(null);
  const pausedRef  = useRef(0);
  const rafRef     = useRef(null);
  const elapsedRef = useRef(0);
  const sessionDate = useRef(new Date().toISOString().slice(0,10)).current;

  const C = {
    bg:"#07090e", card:"#0b0f18", border:"#141c2a",
    orange:"#FF5722", green:"#27ae60", greenLight:"#5ddb6a",
    muted:"#2a3448", dim:"#141c2a", boys:"#4a9eff", girls:"#ff7eb3",
  };

  // Fonts
  useEffect(() => {
    const l = document.createElement("link");
    l.href = "https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;600;700;800;900&display=swap";
    l.rel = "stylesheet"; document.head.appendChild(l);
    return () => document.head.removeChild(l);
  }, []);

  // ── FIREBASE LISTENERS ────────────────────────────────────────────────────
  useEffect(() => {
    if (!db) { setFbStatus("offline"); return; }

    // Roster (paces + training groups)
    const unsubRoster = onValue(ref(db, "roster-v3"), (snap) => {
      const raw = safeJSON(snap.val());
      if (!Array.isArray(raw)) { setFbStatus("offline"); return; }
      setFbRoster(raw);
      const pm = {};
      raw.forEach((a) => { if (a.name && a.paces) pm[a.name] = a.paces; });
      setFbPaces(pm);
      setFbStatus("ok");
      // Sync athlete list with Firebase roster (names + team)
      setAthletes(raw
        .filter((a) => a.name && !a.name.toLowerCase().includes("coach"))
        .map((a) => ({ id: a.id || a.name, name: a.name, team: a.team || "boys", groupId: null }))
      );
    }, () => setFbStatus("offline"));

    // Meets (race schedule)
    const unsubMeets = onValue(ref(db, "meets-v2"), (snap) => {
      const raw = safeJSON(snap.val());
      if (Array.isArray(raw)) setFbMeets(raw);
      else if (raw && typeof raw === "object") setFbMeets(Object.values(raw));
    }, () => {});

    return () => { unsubRoster(); unsubMeets(); };
  }, []);

  // ── LOCALSTORAGE ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const d = JSON.parse(saved);
      if (d.splits && Object.keys(d.splits).length > 0) {
        setSplits(d.splits);
        const el = d.elapsed || 0;
        setElapsed(el); elapsedRef.current = el; pausedRef.current = el;
        if (d.splitLabel)  setSplitLabel(d.splitLabel);
        if (d.customLabel) setCustomLabel(d.customLabel);
        if (d.groups)      setGroups(d.groups);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!Object.keys(splits).length) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ splits, elapsed:elapsedRef.current, splitLabel, customLabel, groups, savedAt:Date.now() })); } catch {}
  }, [splits, groups]);

  // ── TIMER ─────────────────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const now = Date.now() - startRef.current + pausedRef.current;
    elapsedRef.current = now; setElapsed(now);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startTimer = () => { startRef.current = Date.now(); setIsRunning(true); rafRef.current = requestAnimationFrame(tick); };
  const pauseTimer = () => { cancelAnimationFrame(rafRef.current); pausedRef.current = elapsedRef.current; setIsRunning(false); };
  const resetRace  = () => {
    cancelAnimationFrame(rafRef.current);
    setIsRunning(false); setElapsed(0); elapsedRef.current = 0; pausedRef.current = 0;
    setSplits({}); setFlashMap({});
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  const showToast  = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const recordSplit = useCallback((id) => {
    const now = elapsedRef.current;
    if (now === 0 && !isRunning) return;
    setSplits((prev) => {
      const ex = prev[id] || [];
      const last = ex.length > 0 ? ex[ex.length-1].total : 0;
      return { ...prev, [id]: [...ex, { split:now-last, total:now }] };
    });
    setFlashMap((prev) => ({ ...prev, [id]:true }));
    setTimeout(() => setFlashMap((prev) => ({ ...prev, [id]:false })), 350);
  }, [isRunning]);

  // ── DERIVED ───────────────────────────────────────────────────────────────
  const label     = customLabel.trim() || splitLabel;
  const active    = athletes.filter((a) => a.name.trim());
  const hasSplits = active.some((a) => (splits[a.id] || []).length > 0);
  const visibleAthletes = activeGroup === "all" ? active : active.filter((a) => a.groupId === activeGroup);

  // ── GROUP HELPERS ─────────────────────────────────────────────────────────
  const groupColor = (gid) => groups.find((g) => g.id === gid)?.color || null;
  const groupName  = (gid) => groups.find((g) => g.id === gid)?.name  || "";

  const addManualGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const id = "manual_" + Date.now();
    const color = GROUP_COLORS[(groups.filter(g=>g.source==="manual").length) % GROUP_COLORS.length];
    setGroups((prev) => [...prev, { id, name, color, source:"manual" }]);
    setNewGroupName("");
  };

  const removeGroup = (gid) => {
    setGroups((prev) => prev.filter((g) => g.id !== gid));
    setAthletes((prev) => prev.map((a) => a.groupId === gid ? { ...a, groupId:null } : a));
  };

  const assignAthlete = (athleteId, gid) =>
    setAthletes((prev) => prev.map((a) => a.id === athleteId ? { ...a, groupId:gid||null } : a));

  // ── IMPORT: TRAINING GROUPS ───────────────────────────────────────────────
  const importTrainingGroups = () => {
    const midColor  = "#4a9eff";
    const longColor = "#27ae60";
    const midId     = "training_mid";
    const longId    = "training_long";
    // Remove old training groups
    setGroups((prev) => [
      ...prev.filter((g) => g.source !== "training"),
      { id:midId,  name:"Mid-Distance", color:midColor,  source:"training" },
      { id:longId, name:"Long Distance", color:longColor, source:"training" },
    ]);
    // Assign athletes by their group field in fbRoster
    const groupMap = {};
    fbRoster.forEach((a) => { if (a.name) groupMap[a.name] = a.group; });
    setAthletes((prev) => prev.map((a) => {
      const g = groupMap[a.name];
      if (g === "mid")  return { ...a, groupId:midId };
      if (g === "long") return { ...a, groupId:longId };
      return a;
    }));
    setImportedTraining(true);
    showToast("Training groups imported!");
  };

  // ── IMPORT: MEET EVENTS ────────────────────────────────────────────────────
  const importMeetEvents = (meet) => {
    if (!meet?.events) return;
    const events = meet.events;
    // Build a name→id map from our athlete list
    const nameToId = {};
    athletes.forEach((a) => { nameToId[a.name] = a.id; });
    // Also map fbRoster id→name for reverse lookup
    const fbIdToName = {};
    fbRoster.forEach((a) => { if (a.id) fbIdToName[a.id] = a.name; });

    // Remove old meet groups, add new ones
    const newGroups = [];
    const assignments = {}; // athleteId → groupId
    Object.entries(events).forEach(([evtKey, evtData]) => {
      const evtAthletes = evtData?.athletes || [];
      if (!evtAthletes.length) return;
      const gid   = `meet_${meet.id||meet.name}_${evtKey}`;
      const color = EVENT_COLORS[evtKey] || GROUP_COLORS[newGroups.length % GROUP_COLORS.length];
      const label = `${evtKey}${evtData.approxTime ? ` · ${evtData.approxTime}` : ""}`;
      newGroups.push({ id:gid, name:label, color, source:"meet", meetName:meet.name||"Meet" });
      evtAthletes.forEach((fbAid) => {
        // fbAid might be a Firebase roster id or a name
        const name = fbIdToName[fbAid] || fbAid;
        const localId = nameToId[name];
        if (localId !== undefined) assignments[localId] = gid;
      });
    });

    setGroups((prev) => [
      ...prev.filter((g) => g.source !== "meet"),
      ...newGroups,
    ]);
    setAthletes((prev) => prev.map((a) => assignments[a.id] !== undefined ? { ...a, groupId:assignments[a.id] } : a));
    setImportedMeetId(meet.id || meet.name);
    showToast(`${meet.name || "Meet"} events imported!`);
  };

  // ── MEETS with events populated ────────────────────────────────────────────
  const meetsWithEvents = fbMeets.filter((m) => {
    if (!m?.events) return false;
    return Object.values(m.events).some((e) => (e?.athletes || []).length > 0);
  });

  // ── SETUP SCREEN ──────────────────────────────────────────────────────────
  if (screen === "setup") {
    return (
      <div style={{ background:C.bg, minHeight:"100vh", fontFamily:"'Barlow Condensed',sans-serif", color:"white" }}>

        {/* Header */}
        <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:3, height:26, background:C.orange, borderRadius:2 }} />
          <div>
            <div style={{ fontSize:9, letterSpacing:4, color:C.orange, textTransform:"uppercase" }}>Concordia Beacons</div>
            <div style={{ fontSize:20, fontWeight:800, lineHeight:1 }}>Split Timer</div>
          </div>
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background: fbStatus==="ok" ? C.green : fbStatus==="connecting" ? "#f0a500" : C.muted }} />
            <span style={{ fontSize:9, color:C.muted, letterSpacing:1 }}>
              {fbStatus==="ok" ? "FIREBASE LIVE" : fbStatus==="connecting" ? "CONNECTING…" : "OFFLINE"}
            </span>
          </div>
        </div>

        <div style={{ padding:"16px 14px", maxWidth:600, margin:"0 auto" }}>

          {/* Split distance */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:9, letterSpacing:4, color:C.orange, textTransform:"uppercase", marginBottom:8 }}>Split Distance</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
              {PRESET_DISTANCES.map((d) => {
                const on = splitLabel === d && !customLabel.trim();
                return (
                  <button key={d} onClick={() => { setSplitLabel(d); setCustomLabel(""); }}
                    style={{ padding:"5px 10px", borderRadius:3, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700,
                      background:on?C.orange:"transparent", color:on?C.bg:C.muted, border:`1px solid ${on?C.orange:C.dim}` }}>
                    {d}
                  </button>
                );
              })}
            </div>
            <input value={customLabel} onChange={(e)=>setCustomLabel(e.target.value)}
              placeholder="Custom label (600m, ¾ Mile…)"
              style={{ width:"100%", boxSizing:"border-box", background:C.card, border:`1px solid ${customLabel.trim()?C.orange:C.border}`, color:"white", padding:"8px 12px", borderRadius:3, fontSize:14, fontFamily:"inherit", outline:"none" }} />
          </div>

          {/* Tab switcher */}
          <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:14 }}>
            {[["import","Import Groups"],["roster","Roster"],["manual","Manual Groups"]].map(([tab,lbl]) => (
              <button key={tab} onClick={() => setSetupTab(tab)}
                style={{ padding:"8px 14px", background:"none", border:"none",
                  borderBottom:`2px solid ${setupTab===tab ? C.orange : "transparent"}`,
                  color:setupTab===tab ? C.orange : C.muted, cursor:"pointer", fontFamily:"inherit",
                  fontSize:12, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:-1 }}>
                {lbl}
              </button>
            ))}
          </div>

          {/* ── IMPORT TAB ── */}
          {setupTab === "import" && (
            <div>
              {fbStatus !== "ok" && (
                <div style={{ background:"#1a1208", border:"1px solid #3a2a08", borderRadius:4, padding:"10px 12px", marginBottom:14, fontSize:12, color:"#f0a500" }}>
                  {fbStatus === "connecting" ? "Connecting to training app…" : "Firebase offline — import unavailable. Use Manual Groups tab."}
                </div>
              )}

              {/* Training groups */}
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:"3px solid #4a9eff", borderRadius:4, padding:"12px 14px", marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:800, color:"white", marginBottom:2 }}>Workout Groups</div>
                    <div style={{ fontSize:11, color:C.muted }}>Mid-Distance & Long Distance from Roster tab</div>
                  </div>
                  <button onClick={importTrainingGroups} disabled={fbStatus!=="ok"}
                    style={{ padding:"7px 14px", background:importedTraining?"#1a3a1a":"#4a9eff", color:importedTraining?C.greenLight:"#07090e",
                      border:`1px solid ${importedTraining?"#2d7a35":"#4a9eff"}`, borderRadius:3, cursor:fbStatus==="ok"?"pointer":"not-allowed",
                      fontSize:12, fontWeight:900, fontFamily:"inherit", letterSpacing:1, textTransform:"uppercase", flexShrink:0 }}>
                    {importedTraining ? "✓ Imported" : "Import"}
                  </button>
                </div>
                {importedTraining && (
                  <div style={{ display:"flex", gap:6 }}>
                    {[{label:"Mid-Distance",color:"#4a9eff"},{label:"Long Distance",color:"#27ae60"}].map((g)=>(
                      <span key={g.label} style={{ padding:"2px 8px", borderRadius:3, background:`${g.color}18`, border:`1px solid ${g.color}44`, fontSize:11, color:g.color, fontWeight:700 }}>{g.label}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Meet events */}
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:"3px solid #f0a500", borderRadius:4, padding:"12px 14px", marginBottom:10 }}>
                <div style={{ fontSize:14, fontWeight:800, color:"white", marginBottom:2 }}>Race Schedule</div>
                <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>Import event lineups from your Meet Schedule page</div>
                {meetsWithEvents.length === 0 ? (
                  <div style={{ fontSize:11, color:C.muted, fontStyle:"italic" }}>
                    {fbStatus==="ok" ? "No meets with lineups set up yet." : "Connect to Firebase to load meets."}
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {meetsWithEvents.map((meet) => {
                      const isActive = importedMeetId === (meet.id || meet.name);
                      const evtCount = Object.values(meet.events||{}).filter(e=>(e?.athletes||[]).length>0).length;
                      return (
                        <div key={meet.id||meet.name} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8,
                          background:"#0a0e18", border:`1px solid ${isActive?"#2d7a35":C.border}`, borderRadius:3, padding:"8px 10px" }}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:"white" }}>{meet.name || "Unnamed Meet"}</div>
                            <div style={{ fontSize:10, color:C.muted }}>
                              {meet.date || ""}{meet.date?" · ":""}{evtCount} event{evtCount!==1?"s":""} with lineups
                              {/* Show event names */}
                              {" — "}
                              {Object.entries(meet.events||{})
                                .filter(([,e])=>(e?.athletes||[]).length>0)
                                .map(([k])=>k).join(", ")}
                            </div>
                          </div>
                          <button onClick={() => importMeetEvents(meet)} disabled={fbStatus!=="ok"}
                            style={{ padding:"6px 12px", background:isActive?"#1a3a1a":"#f0a500", color:isActive?C.greenLight:"#07090e",
                              border:`1px solid ${isActive?"#2d7a35":"#f0a500"}`, borderRadius:3, cursor:fbStatus==="ok"?"pointer":"not-allowed",
                              fontSize:11, fontWeight:900, fontFamily:"inherit", letterSpacing:1, textTransform:"uppercase", flexShrink:0 }}>
                            {isActive ? "✓ Active" : "Use"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Current groups summary */}
              {groups.length > 0 && (
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:9, letterSpacing:3, color:C.muted, textTransform:"uppercase", marginBottom:6 }}>Active Groups</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                    {groups.map((g) => (
                      <span key={g.id} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 8px",
                        background:`${g.color}14`, border:`1px solid ${g.color}44`, borderRadius:3 }}>
                        <span style={{ color:g.color, fontSize:11, fontWeight:700 }}>{g.name}</span>
                        <span style={{ fontSize:9, color:C.muted }}>
                          {g.source==="training"?"workout":g.source==="meet"?"race":"manual"}
                        </span>
                        <button onClick={() => removeGroup(g.id)}
                          style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:12, lineHeight:1, padding:0 }}>×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── ROSTER TAB ── */}
          {setupTab === "roster" && (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:8 }}>
                {athletes.map((a) => {
                  const gc = a.groupId ? groupColor(a.groupId) : null;
                  const tc = a.team === "girls" ? C.girls : C.boys;
                  return (
                    <div key={a.id} style={{ display:"flex", alignItems:"center", gap:5, background:C.card,
                      border:`1px solid ${C.border}`, borderLeft:`3px solid ${gc||tc}`, borderRadius:3, padding:"5px 8px" }}>
                      <input value={a.name} onChange={(e) => setAthletes((prev)=>prev.map((x)=>x.id===a.id?{...x,name:e.target.value}:x))}
                        style={{ flex:1, background:"transparent", border:"none", color:"white", fontSize:13, fontWeight:600, fontFamily:"inherit", outline:"none", minWidth:0 }} />
                      {gc && <div style={{ width:6, height:6, borderRadius:"50%", background:gc, flexShrink:0 }} title={groupName(a.groupId)} />}
                      <button onClick={() => setAthletes((prev)=>prev.filter((x)=>x.id!==a.id))}
                        style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:14, lineHeight:1, padding:0, flexShrink:0 }}>×</button>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:"flex", gap:5 }}>
                <input value={newName} onChange={(e)=>setNewName(e.target.value)}
                  onKeyDown={(e)=>{if(e.key==="Enter"&&newName.trim()){setAthletes((p)=>[...p,{id:Date.now(),name:newName.trim(),team:newTeam,groupId:null}]);setNewName("");}}}
                  placeholder="Add athlete…"
                  style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, color:"white", padding:"7px 10px", borderRadius:3, fontSize:13, fontFamily:"inherit", outline:"none" }} />
                <select value={newTeam} onChange={(e)=>setNewTeam(e.target.value)}
                  style={{ background:C.card, border:`1px solid ${C.border}`, color:"white", padding:"7px 8px", borderRadius:3, fontFamily:"inherit", fontSize:12 }}>
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                </select>
                <button onClick={()=>{if(newName.trim()){setAthletes((p)=>[...p,{id:Date.now(),name:newName.trim(),team:newTeam,groupId:null}]);setNewName("");}}}
                  style={{ padding:"7px 12px", background:C.dim, color:"#aaa", border:`1px solid ${C.border}`, borderRadius:3, cursor:"pointer", fontSize:13, fontWeight:700, fontFamily:"inherit" }}>
                  + Add
                </button>
              </div>
            </div>
          )}

          {/* ── MANUAL GROUPS TAB ── */}
          {setupTab === "manual" && (
            <div>
              <div style={{ display:"flex", gap:5, marginBottom:16 }}>
                <input value={newGroupName} onChange={(e)=>setNewGroupName(e.target.value)}
                  onKeyDown={(e)=>e.key==="Enter"&&addManualGroup()}
                  placeholder="Group name (Heat 1, Varsity Boys…)"
                  style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, color:"white", padding:"8px 12px", borderRadius:3, fontSize:13, fontFamily:"inherit", outline:"none" }} />
                <button onClick={addManualGroup}
                  style={{ padding:"8px 14px", background:C.orange, color:C.bg, border:"none", borderRadius:3, cursor:"pointer", fontSize:13, fontWeight:900, fontFamily:"inherit" }}>
                  + Group
                </button>
              </div>

              {groups.filter(g=>g.source==="manual").length === 0 && (
                <div style={{ textAlign:"center", padding:"20px 0", color:C.muted, fontSize:13 }}>
                  No manual groups yet.<br/>
                  <span style={{ fontSize:11, color:C.dim }}>For workout groups or race heats, type a name above.</span>
                </div>
              )}

              {groups.filter(g=>g.source==="manual").map((g) => {
                const members   = athletes.filter((a) => a.groupId === g.id);
                const unassigned = athletes.filter((a) => !a.groupId && a.name.trim());
                return (
                  <div key={g.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${g.color}`, borderRadius:4, padding:"12px 14px", marginBottom:10 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:g.color }} />
                        <span style={{ fontSize:15, fontWeight:800, color:"white" }}>{g.name}</span>
                        <span style={{ fontSize:11, color:C.muted }}>{members.length} runners</span>
                      </div>
                      <button onClick={() => removeGroup(g.id)}
                        style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>Remove</button>
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8, minHeight:24 }}>
                      {members.length===0 && <span style={{ fontSize:11, color:C.dim }}>No runners yet</span>}
                      {members.map((a) => (
                        <span key={a.id} style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px",
                          background:`${g.color}18`, border:`1px solid ${g.color}44`, borderRadius:3, fontSize:12, fontWeight:700, color:"white" }}>
                          {a.name}
                          <button onClick={()=>assignAthlete(a.id,null)}
                            style={{ background:"none", border:"none", color:g.color, cursor:"pointer", fontSize:13, lineHeight:1, padding:0 }}>×</button>
                        </span>
                      ))}
                    </div>
                    {unassigned.length > 0 && (
                      <select value="" onChange={(e)=>{if(e.target.value)assignAthlete(e.target.value==="string"?e.target.value:parseInt(e.target.value),g.id);}}
                        style={{ width:"100%", background:"#0a0e18", border:`1px solid ${C.border}`, color:C.muted, padding:"5px 8px", borderRadius:3, fontFamily:"inherit", fontSize:12 }}>
                        <option value="">+ Add runner to {g.name}…</option>
                        {unassigned.map((a)=>(<option key={a.id} value={a.id}>{a.name} ({a.team})</option>))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Restored session notice */}
          {hasSplits && (
            <div style={{ background:"#0b180b", border:"1px solid #1a3a1a", borderRadius:3, padding:"8px 12px", marginTop:16, marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:12, color:C.greenLight }}>✓ Previous session data restored</span>
              <button onClick={resetRace} style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>Clear</button>
            </div>
          )}

          <div style={{ marginTop:16 }}>
            <button onClick={() => { setActiveGroup("all"); setScreen("race"); }} disabled={!active.length}
              style={{ width:"100%", padding:"13px", borderRadius:3, cursor:active.length?"pointer":"not-allowed",
                background:active.length?C.orange:C.card, color:active.length?C.bg:C.muted,
                border:`1px solid ${active.length?C.orange:C.border}`,
                fontSize:15, fontWeight:900, fontFamily:"inherit", letterSpacing:3, textTransform:"uppercase" }}>
              Begin Session →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RACE SCREEN ───────────────────────────────────────────────────────────
  return (
    <div style={{ background:C.bg, height:"100vh", fontFamily:"'Barlow Condensed',sans-serif", color:"white", display:"flex", flexDirection:"column", overflow:"hidden" }}>

      {/* Timer bar */}
      <div style={{ background:"#050709", borderBottom:`2px solid ${C.border}`, padding:"8px 12px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexShrink:0 }}>
        <button onClick={()=>setScreen("setup")}
          style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:10, fontFamily:"inherit", letterSpacing:2, textTransform:"uppercase", padding:0, flexShrink:0 }}>
          ← Setup
        </button>
        <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:"clamp(34px,9vw,52px)", color:isRunning?"#fff":elapsed>0?C.orange:C.muted, letterSpacing:2, lineHeight:1, transition:"color 0.3s" }}>
          {fmtTime(elapsed)}
        </div>
        <div style={{ display:"flex", gap:5, flexShrink:0 }}>
          {!isRunning ? (
            <button onClick={startTimer}
              style={{ padding:"8px 18px", background:C.orange, color:C.bg, border:"none", borderRadius:3, cursor:"pointer", fontSize:14, fontWeight:900, fontFamily:"inherit", letterSpacing:2 }}>
              {elapsed>0?"GO":"START"}
            </button>
          ) : (
            <button onClick={pauseTimer}
              style={{ padding:"8px 18px", background:"transparent", color:C.orange, border:`1.5px solid ${C.orange}`, borderRadius:3, cursor:"pointer", fontSize:14, fontWeight:900, fontFamily:"inherit", letterSpacing:2 }}>
              STOP
            </button>
          )}
        </div>
      </div>

      {/* Sub-bar */}
      <div style={{ background:"#06080d", borderBottom:"1px solid #0f151f", padding:"5px 12px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:isRunning?C.orange:elapsed>0?C.green:C.muted, transition:"background 0.3s" }} />
          <span style={{ fontSize:11, fontWeight:800, color:C.orange, letterSpacing:2, textTransform:"uppercase" }}>{label}</span>
        </div>
        <div style={{ display:"flex", gap:5 }}>
          {hasSplits && (
            <button onClick={()=>{exportCSV(active,groups,splits,label,sessionDate);showToast("CSV downloaded!");}}
              style={{ padding:"3px 9px", background:"transparent", color:C.green, border:"1px solid #1a3a1a", borderRadius:3, cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit", letterSpacing:1, textTransform:"uppercase" }}>
              CSV ↓
            </button>
          )}
          <button onClick={resetRace}
            style={{ padding:"3px 9px", background:"transparent", color:C.muted, border:`1px solid ${C.dim}`, borderRadius:3, cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit", letterSpacing:1, textTransform:"uppercase" }}>
            Reset
          </button>
        </div>
      </div>

      {/* Group filter tabs */}
      {groups.length > 0 && (
        <div style={{ background:"#06080d", borderBottom:"1px solid #0f151f", display:"flex", overflowX:"auto", flexShrink:0 }}>
          {[{id:"all",name:"All",color:C.muted}, ...groups].map((g) => {
            const on  = activeGroup === g.id;
            const cnt = g.id==="all" ? active.length : active.filter((a)=>a.groupId===g.id).length;
            return (
              <button key={g.id} onClick={()=>setActiveGroup(g.id)}
                style={{ padding:"7px 12px", background:"none", border:"none",
                  borderBottom:`2px solid ${on?g.color:"transparent"}`,
                  color:on?g.color:C.muted, cursor:"pointer", fontFamily:"inherit",
                  fontSize:11, fontWeight:700, letterSpacing:1, textTransform:"uppercase",
                  whiteSpace:"nowrap", transition:"all 0.15s", marginBottom:-1, flexShrink:0 }}>
                {g.name} <span style={{ fontSize:9, opacity:0.6 }}>({cnt})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Tap grid */}
      <div style={{ flex:1, overflowY:"auto", padding:"6px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
          {visibleAthletes.map((athlete) => {
            const sp       = splits[athlete.id] || [];
            const last     = sp[sp.length-1];
            const flash    = flashMap[athlete.id];
            const hasSp    = sp.length > 0;
            const canClick = isRunning || elapsed > 0;
            const paces    = fbPaces[athlete.name] || {};
            const gc       = athlete.groupId ? groupColor(athlete.groupId) : null;
            const tc       = athlete.team==="girls" ? C.girls : C.boys;
            const topClr   = flash ? C.greenLight : gc || tc;

            return (
              <button key={athlete.id} onClick={()=>canClick&&recordSplit(athlete.id)}
                style={{
                  width:"100%", padding:"9px 10px 7px",
                  background:flash?"#0c1f0e":C.card,
                  border:`1px solid ${flash?"#2d7a35":hasSp?"#1a2e1a":C.border}`,
                  borderTop:`2px solid ${flash?C.greenLight:hasSp?"#1e4a1e":topClr+"66"}`,
                  borderRadius:4, cursor:canClick?"pointer":"default",
                  textAlign:"left", userSelect:"none", fontFamily:"inherit",
                  transition:"background 0.12s, border-color 0.12s",
                  boxShadow:flash?"0 0 14px rgba(45,122,53,0.2)":"none",
                  display:"flex", flexDirection:"column", gap:3,
                }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:4 }}>
                  <span style={{ fontSize:15, fontWeight:800, color:flash?C.greenLight:"white",
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", lineHeight:1.1, flex:1, minWidth:0, transition:"color 0.12s" }}>
                    {athlete.name}
                  </span>
                  <span style={{ fontSize:17, fontWeight:900, lineHeight:1, color:hasSp?(flash?C.greenLight:C.orange):C.dim, flexShrink:0, minWidth:16, textAlign:"right" }}>
                    {sp.length}
                  </span>
                </div>
                {activeGroup==="all" && gc && (
                  <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                    <div style={{ width:5, height:5, borderRadius:"50%", background:gc }} />
                    <span style={{ fontSize:9, color:gc, letterSpacing:0.5, fontWeight:700 }}>{groupName(athlete.groupId)}</span>
                  </div>
                )}
                <div style={{ minHeight:17 }}>
                  {last ? (
                    <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                      <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:16, color:flash?C.greenLight:"#3a9a48" }}>{fmtSplit(last.split)}</span>
                      <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:C.muted }}>{fmtTime(last.total)}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize:10, color:"#1a2235" }}>{canClick?"tap to record":"start timer"}</span>
                  )}
                </div>
                {(paces.thresholdSafe||paces.cvMedian||paces.vo2Safe) && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginTop:1 }}>
                    {paces.thresholdSafe && <PacePill label="T"  value={paces.thresholdSafe} color="#f0a500" />}
                    {paces.cvMedian      && <PacePill label="CV" value={paces.cvMedian}      color="#4a9eff" />}
                    {paces.vo2Safe       && <PacePill label="V²" value={paces.vo2Safe}       color="#e84393" />}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Split log */}
        {hasSplits && (
          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:9, letterSpacing:3, color:C.muted, textTransform:"uppercase", marginBottom:5, paddingLeft:1 }}>
              Split Log — {label}{activeGroup!=="all"?` · ${groupName(activeGroup)}`:""}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
              {visibleAthletes.filter((a)=>(splits[a.id]||[]).length>0).map((athlete) => {
                const sp = splits[athlete.id];
                const gc = athlete.groupId ? groupColor(athlete.groupId) : null;
                const tc = athlete.team==="girls" ? C.girls : C.boys;
                return (
                  <div key={athlete.id} style={{ background:"#080c14", border:"1px solid #0f151f", borderTop:`2px solid ${(gc||tc)+"44"}`, borderRadius:4, padding:"7px 9px" }}>
                    <div style={{ fontSize:12, fontWeight:700, color:C.orange, marginBottom:4 }}>{athlete.name}</div>
                    {sp.map((s,i) => (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"2px 0", borderTop:i>0?"1px solid #0f141e":"none" }}>
                        <span style={{ fontSize:9, color:C.muted, minWidth:18 }}>#{i+1}</span>
                        <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:12, color:i===sp.length-1?"#ccc":"#555" }}>{fmtSplit(s.split)}</span>
                        <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:C.muted }}>{fmtTime(s.total)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ height:16 }} />
      </div>

      {toast && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"#0c1f0e", border:"1px solid #2d7a35", color:C.greenLight, padding:"8px 18px", borderRadius:4, fontSize:13, fontWeight:700, letterSpacing:1, zIndex:99 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
