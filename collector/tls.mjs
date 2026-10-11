// The dashboard over https: a certificate the collector makes for itself, once, and keeps (state/tls). It is
// signed by no authority, so a browser warns the first time and remembers your choice for this certificate:
// it is therefore never made again while it is there (99 years), or every device would be asked again.
// https is what lets a guest's password travel unread, and what a browser asks for before it keeps a screen on.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

const YEARS = 99;

/** The names and addresses this computer answers to now: what the certificate is made out for. */
export function namesNow() {
  const name = hostname().toLowerCase();
  const ips = Object.values(networkInterfaces()).flat().filter(i => i?.family === 'IPv4').map(i => i.address);
  return { dns: [...new Set(['localhost', name, `${name.split('.')[0]}.local`])], ips: [...new Set(['127.0.0.1', ...ips])] };
}

/** A key and a certificate for these names, as PEM: { key, cert }. */
export async function makeCertificate({ dns, ips }, now = new Date()) {
  const { default: selfsigned } = await import('selfsigned');
  const until = new Date(now);
  until.setFullYear(until.getFullYear() + YEARS);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { // (a name that says nothing of what is served)
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notBeforeDate: new Date(now.getTime() - 86_400_000), notAfterDate: until,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [...dns.map(value => ({ type: 2, value })), ...ips.map(ip => ({ type: 7, ip }))] },
    ],
  });
  return { key: pems.private, cert: pems.cert };
}

/** The collector's own key and certificate: read from `dir`, made there the first time (the key for you alone). */
export async function ownCertificate(dir, { names = namesNow(), log = () => {} } = {}) {
  const keyFile = join(dir, 'key.pem'), certFile = join(dir, 'cert.pem');
  if (existsSync(keyFile) && existsSync(certFile)) return { key: readFileSync(keyFile, 'utf8'), cert: readFileSync(certFile, 'utf8') };
  const made = await makeCertificate(names);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(keyFile, made.key, { mode: 0o600 });
  try { chmodSync(keyFile, 0o600); } catch { /* a system without modes */ }
  writeFileSync(certFile, made.cert);
  log(`https: a certificate was made for ${[...names.dns, ...names.ips].join(', ')} (${certFile}, for ${YEARS} years)`);
  return made;
}
