/** Shared helpers for the arm64 (Arm MRS) dataset pipeline. */
const fs = require("fs");

/** 1-space indent, ASCII-escaped, no trailing newline (same style as the x86 dataset). */
function serialize(obj) {
  return JSON.stringify(obj, null, 1).replace(/[\u007f-￿]/g, function (c) {
    return "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
  });
}
function loadJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

module.exports = { serialize: serialize, loadJSON: loadJSON };
