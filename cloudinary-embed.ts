import fs from "node:fs/promises";
import { type Dirent } from "node:fs";
import crypto from "node:crypto";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".svg",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".ico",
  ".avif",
]);

interface ManifestEntry {
  contentHash: string;
  uploadedAt: string;
  secureUrl: string;
}

interface Manifest {
  version: 1;
  files: Record<string, ManifestEntry>;
}

function emptyManifest(): Manifest {
  return { version: 1, files: {} };
}

async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function loadManifest(manifestPath: string): Promise<Manifest> {
  try {
    const text = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(text) as Manifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyManifest();
    }
    console.warn(
      `Warning: manifest file is corrupted, starting fresh. (${String(err)})`,
    );
    return emptyManifest();
  }
}

async function saveManifest(
  manifestPath: string,
  manifest: Manifest,
): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

async function scanDirectory(directoryPath: string): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, {
    recursive: true,
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries as Dirent[]) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const relativePath = path.relative(
      directoryPath,
      path.join(entry.parentPath, entry.name),
    );
    files.push(relativePath);
  }
  return files;
}

function toPublicId(relativePath: string): string {
  const parsed = path.parse(relativePath);
  return path.join(parsed.dir, parsed.name);
}

export async function uploadToCloudinary(
  directoryPath: string,
  {
    force = false,
    verbose = false,
    useManifest = false,
    pathIdRoot: root,
  }: {
    force?: boolean;
    verbose?: boolean;
    useManifest?: boolean;
    pathIdRoot?: string;
  } = {},
) {
  const absoluteDir = path.resolve(directoryPath);
  const publicIdPrefix = root
    ? path.relative(path.resolve(root), absoluteDir)
    : "";

  // Validate directory exists
  try {
    const stat = await fs.stat(absoluteDir);
    if (!stat.isDirectory()) {
      console.error(`Error: ${directoryPath} is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(`Error: directory not found: ${directoryPath}`);
    process.exit(1);
  }

  // Validate Cloudinary credentials
  if (!process.env.CLOUDINARY_URL) {
    console.error(
      "Error: CLOUDINARY_URL environment variable is not set.\n" +
        "Set it like: CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name",
    );
    process.exit(1);
  }

  const manifestPath = path.join(absoluteDir, ".cloudinary-manifest.json");
  const manifest = useManifest
    ? await loadManifest(manifestPath)
    : emptyManifest();

  const files = await scanDirectory(absoluteDir);

  // Detect deleted files (only relevant with manifest)
  if (useManifest) {
    const fileSet = new Set(files);
    for (const key of Object.keys(manifest.files)) {
      if (!fileSet.has(key)) {
        console.log(`Deleted (removed from manifest): ${key}`);
        delete manifest.files[key];
      }
    }
  }

  const toUpload: Array<{
    relativePath: string;
    absolutePath: string;
    hash: string;
    reason: "new" | "changed";
  }> = [];

  for (const relativePath of files) {
    const absolutePath = path.join(absoluteDir, relativePath);

    if (!useManifest) {
      toUpload.push({ relativePath, absolutePath, hash: "", reason: "new" });
      continue;
    }

    const hash = await hashFile(absolutePath);
    const existing = manifest.files[relativePath];

    if (force || !existing) {
      toUpload.push({ relativePath, absolutePath, hash, reason: "new" });
    } else if (existing.contentHash !== hash) {
      toUpload.push({ relativePath, absolutePath, hash, reason: "changed" });
    }
  }

  const unchanged = files.length - toUpload.length;

  if (toUpload.length === 0) {
    console.log(`Done. 0 uploaded, ${unchanged} unchanged.`);
    if (useManifest) await saveManifest(manifestPath, manifest);
    if (verbose) {
      console.log();
      for (const relativePath of files) {
        const entry = manifest.files[relativePath];
        if (entry) {
          const publicId = path.join(publicIdPrefix, toPublicId(relativePath));
          console.log(`${publicId}  →  ${entry.secureUrl}`);
        }
      }
    }
    return;
  }

  let uploaded = 0;
  for (const { relativePath, absolutePath, hash, reason } of toUpload) {
    const publicId = path.join(publicIdPrefix, toPublicId(relativePath));
    console.log(`Uploading ${relativePath} (${reason})...`);
    try {
      const folderPart = path.dirname(publicId);
      const filenamePart = path.basename(publicId);
      const result = await cloudinary.uploader.upload(absolutePath, {
        ...(folderPart !== "." && { folder: folderPart }),
        public_id: filenamePart,
        overwrite: true,
        resource_type: "image",
      });
      if (useManifest) {
        manifest.files[relativePath] = {
          contentHash: hash,
          uploadedAt: new Date().toISOString(),
          secureUrl: result.secure_url,
        };
        await saveManifest(manifestPath, manifest);
      }
      uploaded++;
    } catch (err) {
      console.error(`Error uploading ${relativePath}: ${String(err)}`);
      if (useManifest) await saveManifest(manifestPath, manifest);
      process.exit(1);
    }
  }

  const newCount = toUpload.filter((f) => f.reason === "new").length;
  const changedCount = toUpload.filter((f) => f.reason === "changed").length;
  console.log(
    `Done. ${uploaded} uploaded (${newCount} new, ${changedCount} changed), ${unchanged} unchanged.`,
  );

  if (verbose) {
    console.log();
    for (const relativePath of files) {
      const entry = manifest.files[relativePath];
      if (entry) {
        const publicId = path.join(publicIdPrefix, toPublicId(relativePath));
        console.log(`${publicId}  →  ${entry.secureUrl}`);
      }
    }
  }
}

async function main() {
  const appArgs = await yargs(hideBin(process.argv))
    .usage("Usage: $0 --directory <path> [options]")
    .option("directory", {
      alias: "d",
      type: "string",
      demandOption: true,
      describe: "Directory to scan for images",
    })
    .option("root", {
      alias: "r",
      type: "string",
      describe: "Parent directory for computing public ID prefix",
    })
    .option("manifest", {
      alias: "m",
      type: "boolean",
      default: false,
      describe:
        "Save .cloudinary-manifest.json to skip unchanged files on next run",
    })
    .option("force", {
      alias: "f",
      type: "boolean",
      default: false,
      describe: "Re-upload all files, ignoring manifest hashes (requires -m)",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      default: false,
      describe: "Print publicId → secureUrl mapping after upload",
    })
    .alias("h", "help")
    .epilog(
      "Examples:\n" +
        "  Given: ./images/trips/spain/ronda.jpg\n\n" +
        "  $0 -d ./images\n" +
        "    → public ID: trips/spain/ronda\n" +
        "    → https://res.cloudinary.com/<cloud>/image/upload/trips/spain/ronda.jpg\n\n" +
        "  $0 -r ./images/trips -d ./images/trips/spain\n" +
        "    Scans only spain/, -r adds spain/ prefix to public IDs\n" +
        "    → public ID: spain/ronda\n" +
        "    → https://res.cloudinary.com/<cloud>/image/upload/spain/ronda.jpg\n\n" +
        "  $0 -d ./images -m\n" +
        "    Save manifest to skip unchanged files on next run\n\n" +
        "  $0 -d ./images -m -f -v\n" +
        "    Re-upload all files (ignore manifest) and print URLs",
    )
    .version(false)
    .strict()
    .parse();

  await uploadToCloudinary(appArgs.directory, {
    force: appArgs.force,
    verbose: appArgs.verbose,
    useManifest: appArgs.manifest,
    pathIdRoot: appArgs.root,
  });
}

// Only run main if this is the entry point
if (import.meta.filename === process.argv[1]) {
  await main();
}
