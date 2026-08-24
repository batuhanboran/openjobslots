const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const watchdog = fs.readFileSync(path.join(__dirname, "..", "worker-watchdog.sh"), "utf8");
assert.match(watchdog, /\.State\.Health\.Status/);
assert.match(watchdog, /unhealthy/);
assert.doesNotMatch(watchdog, /auto run summary/);
assert.doesNotMatch(watchdog, /45\s*\*\s*60/);

console.log("worker watchdog policy tests passed");
