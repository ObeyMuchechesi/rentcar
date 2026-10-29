// Vercel serverless entry: every /api request is rewritten here. The Express app and its
// MongoDB connection are built once per warm instance, so only cold starts pay for connect().
const { createApp } = require('../backend/src/app');
const { assertConfig } = require('../backend/src/config');
const { connect } = require('../backend/src/db');

let pending;

function boot() {
  if (!pending) {
    pending = (async () => {
      assertConfig();
      await connect();
      return createApp();
    })();
    pending.catch(() => {
      pending = undefined;
    });
  }
  return pending;
}

module.exports = async function handler(req, res) {
  let app;
  try {
    app = await boot();
  } catch (err) {
    console.error('Car rental API failed to start:', err.message);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'API is starting up, please retry' } }));
    return;
  }
  app(req, res);
};
