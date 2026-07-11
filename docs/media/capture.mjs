#!/usr/bin/env node
// Regenerates every asset in docs/media/ from the real running app.
//
//   node docs/media/capture.mjs
//
// Thin launcher around the Playwright capture suite at
// frontend/tests/media/capture.spec.ts (which boots the Vite dev server
// itself via Playwright's webServer). See docs/media/README.md for what each
// asset shows and the determinism guarantees.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const frontendDir = resolve(repoRoot, 'frontend')

const result = spawnSync(
  'npx',
  ['playwright', 'test', '--config', 'tests/media/playwright.config.ts'],
  {
    cwd: frontendDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
)

process.exit(result.status ?? 1)
