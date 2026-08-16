/**
 * validator/checks/index.js
 * The five closed check kinds. No others exist.
 */

const file_exists = require("./file_exists");
const test_passes = require("./test_passes");
const test_suite_passes = require("./test_suite_passes");
const http_route = require("./http_route");
const lint_clean = require("./lint_clean");

const CHECKS = Object.freeze({
  file_exists,
  test_passes,
  test_suite_passes,
  http_route,
  lint_clean,
});

module.exports = { CHECKS };
