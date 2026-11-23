/**
 * Helpers for the verification scripts: close SOME Redis client connections on purpose, to
 * test reconnection, without touching anybody else's.
 *
 * `CLIENT KILL TYPE normal` would close every client of the server (a running API, a worker,
 * another check), so the scripts list the clients and close only those `match` selects.
 */

/** `CLIENT LIST` text → [{ id, name, db, addr, … }] (all values are strings). */
export function parseClientList(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      Object.fromEntries(
        line.split(' ').map((pair) => {
          const at = pair.indexOf('=');
          return at === -1 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)];
        }),
      ),
    );
}

/**
 * Closes the connections `match(client)` selects, never the caller's own (`admin`).
 * Returns `{ closed, names }`.
 */
export async function closeClients(admin, match) {
  const self = String(await admin.client('ID'));
  const clients = parseClientList(await admin.client('LIST'));
  const names = [];
  let closed = 0;
  for (const client of clients) {
    if (client.id === self || !match(client)) continue;
    const n = Number(await admin.client('KILL', 'ID', client.id).catch(() => 0));
    if (n > 0) {
      closed += n;
      names.push(client.name || `id ${client.id}`);
    }
  }
  return { closed, names };
}
