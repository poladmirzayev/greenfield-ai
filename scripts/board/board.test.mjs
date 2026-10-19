import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  buildLookupQuery, buildProjectQuery, buildStatusMutation, classifyError, createBoard, findWinGetGh, loadCache, parseLookup, parseMaxWait, parseProject,
  parseRestItem, parseStatusField, projectRestPath, resolveNumbers,
} from './board.mjs';

const project = {
  number: 1, id: 'PVT_1', url: 'https://github.com/users/me/projects/1', owner: 'me',
  fields: { Status: { id: 'PVTSSF_1', options: { Todo: 'o1', 'In Progress': 'o2', 'In Review': 'o3', Done: 'o4' } } },
};
const repo = { owner: 'me', name: 'app' };
const NOW = 1_000_000_000_000;
const restFields = [{ id: 7, name: 'Status', data_type: 'single_select', options: ['Todo', 'In Progress', 'In Review', 'Done'].map((n, i) => ({ id: `o${i + 1}`, name: { raw: n } })) }];
const restItem = (number, status = 'Todo') => ({ id: number * 10, node_id: `PVTI_${number}`, content: { number, repository_url: 'https://api.github.com/repos/me/app' }, fields: [{ id: 7, value: { name: { raw: status } } }] });
const tmpCache = () => join(mkdtempSync(join(tmpdir(), 'board-test-')), 'cache.json');
const failure = (stderr) => Object.assign(new Error(`Command failed\n${stderr}`), { stderr });
const limits = (core, graphql) => ({ resources: { core, graphql } });

// A scripted gh: handlers receive args and return JSON; `calls` records "METHOD path" style keys.
function fakeGh(handlers) {
  const calls = [];
  const gh = (args, opts = {}) => {
    const key = args[0] === 'api' && args[1] === 'graphql' ? 'graphql' : args[0] === 'api' && args[1] === 'rate_limit' ? 'rate_limit' : args.includes('PATCH') ? 'patch' : args[1] === '--method' ? 'items' : 'fields';
    calls.push(key);
    const result = handlers[key]?.(args, opts, calls.filter((c) => c === key).length);
    if (result === undefined) throw failure(`unexpected ${key}`);
    return result;
  };
  return { gh, calls };
}

const makeBoard = (gh, extra = {}) => {
  const sleeps = [];
  const logs = [];
  const board = createBoard({ gh, project, repo, cachePath: tmpCache(), sleep: async (ms) => { sleeps.push(ms); }, now: () => NOW, log: (m) => logs.push(m), maxWaitSec: 900, ...extra });
  return { board, sleeps, logs };
};

test('classifyError recognises primary and secondary rate limits', () => {
  assert.equal(classifyError('gh: API rate limit exceeded for user ID 1. (HTTP 403)'), 'primary');
  assert.equal(classifyError('{"errors":[{"type":"RATE_LIMITED"}]}'), 'primary');
  assert.equal(classifyError('You have exceeded a secondary rate limit'), 'secondary');
  assert.equal(classifyError('Not Found (HTTP 404)'), null);
});

test('resolveNumbers accepts #n and n', () => {
  assert.deepEqual(resolveNumbers(['#77', '88']), [77, 88]);
  assert.throws(() => resolveNumbers(['nope']), /unknown issue number: "nope"/);
});

test('resolveNumbers rejects names, zero and numbers that are not safe integers', () => {
  for (const ref of ['constructor', '__proto__', 'toString', '#0', '0', '#99999999999999999999999', '#1e3', '#-1', '', '#']) {
    assert.throws(() => resolveNumbers([ref]), new RegExp(`unknown issue number: "${ref.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}"$`), ref);
  }
});

test('buildLookupQuery rejects numbers that are not safe positive integers', () => {
  for (const n of [0, -1, 1.5, 1e23, '7', NaN]) assert.throws(() => buildLookupQuery([n]), /invalid issue number/);
});

test('parseMaxWait falls back to the default with a warning for invalid values', () => {
  assert.deepEqual(parseMaxWait(undefined), { seconds: 900 });
  assert.deepEqual(parseMaxWait('120'), { seconds: 120 });
  assert.deepEqual(parseMaxWait('0'), { seconds: 0 });
  for (const bad of ['abc', '-5', 'Infinity']) {
    const r = parseMaxWait(bad);
    assert.equal(r.seconds, 900);
    assert.match(r.warning, /invalid BOARD_MAX_WAIT_SECONDS/);
  }
});

test('projectRestPath uses the owner type from the project url', () => {
  assert.equal(projectRestPath(project), 'users/me/projectsV2/1');
  assert.equal(projectRestPath({ ...project, url: 'https://github.com/orgs/acme/projects/3', owner: 'acme', number: 3 }), 'orgs/acme/projectsV2/3');
});

test('parseStatusField and parseRestItem read REST shapes', () => {
  assert.deepEqual(parseStatusField(restFields), { id: 7, options: { Todo: 'o1', 'In Progress': 'o2', 'In Review': 'o3', Done: 'o4' } });
  assert.throws(() => parseStatusField([]), /no single-select "Status" field/);
  assert.deepEqual(parseRestItem(restItem(5, 'Done'), 7), { id: 50, nodeId: 'PVTI_5', status: 'Done' });
  assert.equal(parseRestItem({ id: 1, fields: [] }, 7).status, null);
});

test('GraphQL builders batch with aliases and reject bad numbers', () => {
  const q = buildLookupQuery([97, 98]);
  assert.match(q, /i97:issue\(number:97\)/);
  assert.match(q, /i98:issue\(number:98\)/);
  assert.equal(q.match(/query\(/g).length, 1);
  assert.throws(() => buildLookupQuery(['1) { x }']), /invalid issue number/);
  const m = buildStatusMutation([{ projectId: 'P', itemId: 'I1', fieldId: 'F', optionId: 'O' }, { projectId: 'P', itemId: 'I2', fieldId: 'F', optionId: 'O' }]);
  assert.match(m, /^mutation\{m0:updateProjectV2ItemFieldValue\(input:\{projectId:"P",itemId:"I1",fieldId:"F",value:\{singleSelectOptionId:"O"\}\}\)/);
  assert.match(m, /m1:updateProjectV2ItemFieldValue/);
});

test('parseLookup picks the item of this project only', () => {
  const data = { data: { repository: {
    i1: { projectItems: { nodes: [{ id: 'X', project: { id: 'OTHER' } }, { id: 'A', project: { id: 'PVT_1' }, fieldValueByName: { name: 'Done' } }] } },
    i2: { projectItems: { nodes: [] } },
    i3: null,
  } } };
  assert.deepEqual(parseLookup(data, [1, 2, 3], 'PVT_1'), { 1: { nodeId: 'A', status: 'Done' } });
});

test('findWinGetGh finds the first GitHub.cli package that has gh.exe', () => {
  const exists = (p) => p.includes('GitHub.cli_B');
  const readdir = () => ['Other_X', 'GitHub.cli_A', 'GitHub.cli_B'];
  assert.match(findWinGetGh('C:\\L', { exists, readdir }), /GitHub\.cli_B.bin.gh\.exe$/);
  assert.equal(findWinGetGh(undefined), null);
  assert.equal(findWinGetGh('C:\\L', { exists: () => false, readdir: () => { throw new Error('ENOENT'); } }), null);
});

test('loadCache ignores other projects and corrupt files and only writes when touched', () => {
  const path = tmpCache();
  const a = loadCache(path, 'p1');
  a.save();
  assert.throws(() => readFileSync(path), /ENOENT/);
  a.data.items[1] = { id: 10 };
  a.touch();
  a.save();
  assert.deepEqual(loadCache(path, 'p1').data.items, { 1: { id: 10 } });
  assert.deepEqual(loadCache(path, 'p2').data.items, {});
  writeFileSync(path, '{not json');
  assert.deepEqual(loadCache(path, 'p1').data.items, {});
});

test('the cache is written atomically and leaves no temp file behind', () => {
  const path = tmpCache();
  const cache = loadCache(path, 'p1');
  cache.data.items[1] = { id: 10 };
  cache.touch();
  cache.save();
  assert.deepEqual(readdirSync(dirname(path)), ['cache.json']);
});

test('loadCache keeps the valid parts of a wrong-shaped cache and drops the rest', () => {
  const good = { id: 7, options: { Done: 'o4' } };
  const cases = [
    [{ statusField: good, items: null }, { statusField: good, items: {} }],
    [{ statusField: good, items: [1, 2] }, { statusField: good, items: {} }],
    [{ statusField: { id: 1 }, items: { 5: { id: 50 } } }, { statusField: null, items: { 5: { id: 50 } } }],
    [{ statusField: { id: '7', options: {} }, items: {} }, { statusField: null, items: {} }],
    [{ statusField: { id: 7, options: { Done: 4 } }, items: {} }, { statusField: null, items: {} }],
    [{ statusField: { id: 7, options: [] }, items: {} }, { statusField: null, items: {} }],
    [{ statusField: 'x', items: {} }, { statusField: null, items: {} }],
    [{ statusField: good, items: { 5: { id: '../x' }, 6: 'bad', 7: { id: 70, nodeId: 'a/b' }, abc: { id: 1 }, 8: { id: 80, nodeId: 'PVTI_8' } } }, { statusField: good, items: { 7: { id: 70 }, 8: { id: 80, nodeId: 'PVTI_8' } } }],
  ];
  for (const [input, expected] of cases) {
    const path = tmpCache();
    writeFileSync(path, JSON.stringify({ version: 1, projectKey: 'p1', ...input }));
    const { data } = loadCache(path, 'p1');
    assert.deepEqual({ statusField: data.statusField, items: data.items }, expected, JSON.stringify(input));
  }
  for (const raw of ['null', '[]', '"x"', '{"version":2}']) {
    const path = tmpCache();
    writeFileSync(path, raw);
    assert.deepEqual(loadCache(path, 'p1').data, { version: 1, projectKey: 'p1', statusField: null, items: {} });
  }
});

test('setStatus uses REST only, resolves the item once and then serves it from the cache', async () => {
  const patches = [];
  const { gh, calls } = fakeGh({
    fields: () => restFields,
    items: (args) => [restItem(97)].filter((i) => args.includes('q=97')),
    patch: (args, opts) => { patches.push([args.find((a) => a.includes('/items/')), JSON.parse(opts.input)]); return {}; },
  });
  const cachePath = tmpCache();
  const first = makeBoard(gh, { cachePath }).board;
  await first.setStatus([97], 'Done');
  await makeBoard(gh, { cachePath }).board.setStatus([97], 'In Review');
  assert.deepEqual(patches, [
    ['users/me/projectsV2/1/items/970', { fields: [{ id: 7, value: 'o4' }] }],
    ['users/me/projectsV2/1/items/970', { fields: [{ id: 7, value: 'o3' }] }],
  ]);
  assert.deepEqual(calls, ['fields', 'items', 'patch', 'patch']);
  assert.ok(!calls.includes('graphql'));
});

test('setStatus recovers from a stale cached item id', async () => {
  const cachePath = tmpCache();
  writeFileSync(cachePath, JSON.stringify({ version: 1, projectKey: project.url, statusField: parseStatusField(restFields), items: { 97: { id: 1 } } }));
  const patched = [];
  const { gh } = fakeGh({
    fields: () => restFields,
    items: () => [restItem(97)],
    patch: (args) => {
      const path = args.find((a) => a.includes('/items/'));
      if (path.endsWith('/1')) throw failure('gh: Not Found (HTTP 404)');
      patched.push(path);
      return {};
    },
  });
  await makeBoard(gh, { cachePath }).board.setStatus([97], 'Done');
  assert.deepEqual(patched, ['users/me/projectsV2/1/items/970']);
});

test('an issue the REST search misses is looked up through GraphQL before it is declared missing', async () => {
  const graphqlLookup = (nodes) => () => ({ data: { repository: { i113: { projectItems: { nodes } } } } });
  const missing = fakeGh({ fields: () => restFields, items: () => [], graphql: graphqlLookup([]) });
  const { board, sleeps } = makeBoard(missing.gh);
  await assert.rejects(board.setStatus([113], 'Done'), /issue #113 is not on the project/);
  assert.deepEqual(sleeps, []);
  assert.deepEqual(missing.calls, ['fields', 'items', 'graphql']);

  const mutations = [];
  const present = fakeGh({
    fields: () => restFields,
    items: () => [],
    graphql: (args) => {
      mutations.push(args.find((a) => a.startsWith('query=')));
      return args.some((a) => a.startsWith('query=query')) ? graphqlLookup([{ id: 'PVTI_113', project: { id: 'PVT_1' } }])() : { data: {} };
    },
  });
  await makeBoard(present.gh).board.setStatus([113], 'Done');
  assert.match(mutations[1], /itemId:"PVTI_113"/);
});

test('the GraphQL write reuses node ids from the cache', async () => {
  const queries = [];
  const { gh } = fakeGh({
    fields: () => { throw failure('API rate limit exceeded'); },
    rate_limit: () => limits({ remaining: 0, reset: NOW / 1000 + 600 }, { remaining: 4000, reset: NOW / 1000 + 600 }),
    graphql: (args) => { queries.push(args.find((a) => a.startsWith('query='))); return { data: {} }; },
  });
  const cachePath = tmpCache();
  writeFileSync(cachePath, JSON.stringify({ version: 1, projectKey: project.url, statusField: null, items: { 72: { nodeId: 'PVTI_72' }, 98: { nodeId: 'PVTI_98' } } }));
  const { board } = makeBoard(gh, { cachePath });
  await board.setStatus([72, 98], 'Done');
  assert.equal(queries.length, 1);
  assert.match(queries[0], /itemId:"PVTI_72".*itemId:"PVTI_98"/);
});

test('a rate-limited REST API falls back to one batched GraphQL mutation', async () => {
  const queries = [];
  const { gh } = fakeGh({
    fields: () => { throw failure('gh: API rate limit exceeded (HTTP 403)'); },
    rate_limit: () => limits({ remaining: 0, reset: NOW / 1000 + 600 }, { remaining: 4000, reset: NOW / 1000 + 3000 }),
    graphql: (args) => {
      const query = args.find((a) => a.startsWith('query=')).slice(6);
      queries.push(query);
      if (query.startsWith('query')) return { data: { repository: Object.fromEntries([97, 98].map((n) => [`i${n}`, { projectItems: { nodes: [{ id: `PVTI_${n}`, project: { id: 'PVT_1' } }] } }])) } };
      return { data: {} };
    },
  });
  const { board, sleeps, logs } = makeBoard(gh);
  await board.setStatus([97, 98], 'Done');
  assert.equal(queries.length, 2);
  assert.match(queries[1], /m0:.*itemId:"PVTI_97".*m1:.*itemId:"PVTI_98"/);
  assert.deepEqual(sleeps, []);
  assert.match(logs[0], /REST API: core budget exhausted, resets at 2001-09-09T01:56:40/);
});

test('when every API is exhausted it waits for the earliest reset and retries', async () => {
  let reset = false;
  const patches = [];
  const err = failure('API rate limit exceeded');
  const { gh } = fakeGh({
    fields: () => { if (!reset) throw err; return restFields; },
    items: () => [restItem(97)],
    patch: () => { patches.push(1); return {}; },
    rate_limit: () => limits({ remaining: 0, reset: NOW / 1000 + 120 }, { remaining: 0, reset: NOW / 1000 + 300 }),
    graphql: () => { throw err; },
  });
  const sleeps = [];
  const { board, logs } = makeBoard(gh, { sleep: async (ms) => { sleeps.push(ms); reset = true; } });
  await board.setStatus([97], 'Done');
  assert.deepEqual(sleeps, [122_000]);
  assert.deepEqual(patches, [1]);
  assert.ok(logs.some((l) => l.includes('waiting 122s')));
});

test('a wait beyond the bound fails with a message that names the reset time', async () => {
  const err = failure('API rate limit exceeded');
  const { gh } = fakeGh({
    fields: () => { throw err; },
    rate_limit: () => limits({ remaining: 0, reset: NOW / 1000 + 3600 }, { remaining: 0, reset: NOW / 1000 + 4000 }),
    graphql: () => { throw err; },
  });
  const { board, sleeps } = makeBoard(gh);
  await assert.rejects(board.setStatus([97], 'Done'), (e) => {
    assert.match(e.message, /rate limit: REST API: core budget exhausted, resets at 2001-09-09T02:46:40/);
    assert.match(e.message, /not waiting longer than 15 min/);
    return true;
  });
  assert.deepEqual(sleeps, []);
});

test('secondary rate limits back off for a minute and rejects unknown statuses', async () => {
  let n = 0;
  const { gh } = fakeGh({
    fields: () => restFields,
    items: () => [restItem(97, 'Done')],
    rate_limit: () => limits({ remaining: 4000, reset: NOW / 1000 + 30 }, { remaining: 4000, reset: NOW / 1000 + 30 }),
  });
  const wrapped = (args, opts) => {
    if (args.includes('PATCH') && n++ === 0) throw failure('You have exceeded a secondary rate limit');
    return args.includes('PATCH') ? {} : gh(args, opts);
  };
  const { board, sleeps } = makeBoard(wrapped);
  await board.setStatus([97], 'Done');
  assert.deepEqual(sleeps, [60_000]);
  await assert.rejects(board.setStatus([97], 'Finished'), /unknown status "Finished"/);
});

test('getStatus reads the current status back', async () => {
  const { gh } = fakeGh({ fields: () => restFields, items: (args) => [restItem(97, 'Done'), restItem(102, 'In Review')].filter((i) => args.includes(`q=${i.content.number}`)) });
  assert.deepEqual(await makeBoard(gh).board.getStatus([97, 102]), { 97: 'Done', 102: 'In Review' });
});

test('a cached Status field that REST rejects is dropped and re-fetched instead of falling back to GraphQL', async () => {
  const cachePath = tmpCache();
  writeFileSync(cachePath, JSON.stringify({ version: 1, projectKey: project.url, statusField: { id: 1, options: { Done: 'o4' } }, items: {} }));
  const patches = [];
  const { gh, calls } = fakeGh({
    fields: () => restFields,
    items: (args) => { if (args.includes('fields[]=1')) throw failure('gh: Field validation errors (HTTP 400)'); return [restItem(97)]; },
    patch: (args, opts) => { patches.push(JSON.parse(opts.input)); return {}; },
  });
  await makeBoard(gh, { cachePath }).board.setStatus([97], 'Done');
  assert.deepEqual(patches, [{ fields: [{ id: 7, value: 'o4' }] }]);
  assert.deepEqual(calls, ['items', 'fields', 'items', 'patch']);
  assert.equal(loadCache(cachePath, project.url).data.statusField.id, 7);
});

test('a cached Status field without the wanted option is refreshed once', async () => {
  const cachePath = tmpCache();
  writeFileSync(cachePath, JSON.stringify({ version: 1, projectKey: project.url, statusField: { id: 7, options: { Todo: 'o1' } }, items: {} }));
  const { gh, calls } = fakeGh({ fields: () => restFields, items: () => [restItem(97)], patch: () => ({}) });
  await makeBoard(gh, { cachePath }).board.setStatus([97], 'Done');
  assert.deepEqual(calls, ['fields', 'items', 'patch']);

});

test('a cached item id that REST rejects with 422 is re-resolved, also when reading', async () => {
  const cachePath = tmpCache();
  writeFileSync(cachePath, JSON.stringify({ version: 1, projectKey: project.url, statusField: parseStatusField(restFields), items: { 97: { id: 5 } } }));
  const { gh, calls } = fakeGh({
    fields: () => restFields,
    items: () => [restItem(97, 'Done')],
    patch: (args) => { if (args.some((a) => a.endsWith('/items/5'))) throw failure('gh: Unprocessable Entity (HTTP 422)'); return {}; },
  });
  const { board } = makeBoard(gh, { cachePath });
  await board.setStatus([97], 'Done');
  assert.deepEqual(calls, ['patch', 'fields', 'items', 'patch']);

  writeFileSync(cachePath, JSON.stringify({ version: 1, projectKey: project.url, statusField: { id: 3, options: { Done: 'o4' } }, items: {} }));
  const reader = fakeGh({ fields: () => restFields, items: (args) => { if (args.includes('fields[]=3')) throw failure('gh: Not Found (HTTP 404)'); return [restItem(97, 'Done')]; } });
  assert.deepEqual(await makeBoard(reader.gh, { cachePath }).board.getStatus([97]), { 97: 'Done' });
  assert.deepEqual(reader.calls, ['items', 'fields', 'items']);
});

test('invalid issue numbers are rejected before any request', async () => {
  const { gh, calls } = fakeGh({});
  const { board } = makeBoard(gh);
  await assert.rejects(board.setStatus([0], 'Done'), /invalid issue number: 0/);
  await assert.rejects(board.getStatus([1e23]), /invalid issue number/);
  assert.deepEqual(calls, []);
});

test('the GraphQL fallback looks up the project and its Status field once when the config has no ids', async () => {
  const queries = [];
  const projectData = { data: { user: { projectV2: { id: 'PVT_9', field: { id: 'PVTSSF_9', options: [{ id: 'a', name: 'Todo' }, { id: 'd', name: 'Done' }] } } } } };
  const { gh } = fakeGh({
    fields: () => { throw failure('API rate limit exceeded'); },
    rate_limit: () => limits({ remaining: 0, reset: NOW / 1000 + 600 }, { remaining: 4000, reset: NOW / 1000 + 600 }),
    graphql: (args) => {
      const query = args.find((a) => a.startsWith('query=')).slice(6);
      queries.push(query);
      if (query.includes('projectV2(number')) return projectData;
      if (query.startsWith('query')) return { data: { repository: { i5: { projectItems: { nodes: [{ id: 'PVTI_5', project: { id: 'PVT_9' } }] } } } } };
      return { data: {} };
    },
  });
  const { board } = makeBoard(gh, { project: { number: 1, url: project.url, owner: 'me' } });
  await board.setStatus([5], 'Done');
  assert.equal(queries.length, 3);
  assert.match(queries[2], /projectId:"PVT_9".*itemId:"PVTI_5".*fieldId:"PVTSSF_9".*singleSelectOptionId:"d"/);
});

test('parseProject and buildProjectQuery handle users and organisations and a missing Status field', () => {
  assert.match(buildProjectQuery('users'), /user\(login/);
  assert.match(buildProjectQuery('orgs'), /organization\(login/);
  const org = { data: { organization: { projectV2: { id: 'P', field: { id: 'F', options: [{ id: 'o', name: 'Todo' }] } } } } };
  assert.deepEqual(parseProject(org, 'orgs'), { id: 'P', fields: { Status: { id: 'F', options: { Todo: 'o' } } } });
  assert.throws(() => parseProject({ data: { user: { projectV2: { id: 'P', field: null } } } }, 'users'), /Status/);
});
