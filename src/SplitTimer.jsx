import { useState, useEffect, useRef, useCallback } from "react";
import { loadData } from "./firebase.js";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const pad    = (n) => String(n).padStart(2, "0");
const fmtTime  = (ms) => { if (ms < 0) ms = 0; return `${pad(Math.floor(ms/60000))}:${pad(Math.floor((ms%60000)/1000))}.${pad(Math.floor((ms%1000)/10))}`; };
const fmtSplit = (ms) => { if (ms < 0) ms = 0; return ms < 60000 ? `${Math.floor(ms/1000)}.${pad(Math.floor((ms%1000)/10))}` : fmtTime(ms); };

const STORAGE_KEY       = "beacon_split_v4";
const PRESET_DISTANCES  = ["200m","400m","800m","1200m","1600m","Half Mile","1 Mile","3K","5K"];
const EVENT_COLORS      = { "800":"#F39C12", "1600":"#D4A017", "3200":"#27ae60", "4x800":"#a855f7" };
const TEAM_COLORS       = { boys:"#4a9eff", girls:"#ff7eb3" };

const DEFAULT_ATHLETES = [
  { id:"1",  name:"AJ Johnson",       team:"boys"  },
  { id:"2",  name:"Andre Adamsson",   team:"boys"  },
  { id:"3",  name:"Calvin Rogers",    team:"boys"  },
  { id:"4",  name:"Declan Bevers",    team:"boys"  },
  { id:"5",  name:"Elias Olson",      team:"boys"  },
  { id:"6",  name:"Gabriel Gfrerer",  team:"boys"  },
  { id:"7",  name:"Jacob Seeman",     team:"boys"  },
  { id:"8",  name:"Jake Smith",       team:"boys"  },
  { id:"9",  name:"Lincoln Bednar",   team:"boys"  },
  { id:"10", name:"Reidar Bednar",    team:"boys"  },
  { id:"11", name:"Thomas Veum",      team:"boys"  },
  { id:"12", name:"Will Sullivan",    team:"boys"  },
  { id:"13", name:"Alethea Rieke",    team:"girls" },
  { id:"14", name:"Annika Robertson", team:"girls" },
  { id:"15", name:"Arianna James",    team:"girls" },
  { id:"16", name:"Eden Johnson",     team:"girls" },
  { id:"17", name:"Elise Erickson",   team:"girls" },
  { id:"18", name:"Ella Hipkins",     team:"girls" },
  { id:"19", name:"Jade Schutte",     team:"girls" },
  { id:"20", name:"Leah Gfrerer",     team:"girls" },
  { id:"21", name:"Lilah Day",        team:"girls" },
  { id:"22", name:"Marian Steward",   team:"girls" },
  { id:"23", name:"Tristen Yost",     team:"girls" },
  { id:"24", name:"Vienna Lecher",    team:"girls" },
];

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
function exportAllCSV(races, rosterMap, date) {
  var rows = [["Race","Athlete","Team","Split #","Split Time","Total Time"]];
  races.forEach(function(race){
    (race.runnerIds||[]).forEach(function(rid){
      var ath = rosterMap[rid];
      var name = ath ? ath.name : "Unknown";
      var team = ath ? ath.team : "";
      var sp = (race.splits||{})[rid] || [];
      if (!sp.length) { rows.push([race.label, name, team, "", "", ""]); }
      else sp.forEach(function(s,i){ rows.push([race.label, name, team, i+1, fmtSplit(s.split), fmtTime(s.total)]); });
    });
  });
  var csv = rows.map(function(r){ return r.map(function(v){ return '"'+v+'"'; }).join(","); }).join("\n");
  var el = document.createElement("a");
  el.href = URL.createObjectURL(new Blob([csv], { type:"text/csv" }));
  el.download = "splits_" + date + ".csv";
  el.click();
}

// ─── PACE PILL ────────────────────────────────────────────────────────────────
function PacePill({ label, value, color }) {
  if (!value) return null;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:2, padding:"1px 5px",
      borderRadius:2, background:color+"14", border:"1px solid "+color+"35" }}>
      <span style={{ color:color, fontWeight:800, fontSize:9, letterSpacing:0.5 }}>{label}</span>
      <span style={{ color:"#aaa", fontFamily:"'Share Tech Mono',monospace", fontSize:10 }}>{value}</span>
    </span>
  );
}

// ─── RACE CARD (independent timer per race) ──────────────────────────────────
function RaceCard({ race, rosterMap, paces, onUpdateRace, onFinishRace, C }) {
  var [isRunning, setIsRunning] = useState(false);
  var [elapsed, setElapsed]     = useState(race.elapsed || 0);
  var [flashMap, setFlashMap]   = useState({});
  var startRef  = useRef(null);
  var pausedRef = useRef(race.elapsed || 0);
  var rafRef    = useRef(null);
  var elapsedRef = useRef(race.elapsed || 0);

  var tick = useCallback(function(){
    var now = Date.now() - startRef.current + pausedRef.current;
    elapsedRef.current = now; setElapsed(now);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  var startTimer = function(){ startRef.current = Date.now(); setIsRunning(true); rafRef.current = requestAnimationFrame(tick); };
  var pauseTimer = function(){
    cancelAnimationFrame(rafRef.current); pausedRef.current = elapsedRef.current; setIsRunning(false);
    onUpdateRace(race.id, { elapsed: elapsedRef.current, status: "paused" });
  };
  var resetRace = function(){
    cancelAnimationFrame(rafRef.current); setIsRunning(false); setElapsed(0);
    elapsedRef.current = 0; pausedRef.current = 0;
    onUpdateRace(race.id, { elapsed: 0, splits: {}, status: "ready" });
  };

  useEffect(function(){ return function(){ cancelAnimationFrame(rafRef.current); }; }, []);

  var recordSplit = function(rid){
    var now = elapsedRef.current;
    if (now === 0 && !isRunning) return;
    var prev = (race.splits||{})[rid] || [];
    var last = prev.length > 0 ? prev[prev.length-1].total : 0;
    var newSplits = Object.assign({}, race.splits||{});
    newSplits[rid] = prev.concat([{ split: now-last, total: now }]);
    onUpdateRace(race.id, { splits: newSplits, status: "running" });
    setFlashMap(function(p){ var n=Object.assign({},p); n[rid]=true; return n; });
    setTimeout(function(){ setFlashMap(function(p){ var n=Object.assign({},p); n[rid]=false; return n; }); }, 350);
  };

  var runners = (race.runnerIds||[]).map(function(rid){ return rosterMap[rid]; }).filter(Boolean);
  var hasSplits = runners.some(function(a){ return ((race.splits||{})[a.id]||[]).length > 0; });
  var evClr = EVENT_COLORS[race.event] || "#4a9eff";
  var teamClr = TEAM_COLORS[race.team] || evClr;
  var isDone = race.status === "done";

  return (
    <div style={{ borderRadius:6, border:"1px solid "+(isRunning?evClr+"66":"#141c2a"), background:isRunning?"#0c0f18":"#0b0f18",
      borderLeft:"3px solid "+evClr, overflow:"hidden", marginBottom:8, transition:"border-color 0.2s" }}>
      {/* Race header */}
      <div style={{ padding:"10px 12px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ fontSize:15, fontWeight:800, color:evClr }}>{race.event}</div>
          <span style={{ fontSize:12, fontWeight:700, color:teamClr,
            padding:"1px 8px", borderRadius:3, background:teamClr+"18", border:"1px solid "+teamClr+"33",
            textTransform:"uppercase", letterSpacing:1 }}>
            {race.team}
          </span>
          {race.approxTime?<span style={{ fontSize:10, color:"#2a3448" }}>{race.approxTime}</span>:null}
          <span style={{ fontSize:10, color:"#2a3448" }}>{runners.length} runners</span>
        </div>
        <div style={{ display:"flex", gap:4, alignItems:"center" }}>
          {isDone?<span style={{ fontSize:10, padding:"2px 8px", borderRadius:3, background:"#27ae6022", color:"#5ddb6a", fontWeight:700 }}>Done</span>:null}
          {hasSplits&&!isDone?<button onClick={function(){
            pauseTimer();
            onUpdateRace(race.id, { status:"done", elapsed: elapsedRef.current });
            if(onFinishRace) onFinishRace(race, elapsedRef.current);
          }}
            style={{ padding:"3px 8px", background:"#27ae6022", color:"#5ddb6a", border:"1px solid #27ae6044", borderRadius:3,
              cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit" }}>
            Finish
          </button>:null}
        </div>
      </div>

      {/* Timer bar */}
      <div style={{ padding:"6px 12px", background:"#050709", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:32, color:isRunning?"#fff":elapsed>0?evClr:"#2a3448",
          letterSpacing:2, lineHeight:1, transition:"color 0.3s" }}>
          {fmtTime(elapsed)}
        </div>
        <div style={{ display:"flex", gap:5 }}>
          {!isDone&&!isRunning ? (
            <button onClick={startTimer}
              style={{ padding:"6px 16px", background:evClr, color:"#07090e", border:"none", borderRadius:3,
                cursor:"pointer", fontSize:13, fontWeight:900, fontFamily:"inherit", letterSpacing:2 }}>
              {elapsed>0?"GO":"START"}
            </button>
          ) : !isDone ? (
            <button onClick={pauseTimer}
              style={{ padding:"6px 16px", background:"transparent", color:evClr, border:"1.5px solid "+evClr,
                borderRadius:3, cursor:"pointer", fontSize:13, fontWeight:900, fontFamily:"inherit", letterSpacing:2 }}>
              STOP
            </button>
          ) : null}
          <button onClick={resetRace}
            style={{ padding:"6px 10px", background:"transparent", color:"#2a3448", border:"1px solid #141c2a",
              borderRadius:3, cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit", letterSpacing:1 }}>
            Reset
          </button>
        </div>
      </div>

      {/* Runner tap grid */}
      <div style={{ padding:"6px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
          {runners.map(function(ath){
            var sp = (race.splits||{})[ath.id] || [];
            var last = sp[sp.length-1];
            var flash = flashMap[ath.id];
            var hasSp = sp.length > 0;
            var canClick = (isRunning || elapsed > 0) && !isDone;
            var p = paces[ath.name] || {};

            return (
              <button key={ath.id} onClick={function(){ if(canClick) recordSplit(ath.id); }}
                style={{
                  width:"100%", padding:"8px 10px",
                  background:flash?"#0c1f0e":"#0b0f18",
                  border:"1px solid "+(flash?"#2d7a35":hasSp?"#1a2e1a":"#141c2a"),
                  borderTop:"2px solid "+(flash?"#5ddb6a":hasSp?"#1e4a1e":teamClr+"44"),
                  borderRadius:4, cursor:canClick?"pointer":"default",
                  textAlign:"left", userSelect:"none", fontFamily:"inherit",
                  transition:"background 0.12s", display:"flex", flexDirection:"column", gap:2
                }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:4 }}>
                  <span style={{ fontSize:14, fontWeight:800, color:flash?"#5ddb6a":"white",
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flex:1, minWidth:0, lineHeight:1.1 }}>
                    {ath.name}
                  </span>
                  <span style={{ fontSize:16, fontWeight:900, lineHeight:1, color:hasSp?(flash?"#5ddb6a":"#FF5722"):"#141c2a", flexShrink:0 }}>
                    {sp.length}
                  </span>
                </div>
                <div style={{ minHeight:16 }}>
                  {last ? (
                    <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                      <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:15, color:flash?"#5ddb6a":"#3a9a48" }}>{fmtSplit(last.split)}</span>
                      <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"#2a3448" }}>{fmtTime(last.total)}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize:9, color:"#1a2235" }}>{canClick?"tap to split":isDone?"":"start timer"}</span>
                  )}
                </div>
                {(p.thrSafe||p.cv||p.vo2Safe) ? (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginTop:1 }}>
                    {p.thrSafe ? <PacePill label="T" value={p.thrSafe} color="#f0a500" /> : null}
                    {p.cv ? <PacePill label="CV" value={p.cv} color="#4a9eff" /> : null}
                    {p.vo2Safe ? <PacePill label="V2" value={p.vo2Safe} color="#e84393" /> : null}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Split log */}
        {hasSplits ? (
          <div style={{ marginTop:8 }}>
            <div style={{ fontSize:9, letterSpacing:3, color:"#2a3448", textTransform:"uppercase", marginBottom:4 }}>Split Log</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
              {runners.filter(function(a){ return ((race.splits||{})[a.id]||[]).length > 0; }).map(function(ath){
                var sp = (race.splits||{})[ath.id];
                return (
                  <div key={ath.id} style={{ background:"#080c14", border:"1px solid #0f151f", borderTop:"2px solid "+teamClr+"33", borderRadius:4, padding:"6px 8px" }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#FF5722", marginBottom:3 }}>{ath.name}</div>
                    {sp.map(function(s,i){
                      return (
                        <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"1px 0", borderTop:i>0?"1px solid #0f141e":"none" }}>
                          <span style={{ fontSize:9, color:"#2a3448", minWidth:16 }}>{"#"+(i+1)}</span>
                          <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:12, color:i===sp.length-1?"#ccc":"#555" }}>{fmtSplit(s.split)}</span>
                          <span style={{ fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"#2a3448" }}>{fmtTime(s.total)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function SplitTimer({ onRaceFinish, meets: parentMeets }) {
  var [screen, setScreen]         = useState("setup");
  var [allAthletes, setAllAthletes] = useState(DEFAULT_ATHLETES);
  var [races, setRaces]           = useState([]); // [{id, event, team, label, approxTime, runnerIds, splits, elapsed, status}]
  var [splitLabel, setSplitLabel] = useState("400m");
  var [customLabel, setCustomLabel] = useState("");
  var [activeRace, setActiveRace]   = useState(null); // race id to auto-scroll to

  // Firebase
  var [fbRoster, setFbRoster] = useState([]);
  var [fbMeets, setFbMeets]   = useState([]);
  var [fbPaces, setFbPaces]   = useState({});
  var [fbStatus, setFbStatus] = useState("connecting");
  var [importedMeetId, setImportedMeetId] = useState(null);

  var sessionDate = useRef(new Date().toISOString().slice(0,10)).current;

  var C = {
    bg:"#07090e", card:"#0b0f18", border:"#141c2a",
    orange:"#FF5722", green:"#27ae60", greenLight:"#5ddb6a",
    muted:"#2a3448", dim:"#141c2a", boys:"#4a9eff", girls:"#ff7eb3",
  };

  // Fonts
  useEffect(function(){
    var l = document.createElement("link");
    l.href = "https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;600;700;800;900&display=swap";
    l.rel = "stylesheet"; document.head.appendChild(l);
    return function(){ document.head.removeChild(l); };
  }, []);

  // Firebase load
  useEffect(function(){
    setFbStatus("connecting");
    loadData("roster-v3").then(function(val){
      var raw=val?JSON.parse(val):null;
      if (!Array.isArray(raw)) { setFbStatus("offline"); return; }
      setFbRoster(raw);
      var pm = {};
      raw.forEach(function(a){ if (a.name && a.paces) pm[a.name] = a.paces; });
      setFbPaces(pm);
      setFbStatus("ok");
      setAllAthletes(raw
        .filter(function(a){ return a.name && !a.name.toLowerCase().includes("coach"); })
        .map(function(a){ return { id: String(a.id || a.name), name: a.name, team: a.team || "boys" }; })
      );
    }).catch(function(){ setFbStatus("offline"); });
    loadData("meets-v2").then(function(val){
      var raw=val?JSON.parse(val):null;
      if (Array.isArray(raw)) setFbMeets(raw);
    }).catch(function(){});
  }, []);

  // LocalStorage
  useEffect(function(){
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      var d = JSON.parse(saved);
      if (d.races && d.races.length > 0) {
        setRaces(d.races);
        if (d.splitLabel) setSplitLabel(d.splitLabel);
        if (d.customLabel) setCustomLabel(d.customLabel);
        setScreen("race");
      }
    } catch(e){}
  }, []);

  useEffect(function(){
    if (!races.length) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ races:races, splitLabel:splitLabel, customLabel:customLabel, savedAt:Date.now() })); } catch(e){}
  }, [races, splitLabel, customLabel]);

  // Roster map
  var rosterMap = {};
  allAthletes.forEach(function(a){ rosterMap[String(a.id)] = a; });

  var label = customLabel.trim() || splitLabel;

  // Update a single race
  var updateRace = function(raceId, updates){
    setRaces(function(prev){ return prev.map(function(r){ return r.id===raceId ? Object.assign({}, r, updates) : r; }); });
  };

  // Import meet → create race cards (one per event × team)
  var importMeetEvents = function(meet){
    if (!meet || !meet.lineup) return;
    var fbIdToName = {};
    fbRoster.forEach(function(a){ if (a.id) fbIdToName[String(a.id)] = a.name; });
    var nameToLocalId = {};
    allAthletes.forEach(function(a){ nameToLocalId[a.name] = String(a.id); });
    var athTeam = {};
    allAthletes.forEach(function(a){ athTeam[String(a.id)] = a.team; });

    var newRaces = [];
    Object.entries(meet.lineup).forEach(function(entry){
      var evtKey = entry[0];
      var evtData = entry[1];
      var allRunnerIds = (evtData.runners || []).map(function(rid){ return String(rid); });
      if (!allRunnerIds.length) return;

      // Split into boys and girls
      var boysIds = allRunnerIds.filter(function(rid){ return athTeam[rid] === "boys"; });
      var girlsIds = allRunnerIds.filter(function(rid){ return athTeam[rid] === "girls"; });

      if (boysIds.length > 0) {
        newRaces.push({
          id: "race_"+evtKey+"_boys_"+Date.now(),
          event: evtKey, team: "boys",
          label: evtKey + " Boys",
          approxTime: evtData.approxTime || "",
          runnerIds: boysIds, splits: {}, elapsed: 0, status: "ready",
          meetName: meet.name || "Meet", meetId: meet.id || "", meetDate: meet.date || ""
        });
      }
      if (girlsIds.length > 0) {
        newRaces.push({
          id: "race_"+evtKey+"_girls_"+Date.now()+1,
          event: evtKey, team: "girls",
          label: evtKey + " Girls",
          approxTime: evtData.approxTime || "",
          runnerIds: girlsIds, splits: {}, elapsed: 0, status: "ready",
          meetName: meet.name || "Meet", meetId: meet.id || "", meetDate: meet.date || ""
        });
      }
    });

    // Sort: 4x800 → 800 → 1600 → 3200, boys before girls
    var evtOrder = {"4x800":0,"800":1,"1600":2,"3200":3};
    newRaces.sort(function(a,b){
      var ea = evtOrder[a.event] !== undefined ? evtOrder[a.event] : 9;
      var eb = evtOrder[b.event] !== undefined ? evtOrder[b.event] : 9;
      if (ea !== eb) return ea - eb;
      return a.team === "boys" ? -1 : 1;
    });

    setRaces(newRaces);
    setImportedMeetId(meet.id || meet.name);
  };

  // Add manual race
  var addManualRace = function(event, team, runnerIds){
    setRaces(function(prev){
      return prev.concat([{
        id: "race_"+event+"_"+team+"_"+Date.now(),
        event: event, team: team,
        label: event + " " + (team==="boys"?"Boys":"Girls"),
        approxTime: "", runnerIds: runnerIds, splits: {}, elapsed: 0, status: "ready"
      }]);
    });
  };

  var resetAll = function(){
    setRaces([]); setImportedMeetId(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch(e){}
  };

  var handleFinishRace = function(race, finalElapsed){
    /* Build result data for parent */
    var runners = (race.runnerIds||[]).map(function(rid){
      var ath = rosterMap[rid];
      var sp = (race.splits||{})[rid] || [];
      var finalTime = sp.length > 0 ? sp[sp.length-1].total : finalElapsed;
      return { id: rid, name: ath ? ath.name : "Unknown", team: ath ? ath.team : "", splits: sp, finalTime: finalTime };
    });
    if (onRaceFinish) {
      onRaceFinish({
        meetId: race.meetId || "",
        meetName: race.meetName || "Practice",
        meetDate: race.meetDate || sessionDate,
        event: race.event,
        team: race.team,
        runners: runners,
        elapsed: finalElapsed
      });
    }
  };

  var meetsWithLineups = fbMeets.filter(function(m){
    if (!m || !m.lineup) return false;
    return Object.values(m.lineup).some(function(e){ return (e.runners||[]).length > 0; });
  });

  // ── SETUP SCREEN ──────────────────────────────────────────────────────────
  if (screen === "setup") {
    return (
      <div style={{ background:C.bg, minHeight:"100vh", fontFamily:"'Barlow Condensed',sans-serif", color:"white" }}>
        <div style={{ padding:"12px 14px", borderBottom:"1px solid "+C.border, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:3, height:26, background:C.orange, borderRadius:2 }} />
          <div>
            <div style={{ fontSize:9, letterSpacing:4, color:C.orange, textTransform:"uppercase" }}>Concordia Beacons</div>
            <div style={{ fontSize:20, fontWeight:800, lineHeight:1 }}>Split Timer</div>
          </div>
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background: fbStatus==="ok" ? C.green : fbStatus==="connecting" ? "#f0a500" : C.muted }} />
            <span style={{ fontSize:9, color:C.muted, letterSpacing:1 }}>
              {fbStatus==="ok" ? "FIREBASE LIVE" : fbStatus==="connecting" ? "CONNECTING" : "OFFLINE"}
            </span>
          </div>
        </div>

        <div style={{ padding:"16px 14px", maxWidth:600, margin:"0 auto" }}>
          {/* Split distance label */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:9, letterSpacing:4, color:C.orange, textTransform:"uppercase", marginBottom:8 }}>Split Distance</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
              {PRESET_DISTANCES.map(function(d){
                var on = splitLabel === d && !customLabel.trim();
                return (
                  <button key={d} onClick={function(){ setSplitLabel(d); setCustomLabel(""); }}
                    style={{ padding:"5px 10px", borderRadius:3, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700,
                      background:on?C.orange:"transparent", color:on?C.bg:C.muted, border:"1px solid "+(on?C.orange:C.dim) }}>
                    {d}
                  </button>
                );
              })}
            </div>
            <input value={customLabel} onChange={function(e){ setCustomLabel(e.target.value); }}
              placeholder="Custom label..."
              style={{ width:"100%", boxSizing:"border-box", background:C.card, border:"1px solid "+(customLabel.trim()?C.orange:C.border), color:"white", padding:"8px 12px", borderRadius:3, fontSize:14, fontFamily:"inherit", outline:"none" }} />
          </div>

          {/* Import from meet */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:9, letterSpacing:4, color:C.orange, textTransform:"uppercase", marginBottom:8 }}>Import Races from Meet</div>
            {meetsWithLineups.length === 0 ? (
              <div style={{ fontSize:12, color:C.muted, fontStyle:"italic", padding:"12px", background:C.card, borderRadius:4, border:"1px solid "+C.border }}>
                {fbStatus==="ok" ? "No meets with race lineups. Assign runners on the Meet Schedule tab first." : "Connecting to Firebase..."}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {meetsWithLineups.map(function(meet){
                  var isActive = importedMeetId === (meet.id || meet.name);
                  var evts = Object.entries(meet.lineup||{}).filter(function(e){ return (e[1].runners||[]).length > 0; });
                  var boysCount = 0; var girlsCount = 0;
                  evts.forEach(function(e){
                    e[1].runners.forEach(function(rid){
                      var a = allAthletes.find(function(x){ return String(x.id)===String(rid); });
                      if (a && a.team==="boys") boysCount++;
                      if (a && a.team==="girls") girlsCount++;
                    });
                  });
                  return (
                    <div key={meet.id||meet.name} style={{ background:C.card, border:"1px solid "+(isActive?"#2d7a35":C.border), borderRadius:4, padding:"10px 12px" }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
                        <div>
                          <div style={{ fontSize:14, fontWeight:800, color:"white" }}>{meet.name || "Meet"}</div>
                          <div style={{ fontSize:10, color:C.muted }}>{meet.date||""} — {evts.map(function(e){return e[0];}).join(", ")} — {boysCount}B/{girlsCount}G</div>
                        </div>
                        <button onClick={function(){ importMeetEvents(meet); }}
                          style={{ padding:"6px 14px", background:isActive?"#1a3a1a":C.orange, color:isActive?C.greenLight:C.bg,
                            border:"1px solid "+(isActive?"#2d7a35":C.orange), borderRadius:3, cursor:"pointer",
                            fontSize:12, fontWeight:900, fontFamily:"inherit", letterSpacing:1, textTransform:"uppercase" }}>
                          {isActive ? "\u2713 Imported" : "Import"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Race preview */}
          {races.length > 0 ? (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:9, letterSpacing:4, color:C.orange, textTransform:"uppercase", marginBottom:8 }}>Race Cards ({races.length})</div>
              {races.map(function(r){
                var evClr = EVENT_COLORS[r.event] || "#4a9eff";
                var tClr = TEAM_COLORS[r.team] || evClr;
                var count = (r.runnerIds||[]).length;
                return (
                  <div key={r.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", marginBottom:4,
                    background:C.card, border:"1px solid "+C.border, borderLeft:"3px solid "+evClr, borderRadius:4 }}>
                    <span style={{ fontSize:13, fontWeight:800, color:evClr }}>{r.event}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:tClr, padding:"1px 6px", borderRadius:3, background:tClr+"18" }}>{r.team}</span>
                    <span style={{ fontSize:10, color:C.muted, flex:1 }}>{count} runner{count!==1?"s":""}</span>
                    <button onClick={function(){ setRaces(function(prev){ return prev.filter(function(x){ return x.id!==r.id; }); }); }}
                      style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:12 }}>{"\u00D7"}</button>
                  </div>
                );
              })}
              <button onClick={resetAll} style={{ marginTop:6, padding:"4px 10px", background:"transparent", color:C.muted,
                border:"1px solid "+C.dim, borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>
                Clear All
              </button>
            </div>
          ) : null}

          {/* Begin button */}
          <button onClick={function(){ if(races.length) setScreen("race"); }}
            disabled={!races.length}
            style={{ width:"100%", padding:"14px", borderRadius:3, cursor:races.length?"pointer":"not-allowed",
              background:races.length?C.orange:C.card, color:races.length?C.bg:C.muted,
              border:"1px solid "+(races.length?C.orange:C.border),
              fontSize:16, fontWeight:900, fontFamily:"inherit", letterSpacing:3, textTransform:"uppercase" }}>
            {races.length ? "Begin Session \u2192" : "Import a meet first"}
          </button>
        </div>
      </div>
    );
  }

  // ── RACE SCREEN ───────────────────────────────────────────────────────────
  var hasSplits = races.some(function(r){ return Object.keys(r.splits||{}).length > 0; });

  return (
    <div style={{ background:C.bg, minHeight:"100vh", fontFamily:"'Barlow Condensed',sans-serif", color:"white" }}>
      {/* Header */}
      <div style={{ padding:"10px 14px", borderBottom:"1px solid "+C.border, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:C.bg, zIndex:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={function(){ setScreen("setup"); }}
            style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:10, fontFamily:"inherit", letterSpacing:2, textTransform:"uppercase", padding:0 }}>
            {"\u2190"} Setup
          </button>
          <span style={{ fontSize:12, fontWeight:800, color:C.orange, letterSpacing:2, textTransform:"uppercase" }}>{label}</span>
        </div>
        <div style={{ display:"flex", gap:5 }}>
          {hasSplits ? (
            <button onClick={function(){ exportAllCSV(races, rosterMap, sessionDate); }}
              style={{ padding:"3px 9px", background:"transparent", color:C.green, border:"1px solid #1a3a1a", borderRadius:3,
                cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"inherit", letterSpacing:1, textTransform:"uppercase" }}>
              CSV
            </button>
          ) : null}
        </div>
      </div>

      {/* Race cards */}
      <div style={{ padding:"8px 10px" }}>
        {races.map(function(race){
          return <RaceCard key={race.id} race={race} rosterMap={rosterMap} paces={fbPaces}
            onUpdateRace={updateRace} onFinishRace={handleFinishRace} C={C} />;
        })}
      </div>
    </div>
  );
}
