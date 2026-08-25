import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = resolve(root, "src", "studio", "public");
const destination = resolve(root, "dist", "studio", "public");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
