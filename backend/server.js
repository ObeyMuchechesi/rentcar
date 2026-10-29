const { createApp } = require('./src/app');
const { config, assertConfig } = require('./src/config');
const { connect } = require('./src/db');
const { seedIfEmpty } = require('./src/seed');

async function main() {
  assertConfig();
  const conn = await connect();
  console.log(`MongoDB connected: ${conn.name}`);

  // Seeding happens before listen so the very first request already sees a fleet.
  if (process.env.SEED_ON_START === 'true') {
    const seeded = await seedIfEmpty();
    console.log(seeded ? 'Demo fleet seeded.' : 'Database already populated, skipped seeding.');
  }

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Car rental API listening on http://localhost:${config.port} (${config.env})`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exitCode = 1;
});
