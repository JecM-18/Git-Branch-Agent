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

document.getElementById('copy-log').addEventListener('click', () => {
  const text = outputLog.innerText;
  if (!text || !text.trim()) {
    logLine('✗ No output to copy', 'error');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    const originalText = document.getElementById('copy-log').textContent;
    document.getElementById('copy-log').textContent = '✓ Copied!';
    setTimeout(() => {
      document.getElementById('copy-log').textContent = originalText;
    }, 1500);
  }).catch((err) => {
    logLine('✗ Failed to copy: ' + err.message, 'error');
  });
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
toUpper('tm-ticket');

// Smart casing for ec-input: uppercase if ticket pattern, otherwise leave as-is
(function () {
  const el = document.getElementById('ec-input');
  el.addEventListener('input', () => {
    const val = el.value;
    const trimmed = val.trim();
    // Check if it looks like a ticket (starts with uppercase letters followed by dash and numbers)
    if (/^[A-Z]+-\d*$/.test(trimmed.toUpperCase())) {
      const pos = el.selectionStart;
      el.value = val.toUpperCase();
      el.setSelectionRange(pos, pos);
    }
  });
}());

// Smart casing for rpr-input: uppercase if ticket pattern, otherwise leave as-is
(function () {
  const el = document.getElementById('rpr-input');
  el.addEventListener('input', () => {
    const val = el.value;
    const trimmed = val.trim();
    // Check if it looks like a ticket (starts with uppercase letters followed by dash and numbers)
    if (/^[A-Z]+-\d*$/.test(trimmed.toUpperCase())) {
      const pos = el.selectionStart;
      el.value = val.toUpperCase();
      el.setSelectionRange(pos, pos);
    }
  });
}());

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

// ─── Reviewer tags ───────────────────────────────────────────────────────────
const DEFAULT_REVIEWERS = ['cs-markdi', 'cs-fredv', 'marcn-04'];
const reviewerTagsEl = document.getElementById('pr-reviewers-tags');
const reviewerInput  = document.getElementById('pr-reviewers-input');

function addReviewerTag(username) {
  username = username.trim();
  if (!username) return;
  // Prevent duplicates
  const existing = [...reviewerTagsEl.querySelectorAll('.rv-tag')].map(t => t.dataset.user);
  if (existing.includes(username)) return;

  const tag = document.createElement('span');
  tag.className = 'rv-tag';
  tag.dataset.user = username;
  tag.style.cssText = [
    'display:inline-flex', 'align-items:center', 'gap:4px',
    'background:var(--accent)', 'color:#fff', 'border-radius:4px',
    'padding:2px 8px', 'font-size:12px', 'user-select:none'
  ].join(';');
  tag.innerHTML = username + ' <span style="cursor:pointer;font-size:14px;line-height:1" title="Remove">×</span>';
  tag.querySelector('span').addEventListener('click', () => tag.remove());
  reviewerTagsEl.appendChild(tag);
}

function getReviewers() {
  return [...reviewerTagsEl.querySelectorAll('.rv-tag')].map(t => t.dataset.user);
}

// Pre-populate defaults
DEFAULT_REVIEWERS.forEach(addReviewerTag);

// Add reviewer on Enter or comma
reviewerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addReviewerTag(reviewerInput.value.replace(/,/g, ''));
    reviewerInput.value = '';
  }
});

// Click the tag container to focus the input
reviewerTagsEl.addEventListener('click', () => reviewerInput.focus());

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

  const reviewers = getReviewers().join(',');
  const useMid = document.getElementById('pr-use-mid').checked;

  runOperation(prBtn, () => window.electronAPI.createPR(input, env, reviewers, useMid));
}

// ─── Review PR ────────────────────────────────────────────────────────────────
const rprReviewBtn = document.getElementById('rpr-review');
const rprApproveBtn = document.getElementById('rpr-approve');
let lastReviewInput = '';
let lastReviewRepo = '';
let lastReviewPRNumber = '';
let lastReviewMergeStatus = '';
let lastReviewCIStatus = '';
let lastReviewAIStatus = '';

rprReviewBtn.addEventListener('click', () => submit_reviewPR());
rprApproveBtn.addEventListener('click', () => submit_approvePR());

document.getElementById('rpr-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit_reviewPR();
});

async function submit_reviewPR() {
  const input = document.getElementById('rpr-input').value.trim();
  if (!input) return showError('Enter a Jira ticket (e.g. AINEX-27) or GitHub PR URL');
  
  // Hide approve button while reviewing
  rprApproveBtn.style.display = 'none';
  
  const span = rprReviewBtn.querySelector('.btn-text');
  const orig = span.textContent;

  rprReviewBtn.disabled = true;
  span.innerHTML = '<span class="spinner"></span> Reviewing…';
  clearLog();
  setStatus('running');

  try {
    // Store the input for later approval
    lastReviewInput = input;
    
    await window.electronAPI.reviewPR(input, false);
    setStatus('success');
    
    // Check if review completed successfully by looking for the marker
    const logText = document.getElementById('output-log').innerText;
    if (logText.includes('REVIEW_COMPLETE|')) {
      // Extract repo, PR number, merge status, CI status, and AI status from marker
      const match = logText.match(/REVIEW_COMPLETE\|([^|]+)\|(\d+)\|(\w+)\|(\w+)\|([\w-]+)/);
      if (match) {
        lastReviewRepo = match[1];
        lastReviewPRNumber = match[2];
        lastReviewMergeStatus = match[3];
        lastReviewCIStatus = match[4];
        lastReviewAIStatus = match[5];
        rprApproveBtn.style.display = 'inline-flex';
        logLine('', 'info');
        logLine('Ready to approve — click "Approve PR" button above.', 'info');
        
        // Extra warning if there are conflicts or CI failures
        if (lastReviewMergeStatus === 'conflict') {
          logLine('⚠ WARNING: This PR has merge conflicts!', 'error');
        }
        if (lastReviewCIStatus === 'failure' || lastReviewCIStatus === 'error') {
          logLine('⚠ WARNING: CI/CD checks are failing!', 'error');
        }
        if (lastReviewAIStatus === 'ai-disabled') {
          logLine('ℹ AI Review was not available (add OPENAI_API_KEY to .env to enable)', 'info');
        }
      }
    }
    
  } catch (err) {
    setStatus('error');
    logLine('✗ ' + err.message, 'error');
  } finally {
    rprReviewBtn.disabled = false;
    span.textContent = orig;
  }
}

async function submit_approvePR() {
  if (!lastReviewInput) return showError('Review a PR first before approving');
  
  // Build warning message if there are issues
  let warnings = [];
  if (lastReviewMergeStatus === 'conflict') {
    warnings.push('• This PR has merge conflicts');
  }
  if (lastReviewCIStatus === 'failure' || lastReviewCIStatus === 'error') {
    warnings.push('• CI/CD checks are failing');
  }
  if (lastReviewCIStatus === 'pending') {
    warnings.push('• CI/CD checks are still running');
  }
  
  // Show confirmation if there are warnings
  if (warnings.length > 0) {
    const confirmed = confirm(
      'WARNING: This PR has issues:\n\n' +
      warnings.join('\n') + '\n\n' +
      'Approving this PR is not recommended.\n' +
      'Do you still want to approve?'
    );
    if (!confirmed) {
      logLine('Approval cancelled by user.', 'info');
      return;
    }
  }
  
  const span = rprApproveBtn.querySelector('.btn-text');
  const orig = span.textContent;

  rprApproveBtn.disabled = true;
  span.innerHTML = '<span class="spinner"></span> Approving…';
  clearLog();
  setStatus('running');

  try {
    await window.electronAPI.reviewPR(lastReviewInput, true);
    setStatus('success');
    logLine('✓ PR approved successfully!', 'success');
    
    // Hide approve button after successful approval
    rprApproveBtn.style.display = 'none';
    lastReviewInput = '';
    lastReviewRepo = '';
    lastReviewPRNumber = '';
    lastReviewMergeStatus = '';
    lastReviewCIStatus = '';
    lastReviewAIStatus = '';
    
  } catch (err) {
    setStatus('error');
    logLine('✗ ' + err.message, 'error');
  } finally {
    rprApproveBtn.disabled = false;
    span.textContent = orig;
  }
}

// ─── Evaluate Comments ────────────────────────────────────────────────────────
const ecBtn = document.getElementById('ec-evaluate');

ecBtn.addEventListener('click', () => submit_evaluateComments());

document.getElementById('ec-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit_evaluateComments();
});

function submit_evaluateComments() {
  const input = document.getElementById('ec-input').value.trim();
  if (!input) return showError('Enter a Jira ticket (e.g. AINEX-27) or GitHub PR URL');
  
  runOperation(ecBtn, () => window.electronAPI.evaluateComments(input));
}

// ─── Release Branch ───────────────────────────────────────────────────────────
const rbBtn = document.getElementById('rb-create');

rbBtn.addEventListener('click', () => submit_releaseBranch());

['rb-version'].forEach((id) => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit_releaseBranch();
  });
});

function submit_releaseBranch() {
  const project = document.getElementById('rb-project').value.trim();
  const version = document.getElementById('rb-version').value.trim();
  const env = document.getElementById('rb-env').value.trim();

  if (!project) return showError('Select a project');
  if (!version) return showError('Enter a release version (e.g., 3.51.0)');
  
  // Validate version format
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return showError('Invalid version format. Expected: X.Y.Z (e.g., 3.51.0)');
  }

  const createPR = !!env;
  
  runOperation(rbBtn, () => window.electronAPI.createReleaseBranch(project, version, env, createPR));
}

// ─── Create Jira Ticket ───────────────────────────────────────────────────────
const ctBtn = document.getElementById('ct-create');

ctBtn.addEventListener('click', () => submit_createTicket());

['ct-title'].forEach((id) => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit_createTicket();
  });
});

function submit_createTicket() {
  const project = document.getElementById('ct-project').value.trim();
  const type = document.getElementById('ct-type').value.trim();
  const title = document.getElementById('ct-title').value.trim();
  const description = document.getElementById('ct-description').value.trim();
  const costCenter = document.getElementById('ct-cost-center').value.trim();
  const assignToMe = document.getElementById('ct-assign-to-me').checked;

  if (!title) return showError('Enter a title for the ticket');
  if (title.length < 5) return showError('Title must be at least 5 characters');
  if (!costCenter) return showError('Please select a cost center');

  runOperation(ctBtn, () => window.electronAPI.createJiraTicket(project, type, title, description || '', costCenter, assignToMe));
}

// ─── Change Jira Status ───────────────────────────────────────────────────────
const csLoadBtn = document.getElementById('cs-load-tickets');
const csTicketSelect = document.getElementById('cs-ticket');
const csTransitionSelect = document.getElementById('cs-transition');
const csSubmitBtn = document.getElementById('cs-submit');

csLoadBtn.addEventListener('click', loadJiraTickets);
csTicketSelect.addEventListener('change', loadTransitions);
csTransitionSelect.addEventListener('change', () => {
  csSubmitBtn.disabled = !csTransitionSelect.value;
});
csSubmitBtn.addEventListener('click', submit_changeStatus);

async function loadJiraTickets() {
  const span = csLoadBtn.querySelector('.btn-text');
  const orig = span.textContent;
  csLoadBtn.disabled = true;
  span.innerHTML = '<span class="spinner"></span> Loading…';

  try {
    const tickets = await window.electronAPI.listJiraTickets();
    csTicketSelect.innerHTML = '<option value="">-- Select a ticket --</option>';
    tickets.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.key;
      opt.textContent = `${t.key} — ${t.summary} [${t.status}]`;
      csTicketSelect.appendChild(opt);
    });
    csTicketSelect.disabled = false;
    csTransitionSelect.innerHTML = '<option value="">-- Select a ticket first --</option>';
    csTransitionSelect.disabled = true;
    csSubmitBtn.disabled = true;
  } catch (err) {
    showError('Failed to load tickets: ' + err.message);
  } finally {
    csLoadBtn.disabled = false;
    span.textContent = orig;
  }
}

async function loadTransitions() {
  const ticketKey = csTicketSelect.value;
  csTransitionSelect.innerHTML = '<option value="">Loading…</option>';
  csTransitionSelect.disabled = true;
  csSubmitBtn.disabled = true;

  if (!ticketKey) {
    csTransitionSelect.innerHTML = '<option value="">-- Select a ticket first --</option>';
    return;
  }

  try {
    const transitions = await window.electronAPI.listJiraTransitions(ticketKey);
    csTransitionSelect.innerHTML = '<option value="">-- Select transition --</option>';
    transitions.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      csTransitionSelect.appendChild(opt);
    });
    csTransitionSelect.disabled = false;
    csSubmitBtn.disabled = true;
  } catch (err) {
    csTransitionSelect.innerHTML = '<option value="">-- Error loading transitions --</option>';
    showError('Failed to load transitions: ' + err.message);
  }
}

function submit_changeStatus() {
  const ticketKey = csTicketSelect.value;
  const transitionId = csTransitionSelect.value;

  if (!ticketKey) return showError('Select a ticket');
  if (!transitionId) return showError('Select a transition');

  runOperation(csSubmitBtn, () => window.electronAPI.changeJiraStatus(ticketKey, transitionId));
}

// ─── Teams Message ────────────────────────────────────────────────────────────
const tmBtn = document.getElementById('tm-generate');
const tmCopyBtn = document.getElementById('tm-copy');

tmBtn.addEventListener('click', () => submit_teamsMessage());

document.getElementById('tm-ticket').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit_teamsMessage();
});

async function submit_teamsMessage() {
  const ticket = document.getElementById('tm-ticket').value.trim().toUpperCase();
  if (!ticket) return showError('Enter a Jira ticket (e.g. AIPACT-40)');
  if (!validateTicket(ticket)) return showError('Invalid format — use e.g. AIPACT-40');

  const outputGroup = document.getElementById('tm-output-group');
  const output = document.getElementById('tm-output');
  const copyStatus = document.getElementById('tm-copy-status');
  
  // Hide output while generating
  outputGroup.style.display = 'none';
  copyStatus.style.display = 'none';
  
  const span = tmBtn.querySelector('.btn-text');
  const orig = span.textContent;

  tmBtn.disabled = true;
  span.innerHTML = '<span class="spinner"></span> Looking for PR…';
  clearLog();
  setStatus('running');

  try {
    await window.electronAPI.formatTeamsMessage(ticket);
    setStatus('success');
    
    // Extract the generated message from the log output
    // The script outputs the message between separator lines
    const logText = document.getElementById('output-log').innerText;
    const lines = logText.split('\n');
    
    // Find the message between the separator lines
    let messageStart = -1;
    let messageEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Teams Message Generated:')) {
        messageStart = i + 2; // Skip the "Generated:" line and separator
      } else if (messageStart > -1 && i > messageStart && lines[i].startsWith('─')) {
        messageEnd = i;
        break;
      }
    }
    
    if (messageStart > -1 && messageEnd > -1) {
      const message = lines.slice(messageStart, messageEnd).join('\n').trim();
      output.value = message;
      outputGroup.style.display = 'flex';
    } else {
      throw new Error('Could not extract message from output');
    }
    
  } catch (err) {
    setStatus('error');
    logLine('✗ ' + err.message, 'error');
  } finally {
    tmBtn.disabled = false;
    span.textContent = orig;
  }
}

tmCopyBtn.addEventListener('click', () => {
  const output = document.getElementById('tm-output');
  const copyStatus = document.getElementById('tm-copy-status');
  
  navigator.clipboard.writeText(output.value).then(() => {
    copyStatus.style.display = 'block';
    logLine('✓ Copied to clipboard!', 'success');
    setTimeout(() => {
      copyStatus.style.display = 'none';
    }, 2000);
  }).catch((err) => {
    logLine('✗ Failed to copy: ' + err.message, 'error');
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await window.electronAPI.getSettings();
  if (s.JIRA_BASE_URL)   document.getElementById('s-jira-url').value   = s.JIRA_BASE_URL;
  if (s.JIRA_EMAIL)      document.getElementById('s-jira-email').value  = s.JIRA_EMAIL;
  if (s.JIRA_API_TOKEN)  document.getElementById('s-jira-token').value  = s.JIRA_API_TOKEN;
  if (s.GITHUB_PAT)      document.getElementById('s-github-pat').value  = s.GITHUB_PAT;
  if (s.GITHUB_ORG)      document.getElementById('s-github-org').value  = s.GITHUB_ORG;
  if (s.GITHUB_USERNAME) document.getElementById('s-github-username').value = s.GITHUB_USERNAME;
  if (s.OPENAI_API_KEY)  document.getElementById('s-openai-key').value  = s.OPENAI_API_KEY;
  if (s.AI_MODEL)        document.getElementById('s-ai-model').value    = s.AI_MODEL;
  if (s.AI_PROVIDER)     document.getElementById('s-ai-provider').value = s.AI_PROVIDER || 'openai';
  
  updateAIProviderUI();
}

function updateAIProviderUI() {
  const provider = document.getElementById('s-ai-provider').value;
  const openaiKeyGroup = document.getElementById('openai-key-group');
  
  if (provider === 'github') {
    openaiKeyGroup.style.display = 'none';
  } else {
    openaiKeyGroup.style.display = 'flex';
  }
}

document.getElementById('s-ai-provider').addEventListener('change', updateAIProviderUI);

document.getElementById('s-save').addEventListener('click', async () => {
  const settings = {
    JIRA_BASE_URL:   document.getElementById('s-jira-url').value.trim(),
    JIRA_EMAIL:      document.getElementById('s-jira-email').value.trim(),
    JIRA_API_TOKEN:  document.getElementById('s-jira-token').value.trim(),
    GITHUB_PAT:      document.getElementById('s-github-pat').value.trim(),
    GITHUB_ORG:      document.getElementById('s-github-org').value.trim(),
    GITHUB_USERNAME: document.getElementById('s-github-username').value.trim(),
    OPENAI_API_KEY:  document.getElementById('s-openai-key').value.trim(),
    AI_MODEL:        document.getElementById('s-ai-model').value.trim(),
    AI_PROVIDER:     document.getElementById('s-ai-provider').value.trim(),
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

document.getElementById('link-openai').addEventListener('click', () => {
  window.electronAPI.openExternal('https://platform.openai.com/api-keys');
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function showError(msg) {
  clearLog();
  logLine(msg, 'error');
  setStatus('error');
  // Scroll log into view
  document.querySelector('.output-section').scrollIntoView({ behavior: 'smooth' });
}
// ─── Auto Review Tab ──────────────────────────────────────────────────────
const arToggle   = document.getElementById('ar-toggle');
const arBadge    = document.getElementById('ar-status-badge');
const arRunNow   = document.getElementById('ar-run-now');
const arQueueBody = document.getElementById('ar-queue-body');
const arLog      = document.getElementById('ar-log');

function arLogLine(text) {
  const div = document.createElement('div');
  div.textContent = text;
  arLog.appendChild(div);
  arLog.scrollTop = arLog.scrollHeight;
}

const DECISION_STYLE = {
  APPROVE:          'color:#4ade80; font-weight:700;',
  REQUEST_CHANGES:  'color:#f87171; font-weight:700;',
  NEEDS_HUMAN:      'color:#f59e0b; font-weight:700;',
};

const RISK_STYLE = {
  LOW_RISK: 'color:#4ade80;',
  COMPLEX:  'color:#f59e0b;',
};

function appendQueueRow(result) {
  // Remove placeholder row if present
  const placeholder = arQueueBody.querySelector('tr td[colspan]');
  if (placeholder) placeholder.closest('tr').remove();

  const tr = document.createElement('tr');
  tr.style.cssText = 'border-bottom:1px solid var(--border); cursor:pointer;';
  tr.title = result.summary || '';

  const time = result.reviewedAt
    ? new Date(result.reviewedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  tr.innerHTML = '<td style="padding:7px 8px; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
    '<a style="color:var(--info); text-decoration:none; cursor:pointer;" data-url="' + (result.url || '') + '">' +
    escapeHtml(result.title || '') + '</a></td>' +
    '<td style="padding:7px 8px; color:var(--text-muted);">' + escapeHtml(result.repo || '') + '</td>' +
    '<td style="padding:7px 8px; ' + (DECISION_STYLE[result.decision] || '') + '">' + (result.decision || '') + '</td>' +
    '<td style="padding:7px 8px; ' + (RISK_STYLE[result.risk] || '') + '">' + (result.risk || '') + '</td>' +
    '<td style="padding:7px 8px; color:var(--text-muted);">' + time + '</td>';

  tr.querySelector('a').addEventListener('click', (e) => {
    const url = e.target.dataset.url;
    if (url) window.electronAPI.openExternal(url);
  });

  // Insert newest at top
  arQueueBody.insertBefore(tr, arQueueBody.firstChild);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function initAutoReviewTab() {
  try {
    const status = await window.electronAPI.getAutoReviewStatus();
    arToggle.checked = status.enabled;
    arBadge.textContent = status.enabled ? (status.running ? '🟡 Running' : '🟢 Active') : '⚫ Idle';
    arBadge.style.color = status.enabled ? (status.running ? 'var(--warning)' : 'var(--success)') : 'var(--text-muted)';
    arBadge.style.borderColor = status.enabled ? (status.running ? 'var(--warning)' : 'var(--success)') : 'var(--border)';

    if (status.queue && status.queue.length > 0) {
      // Repopulate queue from memory (newest first already)
      arQueueBody.innerHTML = '';
      status.queue.forEach(appendQueueRow);
    }
  } catch { /* ignore */ }
}

// Populate queue when switching to Auto Review tab
document.querySelector('.tab[data-tab="auto-review"]').addEventListener('click', initAutoReviewTab);

arToggle.addEventListener('change', async () => {
  const enabled = arToggle.checked;
  try {
    await window.electronAPI.toggleAutoReview(enabled);
    arBadge.textContent = enabled ? '🟢 Active' : '⚫ Idle';
    arBadge.style.color = enabled ? 'var(--success)' : 'var(--text-muted)';
    arBadge.style.borderColor = enabled ? 'var(--success)' : 'var(--border)';
    arLogLine(enabled ? '▶ Agent enabled — polling every 2 minutes.' : '⏹ Agent disabled.');
  } catch (err) {
    arLogLine('✗ ' + err.message);
    arToggle.checked = !enabled;
  }
});

arRunNow.addEventListener('click', async () => {
  const span = arRunNow.querySelector('.btn-text');
  arRunNow.disabled = true;
  span.innerHTML = '<span class="spinner"></span> Running…';
  arLogLine('▶ Manual review started…');
  arBadge.textContent = '🟡 Running';
  arBadge.style.color = 'var(--warning)';
  arBadge.style.borderColor = 'var(--warning)';
  try {
    await window.electronAPI.runAutoReviewNow();
  } finally {
    arRunNow.disabled = false;
    span.textContent = '▶ Review Now';
  }
});

window.electronAPI.onAutoReviewResult((result) => {
  appendQueueRow({ ...result, reviewedAt: new Date().toISOString() });
  const label = result.decision === 'APPROVE' ? '✅ Auto-approved' :
                result.decision === 'REQUEST_CHANGES' ? '❌ Issues found' : '⚠️ Needs human review';
  arLogLine(label + ': ' + result.title + ' [' + result.repo + ']');
  arBadge.textContent = '🟢 Active';
  arBadge.style.color = 'var(--success)';
  arBadge.style.borderColor = 'var(--success)';
});

window.electronAPI.onAutoReviewLog((text) => {
  arLogLine(text);
});

window.electronAPI.onShowAutoReviewTab(() => {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  const tab = document.querySelector('.tab[data-tab="auto-review"]');
  if (tab) {
    tab.classList.add('active');
    document.getElementById('panel-auto-review').classList.add('active');
    initAutoReviewTab();
  }
});
// ─── Time Reminder Handler ────────────────────────────────────────────────────
window.electronAPI.onShowLogTimeTab(() => {
  // Switch to the log time tab
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  
  const logTimeTab = document.querySelector('.tab[data-tab="log-time"]');
  if (logTimeTab) {
    logTimeTab.classList.add('active');
    document.getElementById('panel-log-time').classList.add('active');
    
    // Focus on the ticket input field
    const ticketInput = document.getElementById('lt-ticket');
    if (ticketInput) {
      setTimeout(() => ticketInput.focus(), 100);
    }
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadSettings();
