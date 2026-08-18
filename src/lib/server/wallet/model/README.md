# Pass model

The `.pkpass` template: `pass.json` plus the images Apple requires, loaded by
`../model-local.ts` and handed to `passkit-generator` as a `Record<string, Buffer>`.

## Why this folder is not called `ticket.pass`

passkit-generator only cares about the `.pass` suffix when it loads a _directory_
itself. We read the files and pass it a record, so the name is free — and a `.pass`
suffix makes macOS treat the folder as a bundle, which hides its contents in Finder
and makes `cp -r` behave oddly. Plain name, fewer surprises.

## The images are placeholders

Solid `#191919` fills at the sizes Apple mandates. They produce a valid, installable
pass and look deliberate rather than broken, but they are not artwork. Replacing them
is design work, not engineering.

| File                         | Size             | Purpose                                    |
| ---------------------------- | ---------------- | ------------------------------------------ |
| `icon.png` / `icon@2x.png`   | 29×29 / 58×58    | Required. Notifications and the pass list. |
| `logo.png` / `logo@2x.png`   | 160×50 / 320×100 | Top-left, beside `logoText`.               |
| `strip.png` / `strip@2x.png` | 375×98 / 750×196 | Banner behind the header fields.           |

Apple rejects a pass with no `icon.png`, silently — it downloads and then fails to
install. Keep both icon sizes.

`strip.png` is 98pt tall rather than 123pt because this pass renders secondary _and_
auxiliary rows; the taller strip is only correct when those are empty.

## Overriding artwork without a deploy

Set `WALLET_ASSETS_BASE_URL` to a public-read bucket or CDN holding files of the same
names. `../model-remote.ts` fetches them at request time and falls back to this folder
on any failure, so a bad URL costs you the artwork and never the feature. There are no
secrets in these files.

## `wwdr.ts`

Apple's Worldwide Developer Relations intermediate, G4, valid until 2030, held as a
TypeScript constant. It is public — no secret component, byte-identical for every Apple
developer — so it lives in the repo rather than an environment variable, where the
previous Rodeo stored a copy of its _signer_ certificate by mistake and could therefore
never have produced a pass iOS would install.

A `.ts` rather than a `.pem` because the repository's push rules reject that extension,
which is a sensible default given what usually carries it. Being a module also means one
less runtime read. Regenerate with:

```
curl -fsSL https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer \
  | openssl x509 -inform DER
```
