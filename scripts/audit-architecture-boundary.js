const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER_INDEX_CAP = Number(process.env.OPENJOBSLOTS_SERVER_INDEX_LINE_CAP || 3000);
const SERVER_INDEX_FORBIDDEN_ATS_PATTERNS = Object.freeze([
  { name: "source_module_import", regex: /require\(["']\.\/ingestion\/sources\// },
  { name: "greenhouse_api_endpoint", regex: /boards-api\.greenhouse\.io/i },
  { name: "icims_public_portal_endpoint", regex: /\.icims\.com\/jobs\/search/i },
  { name: "greenhouse_rate_limit_constant", regex: /GREENHOUSE_RATE_LIMIT_WAIT_MS/ },
  { name: "icims_rate_limit_constant", regex: /ICIMS_RATE_LIMIT_WAIT_MS/ }
]);
const SERVER_INDEX_KNOWN_ATS_DEBT_PATTERNS = Object.freeze([
  { name: "legacy_dynamic_target_url", regex: /url_string:\s*["']https?:\/\/(?:www\.policeapp\.com|api\.k12jobspot\.com|api\.schoolspring\.com|calcareers\.ca\.gov|calopps\.org|statejobsny\.com)/i },
  { name: "legacy_usajobs_endpoint_constant", regex: /USAJOBS_SEARCH_API_URL/ },
  { name: "legacy_ats_alias_pattern", regex: /greenhouse\.io|icims\.com|ats\.rippling\.com/i }
]);
const SOURCE_MODULE_FORBIDDEN_IMPORT_PATTERNS = Object.freeze([
  { name: "server_index_import", regex: /require\(["'](?:\.\.\/){2,3}index["']\)/ }
]);
const SOURCE_COMMON_SOURCE_LOCAL_OWNERSHIP_PATTERNS = Object.freeze([
  { name: "careerspage_parser_import", regex: /require\(["']\.\/careerspage\/parse["']\)/ },
  { name: "careerspage_parser_spec", regex: /careerspage:\s*{[\s\S]*?parser:\s*\([^)]*\)\s*=>\s*parseCareerspagePostingsFromHtml/ },
  { name: "loxo_parser_import", regex: /require\(["']\.\/loxo\/parse["']\)/ },
  { name: "loxo_parser_spec", regex: /loxo:\s*{[\s\S]*?parser:\s*\([^)]*\)\s*=>\s*parseLoxoPostingsFromHtml/ }
]);

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
  const serverIndexText = readText("server/index.js");
  const serverIndexAtsHits = scanFiles(["server/index.js"], SERVER_INDEX_FORBIDDEN_ATS_PATTERNS);
  if (serverIndexAtsHits.length) {
    failures.push(`server/index.js contains ATS source implementation patterns: ${JSON.stringify(serverIndexAtsHits)}`);
  }
  const knownServerIndexDebt = SERVER_INDEX_KNOWN_ATS_DEBT_PATTERNS
    .filter((pattern) => pattern.regex.test(serverIndexText))
    .map((pattern) => pattern.name);
  if (knownServerIndexDebt.length) {
    warnings.push(`known debt: server/index.js still contains legacy ATS bootstrap/alias patterns (${knownServerIndexDebt.join(", ")})`);
  }

  const publicFiles = listTrackedFiles(["App.js", "src", "server/http", "README.md"]);
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
  const sourceLocalOwnershipHits = SOURCE_COMMON_SOURCE_LOCAL_OWNERSHIP_PATTERNS
    .filter((pattern) => pattern.regex.test(sourceCommon))
    .map((pattern) => ({ file: "server/ingestion/sources/common.js", pattern: pattern.name }));
  if (sourceLocalOwnershipHits.length) {
    failures.push(`source-local ATS parsers must stay out of common.js: ${JSON.stringify(sourceLocalOwnershipHits)}`);
  }
  const sourceFiles = listTrackedFiles(["server/ingestion/sources"]);
  const sourceImportHits = scanFiles(sourceFiles, SOURCE_MODULE_FORBIDDEN_IMPORT_PATTERNS);
  if (sourceImportHits.length) {
    failures.push(`source modules must not import server/index.js: ${JSON.stringify(sourceImportHits)}`);
  }

  const result = {
    ok: failures.length === 0,
    server_index_lines: serverIndexLines,
    server_index_cap: SERVER_INDEX_CAP,
    server_index_ats_boundary_hits: serverIndexAtsHits,
    source_local_ownership_hits: sourceLocalOwnershipHits,
    source_module_boundary_hits: sourceImportHits,
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
