const mongoose = require('mongoose');
const { withLock } = require('./lock');
const { supportsTransactions, isTransactionConflict } = require('./transaction');

const MAX_ATTEMPTS = 3;

async function abortQuietly(session) {
  try {
    await session.abortTransaction();
  } catch {
    // The transaction may already be aborted or timed out on the server.
  }
}

async function runOnce(session, work) {
  session.startTransaction({
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority', journal: true },
  });
  try {
    const value = await work(session);
    await session.commitTransaction();
    return value;
  } catch (err) {
    await abortQuietly(session);
    throw err;
  }
}

// `work` gets a ClientSession when the database can serialise writes and must pass it to every
// read and write in the section; on a standalone server it gets null and only this process's
// lock applies. Callers that run more than one instance must rely on the transaction path.
async function withReservation(lockKey, work) {
  const transactional = await supportsTransactions();

  return withLock(lockKey, async () => {
    if (!transactional) return work(null);

    for (let attempt = 1; ; attempt += 1) {
      const session = await mongoose.startSession();
      try {
        return await runOnce(session, work);
      } catch (err) {
        // A conflict means another writer committed while we were open. Retry, and the next
        // pass reads their booking and fails with the real answer instead of a database error.
        if (!isTransactionConflict(err) || attempt >= MAX_ATTEMPTS) throw err;
        console.warn(`booking transaction clashed with a concurrent writer (attempt ${attempt}), retrying`);
      } finally {
        await session.endSession();
      }
    }
  });
}

module.exports = { withReservation };
