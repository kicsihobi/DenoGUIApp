// embed_assets.ts
import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";


const HELP_MSG = `
Usage:
  deno run --allow-read --allow-write --allow-hrtime --unstable embed_assets.ts [options]

Options:
  --folder <path>      Root folder to embed assets from (default: .)
  --ignore <file>      Blacklist file (default: ignoreasset)
  --output, -o <file>  Output file (default: assets.ts, use "STDOUT" for console)
  --threads <n>        Number of compression workers (default: 4)
  --verbose, -v        Enable verbose debug output
  --help, -h           Show this help message
`;

const args = Deno.args;
if (args.includes("--help") || args.includes("-h")) {
  console.error(HELP_MSG);
  Deno.exit(0);
}

function getArg(flag: string, fallback: string): string {
  const idx = args.findIndex((x) => x === flag || x === flag.slice(0, 2));
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const verbose = args.includes("--verbose") || args.includes("-v");
const folder = getArg("--folder", ".");
const ignoreFile = getArg("--ignore", "ignoreasset");
const outputTarget = getArg("--output", "assets.ts");
const threadCount = parseInt(getArg("--threads", "4"), 10);

function detectMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "html": return "text/html; charset=utf-8";
    case "css": return "text/css";
    case "js": return "application/javascript";
    case "json": return "application/json";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "svg": return "image/svg+xml";
    case "ico": return "image/x-icon";
    case "woff": return "font/woff";
    case "woff2": return "font/woff2";
    case "ttf": return "font/ttf";
    case "otf": return "font/otf";
    case "txt": return "text/plain";
    case "webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function log(msg: string) {
  console.error(msg);
}
function debug(msg: string) {
  if (verbose) console.error(`[DEBUG] ${msg}`);
}

// -------- BLACKLIST --------
const blacklist = (() => {
  try {
    const content = Deno.readTextFileSync(`${folder}/${ignoreFile}`);
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    lines.push(ignoreFile);
    log(`📄 Using ignore list from: ${ignoreFile}`);
    return new Set(lines);
  } catch {
    log(`⚠️  No ignore file found, continuing without it.`);
    return new Set<string>([ignoreFile]);
  }
})();

function isBlacklisted(path: string): boolean {
  return [...blacklist].some((b) => path.includes(b));
}

// -------- FILE COLLECTION --------
const collected: { fullPath: string; relativePath: string }[] = [];

async function walk(current: string, base = "") {
  for await (const entry of Deno.readDir(current)) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = `${current}/${entry.name}`;
    if (isBlacklisted(rel)) {
      log(`✗ Skipped: ${rel}`);
      continue;
    }
    if (entry.isDirectory) {
      await walk(full, rel);
    } else {
      collected.push({ fullPath: full, relativePath: rel });
      log(`✓ Added:   ${rel}`);
    }
  }
}

await walk(folder);
log(`📦 Collected ${collected.length} files`);

// -------- WORKER SETUP --------
const workerSrc = `
  import { gzip } from "https://deno.land/x/compress@v0.4.5/mod.ts";
  self.onmessage = (e) => {
    const { relativePath, fileData, originalSize } = e.data;
    const gz = gzip(new Uint8Array(fileData));
    self.postMessage({ relativePath, gz, originalSize });
  };
`;

const workers = Array.from({ length: threadCount }, () =>
  new Worker(
    URL.createObjectURL(new Blob([workerSrc], { type: "application/javascript" })),
    { type: "module" }
  )
);

let taskIndex = 0;
function getNextWorker() {
  return workers[taskIndex++ % workers.length];
}

const pending: Promise<string>[] = [];
const outputChunks: string[] = [];
const assetMap: Record<string, string> = {}; // path → varname

const chunks = chunkArray(collected, threadCount);

for (const batch of chunks) {
  debug(`Processing batch of ${batch.length} files...`);

  const tasks = batch.map(async ({ fullPath, relativePath }) => {
    const bytes = await Deno.readFile(fullPath);
    const originalSize = bytes.length;

    return new Promise<string>((resolve) => {
      const worker = new Worker(
        URL.createObjectURL(new Blob([workerSrc], { type: "application/javascript" })),
        { type: "module" }
      );

      worker.onmessage = ({ data }) => {
        const varName = data.relativePath
          .replace(/\W+/g, "_")
          .replace(/^(\d)/, "_$1") + "_gz";

        assetMap[data.relativePath] = varName;

        debug(`Compressed ${data.relativePath} (${data.originalSize} → ${data.gz.length} bytes)`);

        const lines: string[] = [
          `// ${data.relativePath} (gzipped)`,
          `export const ${varName} = new Uint8Array([`,
        ];
        for (let i = 0; i < data.gz.length; i += 100) {
          lines.push("  " + data.gz.slice(i, i + 100).join(", ") + ",");
        }
        lines.push("]);\n");

        resolve(lines.join("\n"));
        worker.terminate();
      };

      worker.postMessage({ relativePath, fileData: bytes.buffer, originalSize }, [bytes.buffer]);
    });
  });

  const results = await Promise.all(tasks);
  outputChunks.push(...results);
}

const compressedSnippets = await Promise.all(pending);

outputChunks.push(...compressedSnippets);

outputChunks.push("export const STATIC_ASSETS : Record<string, { mime: string; data: Uint8Array }>  = {");

for (const [ relativePath, varName ] of Object.entries(assetMap)) {

  const mime = detectMimeType(relativePath);
  outputChunks.push(`  ${JSON.stringify(relativePath)}: {`);
  outputChunks.push(`    mime: ${JSON.stringify(mime)},`);
  outputChunks.push(`    data: ${varName}`);
  outputChunks.push(`  },`);
}
outputChunks.push("};\n");

const finalOutput = outputChunks.join("\n");

if (outputTarget === "STDOUT") {
  console.log(finalOutput);
  log("✅ Output written to STDOUT");
} else {
  await Deno.writeTextFile(outputTarget, finalOutput);
  log(`✅ Output written to ${outputTarget}`);
}

for (const worker of workers) {
  worker.terminate();
}
