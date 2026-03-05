# Contributing to Seeky

Thanks for your interest! Here's how to get started:

1. Fork the repo and create a branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Test it: `node index.js`
4. Open a PR with a clear description of what you changed and why

### Code style
- ES modules throughout (`import`/`export`)
- Keep the interactive UX consistent — use `inquirer` for menus, `ora` for spinners, `chalk` for color
- New features should degrade gracefully if system deps (mpv, ffmpeg) are missing

### Good first issues
Look for issues tagged `good first issue` in the Issues tab.
