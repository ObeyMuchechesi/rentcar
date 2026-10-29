const mongoose = require('mongoose');

let cache;

// A standalone mongod cannot run transactions; a replica set (Atlas M0 included) reports a
// setName. Cached per process because a serverless function keeps no shared memory.
async function supportsTransactions() {
  if (cache !== undefined) return cache;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    cache = Boolean(hello.setName);
  } catch {
    cache = false;
  }
  return cache;
}

// Sync read of the probe result for health checks: true, false, or null while still unknown.
function transactionsResolved() {
  return cache === undefined ? null : cache;
}

function isTransactionConflict(err) {
  if (!err) return false;
  if (err.code === 112 || err.codeName === 'WriteConflict') return true;
  if (typeof err.hasErrorLabel === 'function' && err.hasErrorLabel('TransientTransactionError')) return true;
  return /WriteConflict|TransientTransactionError/.test(String(err.message || ''));
}

module.exports = {
  supportsTransactions,
  transactionsResolved,
  isTransactionConflict,
};
