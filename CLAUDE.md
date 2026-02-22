# CLAUDE.md — Project context for AI agents

## What this is

A CLI tool that uploads a directory of images to Cloudinary. Relative file paths become stable Cloudinary public IDs, enabling provider portability. A local manifest prevents redundant uploads.

## Implementation status

**Fully implemented.** All four phases complete:

1. Directory scanning + path mapping
2. Content hashing + manifest (`.cloudinary-manifest.json`)
3. Cloudinary upload integration (`cloudinary` v2 SDK)
4. Polish: `--force`, `--verbose`, `--root` flags; summary output; directory validation

## Architecture

- **Single file:** `cloudinary-embed.ts` — all logic lives here
- **No build step:** Node 24 runs `.ts` natively (`noEmit` in tsconfig)
- **Runtime:** Node.js 24+, Yarn 4, ES modules
- **Lint:** `yarn lint` runs `tsc` (type-check only) then `prettier --write .`

## CLI flags

| Flag                 | Required | Description                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `--directory <path>` | yes      | Directory to scan for images                                                     |
| `--root <path>`      | no       | Parent directory; computes public ID prefix via `path.relative(root, directory)` |
| `--force`            | no       | Re-upload all files, ignoring manifest hashes                                    |
| `--verbose`          | no       | After run, print `publicId → secureUrl` for all files                            |

## Key design decisions

**`folder` + `public_id` split on upload** (not just `public_id`):
Cloudinary's Dynamic folder mode doesn't create dashboard folders from slashes in `public_id` alone. We split: `folder: path.dirname(fullPublicId)` + `public_id: path.basename(fullPublicId)`. The stored public ID and URL are identical either way — this only affects Media Library folder navigation.

**Manifest keyed by relative path WITH extension** (`hero.png`, not `hero`):
`hero.png` and `hero.webp` are distinct files that both map to public ID `hero`. Keying by path-with-extension prevents collisions.

**Sequential uploads** (not parallel):
Simple, avoids Cloudinary rate limits, produces clear progress output.

**Save manifest after each upload:**
Crash resilience — next run skips already-uploaded files and resumes from the failure point.

**`overwrite: true` on every upload:**
Idempotent. Re-running always converges to the correct state on Cloudinary.

**`--root` uses `path.relative(root, directory)` as prefix:**
E.g. `--directory ../assets/Pictures/Web --root ../assets` → prefix = `Pictures/Web` → public ID = `Pictures/Web/filename`.

## Manifest schema

```typescript
interface ManifestEntry {
  contentHash: string; // SHA-256 hex of file contents
  uploadedAt: string; // ISO 8601
  secureUrl: string; // Cloudinary secure_url from upload result
}
interface Manifest {
  version: 1;
  files: Record<string, ManifestEntry>; // key = relative path WITH extension
}
```

Manifest file: `.cloudinary-manifest.json` written into the scanned `--directory`.

## Credentials

SDK auto-reads `CLOUDINARY_URL` env var. Format:

```
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
```

Tool exits with a clear error if not set.

## Common commands

```sh
# Lint (type-check + format)
yarn lint

# Upload (basic)
node cloudinary-embed.ts --directory ./your-images

# Upload with folder structure + verbose output
node cloudinary-embed.ts --directory ../assets/Pictures/Web --root ../assets --verbose

# Force re-upload everything
node cloudinary-embed.ts --directory ./your-images --force
```

## File map

| File                        | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `cloudinary-embed.ts`       | All implementation                                         |
| `package.json`              | Dependencies (`cloudinary`, `minimist`), scripts           |
| `tsconfig.json`             | Extends `@tsconfig/node24`; `noEmit`, `erasableSyntaxOnly` |
| `README.md`                 | User-facing docs: credentials, CLI usage, how it works     |
| `Development.md`            | Contributor setup: Node 24, Yarn, install                  |
| `.cloudinary-manifest.json` | Written into the scanned directory (not in this repo)      |
