// Response compression with Node's own zlib (no npm package). Text answers (HTML, JS, CSS, JSON, SVG) go out as
// brotli or gzip when the browser asks for it; images, models, audio and anything already packed are left alone.
// Measured 2026-11-16 (docs/handoffs/monday/measure-report.md): the 3D campus cold load drops from 3.3 MB to about 1 MB.
// Rules: only a whole answer of known size (Content-Length set, so streamed or live answers are never held back or
// buffered), at least 1 KB, status other than 204/206/304, no Range request, no "Cache-Control: no-transform".
// The ETag stays (made weak, as a compressed copy is not byte-identical), so 304 answers still work; Vary is always set.
import zlib from "node:zlib";

const TEXTY = /^(text\/(?!event-stream)|application\/(json|javascript|x-javascript|ecmascript|manifest\+json|xml|rss\+xml|atom\+xml|geo\+json)|image\/svg\+xml|[^;]*\+(json|xml))/i;

// "gzip, br;q=0.8, *;q=0" -> the best encoding we can do that the browser accepts (br over gzip on a tie), or null.
export function pickEncoding(header) {
  if (!header) return null;
  const q = {};
  for (const part of String(header).split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const m = params.join(";").match(/q\s*=\s*([0-9.]+)/);
    q[name.trim()] = m ? Number(m[1]) : 1;
  }
  const weight = (e) => (e in q ? q[e] : "*" in q ? q["*"] : 0);
  const [br, gz] = [weight("br"), weight("gzip")];
  if (br > 0 && br >= gz) return "br";
  return gz > 0 ? "gzip" : null;
}

export function compress({ threshold = 1024 } = {}) {
  return (req, res, next) => {
    if (req.method === "HEAD") return next();
    const enc = pickEncoding(req.headers["accept-encoding"]);
    const write = res.write, end = res.end;
    let decided = false, out = null;
    const addVary = () => {
      const v = res.getHeader("Vary");
      if (!v) res.setHeader("Vary", "Accept-Encoding");
      else if (!/accept-encoding|\*/i.test(String(v))) res.setHeader("Vary", `${v}, Accept-Encoding`);
    };
    const decide = () => {
      decided = true;
      const type = String(res.getHeader("Content-Type") || "");
      if (!TEXTY.test(type)) return;
      addVary();
      const len = Number(res.getHeader("Content-Length"));
      if (!enc || !(len >= threshold) || req.headers.range) return;
      if ([204, 206, 304].includes(res.statusCode) || res.getHeader("Content-Encoding")) return;
      if (/no-transform/i.test(String(res.getHeader("Cache-Control") || ""))) return;
      out = enc === "br"
        ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: len } })
        : zlib.createGzip({ level: 6 });
      res.removeHeader("Content-Length");
      res.setHeader("Content-Encoding", enc);
      const tag = res.getHeader("ETag");
      if (tag && !String(tag).startsWith("W/")) res.setHeader("ETag", `W/${tag}`);
      out.on("data", (c) => { if (write.call(res, c) === false) { out.pause(); res.once("drain", () => out.resume()); } });
      out.on("drain", () => res.emit("drain")); // a pipe() into res waits for this when out.write() said "full"
      out.on("end", () => end.call(res));
      out.on("error", () => end.call(res));
      res.on("close", () => out.destroy());
    };
    res.write = function (chunk, encoding, cb) {
      if (!decided) decide();
      return out ? out.write(chunk, typeof encoding === "string" ? encoding : undefined, typeof encoding === "function" ? encoding : cb) : write.apply(res, arguments);
    };
    res.end = function (chunk, encoding, cb) {
      if (typeof chunk === "function") { cb = chunk; chunk = null; }
      if (!decided) decide();
      if (!out) return end.apply(res, arguments);
      if (cb || typeof encoding === "function") res.once("finish", typeof encoding === "function" ? encoding : cb);
      if (chunk) out.write(chunk, typeof encoding === "string" ? encoding : undefined);
      out.end();
      return res;
    };
    next();
  };
}
