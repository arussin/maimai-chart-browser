/** Child-process guard for the local owner-report acceptance harness only. */
const fs = require("node:fs");
const net = require("node:net");
const dns = require("node:dns");
const loopback = (host) =>
  !host ||
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    String(host).toLowerCase(),
  );
function deny() {
  if (process.env.MAIMAI_NETWORK_VIOLATIONS) {
    fs.appendFileSync(
      process.env.MAIMAI_NETWORK_VIOLATIONS,
      "non-loopback transport blocked\n",
    );
  }
  const error = new Error(
    "Owner-report fixture permits loopback transport only",
  );
  error.code = "ERR_MAIMAI_OFFLINE";
  throw error;
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  const options = first && typeof first === "object" ? first : {};
  const pipe =
    typeof options.path === "string" ||
    (typeof first === "string" && !/^\d+$/.test(first));
  const host =
    options.host ??
    (typeof normalized[1] === "string" ? normalized[1] : undefined);
  if (!pipe && !loopback(host)) deny();
  return connect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (host, ...args) {
  if (!loopback(host)) deny();
  return lookup.call(this, host, ...args);
};
const fetch = globalThis.fetch;
globalThis.fetch = function (input, ...args) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!loopback(url.hostname))
    return Promise.reject(
      (() => {
        try {
          deny();
        } catch (error) {
          return error;
        }
      })(),
    );
  return fetch.call(this, input, ...args);
};
