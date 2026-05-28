# Git Branch Agent

A VS Code Copilot agent that creates GitHub branches from Jira tickets and logs work time — all from natural language commands.

## Features

- **Create a standard branch** from a Jira ticket (always branched from `develop`)
- **Create a mid branch** for staging, UAT, or production environments
- **Log work time** on a Jira ticket for one or multiple dates

## Supported Projects

| Project Key | GitHub Repo   |
|-------------|---------------|
| `AINEX`     | `rrp`         |
| `AIPACT`    | `contractdb`  |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure credentials

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```env
JIRA_BASE_URL=https://cloudstaff-blueberry.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-jira-api-token
GITHUB_PAT=your-github-personal-access-token
GITHUB_ORG=cloudstaff-apps
```

- **JIRA_API_TOKEN** — Generate from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
- **GITHUB_PAT** — Generate from [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) (requires `repo` scope)

## Usage

### Via VS Code Copilot (Recommended)

Use the **Branch Creator & Jira Time Tracker** agent in VS Code Copilot chat. Just describe what you want:

| Goal | Example prompt |
|------|---------------|
| Create a branch | `create a branch for AINEX-27` |
| Create a mid staging branch | `create mid staging branch for AINEX-27` |
| Create a mid UAT branch | `create mid uat branch for AIPACT-15` |
| Create a mid production branch | `create mid prod branch for AINEX-27` |
| Log time today | `log 7.5h on AINEX-57 today` |
| Log time on a specific day | `log 7h on AINEX-57 last tuesday` |
| Log time on multiple days | `log 8h on AINEX-57 last friday, last monday, and yesterday` |

### Via Terminal

```bash
# Create a standard branch
node scripts/create-branch.js AINEX-27

# Create a mid branch
node scripts/create-mid-branch.js AINEX-27 staging
node scripts/create-mid-branch.js AINEX-27 uat
node scripts/create-mid-branch.js AINEX-27 prod

# Log time
node scripts/log-time.js AINEX-57 7.5h "today"
node scripts/log-time.js AINEX-57 7h "last tuesday"
node scripts/log-time.js AINEX-57 8h "last friday, yesterday, today"
```

## Branch Naming

| Type | Format |
|------|--------|
| Standard | `feature/AINEX-27-ticket-summary-here` |
| Mid | `feature/AINEX-27-ticket-summary-here-mid` |

Standard branches are always created from `develop`.  
Mid branches are created from the environment branch with the feature branch merged in.

## Environment Branch Mapping

| Environment | AINEX branch | AIPACT branch |
|-------------|-------------|---------------|
| `staging` | `Release/Staging` | `deployment/staging` |
| `uat` | `Release/UAT` | `deployment/UAT` |
| `prod` / `production` | `Release/Production` | `deployment/Production` |

## Supported Time Formats

`7.5h`, `7h`, `7h30m`, `30m`, `1d` (1d = 8h)

## Supported Date Phrases

`today` (default), `yesterday`, `last <weekday>` (e.g. `last tuesday`)
