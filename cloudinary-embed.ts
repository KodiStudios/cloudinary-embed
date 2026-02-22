import fs, { type Dirent } from "node:fs";
import minimist from "minimist";
import path from "node:path";

export async function uploadToCloudinary(directoryPath: string) {}

async function main() {
  // Connect to Cloudinary Api
  // Arguments: --directoryPath
  await uploadToCloudinary(".");
}

// Only run main if this is the entry point
if (import.meta.filename === process.argv[1]) {
  await main();
}
