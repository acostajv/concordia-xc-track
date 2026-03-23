# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Concordia Academy Beacons - Distance Training: a React web app for cross-country running team management. Coaches build schedules, manage rosters, and track meets; athletes log workouts and readiness check-ins via PIN-based login.

## Commands

- `npm run dev` — Start Vite dev server with HMR
- `npm run build` — Production build to `dist/`
- `npm run lint` — ESLint (flat config, ESLint 9.x)
- `npm run preview` — Serve production build locally

## Architecture

**Stack:** React 19 + Vite 7 (JavaScript/JSX, no TypeScript). Firebase Firestore backend. No CSS files — all styling is inline JS objects.

**Source structure:** Nearly all application code lives in `src/App.jsx` (~2,700 lines), a single monolithic functional component. `src/firebase.js` handles Firebase config and data access. `src/main.jsx` is the React root entry point. No test framework is configured.

### App.jsx layout (line landmarks)

1. **Constants & utilities (~lines 1–120):** Color palette `C`, style objects (`LS`, `IS`, `TS`, `hB`), workout categories `CATS`, Davis pace model `PACE_MODEL`, date/formatting helpers (`wkd`, `fd`, `fs`, `ini`), localStorage helpers (`ldLocal`/`svLocal`), Firebase wrappers (`ld1`/`sv1`, `loadAthleteData`/`saveAthleteData`).

2. **Nested sub-components (~lines 122–283):** `Editor` (workout entry/edit modal, ~line 122), `Card` (daily workout card, ~line 241), `Summary` (weekly stats, ~line 277).

3. **Main `App` component (~line 284–end):** 50+ `useState` hooks, 100+ handler functions, renders 8 tab views:
   - Schedule — weekly/monthly practice view, add/edit workouts, log entries, readiness check-ins
   - Roster — athlete profiles (paces, PBs, goals, injuries, photos)
   - Pace Calc — Davis training model calculators (threshold/VO2/aerobic from race time, hill/altitude/gradient adjustments)
   - Training Guide — editable markdown guide sections
   - Routines — drills/routines library
   - Meet Schedule — meet dates, lineups, results
   - Rewards — leaderboards (records, consistency, speed)
   - Records — school records by event and gender

### Data model

- **Coach data** (`appData` Firestore collection): schedule, roster, meets, announcements, school records, presets, routines, guide. Requires `VITE_COACH_TOKEN` for writes.
- **Athlete data** (`athleteData` Firestore collection): workout logs, readiness check-ins. Public read/write, keyed by athlete ID + timestamp.
- **LocalStorage:** theme preference, logged-in athlete ID, coach auth state.

### firebase.js exports

`loadData(key)` / `saveData(key, value)` — coach data (save requires `COACH_TOKEN`). `loadAthleteData(key)` / `saveAthleteData(key, value)` — athlete data (no token required). `IS_COACH_BUILD` — boolean flag. All Firestore docs use a simple `{ value, coachToken? }` shape.

### Dual-mode access

Set `VITE_COACH_TOKEN` env var (in `.env` or `.env.local`) to enable coach mode (full read/write). Without it, the app runs in athlete mode (read-only coach data, can submit logs/check-ins). The token is checked at build time via `import.meta.env.VITE_COACH_TOKEN`.

## Conventions

- All styling uses inline JS objects — no CSS files. Color constants are in the `C` object at the top of App.jsx.
- Dark theme is default; light theme toggle exists. Print styles use `.no-print` / `.print-only` classes.
- ESLint `no-unused-vars` ignores uppercase and underscore-prefixed variables.
- Short variable names are intentional throughout (e.g., `sch` = schedule, `cm` = coach mode, `wlog` = workout log).
