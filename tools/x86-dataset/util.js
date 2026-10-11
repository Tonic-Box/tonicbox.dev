/** Shared helpers for the dataset pipeline. */
const fs = require("fs");

/** Serialize matching the dataset's original style: 1-space indent, ASCII-escaped, no trailing newline. */
function serialize(obj) {
  return JSON.stringify(obj, null, 1).replace(/[\u007f-￿]/g, function (c) {
    return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Map a felix URL to its cache slug. MUST match fetch-sources.js. */
function felixSlug(u) {
  return u
    .replace(/^https?:\/\/www\.felixcloutier\.com\/x86\//, "")
    .replace(/:/g, "__")
    .replace(/[^a-z0-9_-]/gi, "_");
}

module.exports = { serialize: serialize, loadJSON: loadJSON, felixSlug: felixSlug };
