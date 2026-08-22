'use strict';

const assert = require('assert').strict;
import settings from '../../../node/utils/Settings';

describe('openapi server URL generation', function () {
  let generateServerForApiVersion: (apiRoot: string, req: any) => {url: string};
  let originalPublicURL: string | null;

  before(function () {
    ({generateServerForApiVersion} = require('../../../node/hooks/express/openapi'));
    originalPublicURL = settings.publicURL;
  });

  afterEach(function () {
    settings.publicURL = originalPublicURL;
  });

  // `req.protocol` and `req.get('host')` are Express getters; here we mock the
  // values they would resolve to for a given request.
  const mockReq = (protocol: string, host: string) => ({
    protocol,
    get: (name: string) => name.toLowerCase() === 'host' ? host : undefined,
  });

  it('uses settings.publicURL as the origin when configured', function () {
    settings.publicURL = 'https://pad.canonical.example';
    assert.deepEqual(
        generateServerForApiVersion('/api/1.2.15', mockReq('http', 'evil.com')),
        {url: 'https://pad.canonical.example/api/1.2.15'});
  });

  it('strips a trailing slash from settings.publicURL', function () {
    settings.publicURL = 'https://pad.canonical.example/';
    assert.deepEqual(
        generateServerForApiVersion('/api/1.2.15', mockReq('http', 'evil.com')),
        {url: 'https://pad.canonical.example/api/1.2.15'});
  });

  it('ignores a malformed settings.publicURL and falls back to the request', function () {
    for (const bad of ['pad.example', 'http:///foo', 'https://user@pad.example', 'javascript:alert(1)']) {
      settings.publicURL = bad;
      const {url} = generateServerForApiVersion('/api/1.2.15', mockReq('https', 'pad.example'));
      assert.equal(url, 'https://pad.example/api/1.2.15', `bad publicURL: ${bad}`);
    }
  });

  it('emits http:// for a plain HTTP request when no publicURL is set', function () {
    settings.publicURL = null;
    assert.deepEqual(
        generateServerForApiVersion('/api/1.2.15', mockReq('http', 'pad.example')),
        {url: 'http://pad.example/api/1.2.15'});
  });

  it('emits https:// when the request protocol is https (reverse proxy / TLS)', function () {
    settings.publicURL = null;
    assert.deepEqual(
        generateServerForApiVersion('/api/1.2.15', mockReq('https', 'pad.example')),
        {url: 'https://pad.example/api/1.2.15'});
  });

  it('caps the protocol to http/https — no smuggled schemes', function () {
    settings.publicURL = null;
    const {url} = generateServerForApiVersion('/api/1.2.15', mockReq('javascript', 'pad.example'));
    assert.ok(url.startsWith('http://') || url.startsWith('https://'), `unexpected scheme: ${url}`);
  });

  it('falls back to localhost when the Host header is invalid', function () {
    settings.publicURL = null;
    for (const bad of ['evil.com\r\nX-Injected: 1', 'user@evil.com', '<script>', '*']) {
      const {url} = generateServerForApiVersion('/api/1.2.15', mockReq('https', bad));
      assert.ok(!url.includes('\n') && !url.includes('\r'), `CRLF leaked: ${url}`);
      assert.ok(!url.includes('@'), `userinfo leaked: ${url}`);
      assert.ok(url.startsWith('https://localhost/'), `unexpected fallback: ${url}`);
    }
  });
});
