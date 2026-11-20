// パスキー（WebAuthn）の登録・認証をブラウザに依頼し、結果をサーバーへ送れる形にする
(() => {
  const dec = (s) => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
    return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
  };
  const enc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  window.passkey = {
    supported: () => !!(window.PublicKeyCredential && navigator.credentials),

    async create(o) {
      const cred = await navigator.credentials.create({
        publicKey: {
          ...o,
          challenge: dec(o.challenge),
          user: { ...o.user, id: dec(o.user.id) },
          excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: dec(c.id) })),
        },
      });
      const r = cred.response;
      return {
        id: cred.id,
        rawId: enc(cred.rawId),
        type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment || undefined,
        clientExtensionResults: cred.getClientExtensionResults(),
        response: {
          clientDataJSON: enc(r.clientDataJSON),
          attestationObject: enc(r.attestationObject),
          transports: r.getTransports ? r.getTransports() : [],
        },
      };
    },

    async get(o) {
      const cred = await navigator.credentials.get({
        publicKey: {
          ...o,
          challenge: dec(o.challenge),
          allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: dec(c.id) })),
        },
      });
      const r = cred.response;
      return {
        id: cred.id,
        rawId: enc(cred.rawId),
        type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment || undefined,
        clientExtensionResults: cred.getClientExtensionResults(),
        response: {
          clientDataJSON: enc(r.clientDataJSON),
          authenticatorData: enc(r.authenticatorData),
          signature: enc(r.signature),
          userHandle: r.userHandle ? enc(r.userHandle) : undefined,
        },
      };
    },
  };
})();
