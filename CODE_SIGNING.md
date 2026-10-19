# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What gets signed

Windows releases of Quantm: the app itself (`Quantm.exe` and the files that ship with it), the installer (`Quantm-Setup-<version>.exe`) and the portable version (`Quantm-<version>-Portable.exe`).

Every signed file is built by GitHub Actions from this public repository, from a version tag, using the [release workflow](.github/workflows/release.yml). Nothing built on a personal computer is signed. Each signing request is approved by hand before it's signed.

## Team roles

- Committers and reviewers: [drumplayer1234](https://github.com/drumplayer1234)
- Approvers: [drumplayer1234](https://github.com/drumplayer1234)

## Privacy policy

Quantm does not collect, store or sell any personal data, and it has no analytics or tracking. It only connects to:

- **SoundCloud**, to sign in, browse, and play music with your own SoundCloud account. Your login stays on your computer, encrypted with your operating system's keychain.
- **GitHub**, to check for new versions of Quantm and download updates.
- **Discord**, only on your own computer and only when "Discord status" is on in Settings, to show what you're listening to.

Your settings, themes, cue points and listening position are stored only on your computer.
