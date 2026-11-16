import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacySessions } from '../app/data/history-migration.mjs';

test('legacy simulated transaction is labeled unverified and removed from live history', () => {
  const old = [{ id: 's1', status: 'refunded', messages: [{ id: 'a1', role: 'assistant',
    feeLabel: 'Hoàn phí 100%', onchain: { mode: 'LIVE_AVALANCHE', fujiSettlementTxHash: '0x' + 'a'.repeat(64) } }] }];
  const migrated = migrateLegacySessions(old);
  assert.equal(migrated[0].status, 'draft');
  assert.equal(migrated[0].messages[0].onchain, undefined);
  assert.match(migrated[0].messages[0].feeLabel, /chưa xác minh giao dịch/i);
  assert.equal(migrated[0].messages[0].legacyOnchain.fujiSettlementTxHash, old[0].messages[0].onchain.fujiSettlementTxHash);
  assert.equal(old[0].messages[0].onchain.mode, 'LIVE_AVALANCHE');
});
