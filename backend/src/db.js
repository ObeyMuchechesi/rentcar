const mongoose = require('mongoose');
const { config } = require('./config');
const { supportsTransactions } = require('./lib/transaction');

let memoryServer = null;

// 'memory' boots an in-process MongoDB so the stack runs with no local server;
// it is never allowed in production (assertConfig requires a real URI).
async function connect(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  if (uri === 'memory' || !uri) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri('car_rental');
    config.mongoUri = uri;
    console.log('Using in-memory MongoDB — data resets when the process exits.');
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  // Warms the cache that decides whether bookings use a transaction or the in-process lock.
  const transactions = await supportsTransactions();
  console.log(`MongoDB connected — cross-instance booking transactions ${transactions ? 'enabled' : 'unavailable (single-instance lock only)'}`);
  return mongoose.connection;
}

async function disconnect() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

module.exports = { connect, disconnect };
