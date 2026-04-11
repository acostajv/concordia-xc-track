import { useState, useEffect, useRef, useCallback } from "react";
import { loadData } from "./firebase.js";

var pad=function(n){return String(n).padStart(2,"0");};
var fmtTime=function(ms){if(ms<0)ms=0;return pad(Math.floor(ms/60000))+":"+pad(Math.floor((ms%60000)/1000))+"."+pad(Math.floor((ms%1000)/10));};
var fmtSplit=function(ms){if(ms<0)ms=0;return ms<60000?Math.floor(ms/1000)+"."+pad(Math.floor((ms%1000)/10)):fmtTime(ms);};

var STORAGE_KEY="beacon_split_v6";
var PRESET_DISTANCES=["200m","400m","800m","1200m","1600m","Half Mile","1 Mile","3K","5K"];
var DIST_METERS={"200m":200,"400m":400,"800m":800,"1200m":1200,"1600m":1600,"3200m":3200,"Half Mile":805,"1 Mile":1609,"Quarter Mile":402,"3K":3000,"5K":5000,"4x800":3200,"800":800,"1600":1600,"3200":3200};
var EVENT_COLORS={"800":"#F39C12","1600":"#D4A017","3200":"#27ae60","4x800":"#a855f7"};
var TEAM_COLORS={boys:"#4a9eff",girls:"#ff7eb3"};
var GROUP_COLORS=["#FF5722","#4a9eff","#ff7eb3","#27ae60","#f0a500","#a855f7","#14b8a6","#f43f5e","#fb923c","#84cc16"];
var PACE_KEYS=[{k:"thrSafe",l:"LT Safe"},{k:"thrMed",l:"LT Med"},{k:"cv",l:"CV"},{k:"vo2Safe",l:"VO2 Safe"},{k:"vo2Med",l:"VO2 Med"}];
var EVT_ORDER={"4x800":0,"800":1,"1600":2,"3200":3};

function getSplitsToFinish(ev,sd){var rd=DIST_METERS[ev]||DIST_METERS[ev+"m"]||0;var s=DIST_METERS[sd]||0;if(!rd||!s||s>=rd)return 0;return Math.round(rd/s);}

/* ── THEMES ────────────────────────────────────────────────────────────── */
var THEMES={
  dark:{name:"Dark",bg:"#07090e",card:"#0b0f18",border:"#1a2233",text:"#ffffff",muted:"#6a7a90",dim:"#1a2233",timerBg:"#050709",accent:"#FF5722",splitClr:"#7aff8a",timeClr:"#b0c4d8",oldSplit:"#90b8dd"},
  midnight:{name:"Midnight",bg:"#0a0e1a",card:"#0f1526",border:"#1e2d50",text:"#f0f2ff",muted:"#7888b8",dim:"#1e2d50",timerBg:"#080c16",accent:"#7B68EE",splitClr:"#99ccff",timeClr:"#b0bbdd",oldSplit:"#a0b8ee"},
  forest:{name:"Forest",bg:"#0a100e",card:"#0e1a14",border:"#1e3828",text:"#f0fff0",muted:"#5a9a68",dim:"#1e3828",timerBg:"#080e0c",accent:"#66BB6A",splitClr:"#b9f6ca",timeClr:"#90c8a0",oldSplit:"#a0d8b0"},
  ember:{name:"Ember",bg:"#1a0a0a",card:"#221010",border:"#3a1818",text:"#ffe8e0",muted:"#9a6060",dim:"#3a1818",timerBg:"#140808",accent:"#ff6b35",splitClr:"#ffab91",timeClr:"#d0a090",oldSplit:"#c09080"},
  ocean:{name:"Ocean",bg:"#0a1520",card:"#0e1c2c",border:"#1a3050",text:"#e0f0ff",muted:"#5588aa",dim:"#1a3050",timerBg:"#081420",accent:"#00bcd4",splitClr:"#80deea",timeClr:"#90b8d0",oldSplit:"#a0c8e0"},
  slate:{name:"Slate",bg:"#1e293b",card:"#273449",border:"#3d5060",text:"#f1f5f9",muted:"#8a9eb8",dim:"#3d5060",timerBg:"#1a2435",accent:"#f97316",splitClr:"#fdd835",timeClr:"#b0c4d8",oldSplit:"#c0d0e0"},
  light:{name:"Light",bg:"#f5f6f2",card:"#ffffff",border:"#bbb",text:"#111",muted:"#555",dim:"#e0e0e0",timerBg:"#eaeaea",accent:"#d84315",splitClr:"#1b5e20",timeClr:"#333",oldSplit:"#444"},
  outdoor:{name:"Outdoor",bg:"#ffffff",card:"#f8f8f4",border:"#999",text:"#000000",muted:"#444",dim:"#ddd",timerBg:"#f0f0ec",accent:"#d32f2f",splitClr:"#1a6b1a",timeClr:"#222",oldSplit:"#333"},
  cream:{name:"Cream",bg:"#fdf8f0",card:"#fff9f2",border:"#d4c4aa",text:"#2a2018",muted:"#8a7a60",dim:"#e8dcc8",timerBg:"#f4eee4",accent:"#c75000",splitClr:"#2e7d32",timeClr:"#4a3a28",oldSplit:"#5a4a38"},
  overcast:{name:"Overcast",bg:"#e8eaee",card:"#f0f2f5",border:"#b0b8c4",text:"#1a1e28",muted:"#6a7488",dim:"#d0d4dc",timerBg:"#dde0e6",accent:"#1565c0",splitClr:"#1b5e20",timeClr:"#2a3040",oldSplit:"#3a4050"},
  track:{name:"Track",bg:"#c23b22",card:"#d44a30",border:"#a03020",text:"#ffffff",muted:"#ffccbb",dim:"#a03020",timerBg:"#b03020",accent:"#ffffff",splitClr:"#ffff00",timeClr:"#ffe0d0",oldSplit:"#ffd0c0"},
};

function PacePill(p){if(!p.value)return null;return(<span style={{display:"inline-flex",alignItems:"center",gap:2,padding:"1px 5px",borderRadius:2,background:p.color+"14",border:"1px solid "+p.color+"35"}}><span style={{color:p.color,fontWeight:800,fontSize:9,letterSpacing:0.5}}>{p.label}</span><span style={{color:"#ccc",fontFamily:"'Share Tech Mono',monospace",fontSize:11,fontWeight:600}}>{p.value}</span></span>);}

/* ── RACE CARD ─────────────────────────────────────────────────────────── */
function RaceCard(props){
  var race=props.race,rosterMap=props.rosterMap,paces=props.paces,onUpdateRace=props.onUpdateRace,onSaveRace=props.onSaveRace,splitLabel=props.splitLabel||"400m",T=props.T,allAthletes=props.allAthletes||[],beepOn=!!props.beepOn;
  var _r=useState(false);var isRunning=_r[0];var setIsRunning=_r[1];
  var _e=useState(race.elapsed||0);var elapsed=_e[0];var setElapsed=_e[1];
  var _f=useState({});var flashMap=_f[0];var setFlashMap=_f[1];
  var startRef=useRef(null);var pausedRef=useRef(race.elapsed||0);var rafRef=useRef(null);var elapsedRef=useRef(race.elapsed||0);
  var _drag=useState(null);var dragIdx=_drag[0];var setDragIdx=_drag[1];
  var _showAdd=useState(false);var showAdd=_showAdd[0];var setShowAdd=_showAdd[1];
  var _actionFor=useState(null);var actionFor=_actionFor[0];var setActionFor=_actionFor[1];
  var _manEntry=useState({rid:null,value:""});var manualEntry=_manEntry[0];var setManualEntry=_manEntry[1];
  var _confirm=useState(null);var confirmModal=_confirm[0];var setConfirmModal=_confirm[1];
  var longPressRef=useRef({timer:null,fired:false});
  var wakeLockRef=useRef(null);
  var audioCtxRef=useRef(null);
  var playBeep=function(){
    if(!beepOn)return;
    try{
      if(!audioCtxRef.current){var Ctor=window.AudioContext||window.webkitAudioContext;if(!Ctor)return;audioCtxRef.current=new Ctor();}
      var ctx=audioCtxRef.current;
      if(ctx.state==="suspended")ctx.resume();
      var osc=ctx.createOscillator();var gain=ctx.createGain();
      osc.connect(gain);gain.connect(ctx.destination);
      osc.frequency.value=880;osc.type="sine";
      gain.gain.setValueAtTime(0.15,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.08);
      osc.start();osc.stop(ctx.currentTime+0.09);
    }catch(e){}
  };

  var tick=useCallback(function(){var now=Date.now()-startRef.current+pausedRef.current;elapsedRef.current=now;setElapsed(now);rafRef.current=requestAnimationFrame(tick);},[]);
  var startTimer=function(){startRef.current=Date.now();setIsRunning(true);rafRef.current=requestAnimationFrame(tick);};
  var pauseTimer=function(){
    /* STOP just pauses the timer cleanly. It does NOT auto-record any splits.
       Use the runner buttons to record splits, or "Finish" to mass-finish a race. */
    cancelAnimationFrame(rafRef.current);
    var now=elapsedRef.current;
    pausedRef.current=now;
    setIsRunning(false);
    onUpdateRace(race.id,{elapsed:now,status:"paused"});
  };
  var finishRace=function(){
    cancelAnimationFrame(rafRef.current);var now=elapsedRef.current;pausedRef.current=now;setIsRunning(false);
    var ns=Object.assign({},race.splits||{});var nf=Object.assign({},race.finished||{});
    if(isRelay){
      if(activeLeg>=0&&activeLeg<(race.runnerIds||[]).length){
        var rid=race.runnerIds[activeLeg];
        if(!nf[rid]){var legStart=0;if(activeLeg>0){var prevRid=race.runnerIds[activeLeg-1];var prevSp=ns[prevRid]||[];if(prevSp.length>0)legStart=prevSp[prevSp.length-1].total;}ns[rid]=[{split:now-legStart,total:now}];}nf[rid]=true;
      }
      /* Mark all remaining as finished */
      (race.runnerIds||[]).forEach(function(rid){nf[rid]=true;});
    } else {
      (race.runnerIds||[]).forEach(function(rid){if(nf[rid])return;var sp=ns[rid]||[];if(sp.length>0){var last=sp[sp.length-1].total;if(now>last+500){ns[rid]=sp.concat([{split:now-last,total:now}]);}}nf[rid]=true;});
    }
    onUpdateRace(race.id,{status:"done",elapsed:now,splits:ns,finished:nf});
  };
  var resetRace=function(){cancelAnimationFrame(rafRef.current);setIsRunning(false);setElapsed(0);elapsedRef.current=0;pausedRef.current=0;onUpdateRace(race.id,{elapsed:0,splits:{},status:"ready",finished:{}});};
  useEffect(function(){return function(){cancelAnimationFrame(rafRef.current);};},[]);

  /* Wake lock — keep the screen on while a race is actively running */
  useEffect(function(){
    if(typeof navigator==="undefined"||!navigator.wakeLock)return;
    var releaseLock=function(){if(wakeLockRef.current){wakeLockRef.current.release().catch(function(){});wakeLockRef.current=null;}};
    var acquire=function(){
      if(!isRunning||wakeLockRef.current)return;
      navigator.wakeLock.request("screen").then(function(s){
        wakeLockRef.current=s;
        s.addEventListener("release",function(){if(wakeLockRef.current===s)wakeLockRef.current=null;});
      }).catch(function(){});
    };
    if(isRunning)acquire();else releaseLock();
    /* Re-acquire on tab visibility change (Wake Lock auto-releases on hide) */
    var onVis=function(){if(document.visibilityState==="visible"&&isRunning)acquire();};
    document.addEventListener("visibilitychange",onVis);
    return function(){document.removeEventListener("visibilitychange",onVis);releaseLock();};
  },[isRunning]);

  var isReady=race.status==="ready"&&!isRunning&&elapsed===0;
  var moveRunner=function(fromIdx,toIdx){
    if(fromIdx===toIdx)return;
    var ids=(race.runnerIds||[]).slice();var item=ids.splice(fromIdx,1)[0];ids.splice(toIdx,0,item);
    onUpdateRace(race.id,{runnerIds:ids});
  };
  var removeRunner=function(rid){
    var ids=(race.runnerIds||[]).filter(function(r){return r!==rid;});
    var ns=Object.assign({},race.splits||{});delete ns[rid];
    var nf=Object.assign({},race.finished||{});delete nf[rid];
    onUpdateRace(race.id,{runnerIds:ids,splits:ns,finished:nf});
  };
  var addRunner=function(rid){
    if((race.runnerIds||[]).includes(rid))return;
    onUpdateRace(race.id,{runnerIds:(race.runnerIds||[]).concat([rid])});
  };
  var pressStart=function(rid){
    longPressRef.current.fired=false;
    if(longPressRef.current.timer)clearTimeout(longPressRef.current.timer);
    longPressRef.current.timer=setTimeout(function(){
      longPressRef.current.fired=true;
      longPressRef.current.timer=null;
      setActionFor(rid);
      if(typeof navigator!=="undefined"&&typeof navigator.vibrate==="function"){try{navigator.vibrate(40);}catch(e){}}
    },500);
  };
  var pressEnd=function(){
    if(longPressRef.current.timer){clearTimeout(longPressRef.current.timer);longPressRef.current.timer=null;}
  };
  var parseTimeStr=function(str){
    /* Accepts "1:23.45", "1:23", "83.45", or "83" */
    str=(str||"").trim();if(!str)return null;
    var parts=str.split(":");
    if(parts.length===2){var mm=parseInt(parts[0]);var rest=parts[1].split(".");var ss=parseInt(rest[0])||0;var cs=rest[1]?parseInt((rest[1]+"00").slice(0,2)):0;if(isNaN(mm))return null;return mm*60000+ss*1000+cs*10;}
    if(parts.length===1){var rest2=str.split(".");var sec=parseInt(rest2[0])||0;var cs2=rest2[1]?parseInt((rest2[1]+"00").slice(0,2)):0;return sec*1000+cs2*10;}
    return null;
  };
  var submitManualEntry=function(rid,str){
    var ms=parseTimeStr(str);if(ms===null||ms<=0)return;
    var ns=Object.assign({},race.splits||{});
    var nf=Object.assign({},race.finished||{});
    if(isRelay){
      var legIdx=(race.runnerIds||[]).indexOf(rid);
      var legStart=0;
      if(legIdx>0){var prevRid=race.runnerIds[legIdx-1];var prevSp=ns[prevRid]||[];if(prevSp.length>0)legStart=prevSp[prevSp.length-1].total;}
      if(ms<=legStart)return;
      ns[rid]=[{split:ms-legStart,total:ms}];
      nf[rid]=true;
    } else {
      var prev=ns[rid]||[];
      var lastTotal=prev.length>0?prev[prev.length-1].total:0;
      if(ms<=lastTotal)return;/* Must be after the previous split */
      ns[rid]=prev.concat([{split:ms-lastTotal,total:ms}]);
      if(splitsToFinish>0&&ns[rid].length>=splitsToFinish)nf[rid]=true;
    }
    /* If this push exceeds elapsed, bump elapsed up to match */
    var newElapsed=Math.max(elapsedRef.current,ms);
    if(newElapsed>elapsedRef.current){elapsedRef.current=newElapsed;pausedRef.current=newElapsed;setElapsed(newElapsed);}
    var allDone=(race.runnerIds||[]).every(function(r){return nf[r];});
    if(allDone){cancelAnimationFrame(rafRef.current);setIsRunning(false);onUpdateRace(race.id,{splits:ns,status:"done",elapsed:newElapsed,finished:nf});}
    else{onUpdateRace(race.id,{splits:ns,status:isRunning?"running":"paused",elapsed:newElapsed,finished:nf});}
  };
  var undoSplit=function(rid){
    var sp=(race.splits||{})[rid]||[];
    if(sp.length===0)return;
    var ns=Object.assign({},race.splits||{});
    ns[rid]=sp.slice(0,-1);
    var nf=Object.assign({},race.finished||{});
    delete nf[rid];/* un-finish them */
    var dnfMap=Object.assign({},race.dnf||{});
    delete dnfMap[rid];/* un-DNF if they were DNF */
    var wasDone=race.status==="done";
    if(wasDone){cancelAnimationFrame(rafRef.current);setIsRunning(false);}
    onUpdateRace(race.id,{splits:ns,finished:nf,dnf:dnfMap,status:wasDone?"paused":race.status});
  };
  var toggleDnf=function(rid){
    var dnfMap=Object.assign({},race.dnf||{});
    var nf=Object.assign({},race.finished||{});
    if(dnfMap[rid]){
      /* Un-DNF: clear flag and un-finish */
      delete dnfMap[rid];
      delete nf[rid];
      var wasDone=race.status==="done";
      if(wasDone){cancelAnimationFrame(rafRef.current);setIsRunning(false);}
      onUpdateRace(race.id,{dnf:dnfMap,finished:nf,status:wasDone?"paused":race.status});
    } else {
      /* Mark DNF: add flag and mark finished so race can complete */
      dnfMap[rid]=true;
      nf[rid]=true;
      var allDone=(race.runnerIds||[]).every(function(r){return nf[r];});
      if(allDone){
        cancelAnimationFrame(rafRef.current);
        var now=elapsedRef.current;
        pausedRef.current=now;
        setIsRunning(false);
        onUpdateRace(race.id,{dnf:dnfMap,finished:nf,status:"done",elapsed:now});
      } else {
        onUpdateRace(race.id,{dnf:dnfMap,finished:nf});
      }
    }
  };

  var effectiveSplit=race.splitLabel||splitLabel;
  var splitsToFinish=getSplitsToFinish(race.event,effectiveSplit);
  var finishedMap=race.finished||{};
  var isRelay=race.event==="4x800";
  /* For relay: figure out which leg is active */
  var activeLeg=-1;
  if(isRelay){
    for(var li=0;li<(race.runnerIds||[]).length;li++){
      if(!finishedMap[race.runnerIds[li]]){activeLeg=li;break;}
    }
  }
  var recordSplit=function(rid){var now=elapsedRef.current;if(now===0&&!isRunning)return;if(finishedMap[rid])return;
    if(isRelay){
      /* Relay: tapping the active leg runner records their split and marks them done */
      var legIdx=(race.runnerIds||[]).indexOf(rid);
      if(legIdx!==activeLeg)return;/* Only active leg is tappable */
      var prev=(race.splits||{})[rid]||[];
      var legStart=0;/* Leg starts at previous leg's finish time */
      if(legIdx>0){var prevRid=race.runnerIds[legIdx-1];var prevSp=(race.splits||{})[prevRid]||[];if(prevSp.length>0)legStart=prevSp[prevSp.length-1].total;}
      var ns=Object.assign({},race.splits||{});
      ns[rid]=[{split:now-legStart,total:now}];/* One split per leg = their 800 time + cumulative */
      var nf=Object.assign({},finishedMap);nf[rid]=true;
      var done1=(race.runnerIds||[]).every(function(r){return nf[r];});
      if(done1){cancelAnimationFrame(rafRef.current);pausedRef.current=now;setIsRunning(false);onUpdateRace(race.id,{splits:ns,status:"done",elapsed:now,finished:nf});}
      else{onUpdateRace(race.id,{splits:ns,status:"running",finished:nf});}
    } else {
      var prev=(race.splits||{})[rid]||[];var last=prev.length>0?prev[prev.length-1].total:0;
      var ns=Object.assign({},race.splits||{});ns[rid]=prev.concat([{split:now-last,total:now}]);
      var nf=Object.assign({},finishedMap);if(splitsToFinish>0&&ns[rid].length>=splitsToFinish)nf[rid]=true;
      var done2=(race.runnerIds||[]).every(function(r){return nf[r];});
      if(done2){cancelAnimationFrame(rafRef.current);pausedRef.current=now;setIsRunning(false);onUpdateRace(race.id,{splits:ns,status:"done",elapsed:now,finished:nf});}
      else{onUpdateRace(race.id,{splits:ns,status:"running",finished:nf});}
    }
    setFlashMap(function(p){var n=Object.assign({},p);n[rid]=true;return n;});setTimeout(function(){setFlashMap(function(p){var n=Object.assign({},p);n[rid]=false;return n;});},350);
    /* Haptic + audio confirmation so the coach knows the tap registered without looking */
    if(typeof navigator!=="undefined"&&typeof navigator.vibrate==="function"){try{navigator.vibrate(50);}catch(e){}}
    playBeep();
  };

  var runners=(race.runnerIds||[]).map(function(rid){return rosterMap[rid]||rosterMap[String(rid)];}).filter(Boolean);
  var hasSplits=runners.some(function(a){return((race.splits||{})[a.id]||[]).length>0;});
  var evClr=EVENT_COLORS[race.event]||race.color||T.accent;
  var teamClr=TEAM_COLORS[race.team]||evClr;
  var isDone=race.status==="done";
  var finCount=Object.keys(finishedMap).length;

  return(<div style={{borderRadius:6,border:"1px solid "+(isRunning?evClr+"66":T.border),background:isRunning?T.card:T.card,borderLeft:"3px solid "+evClr,marginBottom:8}}>
    <div style={{padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <div style={{fontSize:15,fontWeight:800,color:evClr}}>{race.label||race.event}</div>
        {race.team?<span style={{fontSize:11,fontWeight:700,color:teamClr,padding:"1px 8px",borderRadius:3,background:teamClr+"18",textTransform:"uppercase",letterSpacing:1}}>{race.team}</span>:null}
        <span style={{fontSize:10,color:T.muted}}>{runners.length} runners</span>
        {race.shared?<span title="Shared race — only your assigned runners are shown" style={{fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:3,background:"#f0a50022",color:"#f0a500",border:"1px solid #f0a50066",letterSpacing:0.5}}>SHARED</span>:race.assignedCoaches&&race.assignedCoaches.length===1?<span title="Solo race — only you" style={{fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:3,background:"#27ae6022",color:"#5ddb6a",border:"1px solid #27ae6066",letterSpacing:0.5}}>YOURS</span>:null}
        {isReady?<select value={effectiveSplit} onChange={function(e){onUpdateRace(race.id,{splitLabel:e.target.value});}} style={{background:T.timerBg,border:"1px solid "+T.border,color:T.text,padding:"2px 6px",borderRadius:3,fontFamily:"inherit",fontSize:10}} title="Split distance">
          {["200m","400m","800m","1200m","1600m","Half Mile","1 Mile","3K","5K"].map(function(d){return <option key={d} value={d}>{d}</option>;})}
        </select>:<span style={{fontSize:9,color:T.muted,fontFamily:"'Share Tech Mono',monospace",padding:"1px 5px",border:"1px solid "+T.border,borderRadius:3}}>{effectiveSplit}</span>}
        {splitsToFinish>0?<span style={{fontSize:9,color:T.muted,fontFamily:"'Share Tech Mono',monospace"}}>{splitsToFinish} splits=done</span>:null}
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        {finCount>0&&!isDone?<span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:"#27ae6022",color:"#5ddb6a",fontWeight:700}}>{finCount}/{runners.length}</span>:null}
        {isDone&&!race.saved?<button onClick={function(){if(onSaveRace)onSaveRace(race);}} style={{padding:"3px 8px",background:"#3498DB22",color:"#3498DB",border:"1px solid #3498DB44",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>Save</button>:null}
        {race.saved?<span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:"#27ae6022",color:"#5ddb6a",fontWeight:700}}>Saved</span>:isDone?<span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:"#27ae6022",color:"#5ddb6a",fontWeight:700}}>Done</span>:null}
        {hasSplits&&!isDone?<button onClick={finishRace} style={{padding:"3px 8px",background:"#27ae6022",color:"#5ddb6a",border:"1px solid #27ae6044",borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>Finish</button>:null}
      </div>
    </div>
    <div style={{padding:"6px 12px",background:T.timerBg,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:42,zIndex:5,borderTop:"1px solid "+T.border,borderBottom:"1px solid "+T.border}}>
      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:isRunning?52:36,color:isRunning?T.text:elapsed>0?evClr:T.muted,letterSpacing:2,lineHeight:1}}>{fmtTime(elapsed)}</div>
      <div style={{display:"flex",gap:5}}>
        {!isDone&&!isRunning?<button onClick={startTimer} style={{padding:"6px 16px",background:evClr,color:T.bg,border:"none",borderRadius:3,cursor:"pointer",fontSize:13,fontWeight:900,fontFamily:"inherit",letterSpacing:2}}>{elapsed>0?"GO":"START"}</button>:!isDone?<button onClick={pauseTimer} style={{padding:"6px 16px",background:"transparent",color:evClr,border:"1.5px solid "+evClr,borderRadius:3,cursor:"pointer",fontSize:13,fontWeight:900,fontFamily:"inherit",letterSpacing:2}}>STOP</button>:null}
        <button onClick={function(){setConfirmModal({title:"Reset this race?",message:"All splits and the timer will be cleared. This cannot be undone.",confirmLabel:"Reset",destructive:true,onConfirm:function(){resetRace();}});}} style={{padding:"6px 10px",background:"transparent",color:T.muted,border:"1px solid "+T.border,borderRadius:3,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>Reset</button>
      </div>
    </div>
    <div style={{padding:"6px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
        {runners.map(function(ath,athIdx){var sp=(race.splits||{})[ath.id]||[];var last=sp[sp.length-1];var flash=flashMap[ath.id];var hasSp=sp.length>0;var isFin=!!finishedMap[ath.id];
          var isDnf=!!(race.dnf||{})[ath.id];
          var isActiveLeg=isRelay&&athIdx===activeLeg;
          var canClick=isDnf?false:isRelay?isActiveLeg&&(isRunning||elapsed>0)&&!isDone:(isRunning||elapsed>0)&&!isDone&&!isFin;
          var showActions=!isReady&&(isRunning||elapsed>0||isDone);
          var p=paces[ath.name]||{};
          var hidePaces=isRunning||elapsed>0;
          return(<div key={ath.id} style={{position:"relative",width:"100%"}}
            draggable={isReady} onDragStart={function(e){if(!isReady)return;setDragIdx(athIdx);e.dataTransfer.effectAllowed="move";}}
            onDragOver={function(e){if(!isReady||dragIdx===null)return;e.preventDefault();e.dataTransfer.dropEffect="move";}}
            onDrop={function(e){if(!isReady||dragIdx===null)return;e.preventDefault();moveRunner(dragIdx,athIdx);setDragIdx(null);}}
            onDragEnd={function(){setDragIdx(null);}}>
            {isReady?<span onClick={function(e){e.stopPropagation();removeRunner(ath.id);}} style={{position:"absolute",top:2,right:2,zIndex:2,width:18,height:18,borderRadius:"50%",background:"#ef444433",color:"#ef4444",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>{"\u00D7"}</span>:null}
            <button
              onClick={function(){if(longPressRef.current.fired){longPressRef.current.fired=false;return;}if(canClick)recordSplit(ath.id);}}
              onMouseDown={function(){if(showActions)pressStart(ath.id);}}
              onMouseUp={pressEnd}
              onMouseLeave={pressEnd}
              onTouchStart={function(){if(showActions)pressStart(ath.id);}}
              onTouchEnd={pressEnd}
              onTouchCancel={pressEnd}
              onContextMenu={function(e){e.preventDefault();}}
              style={{width:"100%",padding:"12px 12px",minHeight:64,background:flash?"#0c1f0e":dragIdx===athIdx?"rgba(255,255,255,0.05)":isDnf?"rgba(239,68,68,0.06)":T.card,border:"1px solid "+(flash?"#2d7a35":isDnf?"#ef444444":isFin?"#27ae6044":hasSp?"#1a2e1a":T.border),borderTop:"3px solid "+(isDnf?"#ef4444":isFin?"#27ae60":flash?"#5ddb6a":hasSp?"#1e4a1e":teamClr+"44"),borderRadius:4,cursor:isReady?"grab":canClick?"pointer":"default",textAlign:"left",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none",fontFamily:"inherit",display:"flex",flexDirection:"column",gap:2,opacity:dragIdx===athIdx?0.4:isDnf?0.7:isFin&&!flash?0.6:(isRelay&&!isActiveLeg&&!isFin)?0.4:1}}>
            {isReady?<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:1}}><span style={{fontSize:10,color:T.muted,letterSpacing:1,cursor:"grab"}}>{"\u2630"}</span>{isRelay?<span style={{fontSize:9,fontWeight:700,color:evClr,padding:"0 4px",borderRadius:2,background:evClr+"18"}}>Leg {athIdx+1}</span>:null}</div>:null}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:4}}>
              <span style={{fontSize:18,fontWeight:800,color:flash?"#5ddb6a":isDnf?"#ef4444":isFin?"#27ae60":T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flex:1,minWidth:0,lineHeight:1.1,textDecoration:isDnf?"line-through":"none"}}>{ath.name}</span>
              <span style={{fontSize:20,fontWeight:900,lineHeight:1,color:hasSp?(flash?"#5ddb6a":isDnf?"#ef4444":isFin?"#27ae60":T.accent):T.dim,flexShrink:0}}>{sp.length}</span>
            </div>
            <div style={{minHeight:24}}>{last?<div style={{display:"flex",alignItems:"baseline",gap:5}}><span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:22,fontWeight:800,color:flash?"#5ddb6a":isDnf?"#ef4444":isFin?"#27ae60":T.splitClr}}>{fmtSplit(last.split)}</span><span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,fontWeight:700,color:T.timeClr}}>{fmtTime(last.total)}</span></div>:<span style={{fontSize:10,color:isDnf?"#ef4444":isFin?"#27ae60":isActiveLeg?T.accent:T.dim}}>{isDnf?"\u2717 DNF":isFin?"\u2713 FINISHED":isActiveLeg?"\u25B6 ACTIVE LEG":isRelay&&!isFin?"waiting":canClick?"tap to split":""}</span>}</div>
            {!hidePaces&&(p.thrSafe||p.cv||p.vo2Safe)?<div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:1}}>{p.thrSafe?<PacePill label="T" value={p.thrSafe} color="#f0a500"/>:null}{p.cv?<PacePill label="CV" value={p.cv} color="#4a9eff"/>:null}{p.vo2Safe?<PacePill label="V2" value={p.vo2Safe} color="#e84393"/>:null}</div>:null}
          </button>
          {actionFor===ath.id?(<div style={{position:"absolute",inset:0,zIndex:20,background:T.bg,border:"2px solid "+T.accent,borderRadius:4,display:"flex",flexDirection:"column",padding:6,gap:5}}>
            <div style={{fontSize:10,color:T.muted,textAlign:"center",letterSpacing:1,textTransform:"uppercase"}}>{ath.name}</div>
            {manualEntry.rid===ath.id?(<div style={{display:"flex",flexDirection:"column",gap:5}}>
              <input value={manualEntry.value} onChange={function(e){setManualEntry({rid:ath.id,value:e.target.value});}} placeholder="e.g. 1:23.45 or 83.45" autoFocus style={{padding:"8px",background:T.timerBg,border:"1px solid "+T.accent,color:T.text,borderRadius:3,fontSize:13,fontFamily:"'Share Tech Mono',monospace",outline:"none",textAlign:"center"}}/>
              <div style={{fontSize:9,color:T.muted,textAlign:"center"}}>Cumulative time from race start</div>
              <div style={{display:"flex",gap:5}}>
                <button onClick={function(){submitManualEntry(ath.id,manualEntry.value);setManualEntry({rid:null,value:""});setActionFor(null);}} style={{flex:1,padding:"8px",background:T.accent+"22",border:"1px solid "+T.accent+"66",color:T.accent,borderRadius:3,fontSize:12,fontWeight:800,fontFamily:"inherit",cursor:"pointer"}}>Save</button>
                <button onClick={function(){setManualEntry({rid:null,value:""});}} style={{flex:1,padding:"8px",background:"transparent",border:"1px solid "+T.border,color:T.muted,borderRadius:3,fontSize:12,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>Back</button>
              </div>
            </div>):(<div style={{display:"flex",flexDirection:"column",gap:5}}>
              {hasSp?<button onClick={function(){undoSplit(ath.id);setActionFor(null);}} style={{padding:"10px",background:"#f0a50022",border:"1px solid #f0a50066",color:"#f0a500",borderRadius:3,fontSize:13,fontWeight:800,fontFamily:"inherit",cursor:"pointer"}}>{"\u21B6 Undo Last Split"}</button>:null}
              <button onClick={function(){setManualEntry({rid:ath.id,value:""});}} style={{padding:"10px",background:T.accent+"22",border:"1px solid "+T.accent+"66",color:T.accent,borderRadius:3,fontSize:13,fontWeight:800,fontFamily:"inherit",cursor:"pointer"}}>{"\u270E Enter Time Manually"}</button>
              <button onClick={function(){toggleDnf(ath.id);setActionFor(null);}} style={{padding:"10px",background:isDnf?"#27ae6022":"#ef444422",border:"1px solid "+(isDnf?"#27ae6066":"#ef444466"),color:isDnf?"#27ae60":"#ef4444",borderRadius:3,fontSize:13,fontWeight:800,fontFamily:"inherit",cursor:"pointer"}}>{isDnf?"\u2713 Un-mark DNF":"\u2717 Mark DNF"}</button>
              <button onClick={function(){setActionFor(null);}} style={{padding:"8px",background:"transparent",border:"1px solid "+T.border,color:T.muted,borderRadius:3,fontSize:11,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>Cancel</button>
            </div>)}
          </div>):null}
          </div>);
        })}
      </div>
      {isReady?<div style={{marginTop:4,display:"flex",gap:4,alignItems:"center"}}>
        {!showAdd?<button onClick={function(){setShowAdd(true);}} style={{padding:"4px 10px",background:"transparent",color:T.accent,border:"1px dashed "+T.accent+"66",borderRadius:3,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>+ Add Runner</button>:
        <div style={{flex:1,display:"flex",gap:4}}><select value="" onChange={function(e){if(e.target.value){addRunner(e.target.value);setShowAdd(false);}}} style={{flex:1,background:T.card,border:"1px solid "+T.accent+"66",color:T.text,padding:"5px 8px",borderRadius:3,fontFamily:"inherit",fontSize:11}}>
          <option value="">Select runner...</option>
          {allAthletes.filter(function(a){return!(race.runnerIds||[]).includes(String(a.id));}).map(function(a){return <option key={a.id} value={String(a.id)}>{a.name} ({a.team})</option>;})}
        </select><button onClick={function(){setShowAdd(false);}} style={{padding:"4px 8px",background:"transparent",color:T.muted,border:"1px solid "+T.border,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:"inherit"}}>{"\u00D7"}</button></div>}
      </div>:null}
      {hasSplits?<div style={{marginTop:8}}><div style={{fontSize:9,letterSpacing:3,color:T.muted,textTransform:"uppercase",marginBottom:4}}>{isRelay?"Relay Legs":"Split Log"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
          {runners.filter(function(a){return((race.splits||{})[a.id]||[]).length>0;}).map(function(ath){var sp=(race.splits||{})[ath.id];return(<div key={ath.id} style={{background:T.timerBg,border:"1px solid "+T.border,borderTop:"2px solid "+teamClr+"33",borderRadius:4,padding:"6px 8px"}}>
            <div style={{fontSize:11,fontWeight:700,color:evClr,marginBottom:3}}>{ath.name}</div>
            {sp.map(function(s,i){return(<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"1px 0",borderTop:i>0?"1px solid "+T.dim:"none"}}><span style={{fontSize:12,fontWeight:700,color:T.timeClr}}>{"#"+(i+1)}</span><span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,fontWeight:800,color:i===sp.length-1?T.splitClr:T.oldSplit}}>{fmtSplit(s.split)}</span><span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:13,fontWeight:700,color:T.timeClr}}>{fmtTime(s.total)}</span></div>);})}
          </div>);})}
        </div></div>:null}
    </div>
    {confirmModal?(<div onClick={function(){setConfirmModal(null);}} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={function(e){e.stopPropagation();}} style={{background:T.card,border:"2px solid "+(confirmModal.destructive?"#ef4444":T.accent),borderRadius:8,padding:20,maxWidth:360,width:"100%",boxShadow:"0 24px 80px rgba(0,0,0,0.6)"}}>
        <div style={{fontSize:18,fontWeight:800,color:confirmModal.destructive?"#ef4444":T.text,marginBottom:8}}>{confirmModal.title||"Confirm"}</div>
        {confirmModal.message?<div style={{fontSize:13,color:T.muted,marginBottom:18,lineHeight:1.5}}>{confirmModal.message}</div>:null}
        <div style={{display:"flex",gap:8}}>
          <button onClick={function(){setConfirmModal(null);}} style={{flex:1,padding:"14px",background:"transparent",border:"1px solid "+T.border,color:T.text,borderRadius:6,fontSize:14,fontWeight:700,fontFamily:"inherit",cursor:"pointer"}}>Cancel</button>
          <button onClick={function(){var fn=confirmModal.onConfirm;setConfirmModal(null);if(fn)fn();}} style={{flex:1,padding:"14px",background:confirmModal.destructive?"#ef4444":T.accent,border:"none",color:"#fff",borderRadius:6,fontSize:14,fontWeight:900,fontFamily:"inherit",cursor:"pointer",letterSpacing:1,textTransform:"uppercase"}}>{confirmModal.confirmLabel||"Confirm"}</button>
        </div>
      </div>
    </div>):null}
  </div>);
}

/* ── MAIN ────────────────────────────────────────────────────────────── */
export default function SplitTimer(props){
  var onRaceFinish=props.onRaceFinish;var onDeleteHistory=props.onDeleteHistory;var parentMeets=props.meets||[];var parentRoster=props.roster||[];var raceResults=props.raceResults||[];var cmRole=props.cmRole||"head";var navigateToResultsMeet=props.navigateToResultsMeet;
  var _scr=useState("setup");var screen=_scr[0];var setScreen=_scr[1];
  var _mode=useState("meet");var mode=_mode[0];var setMode=_mode[1];
  var _theme=useState(localStorage.getItem("beacon_theme")||"dark");var theme=_theme[0];var setThemeState=_theme[1];
  var setTheme=function(t){setThemeState(t);localStorage.setItem("beacon_theme",t);};
  var _beep=useState(localStorage.getItem("beacon_beep")==="1");var beepOn=_beep[0];var setBeepState=_beep[1];
  var setBeep=function(v){setBeepState(v);localStorage.setItem("beacon_beep",v?"1":"0");};
  var T=THEMES[theme]||THEMES.dark;
  var _ath=useState([]);var allAthletes=_ath[0];var setAllAthletes=_ath[1];
  var _races=useState([]);var races=_races[0];var setRaces=_races[1];
  var _sl=useState("400m");var splitLabel=_sl[0];var setSplitLabel=_sl[1];
  var _cl=useState("");var customLabel=_cl[0];var setCustomLabel=_cl[1];
  var _woName=useState("");var woName=_woName[0];var setWoName=_woName[1];
  var _fbPaces=useState({});var fbPaces=_fbPaces[0];var setFbPaces=_fbPaces[1];
  var _fbStatus=useState("connecting");var fbStatus=_fbStatus[0];var setFbStatus=_fbStatus[1];
  var _impMeet=useState(null);var importedMeetId=_impMeet[0];var setImportedMeetId=_impMeet[1];
  var _histOpen=useState(false);var histOpen=_histOpen[0];var setHistOpen=_histOpen[1];
  var _expRace=useState(null);var expandedRace=_expRace[0];var setExpandedRace=_expRace[1];
  var _woGroups=useState([]);var woGroups=_woGroups[0];var setWoGroups=_woGroups[1];
  var _newGrpName=useState("");var newGrpName=_newGrpName[0];var setNewGrpName=_newGrpName[1];
  var _paceKey=useState("thrSafe");var paceKey=_paceKey[0];var setPaceKey=_paceKey[1];
  var _paceTol=useState(14);var paceTol=_paceTol[0];var setPaceTol=_paceTol[1];
  var sessionDate=useRef(new Date().toISOString().slice(0,10)).current;

  useEffect(function(){var l=document.createElement("link");l.href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;600;700;800;900&display=swap";l.rel="stylesheet";document.head.appendChild(l);return function(){document.head.removeChild(l);};},[]);
  useEffect(function(){
    if(parentRoster.length>0){var clean=parentRoster.filter(function(a){return a.name&&!a.name.toLowerCase().includes("coach");}).map(function(a){return{id:String(a.id),name:a.name,team:a.team||"boys"};});setAllAthletes(clean);var pm={};parentRoster.forEach(function(a){if(a.name&&a.paces)pm[a.name]=a.paces;});setFbPaces(pm);setFbStatus("ok");}
    else{loadData("roster-v3").then(function(val){var raw=val?JSON.parse(val):null;if(!Array.isArray(raw)){setFbStatus("offline");return;}var pm={};raw.forEach(function(a){if(a.name&&a.paces)pm[a.name]=a.paces;});setFbPaces(pm);setFbStatus("ok");setAllAthletes(raw.filter(function(a){return a.name&&!a.name.toLowerCase().includes("coach");}).map(function(a){return{id:String(a.id),name:a.name,team:a.team||"boys"};}));}).catch(function(){setFbStatus("offline");});}
  },[parentRoster]);
  useEffect(function(){try{var saved=localStorage.getItem(STORAGE_KEY);if(!saved)return;var d=JSON.parse(saved);if(d.races&&d.races.length>0){setRaces(d.races);if(d.splitLabel)setSplitLabel(d.splitLabel);if(d.customLabel)setCustomLabel(d.customLabel);if(d.mode)setMode(d.mode);if(d.importedMeetId)setImportedMeetId(d.importedMeetId);setScreen("race");}}catch(e){}},[]);
  useEffect(function(){if(!races.length)return;try{localStorage.setItem(STORAGE_KEY,JSON.stringify({races:races,splitLabel:splitLabel,customLabel:customLabel,mode:mode,importedMeetId:importedMeetId,savedAt:Date.now()}));}catch(e){}},[races,splitLabel,customLabel,mode,importedMeetId]);

  var rosterMap={};allAthletes.forEach(function(a){rosterMap[String(a.id)]=a;});
  var label=customLabel.trim()||splitLabel;
  var boys=allAthletes.filter(function(a){return a.team==="boys";});
  var girls=allAthletes.filter(function(a){return a.team==="girls";});
  var updateRace=function(raceId,updates){setRaces(function(prev){return prev.map(function(r){return r.id===raceId?Object.assign({},r,updates):r;});});};

  /* Build result object from a race */
  var buildRaceResult=function(race){
    var runners=(race.runnerIds||[]).map(function(rid){var ath=rosterMap[String(rid)];var sp=(race.splits||{})[rid]||[];var ft=sp.length>0?sp[sp.length-1].total:race.elapsed||0;var isDnf=!!(race.dnf||{})[rid];return{id:rid,name:ath?ath.name:"Unknown",team:ath?ath.team:"",splits:sp,finalTime:ft,dnf:isDnf};});
    return{meetId:race.meetId||"",meetName:race.meetName||"Session",meetDate:race.meetDate||sessionDate,event:race.event||race.label||label,team:race.team||"",heat:race.heat||0,runners:runners,elapsed:race.elapsed||0,type:mode,splitLabel:race.splitLabel||label,sortKey:(EVT_ORDER[race.event]!==undefined?EVT_ORDER[race.event]:9)*1000+(race.team==="boys"?0:100)+(race.heat||1)};
  };
  var saveOneRace=function(race){
    if(race.saved)return;var result=buildRaceResult(race);
    if(onRaceFinish)onRaceFinish(result);
    updateRace(race.id,{saved:true});
  };
  var saveAllUnsaved=function(){
    var unsaved=races.filter(function(r){return r.status==="done"&&!r.saved&&Object.keys(r.splits||{}).length>0;});
    unsaved.sort(function(a,b){return(buildRaceResult(a).sortKey||0)-(buildRaceResult(b).sortKey||0);});
    unsaved.forEach(function(race){var result=buildRaceResult(race);if(onRaceFinish)onRaceFinish(result);});
    setRaces(function(prev){return prev.map(function(r){return r.status==="done"&&!r.saved&&Object.keys(r.splits||{}).length>0?Object.assign({},r,{saved:true}):r;});});
  };
  var clearSession=function(){setRaces([]);setImportedMeetId(null);try{localStorage.removeItem(STORAGE_KEY);}catch(e){}setScreen("setup");};

  var parsePace=function(s){if(!s)return null;var clean=s.replace(/\/mi$/,"").trim();var pts=clean.split(":");if(pts.length!==2)return null;var m=parseInt(pts[0]);var sc=parseInt(pts[1]);if(isNaN(m)||isNaN(sc))return null;return m*60+sc;};
  var fmtPaceSec=function(s){var m=Math.floor(s/60);var sc=Math.round(s%60);return m+":"+(sc<10?"0":"")+sc;};
  var importPaceGroups=function(){var withPace=allAthletes.map(function(a){var p=fbPaces[a.name];return{ath:a,sec:parsePace(p&&p[paceKey])};}).filter(function(x){return x.sec!==null;}).sort(function(a,b){return a.sec-b.sec;});var used={};var groups=[];for(var i=0;i<withPace.length;i++){if(used[withPace[i].ath.id])continue;var grp=[withPace[i]];used[withPace[i].ath.id]=true;for(var j=i+1;j<withPace.length;j++){if(used[withPace[j].ath.id])continue;if(withPace[j].sec-grp[grp.length-1].sec<=paceTol){grp.push(withPace[j]);used[withPace[j].ath.id]=true;}}var avg=Math.round(grp.reduce(function(s,x){return s+x.sec;},0)/grp.length);groups.push({id:"pg_"+Date.now()+"_"+i,name:fmtPaceSec(avg)+"/mi",color:GROUP_COLORS[groups.length%GROUP_COLORS.length],runnerIds:grp.map(function(x){return String(x.ath.id);})});}setWoGroups(groups);};

  var importMeetEvents=function(meet){if(!meet||!meet.lineup)return;var athTeam={};allAthletes.forEach(function(a){athTeam[String(a.id)]=a.team;});var newRaces=[];var ts=Date.now();
    Object.entries(meet.lineup).forEach(function(entry){var evtKey=entry[0];var evtData=entry[1];var allIds=(evtData.runners||[]).map(function(r){return String(r);});if(!allIds.length)return;
      /* Coach assignment filter: skip events not assigned to this coach */
      var assignedCoaches=(evtData.assignedCoaches&&evtData.assignedCoaches.length>0)?evtData.assignedCoaches:["head","asst"];
      if(assignedCoaches.indexOf(cmRole)===-1)return;
      var isShared=assignedCoaches.length===2;
      var runnerAssign=evtData.runnerAssign||{};
      /* If shared, filter to only this coach's runners */
      if(isShared){allIds=allIds.filter(function(rid){return(runnerAssign[rid]||"head")===cmRole;});if(!allIds.length)return;}
      var numHeats=evtKey==="4x800"?1:Math.max(1,evtData.heats||1);var heatAssign=evtData.heatAssign||{};
      /* For 4x800 the split is always per-leg (800m); other events default to session label */
      var defaultSplit=evtKey==="4x800"?"800m":label;
      for(var hi=0;hi<numHeats;hi++){var heatNum=hi+1;
        var heatIds=numHeats===1?allIds:allIds.filter(function(rid){return(heatAssign[rid]||1)===heatNum;});
        var bIds=heatIds.filter(function(r){return athTeam[r]==="boys";});var gIds=heatIds.filter(function(r){return athTeam[r]==="girls";});
        var heatLabel=numHeats>1?" H"+heatNum:"";
        if(bIds.length>0)newRaces.push({id:"r_"+evtKey+"_b_h"+heatNum+"_"+(ts++),event:evtKey,team:"boys",label:evtKey+" Boys"+heatLabel,approxTime:evtData.approxTime||"",runnerIds:bIds,splits:{},elapsed:0,status:"ready",finished:{},meetName:meet.name||"Meet",meetId:meet.id||"",meetDate:meet.date||"",heat:heatNum,splitLabel:defaultSplit,assignedCoaches:assignedCoaches,shared:isShared});
        if(gIds.length>0)newRaces.push({id:"r_"+evtKey+"_g_h"+heatNum+"_"+(ts++),event:evtKey,team:"girls",label:evtKey+" Girls"+heatLabel,approxTime:evtData.approxTime||"",runnerIds:gIds,splits:{},elapsed:0,status:"ready",finished:{},meetName:meet.name||"Meet",meetId:meet.id||"",meetDate:meet.date||"",heat:heatNum,splitLabel:defaultSplit,assignedCoaches:assignedCoaches,shared:isShared});
      }
    });
    newRaces.sort(function(a,b){var ea=EVT_ORDER[a.event]!==undefined?EVT_ORDER[a.event]:9;var eb=EVT_ORDER[b.event]!==undefined?EVT_ORDER[b.event]:9;if(ea!==eb)return ea-eb;if(a.team!==b.team)return a.team==="boys"?-1:1;return(a.heat||1)-(b.heat||1);});
    setRaces(newRaces);setImportedMeetId(meet.id||meet.name);};

  var startWorkout=function(){var name=woName.trim()||"Workout";var newRaces=woGroups.map(function(g,gi){return{id:"wo_"+Date.now()+"_"+gi,event:name,team:"",label:g.name,color:g.color,runnerIds:g.runnerIds,splits:{},elapsed:0,status:"ready",finished:{},meetName:name,meetDate:sessionDate,type:"workout",splitLabel:label};});setRaces(newRaces);};
  var resetAll=function(){setRaces([]);setImportedMeetId(null);try{localStorage.removeItem(STORAGE_KEY);}catch(e){}};

  /* Filter meets: only show today and future, with lineups */
  var today=new Date().toISOString().slice(0,10);
  var meetsWithLineups=(parentMeets.length>0?parentMeets:[]).filter(function(m){return m&&m.lineup&&m.date>=today&&Object.values(m.lineup).some(function(e){return(e.runners||[]).length>0;});});
  /* Sort by date asc so next meet is first */
  meetsWithLineups.sort(function(a,b){return(a.date||"").localeCompare(b.date||"");});

  /* Saved Meets — group raceResults by meet (matching App.jsx Race Results grouping) */
  var histBySession={};raceResults.forEach(function(r){
    var key=(r.meetName||"Session")+"\u2014"+(r.meetDate||"");
    if(!histBySession[key]){histBySession[key]={
      name:r.meetName||"Session",
      date:r.meetDate||"",
      type:r.type||"meet",
      /* meetKey matches App.jsx race results grouping: r.meetId || r.meetName */
      meetKey:r.meetId||r.meetName||"Unknown",
      races:[],
      headCount:0,
      asstCount:0
    };}
    histBySession[key].races.push(r);
    if(r.savedBy==="asst")histBySession[key].asstCount++;
    else histBySession[key].headCount++;
  });
  var histKeys=Object.keys(histBySession).sort(function(a,b){return(histBySession[b].date||"").localeCompare(histBySession[a].date||"");});
  /* Count any unsaved done races in the timer that match each session (so we can warn) */
  var unsavedByMeet={};races.forEach(function(r){
    if(r.status==="done"&&!r.saved&&Object.keys(r.splits||{}).length>0){
      var key=(r.meetName||"Session")+"\u2014"+(r.meetDate||"");
      unsavedByMeet[key]=(unsavedByMeet[key]||0)+1;
    }
  });

  /* Check if all races done */
  var allSaved=races.length>0&&races.every(function(r){return r.saved||(!r.splits||Object.keys(r.splits).length===0);});
  var anyHasSplits=races.some(function(r){return Object.keys(r.splits||{}).length>0;});

  /* ── SETUP ── */
  if(screen==="setup"){return(<div style={{background:T.bg,minHeight:"100vh",fontFamily:"'Barlow Condensed',sans-serif",color:T.text}}>
    <div style={{padding:"12px 14px",borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:3,height:26,background:T.accent,borderRadius:2}}/><div><div style={{fontSize:9,letterSpacing:4,color:T.accent,textTransform:"uppercase"}}>Concordia Beacons</div><div style={{fontSize:20,fontWeight:800,lineHeight:1}}>Split Timer</div></div>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
        <select value={theme} onChange={function(e){setTheme(e.target.value);}} style={{background:T.card,border:"1px solid "+T.border,color:T.text,padding:"3px 8px",borderRadius:3,fontFamily:"inherit",fontSize:10}}>
          {Object.keys(THEMES).map(function(k){return <option key={k} value={k}>{THEMES[k].name}</option>;})}
        </select>
        <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:6,height:6,borderRadius:"50%",background:fbStatus==="ok"?"#27ae60":fbStatus==="connecting"?"#f0a500":T.muted}}/><span style={{fontSize:9,color:T.muted,letterSpacing:1}}>{fbStatus==="ok"?"LIVE":"..."}</span></div>
      </div>
    </div>
    <div style={{padding:"16px 14px",maxWidth:600,margin:"0 auto"}}>
      {/* Mode toggle */}
      <div style={{display:"flex",borderBottom:"2px solid "+T.border,marginBottom:16}}>
        {[{k:"meet",l:"Meet Races"},{k:"workout",l:"Workout"},{k:"open",l:"Open Timer"}].map(function(m){return(<button key={m.k} onClick={function(){setMode(m.k);}} style={{padding:"8px 16px",background:"none",border:"none",borderBottom:"2px solid "+(mode===m.k?T.accent:"transparent"),color:mode===m.k?T.accent:T.muted,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:-2}}>{m.l}</button>);})}
      </div>
      {/* Split distance */}
      <div style={{marginBottom:16}}><div style={{fontSize:9,letterSpacing:4,color:T.accent,textTransform:"uppercase",marginBottom:6}}>Split Distance</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:6}}>{PRESET_DISTANCES.map(function(d){var on=splitLabel===d&&!customLabel.trim();return(<button key={d} onClick={function(){setSplitLabel(d);setCustomLabel("");}} style={{padding:"4px 10px",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,background:on?T.accent:"transparent",color:on?T.bg:T.muted,border:"1px solid "+(on?T.accent:T.dim)}}>{d}</button>);})}</div>
        <input value={customLabel} onChange={function(e){setCustomLabel(e.target.value);}} placeholder="Custom label..." style={{width:"100%",boxSizing:"border-box",background:T.card,border:"1px solid "+(customLabel.trim()?T.accent:T.border),color:T.text,padding:"6px 12px",borderRadius:3,fontSize:13,fontFamily:"inherit",outline:"none"}}/>
      </div>

      {/* ── MEET MODE ── */}
      {mode==="meet"?(<div>
        <div style={{fontSize:9,letterSpacing:4,color:T.accent,textTransform:"uppercase",marginBottom:8}}>Upcoming Meets with Lineups</div>
        {meetsWithLineups.length===0?<div style={{fontSize:12,color:T.muted,fontStyle:"italic",padding:"12px",background:T.card,borderRadius:4,border:"1px solid "+T.border}}>No upcoming meets with lineups. Assign runners on Meet Schedule first.</div>:
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {meetsWithLineups.map(function(meet){var isA=importedMeetId===(meet.id||meet.name);var evts=Object.entries(meet.lineup||{}).filter(function(e){return(e[1].runners||[]).length>0;});var isNext=meetsWithLineups[0]&&(meetsWithLineups[0].id||meetsWithLineups[0].name)===(meet.id||meet.name);
            return(<div key={meet.id||meet.name} style={{background:T.card,border:"1px solid "+(isA?"#2d7a35":isNext?T.accent+"44":T.border),borderRadius:4,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{fontSize:14,fontWeight:800,color:T.text}}>{meet.name}</div>{isNext?<span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:T.accent+"22",color:T.accent,fontWeight:700}}>NEXT</span>:null}</div><div style={{fontSize:10,color:T.muted}}>{meet.date||""} — {evts.map(function(e){return e[0];}).join(", ")}</div></div>
                <button onClick={function(){importMeetEvents(meet);}} style={{padding:"6px 14px",background:isA?"#1a3a1a":T.accent,color:isA?"#5ddb6a":T.bg,border:"1px solid "+(isA?"#2d7a35":T.accent),borderRadius:3,cursor:"pointer",fontSize:12,fontWeight:900,fontFamily:"inherit",letterSpacing:1,textTransform:"uppercase"}}>{isA?"\u2713 Imported":"Import"}</button>
              </div>
            </div>);})}
        </div>}
      </div>):null}

      {/* ── WORKOUT MODE ── */}
      {mode==="workout"?(<div>
        <div style={{marginBottom:12}}><div style={{fontSize:9,letterSpacing:4,color:T.accent,textTransform:"uppercase",marginBottom:6}}>Workout Name</div>
          <input value={woName} onChange={function(e){setWoName(e.target.value);}} placeholder="e.g. 4x400 @ Threshold" style={{width:"100%",boxSizing:"border-box",background:T.card,border:"1px solid "+(woName.trim()?T.accent:T.border),color:T.text,padding:"8px 12px",borderRadius:3,fontSize:14,fontFamily:"inherit",outline:"none"}}/>
        </div>
        <div style={{background:T.card,border:"1px solid "+T.border,borderLeft:"3px solid #4a9eff",borderRadius:4,padding:"12px 14px",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:800,color:T.text,marginBottom:6}}>Import Pace Groups</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
            <select value={paceKey} onChange={function(e){setPaceKey(e.target.value);}} style={{background:T.timerBg,border:"1px solid "+T.border,color:T.text,padding:"5px 8px",borderRadius:3,fontFamily:"inherit",fontSize:12}}>{PACE_KEYS.map(function(p){return <option key={p.k} value={p.k}>{p.l}</option>;})}</select>
            <select value={paceTol} onChange={function(e){setPaceTol(parseInt(e.target.value));}} style={{background:T.timerBg,border:"1px solid "+T.border,color:T.text,padding:"5px 8px",borderRadius:3,fontFamily:"inherit",fontSize:12}}>{[2,4,6,8,10,12,14,16,18,20].map(function(t){return <option key={t} value={t}>{t}s</option>;})}</select>
            <button onClick={importPaceGroups} style={{padding:"5px 12px",background:"#4a9eff",color:T.bg,border:"none",borderRadius:3,cursor:"pointer",fontSize:12,fontWeight:900,fontFamily:"inherit"}}>Generate</button>
          </div>
        </div>
        <div style={{background:T.card,border:"1px solid "+T.border,borderLeft:"3px solid "+T.accent,borderRadius:4,padding:"12px 14px",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:800,color:T.text,marginBottom:6}}>Manual Groups</div>
          <div style={{display:"flex",gap:5,marginBottom:8}}>
            <input value={newGrpName} onChange={function(e){setNewGrpName(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter"&&newGrpName.trim()){setWoGroups(function(prev){return prev.concat([{id:"mg_"+Date.now(),name:newGrpName.trim(),color:GROUP_COLORS[prev.length%GROUP_COLORS.length],runnerIds:[]}]);});setNewGrpName("");}}} placeholder="Group name..." style={{flex:1,background:T.timerBg,border:"1px solid "+T.border,color:T.text,padding:"6px 10px",borderRadius:3,fontSize:12,fontFamily:"inherit",outline:"none"}}/>
            <button onClick={function(){if(newGrpName.trim()){setWoGroups(function(prev){return prev.concat([{id:"mg_"+Date.now(),name:newGrpName.trim(),color:GROUP_COLORS[prev.length%GROUP_COLORS.length],runnerIds:[]}]);});setNewGrpName("");}}} style={{padding:"6px 12px",background:T.accent,color:T.bg,border:"none",borderRadius:3,cursor:"pointer",fontSize:12,fontWeight:900,fontFamily:"inherit"}}>+ Group</button>
          </div>
        </div>
        {woGroups.map(function(g){var members=g.runnerIds.map(function(rid){return rosterMap[rid];}).filter(Boolean);var available=allAthletes.filter(function(a){return!g.runnerIds.includes(String(a.id));});
          return(<div key={g.id} style={{background:T.card,border:"1px solid "+T.border,borderLeft:"3px solid "+g.color,borderRadius:4,padding:"10px 12px",marginBottom:6}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:2,background:g.color}}/><span style={{fontSize:14,fontWeight:800,color:T.text}}>{g.name}</span><span style={{fontSize:10,color:T.muted}}>{members.length}</span></div><button onClick={function(){if(confirm("Remove group "+g.name+"?"))setWoGroups(function(prev){return prev.filter(function(x){return x.id!==g.id;});});}} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>{"\u00D7"}</button></div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>{members.map(function(a){return(<span key={a.id} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",background:g.color+"18",border:"1px solid "+g.color+"44",borderRadius:3,fontSize:11,fontWeight:700,color:T.text}}>{a.name}<button onClick={function(){setWoGroups(function(prev){return prev.map(function(x){return x.id===g.id?Object.assign({},x,{runnerIds:x.runnerIds.filter(function(r){return r!==String(a.id);})}):x;});});}} style={{background:"none",border:"none",color:g.color,cursor:"pointer",fontSize:12,padding:0}}>{"\u00D7"}</button></span>);})}</div>
            <select value="" onChange={function(e){if(e.target.value){var rid=e.target.value;setWoGroups(function(prev){return prev.map(function(x){return x.id===g.id?Object.assign({},x,{runnerIds:x.runnerIds.concat([rid])}):x;});});}}} style={{width:"100%",background:T.timerBg,border:"1px solid "+T.border,color:T.muted,padding:"4px 8px",borderRadius:3,fontFamily:"inherit",fontSize:11}}>
              <option value="">+ Add runner...</option>{available.map(function(a){return <option key={a.id} value={String(a.id)}>{a.name} ({a.team})</option>;})}
            </select>
          </div>);
        })}
      </div>):null}

      {/* ── OPEN MODE ── */}
      {mode==="open"?(<div>
        <div style={{marginBottom:12}}><div style={{fontSize:9,letterSpacing:4,color:T.accent,textTransform:"uppercase",marginBottom:6}}>Session Label</div>
          <input value={woName} onChange={function(e){setWoName(e.target.value);}} placeholder="e.g. Practice, Time Trial..." style={{width:"100%",boxSizing:"border-box",background:T.card,border:"1px solid "+(woName.trim()?T.accent:T.border),color:T.text,padding:"8px 12px",borderRadius:3,fontSize:14,fontFamily:"inherit",outline:"none"}}/>
        </div>
        <div style={{background:T.card,border:"1px solid "+T.border,borderLeft:"3px solid "+T.accent,borderRadius:4,padding:"12px 14px",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:800,color:T.text,marginBottom:8}}>Select Runners</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {[{label:"Boys",list:boys,clr:"#4a9eff"},{label:"Girls",list:girls,clr:"#ff7eb3"}].map(function(grp){var selected=(races[0]&&races[0].runnerIds)||[];return(<div key={grp.label} style={{flex:1,minWidth:140}}>
              <div style={{fontSize:10,fontWeight:700,color:grp.clr,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{grp.label}</div>
              {grp.list.map(function(a){var isIn=selected.includes(String(a.id));return(<button key={a.id} onClick={function(){setRaces(function(prev){var r=prev[0]||{id:"open_"+Date.now(),event:woName.trim()||"Open",team:"",label:woName.trim()||"Open Timer",runnerIds:[],splits:{},elapsed:0,status:"ready",finished:{},meetName:woName.trim()||"Open Timer",meetDate:sessionDate,type:"open"};var ids=(r.runnerIds||[]).slice();if(isIn)ids=ids.filter(function(x){return x!==String(a.id);});else ids.push(String(a.id));return[Object.assign({},r,{runnerIds:ids,event:woName.trim()||"Open",label:woName.trim()||"Open Timer",meetName:woName.trim()||"Open Timer"})];});}} style={{display:"block",width:"100%",textAlign:"left",padding:"4px 8px",marginBottom:2,borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:isIn?700:500,background:isIn?grp.clr+"18":"transparent",border:"1px solid "+(isIn?grp.clr+"44":T.dim),color:isIn?T.text:T.muted}}>{isIn?"\u2713 ":""}{a.name}</button>);})}
            </div>);})}
          </div>
          <button onClick={function(){var allIds=allAthletes.map(function(a){return String(a.id);});setRaces([{id:"open_"+Date.now(),event:woName.trim()||"Open",team:"",label:woName.trim()||"Open Timer",runnerIds:allIds,splits:{},elapsed:0,status:"ready",finished:{},meetName:woName.trim()||"Open Timer",meetDate:sessionDate,type:"open"}]);}} style={{marginTop:8,padding:"4px 10px",background:"transparent",color:T.muted,border:"1px solid "+T.dim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:"inherit"}}>Select All</button>
        </div>
      </div>):null}

      {/* Race preview */}
      {races.length>0?<div style={{marginTop:16,marginBottom:12}}><div style={{fontSize:9,letterSpacing:4,color:T.accent,textTransform:"uppercase",marginBottom:6}}>Race Cards ({races.length}) <span style={{fontSize:8,color:T.muted,fontStyle:"italic",letterSpacing:0,textTransform:"none"}}>tap to expand, drag to reorder runners</span></div>
        {races.map(function(r){var evClr=EVENT_COLORS[r.event]||r.color||T.accent;var isExp=expandedRace===r.id;var rRunners=(r.runnerIds||[]).map(function(rid){return rosterMap[rid]||rosterMap[String(rid)];}).filter(Boolean);
          var previewMoveRunner=function(fromI,toI){if(fromI===toI)return;var ids=(r.runnerIds||[]).slice();var item=ids.splice(fromI,1)[0];ids.splice(toI,0,item);updateRace(r.id,{runnerIds:ids});};
          var previewRemoveRunner=function(rid){var ids=(r.runnerIds||[]).filter(function(x){return x!==rid;});updateRace(r.id,{runnerIds:ids});};
          var previewAddRunner=function(rid){if((r.runnerIds||[]).includes(rid))return;updateRace(r.id,{runnerIds:(r.runnerIds||[]).concat([rid])});};
          return(<div key={r.id} style={{marginBottom:4,background:T.card,border:"1px solid "+(isExp?evClr+"44":T.border),borderLeft:"3px solid "+evClr,borderRadius:4,overflow:"hidden"}}>
          <div onClick={function(){setExpandedRace(isExp?null:r.id);}} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",cursor:"pointer"}}>
            <span style={{fontSize:13,fontWeight:800,color:evClr}}>{r.label||r.event}</span>
            {r.team?<span style={{fontSize:10,fontWeight:700,color:TEAM_COLORS[r.team]||evClr}}>{r.team}</span>:null}
            <span style={{fontSize:10,color:T.muted,flex:1}}>{rRunners.length} runners</span>
            <span style={{fontSize:10,color:T.muted}}>{isExp?"\u25B2":"\u25BC"}</span>
          </div>
          {isExp?<div style={{padding:"4px 10px 8px",borderTop:"1px solid "+T.border}}>
            {rRunners.map(function(ath,ai){return(<div key={ath.id} draggable onDragStart={function(e){e.dataTransfer.setData("text/plain",String(ai));e.dataTransfer.effectAllowed="move";}} onDragOver={function(e){e.preventDefault();e.dataTransfer.dropEffect="move";}} onDrop={function(e){e.preventDefault();var from=parseInt(e.dataTransfer.getData("text/plain"));if(!isNaN(from))previewMoveRunner(from,ai);}} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 4px",marginBottom:2,borderRadius:3,background:T.timerBg,border:"1px solid "+T.border,cursor:"grab"}}>
              <span style={{fontSize:10,color:T.muted}}>{"\u2630"}</span>
              {r.event==="4x800"?<span style={{fontSize:9,fontWeight:700,color:evClr,padding:"0 4px",borderRadius:2,background:evClr+"18"}}>Leg {ai+1}</span>:null}
              <span style={{fontSize:12,fontWeight:700,color:T.text,flex:1}}>{ath.name}</span>
              <span style={{fontSize:9,color:TEAM_COLORS[ath.team]||T.muted}}>{ath.team}</span>
              <button onClick={function(e){e.stopPropagation();previewRemoveRunner(ath.id);}} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,padding:"0 2px",fontFamily:"inherit"}}>{"\u00D7"}</button>
            </div>);})}
            <select value="" onChange={function(e){if(e.target.value)previewAddRunner(e.target.value);}} style={{width:"100%",marginTop:4,background:T.timerBg,border:"1px dashed "+T.accent+"44",color:T.muted,padding:"4px 8px",borderRadius:3,fontFamily:"inherit",fontSize:11}}>
              <option value="">+ Add runner...</option>
              {allAthletes.filter(function(a){return!(r.runnerIds||[]).includes(String(a.id));}).map(function(a){return <option key={a.id} value={String(a.id)}>{a.name} ({a.team})</option>;})}
            </select>
          </div>:null}
        </div>);})}
        <button onClick={function(){if(confirm("Clear all race cards?"))resetAll();}} style={{marginTop:4,padding:"3px 8px",background:"transparent",color:T.muted,border:"1px solid "+T.dim,borderRadius:3,cursor:"pointer",fontSize:10,fontFamily:"inherit"}}>Clear</button>
      </div>:null}

      {/* Begin */}
      <div style={{marginTop:12,display:"flex",gap:8}}>
        {mode==="meet"?<button onClick={function(){if(races.length)setScreen("race");}} disabled={!races.length} style={{flex:1,padding:"13px",borderRadius:3,cursor:races.length?"pointer":"not-allowed",background:races.length?T.accent:T.card,color:races.length?T.bg:T.muted,border:"1px solid "+(races.length?T.accent:T.border),fontSize:15,fontWeight:900,fontFamily:"inherit",letterSpacing:3,textTransform:"uppercase"}}>{races.length?"Begin \u2192":"Import a meet"}</button>:null}
        {mode==="workout"?<button onClick={function(){if(woGroups.length>0){startWorkout();setScreen("race");}}} disabled={!woGroups.length} style={{flex:1,padding:"13px",borderRadius:3,cursor:woGroups.length?"pointer":"not-allowed",background:woGroups.length?T.accent:T.card,color:woGroups.length?T.bg:T.muted,border:"1px solid "+(woGroups.length?T.accent:T.border),fontSize:15,fontWeight:900,fontFamily:"inherit",letterSpacing:3,textTransform:"uppercase"}}>{woGroups.length?"Start Workout \u2192":"Create groups"}</button>:null}
        {mode==="open"?(function(){var ok=races.length>0&&(races[0].runnerIds||[]).length>0;return <button onClick={function(){if(ok)setScreen("race");}} disabled={!ok} style={{flex:1,padding:"13px",borderRadius:3,cursor:ok?"pointer":"not-allowed",background:ok?T.accent:T.card,color:ok?T.bg:T.muted,border:"1px solid "+(ok?T.accent:T.border),fontSize:15,fontWeight:900,fontFamily:"inherit",letterSpacing:3,textTransform:"uppercase"}}>{ok?"Start Timer \u2192":"Select runners"}</button>;})():null}
      </div>

      {/* ── HISTORY ── */}
      <div style={{marginTop:24}}>
        <button onClick={function(){setHistOpen(!histOpen);}} style={{width:"100%",padding:"10px 14px",background:T.card,border:"1px solid "+T.border,borderRadius:4,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"inherit"}}>
          <span style={{fontSize:13,fontWeight:800,color:T.accent,letterSpacing:1}}>Saved Meets ({histKeys.length})</span>
          <span style={{fontSize:10,color:T.muted}}>{histOpen?"[-]":"[+]"}</span>
        </button>
        {histOpen?<div style={{marginTop:8}}>
          {histKeys.length===0?<div style={{fontSize:12,color:T.muted,fontStyle:"italic",padding:"12px"}}>No saved sessions yet.</div>:null}
          {histKeys.map(function(key){var sess=histBySession[key];var unsaved=unsavedByMeet[key]||0;return(<div key={key} style={{marginBottom:12,background:T.card,border:"1px solid "+T.border,borderRadius:4,overflow:"hidden"}}>
            <div style={{padding:"8px 12px",borderBottom:"1px solid "+T.border,display:"flex",justifyContent:"space-between",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:T.text,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span>{sess.name}</span>
                  {unsaved>0?<span title={unsaved+" race(s) in the timer haven't been saved yet"} style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"#f0a50022",color:"#f0a500",border:"1px solid #f0a50066",fontWeight:800,letterSpacing:0.5}}>{"\u26A0 "+unsaved+" UNSAVED"}</span>:null}
                </div>
                <div style={{fontSize:10,color:T.muted,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginTop:1}}>
                  <span>{sess.date}</span>
                  <span>{"\u00B7"}</span>
                  <span>{sess.races.length} race{sess.races.length!==1?"s":""}</span>
                  {sess.headCount>0||sess.asstCount>0?<span>{"\u00B7"}</span>:null}
                  {sess.headCount>0?<span style={{color:"#5ddb6a"}}>{sess.headCount} head</span>:null}
                  {sess.headCount>0&&sess.asstCount>0?<span style={{color:T.muted}}>{","}</span>:null}
                  {sess.asstCount>0?<span style={{color:"#3498DB"}}>{sess.asstCount} asst</span>:null}
                </div>
              </div>
              <div style={{display:"flex",gap:4}}>
              {navigateToResultsMeet?<button onClick={function(){navigateToResultsMeet(sess.meetKey);}} title="Open this meet in the Race Results tab" style={{background:"#27ae6018",border:"1px solid #27ae6044",color:"#27ae60",borderRadius:3,padding:"3px 8px",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>View in Results</button>:null}
              <button onClick={function(){
                var rows=[["Race","Place","Athlete","Team","Split #","Split Time","Total Time"]];
                sess.races.forEach(function(race){var evLabel=(race.event||"")+(race.team?" "+race.team:"");var runners=(race.runners||[]).slice().sort(function(a,b){return(a.finalTime||999999)-(b.finalTime||999999);});runners.forEach(function(r,ri){var sp=r.splits||[];if(!sp.length){rows.push([evLabel,ri+1,r.name,r.team||"","","",""]);}else{sp.forEach(function(s,si){rows.push([si===0?evLabel:"",si===0?ri+1:"",si===0?r.name:"",si===0?r.team||"":"",si+1,fmtSplit(s.split),fmtTime(s.total)]);});}});});
                var csv=rows.map(function(r){return r.map(function(v){return'"'+v+'"';}).join(",");}).join("\n");
                var el=document.createElement("a");el.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));el.download="results_"+sess.name.replace(/\s+/g,"_")+"_"+(sess.date||"").replace(/\s+/g,"")+".csv";el.click();
              }} style={{background:T.accent+"18",border:"1px solid "+T.accent+"44",color:T.accent,borderRadius:3,padding:"3px 8px",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>CSV</button>
              <button onClick={function(){if(confirm("Delete "+sess.name+"?")){if(onDeleteHistory){var keep=raceResults.filter(function(r){return!((r.meetName||"Session")+"\u2014"+(r.meetDate||"")===key);});onDeleteHistory(keep);}}}} style={{background:"rgba(239,68,68,0.1)",border:"none",color:"#ef4444",borderRadius:3,padding:"3px 8px",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>Delete</button>
              </div>
            </div>
            {sess.races.slice().sort(function(a,b){return(a.sortKey||0)-(b.sortKey||0);}).map(function(race){
              var evClr=EVENT_COLORS[race.event]||T.accent;
              var isRelay=race.event==="4x800";
              /* Relay: preserve leg order. Standard: sort by finalTime. */
              var runners=isRelay?(race.runners||[]).slice():(race.runners||[]).slice().sort(function(a,b){return(a.finalTime||999999)-(b.finalTime||999999);});
              var maxSplits=runners.reduce(function(m,r){return Math.max(m,(r.splits||[]).length);},0);
              var teamTotal=isRelay?runners.reduce(function(m,r){return r.finalTime>m?r.finalTime:m;},0):0;
              return(<div key={race.id||race.event+race.team} style={{padding:"8px 12px",borderBottom:"1px solid "+T.dim}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><span style={{fontSize:12,fontWeight:800,color:evClr}}>{race.event}</span>{race.team?<span style={{fontSize:10,fontWeight:700,color:TEAM_COLORS[race.team]||evClr}}>{race.team}</span>:null}{race.heat>1?<span style={{fontSize:9,color:T.muted}}>H{race.heat}</span>:null}{race.savedBy?<span style={{fontSize:8,padding:"1px 4px",borderRadius:2,background:race.savedBy==="asst"?"#3498DB18":"#27ae6018",color:race.savedBy==="asst"?"#3498DB":"#27ae60"}}>{race.savedBy==="asst"?"Asst":"Head"}</span>:null}<button onClick={function(){if(confirm("Delete this race?")){if(onDeleteHistory){var keep=raceResults.filter(function(r2){return r2.id!==race.id;});onDeleteHistory(keep);}}}} style={{marginLeft:"auto",background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:10,padding:0}}>x</button></div>
              {isRelay?(<div>
                {runners.map(function(r,ri){var sp=(r.splits||[])[0];return(<div key={r.id||ri} style={{display:"flex",alignItems:"center",gap:6,padding:"2px 0"}}>
                  <span style={{width:36,fontSize:10,fontWeight:700,color:evClr,textAlign:"center"}}>Leg {ri+1}</span>
                  <span style={{flex:1,fontSize:11,fontWeight:600,color:T.text}}>{r.name}</span>
                  <span style={{fontSize:13,fontWeight:700,color:T.splitClr||T.text,fontFamily:"'Share Tech Mono',monospace",width:65,textAlign:"center"}}>{sp?fmtSplit(sp.split):"--"}</span>
                  <span style={{fontSize:13,fontWeight:700,color:T.timeClr,fontFamily:"'Share Tech Mono',monospace",minWidth:65,textAlign:"right"}}>{sp?fmtTime(sp.total):"--"}</span>
                </div>);})}
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",marginTop:3,borderRadius:3,background:evClr+"15",border:"1px solid "+evClr+"55"}}>
                  <span style={{width:36,fontSize:10,fontWeight:900,color:evClr,textAlign:"center",letterSpacing:1}}>TOTAL</span>
                  <span style={{flex:1,fontSize:10,color:T.muted}}>4x800 Team</span>
                  <span style={{width:65,fontSize:10,color:T.muted,textAlign:"center"}}>{"\u2014"}</span>
                  <span style={{fontSize:14,fontWeight:900,color:evClr,fontFamily:"'Share Tech Mono',monospace",minWidth:65,textAlign:"right"}}>{teamTotal?fmtTime(teamTotal):"--"}</span>
                </div>
              </div>):runners.map(function(r,ri){var sps=r.splits||[];return(<div key={r.id||ri} style={{display:"flex",alignItems:"center",gap:6,padding:"2px 0"}}>
                <span style={{width:18,fontSize:10,fontWeight:700,color:ri===0?evClr:T.muted,textAlign:"center"}}>{ri+1}</span>
                <span style={{flex:1,fontSize:11,fontWeight:ri===0?700:500,color:ri===0?evClr:T.muted}}>{r.name}</span>
                {maxSplits>0?Array.from({length:maxSplits},function(_,si){var s=sps[si];return <span key={si} style={{fontSize:13,fontWeight:700,color:T.oldSplit||T.timeClr,fontFamily:"'Share Tech Mono',monospace",width:55,textAlign:"center"}}>{s?fmtSplit(s.split):""}</span>;}):null}
                <span style={{fontSize:14,fontWeight:800,color:ri===0?"#5ddb6a":T.timeClr,fontFamily:"'Share Tech Mono',monospace",minWidth:65,textAlign:"right"}}>{r.finalTime?fmtTime(r.finalTime):"--"}</span>
              </div>);})}
            </div>);})}
          </div>);})}
        </div>:null}
      </div>
    </div>
  </div>);}

  /* ── RACE SCREEN ── */
  return(<div style={{background:T.bg,minHeight:"100vh",fontFamily:"'Barlow Condensed',sans-serif",color:T.text}}>
    <div style={{padding:"10px 14px",borderBottom:"1px solid "+T.border,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:T.bg,zIndex:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={function(){setScreen("setup");}} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:10,fontFamily:"inherit",letterSpacing:2,textTransform:"uppercase",padding:0}}>{"\u2190"} Setup</button>
        <span style={{fontSize:12,fontWeight:800,color:T.accent,letterSpacing:2,textTransform:"uppercase"}}>{label}</span>
      </div>
      <div style={{display:"flex",gap:5,alignItems:"center"}}>
        <button onClick={function(){setBeep(!beepOn);}} title={beepOn?"Beep on":"Beep off"} style={{padding:"6px 10px",background:beepOn?T.accent+"22":"transparent",color:beepOn?T.accent:T.muted,border:"1px solid "+(beepOn?T.accent+"66":T.border),borderRadius:3,cursor:"pointer",fontSize:14,fontFamily:"inherit",lineHeight:1}}>{beepOn?"\uD83D\uDD0A":"\uD83D\uDD07"}</button>
        {anyHasSplits&&!allSaved?<button onClick={saveAllUnsaved} style={{padding:"6px 14px",background:"#3498DB",color:T.bg,border:"none",borderRadius:3,cursor:"pointer",fontSize:12,fontWeight:900,fontFamily:"inherit",letterSpacing:1,textTransform:"uppercase"}}>Save All</button>:null}
        {allSaved&&anyHasSplits?<button onClick={clearSession} style={{padding:"6px 14px",background:"#27ae60",color:T.bg,border:"none",borderRadius:3,cursor:"pointer",fontSize:12,fontWeight:900,fontFamily:"inherit",letterSpacing:1,textTransform:"uppercase"}}>Done - Clear</button>:null}
      </div>
    </div>
    <div style={{padding:"8px 10px"}}>
      {races.map(function(race){return <RaceCard key={race.id} race={race} rosterMap={rosterMap} paces={fbPaces} onUpdateRace={updateRace} onSaveRace={saveOneRace} splitLabel={label} T={T} allAthletes={allAthletes} beepOn={beepOn}/>;})}</div>
  </div>);
}
