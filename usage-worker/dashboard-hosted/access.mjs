import {createRemoteJWKSet, jwtVerify} from 'jose';
const remoteKeys = new Map();
export function createAccessVerifier({keysForIssuer} = {}) {
  const resolveKeys = keysForIssuer ?? (issuer => {
    if (!remoteKeys.has(issuer)) remoteKeys.set(issuer, createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), {timeoutDuration:5000}));
    return remoteKeys.get(issuer);
  });
  return async (request, env) => {
    const issuer = env.ACCESS_ISSUER, audience = env.ACCESS_AUD, owner = env.OWNER_EMAIL;
    if (typeof issuer !== 'string' || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
        !/^[a-f0-9]{64}$/.test(audience ?? '') || typeof owner !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(owner)) return false;
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token || token.length > 16384) return false;
    try {
      const {payload} = await jwtVerify(token, resolveKeys(issuer), {
        issuer, audience, algorithms:['RS256'], requiredClaims:['exp','iat','sub','email'],
        clockTolerance:5, maxTokenAge:'24h',
      });
      return typeof payload.email === 'string' && payload.email.toLowerCase() === owner.toLowerCase();
    } catch { return false; }
  };
}
