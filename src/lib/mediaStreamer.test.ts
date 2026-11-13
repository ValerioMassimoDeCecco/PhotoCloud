import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { encryptFileAsync } from './crypto';
import { parseHttpByteRange, streamDecryptedVaultFile } from './mediaStreamer';

test('parseHttpByteRange supports bytes=N-, bytes=-N, bytes=N-M, and invalid ranges', () => {
  assert.deepEqual(parseHttpByteRange(undefined, 100), { status: 'none' });
  assert.deepEqual(parseHttpByteRange('bytes=10-', 100), { status: 'ok', start: 10, end: 99 });
  assert.deepEqual(parseHttpByteRange('bytes=-25', 100), { status: 'ok', start: 75, end: 99 });
  assert.deepEqual(parseHttpByteRange('bytes=-250', 100), { status: 'ok', start: 0, end: 99 });
  assert.deepEqual(parseHttpByteRange('bytes=5-19', 100), { status: 'ok', start: 5, end: 19 });
  assert.deepEqual(parseHttpByteRange('bytes=50-999', 100), { status: 'ok', start: 50, end: 99 });
  assert.deepEqual(parseHttpByteRange('bytes=100-', 100), { status: 'invalid' });
  assert.deepEqual(parseHttpByteRange('bytes=20-10', 100), { status: 'invalid' });
  assert.deepEqual(parseHttpByteRange('bytes=-0', 100), { status: 'invalid' });
  assert.deepEqual(parseHttpByteRange('bytes=0-1', 0), { status: 'invalid' });
});

test('streamDecryptedVaultFile preserves Accept-Ranges, Content-Range, 206, and 416', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-streamer-'));
  try {
    const filePath = path.join(dir, 'sample.txt');
    const apiKey = 'test-secret-key-1234';
    const plaintext = Buffer.from('0123456789abcdefghij', 'utf-8');
    await fs.promises.writeFile(filePath, await encryptFileAsync(plaintext, apiKey));

    const makeMockRes = () => {
      const headers = new Map<string, string>();
      let statusCode = 200;
      let body: Buffer | string | undefined;
      let ended = false;
      const res = {
        status(code: number) {
          statusCode = code;
          return res;
        },
        setHeader(name: string, val: string) {
          headers.set(name.toLowerCase(), val);
          return res;
        },
        send(payload: Buffer | string) {
          body = payload;
          ended = true;
          return res;
        },
        end() {
          ended = true;
          return res;
        },
      } as unknown as Response;
      return { res, headers, getStatus: () => statusCode, getBody: () => body, isEnded: () => ended };
    };

    // bytes=N-M -> 206 fires onBeforeSend
    let hookCount = 0;
    const r1 = makeMockRes();
    await streamDecryptedVaultFile(
      { headers: { range: 'bytes=2-5' } } as unknown as Request,
      r1.res,
      { filePath, filename: 'sample.txt', apiKey, onBeforeSend: () => { hookCount += 1; } }
    );
    assert.equal(r1.getStatus(), 206);
    assert.equal(hookCount, 1);
    assert.equal(r1.headers.get('accept-ranges'), 'bytes');
    assert.equal(r1.headers.get('content-range'), 'bytes 2-5/20');
    assert.equal((r1.getBody() as Buffer).toString('utf-8'), '2345');

    // full 200 -> fires onBeforeSend
    const rFull = makeMockRes();
    await streamDecryptedVaultFile(
      { headers: {} } as unknown as Request,
      rFull.res,
      { filePath, filename: 'sample.txt', apiKey, onBeforeSend: () => { hookCount += 1; } }
    );
    assert.equal(rFull.getStatus(), 200);
    assert.equal(hookCount, 2);

    // bytes=N-
    const r2 = makeMockRes();
    await streamDecryptedVaultFile(
      { headers: { range: 'bytes=15-' } } as unknown as Request,
      r2.res,
      { filePath, filename: 'sample.txt', apiKey }
    );
    assert.equal(r2.getStatus(), 206);
    assert.equal(r2.headers.get('content-range'), 'bytes 15-19/20');
    assert.equal((r2.getBody() as Buffer).toString('utf-8'), 'fghij');

    // bytes=-N
    const r3 = makeMockRes();
    await streamDecryptedVaultFile(
      { headers: { range: 'bytes=-4' } } as unknown as Request,
      r3.res,
      { filePath, filename: 'sample.txt', apiKey }
    );
    assert.equal(r3.getStatus(), 206);
    assert.equal(r3.headers.get('content-range'), 'bytes 16-19/20');
    assert.equal((r3.getBody() as Buffer).toString('utf-8'), 'ghij');

    // invalid -> 416 ALSO fires onBeforeSend in baseline (counter runs before Range validation, after decryption)
    const r4 = makeMockRes();
    await streamDecryptedVaultFile(
      { headers: { range: 'bytes=999-' } } as unknown as Request,
      r4.res,
      { filePath, filename: 'sample.txt', apiKey, onBeforeSend: () => { hookCount += 1; } }
    );
    assert.equal(r4.getStatus(), 416);
    assert.equal(hookCount, 3);
    assert.equal(r4.headers.get('content-range'), 'bytes */20');
    assert.equal(r4.isEnded(), true);

    // wrong key -> 500 must NOT fire onBeforeSend
    const r5 = makeMockRes();
    await streamDecryptedVaultFile(
      { headers: {} } as unknown as Request,
      r5.res,
      { filePath, filename: 'sample.txt', apiKey: 'wrong-key', onBeforeSend: () => { hookCount += 1; } }
    );
    assert.equal(r5.getStatus(), 500);
    assert.equal(hookCount, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
