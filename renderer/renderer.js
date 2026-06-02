'use strict';

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ─── Output log ───────────────────────────────────────────────────────────────
const outputLog  = document.getElementById('output-log');
const statusDot  = document.getElementById('status-dot');

function logLine(text, type = 'stdout') {
  const lines = text.split(/\r?\n/);
  lines.forEach((line) => {
    if (!line) return;
    const div = document.createElement('div');
    div.className = 'log-line ' + type;
    div.textContent = line;
    outputLog.appendChild(div);
  });
  outputLog.scrollTop = outputLog.scrollHeight;
}

function clearLog() {
  outputLog.innerHTML = '';
}

function setStatus(s) {
  statusDot.className = 'status-dot' + (s ? ' ' + s : '');
}

document.getElementById('clear-log').addEventListener('click', () => {
  clearLog();
  setStatus('');
});

// Stream output from main process
window.electronAPI.onOutputLine(({ type, text }) => logLine(text, type));

// ─── Run helper ───────────────────────────────────────────────────────────────
async function runOperation(btn, operation) {
  const span = btn.querySelector('.btn-text');
  const orig = span.textContent;

  btn.disabled = true;
  span.innerHTML = '<span class="spinner"></span> Running…';
  clearLog();
  setStatus('running');

  try {
    await operation();
    setStatus('success');
    logLine('✓ Done', 'success');
  } catch (err) {
    setStatus('error');
    logLine('✗ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    span.textContent = orig;
  }
}

// ─── Input helpers ────────────────────────────────────────────────────────────
function toUpper(id) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(pos, pos);
  });
}

function validateTicket(val) {
  return /^[A-Z]+-\d+$/.test(val.trim().toUpperCase());
}

toUpper('cb-ticket');
toUpper('mid-ticket');
toUpper('lt-ticket');

// Smart casing for pr-input: uppercase first word only
(function () {
  const el = document.getElementById('pr-input');
  el.addEventListener('input', () => {
    const val = el.value;
    const spaceIdx = val.indexOf(' ');
    let newVal;
    if (spaceIdx === -1) {
      newVal = val.toUpperCase();
    } else {
      newVal = val.slice(0, spaceIdx).toUpperCase() + val.slice(spaceIdx);
    }
    if (newVal !== val) {
      const pos = el.selectionStart;
      el.value = newVal;
      el.setSelectionRange(pos, pos);
    }
    updatePrEnvVisibility();
  });
}());

function updatePrEnvVisibility() {
  const val = document.getElementById('pr-input').value.trim().toUpperCase();
  const isTicket = /^[A-Z]+-\d+$/.test(val);
  document.getElementById('pr-env-group').style.display = (!val || isTicket) ? 'none' : 'flex';
}

// ─── Create Branch ────────────────────────────────────────────────────────────
const cbBtn = document.getElementById('cb-run');

cbBtn.addEventListener('click', () => submit_createBranch());

document.getElementById('cb-ticket').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit_createBranch();
});

function submit_createBranch() {
  const ticket = document.getElementById('cb-ticket').value.trim().toUpperCase();
  if (!ticket) return showError('Enter a Jira ticket (e.g. AINEX-27)');
  if (!validateTicket(ticket)) return showError('Invalid format — use e.g. AINEX-27');
  runOperation(cbBtn, () => window.electronAPI.createBranch(ticket));
}

// ─── Create Mid Branch ────────────────────────────────────────────────────────
const midBtn = document.getElementById('mid-run');

midBtn.addEventListener('click', () => submit_midBranch());

document.getElementById('mid-ticket').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit_midBranch();
});

function submit_midBranch() {
  const ticket = document.getElementById('mid-ticket').value.trim().toUpperCase();
  const env    = document.getElementById('mid-env').value;
  if (!ticket) return showError('Enter a Jira ticket (e.g. AINEX-27)');
  if (!validateTicket(ticket)) return showError('Invalid format — use e.g. AINEX-27');
  runOperation(midBtn, () => window.electronAPI.createMidBranch(ticket, env));
}

// ─── Log Time ─────────────────────────────────────────────────────────────────
const ltBtn = document.getElementById('lt-run');

ltBtn.addEventListener('click', () => submit_logTime());

['lt-ticket', 'lt-time', 'lt-date'].forEach((id) => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit_logTime();
  });
});

function submit_logTime() {
  const ticket  = document.getElementById('lt-ticket').value.trim().toUpperCase();
  const time    = document.getElementById('lt-time').value.trim();
  const dateStr = document.getElementById('lt-date').value.trim() || 'today';

  if (!ticket) return showError('Enter a Jira ticket (e.g. AINEX-57)');
  if (!validateTicket(ticket)) return showError('Invalid format — use e.g. AINEX-57');
  if (!time) return showError('Enter a time value (e.g. 7.5h)');

  runOperation(ltBtn, () => window.electronAPI.logTime(ticket, time, dateStr));
}

// ─── Create PR ───────────────────────────────────────────────────────────────
const prBtn = document.getElementById('pr-submit');

prBtn.addEventListener('click', () => submit_createPR());

document.getElementById('pr-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit_createPR();
});

function submit_createPR() {
  const raw = document.getElementById('pr-input').value.trim();
  if (!raw) return showError('Enter a Jira ticket (e.g. AINEX-27) or release (e.g. Nexus 3.56.7)');

  const isTicket = /^[A-Z]+-\d+$/.test(raw.toUpperCase());
  let input, env;

  if (isTicket) {
    input = raw.toUpperCase();
    env   = 'staging'; // ticket PRs always target Staging
  } else {
    input = raw;
    env   = document.getElementById('pr-env').value;
    if (!env) return showError('Select an environment (UAT or Production) for release PRs.');
  }

  const reviewers = document.getElementById('pr-reviewers').value.trim();

  runOperation(prBtn, () => window.electronAPI.createPR(input, env, reviewers || ''));
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await window.electronAPI.getSettings();
  if (s.JIRA_BASE_URL)   document.getElementById('s-jira-url').value   = s.JIRA_BASE_URL;
  if (s.JIRA_EMAIL)      document.getElementById('s-jira-email').value  = s.JIRA_EMAIL;
  if (s.JIRA_API_TOKEN)  document.getElementById('s-jira-token').value  = s.JIRA_API_TOKEN;
  if (s.GITHUB_PAT)      document.getElementById('s-github-pat').value  = s.GITHUB_PAT;
  if (s.GITHUB_ORG)      document.getElementById('s-github-org').value  = s.GITHUB_ORG;
}

document.getElementById('s-save').addEventListener('click', async () => {
  const settings = {
    JIRA_BASE_URL:   document.getElementById('s-jira-url').value.trim(),
    JIRA_EMAIL:      document.getElementById('s-jira-email').value.trim(),
    JIRA_API_TOKEN:  document.getElementById('s-jira-token').value.trim(),
    GITHUB_PAT:      document.getElementById('s-github-pat').value.trim(),
    GITHUB_ORG:      document.getElementById('s-github-org').value.trim(),
  };
  await window.electronAPI.saveSettings(settings);
  const badge = document.getElementById('saved-badge');
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 2200);
});

// ─── External links ───────────────────────────────────────────────────────────
document.getElementById('link-jira').addEventListener('click', () => {
  window.electronAPI.openExternal('https://id.atlassian.com/manage-profile/security/api-tokens');
});

document.getElementById('link-github').addEventListener('click', () => {
  window.electronAPI.openExternal('https://github.com/settings/tokens');
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function showError(msg) {
  clearLog();
  logLine(msg, 'error');
  setStatus('error');
  // Scroll log into view
  document.querySelector('.output-section').scrollIntoView({ behavior: 'smooth' });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadSettings();
