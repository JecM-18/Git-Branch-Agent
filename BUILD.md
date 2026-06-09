# Building the Application

This document explains how to build and distribute the Git Branch Agent as a standalone application.

## Prerequisites

- Node.js and npm installed
- All dependencies installed (`npm install`)

## Build Commands

### Windows Executable
To build a Windows installer and portable executable:
```bash
npm run build
```

This creates:
- **NSIS Installer** (.exe installer with install wizard)
- **Portable Version** (.exe that runs without installation)

Both will be in the `dist/` folder.

### All Platforms
To build for Windows, macOS, and Linux:
```bash
npm run build:all
```

Note: Building for macOS requires a Mac, and building for Linux is best done on Linux.

## Output

After building, you'll find in the `dist/` folder:
- `Git Branch Agent Setup 1.0.0.exe` - Windows installer
- `Git Branch Agent 1.0.0.exe` - Portable Windows executable
- Other platform-specific builds (if built with `build:all`)

## Distribution

### Portable Version (Easiest)
The portable .exe file can be:
- Run directly without installation
- Copied to any folder
- Shared with others (they just double-click to run)

### Installer Version (Professional)
The NSIS installer .exe:
- Installs to Program Files
- Creates desktop and start menu shortcuts
- Can be uninstalled from Windows Settings
- Better for professional distribution

## Important Notes

1. **First Run**: Users will still need to configure the .env file with their:
   - GitHub token
   - Jira credentials
   - Repository information

2. **Icons**: Add custom icons to the `build/` folder before building for a professional look.

3. **Code Signing**: For public distribution, consider code signing the executable to avoid Windows SmartScreen warnings.

## Running Without Building

You can still run in development mode:
```bash
npm start
```

Or use the batch file:
```bash
Start App.bat
```
