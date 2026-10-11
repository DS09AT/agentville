import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Whether the collector answers on this computer. With https on, its certificate is its own, so it is not checked. */
export function answers(cfg, timeoutMs = 1500) {
  return new Promise(resolve => {
    const req = (cfg.https ? httpsRequest : httpRequest)({ host: '127.0.0.1', port: cfg.port, path: '/api/state', rejectUnauthorized: false, agent: false, timeout: timeoutMs, headers: { host: `127.0.0.1:${cfg.port}` } }, res => {
      resolve(res.statusCode === 200 && String(res.headers['content-type']).startsWith('application/json'));
      res.destroy();
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}
