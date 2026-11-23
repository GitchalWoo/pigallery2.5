import * as http from 'http';
import * as crypto from 'crypto';

export interface MockOIDCUserClaims {
  sub?: string;
  preferred_username?: string;
  email?: string;
  [key: string]: any;
}

export class MockOIDCServer {
  private server: http.Server | null = null;
  private port = 0;
  private privateKey: crypto.KeyObject;
  private publicKey: crypto.KeyObject;
  private jwk: any;
  public lastTokenRequestBody: Record<string, string> | null = null;
  public signingAlgorithm: 'RS256' | 'PS256' = 'RS256';
  public userInfo: MockOIDCUserClaims | null = null;

  private claims: MockOIDCUserClaims = {
    sub: 'user-default-123',
    preferred_username: 'oidc_user',
    email: 'oidc_user@example.com'
  };

  constructor() {
    const keyPair = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
    this.privateKey = keyPair.privateKey;
    this.publicKey = keyPair.publicKey;
    this.jwk = {
      ...this.publicKey.export({format: 'jwk'}),
      kid: 'mock-test-key-id',
      use: 'sig',
      alg: 'RS256'
    };
  }

  public setClaims(claims: MockOIDCUserClaims): void {
    this.claims = claims;
  }

  public getIssuerUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        try {
          const issuer = this.getIssuerUrl();
          const url = new URL(req.url || '/', issuer);

          if (url.pathname === '/.well-known/openid-configuration') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              issuer,
              authorization_endpoint: `${issuer}/auth`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/jwks`,
              response_types_supported: ['code'],
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: [this.signingAlgorithm],
              ...(this.userInfo ? {userinfo_endpoint: `${issuer}/userinfo`} : {}),
              code_challenge_methods_supported: ['S256'],
              claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'preferred_username', 'email']
            }));
            return;
          }

          if (url.pathname === '/jwks') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({keys: [{...this.jwk, alg: this.signingAlgorithm}]}));
            return;
          }

          if (url.pathname === '/userinfo' && this.userInfo) {
            if (req.headers.authorization !== 'Bearer mock-access-token-xyz') {
              res.writeHead(401).end();
              return;
            }
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(this.userInfo));
            return;
          }

          if (url.pathname === '/token' && req.method === 'POST') {
            let rawBody = '';
            req.on('data', chunk => {
              rawBody += chunk;
            });
            req.on('end', () => {
              // Parse urlencoded or json body
              const parsedBody: Record<string, string> = {};
              if (rawBody.includes('=')) {
                const params = new URLSearchParams(rawBody);
                params.forEach((v, k) => {
                  parsedBody[k] = v;
                });
              } else {
                try {
                  Object.assign(parsedBody, JSON.parse(rawBody));
                } catch {
                  // ignore
                }
              }
              this.lastTokenRequestBody = parsedBody;

              const now = Math.floor(Date.now() / 1000);
              const header = Buffer.from(JSON.stringify({
                alg: this.signingAlgorithm,
                typ: 'JWT',
                kid: 'mock-test-key-id'
              })).toString('base64url');

              const payload = Buffer.from(JSON.stringify({
                iss: issuer,
                aud: 'test-client-id',
                sub: this.claims.sub || 'user-default-123',
                iat: now,
                exp: now + 3600,
                ...this.claims
              })).toString('base64url');

              const signData = `${header}.${payload}`;
              const key = this.signingAlgorithm === 'PS256'
                ? {key: this.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                  saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST}
                : this.privateKey;
              const sig = crypto.sign('sha256', Buffer.from(signData), key).toString('base64url');
              const idToken = `${signData}.${sig}`;

              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({
                access_token: 'mock-access-token-xyz',
                token_type: 'Bearer',
                id_token: idToken,
                expires_in: 3600
              }));
            });
            return;
          }

          res.statusCode = 404;
          res.end('Not Found');
        } catch (err: any) {
          res.statusCode = 500;
          res.end(err?.message || 'Server error');
        }
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
          resolve(this.getIssuerUrl());
        } else {
          reject(new Error('Failed to obtain server port'));
        }
      });
      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        return resolve();
      }
      this.server.close((err) => {
        if (err) return reject(err);
        this.server = null;
        resolve();
      });
    });
  }
}

