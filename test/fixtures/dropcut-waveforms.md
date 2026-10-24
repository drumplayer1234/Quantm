These are amplitude-only SoundCloud waveform fixtures, captured on 2026-10-23.
No audio, credentials, account data, or stream URLs are included. Each array has
450 integers: the mean of each four-bin group of the original 1,800-bin waveform,
rounded to the nearest height unit (height = 140). Times use the full track duration.
The production detector applies the same 450-bin averaging before section analysis.

The 21 track IDs were recovered from the tester's `dc-tracks-*.json` and the
`screen` results in its saved task output. Their public waveform URLs were resolved
through SoundCloud's track API, following `dropcut-drive.mjs`. The original
1,800-bin arrays were also screened before discarding them; all 19 electronic
tracks produced candidates and both acoustic controls produced none. The compact
fixture has the same track-level outcomes; rounding changes some candidate times.

This is the identifiable subset, including the screen's passing tracks, **not** a
representative re-run of all 174 or 156 search results. Those failed-result IDs and
waveforms were not saved, and the tester deleted its temporary profile. There are
no saved hardstyle or lofi controls. Genre families use titles/tags and the original
search context (Ray Keith is labeled DnB/jungle); they are reporting labels and are
never input to waveform detection. Positives are expected structural hints, not
manually annotated bass drops. Real-audio confirmation is still mandatory.

Run `node test/calibrate-dropcut.mjs` for per-track times and genre counts.

Pause behavior: a drop cut aborts to the outgoing deck, clears the effect graph and
all scheduled openings, pauses both streams, and resumes the outgoing song on Play.
That pair then uses an ordinary blend. Feedback delay contents and scheduled gates
cannot be frozen independently of the shared AudioContext. Suspending that context
and both independent media elements is not atomic, so preserving the roll's samples
and its precise landing would require a larger clock/transport change. This fallback
avoids resuming an expired roll or exposing the still-muted incoming song.
