# Application Icons

This folder contains the application icons for different platforms.

## Required Icons

For a complete build, you need:

- **icon.ico** - Windows icon (256x256 recommended)
- **icon.icns** - macOS icon (512x512 recommended)
- **icon.png** - Linux icon (512x512 recommended)

## How to Create Icons

### Quick Option:
1. Create a 512x512 PNG image with your app icon
2. Use an online converter like:
   - https://cloudconvert.com/png-to-ico (for .ico)
   - https://cloudconvert.com/png-to-icns (for .icns)
3. Save the converted files to this folder

### Professional Option:
Use a tool like:
- **Windows**: IcoFX or GIMP
- **macOS**: Iconutil or Icon Composer
- **Cross-platform**: Electron Icon Builder

## Temporary Icon

For now, the build will work without icons, but you'll get a default Electron icon. 
Add your custom icons here before distributing your application.
