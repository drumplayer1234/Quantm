**🚫 No ads**: no audio ads, banners or promoted tracks. Free and open source.

## What's new in 1.2.0

- **Auto mix.** Quantm can now blend your songs like a DJ. It's off by default: turn it on in Settings → Auto mix, or in Settings → Playback → Crossfade.
- **Beat-matched transitions.** Quantm listens to each song's kick and snare to find its tempo and beat, quietly pre-plays the next song for a few seconds to learn it, then starts it on the beat. It matches tempos up to 8% apart (half and double time too, like 87 into 174 BPM) and keeps the beats locked through the mix.
- **The blend.** The next song comes up with its bass cut, the bass swaps over one bar in the middle, then the old song fades out. Mixes last 16, 32 or 64 beats, up to 24 seconds. Songs without a clear beat get a normal blend.
- **It learns your songs.** Every song it plays is remembered: tempo, beat, where the drums come in and where the outro starts. Later mixes go over the real outro and land the next song's drums on the bass swap. Until a song has been heard, Quantm guesses its tempo from SoundCloud's BPM field, the title, tags or description, or failing those, its waveform.
- **It learns your taste.** Each mix tries a small variation of length, blend style and tempo stretch, separately for slow, mid, fast and very fast music. Keep the song and it nudges toward that. Skip during or right after the mix and it nudges away. It's slow by design, and Settings → Auto mix has a reset.
- **Watch it work.** Settings → Auto mix shows it live: what it hears, the planned mix and a countdown, the beat lock in milliseconds, what it has learned per tempo range, and an activity feed.
- **Mix order.** With Auto mix on, the shuffle button (or S) cycles off, shuffle and Mix order. Mix order sorts your queue like a DJ set, so each song blends into the next. "Mix from here" in a track's right-click menu starts a set from that song, Autoplay picks the related songs that blend best, and the queue shows each blend ("122 → 124 BPM").
- **Smoother volume between songs.** Each song keeps its own loudness during a crossfade, so the old song no longer gets louder or quieter as it fades. Songs Quantm hasn't heard before start at your usual level instead of full volume, and small corrections glide instead of jumping.
- **New color themes.** Tokyo Night (Night, Storm, Day), Rosé Pine (Main, Moon, Dawn), Gruvbox (Dark, Light), Sodium (Underpass, Blue Hour, Last Tram), Nord (Dark, Light) and Catppuccin (Latte, Frappé, Macchiato, Mocha). Each family is one card, and you pick the flavor with swatches.
- **New makeovers.** Risograph (two-color zine print), Chrome (hyperpop liquid chrome), Rave Flyer (photocopied 90s flyer), Blueprint (engineering drawing), Ink Wash (Paper and Night), LED Board (dot-matrix display in Amber, Green or Red), Tiling (tiling-window desktop), Glitch (datamosh), Vapor Mall (vaporwave) and Felt (soft and tactile, in Moss or Burgundy).
- **New theme packs.** They go beyond colors and react to the music, and most reshape Home: Twin Deck (two turntables that show Auto mix at work), Cassette, Holo Card, Sunrise, Signal Route (your queue as a transit map), Sampler (a 4x4 pad grid of your queue), Patchbay, Contour (a terrain map unique to each song), Spectral Ledger (a scrolling spectrogram) and Warehouse (a rave spectrum wall).
- **Themes react to Auto mix.** Themes can follow the beat, the mix progress and the bass swap. The theme gallery is also tidier, with sections for Colors, Makeovers and Theme packs.
- **Discord status while idle.** "Playing Quantm" stays up while the app is open, showing Browsing, or Paused and the song, plus a Get Quantm button. Turn it off in Settings → Playback → Discord status while not playing.
- **Crash logs.** If Quantm crashes, Settings → About → Open crash logs shows what happened. Logs stay on your computer, and you can attach crash.log to a GitHub issue.
- **The player bar fits narrow and zoomed-in windows.**
- **Tip:** if animated themes stand still, Windows animations are probably off. Settings → Appearance → Theme effects → On turns them on for Quantm.

## What's new in 1.1.7

- **Easier manual sign-in.** If the normal sign-in doesn't work for you, "Enter a token manually" now only needs your oauth_token. Leave the client_id empty and Quantm finds one itself.

## What's new in 1.1.6

- **See-through window on Windows 11** stays see-through after you minimize Quantm and bring it back, instead of turning black.

## What's new in 1.1.5

- **Player bar buttons work in smaller windows.** In windows narrower than about 1180 pixels (common on laptops with display scaling), the speed, EQ and more buttons didn't respond to clicks. Fixed for every theme.
- **See-through window on Windows 11** no longer turns black after maximizing.
- **Snap to screen edges in see-through mode.** Drag Quantm to the top of the screen to maximize it, to a side for half the screen, or to a corner for a quarter.

## What's new in 1.1.4

- **Shuffle really covers everything.** Shuffling Likes or a big playlist now loads the whole list first, so even the first song can come from anywhere in it.
- **Artist stations.** Start a station from any artist page.
- **Back and forward on Mac.** Cmd+[ and Cmd+], trackpad swipes, and mouse side-button tools like Sensible Side Buttons now work.
- **Full-size artwork.** Click the big cover on a track, playlist or artist page to see it at its original size.

## What's new in 1.1.3

- **Quantm has a new home:** https://github.com/quantm-app/Quantm. Old links still work, and updates keep arriving automatically.

## What's new in 1.1.2

- **Your settings stay put through updates.** If Quantm was still open when an update installed, recent changes to your theme and settings could be lost. Quantm now keeps a backup of them and restores anything that went missing.

## What's new in 1.1.1

- **Quantm playlists.** Playlists saved on your computer with instant adds and removes, drag to reorder, and export/import. Copy any SoundCloud playlist into Quantm with one click.
- **Equalizer and sleep timer.** A 5-band equalizer with presets, and a sleep timer that fades out after a set time or at the end of the song.
- **Listening stats.** Hours, plays, streaks, top tracks, artists and genres, badges, and a shareable stats card. Counted on your computer only.
- **Overhaul themes:** Listening Room, Pocket Quantm and Terminal Multiplexer, plus Theme effects (Auto/On/Off) in Settings → Appearance.
- **New makeover themes:** Brutalist, Vinyl, Frutiger Aero, Terminal and Windows 98.
- **Intel Macs** get their own download next to Apple Silicon.
- Quantm can no longer open off-screen or invisible, and copy-protected songs show a lock with **Open in SoundCloud** everywhere.

## What's new in 1.1

- **Automatic updates.** From now on Quantm updates itself (Settings → About). Coming from 1.0.x? Install this version once with the Setup file below; after that, updates arrive on their own.
- **Cue points and custom DJ transitions.** Press **O** where a song should mix out and **I** where the next one should come in, or edit any transition from the queue. Press **C** to add cue points and **1–9** to jump to them.
- **Offline downloads.** Tracks whose artist allows downloads can be saved in the original quality and played with no internet (Library → Offline).
- **New themes:** Hextech, OLED, E-ink, Industrial and Album Match (the whole app takes its colors from the song's artwork).
- **Windows 11:** the see-through Liquid Glass window now works, with Acrylic and Mica options and rounded corners.
- **Copy-protected label songs** are marked with a lock and have an **Open in SoundCloud** button (Quantm can't play those).
- Queue fixes, better security, starting without internet no longer signs you out, and lower memory use.

## Which file should I download?

- **Windows:** `Quantm-Setup-VERSION.exe` ⭐ **recommended** — installs Quantm with shortcuts and an uninstaller.
  - `Quantm-VERSION-Portable.exe` — runs without installing (starts a little slower).
- **macOS:** the `.dmg` disk image: `Quantm-VERSION-arm64.dmg` for Apple Silicon (M1 and newer) or `Quantm-VERSION-x64.dmg` for Intel Macs.
- **Linux:** the `.AppImage` (runs anywhere) or the `.deb` (Debian/Ubuntu)

Windows may show "Windows protected your PC" because the installer isn't signed yet: click **More info → Run anyway**.
