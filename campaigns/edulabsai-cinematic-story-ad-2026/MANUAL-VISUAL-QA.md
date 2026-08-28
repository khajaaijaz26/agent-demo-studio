# Manual visual and audio QA

Review date: 2026-08-28

Overall result: **PASS**

## Masters reviewed

- 3840×2160 landscape master, 30 fps, 95.873 seconds
- 1080×1920 vertical master, 30 fps, 95.873 seconds

## Visual review

- The opening sequence was reviewed at 0.0, 0.5, 1.0, 1.5, 2.0, 3.0, and 4.0 seconds. The orange mark performs one downward arrival, becomes the dominant centered object, introduces EDULABSAI below it, and settles without bouncing or drifting.
- Twelve encoded-video samples were reviewed in both formats in `VIDEO-CONTACT-SHEET-LANDSCAPE.png` and `VIDEO-CONTACT-SHEET-VERTICAL.png`.
- Full-resolution frames at 49 and 57 seconds confirm crisp resource cards, readable mobile headlines, large product close-ups, and unobstructed captions.
- The story reads in the intended order: fragmented teacher workflow, connected EdulabsAI reveal, classroom context, four aligned resources, teaching/export, students, evidence, families, CTA.
- Product interfaces, illustration subjects, headlines, captions, and CTA remain aligned. There is no collision, edge clipping, background shake, unintended zoom, or continuous floating.
- Product UI fills the useful mobile width rather than reproducing a tiny full desktop dashboard.
- Snap-and-Mark and Family Learning Digest are framed as teacher-controlled/consent-based beta workflows.

## Narration and timing review

- Each scene duration is calculated from its measured narration file plus a reading hold; narration was not time-compressed.
- Voice entries, visual layers, caption cues, and scene cuts share the same 95.824-second source timeline.
- The narration text matches the visible topic in all twelve scenes. The final encoded masters differ from the source timeline only by the expected final-frame/audio container rounding to 95.873 seconds.

## Music and signal review

- **Connected Light** is an original 48 kHz stereo procedural score using smooth pads, rounded low pulse, and a restrained soft-note melody.
- There are no samples, percussion hits, cymbal spikes, isolated sound effects, transition impacts, or abrupt music restarts.
- The final waveform and logarithmic spectrogram were visually inspected in `AUDIO-WAVEFORM.png` and `AUDIO-SPECTROGRAM.png`; they show continuous program audio without clipping blocks or isolated high-frequency spikes.
- Measured program loudness is -15.30 LUFS. Encoded true peak is -1.50 dBTP landscape and -1.49 dBTP vertical, within the AAC reconstruction tolerance around the -1.5 dBTP safety gate.
- No silence longer than 1.2 seconds and no unintended black hold longer than 0.35 seconds were detected.

## Automated release gate

`QA-REPORT.json` passes all 24 alignment assertions and every media check for both masters, including codecs, resolution, frame rate, duration, loudness, peak safety, black/silence scans, checksums, format parity, and GitHub file-size limits.
