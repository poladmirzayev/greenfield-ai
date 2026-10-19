#!/usr/bin/env node
// Project-board status tool (generic: edit board.json, nothing else). Needs `gh` logged in with scopes repo, project, read:org.
//
//   node scripts/board/cli.mjs status <#N[,#N]> <Todo|In Progress|In Review|Done>
//   node scripts/board/cli.mjs show <#N[,#N]>      read the status back
//   node scripts/board/cli.mjs add <#N[,#N]>       put new issues on the board (needed once per issue)
//
// status/show use the REST Projects API (0 GraphQL points), fall back to one batched GraphQL request, and on a rate limit
// wait for the reset (at most BOARD_MAX_WAIT_SECONDS, default 900). The id cache lives in the OS temp folder
// (board-cache.json; override with BOARD_CACHE). Details: .opencode/skills/dev-workflow/references/github-rate-limits.md
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUSES, createBoard, errorText, findWinGetGh, parseMaxWait, resolveNumbers } from './board.mjs';

// gh is looked up on PATH, then in the WinGet install folder; GH=<path> overrides.
const ghOnPath = () => { try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const GH = process.env.GH ?? (ghOnPath() ? 'gh' : (findWinGetGh(process.env.LOCALAPPDATA) ?? 'gh'));
const gh = (args, { json = false, input } = {}) => {
  const out = execFileSync(GH, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  return json ? JSON.parse(out) : out.trim();
};

const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'board.json'), 'utf8'));
const { owner, repo, project: number } = config;
const project = { owner, number, url: `https://github.com/${config.ownerType === 'org' ? 'orgs' : 'users'}/${owner}/projects/${number}` };

const { seconds: maxWaitSec, warning } = parseMaxWait(process.env.BOARD_MAX_WAIT_SECONDS);
if (warning) console.error(`[board] ${warning}`);
const board = () => createBoard({
  gh, project, repo: { owner, name: repo },
  cachePath: process.env.BOARD_CACHE ?? join(tmpdir(), 'board-cache.json'),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  maxWaitSec,
  log: (m) => console.error(`[board] ${m}`),
});

const [cmd, ...rest] = process.argv.slice(2);
const usage = {
  status: `status <#N[,#N]> <${STATUSES.join('|')}>`,
  show: 'show <#N[,#N]>',
  add: 'add <#N[,#N]>',
};
try {
  if (!usage[cmd] || rest.length < (cmd === 'status' ? 2 : 1)) { console.error(`usage: ${usage[cmd] ?? Object.values(usage).join('\n       ')}`); process.exit(2); }
  const numbers = resolveNumbers(rest[0].split(','));
  if (cmd === 'status') {
    const status = rest.slice(1).join(' ');
    await board().setStatus(numbers, status);
    for (const n of numbers) console.log(`#${n} -> ${status}`);
  } else if (cmd === 'show') {
    const statuses = await board().getStatus(numbers);
    for (const n of numbers) console.log(`#${n} ${statuses[n] ?? '(no status)'}`);
  } else {
    for (const n of numbers) {
      gh(['project', 'item-add', String(number), '--owner', owner, '--url', `https://github.com/${owner}/${repo}/issues/${n}`]);
      console.log(`#${n} added`);
    }
  }
} catch (e) { console.error(errorText(e).trim().split('\n')[0]); process.exit(1); }