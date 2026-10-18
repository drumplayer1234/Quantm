# Soundnode

A sleek, themeable SoundCloud desktop client for Windows, macOS and Linux.

![Screenshot](docs/screenshot.png)

## Features

- **Sign in inside the app.** Log in with your SoundCloud account in a built-in sign-in window.
- **Home and discover.** Shelves of music picked for you, plus your **Feed** of new posts from people you follow.
- **Library.** Your likes, playlists, albums, stations, listening history and who you follow.
- **Trending and genres.** Browse what's popular, filtered by genre.
- **Full search.** Find tracks, people, albums and playlists, or paste a SoundCloud link to jump straight to it.
- **Artist profiles.** Tracks, reposts, albums, playlists and followers for every artist.
- **Track pages.** Waveform display and timed comments, so you can see what people said at each moment.
- **Playlists.** Create and edit playlists, reorder them, and add or remove tracks.
- **Add to playlist from the player bar.** Save the track that's playing in one click.
- **Queue.** See what's next and drag tracks to reorder them.
- **Playback controls.** Shuffle, repeat, and autoplay of related tracks when your queue runs out.
- **Media keys and system controls.** Use your keyboard's media keys, and the Windows and macOS media controls.
- **Desktop notifications.** Get notified about new activity.
- **Keyboard shortcuts.** Control playback without leaving the keyboard.
- **Themes.** Fully custom colors, with presets, and import and export so you can share your own.

## Download

Grab the latest build from the **Releases** page of this repository on GitHub:

- **Windows:** the `.exe` installer, or the portable version if you don't want to install anything.
- **macOS:** the `.dmg` disk image.
- **Linux:** the `AppImage` (runs anywhere) or the `.deb` package (Debian and Ubuntu).

## Signing in

1. Click **Sign in with SoundCloud**.
2. Log in the way you normally would, including with Google, Apple or Facebook if you use those.
3. Soundnode closes the sign-in window once it's connected.

Your login token is stored on your computer, encrypted with Electron's `safeStorage` where your operating system supports it. It is only ever sent to SoundCloud.

If the sign-in window doesn't work for you, choose **Enter a token manually** on the sign-in screen. You'll need two values from your browser's developer tools while signed in at soundcloud.com:

- The value of the `oauth_token` cookie.
- The `client_id`, a 32-character string that appears in SoundCloud's API requests.

## Build from source

You'll need [Node.js](https://nodejs.org/) 18 or newer (Node 20 is what the release builds use).

```bash
npm install        # install dependencies
npm start          # run Soundnode from source
```

To create installers:

```bash
npm run dist         # build for the current operating system
npm run dist:win     # Windows installer and portable build
npm run dist:mac     # macOS .dmg
npm run dist:linux   # Linux AppImage and .deb
```

Output goes to the `dist/` folder.

## Project structure

```
main.js                 Electron main process: windows, sign-in, token storage, API proxy
preload.js              The only bridge between the app page and the main process
src/
  index.html            App shell
  vendor/hls.min.js     hls.js, for HLS streams (Apache-2.0)
  js/
    app.js              Startup, login screen, app shell, keyboard shortcuts
    api.js              SoundCloud api-v2 client
    player.js           Audio playback, queue and HLS streams
    playerbar.js        The player bar at the bottom of the window
    store.js            App state: likes, playlists, following and more
    theme.js            Theme engine: presets, custom colors, import and export
    router.js           Hash-based router
    ui.js               Shared UI components
    dom.js              Small DOM helpers
    icons.js            Icon set
    views/              One module per page (home, feed, library, search, ...)
  styles/
    app.css             Base styles, layout and theme variables
    views/              Styles for each page
```

## Disclaimer

Soundnode is an unofficial project. It is not affiliated with, endorsed by, or sponsored by SoundCloud.

Soundnode uses SoundCloud's web API, which SoundCloud can change or restrict at any time. If that happens, parts of the app may stop working until it's updated.

Please respect the artists whose music you listen to, and follow SoundCloud's terms of use.

## Credits

- The original **Soundnode** was created by Michael Lancaster and contributors. This project is a fork and rewrite of [soundnode-app](https://github.com/Soundnode/soundnode-app).
- [hls.js](https://github.com/video-dev/hls.js) by Dailymotion, licensed under Apache-2.0, plays HLS streams.
- Built on [Electron](https://www.electronjs.org/).

## Contributing

Bug reports, feature ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

Soundnode is free software licensed under the [GNU General Public License v3.0](LICENSE). You can redistribute it and/or modify it under the terms of that license.
