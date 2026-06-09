# Converting to Standalone Software - Setup Guide

## Current Situation

Your system is running **Node.js 12.22.12**, but modern build tools require **Node.js 14+**.

## ✅ Recommended Solution: Use fnm to Switch Node.js Version

Since you're using **fnm** (Fast Node Manager), upgrading is super easy!

### Step 1: Install Node.js 18 LTS
```bash
fnm install 18
```

### Step 2: Use Node.js 18
```bash
fnm use 18
```

### Step 3: Verify Installation
```bash
node --version
# Should show v18.x.x or higher
```

### Step 4: Reinstall Dependencies
```bash
npm install
```

### Step 5: Build Your Application
```bash
npm run build
```

### Optional: Set Node 18 as Default
```bash
fnm default 18
```

This ensures Node 18 is used automatically in new terminal sessions.

This will create:
- `dist/Git Branch Agent Setup 1.0.0.exe` - Windows installer
- `dist/Git Branch Agent 1.0.0.exe` - Portable executable

---

## 🔧 Alternative: Manual Packaging (Current Node Version)

If you can't upgrade Node.js right now, use this workaround:

### Option 1: Use pkg (Simple Packager)
```bash
npm install -g pkg
pkg . --targets node12-win-x64 --output dist/git-branch-agent.exe
```

### Option 2: Keep Using the Batch File
The `Start App.bat` approach still works! To make it more professional:

1. **Create a Windows Shortcut**:
   - Right-click `Start App.bat`
   - Create Shortcut
   - Right-click the shortcut → Properties
   - Change Icon (optional)
   - Rename to "Git Branch Agent"

2. **Distribute as a ZIP**:
   - Create a folder with:
     - All app files
     - `Start App.bat`
     - `.env.example` (template for users)
     - `README.md` (setup instructions)
   - Zip the folder
   - Users extract and run the batch file

---

## 📊 Comparison

| Method | Pros | Cons |
|--------|------|------|
| **Electron Builder** (Node 14+) | Professional installer, auto-updates, clean UX | Requires Node upgrade |
| **pkg** (Works with Node 12) | Simple, single exe, works now | Larger file size, no installer |
| **Batch File** | Works immediately, simple | Less professional, requires Node.js installed on user's machine |

---

## 🎯 What I've Already Set Up

✅ Configured `package.json` with build scripts
✅ Created build configuration for Windows/Mac/Linux
✅ Set up `.gitignore` for build outputs
✅ Created `build/` folder for icons
✅ Added `BUILD.md` with detailed instructions

Everything is ready to go once you upgrade Node.js!

---

## 💡 Quick Decision Guide

**Choose Electron Builder if:**
- You want a professional installer
- You're distributing to non-technical users
- You want desktop shortcuts and uninstall support

**Choose pkg if:**
- You need something working immediately
- You want a single .exe file
- You're okay with a larger file size

**Keep the batch file if:**
- You're the only user
- Quick development iterations are important
- You don't mind running it from the command line

---

## Need Help?

Let me know which approach you want to take, and I can help you proceed!
