# Licensing and media provenance

Agent Demo Studio source code is available under the MIT License. The MIT License covers this repository's code; it does **not** grant rights to media that a user supplies, records, downloads, generates, or publishes.

## Project assets

Before publishing, confirm rights for every:

- Screen recording and visible product/customer data
- Video clip, image, screenshot, logo, and illustration
- Music track, sound effect, and voice recording
- Font or other brand asset
- AI-generated asset whose provider terms affect commercial use

Use the manifest `licenses` array and each asset's `licenseId` to keep provenance beside the edit. Every creator render generates `ASSET-LICENSES.md`; undeclared assets are clearly marked for review.

```json
{
  "licenses": [
    {
      "id": "music-01",
      "source": "./music/launch.wav",
      "title": "Launch bed",
      "creator": "Example Composer",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "attribution": "Launch bed — Example Composer — CC BY 4.0",
      "proofUrl": "https://example.com/license-receipt"
    }
  ]
}
```

## Generated ambient music

The bundled ambient-score and ASMR-soundscape generators synthesize waveform data
locally from code in this repository and do not sample a recorded song or sound
library. Their output is intended to be usable with the rendered project. Users
remain responsible for checking whether a similar melody or local legal restriction
affects their use.

## Bundled synthetic artwork

Version 0.3 includes two fictional photoreal presenter cutouts, two original
fictional 3D-cartoon hosts, and four original scene backgrounds. They were created
with Codex's built-in image-generation mode for this project and are redistributed
under the repository's MIT License. Their source prompts, checksums, and explicit
fictional/synthetic status are recorded in [`assets/README.md`](../assets/README.md).

The project automatically writes license records when a `builtin:` asset is used.
Preserve `syntheticCharacters` metadata and add platform-required disclosure. Do
not describe a bundled presenter as a real customer, employee, expert, or endorser.

## Voice and likeness

Only use a voice, voice model, or likeness when you have permission. Disclose
synthetic media where a platform or jurisdiction requires it. Do not use this
project to impersonate a person, mislead viewers, or bypass consent. The bundled
characters use animated still-image motion and do not include cloned voices or
phoneme-level lip synchronization.

## Contributions

Do not commit private recordings, production credentials, unlicensed music, or media copied from a third-party product. Small fixtures should be original, generated, public domain, or compatible with redistribution, and their provenance should be documented.
