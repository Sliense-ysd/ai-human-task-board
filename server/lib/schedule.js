import { getTimezone, getDatePartsInTz } from './timezone.js';

/**
 * Compute the next run time for a schedule type.
 * Supports: 'daily', 'weekly', 'monthly', or a cron expression (basic 5-field).
 * All times are interpreted in the user's configured timezone.
 */

export function computeNextRun(schedule) {
  const now = new Date();
  const tz = getTimezone();

  if (schedule === 'daily') {
    const p = getDatePartsInTz(now, tz);
    // Tomorrow at midnight in user's timezone
    const local = new Date(p.year, p.month, p.day + 1, 0, 0, 0, 0);
    return tzLocalToUTC(local, tz).toISOString();
  }

  if (schedule === 'weekly') {
    const p = getDatePartsInTz(now, tz);
    const local = new Date(p.year, p.month, p.day + 7, 0, 0, 0, 0);
    return tzLocalToUTC(local, tz).toISOString();
  }

  if (schedule === 'monthly') {
    const p = getDatePartsInTz(now, tz);
    const local = new Date(p.year, p.month + 1, 1, 0, 0, 0, 0);
    return tzLocalToUTC(local, tz).toISOString();
  }

  // Cron expression (basic: min hour dom month dow)
  if (schedule && schedule.includes(' ')) {
    return computeNextCron(schedule, now, tz);
  }

  return null;
}

/**
 * Convert a "wall clock" Date (built with local Date constructor) to UTC,
 * as if those year/month/day/hour/min values were in the given timezone.
 */
function tzLocalToUTC(localDate, tz) {
  // Build an ISO-ish string and use Intl to find the offset
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  // We need to find the UTC time that corresponds to the given wall-clock time in tz.
  // Strategy: guess with an offset derived from "now", then refine.
  const guessUTC = localDate.getTime();
  const parts = {};
  fmt.formatToParts(new Date(guessUTC)).forEach(p => { parts[p.type] = p.value; });
  const guessLocal = new Date(
    parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day),
    parts.hour === '24' ? 0 : parseInt(parts.hour), parseInt(parts.minute), parseInt(parts.second)
  );
  const offset = guessUTC - guessLocal.getTime();
  return new Date(localDate.getTime() + offset);
}

/**
 * Basic cron next-run computation.
 * Supports: numbers, *, and step values (e.g., *\/5).
 * Cron fields are matched against the user's timezone wall-clock time.
 * Returns ISO string (UTC) of next matching time within 366 days, or null.
 */
function computeNextCron(expr, from, tz) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

  function parseField(field, min, max) {
    if (field === '*') return null; // any
    if (field.includes('/')) {
      const [, step] = field.split('/');
      const s = parseInt(step);
      const vals = [];
      for (let i = min; i <= max; i++) {
        if ((i - min) % s === 0) vals.push(i);
      }
      return vals;
    }
    if (field.includes(',')) {
      return field.split(',').map(Number);
    }
    if (field.includes('-')) {
      const [a, b] = field.split('-').map(Number);
      const vals = [];
      for (let i = a; i <= b; i++) vals.push(i);
      return vals;
    }
    return [parseInt(field)];
  }

  const mins = parseField(minExpr, 0, 59);
  const hours = parseField(hourExpr, 0, 23);
  const doms = parseField(domExpr, 1, 31);
  const mons = parseField(monExpr, 1, 12);
  const dows = parseField(dowExpr, 0, 6);

  // Match against wall-clock time in user's timezone
  function matches(d) {
    const p = getDatePartsInTz(d, tz);
    if (mins && !mins.includes(p.minute)) return false;
    if (hours && !hours.includes(p.hour)) return false;
    if (doms && !doms.includes(p.day)) return false;
    if (mons && !mons.includes(p.month + 1)) return false;
    const dow = new Date(p.year, p.month, p.day).getDay();
    if (dows && !dows.includes(dow)) return false;
    return true;
  }

  // Start from next minute
  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  const limit = 366 * 24 * 60; // max iterations
  for (let i = 0; i < limit; i++) {
    if (matches(candidate)) return candidate.toISOString();
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return null;
}

/**
 * Compute future run dates for a schedule, up to `days` days out.
 * Returns array of ISO strings. Skips runs more frequent than daily (only one per day).
 */
export function computeFutureRuns(schedule, days = 90) {
  if (!schedule) return [];
  const runs = [];
  const tz = getTimezone();
  const end = new Date(Date.now() + days * 86400000);
  let from = new Date();

  for (let i = 0; i < 200; i++) {
    let next;
    if (schedule === 'daily' || schedule === 'weekly' || schedule === 'monthly') {
      // For presets, simulate stepping forward from `from`
      const p = getDatePartsInTz(from, tz);
      let local;
      if (schedule === 'daily') local = new Date(p.year, p.month, p.day + 1, 0, 0, 0);
      else if (schedule === 'weekly') local = new Date(p.year, p.month, p.day + 7, 0, 0, 0);
      else local = new Date(p.year, p.month + 1, 1, 0, 0, 0);
      next = tzLocalToUTC(local, tz).toISOString();
    } else if (schedule.includes(' ')) {
      next = computeNextCron(schedule, from, tz);
    }
    if (!next) break;
    const d = new Date(next);
    if (d >= end) break;
    runs.push(next);
    // Advance past this run to find the next one
    from = new Date(d.getTime() + 60000);
  }
  return runs;
}

/**
 * Human-readable description of a schedule.
 */
export function describeSchedule(schedule) {
  if (!schedule) return '';
  if (schedule === 'daily') return 'Runs daily';
  if (schedule === 'weekly') return 'Runs weekly';
  if (schedule === 'monthly') return 'Runs monthly';
  if (schedule === 'asap') return 'Run ASAP';
  if (schedule === 'next-heartbeat') return 'Next heartbeat';
  return `Cron: ${schedule}`;
}
