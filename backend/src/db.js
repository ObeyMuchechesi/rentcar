const mongoose = require('mongoose');
const { config } = require('./config');

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
