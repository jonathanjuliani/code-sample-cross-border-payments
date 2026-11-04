#!/usr/bin/env node
import { execSync } from 'node:child_process';

try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
} catch {
  // No git in the environment (Docker build) — skip hooks setup.
}
