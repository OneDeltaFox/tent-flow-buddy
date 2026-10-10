# GitHub Pages demo

This deployment is a static, browser-local demo, not a shared clinical system.
Use fictional patients only. There is no sign-in, server database, backup, or
cross-device synchronization. Clearing browser storage deletes that browser's
data. Existing localhost data is not copied to the hosted website.

## Deployment

In GitHub repository Settings > Pages, set Source to GitHub Actions.
The Deploy Pages demo workflow builds pull requests and deploys pushes to main.
It can also be run manually from Actions. Only the dist directory is uploaded.

Expected address: https://onedeltafox.github.io/tent-flow-buddy/

## Local verification

```sh
npm run build:pages
npx playwright test --config playwright.pages.config.ts
```

Set PLAYWRIGHT_CHANNEL=msedge to use an installed Edge browser on Windows.
The separate Pages entry/config preserves the original TanStack server build.
If the repository name or hosting path changes, update base in
vite.pages.config.ts. A custom domain at the site root needs base set to /.
