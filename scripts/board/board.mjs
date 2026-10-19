// Project-board status moves for scripts/board/cli.mjs, kept free of side effects on import so it can be tested.
//
// Cost model (measured on 2026-10-13): `gh project item-list --limit 1000` costs ~100 GraphQL points per call and the
// token is shared by every developer (5000 points/hour), so a handful of status moves exhausted the budget. We use
//   1. the REST Projects API (`users/{owner}/projectsV2/...`): 0 GraphQL points, counts against the separate core budget;
//   2. a GraphQL fallback that batches every issue lookup and every mutation into one aliased request (~1 point each).
// On a rate limit we read the reset time from `gh api rate_limit` (free) and wait, bounded, before retrying.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const STATUSES = ['Todo', 'In Progress', 'In Review', 'Done'];
export const DEFAULT_MAX_WAIT_SEC = 15 * 60;
const MAX_ATTEMPTS = 4;
const SECONDARY_BACKOFF_SEC = 60;
// REST answers that mean "an id we sent is wrong", i.e. a stale or damaged cache entry.
const STALE_CACHE_ERROR = /\(HTTP (400|404|422)\)|Not Found/i;

export const errorText = (e) => [e?.stderr, e?.stdout, e?.message].filter(Boolean).join('\n');

// 'primary' = quota exhausted, 'secondary' = abuse/burst limit.
export function classifyError(text) {
  if (/secondary rate limit|abuse detection/i.test(text)) return 'secondary';
  if (/rate limit|RATE_LIMITED|HTTP 429/i.test(text)) return 'primary';
  return null;
}

export function parseMaxWait(value, fallback = DEFAULT_MAX_WAIT_SEC) {
  if (value === undefined || value === '') return { seconds: fallback };
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return { seconds };
  return { seconds: fallback, warning: `ignoring invalid BOARD_MAX_WAIT_SECONDS="${value}", using ${fallback}` };
}

const isIssueNumber = (n) => Number.isSafeInteger(n) && n > 0;

export function resolveNumbers(refs) {
  return refs.map((ref) => {
    const number = /^#?\d+$/.test(ref) ? Number(ref.replace('#', '')) : NaN;
    if (!isIssueNumber(number)) throw new Error(`unknown issue number: "${ref}"`);
    return number;
  });
}

export function projectRestPath(project) {
  const kind = /\/orgs\//.test(project.url ?? '') ? 'orgs' : 'users';
  return `${kind}/${project.owner}/projectsV2/${project.number}`;
}

const optionName = (n) => (typeof n === 'string' ? n : (n?.raw ?? null));

export function parseStatusField(restFields) {
  const f = restFields.find((x) => x.name === 'Status' && x.data_type === 'single_select');
  if (!f) throw new Error('project has no single-select "Status" field');
  return { id: f.id, options: Object.fromEntries((f.options ?? []).map((o) => [optionName(o.name), o.id])) };
}

export function parseRestItem(item, fieldId) {
  const status = optionName(item.fields?.find((f) => f.id === fieldId)?.value?.name);
  return { id: item.id, nodeId: item.node_id, status };
}

const assertNumbers = (numbers) => {
  for (const n of numbers) if (!isIssueNumber(n)) throw new Error(`invalid issue number: ${n}`);
};
const lit = (s) => JSON.stringify(String(s));

export function buildLookupQuery(numbers) {
  assertNumbers(numbers);
  const issues = numbers.map((n) => `i${n}:issue(number:${n}){projectItems(first:10){nodes{id project{id} fieldValueByName(name:"Status"){...on ProjectV2ItemFieldSingleSelectValue{name}}}}}`);
  return `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${issues.join(' ')}}}`;
}

export function parseLookup(data, numbers, projectId) {
  const found = {};
  for (const n of numbers) {
    const node = data?.data?.repository?.[`i${n}`]?.projectItems?.nodes?.find((x) => x.project?.id === projectId);
    if (node) found[n] = { nodeId: node.id, status: node.fieldValueByName?.name ?? null };
  }
  return found;
}

export function buildStatusMutation(updates) {
  const calls = updates.map((u, i) => `m${i}:updateProjectV2ItemFieldValue(input:{projectId:${lit(u.projectId)},itemId:${lit(u.itemId)},fieldId:${lit(u.fieldId)},value:{singleSelectOptionId:${lit(u.optionId)}}}){projectV2Item{id}}`);
  return `mutation{${calls.join(' ')}}`;
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Keeps only the parts of a parsed cache file that have the expected shape; anything else is dropped and re-resolved.
export function sanitizeCache(raw, projectKey) {
  const empty = { version: 1, projectKey, statusField: null, items: {} };
  if (!isPlainObject(raw) || raw.version !== 1 || raw.projectKey !== projectKey) return empty;
  const field = raw.statusField;
  const fieldOk = isPlainObject(field) && isIssueNumber(field.id) && isPlainObject(field.options) && Object.values(field.options).every((v) => typeof v === 'string');
  const items = {};
  for (const [key, v] of Object.entries(isPlainObject(raw.items) ? raw.items : {})) {
    if (!/^[1-9]\d*$/.test(key) || !isPlainObject(v)) continue;
    const entry = {};
    if (isIssueNumber(v.id)) entry.id = v.id;
    if (typeof v.nodeId === 'string' && /^[\w-]+$/.test(v.nodeId)) entry.nodeId = v.nodeId;
    if (Object.keys(entry).length) items[key] = entry;
  }
  return { version: 1, projectKey, statusField: fieldOk ? { id: field.id, options: { ...field.options } } : null, items };
}

// Small JSON cache (Status field id and options, REST and GraphQL item ids) so repeated moves skip lookups.
export function loadCache(path, projectKey) {
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { raw = null; }
  const data = sanitizeCache(raw, projectKey);
  let dirty = false;
  return {
    data,
    touch: () => { dirty = true; },
    save() {
      if (!dirty) return;
      const tmp = `${path}.${process.pid}.tmp`;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
        renameSync(tmp, path);
      } catch { rmSync(tmp, { force: true }); /* the cache is an optimisation only */ }
      dirty = false;
    },
  };
}

export function findWinGetGh(localAppData, { exists = existsSync, readdir = readdirSync } = {}) {
  if (!localAppData) return null;
  const packages = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const dir of readdir(packages)) {
      if (!dir.startsWith('GitHub.cli_')) continue;
      const exe = join(packages, dir, 'bin', 'gh.exe');
      if (exists(exe)) return exe;
    }
  } catch { /* no WinGet install */ }
  return null;
}

// One query for the project node id and its Status field (only the GraphQL fallback needs them).
export function buildProjectQuery(kind) {
  const root = kind === 'orgs' ? 'organization' : 'user';
  return `query($owner:String!,$number:Int!){${root}(login:$owner){projectV2(number:$number){id field(name:"Status"){...on ProjectV2SingleSelectField{id options{id name}}}}}}`;
}

export function parseProject(data, kind) {
  const p = data?.data?.[kind === 'orgs' ? 'organization' : 'user']?.projectV2;
  if (!p?.id || !p.field?.id) throw new Error('project or its single-select "Status" field not found');
  return { id: p.id, fields: { Status: { id: p.field.id, options: Object.fromEntries((p.field.options ?? []).map((o) => [o.name, o.id])) } } };
}

// Fatal: the issue really is not on the project, so no other API will find it.
class NotOnProject extends Error {
  constructor(number) { super(`issue #${number} is not on the project`); this.fatal = true; }
}

function restEngine({ gh, project, repo, cache }) {
  const base = projectRestPath(project);
  const repoSuffix = `/repos/${repo.owner}/${repo.name}`;
  const statusField = () => {
    if (!cache.data.statusField) {
      cache.data.statusField = parseStatusField(gh(['api', `${base}/fields?per_page=100`], { json: true }));
      cache.touch();
    }
    return cache.data.statusField;
  };
  // The search is by text, so it can return other issues (and only the first 100 results). A miss is therefore not
  // fatal here: the next engine decides whether the issue is really missing.
  const find = (number) => {
    const field = statusField();
    const items = gh(['api', '--method', 'GET', `${base}/items`, '-f', 'per_page=100', '-f', `q=${number}`, '-f', `fields[]=${field.id}`], { json: true });
    const hit = items.find((it) => it.content?.number === number && it.content.repository_url?.endsWith(repoSuffix));
    if (!hit) throw new Error(`REST search did not return issue #${number}`);
    const item = parseRestItem(hit, field.id);
    cache.data.items[number] = { id: item.id, nodeId: item.nodeId };
    cache.touch();
    return item;
  };
  const patch = (itemId, field, optionId) => gh(['api', '--method', 'PATCH', `${base}/items/${itemId}`, '--input', '-'], { input: JSON.stringify({ fields: [{ id: field.id, value: optionId }] }) });
  const forget = (number) => {
    cache.data.statusField = null;
    delete cache.data.items[number];
    cache.touch();
  };
  const usesCache = (number) => cache.data.statusField !== null || cache.data.items[number] !== undefined;
  // Runs fn; if it fails because a cached id is wrong, drops those cache entries and runs it once more.
  const healing = (number, fn) => {
    const cached = usesCache(number);
    try {
      return fn();
    } catch (e) {
      if (!cached || !(e.staleCache || STALE_CACHE_ERROR.test(errorText(e)))) throw e;
      forget(number);
      return fn();
    }
  };
  return {
    name: 'REST',
    resource: 'core',
    read: (numbers) => Object.fromEntries(numbers.map((n) => [n, healing(n, () => find(n).status)])),
    write(updates) {
      for (const { number, status } of updates) {
        healing(number, () => {
          const field = statusField();
          const optionId = field.options[status];
          if (!optionId) throw Object.assign(new Error(`project has no "${status}" Status option`), { staleCache: true });
          patch(cache.data.items[number]?.id ?? find(number).id, field, optionId);
        });
      }
    },
  };
}

function graphqlEngine({ gh, project, repo, cache }) {
  const request = (query) => gh(['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${repo.owner}`, '-f', `name=${repo.name}`], { json: true });
  let resolved = project.id && project.fields?.Status ? project : null;
  const resolve = () => {
    if (!resolved) {
      const kind = /\/orgs\//.test(project.url ?? '') ? 'orgs' : 'users';
      const data = gh(['api', 'graphql', '-f', `query=${buildProjectQuery(kind)}`, '-f', `owner=${project.owner}`, '-F', `number=${project.number}`], { json: true });
      resolved = { ...project, ...parseProject(data, kind) };
    }
    return resolved;
  };
  const nodeIds = (numbers) => {
    const known = (n) => cache.data.items[n]?.nodeId;
    const missing = numbers.filter((n) => !known(n));
    const found = missing.length ? parseLookup(request(buildLookupQuery(missing)), missing, resolve().id) : {};
    for (const n of missing) {
      if (!found[n]) throw new NotOnProject(n);
      cache.data.items[n] = { ...cache.data.items[n], nodeId: found[n].nodeId };
      cache.touch();
    }
    return Object.fromEntries(numbers.map((n) => [n, known(n)]));
  };
  return {
    name: 'GraphQL',
    resource: 'graphql',
    read(numbers) {
      const found = parseLookup(request(buildLookupQuery(numbers)), numbers, resolve().id);
      return Object.fromEntries(numbers.map((n) => { if (!found[n]) throw new NotOnProject(n); return [n, found[n].status]; }));
    },
    write(updates) {
      const { id: projectId, fields } = resolve();
      const status = fields.Status;
      const ids = nodeIds(updates.map((u) => u.number));
      const batch = updates.map((u) => {
        if (!status.options[u.status]) throw new Error(`project has no "${u.status}" Status option`);
        return { projectId, itemId: ids[u.number], fieldId: status.id, optionId: status.options[u.status] };
      });
      request(buildStatusMutation(batch));
    },
  };
}

function readLimits(gh) {
  try { return gh(['api', 'rate_limit'], { json: true }).resources; } catch { return null; }
}

function toRateLimit(env, error, engine, attempt) {
  if (!classifyError(errorText(error))) return null;
  const limit = readLimits(env.gh)?.[engine.resource];
  const exhausted = limit?.remaining === 0;
  const waitSec = exhausted ? Math.max(2, Math.ceil(limit.reset - env.now() / 1000) + 2) : SECONDARY_BACKOFF_SEC * (attempt + 1);
  const resetAt = new Date(exhausted ? limit.reset * 1000 : env.now() + waitSec * 1000).toISOString();
  const what = exhausted ? `${engine.resource} budget exhausted, resets at ${resetAt}` : `secondary rate limit, retry after ${resetAt}`;
  return { engine: engine.name, waitSec, message: `${engine.name} API: ${what} (in ${Math.ceil(waitSec / 60)} min)` };
}

// Runs op on the first engine that works. If every engine that fails is rate limited, waits (bounded by maxWaitSec in
// total) for the earliest reset and tries again.
async function run(env, op, args) {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    const limited = [];
    let failure;
    for (const engine of env.engines) {
      try {
        return engine[op](...args);
      } catch (e) {
        if (e.fatal) throw e;
        const limit = toRateLimit(env, e, engine, attempt);
        if (limit) { limited.push(limit); env.log(limit.message); } else { failure = e; env.log(`${engine.name} API failed: ${errorText(e).split('\n')[0]}`); }
      }
    }
    if (!limited.length) throw failure;
    const next = limited.reduce((a, b) => (b.waitSec < a.waitSec ? b : a));
    if (attempt + 1 >= MAX_ATTEMPTS || waited + next.waitSec > env.maxWaitSec) {
      throw new Error(`GitHub rate limit: ${next.message}; not waiting longer than ${Math.round(env.maxWaitSec / 60)} min (waited ${Math.round(waited / 60)} min so far). Retry later.`);
    }
    env.log(`waiting ${next.waitSec}s for the earliest reset`);
    await env.sleep(next.waitSec * 1000);
    waited += next.waitSec;
  }
}

export function createBoard({ gh, project, repo, cachePath, sleep, now = Date.now, log = console.error, maxWaitSec = DEFAULT_MAX_WAIT_SEC, engines }) {
  const cache = loadCache(cachePath, `${project.url}`);
  const deps = { gh, project, repo, cache };
  const env = { gh, now, sleep, log, maxWaitSec, engines: engines ?? [restEngine(deps), graphqlEngine(deps)] };
  return {
    async setStatus(numbers, status) {
      if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}" (expected ${STATUSES.join(' | ')})`);
      assertNumbers(numbers);
      try { await run(env, 'write', [numbers.map((number) => ({ number, status }))]); } finally { cache.save(); }
    },
    async getStatus(numbers) {
      assertNumbers(numbers);
      try { return await run(env, 'read', [numbers]); } finally { cache.save(); }
    },
  };
}
