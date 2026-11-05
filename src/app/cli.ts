#!/usr/bin/env node
import { run } from '../features/cli/run';

await run(process.argv.slice(2));
