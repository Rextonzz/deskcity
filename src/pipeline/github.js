import { agentName } from "../hub/settings.js";
// One GitHub API request for the three another project and review callers (another project.js, another projectActions.js,
// agents/assistant.js). Each caller keeps its own token, timeout, user agent and error text.
// Options: token, method, body (sent as JSON), timeoutMs, ua, raw (answer as text), lenient (an answer that isn't JSON
// reads as {}), errorText(res, data) -> message for a non-OK answer (the error also carries .status). Always throws on non-OK.
// The hub's name to GitHub ("<owner>s-hub").
const userAgent = () => agentName().replace(/sHub$/, "s-hub").toLowerCase();
export async function request(url, { token, method = "GET", body, timeoutMs = 15000, ua = userAgent(), raw = false, lenient = false, errorText } = {}) {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": ua, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(errorText ? errorText(res, data) : `GitHub answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return {};
  if (raw) return res.text();
  return lenient ? res.json().catch(() => ({})) : res.json();
}
