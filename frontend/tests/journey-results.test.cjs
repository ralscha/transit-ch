const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the pure TypeScript mapping with the existing compiler dependency.
// Angular and the browser are deliberately not needed for these data tests.
function load(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const execute = vm.runInThisContext(`(function(require, module, exports) {${outputText}\n})`, {
    filename,
  });
  execute(
    (name) => load(path.resolve(path.dirname(filename), name + '.ts')),
    module,
    module.exports,
  );
  return module.exports;
}
const { nextDepartures } = load(
  path.resolve(__dirname, '../src/app/destination/journey-results.ts'),
);
const base = Date.parse('2026-10-11T12:00:00Z');
const at = (minutes) => new Date(base + minutes * 60000).toISOString();
const station = (id, name = id) => ({ id, name, coordinate: { x: 47.37, y: 8.54 } });

function connection({
  id = 'trip',
  from = 'A',
  departure = 10,
  arrival = 30,
  walk = 5,
  changes = 0,
  category = 'S',
} = {}) {
  const board = { station: station(from), departure: at(departure), platform: '4' };
  const alight = { station: station('destination'), arrival: at(arrival) };
  const result = {
    from: { station: station('position'), departure: at(departure - walk) },
    to: alight,
    transfers: changes,
    sections: [
      {
        departure: { departure: at(departure - walk) },
        arrival: { station: station(from), arrival: at(departure) },
        walk: { duration: walk * 60 },
      },
      {
        departure: board,
        arrival: alight,
        journey: { name: id, category, number: '5', to: 'Beyond the destination' },
      },
    ],
  };
  return result;
}

test('five departures globally, ordered by first vehicle time rather than walk, arrival, or station', () => {
  const data = [
    connection({ id: 'sixth', from: 'A', departure: 6, arrival: 8 }),
    connection({ id: 'third', from: 'A', departure: 3, arrival: 20, walk: 2 }),
    connection({ id: 'second', from: 'B', departure: 2, arrival: 29, walk: 0 }),
    connection({ id: 'fifth', from: 'C', departure: 5, arrival: 9, walk: 4 }),
    connection({ id: 'first', from: 'C', departure: 1, arrival: 45, walk: 0 }),
    connection({ id: 'fourth', from: 'B', departure: 4, arrival: 10 }),
  ];
  const result = nextDepartures(data, base);
  assert.deepEqual(
    result.map((item) => item.departure),
    [1, 2, 3, 4, 5].map((minutes) => base + minutes * 60000),
  );
  assert.deepEqual(
    result.map((item) => item.stationId),
    ['C', 'B', 'A', 'B', 'C'],
  );
});

test('all five may be from one station', () => {
  const result = nextDepartures(
    Array.from({ length: 7 }, (_, i) => connection({ id: String(i), departure: i + 1 })),
    base,
  );
  assert.equal(result.length, 5);
  assert.ok(result.every((item) => item.stationId === 'A'));
});

test('transfer alternatives share one departure and prefer earliest arrival, then fewer changes', () => {
  const result = nextDepartures(
    [
      connection({ arrival: 40, changes: 1 }),
      connection({ arrival: 30, changes: 2 }),
      connection({ arrival: 30, changes: 1 }),
    ],
    base,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].arrival, base + 30 * 60000);
  assert.equal(result[0].transfers, 1);
});

test('live departure and platform override the plan, with initial walking time kept separate', () => {
  const delayed = connection({ departure: -1, arrival: 15, walk: 7 });
  delayed.sections[1].departure.prognosis = { departure: at(3), platform: '8' };
  const result = nextDepartures([delayed], base, { latitude: 47.37, longitude: 8.54 });
  assert.equal(result[0].departure, base + 3 * 60000);
  assert.equal(result[0].scheduledDeparture, base - 60000);
  assert.equal(result[0].platform, '8');
  assert.equal(result[0].walkingMinutes, 7);
  assert.equal(result[0].distanceMeters, 0);
});

test('expired, invalid, and walking-only routes do not fill departure slots', () => {
  const invalid = connection();
  invalid.sections[1].departure.departure = 'not a date';
  const walkOnly = connection();
  walkOnly.sections.pop();
  assert.deepEqual(
    nextDepartures([connection({ departure: -1 }), invalid, walkOnly, {}], base),
    [],
  );
});

test('complete transfer and walking legs retain platform information, including ship departures', () => {
  const item = connection({ changes: 1, category: 'BAT' });
  item.sections.push({
    departure: { station: station('interchange'), departure: at(20), platform: 'B' },
    arrival: { station: station('destination'), arrival: at(30) },
    journey: { name: 'bus', category: 'B', number: '31', to: 'destination' },
  });
  const [result] = nextDepartures([item], base);
  assert.equal(result.mode, 'boat');
  assert.equal(result.transfers, 1);
  assert.deepEqual(
    result.legs.map((item) => item.kind),
    ['walk', 'ride', 'ride'],
  );
  assert.equal(result.legs[2].mode, 'bus');
  assert.equal(result.legs[2].stationId, 'interchange');
  assert.equal(result.legs[2].platform, 'B');
});
