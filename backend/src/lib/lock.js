// Serialises overlapping-read-then-write sections within this process. A single Express
// instance is the supported topology; a multi-instance deployment needs MongoDB
// transactions on a replica set instead.
const locks = new Map();

function withLock(key, work) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(work, work);
  locks.set(key, run);

  const release = () => {
    if (locks.get(key) === run) locks.delete(key);
  };
  return run.then(
    (value) => {
      release();
      return value;
    },
    (err) => {
      release();
      throw err;
    }
  );
}

module.exports = { withLock };
