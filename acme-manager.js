// acme-manager.js — certificate manager for nes-server.js (2.0.9).
//
// The relay requires a CertManager with init() → { key, cert }, attach(server), status() and config.domains.
// This is the in-tree manager: it serves, in order, a local cert.pem/key.pem pair next to the server, a certbot
// live directory (fullchain.pem/privkey.pem), or a self-signed pair it generates once with openssl into ./certs.
// It hot-swaps the pair into the running server when the files change (a renewal by certbot, or a pair you drop
// in) via server.setSecureContext, and it never refuses to start over certificates. It does not talk to an ACME
// CA itself; a deployment that does can replace this file, the server's contract is the same.
//
// Domains: ACME_DOMAINS=a,b,c (env or .env) or config.domains passed in; no defaults are baked in.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

class CertManager {
  constructor(o = {}) {
    this.o = o;
    this.dir = o.dir || path.join(__dirname, 'certs');
    const envDomains = (process.env.ACME_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean);
    this.config = { domains: envDomains.length ? envDomains : (o.defaultDomains || []) };
    this.source = 'none'; this.files = null; this.server = null;
  }
  _candidates() {
    const lp = this.o.legacyPaths || {};
    const local = { key: lp.localKey || path.join(__dirname, 'key.pem'), cert: lp.localCert || path.join(__dirname, 'cert.pem'), name: 'local cert.pem/key.pem' };
    const certbot = lp.certbotDir ? { key: path.join(lp.certbotDir, 'privkey.pem'), cert: path.join(lp.certbotDir, 'fullchain.pem'), name: 'certbot ' + lp.certbotDir } : null;
    const own = { key: path.join(this.dir, 'key.pem'), cert: path.join(this.dir, 'cert.pem'), name: 'self-signed (generated in ' + this.dir + ')' };
    return [local, certbot, own].filter(Boolean);
  }
  _read(c) { try { return { key: fs.readFileSync(c.key), cert: fs.readFileSync(c.cert) }; } catch { return null; } }
  _selfSign(c) {
    fs.mkdirSync(this.dir, { recursive: true });
    const cn = this.config.domains[0] || 'localhost';
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...this.config.domains.map(d => 'DNS:' + d)].join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', c.key, '-out', c.cert, '-days', '825', '-subj', '/CN=' + cn, '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
  }
  async init() {
    const cands = this._candidates();
    for (const c of cands) {
      let pair = this._read(c);
      if (!pair && c === cands[cands.length - 1]) { try { this._selfSign(c); pair = this._read(c); } catch (e) { console.error('[cert] openssl could not generate a self-signed pair:', e.message); } }
      if (pair) { this.source = c.name; this.files = c; return pair; }
    }
    throw new Error('[cert] no certificate available: put cert.pem/key.pem next to nes-server.js, point legacyPaths.certbotDir at a certbot live directory, or install openssl');
  }
  attach(server) {
    this.server = server; if (!this.files) return;
    const swap = () => { const pair = this._read(this.files); if (!pair) return; try { server.setSecureContext(pair); console.log(`[cert] reloaded ${this.source}`); } catch (e) { console.error('[cert] reload failed:', e.message); } };
    for (const f of [this.files.key, this.files.cert]) fs.watchFile(f, { interval: 60000 }, swap);
  }
  status() { return this.source + (this.config.domains.length ? ' for ' + this.config.domains.join(', ') : ''); }
}
module.exports = { CertManager };
