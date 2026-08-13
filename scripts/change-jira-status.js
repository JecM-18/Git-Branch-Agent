'use strict';

require('dotenv').config();
const axios = require('axios');

// --- Helpers ---
function validateEnv() {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}\nCopy .env.example to .env and fill in the values.`);
  }
}

function createAuthHeaders() {
  const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

// --- API Functions ---
async function listMyTickets() {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/search/jql`;

  const { data } = await axios.post(url, {
    jql: 'assignee=currentUser() AND statusCategory!=Done ORDER BY updated DESC',
    fields: ['key', 'summary', 'status'],
    maxResults: 50,
  }, { headers: createAuthHeaders() });

  const tickets = data.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
  }));

  process.stdout.write(JSON.stringify(tickets));
}

async function listTransitions(ticketKey) {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${encodeURIComponent(ticketKey)}/transitions`;

  const { data } = await axios.get(url, { headers: createAuthHeaders() });

  const transitions = data.transitions.map((t) => ({
    id: t.id,
    name: t.name,
  }));

  process.stdout.write(JSON.stringify(transitions));
}

async function transitionTicket(ticketKey, transitionId) {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${encodeURIComponent(ticketKey)}/transitions`;

  await axios.post(url, { transition: { id: transitionId } }, { headers: createAuthHeaders() });

  console.log(`Transitioned ${ticketKey} successfully.`);
}

// --- Main ---
async function main() {
  validateEnv();

  const [mode, arg1, arg2] = process.argv.slice(2);

  switch (mode) {
    case 'list-tickets':
      await listMyTickets();
      break;

    case 'list-transitions':
      if (!arg1) throw new Error('Usage: change-jira-status.js list-transitions <TICKET_KEY>');
      await listTransitions(arg1);
      break;

    case 'transition':
      if (!arg1 || !arg2) throw new Error('Usage: change-jira-status.js transition <TICKET_KEY> <TRANSITION_ID>');
      await transitionTicket(arg1, arg2);
      break;

    default:
      throw new Error('Usage: change-jira-status.js <list-tickets|list-transitions|transition> [args...]');
  }
}

main().catch((err) => {
  var data = err.response && err.response.data;
  var msg = (data && data.errorMessages && data.errorMessages[0]) || (data && data.message) || err.message;
  console.error(msg);
  process.exit(1);
});
