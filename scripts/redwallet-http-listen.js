/**
 * Listen on IPv6 dual-stack so Core Device USB tunnel (fd26::/64) can reach collector/command servers.
 */
function listen(server, port, host, callback) {
  const bindHost = !host || host === '0.0.0.0' ? '::' : host;
  return server.listen({ port, host: bindHost, ipv6Only: false }, callback);
}

module.exports = { listen };
