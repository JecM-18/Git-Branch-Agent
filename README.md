# Git Branch Agent

A VS Code Copilot agent that creates GitHub branches from Jira tickets and logs work time — all from natural language commands.

## Features

- **Create a standard branch** from a Jira ticket (always branched from `develop`)
- **Create a mid branch** for staging, UAT, or production environments
- **Log work time** on a Jira ticket for one or multiple dates
- **Create pull requests** with AI-generated summaries
- **Review PRs** with AI-powered code analysis
- **Evaluate Copilot PR comments** — AI evaluates GitHub Copilot suggestions to determine priority and applicability
- **Create release branches** — Automate release workflows by creating a branch from develop, merging all open PRs, detecting conflicts, and optionally creating a PR to UAT/Prod

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

### 3. Run the application

**Option 1: Desktop App (Windows)**
```bash
npm start
```
Or double-click `Start App.bat`

**Option 2: Standalone Executable**
See [PACKAGING-GUIDE.md](PACKAGING-GUIDE.md) for instructions on building a standalone .exe file

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

## Evaluate Copilot PR Comments

The **Evaluate Comments** feature analyzes GitHub Copilot code review comments using AI to help you prioritize and decide which suggestions to apply.

### What It Does

- Fetches all Copilot comments from a PR (inline and review comments)
- **Automatically skips resolved conversations** to focus on open issues
- Uses AI to evaluate each comment for:
  - **Should Apply**: Yes/No recommendation
  - **Priority**: High/Medium/Low
  - **Category**: Security/Bugs/Performance/Quality/Style
  - **Reasoning**: Brief explanation of the evaluation
- Generates multiple output formats:
  - Console output with color-coded priorities
  - Markdown report (`.md`) with tables and detailed breakdown
  - Text file (`.txt`) for easy download and sharing

### How to Use

**Via Desktop App:**
1. Go to the "Evaluate Comments" tab
2. Enter a Jira ticket (e.g., `AINEX-27`) or PR URL
3. Click "Evaluate Comments"
4. Wait for AI evaluation (may take 10-30 seconds per comment)
5. View results in the output panel
6. Find generated reports in: `Documents/Copilot Review/pr-{number}-evaluation-{timestamp}.md` and `.txt`
7. Old reports are automatically cleaned up (keeps last 20 files, max 30 days)

**Via Terminal:**
```bash
node scripts/evaluate-pr-comments.js AINEX-27
# or
node scripts/evaluate-pr-comments.js https://github.com/org/repo/pull/123
```

Reports are saved to `Documents/Copilot Review/` with automatic cleanup.

### Requirements

- AI provider configuration in `.env` (see Settings tab):
  - Option 1: `OPENAI_API_KEY` (recommended)
  - Option 2: `AI_PROVIDER=github` with `GITHUB_TOKEN`
- PR must have Copilot review comments

### Output Example

```
🔴 HIGH PRIORITY (2)
  ✅ APPLY [Security] src/auth.js:45
    💬 Potential SQL injection vulnerability...
    📝 Critical security issue that must be addressed
    🔧 Ask Copilot: "@workspace /fix src/auth.js:45"

🟡 MEDIUM PRIORITY (5)
  ✅ APPLY [Bugs] src/utils.js:120
    💬 Possible null pointer exception...
    📝 Should be fixed to prevent runtime errors

🟢 LOW PRIORITY (3)
  ⏭️  SKIP [Style] src/components/Button.js:10
    💬 Consider using const instead of let...
    📝 Minor style improvement, not critical
```

### Generated Reports

The evaluation creates two Copilot-optimized report files:

**Markdown Report (`.md`):**
- ✅ Quick action checklist with checkboxes
- 🔗 Direct VS Code file links (`vscode://file/...`)
- 🤖 Instructions for GitHub Copilot to generate fixes
- 📊 Priority-based sections with detailed breakdown
- 💡 Suggested Copilot commands for each issue

**Text Report (`.txt`):**
- 📋 Plain text format for easy sharing
- ✅ Actionable checklist format `[ ]` → `[X]`
- 🎯 Clear file locations and line references
- 📝 Step-by-step instructions for applying fixes
- 🔧 Copilot command templates ready to use

### Using Reports with GitHub Copilot

**In VS Code, open the generated `.md` file and:**

1. **Ask Copilot to apply all high-priority fixes:**
   ```
   @workspace /fix Apply all high-priority changes from this evaluation
   ```

2. **Ask for a specific fix:**
   ```
   @workspace /fix src/auth.js:45 implement the suggested null check
   ```

3. **Review a specific issue:**
   ```
   @workspace Review the security issue at src/auth.js:45 and suggest a fix
   ```

4. **Check off items** in the Quick Action Checklist as you apply them

The reports are formatted specifically for Copilot to understand:
- Clear file paths and line numbers
- Actionable descriptions
- Priority-based organization
- Embedded instructions and prompts

## Create Release Branch

The **Release Branch** feature automates the process of preparing releases for UAT or Production. It creates a release branch from `develop`, merges all open PRs, detects conflicts, and optionally creates a PR to the target environment.

### What It Does

1. Creates a `feature/{version}` branch from `develop`
2. Fetches all open PRs targeting `develop` (filters by feature/* or bug/* pattern)
3. Merges each ticket branch into the release branch
4. Detects and reports merge conflicts
5. Lists successfully merged tickets
6. Optionally creates a PR to UAT or Production

### How to Use

**Via Desktop App:**
1. Go to the "Release Branch" tab
2. Select project: **Nexus** (AINEX) or **Pact-X** (AIPACT)
3. Enter release version (e.g., `3.51.0`)
4. Select target environment (UAT/Prod) or leave blank to skip PR creation
5. Click "Create Release Branch"
6. Review the list of merged tickets and any conflicts
7. If conflicts are detected, they will be highlighted in red

**Via Terminal:**
```bash
# Create release branch and merge tickets (no PR)
node scripts/create-release-branch.js Nexus 3.51.0

# Create release branch, merge tickets, and create PR to UAT
node scripts/create-release-branch.js Nexus 3.51.0 uat --create-pr

# Create release branch, merge tickets, and create PR to Production
node scripts/create-release-branch.js Pact-X 3.51.0 prod --create-pr
```

### Branch Format

| Project | Release Branch | PR Target (UAT) | PR Target (Prod) |
|---------|---------------|-----------------|------------------|
| Nexus (AINEX) | `feature/3.51.0` | `Release/UAT` | `Release/Production` |
| Pact-X (AIPACT) | `feature/3.51.0` | `deployment/UAT` | `deployment/Production` |

### Conflict Detection

If any ticket has merge conflicts when merging into the release branch:
- The conflict will be reported with details
- The script will continue merging other tickets
- You must manually resolve conflicts before proceeding
- All successfully merged tickets will be listed

### Output Example

```
✅ Created release branch: feature/3.51.0 from develop

📋 Found 5 open PRs targeting develop:

Merging tickets...
✅ AINEX-123: feature/AINEX-123-login-fix
✅ AINEX-124: feature/AINEX-124-ui-update
❌ AINEX-125: feature/AINEX-125-api-changes (CONFLICT)
   ⚠️  Merge conflict detected. Manual resolution required.
✅ AINEX-126: bug/AINEX-126-bug-fix
✅ AINEX-127: feature/AINEX-127-performance

📦 Successfully merged: 4/5 tickets
⚠️  Conflicts: 1 ticket(s) require manual resolution

🔗 Created PR #456: Release 3.51.0 to UAT
   https://github.com/org/repo/pull/456
```

### Requirements

- All PRs must target the `develop` branch
- Branch names must follow pattern: `feature/*` or `bug/*`
- PR must be in open state
- GitHub PAT with repo access required

## Supported Time Formats

`7.5h`, `7h`, `7h30m`, `30m`, `1d` (1d = 8h)

## Supported Date Phrases

`today` (default), `yesterday`, `last <weekday>` (e.g. `last tuesday`)




##Installation Setup
1. Download and run "Git Branch Agent 1.0.0.exe" (portable)
   OR install using "Git Branch Agent Setup 1.0.0.exe"

2. Create a .env file in the same folder with your credentials
   (use .env.example as a template)

3. Double-click the app to launch