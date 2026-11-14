// "At most N messages per person per minute", kept in memory. Good for one
// server; with several servers this would move to a shared store like Redis.
const WINDOW_MS = 60_000;
const recent = new Map();

export const takeSlot = (userId, perMinute) => {
  const now = Date.now();
  const times = (recent.get(userId) ?? []).filter((time) => now - time < WINDOW_MS);

  if (times.length >= perMinute) {
    recent.set(userId, times);
    return { allowed: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - times[0])) / 1000) };
  }

  times.push(now);
  recent.set(userId, times);
  return { allowed: true };
};

// Forget people who have gone quiet, so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [userId, times] of recent) {
    if (times.every((time) => now - time >= WINDOW_MS)) recent.delete(userId);
  }
}, WINDOW_MS).unref();
