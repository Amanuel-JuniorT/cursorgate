"use strict";
const path = require("path");

const daemonRoot = path.resolve(__dirname, "..", "..", "daemon");

function daemonRequire(rel) {
  return require(path.join(daemonRoot, rel));
}

module.exports = { daemonRoot, daemonRequire };
