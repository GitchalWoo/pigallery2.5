import {expect} from 'chai';
import {LoggerRouter} from '../../../../src/backend/routes/LoggerRouter';

describe('LoggerRouter - AUD9 redaction', () => {
  it('should redact sensitive query parameters', () => {
    const rawUrl = '/pgapi/gallery/search?qs=cat&token=secret-token-123&sk=share-key-456&code=oidc-auth-code&state=xyz';
    const sanitized = LoggerRouter.sanitizeUrl(rawUrl);

    expect(sanitized).to.not.include('secret-token-123');
    expect(sanitized).to.not.include('share-key-456');
    expect(sanitized).to.not.include('oidc-auth-code');
    expect(sanitized).to.include('qs=cat');
    expect(sanitized).to.include('token=***REDACTED***');
    expect(sanitized).to.include('sk=***REDACTED***');
    expect(sanitized).to.include('code=***REDACTED***');
  });

  it('should redact sharing key in URL path', () => {
    const rawUrl = '/pgapi/share/secretShareKey123/key';
    const sanitized = LoggerRouter.sanitizeUrl(rawUrl);

    expect(sanitized).to.not.include('secretShareKey123');
    expect(sanitized).to.equal('/pgapi/share/***REDACTED***/key');
  });

  it('should preserve non-sensitive URLs intact', () => {
    const rawUrl = '/pgapi/gallery/content/photos/vacation.jpg?size=medium';
    const sanitized = LoggerRouter.sanitizeUrl(rawUrl);

    expect(sanitized).to.equal(rawUrl);
  });
});
