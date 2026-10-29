// Serialises overlapping-read-then-write sections within this process. Only one process sees
// this map, so cross-instance safety comes from the MongoDB transaction in reservation.js.
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
