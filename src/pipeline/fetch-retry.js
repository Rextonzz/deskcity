// @ts-check
// Riding out a short network drop (2026-11-23: the Ethernet link flapped for a moment around 03:15 and several jobs
// failed with "TypeError: fetch failed" and needed a manual Retry).
//
// fetchRetry() is fetch() that tries again, with a growing wait (2 s, 6 s, 18 s by default), ONLY when the request
// never got an answer: fetch threw a network-level error (connection reset, DNS failure, refused, socket closed).
// It never retries:
//   - an HTTP answer of any status (4xx/5xx come back as a Response; the caller's own status handling stays in charge),
//   - an abort or timeout from the caller's own signal,
//   - a request whose body is a stream (it can't be sent twice).
// Use it for AI calls and GET-style reads. Do NOT use it for YouTube or TikTok upload/post requests: a connection that
// drops after the server took the upload would post the video twice.

// Error codes that mean "the request didn't get through" (Node / undici).
export const NETWORK_CODES = new Set([
  "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "ECONNABORTED", "EHOSTUNREACH", "ENETUNREACH",
  "ENETDOWN", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_CLOSED",
]);
const CODE_TEXT = new RegExp(`\\b(${[...NETWORK_CODES].join("|")})\\b`);

const isAbort = (e) => e?.name === "AbortError" || e?.name === "TimeoutError";

/**
 * True when an error means the network dropped before an answer came back: fetch's own "fetch failed" TypeError (with
 * its cause codes), the Claude SDK's connection error, or an error whose text carries one of those (some callers
 * re-wrap the message, e.g. "OpenAI: fetch failed"). Aborts and timeouts are never network errors here.
 * @param {any} err
 */
export function isNetworkError(err) {
  if (!err || isAbort(err)) return false;
  const seen = new Set();
  const stack = [err];
  while (stack.length) {
    const e = stack.pop();
    if (!e || typeof e !== "object" || seen.has(e) || seen.size > 20) continue;
    seen.add(e);
    if (isAbort(e)) return false; // a timeout wrapped inside is still the caller's timeout
    if (NETWORK_CODES.has(e.code) || NETWORK_CODES.has(e.errno)) return true;
    if (e.name === "APIConnectionError") return true; // Claude SDK; its timeout is APIConnectionTimeoutError, not retried
    const msg = String(e.message || "");
    if (/\bfetch failed\b/i.test(msg) || CODE_TEXT.test(msg)) return true;
    if (e.cause) stack.push(e.cause);
    if (Array.isArray(e.errors)) stack.push(...e.errors); // AggregateError (several addresses refused)
  }
  return false;
}

// A body that can only be read once (a stream) can't be sent again.
function streamBody(body) {
  if (!body || typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return false;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return false;
  return typeof body.getReader === "function" || typeof body.pipe === "function" || typeof body[Symbol.asyncIterator] === "function";
}

// Waits before the next try. If the caller's signal fires meanwhile (its timeout ran out), gives up with the network
// error itself, which says more than "aborted" and is what the worker's own requeue looks for.
function wait(ms, signal, err) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(err);
    const t = setTimeout(() => { signal?.removeEventListener?.("abort", stop); resolve(undefined); }, ms);
    const stop = () => { clearTimeout(t); reject(err); };
    signal?.addEventListener?.("abort", stop, { once: true });
  });
}

/**
 * fetch() that retries network drops only (see the top of this file).
 * @param {any} url
 * @param {any} [opts] fetch options
 * @param {{ tries?: number, baseMs?: number, factor?: number, fetch?: typeof fetch, onRetry?: (err: any, attempt: number, waitMs: number) => void }} [retry]
 *   tries: attempts in all (default 4); baseMs: first wait (default 2000), then x factor (default 3) each time.
 */
export async function fetchRetry(url, opts = {}, retry = {}) {
  const { tries = 4, baseMs = 2000, factor = 3, fetch: doFetch = globalThis.fetch, onRetry } = retry;
  const once = streamBody(opts?.body) || (typeof Request !== "undefined" && url instanceof Request && url.body);
  for (let attempt = 1; ; attempt++) {
    try {
      return await doFetch(url, opts);
    } catch (err) {
      if (once || attempt >= tries || opts?.signal?.aborted || !isNetworkError(err)) throw err;
      const ms = baseMs * factor ** (attempt - 1);
      if (onRetry) onRetry(err, attempt, ms);
      else console.warn(`Network error (${netCode(err)}) on ${shortUrl(url)}; trying again in ${Math.round(ms / 1000)} s (${attempt}/${tries - 1})`);
      await wait(ms, opts?.signal, err);
    }
  }
}

/** The first network code in an error's cause chain, for logs. @param {any} err */
export function netCode(err) {
  for (let e = err, i = 0; e && i < 6; e = e.cause, i++) if (e.code) return e.code;
  return String(err?.message || "network error").slice(0, 60);
}
// No query string in logs (keys can travel there).
const shortUrl = (u) => { try { const x = new URL(String(u?.url || u)); return `${x.host}${x.pathname}`; } catch { return "a request"; } };
