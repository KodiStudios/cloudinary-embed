# cloudinary-embed

Uploads a directory of images to Cloudinary using relative file paths as stable public IDs. A local manifest (`.cloudinary-manifest.json`) tracks uploads so only new or changed files are uploaded on subsequent runs.

## Credentials

Find Cloudinary **Api Key** and **Secret** Values:  
[Cloudinary Console](https://console.cloudinary.com/) under **Dashboard → API Keys**.

Set the `CLOUDINARY_URL` environment variable before running:

```sh
export CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
```

## Execute

```sh
node cloudinary-embed.ts --directory ./your-images
```

## How it works

- Scans `--directory` recursively for image files (`.jpg`, `.png`, `.webp`, `.svg`, etc.)
- Computes a SHA-256 hash of each file
- Compares against `.cloudinary-manifest.json` in the target directory
- Uploads only new or changed files; skips unchanged files
- Saves the manifest after each upload so a failed run resumes where it left off

## Path to public ID mapping

The relative file path (without extension) becomes the Cloudinary public ID:

| File             | Public ID    | Cloudinary URL                                                   |
| ---------------- | ------------ | ---------------------------------------------------------------- |
| `blog/hero.png`  | `blog/hero`  | `https://res.cloudinary.com/{cloud}/image/upload/blog/hero.png`  |
| `icons/logo.svg` | `icons/logo` | `https://res.cloudinary.com/{cloud}/image/upload/icons/logo.svg` |

## Manifest

`.cloudinary-manifest.json` is written to the target directory. Add it to `.gitignore` or commit it — your choice.

## Development

See [Development.md](Development.md) for prerequisites and setup instructions.
