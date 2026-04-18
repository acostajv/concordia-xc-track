import { useState, useEffect, useRef, memo } from "react";
import { fmtTime, fmtSplit, getSplitsToFinish, isRelayRace, parseTimeStr, EVENT_COLORS, TEAM_COLORS } from "./splitTimerUtils";

const PacePill = ({ label, value, color }) => {
  if (!value) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "1px 5px", borderRadius: 2, background: color + "14", border: "1px solid " + color + "35" }}>
      <span style={{ color, fontWeight: 800, fontSize: 9, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ color: "#ccc", fontFamily: "'Share Tech Mono',monospace", fontSize: 11, fontWeight: 600 }}>{value}</span>
    </span>
  );
};

function RaceCard(props) {
  const {
    race,
    rosterMap,
    paces,
    onUpdateRace,
    onSaveRace,
    splitLabel = "400m",
    T,
    allAthletes = [],
    beepOn = false,
  } = props;

  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(race.elapsed || 0);
  const [flashMap, setFlashMap] = useState({});
  const [dragIdx, setDragIdx] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [actionFor, setActionFor] = useState(null);
  const [manualEntry, setManualEntry] = useState({ rid: null, value: "" });
  const [confirmModal, setConfirmModal] = useState(null);
  const [wakeLockFailed, setWakeLockFailed] = useState(false);
  const [pressProgress, setPressProgress] = useState({ rid: null, pct: 0 });

  const startRef = useRef(null);
  const pausedRef = useRef(race.elapsed || 0);
  const rafRef = useRef(null);
  const elapsedRef = useRef(race.elapsed || 0);
  const resyncRef = useRef(null);
  const longPressRef = useRef({ timer: null, fired: false });
  const wakeLockRef = useRef(null);
  const lastTapRef = useRef({});
  const audioCtxRef = useRef(null);
  const pressRafRef = useRef(null);

  const freshElapsed = () =>
    // eslint-disable-next-line react-hooks/purity
    startRef.current !== null ? performance.now() - startRef.current + pausedRef.current : elapsedRef.current;

  /* Snapshot pre-mutation timer state for race-wide undo. Cap stack at 20. */
  const pushHistory = (label) => {
    const entry = {
      label,
      splits: race.splits || {},
      finished: race.finished || {},
      dnf: race.dnf || {},
      elapsed: race.elapsed || 0,
      status: race.status || "ready",
    };
    return [...(race.history || []), entry].slice(-20);
  };

  const emitBeep = (ctx) => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch {
      /* ignore audio errors */
    }
  };

  const playBeep = () => {
    if (!beepOn) return;
    try {
      if (!audioCtxRef.current) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        audioCtxRef.current = new Ctor();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().then(() => emitBeep(ctx)).catch(() => {});
        return;
      }
      emitBeep(ctx);
    } catch {
      /* ignore audio errors */
    }
  };

  /* Drive the clock via useEffect keyed on isRunning. Avoids the self-reference
     temporal-dead-zone that a useCallback-inside-rAF pattern would hit. */
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;
    const loop = () => {
      if (cancelled || startRef.current === null) return;
      const now = performance.now() - startRef.current + pausedRef.current;
      elapsedRef.current = now;
      setElapsed(now);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [isRunning]);

  const startTimer = () => {
    startRef.current = performance.now();
    setIsRunning(true);
  };

  const pauseTimer = () => {
    cancelAnimationFrame(rafRef.current);
    const now = freshElapsed();
    startRef.current = null;
    elapsedRef.current = now;
    pausedRef.current = now;
    setElapsed(now);
    setIsRunning(false);
    onUpdateRace(race.id, { elapsed: now, status: "paused" });
  };

  const effectiveSplit = race.splitLabel || splitLabel;
  const splitsToFinish = getSplitsToFinish(race.event, effectiveSplit, race.distanceM || 0);
  const finishedMap = race.finished || {};
  const isRelay = isRelayRace(race);
  const legCount = (race.runnerIds || []).length;
  const splitsPerLeg =
    isRelay && legCount > 0 && splitsToFinish > 0 ? Math.max(1, Math.ceil(splitsToFinish / legCount)) : 1;

  let activeLeg = -1;
  if (isRelay) {
    for (let li = 0; li < (race.runnerIds || []).length; li++) {
      if (!finishedMap[race.runnerIds[li]]) {
        activeLeg = li;
        break;
      }
    }
  }

  const finishRace = () => {
    cancelAnimationFrame(rafRef.current);
    const now = freshElapsed();
    startRef.current = null;
    elapsedRef.current = now;
    pausedRef.current = now;
    setElapsed(now);
    setIsRunning(false);
    const ns = { ...(race.splits || {}) };
    const nf = { ...(race.finished || {}) };
    if (isRelay) {
      if (activeLeg >= 0 && activeLeg < (race.runnerIds || []).length) {
        const rid = race.runnerIds[activeLeg];
        if (!nf[rid]) {
          const prev = ns[rid] || [];
          let lastTotal = 0;
          if (prev.length > 0) lastTotal = prev[prev.length - 1].total;
          else if (activeLeg > 0) {
            const prevRid = race.runnerIds[activeLeg - 1];
            const prevSp = ns[prevRid] || [];
            if (prevSp.length > 0) lastTotal = prevSp[prevSp.length - 1].total;
          }
          if (now > lastTotal + 500) ns[rid] = prev.concat([{ split: now - lastTotal, total: now }]);
        }
      }
      (race.runnerIds || []).forEach((rid) => {
        nf[rid] = true;
      });
    } else {
      (race.runnerIds || []).forEach((rid) => {
        if (nf[rid]) return;
        const sp = ns[rid] || [];
        if (sp.length > 0) {
          const last = sp[sp.length - 1].total;
          if (now > last + 500) ns[rid] = sp.concat([{ split: now - last, total: now }]);
        }
        nf[rid] = true;
      });
    }
    onUpdateRace(race.id, { status: "done", elapsed: now, splits: ns, finished: nf, history: pushHistory("Finish race") });
  };

  const resetRace = () => {
    cancelAnimationFrame(rafRef.current);
    startRef.current = null;
    setIsRunning(false);
    setElapsed(0);
    elapsedRef.current = 0;
    pausedRef.current = 0;
    onUpdateRace(race.id, { elapsed: 0, splits: {}, status: "ready", finished: {}, dnf: {}, history: [] });
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /* Wake lock — keep the screen on while a race is actively running */
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.wakeLock) {
      if (isRunning) setWakeLockFailed(true);
      return;
    }
    const releaseLock = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
    const acquire = () => {
      if (!isRunning || wakeLockRef.current) return;
      navigator.wakeLock
        .request("screen")
        .then((s) => {
          wakeLockRef.current = s;
          setWakeLockFailed(false);
          s.addEventListener("release", () => {
            if (wakeLockRef.current === s) wakeLockRef.current = null;
          });
        })
        .catch(() => setWakeLockFailed(true));
    };
    if (isRunning) acquire();
    else releaseLock();
    const onVis = () => {
      if (document.visibilityState === "visible" && isRunning) acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      releaseLock();
    };
  }, [isRunning]);

  /* Auto-resync: keep elapsedRef fresh even when rAF is throttled */
  useEffect(() => {
    if (!isRunning) {
      if (resyncRef.current) {
        clearInterval(resyncRef.current);
        resyncRef.current = null;
      }
      return;
    }
    resyncRef.current = setInterval(() => {
      if (startRef.current !== null) {
        elapsedRef.current = performance.now() - startRef.current + pausedRef.current;
      }
    }, 2000);
    return () => {
      if (resyncRef.current) {
        clearInterval(resyncRef.current);
        resyncRef.current = null;
      }
    };
  }, [isRunning]);

  const isReady = race.status === "ready" && !isRunning && elapsed === 0;

  const moveRunner = (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    const ids = (race.runnerIds || []).slice();
    const item = ids.splice(fromIdx, 1)[0];
    ids.splice(toIdx, 0, item);
    onUpdateRace(race.id, { runnerIds: ids });
  };

  const removeRunner = (rid) => {
    const ids = (race.runnerIds || []).filter((r) => r !== rid);
    const ns = { ...(race.splits || {}) };
    delete ns[rid];
    const nf = { ...(race.finished || {}) };
    delete nf[rid];
    onUpdateRace(race.id, { runnerIds: ids, splits: ns, finished: nf });
  };

  const addRunner = (rid) => {
    if ((race.runnerIds || []).includes(rid)) return;
    onUpdateRace(race.id, { runnerIds: (race.runnerIds || []).concat([rid]) });
  };

  const pressStart = (rid) => {
    longPressRef.current.fired = false;
    if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
    cancelAnimationFrame(pressRafRef.current);
    // eslint-disable-next-line react-hooks/purity
    const startedAt = performance.now();
    setPressProgress({ rid, pct: 0 });
    const animate = () => {
      const ms = performance.now() - startedAt;
      const pct = Math.min(1, ms / 500);
      setPressProgress({ rid, pct });
      if (pct < 1) pressRafRef.current = requestAnimationFrame(animate);
    };
    pressRafRef.current = requestAnimationFrame(animate);
    longPressRef.current.timer = setTimeout(() => {
      longPressRef.current.fired = true;
      longPressRef.current.timer = null;
      cancelAnimationFrame(pressRafRef.current);
      setPressProgress({ rid: null, pct: 0 });
      setActionFor(rid);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate(40);
        } catch {
          /* vibration not supported */
        }
      }
    }, 500);
  };

  const pressEnd = () => {
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
    cancelAnimationFrame(pressRafRef.current);
    setPressProgress({ rid: null, pct: 0 });
  };

  const submitManualEntry = (rid, str) => {
    const ms = parseTimeStr(str);
    if (ms === null || ms <= 0) return;
    const ns = { ...(race.splits || {}) };
    const nf = { ...(race.finished || {}) };
    if (isRelay) {
      const legIdx = (race.runnerIds || []).indexOf(rid);
      let legStart = 0;
      if (legIdx > 0) {
        const prevRid = race.runnerIds[legIdx - 1];
        const prevSp = ns[prevRid] || [];
        if (prevSp.length > 0) legStart = prevSp[prevSp.length - 1].total;
      }
      if (ms <= legStart) return;
      ns[rid] = [{ split: ms - legStart, total: ms }];
      nf[rid] = true;
    } else {
      const prev = ns[rid] || [];
      const lastTotal = prev.length > 0 ? prev[prev.length - 1].total : 0;
      if (ms <= lastTotal) return;
      ns[rid] = prev.concat([{ split: ms - lastTotal, total: ms }]);
      if (splitsToFinish > 0 && ns[rid].length >= splitsToFinish) nf[rid] = true;
    }
    /* If this push exceeds elapsed, bump elapsed up to match. When running,
       rebase startRef so freshElapsed() doesn't double-count. */
    const curElapsed = freshElapsed();
    const newElapsed = Math.max(curElapsed, ms);
    if (newElapsed > curElapsed) {
      elapsedRef.current = newElapsed;
      if (startRef.current !== null) {
        // eslint-disable-next-line react-hooks/purity
        startRef.current = performance.now();
        pausedRef.current = newElapsed;
      } else {
        pausedRef.current = newElapsed;
      }
      setElapsed(newElapsed);
    }
    const newHist = pushHistory("Manual entry");
    const allDone = (race.runnerIds || []).every((r) => nf[r]);
    if (allDone) {
      cancelAnimationFrame(rafRef.current);
      startRef.current = null;
      setIsRunning(false);
      onUpdateRace(race.id, { splits: ns, status: "done", elapsed: newElapsed, finished: nf, history: newHist });
    } else {
      onUpdateRace(race.id, {
        splits: ns,
        status: isRunning ? "running" : "paused",
        elapsed: newElapsed,
        finished: nf,
        history: newHist,
      });
    }
  };

  const undoSplit = (rid) => {
    const sp = (race.splits || {})[rid] || [];
    if (sp.length === 0) return;
    const ns = { ...(race.splits || {}) };
    ns[rid] = sp.slice(0, -1);
    const nf = { ...(race.finished || {}) };
    delete nf[rid];
    const dnfMap = { ...(race.dnf || {}) };
    delete dnfMap[rid];
    const wasDone = race.status === "done";
    if (wasDone) {
      cancelAnimationFrame(rafRef.current);
      setIsRunning(false);
    }
    onUpdateRace(race.id, { splits: ns, finished: nf, dnf: dnfMap, status: wasDone ? "paused" : race.status, history: pushHistory("Undo runner split") });
  };

  const markMissedSplit = (rid) => {
    if (finishedMap[rid]) return;
    const prev = (race.splits || {})[rid] || [];
    let lastTotal = 0;
    if (prev.length > 0) {
      lastTotal = prev[prev.length - 1].total;
    } else if (isRelay) {
      const legIdx = (race.runnerIds || []).indexOf(rid);
      if (legIdx > 0) {
        const prevRid = race.runnerIds[legIdx - 1];
        const prevSp = (race.splits || {})[prevRid] || [];
        if (prevSp.length > 0) lastTotal = prevSp[prevSp.length - 1].total;
      }
    }
    const ns = { ...(race.splits || {}) };
    ns[rid] = prev.concat([{ split: 0, total: lastTotal, missed: true }]);
    const nf = { ...finishedMap };
    const perRunner = isRelay ? splitsPerLeg : splitsToFinish;
    if (perRunner > 0 && ns[rid].length >= perRunner) nf[rid] = true;
    const newHist = pushHistory("Missed split");
    const allDone = (race.runnerIds || []).every((r) => nf[r]);
    if (allDone) {
      const doneNow = freshElapsed();
      cancelAnimationFrame(rafRef.current);
      startRef.current = null;
      elapsedRef.current = doneNow;
      pausedRef.current = doneNow;
      setElapsed(doneNow);
      setIsRunning(false);
      onUpdateRace(race.id, { splits: ns, finished: nf, status: "done", elapsed: doneNow, history: newHist });
    } else {
      onUpdateRace(race.id, {
        splits: ns,
        finished: nf,
        status: isRunning ? "running" : race.status === "ready" ? "ready" : "paused",
        history: newHist,
      });
    }
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate([20, 40, 20]);
      } catch {
        /* vibration not supported */
      }
    }
  };

  const markRunnerDone = (rid) => {
    if (finishedMap[rid]) return;
    const now = freshElapsed();
    if (now === 0 && !isRunning && !race.elapsed) return;
    const prev = (race.splits || {})[rid] || [];
    let lastTotal = 0;
    if (prev.length > 0) {
      lastTotal = prev[prev.length - 1].total;
    } else if (isRelay) {
      const legIdx = (race.runnerIds || []).indexOf(rid);
      if (legIdx > 0) {
        const prevRid = race.runnerIds[legIdx - 1];
        const prevSp = (race.splits || {})[prevRid] || [];
        if (prevSp.length > 0) lastTotal = prevSp[prevSp.length - 1].total;
      }
    }
    const ns = { ...(race.splits || {}) };
    if (now > lastTotal + 100) ns[rid] = prev.concat([{ split: now - lastTotal, total: now }]);
    else ns[rid] = prev;
    const nf = { ...finishedMap };
    nf[rid] = true;
    const newHist = pushHistory("Mark runner done");
    const allDone = (race.runnerIds || []).every((r) => nf[r]);
    if (allDone) {
      cancelAnimationFrame(rafRef.current);
      startRef.current = null;
      pausedRef.current = now;
      setIsRunning(false);
      onUpdateRace(race.id, { splits: ns, finished: nf, status: "done", elapsed: now, history: newHist });
    } else {
      onUpdateRace(race.id, { splits: ns, finished: nf, status: isRunning ? "running" : "paused", history: newHist });
    }
  };

  const toggleDnf = (rid) => {
    const dnfMap = { ...(race.dnf || {}) };
    const nf = { ...(race.finished || {}) };
    if (dnfMap[rid]) {
      delete dnfMap[rid];
      delete nf[rid];
      const wasDone = race.status === "done";
      if (wasDone) {
        cancelAnimationFrame(rafRef.current);
        setIsRunning(false);
      }
      onUpdateRace(race.id, { dnf: dnfMap, finished: nf, status: wasDone ? "paused" : race.status, history: pushHistory("Un-DNF") });
    } else {
      dnfMap[rid] = true;
      nf[rid] = true;
      const newHist = pushHistory("Mark DNF");
      const allDone = (race.runnerIds || []).every((r) => nf[r]);
      if (allDone) {
        cancelAnimationFrame(rafRef.current);
        const now = freshElapsed();
        startRef.current = null;
        elapsedRef.current = now;
        pausedRef.current = now;
        setElapsed(now);
        setIsRunning(false);
        onUpdateRace(race.id, { dnf: dnfMap, finished: nf, status: "done", elapsed: now, history: newHist });
      } else {
        onUpdateRace(race.id, { dnf: dnfMap, finished: nf, history: newHist });
      }
    }
  };

  const bulkDnfRemaining = () => {
    const remaining = (race.runnerIds || []).filter(
      (rid) => !finishedMap[rid] && !(race.dnf || {})[rid]
    );
    if (remaining.length === 0) return;
    const newHist = pushHistory("Bulk DNF rest");
    const dnfMap = { ...(race.dnf || {}) };
    const nf = { ...finishedMap };
    remaining.forEach((rid) => {
      dnfMap[rid] = true;
      nf[rid] = true;
    });
    const now = freshElapsed();
    cancelAnimationFrame(rafRef.current);
    startRef.current = null;
    elapsedRef.current = now;
    pausedRef.current = now;
    setElapsed(now);
    setIsRunning(false);
    onUpdateRace(race.id, {
      dnf: dnfMap,
      finished: nf,
      status: "done",
      elapsed: now,
      history: newHist,
    });
  };

  const undoLast = () => {
    const hist = race.history || [];
    if (hist.length === 0) return;
    const last = hist[hist.length - 1];
    /* Restore the timer epoch: if we were running, rebase startRef so the
       clock continues from the restored elapsed instead of jumping. */
    elapsedRef.current = last.elapsed;
    if (startRef.current !== null) {
      startRef.current = performance.now();
      pausedRef.current = last.elapsed;
    } else {
      pausedRef.current = last.elapsed;
    }
    setElapsed(last.elapsed);
    /* If the race was done and is now being reopened, make sure we're not
       still flagged as running. */
    if (last.status !== "done" && !isRunning && last.status === "running") {
      /* User had paused after; stay paused — do not restart automatically. */
    }
    onUpdateRace(race.id, {
      splits: last.splits,
      finished: last.finished,
      dnf: last.dnf,
      elapsed: last.elapsed,
      status: last.status === "running" ? "paused" : last.status,
      history: hist.slice(0, -1),
    });
  };

  const recordSplit = (rid) => {
    const now = freshElapsed();
    if (now === 0 && !isRunning) return;
    if (finishedMap[rid]) return;
    /* 1-second min-split guard: no realistic interval is <1s, so repeat
       taps within that window are treated as accidental double-taps. */
    // eslint-disable-next-line react-hooks/purity
    const nowTs = performance.now();
    const lastTs = lastTapRef.current[rid] || 0;
    if (nowTs - lastTs < 1000) return;
    lastTapRef.current[rid] = nowTs;

    const splitHist = pushHistory("Record split");
    if (isRelay) {
      const legIdx = (race.runnerIds || []).indexOf(rid);
      if (legIdx !== activeLeg) return;
      const prev = (race.splits || {})[rid] || [];
      let legStart = 0;
      if (prev.length > 0) legStart = prev[prev.length - 1].total;
      else if (legIdx > 0) {
        const prevRid = race.runnerIds[legIdx - 1];
        const prevSp = (race.splits || {})[prevRid] || [];
        if (prevSp.length > 0) legStart = prevSp[prevSp.length - 1].total;
      }
      const ns = { ...(race.splits || {}) };
      ns[rid] = prev.concat([{ split: now - legStart, total: now }]);
      const nf = { ...finishedMap };
      if (ns[rid].length >= splitsPerLeg) nf[rid] = true;
      const done1 = (race.runnerIds || []).every((r) => nf[r]);
      if (done1) {
        cancelAnimationFrame(rafRef.current);
        startRef.current = null;
        pausedRef.current = now;
        setIsRunning(false);
        onUpdateRace(race.id, { splits: ns, status: "done", elapsed: now, finished: nf, history: splitHist });
      } else {
        onUpdateRace(race.id, { splits: ns, status: "running", finished: nf, history: splitHist });
      }
    } else {
      const prev = (race.splits || {})[rid] || [];
      const last = prev.length > 0 ? prev[prev.length - 1].total : 0;
      const ns = { ...(race.splits || {}) };
      ns[rid] = prev.concat([{ split: now - last, total: now }]);
      const nf = { ...finishedMap };
      if (splitsToFinish > 0 && ns[rid].length >= splitsToFinish) nf[rid] = true;
      const done2 = (race.runnerIds || []).every((r) => nf[r]);
      if (done2) {
        cancelAnimationFrame(rafRef.current);
        startRef.current = null;
        pausedRef.current = now;
        setIsRunning(false);
        onUpdateRace(race.id, { splits: ns, status: "done", elapsed: now, finished: nf, history: splitHist });
      } else {
        onUpdateRace(race.id, { splits: ns, status: "running", finished: nf, history: splitHist });
      }
    }

    setFlashMap((p) => ({ ...p, [rid]: true }));
    setTimeout(() => setFlashMap((p) => ({ ...p, [rid]: false })), 350);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(50);
      } catch {
        /* vibration not supported */
      }
    }
    playBeep();
  };

  /* Compute the start-of-current-lap time for a runner, used by the live-lap
     timer overlay. Respects relay hand-off: an active leg before its first tap
     starts from the previous leg's last total. */
  const getLegStart = (ath, sp) => {
    if (sp.length > 0) return sp[sp.length - 1].total;
    if (isRelay) {
      const legIdx = (race.runnerIds || []).indexOf(ath.id);
      if (legIdx > 0) {
        const prevRid = race.runnerIds[legIdx - 1];
        const prevSp = (race.splits || {})[prevRid] || [];
        if (prevSp.length > 0) return prevSp[prevSp.length - 1].total;
      }
    }
    return 0;
  };

  const runners = (race.runnerIds || []).map((rid) => rosterMap[rid] || rosterMap[String(rid)]).filter(Boolean);
  const hasSplits = runners.some((a) => ((race.splits || {})[a.id] || []).length > 0);
  const evClr = EVENT_COLORS[race.event] || race.color || T.accent;
  const teamClr = TEAM_COLORS[race.team] || evClr;
  const isDone = race.status === "done";
  const finCount = Object.keys(finishedMap).length;

  /* SVG long-press ring geometry */
  const ringSize = 22;
  const ringR = 8;
  const ringC = 2 * Math.PI * ringR;

  /* Ghost clock: next checkpoint target time based on race.goalTime.
     For a 4-split 1600 with goal 6:00, next checkpoint after 2 splits is 4:30.
     We anchor to the leader's split count (farthest-along runner). */
  const goalMs = parseTimeStr(race.goalTime);
  let ghostMs = null;
  if (goalMs && splitsToFinish > 0 && !isRelay) {
    const leaderSplits = runners.reduce((m, ath) => {
      const asp = (race.splits || {})[ath.id] || [];
      return Math.max(m, asp.length);
    }, 0);
    const checkpoint = Math.min(leaderSplits + 1, splitsToFinish);
    ghostMs = (goalMs * checkpoint) / splitsToFinish;
  } else if (goalMs && splitsToFinish === 0) {
    ghostMs = goalMs;
  }
  const ghostDiff = ghostMs !== null ? elapsed - ghostMs : null;
  const ghostAhead = ghostDiff !== null && ghostDiff < 0;

  return (
    <div style={{ borderRadius: 6, border: "1px solid " + (isRunning ? evClr + "66" : T.border), background: T.card, borderLeft: "3px solid " + evClr, marginBottom: 8 }}>
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: evClr }}>{race.label || race.event}</div>
          {race.team ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: teamClr, padding: "1px 8px", borderRadius: 3, background: teamClr + "18", textTransform: "uppercase", letterSpacing: 1 }}>{race.team}</span>
          ) : null}
          <span style={{ fontSize: 10, color: T.muted }}>{runners.length} runners</span>
          {race.shared ? (
            <span title="Shared race — only your assigned runners are shown" style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 3, background: "#f0a50022", color: "#f0a500", border: "1px solid #f0a50066", letterSpacing: 0.5 }}>SHARED</span>
          ) : race.assignedCoaches && race.assignedCoaches.length === 1 ? (
            <span title="Solo race — only you" style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 3, background: "#27ae6022", color: "#5ddb6a", border: "1px solid #27ae6066", letterSpacing: 0.5 }}>YOURS</span>
          ) : null}
          {isReady ? (
            <select value={effectiveSplit} onChange={(e) => onUpdateRace(race.id, { splitLabel: e.target.value })} style={{ background: T.timerBg, border: "1px solid " + T.border, color: T.text, padding: "2px 6px", borderRadius: 3, fontFamily: "inherit", fontSize: 10 }} title="Split distance">
              {["200m", "400m", "800m", "1200m", "1600m", "Half Mile", "1 Mile", "3K", "5K"].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 9, color: T.muted, fontFamily: "'Share Tech Mono',monospace", padding: "1px 5px", border: "1px solid " + T.border, borderRadius: 3 }}>{effectiveSplit}</span>
          )}
          {splitsToFinish > 0 ? (
            <span style={{ fontSize: 9, color: T.muted, fontFamily: "'Share Tech Mono',monospace" }}>{splitsToFinish} splits=done</span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {finCount > 0 && !isDone ? (
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "#27ae6022", color: "#5ddb6a", fontWeight: 700 }}>{finCount}/{runners.length}</span>
          ) : null}
          {isDone && !race.saved ? (
            <button onClick={() => onSaveRace && onSaveRace(race)} style={{ padding: "3px 8px", background: "#3498DB22", color: "#3498DB", border: "1px solid #3498DB44", borderRadius: 3, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}>Save</button>
          ) : null}
          {race.saved ? (
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "#27ae6022", color: "#5ddb6a", fontWeight: 700 }}>Saved</span>
          ) : isDone ? (
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "#27ae6022", color: "#5ddb6a", fontWeight: 700 }}>Done</span>
          ) : null}
          {(race.history || []).length > 0 && !isDone ? (
            <button
              onClick={undoLast}
              title={"Undo: " + (race.history[race.history.length - 1].label || "last change")}
              style={{ padding: "3px 8px", background: "#f0a50022", color: "#f0a500", border: "1px solid #f0a50044", borderRadius: 3, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}
            >
              {"\u21B6 Undo"}
            </button>
          ) : null}
          {!isDone && hasSplits && runners.length > finCount ? (
            <button
              onClick={() => setConfirmModal({
                title: "DNF remaining?",
                message: "Mark all " + (runners.length - finCount) + " unfinished runner(s) as DNF and end the race?",
                confirmLabel: "DNF Rest",
                destructive: true,
                onConfirm: bulkDnfRemaining,
              })}
              style={{ padding: "3px 8px", background: "#ef444422", color: "#ef4444", border: "1px solid #ef444466", borderRadius: 3, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}
            >
              {"\u2717 DNF Rest"}
            </button>
          ) : null}
          {hasSplits && !isDone ? (
            <button onClick={finishRace} style={{ padding: "3px 8px", background: "#27ae6022", color: "#5ddb6a", border: "1px solid #27ae6044", borderRadius: 3, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}>Finish</button>
          ) : null}
        </div>
      </div>
      {isReady ? (
        <div style={{ padding: "0 12px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: T.muted, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>Goal:</span>
          <input
            value={race.goalTime || ""}
            onChange={(e) => onUpdateRace(race.id, { goalTime: e.target.value })}
            placeholder="mm:ss (optional race goal)"
            style={{ flex: 1, background: T.timerBg, border: "1px solid " + T.border, color: T.text, padding: "3px 8px", borderRadius: 3, fontSize: 11, fontFamily: "'Share Tech Mono',monospace", outline: "none" }}
          />
        </div>
      ) : null}
      {isRunning && wakeLockFailed ? (
        <div style={{ padding: "3px 12px", background: "#f0a50022", borderBottom: "1px solid #f0a50044", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#f0a500" }}>Screen lock not prevented — keep your phone awake during the race</span>
        </div>
      ) : null}
      <div style={{ padding: "6px 12px", background: T.timerBg, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 42, zIndex: 5, borderTop: "1px solid " + T.border, borderBottom: "1px solid " + T.border }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: isRunning ? 52 : 36, color: isRunning ? T.text : elapsed > 0 ? evClr : T.muted, letterSpacing: 2, lineHeight: 1 }}>{fmtTime(elapsed)}</div>
          {ghostMs !== null ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontFamily: "'Share Tech Mono',monospace" }}>
              <span style={{ fontSize: 10, color: T.muted, letterSpacing: 1, textTransform: "uppercase" }}>target</span>
              <span style={{ fontSize: 14, color: T.muted, fontWeight: 700 }}>{fmtTime(ghostMs)}</span>
              {elapsed > 0 ? (
                <span style={{ fontSize: 12, fontWeight: 800, color: ghostAhead ? "#5ddb6a" : "#f0a500" }}>
                  {ghostAhead ? "-" : "+"}{fmtSplit(Math.abs(ghostDiff))}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {!isDone && !isRunning ? (
            <button onClick={startTimer} style={{ padding: "6px 16px", background: evClr, color: T.bg, border: "none", borderRadius: 3, cursor: "pointer", fontSize: 13, fontWeight: 900, fontFamily: "inherit", letterSpacing: 2 }}>{elapsed > 0 ? "GO" : "START"}</button>
          ) : !isDone ? (
            <button onClick={pauseTimer} style={{ padding: "6px 16px", background: "transparent", color: evClr, border: "1.5px solid " + evClr, borderRadius: 3, cursor: "pointer", fontSize: 13, fontWeight: 900, fontFamily: "inherit", letterSpacing: 2 }}>STOP</button>
          ) : null}
          <button onClick={() => setConfirmModal({ title: "Reset this race?", message: "All splits and the timer will be cleared. This cannot be undone.", confirmLabel: "Reset", destructive: true, onConfirm: () => resetRace() })} style={{ padding: "6px 10px", background: "transparent", color: T.muted, border: "1px solid " + T.border, borderRadius: 3, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "inherit" }}>Reset</button>
        </div>
      </div>
      <div style={{ padding: "6px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {runners.map((ath, athIdx) => {
            const sp = (race.splits || {})[ath.id] || [];
            const last = sp[sp.length - 1];
            const flash = flashMap[ath.id];
            const hasSp = sp.length > 0;
            const isFin = !!finishedMap[ath.id];
            const isDnf = !!(race.dnf || {})[ath.id];
            const isActiveLeg = isRelay && athIdx === activeLeg;
            const canClick = isDnf
              ? false
              : isRelay
                ? isActiveLeg && (isRunning || elapsed > 0) && !isDone
                : (isRunning || elapsed > 0) && !isDone && !isFin;
            const hasPlaceholder = sp.some((s) => s && s.missed);
            const perRunner = isRelay ? splitsPerLeg : splitsToFinish;
            const isIncomplete = !isDnf && (hasPlaceholder || (isFin && perRunner > 0 && sp.length < perRunner));
            const lastIsPlaceholder = last && last.missed;
            const showActions = !isReady && (isRunning || elapsed > 0 || isDone);
            const p = paces[ath.name] || {};
            const hidePaces = isRunning || elapsed > 0;
            /* Live lap: current elapsed minus start-of-lap; only while the runner
               is still active (not finished/DNF) and the clock has started. */
            const liveLapBase = getLegStart(ath, sp);
            const liveLap = canClick && elapsed > liveLapBase ? elapsed - liveLapBase : null;
            const showRing = pressProgress.rid === ath.id && pressProgress.pct > 0 && pressProgress.pct < 1;

            /* Target + projection for non-relay runners. Projection assumes
               constant pace from splits so far. If we have splits and a target,
               color-code by relative error. */
            const targetMs = parseTimeStr((race.targets || {})[ath.id]);
            let projectedMs = null;
            if (!isRelay && sp.length > 0 && splitsToFinish > 0 && !isFin) {
              const lastTotal = sp[sp.length - 1].total;
              projectedMs = (lastTotal * splitsToFinish) / sp.length;
            }
            const finalMs = isFin && !isDnf && last ? last.total : null;
            const compareMs = finalMs || projectedMs;
            let projColor = T.muted;
            let projDiff = null;
            if (targetMs && compareMs) {
              projDiff = compareMs - targetMs;
              const pct = Math.abs(projDiff) / targetMs;
              if (pct <= 0.01) projColor = "#5ddb6a";
              else if (pct <= 0.03) projColor = "#f0a500";
              else projColor = "#ef4444";
            }

            return (
              <div
                key={ath.id}
                style={{ position: "relative", width: "100%" }}
                draggable={isReady}
                onDragStart={(e) => { if (!isReady) return; setDragIdx(athIdx); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (!isReady || dragIdx === null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => { if (!isReady || dragIdx === null) return; e.preventDefault(); moveRunner(dragIdx, athIdx); setDragIdx(null); }}
                onDragEnd={() => setDragIdx(null)}
              >
                {isReady ? (
                  <span onClick={(e) => { e.stopPropagation(); removeRunner(ath.id); }} style={{ position: "absolute", top: 2, right: 2, zIndex: 2, width: 18, height: 18, borderRadius: "50%", background: "#ef444433", color: "#ef4444", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{"\u00D7"}</span>
                ) : null}
                <button
                  onClick={() => { if (longPressRef.current.fired) { longPressRef.current.fired = false; return; } if (canClick) recordSplit(ath.id); }}
                  onMouseDown={() => { if (showActions) pressStart(ath.id); }}
                  onMouseUp={pressEnd}
                  onMouseLeave={pressEnd}
                  onTouchStart={() => { if (showActions) pressStart(ath.id); }}
                  onTouchEnd={pressEnd}
                  onTouchCancel={pressEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    width: "100%",
                    padding: "12px 12px",
                    minHeight: 64,
                    background: flash ? "#0c1f0e" : dragIdx === athIdx ? "rgba(255,255,255,0.05)" : isDnf ? "rgba(239,68,68,0.06)" : T.card,
                    border: "1px solid " + (flash ? "#2d7a35" : isDnf ? "#ef444444" : isFin ? "#27ae6044" : hasSp ? "#1a2e1a" : T.border),
                    borderTop: "3px solid " + (isDnf ? "#ef4444" : isFin ? "#27ae60" : flash ? "#5ddb6a" : hasSp ? "#1e4a1e" : teamClr + "44"),
                    borderRadius: 4,
                    cursor: isReady ? "grab" : canClick ? "pointer" : "default",
                    textAlign: "left",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                    fontFamily: "inherit",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    opacity: dragIdx === athIdx ? 0.4 : isDnf ? 0.7 : isFin && !flash ? 0.6 : isRelay && !isActiveLeg && !isFin ? 0.4 : 1,
                  }}
                >
                  {isReady ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
                      <span style={{ fontSize: 10, color: T.muted, letterSpacing: 1, cursor: "grab" }}>{"\u2630"}</span>
                      {isRelay ? (
                        <span style={{ fontSize: 9, fontWeight: 700, color: evClr, padding: "0 4px", borderRadius: 2, background: evClr + "18" }}>Leg {athIdx + 1}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: flash ? "#5ddb6a" : isDnf ? "#ef4444" : isFin ? "#27ae60" : T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0, lineHeight: 1.1, textDecoration: isDnf ? "line-through" : "none" }}>{ath.name}</span>
                    <span style={{ fontSize: 20, fontWeight: 900, lineHeight: 1, color: hasSp ? (flash ? "#5ddb6a" : isDnf ? "#ef4444" : isFin ? "#27ae60" : T.accent) : T.dim, flexShrink: 0 }}>{sp.length}</span>
                  </div>
                  <div style={{ minHeight: 24, display: "flex", alignItems: "center", gap: 6 }}>
                    {last ? (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                        <span style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 22, fontWeight: 800, color: flash ? "#5ddb6a" : isDnf ? "#ef4444" : lastIsPlaceholder ? "#f0a500" : isFin ? "#27ae60" : T.splitClr }}>{lastIsPlaceholder ? "?" : fmtSplit(last.split)}</span>
                        <span style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 14, fontWeight: 700, color: T.timeClr }}>{lastIsPlaceholder ? "missed" : fmtTime(last.total)}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: 10, color: isDnf ? "#ef4444" : isFin ? "#27ae60" : isActiveLeg ? T.accent : T.dim }}>
                        {isDnf ? "\u2717 DNF" : isFin ? "\u2713 FINISHED" : isActiveLeg ? "\u25B6 ACTIVE LEG" : isRelay && !isFin ? "waiting" : canClick ? "tap to split" : ""}
                      </span>
                    )}
                    {liveLap !== null ? (
                      <span title="Current lap in progress" style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 12, fontWeight: 700, color: T.muted, opacity: 0.85 }}>{"+" + fmtSplit(liveLap)}</span>
                    ) : null}
                    {isIncomplete ? (
                      <span title="Incomplete: has missed/placeholder splits — fix in Race Results" style={{ fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 3, background: "#f0a50022", color: "#f0a500", border: "1px solid #f0a50066", letterSpacing: 0.5, marginLeft: "auto" }}>{"\u26A0 INC"}</span>
                    ) : null}
                  </div>
                  {!hidePaces && (p.thrSafe || p.cv || p.vo2Safe) ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 1 }}>
                      {p.thrSafe ? <PacePill label="T" value={p.thrSafe} color="#f0a500" /> : null}
                      {p.cv ? <PacePill label="CV" value={p.cv} color="#4a9eff" /> : null}
                      {p.vo2Safe ? <PacePill label="V2" value={p.vo2Safe} color="#e84393" /> : null}
                    </div>
                  ) : null}
                  {!isReady && (targetMs || projectedMs) ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 2, fontSize: 10, fontFamily: "'Share Tech Mono',monospace", opacity: 0.85 }}>
                      {targetMs ? (
                        <span style={{ color: T.muted }}>
                          <span style={{ letterSpacing: 1 }}>tgt </span>
                          {fmtTime(targetMs)}
                        </span>
                      ) : null}
                      {projectedMs || finalMs ? (
                        <span style={{ color: projColor, fontWeight: 700 }}>
                          {finalMs ? "" : "\u2192 "}
                          {fmtTime(compareMs)}
                          {projDiff !== null ? (
                            " (" + (projDiff > 0 ? "+" : "") + fmtSplit(Math.abs(projDiff)) + ")"
                          ) : ""}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
                {isReady ? (
                  <input
                    value={(race.targets || {})[ath.id] || ""}
                    onChange={(e) => {
                      const targets = { ...(race.targets || {}) };
                      if (e.target.value) targets[ath.id] = e.target.value;
                      else delete targets[ath.id];
                      onUpdateRace(race.id, { targets });
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    placeholder="target time"
                    style={{ width: "100%", boxSizing: "border-box", marginTop: 3, background: T.timerBg, border: "1px solid " + T.dim, color: T.text, padding: "3px 6px", borderRadius: 3, fontSize: 10, fontFamily: "'Share Tech Mono',monospace", outline: "none" }}
                  />
                ) : null}
                {showRing ? (
                  <svg
                    width={ringSize}
                    height={ringSize}
                    style={{ position: "absolute", top: 4, right: 4, pointerEvents: "none", zIndex: 3, transform: "rotate(-90deg)" }}
                  >
                    <circle cx={ringSize / 2} cy={ringSize / 2} r={ringR} fill="none" stroke={T.border} strokeWidth={2} />
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringR}
                      fill="none"
                      stroke={T.accent}
                      strokeWidth={2}
                      strokeDasharray={ringC}
                      strokeDashoffset={ringC * (1 - pressProgress.pct)}
                      strokeLinecap="round"
                    />
                  </svg>
                ) : null}
                {actionFor === ath.id ? (
                  <div style={{ position: "absolute", inset: 0, zIndex: 20, background: T.bg, border: "2px solid " + T.accent, borderRadius: 4, display: "flex", flexDirection: "column", padding: 6, gap: 5 }}>
                    <div style={{ fontSize: 10, color: T.muted, textAlign: "center", letterSpacing: 1, textTransform: "uppercase" }}>{ath.name}</div>
                    {manualEntry.rid === ath.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <input value={manualEntry.value} onChange={(e) => setManualEntry({ rid: ath.id, value: e.target.value })} placeholder="e.g. 1:23.45 or 83.45" autoFocus style={{ padding: "8px", background: T.timerBg, border: "1px solid " + T.accent, color: T.text, borderRadius: 3, fontSize: 13, fontFamily: "'Share Tech Mono',monospace", outline: "none", textAlign: "center" }} />
                        <div style={{ fontSize: 9, color: T.muted, textAlign: "center" }}>Cumulative time from race start</div>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button onClick={() => { submitManualEntry(ath.id, manualEntry.value); setManualEntry({ rid: null, value: "" }); setActionFor(null); }} style={{ flex: 1, padding: "8px", background: T.accent + "22", border: "1px solid " + T.accent + "66", color: T.accent, borderRadius: 3, fontSize: 12, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>Save</button>
                          <button onClick={() => setManualEntry({ rid: null, value: "" })} style={{ flex: 1, padding: "8px", background: "transparent", border: "1px solid " + T.border, color: T.muted, borderRadius: 3, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>Back</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {hasSp ? (
                          <button onClick={() => { undoSplit(ath.id); setActionFor(null); }} style={{ padding: "10px", background: "#f0a50022", border: "1px solid #f0a50066", color: "#f0a500", borderRadius: 3, fontSize: 13, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>{"\u21B6 Undo Last Split"}</button>
                        ) : null}
                        {!isFin && !isDnf ? (
                          <button onClick={() => { markMissedSplit(ath.id); setActionFor(null); }} title="Inserts a placeholder for a split you missed. Fix the time later in Race Results." style={{ padding: "10px", background: "#f0a50022", border: "1px dashed #f0a50066", color: "#f0a500", borderRadius: 3, fontSize: 13, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>{"? Mark Missed Split"}</button>
                        ) : null}
                        {!isFin && !isDnf ? (
                          <button onClick={() => { markRunnerDone(ath.id); setActionFor(null); }} title="Closes this runner out at the current clock time. Use when they finished but you missed earlier splits." style={{ padding: "10px", background: "#27ae6022", border: "1px solid #27ae6066", color: "#5ddb6a", borderRadius: 3, fontSize: 13, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>{"\u2713 Mark as Done"}</button>
                        ) : null}
                        <button onClick={() => setManualEntry({ rid: ath.id, value: "" })} style={{ padding: "10px", background: T.accent + "22", border: "1px solid " + T.accent + "66", color: T.accent, borderRadius: 3, fontSize: 13, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>{"\u270E Enter Time Manually"}</button>
                        <button onClick={() => { toggleDnf(ath.id); setActionFor(null); }} style={{ padding: "10px", background: isDnf ? "#27ae6022" : "#ef444422", border: "1px solid " + (isDnf ? "#27ae6066" : "#ef444466"), color: isDnf ? "#27ae60" : "#ef4444", borderRadius: 3, fontSize: 13, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>{isDnf ? "\u2713 Un-mark DNF" : "\u2717 Mark DNF"}</button>
                        <button onClick={() => setActionFor(null)} style={{ padding: "8px", background: "transparent", border: "1px solid " + T.border, color: T.muted, borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {isReady ? (
          <div style={{ marginTop: 4, display: "flex", gap: 4, alignItems: "center" }}>
            {!showAdd ? (
              <button onClick={() => setShowAdd(true)} style={{ padding: "4px 10px", background: "transparent", color: T.accent, border: "1px dashed " + T.accent + "66", borderRadius: 3, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}>+ Add Runner</button>
            ) : (
              <div style={{ flex: 1, display: "flex", gap: 4 }}>
                <select value="" onChange={(e) => { if (e.target.value) { addRunner(e.target.value); setShowAdd(false); } }} style={{ flex: 1, background: T.card, border: "1px solid " + T.accent + "66", color: T.text, padding: "5px 8px", borderRadius: 3, fontFamily: "inherit", fontSize: 11 }}>
                  <option value="">Select runner...</option>
                  {allAthletes.filter((a) => !(race.runnerIds || []).includes(String(a.id))).map((a) => (
                    <option key={a.id} value={String(a.id)}>{a.name} ({a.team})</option>
                  ))}
                </select>
                <button onClick={() => setShowAdd(false)} style={{ padding: "4px 8px", background: "transparent", color: T.muted, border: "1px solid " + T.border, borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>{"\u00D7"}</button>
              </div>
            )}
          </div>
        ) : null}
        {hasSplits ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: T.muted, textTransform: "uppercase", marginBottom: 4 }}>{isRelay ? "Relay Legs" : "Split Log"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {runners.filter((a) => ((race.splits || {})[a.id] || []).length > 0).map((ath) => {
                const sp = (race.splits || {})[ath.id];
                return (
                  <div key={ath.id} style={{ background: T.timerBg, border: "1px solid " + T.border, borderTop: "2px solid " + teamClr + "33", borderRadius: 4, padding: "6px 8px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: evClr, marginBottom: 3 }}>{ath.name}</div>
                    {sp.map((s, i) => {
                      const miss = s && s.missed;
                      return (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0", borderTop: i > 0 ? "1px solid " + T.dim : "none" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: T.timeClr }}>{"#" + (i + 1)}</span>
                          <span style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 16, fontWeight: 800, color: miss ? "#f0a500" : i === sp.length - 1 ? T.splitClr : T.oldSplit }}>{miss ? "?" : fmtSplit(s.split)}</span>
                          <span style={{ fontFamily: "'Share Tech Mono',monospace", fontSize: 13, fontWeight: 700, color: miss ? "#f0a500" : T.timeClr }}>{miss ? "missed" : fmtTime(s.total)}</span>
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
      {confirmModal ? (
        <div onClick={() => setConfirmModal(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.card, border: "2px solid " + (confirmModal.destructive ? "#ef4444" : T.accent), borderRadius: 8, padding: 20, maxWidth: 360, width: "100%", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: confirmModal.destructive ? "#ef4444" : T.text, marginBottom: 8 }}>{confirmModal.title || "Confirm"}</div>
            {confirmModal.message ? (
              <div style={{ fontSize: 13, color: T.muted, marginBottom: 18, lineHeight: 1.5 }}>{confirmModal.message}</div>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmModal(null)} style={{ flex: 1, padding: "14px", background: "transparent", border: "1px solid " + T.border, color: T.text, borderRadius: 6, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => { const fn = confirmModal.onConfirm; setConfirmModal(null); if (fn) fn(); }} style={{ flex: 1, padding: "14px", background: confirmModal.destructive ? "#ef4444" : T.accent, border: "none", color: "#fff", borderRadius: 6, fontSize: 14, fontWeight: 900, fontFamily: "inherit", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" }}>{confirmModal.confirmLabel || "Confirm"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default memo(RaceCard);
