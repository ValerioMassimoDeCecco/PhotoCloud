import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustProxyConfig } from './trustProxy';

test('parseTrustProxyConfig accetta intero hop (numero) o lista di subnet, e rifiuta/ignora "true" con warning', () => {
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);

  assert.equal(parseTrustProxyConfig(undefined, warn), false);
  assert.equal(parseTrustProxyConfig('', warn), false);
  assert.equal(parseTrustProxyConfig('0', warn), false);
  assert.equal(parseTrustProxyConfig('false', warn), false);
  assert.equal(warnings.length, 0);

  // Interi -> passati come numero
  const oneHop = parseTrustProxyConfig('1', warn);
  assert.equal(typeof oneHop, 'number');
  assert.equal(oneHop, 1);

  const twoHops = parseTrustProxyConfig(' 2 ', warn);
  assert.equal(typeof twoHops, 'number');
  assert.equal(twoHops, 2);

  // Lista di subnet / IP / preset
  assert.deepEqual(parseTrustProxyConfig('127.0.0.0/8, 10.0.0.0/8', warn), ['127.0.0.0/8', '10.0.0.0/8']);
  assert.deepEqual(parseTrustProxyConfig('loopback, uniquelocal', warn), ['loopback', 'uniquelocal']);
  assert.deepEqual(parseTrustProxyConfig('::1/128', warn), ['::1/128']);
  assert.equal(warnings.length, 0);

  // "true" rifiutato/ignorato con warning
  assert.equal(parseTrustProxyConfig('true', warn), false);
  assert.equal(parseTrustProxyConfig('TRUE', warn), false);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /TRUST_PROXY="true"/);

  // Valori invalidi o fuori range rifiutati con warning
  assert.equal(parseTrustProxyConfig('999', warn), false);
  assert.equal(parseTrustProxyConfig('not-a-subnet, 10.0.0.0/8', warn), false);
  assert.equal(parseTrustProxyConfig('10.0.0.0/99', warn), false);
  assert.equal(warnings.length, 5);
});
