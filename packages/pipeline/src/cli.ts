#!/usr/bin/env node
import { parseArgs, buildConfig, printHelp } from "./config.js";
import { runPipeline } from "./pipeline.js";
import { logError } from "./logger.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  let config;
  try {
    config = buildConfig(args);
  } catch (err) {
    logError("Config", err);
    printHelp();
    process.exit(1);
  }

  try {
    await runPipeline(config);
  } catch (err) {
    logError("Pipeline failed", err);
    process.exit(1);
  }
}

main();
