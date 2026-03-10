import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// ═══ Google OAuth Token Refresh ═══
// Access tokens expire after ~1 hour. This function uses the refresh_token
// to obtain a new access_token automatically.
async function refreshAccessToken(token) {
  try {
    const url = "https://oauth2.googleapis.com/token";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      console.error("[AUTH] Token refresh failed:", refreshedTokens);
      throw new Error(refreshedTokens.error || "RefreshAccessTokenError");
    }

    console.log("[AUTH] Token refreshed successfully, expires in", refreshedTokens.expires_in, "seconds");

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      // Google returns expires_in in seconds, convert to milliseconds timestamp
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      // Google may or may not return a new refresh_token — keep the old one if not
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
      error: undefined, // Clear any previous error
    };
  } catch (error) {
    console.error("[AUTH] Error refreshing access token:", error.message);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Restrict access to @wavemedix.ai domain
      const email = profile?.email || user?.email || "";
      if (!email.endsWith("@wavemedix.ai")) {
        console.log(`[AUTH] Rejected login from: ${email}`);
        return false;
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      // Initial sign-in: store tokens from Google
      if (account) {
        console.log("[AUTH] Initial login — storing tokens, expires_at:", account.expires_at);
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          // Google provides expires_at in seconds since epoch
          accessTokenExpires: account.expires_at * 1000,
          email: profile?.email || token.email,
        };
      }

      // Token is still valid — return as-is
      // Refresh 5 minutes before expiry to avoid edge cases
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires - 5 * 60 * 1000) {
        return token;
      }

      // Token has expired or is about to expire — refresh it
      console.log("[AUTH] Access token expired or expiring soon, refreshing...");
      return await refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      session.userEmail = token.email;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
});

export { handler as GET, handler as POST };
