# Contributing to Quantm

Thanks for helping out! This guide covers how to run the app, how the code is laid out, and how to send changes.

## Running it

```bash
npm install
npm start
```

There is no build step for day-to-day work. The renderer is plain vanilla JavaScript loaded directly by Electron, so edit a file and restart with `npm start` if a change doesn't show up.

## Code layout

- `main.js` is the Electron main process. It owns windows, sign-in, token storage and the SoundCloud API proxy.
- `preload.js` exposes the `window.native` bridge. Add new main-process features here and in `main.js`.
- `src/js/` holds the renderer modules. `api.js` talks to SoundCloud, `store.js` holds app state, and `player.js` handles playback.
- `src/js/views/` holds one module per page. Each view exports a `render(page, params, query)` function. `page` is an element to fill, `params` holds route parameters such as an ID, and `query` holds query-string values. A view may return a cleanup function, which the router calls when the user leaves the page. Use `src/js/views/feed.js` as the reference.
- Register a new view in the route table in `src/js/app.js`.
- `src/styles/` holds the CSS. Put page-specific styles in `src/styles/views/`.

### Conventions

- **Colors go through CSS variables only.** Use the tokens defined on `:root` in `src/styles/app.css`, such as `--bg`, `--surface`, `--text`, `--muted` and `--accent`. Themes work by overriding these variables, so a hard-coded color will not follow the user's theme.
- **Talk to SoundCloud through `window.native.api`.** Requests go through the main process so the login token never reaches the page. Don't call SoundCloud directly from the renderer.
- **No build step.** Keep the renderer as plain ES modules and vanilla JavaScript. Please don't add a bundler or framework without discussing it first.
- Keep changes focused. A bug fix shouldn't also reformat unrelated files.

## Reporting bugs and suggesting features

Open an issue on the repository's GitHub page. For bugs, include your operating system, the Quantm version (from `package.json`), and the steps to reproduce the problem. Screenshots help too.

## Sending a pull request

1. Fork the repository and create a branch for your change.
2. Make your change and check that `npm start` runs and the affected pages work, in both the default theme and a custom one.
3. Open a pull request that describes what changed and why. Link any related issue.

By contributing, you agree that your changes are released under the project's [GPL-3.0](LICENSE) license.
