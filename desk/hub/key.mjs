// The hub's key: made, renewed, checked and proven. Pure but for the file, so it is tested alone.
//
// Every hub makes a new key when it starts, once it holds the port, and renews it every 30 days
// while it runs: a key lives no longer than the hub that made it. Each start also takes its own
// address for the phone: a tailnet port of its own, chosen at random, which the file holds on its
// second line, written with the key in the same step. The phone's link carries the key to whatever
// listens on the port; while the hub runs, only the hub does. A program that takes the port after
// the hub stops, and catches the phone's next request, holds a key that no hub will ever open
// again, at an address no hub will ever answer on again: a page it plants there (a service worker)
// never sees a request for the next start's address, as a browser keeps each address apart.
//
// Only the hub that holds the port writes the file (server.mjs, after it listens), so hubs started
// together never write it at once. It is always written whole: to a file of its own first, then
// moved into place in one step, so a reader sees the old key or the new one, never part of one and
// never an empty file.
//
// The sessions never send the key. They ask the hub to prove it holds it: they send a fresh
// random nonce, and the hub answers sha256("desk-hub:<key>:<nonce>"), which they work out
// themselves from the file. A program that is not the hub learns nothing it can open the hub with.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'

/** A running hub renews its key when it is older than this. */
export const KEY_MAX_AGE_MS = 30 * 24 * 3600_000

export const isKey = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
export const isNonce = v => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v)
export const digest = text => createHash('sha256').update(text).digest()

/** The key the file's text holds: its first line. The second is the address's port. */
export const keyLine = text => String(text).split('\n')[0].trim()

/** What the hub answers a nonce with; the session works out the same from the key file. */
export const proofOf = (key, nonce) => createHash('sha256').update(`desk-hub:${key}:${nonce}`).digest('hex')

/**
 * The request's path after its key, or undefined when the key is wrong, missing, empty or not a
 * key at all, or when no key is loaded; compared in constant time.
 */
export function unlock(keyHash, path) {
  if (!Buffer.isBuffer(keyHash) || keyHash.length !== 32) return undefined
  const at = path.indexOf('/', 1)
  const given = at === -1 ? path.slice(1) : path.slice(1, at)
  if (!isKey(given)) return undefined
  if (!timingSafeEqual(keyHash, digest(given))) return undefined
  return at === -1 ? '' : path.slice(at)
}

/** The lowest and one past the highest tailnet port a hub takes for the phone. */
export const PHONE_PORTS = [10000, 60000]

/** A port for this start's address, never one in `used` (the ports earlier starts took) nor `avoid`. */
export function phonePort(used, avoid) {
  const seen = new Set(used)
  for (;;) {
    const p = randomInt(PHONE_PORTS[0], PHONE_PORTS[1])
    if (!seen.has(p) && p !== avoid) return p
  }
}

/**
 * A new key, 256 random bits as hex, in a 0600 file written whole, with the port of this start's
 * address on the line after it: to a file of its own, then moved over whatever the file held, so a
 * reader finds a key with the address it opens on, never one with another's. Never an empty key:
 * it throws instead.
 */
export async function newKey(file, port) {
  const key = randomBytes(32).toString('hex')
  if (!isKey(key)) throw new Error('no key made')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('no address for the key')
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, `${key}\n${port}\n`, { mode: 0o600, flag: 'wx' })
  try {
    await rename(tmp, file)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
  return { key, madeAt: Date.now() }
}
