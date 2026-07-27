const IP_V4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function parseHost(args) {
  const index = args.indexOf('--host');
  if (index === -1) return '127.0.0.1';
  const host = args[index + 1];
  if (!host) throw new Error('--host 需要 IPv4 地址');
  if (!IP_V4.test(host) || host.split('.').some(part => Number(part) > 255)) {
    throw new Error('--host 必须是有效 IPv4 地址');
  }
  return host;
}
