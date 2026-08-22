'use strict';

// Regression coverage for the hole-forming paths uncovered while
// investigating #8134.
//
// A "hole" is a revision `n` whose `pad:<id>:revs:<n>` record is absent
// while `pad:<id>` still claims `head >= n`. A holed pad cannot be replayed,
// so deleteRevisions() refuses to touch it and full compaction is the only
// recovery. These tests pin the two guarantees that keep cleanup from
// punching new holes when a write fails part-way through:
//
//   - deleteRevisions() writes the rebuilt history before moving `head` onto
//     it, so a failed revision write leaves `head` on the old, intact
//     history instead of pointing past a gap; and
//   - a stale in-memory Pad object can no longer append past the rewritten
//     head and punch a run of holes.

const assert = require('assert').strict;
const common = require('../common');
const padManager = require('../../../node/db/PadManager');
const db = require('../../../node/db/DB');
const settings = require('../../../node/utils/Settings');
const {deleteRevisions} = require('../../../node/utils/Cleanup');

const missingRevs = async (padId: string) => {
  const rec = await db.get(`pad:${padId}`);
  const missing = [];
  for (let r = 0; r <= rec.head; r++) {
    if (await db.get(`pad:${padId}:revs:${r}`) == null) missing.push(r);
  }
  return {head: rec.head, missing};
};

describe(__filename, function () {
  let backup: boolean;
  before(async function () {
    await common.init();
    backup = settings.cleanup.enabled;
    settings.cleanup.enabled = true;
  });
  after(function () { settings.cleanup.enabled = backup; });

  it('a failed write during deleteRevisions leaves no holes', async function () {
    const padId = common.randomString();
    const pad = await padManager.getPad(padId);
    for (let i = 0; i < 12; i++) await pad.appendText(`line ${i}\n`);

    // Fail one of the rewrite writes. `head` must not move onto the rebuilt
    // history, so the old (intact) history stays in place.
    const realSet = db.set;
    db.set = async (key: string, value: unknown) => {
      if (key === `pad:${padId}:revs:2`) throw new Error('boom');
      return await realSet(key, value);
    };
    let threw = false;
    try {
      await deleteRevisions(padId, 3);
    } catch { threw = true; } finally { db.set = realSet; }

    padManager.unloadPad(padId);
    const state = await missingRevs(padId);
    assert.ok(threw, 'expected deleteRevisions to surface the failed write');
    assert.deepEqual(state.missing, [], 'a failed write must not leave holes');
  });

  it('a stale in-memory pad cannot punch holes after a failed cleanup',
      async function () {
        const padId = common.randomString();
        const pad = await padManager.getPad(padId);
        for (let i = 0; i < 12; i++) await pad.appendText(`line ${i}\n`);

        // Fail late in the rewrite phase. `head` is never moved, so a later
        // edit through the still-held Pad object appends onto intact history.
        const realSet = db.set;
        db.set = async (key: string, value: unknown) => {
          if (key === `pad:${padId}:revs:3`) throw new Error('boom');
          return await realSet(key, value);
        };
        let threw = false;
        try { await deleteRevisions(padId, 3); } catch { threw = true; }
        finally { db.set = realSet; }

        // The caller still holds the old Pad object. One more edit through it:
        try { await pad.appendText('later edit\n'); } catch { /* may throw */ }

        padManager.unloadPad(padId);
        const state = await missingRevs(padId);
        assert.ok(threw, 'expected deleteRevisions to surface the failed write');
        assert.deepEqual(state.missing, [], 'a stale pad edit must not punch holes');
      });
});
