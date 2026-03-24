import { useState, useEffect, useRef, useCallback } from "react";
import { loadData } from "./firebase.js";

var pad=function(n){return String(n).padStart(2,"0");};
var fmtTime=function(ms){if(ms<0)ms=0;return pad(Math.floor(ms/60000))+":"+pad(Math.floor((ms%60000)/1000))+"."+pad(Math.floor((ms%1000)/10));};
var fmtSplit=function(ms){if(ms<0)ms=0;return ms<60000?Math.floor(ms/1000)+"."+pad(Math.floor((ms%1000)/10)):fmtTime(ms);};

var STORAGE_KEY="beacon_split_v5";
var PRESET_DISTANCES=["200m","400m","800m","1200m","1600m","Half Mile","1 Mile","3K","5K"];
var EVENT_COLORS={"800":"#F39C12","1600":"#D4A017","3200":"#27ae60","4x800":"#a855f7"};
var TEAM_COLORS={boys:"#4a9eff",girls:"#ff7eb3"};
var GROUP_COLORS=["#FF5722","#4a9eff","#ff7eb3","#27ae60","#f0a500","#a855f7","#14b8a6","#f43f5e","#fb923c","#84cc16"];
var PACE_KEYS=[{k:"thrSafe",l:"LT Safe"},{k:"thrMed",l:"LT Med"},{k:"cv",l:"CV"},{k:"vo2Safe",l:"VO2 Safe"},{k:"vo2Med",l:"VO2 Med"}];

function PacePill(props){
  if(!props.value)return null;
  return(<span style={{display:"inline-flex",alignItems:"center",gap:2,padding:"1px 5px",borderRadius:2,background:props.color+"14",border:"1px solid "+props.color+"35"}}>
    <span style={{color:props.color,fontWeight:800,fontSize:9,letterSpacing:0.5}}>{props.label}</span>
    <span style={{color:"#aaa",fontFamily:"'Share Tech Mono',monospace",fontSize:10}}>{props.value}</span>
  </span>);
}

/* ─── RACE CARD ──────────────────────────────────────────────────────────── */
function RaceCard(props){
  var race=props.race,rosterMap=props.rosterMap,paces=props.paces,onUpdateRace=props.onUpdateRace,onFinishRace=props.onFinishRace,C=props.C;
  var _r=useState(false);var isRunning=_r[0];var setIsRunning=_r[1];
  var _e=useState(race.elapsed||0);var elapsed=_e[0];var setElapsed=_e[1];
  var _f=useState({});var flashMap=_f[0];var setFlashMap=_f[1];
  var startRef=useRef(null);var pausedRef=useRef(race.elapsed||0);var rafRef=useRef(null);var elapsedRef=useRef(race.elapsed||0);

  var tick=useCallback(function(){var now=Date.now()-startRef.current+pausedRef.current;elapsedRef.current=now;setElapsed(now);rafRef.current=requestAnimationFrame(tick);},[]);
  var startTimer=function(){startRef.current=Date.now();setIsRunning(true);rafRef.current=requestAnimationFrame(tick);};
  var pauseTimer=function(){cancelAnimationFrame(rafRef.current);pausedRef.current=elapsedRef.current;setIsRunning(false);onUpdateRace(race.id,{elapsed:elapsedRef.current,status:"paused"});};
  var resetRace=function(){cancelAnimationFrame(rafRef.current);setIsRunning(false);setElapsed(0);elapsedRef.current=0;pausedRef.current=0;onUpdateRace(race.id,{elapsed:0,splits:{},status:"ready"});};
  useEffect(function(){return function(){cancelAnimationFrame(rafRef.current);};},[]);

  var recordSplit=function(rid){var now=elapsedRef.current;if(now===0&&!isRunning)return;var prev=(race.splits||{})[rid]||[];var last=prev.length>0?prev[prev.length-1].total:0;var ns=Object.assign({},race.splits||{});ns[rid]=prev.concat([{split:now-last,total:now}]);onUpdateRace(race.id,{splits:ns,status:"running"});setFlashMap(function(p){var n=Object.assign({},p);n[rid]=true;return n;});setTimeout(function(){setFlashMap(function(p){var n=Object.assign({},p);n[rid]=false;return n;});},350);};

  var runners=(race.runnerIds||[]).map(function(rid){return rosterMap[rid]||rosterMap[String(rid)];}).filter(Boolean);
  var hasSplits=runners.some(function(a){return((race.splits||{})[a.id]||[]).length>0;});
  var evClr=EVENT_COLORS[race.event]||race.color||"#4a9eff";
  var teamClr=TEAM_COLORS[race.team]||evClr;
  var isDone=race.status==="done";

  return(<div style={{borderRadius:6,border:"1px solid "+(isRunning?evClr+"66":"#141c2a"),background:isRunning?"#0c0f18":"#0b0f18",borderLeft:"3px solid "+evClr,overflow:"hidden",marginBottom:8}}>
    <div style={{padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <div style={{fontSize:15,fontWeight:800,color:evClr}}>{race.label||race.event}</div>
        {race.team?<span style={{fontSize:11,fontWeight:700,color:teamClr,padding:"1px 8px",borderRadius:3,background:teamClr+"18",textTransform:"uppercase",letterSpacing:1}}>{race.team}</span>:null}
        <span style={{fontSize:10,color:"#2a3448"}}>{runners.length} runners</span>
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        {isDone?<span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:"#27ae6022",color:"#5ddb6a",fontWeight:700}}>Done</span>:null}
        {hasSplits&&!isDone?<button onClick={function(){pauseTimer();onUpdateRace(race.id,{status:"done",elapsed:elapsedRef.current});if(onFinishRace)onFinishRace(race,elapsedRef.current);}} style={{padding:"3px 8px",background:"#27ae6022",color:"#5ddb6a",border:"1px solid #27ae6044",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>Finish</button>:null}
      </div>
    </div>
    <div style={{padding:"6px 12px",background:"#050709",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:32,color:isRunning?"#fff":elapsed>0?evClr:"#2a3448",letterSpacing:2,lineHeight:1}}>{fmtTime(elapsed)}</div>
      <div style={{display:"flex",gap:5}}>
        {!isDone&&!isRunning?<button onClick={startTimer} style={{padding:"6px 16px",background:evClr,color:"#07090e",border:"none",borderRadius:3,cursor:"pointer",fontSize:13,fontWeight:900,fontFamily:"inherit",letterSpacing:2}}>{elapsed>0?"GO":"START"}</button>:!isDone?<button onClick={pauseTimer} style={{padding:"6px 16px",background:"transparent",color:evClr,border:"1.5px solid "+evClr,borderRadius:3,cursor:"pointer",fontSize:13,fontWeight:900,fontFamily:"inherit",letterSpacing:2}}>STOP</button>:null}
        <button onClick={resetRace} style={{padding:"6px 10px",background:"transparent",color:"#2a3448",border:"1px solid #141c2a",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>Reset</button>
      </div>
    </div>
    <div style={{padding:"6px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
        {runners.map(function(ath){var sp=(race.splits||{})[ath.id]||[];var last=sp[sp.length-1];var flash=flashMap[ath.id];var hasSp=sp.length>0;var canClick=(isRunning||elapsed>0)&&!isDone;var p=paces[ath.name]||{};
          return(<button key={ath.id} onClick={function(){if(canClick)recordSplit(ath.id);}} style={{width:"100%",padding:"8px 10px",background:flash?"#0c1f0e":"#0b0f18",border:"1px solid "+(flash?"#2d7a35":hasSp?"#1a2e1a":"#141c2a"),borderTop:"2px solid "+(flash?"#5ddb6a":hasSp?"#1e4a1e":teamClr+"44"),borderRadius:4,cursor:canClick?"pointer":"default",textAlign:"left",userSelect:"none",fontFamily:"inherit",display:"flex",flexDirection:"column",gap:2}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:4}}>
              <span style={{fontSize:14,fontWeight:800,color:flash?"#5ddb6a":"white",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flex:1,minWidth:0,lineHeight:1.1}}>{ath.name}</span>
              <span style={{fontSize:16,fontWeight:900,lineHeight:1,color:hasSp?(flash?"#5ddb6a":"#FF5722"):"#141c2a",flexShrink:0}}>{sp.length}</span>
            </div>
            <div style={{minHeight:16}}>{last?<div style={{display:"flex",alignItems:"baseline",gap:5}}><span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:15,color:flash?"#5ddb6a":"#3a9a48"}}>{fmtSplit(last.split)}</span><span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:"#2a3448"}}>{fmtTime(last.total)}</span></div>:<span style={{fontSize:9,color:"#1a2235"}}>{canClick?"tap to split":isDone?"":"start timer"}</span>}</div>
            {(p.thrSafe||p.cv||p.vo2Safe)?<div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:1}}>{p.thrSafe?<PacePill label="T" value={p.thrSafe} color="#f0a500"/>:null}{p.cv?<PacePill label="CV" value={p.cv} color="#4a9eff"/>:null}{p.vo2Safe?<PacePill label="V2" value={p.vo2Safe} color="#e84393"/>:null}</div>:null}
          </button>);
        })}
      </div>
      {hasSplits?<div style={{marginTop:8}}><div style={{fontSize:9,letterSpacing:3,color:"#2a3448",textTransform:"uppercase",marginBottom:4}}>Split Log</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
          {runners.filter(function(a){return((race.splits||{})[a.id]||[]).length>0;}).map(function(ath){var sp=(race.splits||{})[ath.id];return(<div key={ath.id} style={{background:"#080c14",border:"1px solid #0f151f",borderTop:"2px solid "+teamClr+"33",borderRadius:4,padding:"6px 8px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#FF5722",marginBottom:3}}>{ath.name}</div>
            {sp.map(function(s,i){return(<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"1px 0",borderTop:i>0?"1px solid #0f141e":"none"}}><span style={{fontSize:9,color:"#2a3448"}}>{"#"+(i+1)}</span><span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:i===sp.length-1?"#ccc":"#555"}}>{fmtSplit(s.split)}</span><span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:"#2a3448"}}>{fmtTime(s.total)}</span></div>);})}
          </div>);})}
        </div>
      </div>:null}
    </div>
  </div>);
}

/* ─── MAIN ───────────────────────────────────────────────────────────────── */
export default function SplitTimer(props){
  var onRaceFinish=props.onRaceFinish;var parentMeets=props.meets||[];var parentRoster=props.roster||[];var raceResults=props.raceResults||[];
  var _scr=useState("setup");var screen=_scr[0];var setScreen=_scr[1];
  var _mode=useState("meet");var mode=_mode[0];var setMode=_mode[1]; /* meet | workout */
  var _ath=useState([]);var allAthletes=_ath[0];var setAllAthletes=_ath[1];
  var _races=useState([]);var races=_races[0];var setRaces=_races[1];
  var _sl=useState("400m");var splitLabel=_sl[0];var setSplitLabel=_sl[1];
  var _cl=useState("");var customLabel=_cl[0];var setCustomLabel=_cl[1];
  var _woName=useState("");var woName=_woName[0];var setWoName=_woName[1];
  var _fbPaces=useState({});var fbPaces=_fbPaces[0];var setFbPaces=_fbPaces[1];
  var _fbStatus=useState("connecting");var fbStatus=_fbStatus[0];var setFbStatus=_fbStatus[1];
  var _impMeet=useState(null);var importedMeetId=_impMeet[0];var setImportedMeetId=_impMeet[1];
  var _histOpen=useState(false);var histOpen=_histOpen[0];var setHistOpen=_histOpen[1];
  /* Workout group state */
  var _woGroups=useState([]);var woGroups=_woGroups[0];var setWoGroups=_woGroups[1]; /* [{id,name,color,runnerIds}] */
  var _newGrpName=useState("");var newGrpName=_newGrpName[0];var setNewGrpName=_newGrpName[1];
  var _paceKey=useState("thrSafe");var paceKey=_paceKey[0];var setPaceKey=_paceKey[1];
  var _paceTol=useState(14);var paceTol=_paceTol[0];var setPaceTol=_paceTol[1];

  var sessionDate=useRef(new Date().toISOString().slice(0,10)).current;
  var C={bg:"#07090e",card:"#0b0f18",border:"#141c2a",orange:"#FF5722",green:"#27ae60",greenLight:"#5ddb6a",muted:"#2a3448",dim:"#141c2a",boys:"#4a9eff",girls:"#ff7eb3"};

  useEffect(function(){var l=document.createElement("link");l.href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;600;700;800;900&display=swap";l.rel="stylesheet";document.head.appendChild(l);return function(){document.head.removeChild(l);};},[]);

  /* Load roster from parent or Firebase */
  useEffect(function(){
    if(parentRoster.length>0){
      var clean=parentRoster.filter(function(a){return a.name&&!a.name.toLowerCase().includes("coach");}).map(function(a){return{id:String(a.id),name:a.name,team:a.team||"boys"};});
      setAllAthletes(clean);
      var pm={};parentRoster.forEach(function(a){if(a.name&&a.paces)pm[a.name]=a.paces;});
      setFbPaces(pm);setFbStatus("ok");
    } else {
      loadData("roster-v3").then(function(val){
        var raw=val?JSON.parse(val):null;
        if(!Array.isArray(raw)){setFbStatus("offline");return;}
        var pm={};raw.forEach(function(a){if(a.name&&a.paces)pm[a.name]=a.paces;});setFbPaces(pm);setFbStatus("ok");
        setAllAthletes(raw.filter(function(a){return a.name&&!a.name.toLowerCase().includes("coach");}).map(function(a){return{id:String(a.id),name:a.name,team:a.team||"boys"};}));
      }).catch(function(){setFbStatus("offline");});
    }
  },[parentRoster]);

  /* LocalStorage restore */
  useEffect(function(){try{var saved=localStorage.getItem(STORAGE_KEY);if(!saved)return;var d=JSON.parse(saved);if(d.races&&d.races.length>0){setRaces(d.races);if(d.splitLabel)setSplitLabel(d.splitLabel);if(d.customLabel)setCustomLabel(d.customLabel);if(d.mode)setMode(d.mode);setScreen("race");}}catch(e){}},[]);
  useEffect(function(){if(!races.length)return;try{localStorage.setItem(STORAGE_KEY,JSON.stringify({races:races,splitLabel:splitLabel,customLabel:customLabel,mode:mode,savedAt:Date.now()}));}catch(e){}},[races,splitLabel,customLabel,mode]);

  var rosterMap={};allAthletes.forEach(function(a){rosterMap[String(a.id)]=a;});
  var label=customLabel.trim()||splitLabel;
  var boys=allAthletes.filter(function(a){return a.team==="boys";});
  var girls=allAthletes.filter(function(a){return a.team==="girls";});

  var updateRace=function(raceId,updates){setRaces(function(prev){return prev.map(function(r){return r.id===raceId?Object.assign({},r,updates):r;});});};

  var handleFinishRace=function(race,finalElapsed){
    var runners=(race.runnerIds||[]).map(function(rid){var ath=rosterMap[String(rid)];var sp=(race.splits||{})[rid]||[];var ft=sp.length>0?sp[sp.length-1].total:finalElapsed;return{id:rid,name:ath?ath.name:"Unknown",team:ath?ath.team:"",splits:sp,finalTime:ft};});
    if(onRaceFinish){onRaceFinish({meetId:race.meetId||"",meetName:race.meetName||(mode==="workout"?(woName||"Workout"):"Practice"),meetDate:race.meetDate||sessionDate,event:race.event||race.label||label,team:race.team||"",runners:runners,elapsed:finalElapsed,type:mode});}
  };

  /* Pace grouping */
  var parsePace=function(s){if(!s)return null;var clean=s.replace(/\/mi$/,"").trim();var pts=clean.split(":");if(pts.length!==2)return null;var m=parseInt(pts[0]);var sc=parseInt(pts[1]);if(isNaN(m)||isNaN(sc))return null;return m*60+sc;};
  var fmtPaceSec=function(s){var m=Math.floor(s/60);var sc=Math.round(s%60);return m+":"+(sc<10?"0":"")+sc;};

  var importPaceGroups=function(){
    var withPace=allAthletes.map(function(a){var p=fbPaces[a.name];return{ath:a,sec:parsePace(p&&p[paceKey])};}).filter(function(x){return x.sec!==null;}).sort(function(a,b){return a.sec-b.sec;});
    var used={};var groups=[];
    for(var i=0;i<withPace.length;i++){
      if(used[withPace[i].ath.id])continue;
      var grp=[withPace[i]];used[withPace[i].ath.id]=true;
      for(var j=i+1;j<withPace.length;j++){if(used[withPace[j].ath.id])continue;if(withPace[j].sec-grp[grp.length-1].sec<=paceTol){grp.push(withPace[j]);used[withPace[j].ath.id]=true;}}
      var avg=Math.round(grp.reduce(function(s,x){return s+x.sec;},0)/grp.length);
      groups.push({id:"pg_"+Date.now()+"_"+i,name:fmtPaceSec(avg)+"/mi",color:GROUP_COLORS[groups.length%GROUP_COLORS.length],runnerIds:grp.map(function(x){return String(x.ath.id);})});
    }
    setWoGroups(groups);
  };

  /* Import meet → race cards */
  var importMeetEvents=function(meet){
    if(!meet||!meet.lineup)return;
    var athTeam={};allAthletes.forEach(function(a){athTeam[String(a.id)]=a.team;});
    var newRaces=[];
    var evtOrder={"4x800":0,"800":1,"1600":2,"3200":3};
    Object.entries(meet.lineup).forEach(function(entry){
      var evtKey=entry[0];var evtData=entry[1];var allIds=(evtData.runners||[]).map(function(r){return String(r);});if(!allIds.length)return;
      var bIds=allIds.filter(function(r){return athTeam[r]==="boys";});
      var gIds=allIds.filter(function(r){return athTeam[r]==="girls";});
      if(bIds.length>0)newRaces.push({id:"r_"+evtKey+"_b_"+Date.now(),event:evtKey,team:"boys",label:evtKey+" Boys",approxTime:evtData.approxTime||"",runnerIds:bIds,splits:{},elapsed:0,status:"ready",meetName:meet.name||"Meet",meetId:meet.id||"",meetDate:meet.date||""});
      if(gIds.length>0)newRaces.push({id:"r_"+evtKey+"_g_"+Date.now()+1,event:evtKey,team:"girls",label:evtKey+" Girls",approxTime:evtData.approxTime||"",runnerIds:gIds,splits:{},elapsed:0,status:"ready",meetName:meet.name||"Meet",meetId:meet.id||"",meetDate:meet.date||""});
    });
    newRaces.sort(function(a,b){var ea=evtOrder[a.event]!==undefined?evtOrder[a.event]:9;var eb=evtOrder[b.event]!==undefined?evtOrder[b.event]:9;return ea!==eb?ea-eb:a.team==="boys"?-1:1;});
    setRaces(newRaces);setImportedMeetId(meet.id||meet.name);
  };

  /* Create workout race cards from woGroups */
  var startWorkout=function(){
    var name=woName.trim()||"Workout";
    var newRaces=woGroups.map(function(g,gi){return{id:"wo_"+Date.now()+"_"+gi,event:name,team:"",label:g.name,color:g.color,runnerIds:g.runnerIds,splits:{},elapsed:0,status:"ready",meetName:name,meetDate:sessionDate,type:"workout"};});
    setRaces(newRaces);
  };

  var resetAll=function(){setRaces([]);setImportedMeetId(null);try{localStorage.removeItem(STORAGE_KEY);}catch(e){}};

  var meetsWithLineups=(parentMeets.length>0?parentMeets:[]).filter(function(m){return m&&m.lineup&&Object.values(m.lineup).some(function(e){return(e.runners||[]).length>0;});});

  /* ── HISTORY ── */
  var histBySession={};
  raceResults.forEach(function(r){var key=(r.meetName||"Session")+" — "+(r.meetDate||"");if(!histBySession[key])histBySession[key]={name:r.meetName||"Session",date:r.meetDate||"",type:r.type||"meet",races:[]};histBySession[key].races.push(r);});
  var histKeys=Object.keys(histBySession).sort(function(a,b){return(histBySession[b].date||"").localeCompare(histBySession[a].date||"");});

  /* ── SETUP SCREEN ── */
  if(screen==="setup"){
    return(<div style={{background:C.bg,minHeight:"100vh",fontFamily:"'Barlow Condensed',sans-serif",color:"white"}}>
      <div style={{padding:"12px 14px",borderBottom:"1px solid "+C.border,display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:3,height:26,background:C.orange,borderRadius:2}}/>
        <div><div style={{fontSize:9,letterSpacing:4,color:C.orange,textTransform:"uppercase"}}>Concordia Beacons</div><div style={{fontSize:20,fontWeight:800,lineHeight:1}}>Split Timer</div></div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:fbStatus==="ok"?C.green:fbStatus==="connecting"?"#f0a500":C.muted}}/>
          <span style={{fontSize:9,color:C.muted,letterSpacing:1}}>{fbStatus==="ok"?"LIVE":fbStatus==="connecting"?"...":"OFFLINE"}</span>
        </div>
      </div>
      <div style={{padding:"16px 14px",maxWidth:600,margin:"0 auto"}}>

        {/* Mode toggle */}
        <div style={{display:"flex",borderBottom:"2px solid "+C.border,marginBottom:16}}>
          {[{k:"meet",l:"Meet Races"},{k:"workout",l:"Workout"}].map(function(m){return(<button key={m.k} onClick={function(){setMode(m.k);}} style={{padding:"8px 16px",background:"none",border:"none",borderBottom:"2px solid "+(mode===m.k?C.orange:"transparent"),color:mode===m.k?C.orange:C.muted,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:-2}}>{m.l}</button>);})}
        </div>

        {/* Split distance */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:9,letterSpacing:4,color:C.orange,textTransform:"uppercase",marginBottom:6}}>Split Distance</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:6}}>
            {PRESET_DISTANCES.map(function(d){var on=splitLabel===d&&!customLabel.trim();return(<button key={d} onClick={function(){setSplitLabel(d);setCustomLabel("");}} style={{padding:"4px 10px",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,background:on?C.orange:"transparent",color:on?C.bg:C.muted,border:"1px solid "+(on?C.orange:C.dim)}}>{d}</button>);})}
          </div>
          <input value={customLabel} onChange={function(e){setCustomLabel(e.target.value);}} placeholder="Custom label..." style={{width:"100%",boxSizing:"border-box",background:C.card,border:"1px solid "+(customLabel.trim()?C.orange:C.border),color:"white",padding:"6px 12px",borderRadius:3,fontSize:13,fontFamily:"inherit",outline:"none"}}/>
        </div>

        {/* ── MEET MODE ── */}
        {mode==="meet"?(<div>
          <div style={{fontSize:9,letterSpacing:4,color:C.orange,textTransform:"uppercase",marginBottom:8}}>Import from Meet Schedule</div>
          {meetsWithLineups.length===0?<div style={{fontSize:12,color:C.muted,fontStyle:"italic",padding:"12px",background:C.card,borderRadius:4,border:"1px solid "+C.border}}>No meets with lineups. Assign runners on Meet Schedule first.</div>:
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {meetsWithLineups.map(function(meet){var isA=importedMeetId===(meet.id||meet.name);var evts=Object.entries(meet.lineup||{}).filter(function(e){return(e[1].runners||[]).length>0;});return(<div key={meet.id||meet.name} style={{background:C.card,border:"1px solid "+(isA?"#2d7a35":C.border),borderRadius:4,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div><div style={{fontSize:14,fontWeight:800,color:"white"}}>{meet.name}</div><div style={{fontSize:10,color:C.muted}}>{meet.date||""} — {evts.map(function(e){return e[0];}).join(", ")}</div></div>
                <button onClick={function(){importMeetEvents(meet);}} style={{padding:"6px 14px",background:isA?"#1a3a1a":C.orange,color:isA?C.greenLight:C.bg,border:"1px solid "+(isA?"#2d7a35":C.orange),borderRadius:3,cursor:"pointer",fontSize:12,fontWeight:900,fontFamily:"inherit",letterSpacing:1,textTransform:"uppercase"}}>{isA?"\u2713 Imported":"Import"}</button>
              </div>
            </div>);})}
          </div>}
        </div>):null}

        {/* ── WORKOUT MODE ── */}
        {mode==="workout"?(<div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,letterSpacing:4,color:C.orange,textTransform:"uppercase",marginBottom:6}}>Workout Name</div>
            <input value={woName} onChange={function(e){setWoName(e.target.value);}} placeholder="e.g. 4x400 @ Threshold" style={{width:"100%",boxSizing:"border-box",background:C.card,border:"1px solid "+(woName.trim()?C.orange:C.border),color:"white",padding:"8px 12px",borderRadius:3,fontSize:14,fontFamily:"inherit",outline:"none"}}/>
          </div>

          {/* Import pace groups */}
          <div style={{background:C.card,border:"1px solid "+C.border,borderLeft:"3px solid #4a9eff",borderRadius:4,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:800,color:"white",marginBottom:6}}>Import Pace Groups</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              <select value={paceKey} onChange={function(e){setPaceKey(e.target.value);}} style={{background:"#0a0e18",border:"1px solid "+C.border,color:"white",padding:"5px 8px",borderRadius:3,fontFamily:"inherit",fontSize:12}}>
                {PACE_KEYS.map(function(p){return <option key={p.k} value={p.k}>{p.l}</option>;})}
              </select>
              <select value={paceTol} onChange={function(e){setPaceTol(parseInt(e.target.value));}} style={{background:"#0a0e18",border:"1px solid "+C.border,color:"white",padding:"5px 8px",borderRadius:3,fontFamily:"inherit",fontSize:12}}>
                {[2,4,6,8,10,12,14,16,18,20].map(function(t){return <option key={t} value={t}>{t}s tolerance</option>;})}
              </select>
              <button onClick={importPaceGroups} style={{padding:"5px 12px",background:"#4a9eff",color:C.bg,border:"none",borderRadius:3,cursor:"pointer",fontSize:12,fontWeight:900,fontFamily:"inherit"}}>Generate Groups</button>
            </div>
          </div>

          {/* Manual groups */}
          <div style={{background:C.card,border:"1px solid "+C.border,borderLeft:"3px solid "+C.orange,borderRadius:4,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:800,color:"white",marginBottom:6}}>Manual Groups</div>
            <div style={{display:"flex",gap:5,marginBottom:8}}>
              <input value={newGrpName} onChange={function(e){setNewGrpName(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter"&&newGrpName.trim()){setWoGroups(function(prev){return prev.concat([{id:"mg_"+Date.now(),name:newGrpName.trim(),color:GROUP_COLORS[prev.length%GROUP_COLORS.length],runnerIds:[]}]);});setNewGrpName("");}}} placeholder="Group name (Heat 1, Varsity...)" style={{flex:1,background:"#0a0e18",border:"1px solid "+C.border,color:"white",padding:"6px 10px",borderRadius:3,fontSize:12,fontFamily:"inherit",outline:"none"}}/>
              <button onClick={function(){if(newGrpName.trim()){setWoGroups(function(prev){return prev.concat([{id:"mg_"+Date.now(),name:newGrpName.trim(),color:GROUP_COLORS[prev.length%GROUP_COLORS.length],runnerIds:[]}]);});setNewGrpName("");}}} style={{padding:"6px 12px",background:C.orange,color:C.bg,border:"none",borderRadius:3,cursor:"pointer",fontSize:12,fontWeight:900,fontFamily:"inherit"}}>+ Group</button>
            </div>
          </div>

          {/* Group list with assign */}
          {woGroups.map(function(g){
            var members=g.runnerIds.map(function(rid){return rosterMap[rid];}).filter(Boolean);
            var available=allAthletes.filter(function(a){return!g.runnerIds.includes(String(a.id));});
            return(<div key={g.id} style={{background:C.card,border:"1px solid "+C.border,borderLeft:"3px solid "+g.color,borderRadius:4,padding:"10px 12px",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:2,background:g.color}}/><span style={{fontSize:14,fontWeight:800,color:"white"}}>{g.name}</span><span style={{fontSize:10,color:C.muted}}>{members.length} runners</span></div>
                <button onClick={function(){setWoGroups(function(prev){return prev.filter(function(x){return x.id!==g.id;});});}} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>{"\u00D7"}</button>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                {members.map(function(a){return(<span key={a.id} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",background:g.color+"18",border:"1px solid "+g.color+"44",borderRadius:3,fontSize:11,fontWeight:700,color:"white"}}>{a.name}<button onClick={function(){setWoGroups(function(prev){return prev.map(function(x){return x.id===g.id?Object.assign({},x,{runnerIds:x.runnerIds.filter(function(r){return r!==String(a.id);})}):x;});});}} style={{background:"none",border:"none",color:g.color,cursor:"pointer",fontSize:12,padding:0}}>{"\u00D7"}</button></span>);})}
              </div>
              <select value="" onChange={function(e){if(e.target.value){var rid=e.target.value;setWoGroups(function(prev){return prev.map(function(x){return x.id===g.id?Object.assign({},x,{runnerIds:x.runnerIds.concat([rid])}):x;});});}}} style={{width:"100%",background:"#0a0e18",border:"1px solid "+C.border,color:C.muted,padding:"4px 8px",borderRadius:3,fontFamily:"inherit",fontSize:11}}>
                <option value="">+ Add runner...</option>
                {available.map(function(a){return <option key={a.id} value={String(a.id)}>{a.name} ({a.team})</option>;})}
              </select>
            </div>);
          })}
        </div>):null}

        {/* Race preview */}
        {races.length>0?<div style={{marginTop:16,marginBottom:12}}><div style={{fontSize:9,letterSpacing:4,color:C.orange,textTransform:"uppercase",marginBottom:6}}>Race Cards ({races.length})</div>
          {races.map(function(r){var evClr=EVENT_COLORS[r.event]||r.color||"#4a9eff";return(<div key={r.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",marginBottom:3,background:C.card,border:"1px solid "+C.border,borderLeft:"3px solid "+evClr,borderRadius:4}}>
            <span style={{fontSize:13,fontWeight:800,color:evClr}}>{r.label||r.event}</span>
            {r.team?<span style={{fontSize:10,fontWeight:700,color:TEAM_COLORS[r.team]||evClr}}>{r.team}</span>:null}
            <span style={{fontSize:10,color:C.muted,flex:1}}>{(r.runnerIds||[]).length} runners</span>
          </div>);})}
          <button onClick={resetAll} style={{marginTop:4,padding:"3px 8px",background:"transparent",color:C.muted,border:"1px solid "+C.dim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:"inherit"}}>Clear</button>
        </div>:null}

        {/* Begin buttons */}
        <div style={{marginTop:12,display:"flex",gap:8}}>
          {mode==="meet"?<button onClick={function(){if(races.length)setScreen("race");}} disabled={!races.length} style={{flex:1,padding:"13px",borderRadius:3,cursor:races.length?"pointer":"not-allowed",background:races.length?C.orange:C.card,color:races.length?C.bg:C.muted,border:"1px solid "+(races.length?C.orange:C.border),fontSize:15,fontWeight:900,fontFamily:"inherit",letterSpacing:3,textTransform:"uppercase"}}>{races.length?"Begin \u2192":"Import a meet"}</button>:null}
          {mode==="workout"?<button onClick={function(){if(woGroups.length>0){startWorkout();setScreen("race");}}} disabled={!woGroups.length} style={{flex:1,padding:"13px",borderRadius:3,cursor:woGroups.length?"pointer":"not-allowed",background:woGroups.length?C.orange:C.card,color:woGroups.length?C.bg:C.muted,border:"1px solid "+(woGroups.length?C.orange:C.border),fontSize:15,fontWeight:900,fontFamily:"inherit",letterSpacing:3,textTransform:"uppercase"}}>{woGroups.length?"Start Workout \u2192":"Create groups first"}</button>:null}
        </div>

        {/* ── HISTORY ── */}
        <div style={{marginTop:24}}>
          <button onClick={function(){setHistOpen(!histOpen);}} style={{width:"100%",padding:"10px 14px",background:C.card,border:"1px solid "+C.border,borderRadius:4,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"inherit"}}>
            <span style={{fontSize:13,fontWeight:800,color:C.orange,letterSpacing:1}}>Session History ({raceResults.length})</span>
            <span style={{fontSize:10,color:C.muted}}>{histOpen?"[-]":"[+]"}</span>
          </button>
          {histOpen?<div style={{marginTop:8}}>
            {histKeys.length===0?<div style={{fontSize:12,color:C.muted,fontStyle:"italic",padding:"12px"}}>No saved sessions yet. Finish a race to save results.</div>:null}
            {histKeys.map(function(key){var sess=histBySession[key];return(<div key={key} style={{marginBottom:12,background:C.card,border:"1px solid "+C.border,borderRadius:4,overflow:"hidden"}}>
              <div style={{padding:"8px 12px",borderBottom:"1px solid "+C.border}}>
                <div style={{fontSize:13,fontWeight:700,color:"white"}}>{sess.name}</div>
                <div style={{fontSize:10,color:C.muted}}>{sess.date} — {sess.type==="workout"?"Workout":"Meet"} — {sess.races.length} race{sess.races.length!==1?"s":""}</div>
              </div>
              {sess.races.map(function(race){var evClr=EVENT_COLORS[race.event]||"#4a9eff";var runners=(race.runners||[]).slice().sort(function(a,b){return(a.finalTime||999999)-(b.finalTime||999999);});return(<div key={race.id||race.event+race.team} style={{padding:"8px 12px",borderBottom:"1px solid "+C.dim}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:800,color:evClr}}>{race.event}</span>
                  {race.team?<span style={{fontSize:10,fontWeight:700,color:TEAM_COLORS[race.team]||evClr}}>{race.team}</span>:null}
                </div>
                {runners.map(function(r,ri){return(<div key={r.id||ri} style={{display:"flex",alignItems:"center",gap:6,padding:"2px 0"}}>
                  <span style={{width:18,fontSize:10,fontWeight:700,color:ri===0?evClr:C.muted,textAlign:"center"}}>{ri+1}</span>
                  <span style={{flex:1,fontSize:11,fontWeight:ri===0?700:500,color:ri===0?evClr:"#aaa"}}>{r.name}</span>
                  {(r.splits||[]).length>1?(r.splits||[]).slice(0,-1).map(function(s,si){return <span key={si} style={{fontSize:10,color:C.muted,fontFamily:"'Share Tech Mono',monospace",width:50,textAlign:"center"}}>{fmtSplit(s.split)}</span>;}):null}
                  <span style={{fontSize:12,fontWeight:800,color:ri===0?C.greenLight:"#aaa",fontFamily:"'Share Tech Mono',monospace",minWidth:60,textAlign:"right"}}>{r.finalTime?fmtTime(r.finalTime):"--"}</span>
                </div>);})}
              </div>);})}
            </div>);})}
          </div>:null}
        </div>

      </div>
    </div>);
  }

  /* ── RACE SCREEN ── */
  return(<div style={{background:C.bg,minHeight:"100vh",fontFamily:"'Barlow Condensed',sans-serif",color:"white"}}>
    <div style={{padding:"10px 14px",borderBottom:"1px solid "+C.border,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:C.bg,zIndex:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={function(){setScreen("setup");}} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:10,fontFamily:"inherit",letterSpacing:2,textTransform:"uppercase",padding:0}}>{"\u2190"} Setup</button>
        <span style={{fontSize:12,fontWeight:800,color:C.orange,letterSpacing:2,textTransform:"uppercase"}}>{label}</span>
      </div>
    </div>
    <div style={{padding:"8px 10px"}}>
      {races.map(function(race){return <RaceCard key={race.id} race={race} rosterMap={rosterMap} paces={fbPaces} onUpdateRace={updateRace} onFinishRace={handleFinishRace} C={C}/>;})}</div>
  </div>);
}
