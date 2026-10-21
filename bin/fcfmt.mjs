#!/usr/bin/env node
/**
 * @fileoverview Command-line interface executable entrypoint for FC Formatter v5.
 */

import { runCli } from "../src/cli.mjs";

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
