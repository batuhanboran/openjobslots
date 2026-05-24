const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER_INDEX_CAP = Number(process.env.OPENJOBSLOTS_SERVER_INDEX_LINE_CAP || 5000);

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function lineCount(relativePath) {
  const text = readText(relativePath);
  if (!text) return 0;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const content = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return content ? content.split("\n").filter((line) => line.trim()).length : 0;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function listTrackedFiles(paths) {
  return git(["ls-files", ...paths]).split(/\r?\n/).filter(Boolean);
}

function scanFiles(files, patterns) {
  const hits = [];
  for (const file of files) {
    const text = readText(file);
    for (const pattern of patterns) {
      if (pattern.regex.test(text)) hits.push({ file, pattern: pattern.name });
    }
  }
  return hits;
}

function main() {
  const json = process.argv.includes("--json");
  const remotes = git(["remote", "-v"]);
  const failures = [];
  const warnings = [];

  if (/batuhanboran\/OpenJobSlots/i.test(remotes)) {
    failures.push("git remotes must not point at batuhanboran/OpenJobSlots");
  }
  if (!/batuhanboran\/openjobslots/i.test(remotes)) {
    failures.push("origin must point at batuhanboran/openjobslots");
  }

  const serverIndexLines = lineCount("server/index.js");
  if (serverIndexLines > SERVER_INDEX_CAP) {
    failures.push(`server/index.js has ${serverIndexLines} lines, above cap ${SERVER_INDEX_CAP}`);
  }

  const publicFiles = listTrackedFiles(["App.js", "src", "server/http", "docs-site", "README.md"]);
  const leakHits = scanFiles(publicFiles, [
    { name: "windows_private_user_path", regex: /C:\\Users\\BaronPC/i },
    { name: "production_checkout_path", regex: /\/root\/OpenJobSlots/i },
    {
      name: "dotenv_secret_name_with_value",
      regex: /(TOKEN|SECRET|PASSWORD|MEILI_MASTER_KEY|DATABASE_URL)\s*=\s*['"][^'"]+['"]/i
    }
  ]);
  if (leakHits.length) failures.push(`public surface leak patterns: ${JSON.stringify(leakHits)}`);

  const sourceCommon = readText("server/ingestion/sources/common.js");
  if (/require\(["']\.\.\/\.\.\/index["']\)/.test(sourceCommon)) {
    warnings.push("known debt: server/ingestion/sources/common.js still imports ../../index for legacy collector fallback");
  }

  const result = {
    ok: failures.length === 0,
    server_index_lines: serverIndexLines,
    server_index_cap: SERVER_INDEX_CAP,
    failures,
    warnings
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`server/index.js lines: ${serverIndexLines}/${SERVER_INDEX_CAP}`);
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    for (const failure of failures) console.error(`failure: ${failure}`);
  }

  if (!result.ok) process.exit(1);
}

main();
