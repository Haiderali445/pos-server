class JoseTokenSigner {
  async sign(payload, secret, options = {}) {
    const { SignJWT } = await import("jose");

    return new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime(options.expiresIn || "8h")
      .sign(new TextEncoder().encode(secret));
  }

  async verify(token, secret) {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return payload;
  }
}

module.exports = JoseTokenSigner;

