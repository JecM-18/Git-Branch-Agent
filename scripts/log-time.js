#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function validateEnv() {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}\nCopy .env.example to .env and fill in the values.`);
  }
}

/**
 * Parse a time string into seconds.
 * Supported formats: 7.5h | 7h | 7h30m | 30m | 1d (1d = 8h)
 */
function parseTime(raw) {
  const str = raw.trim().toLowerCase();

  // e.g. 1d
  const dMatch = str.match(/^(\d+(?:\.\d+)?)d$/);
  if (dMatch) return Math.round(parseFloat(dMatch[1]) * 8 * 3600);

  // e.g. 7h30m  or  7.5h  or  7h
  const hmMatch = str.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?$/);
  if (hmMatch && (hmMatch[1] || hmMatch[2])) {
    const hours   = parseFloat(hmMatch[1] || '0');
    const minutes = parseFloat(hmMatch[2] || '0');
    const seconds = Math.round(hours * 3600 + minutes * 60);
    if (seconds > 0) return seconds;
  }

  return null;
}

const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

/**
 * Parse a natural-language date phrase into a Date (start of working day 09:00 local).
 * Supported: today | yesterday | last <weekday>
 */
function parseDate(phrase) {
  const str = phrase.trim().toLowerCase();
  const now = new Date();

  function atNine(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0, 0);
  }

  if (str === 'today') return atNine(now);

  if (str === 'yesterday') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return atNine(d);
  }

  // "last <weekday>"
  const lastMatch = str.match(/^last\s+(\w+)$/);
  if (lastMatch) {
    const targetDay = WEEKDAYS.indexOf(lastMatch[1]);
    if (targetDay === -1) return null;
    const d = new Date(now);
    d.setDate(d.getDate() - 1); // start from yesterday
    while (d.getDay() !== targetDay) d.setDate(d.getDate() - 1);
    return atNine(d);
  }

  return null;
}

/**
 * Format a Date as the Jira worklog "started" value: "YYYY-MM-DDTHH:mm:ss.sss+HHMM"
 * Uses local timezone offset.
 */
function formatJiraDate(date) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const Y  = date.getFullYear();
  const M  = pad(date.getMonth() + 1);
  const D  = pad(date.getDate());
  const h  = pad(date.getHours());
  const m  = pad(date.getMinutes());
  const s  = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);

  // timezone offset in ±HHMM
  const offset  = -date.getTimezoneOffset(); // minutes
  const sign    = offset >= 0 ? '+' : '-';
  const absOff  = Math.abs(offset);
  const offH    = pad(Math.floor(absOff / 60));
  const offM    = pad(absOff % 60);

  return `${Y}-${M}-${D}T${h}:${m}:${s}.${ms}${sign}${offH}${offM}`;
}

/** Human-readable duration from seconds, e.g. "7h 30m" */
function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ') || '0m';
}

// ─── Jira Worklog ─────────────────────────────────────────────────────────────
async function logWork(ticket, timeSpentSeconds, started) {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${ticket}/worklog`;
  try {
    const { data } = await axios.post(
      url,
      { timeSpentSeconds, started },
      {
        headers: {
          Authorization: `Basic ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    return data;
  } catch (err) {
    const status = err.response && err.response.status;
    const detail = err.response && err.response.data && JSON.stringify(err.response.data);
    if (status === 401) throw new Error('Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN.');
    if (status === 404) throw new Error(`Jira ticket "${ticket}" not found.`);
    throw new Error(`Jira API error (${status || 'network'}): ${detail || err.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  validateEnv();

  // Usage: node log-time.js <TICKET> <TIME> [DATE[, DATE...]]
  // e.g.:  node log-time.js AINEX-57 7.5h today
  //        node log-time.js AINEX-57 7h30m last tuesday
  //        node log-time.js AINEX-57 7.5h "last friday, last monday, yesterday and today"
  const [,, ticketArg, timeArg, ...dateParts] = process.argv;

  if (!ticketArg || !timeArg) {
    console.error('Usage: node scripts/log-time.js <TICKET> <TIME> [DATE[, DATE...]]');
    console.error('  TIME  : 7.5h | 7h30m | 30m | 1d');
    console.error('  DATE  : today (default) | yesterday | last <weekday>');
    console.error('  Multi : "last friday, last monday, yesterday and today"');
    process.exit(1);
  }

  // Validate ticket format
  if (!/^[A-Za-z]+-\d+$/.test(ticketArg)) {
    console.error(`Invalid ticket format: "${ticketArg}". Expected PROJECT-NUMBER, e.g. AINEX-57.`);
    process.exit(1);
  }
  const ticket = ticketArg.toUpperCase();

  // Parse time
  const timeSpentSeconds = parseTime(timeArg);
  if (!timeSpentSeconds) {
    console.error(`Could not parse time: "${timeArg}". Use formats like 7.5h, 7h30m, 30m, 1d.`);
    process.exit(1);
  }

  // Parse date(s) — split on commas and " and " to support multiple dates
  // e.g. "last friday, last monday, yesterday and today"
  const rawDateString = dateParts.length ? dateParts.join(' ') : 'today';
  const datePhrases   = rawDateString
    .split(/,\s*|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  // Validate all date phrases up-front before making any API calls
  const resolvedDates = [];
  for (const phrase of datePhrases) {
    const d = parseDate(phrase);
    if (!d) {
      console.error(`Could not parse date: "${phrase}". Use: today, yesterday, last <weekday>.`);
      process.exit(1);
    }
    resolvedDates.push({ phrase, date: d });
  }

  const duration = formatDuration(timeSpentSeconds);
  console.log(`Logging ${duration} on ${ticket} for ${resolvedDates.length} date(s)...\n`);

  let successCount = 0;
  for (const { phrase, date } of resolvedDates) {
    const started = formatJiraDate(date);
    try {
      await logWork(ticket, timeSpentSeconds, started);
      console.log(`  [OK] ${date.toDateString()} (${phrase})`);
      successCount++;
    } catch (err) {
      console.error(`  [FAIL] ${date.toDateString()} (${phrase}): ${err.message}`);
    }
  }

  console.log('');
  if (successCount === resolvedDates.length) {
    console.log('All entries logged successfully!');
  } else {
    console.log(`${successCount}/${resolvedDates.length} entries logged.`);
  }
  console.log(`  Ticket  : ${ticket}`);
  console.log(`  Duration: ${duration} per day`);
  console.log(`  View    : ${process.env.JIRA_BASE_URL}/browse/${ticket}`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
