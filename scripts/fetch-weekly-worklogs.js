#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

function validateEnv() {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}\nCopy .env.example to .env and fill in the values.`);
  }
}

function getJiraHeaders() {
  const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function getWeekDates() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  const dates = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return { monday, friday, dates };
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ') || '0m';
}

const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function run() {
  validateEnv();
  const { JIRA_BASE_URL } = process.env;
  const headers = getJiraHeaders();
  const { monday, friday, dates } = getWeekDates();

  const monStr = formatDate(monday);
  const friStr = formatDate(friday);

  console.log(`\n📅 Fetching worklogs for week: ${monStr} (Mon) → ${friStr} (Fri)\n`);

  // Get current user
  const { data: myself } = await axios.get(`${JIRA_BASE_URL}/rest/api/3/myself`, { headers });
  const accountId = myself.accountId;
  console.log(`👤 User: ${myself.displayName} (${myself.emailAddress})\n`);

  // Search for issues the user may have logged time on this week
  const searchUrl = `${JIRA_BASE_URL}/rest/api/3/search/jql`;

  // Cast a wide net: assigned issues or issues updated this week
  const jqlQueries = [
    `assignee = currentUser() AND updated >= "${monStr}" ORDER BY updated DESC`,
    `worklogAuthor = currentUser() AND worklogDate >= "${monStr}" AND worklogDate <= "${friStr}"`,
  ];

  const issueMap = {};

  for (const jql of jqlQueries) {
    try {
      const { data } = await axios.post(searchUrl, {
        jql,
        fields: ['key', 'summary'],
        maxResults: 100,
      }, { headers });
      for (const issue of data.issues) {
        issueMap[issue.key] = issue;
      }
    } catch (e) {
      // JQL may not be supported (e.g. worklogAuthor), skip silently
    }
  }

  const issues = Object.values(issueMap);

  if (issues.length === 0) {
    console.log('⚠️  No relevant issues found for this week.');
    return;
  }

  console.log(`📋 Checking worklogs across ${issues.length} issue(s)...\n`);

  // Fetch worklogs for each issue and filter by user + date range
  const dailyLogs = {}; // dateStr -> { total: seconds, entries: [] }
  for (const d of dates) {
    dailyLogs[formatDate(d)] = { total: 0, entries: [] };
  }

  for (const issue of issues) {
    const worklogUrl = `${JIRA_BASE_URL}/rest/api/3/issue/${issue.key}/worklog`;
    const { data: wlData } = await axios.get(worklogUrl, { headers });

    for (const wl of wlData.worklogs) {
      if (wl.author.accountId !== accountId) continue;
      const started = new Date(wl.started);
      const dateStr = formatDate(started);
      if (dailyLogs[dateStr]) {
        dailyLogs[dateStr].total += wl.timeSpentSeconds;
        dailyLogs[dateStr].entries.push({
          ticket: issue.key,
          summary: issue.fields.summary,
          time: wl.timeSpentSeconds,
        });
      }
    }
  }

  // Print report
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DAY          DATE          HOURS     STATUS');
  console.log('═══════════════════════════════════════════════════════════════');

  let totalWeek = 0;
  let daysLogged = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const d of dates) {
    const dateStr = formatDate(d);
    const dayName = DAYNAMES[d.getDay()].padEnd(10);
    const { total } = dailyLogs[dateStr];
    totalWeek += total;

    let status;
    if (d > today) {
      status = '⏳ Upcoming';
    } else if (total === 0) {
      status = '❌ NO LOG';
    } else {
      status = '✅ Logged';
      daysLogged++;
    }

    const hours = formatDuration(total).padEnd(9);
    console.log(`  ${dayName}  ${dateStr}    ${hours}  ${status}`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\n📊 Summary:`);
  console.log(`   Total hours this week: ${formatDuration(totalWeek)}`);
  console.log(`   Days logged: ${daysLogged}/5`);

  const pastDays = dates.filter(d => d <= today).length;
  const missingDays = dates.filter(d => d <= today && dailyLogs[formatDate(d)].total === 0);
  if (missingDays.length > 0) {
    console.log(`\n⚠️  Missing logs for:`);
    for (const d of missingDays) {
      console.log(`   - ${DAYNAMES[d.getDay()]} (${formatDate(d)})`);
    }
  } else if (pastDays > 0) {
    console.log(`\n🎉 All past days have time logged!`);
  }

  // Detail breakdown
  console.log('\n─── Detailed Breakdown ─────────────────────────────────────────');
  for (const d of dates) {
    const dateStr = formatDate(d);
    const { entries } = dailyLogs[dateStr];
    if (entries.length === 0) continue;
    console.log(`\n  ${DAYNAMES[d.getDay()]} (${dateStr}):`);
    for (const e of entries) {
      console.log(`    • ${e.ticket}: ${e.summary} — ${formatDuration(e.time)}`);
    }
  }
  console.log('');
}

run().catch((err) => {
  const detail = err.response && err.response.data && JSON.stringify(err.response.data);
  console.error('Error: ' + err.message);
  if (detail) console.error('Detail: ' + detail);
  process.exit(1);
});
