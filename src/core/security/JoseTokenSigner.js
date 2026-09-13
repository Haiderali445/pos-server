class JoseTokenSigner {
  async sign(payload, secret = process.env.JWT_SECRET || "pos-secret-key-change-in-production", options = {}) {
    const { SignJWT } = await import("jose");
    const plainPayload = JSON.parse(JSON.stringify(payload));

    return new SignJWT(plainPayload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime(options.expiresIn || "8h")
      .sign(new TextEncoder().encode(secret || "pos-secret-key-change-in-production"));
  }

  async verify(token, secret = process.env.JWT_SECRET || "pos-secret-key-change-in-production") {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret || "pos-secret-key-change-in-production")
    );
    return payload;
  }
}

module.exports = JoseTokenSigner;
