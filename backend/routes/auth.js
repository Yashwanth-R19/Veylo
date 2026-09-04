/**
 * backend/routes/auth.js
 * ───────────────────────
 * Authentication routes: register, login, logout, me, Google OAuth.
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const router = express.Router();

const prisma = require("../db/prismaClient");
const { requireAuth, JWT_SECRET } = require("../middleware/authMiddleware");

// No hardcoded fallback, same reasoning as JWT_SECRET above: a silently
// missing audience would make verifyIdToken() accept a token issued for a
// DIFFERENT Google OAuth client, defeating the point of verifying it at all.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Generate JWT and set httpOnly cookie */
function issueToken(res, user) {
    const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

    res.cookie("veylo_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: TOKEN_MAX_AGE,
        path: "/",
    });

    return { token, user: payload };
}

// ─── POST /auth/register ────────────────────────
router.post("/register", async (req, res) => {
    try {
        const { email, password, name, role } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        if (role && !["client", "freelancer"].includes(role)) {
            return res.status(400).json({ error: "Role must be 'client' or 'freelancer'" });
        }

        // Check if user exists
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(409).json({ error: "An account with this email already exists" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                name: name || email.split("@")[0],
                role: role || "client",
            },
        });

        const result = issueToken(res, user);
        res.status(201).json(result);
    } catch (error) {
        console.error("[Auth] Register error:", error);
        res.status(500).json({ error: "Registration failed" });
    }
});

// ─── POST /auth/login ───────────────────────────
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        if (!user.passwordHash) {
            return res.status(401).json({
                error: "This account uses Google sign-in. Please log in with Google.",
            });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        const result = issueToken(res, user);
        res.json(result);
    } catch (error) {
        console.error("[Auth] Login error:", error);
        res.status(500).json({ error: "Login failed" });
    }
});

// ─── POST /auth/logout ──────────────────────────
router.post("/logout", (req, res) => {
    res.clearCookie("veylo_token", { path: "/" });
    res.json({ success: true });
});

// ─── GET /auth/me ───────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            oauthProvider: user.oauthProvider || null,
            createdAt: user.createdAt,
        });
    } catch (error) {
        console.error("[Auth] Me error:", error);
        res.status(500).json({ error: "Failed to get user" });
    }
});

// ─── PUT /auth/role ─────────────────────────────
router.put("/role", requireAuth, async (req, res) => {
    try {
        const { role } = req.body;
        if (!["client", "freelancer"].includes(role)) {
            return res.status(400).json({ error: "Role must be 'client' or 'freelancer'" });
        }

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: { role },
        });

        // Re-issue token with new role
        const result = issueToken(res, user);
        res.json(result);
    } catch (error) {
        console.error("[Auth] Role update error:", error);
        res.status(500).json({ error: "Failed to update role" });
    }
});

// ─── POST /auth/google ─────────────────────────
// Real Google Identity Services flow: the frontend (@react-oauth/google)
// gets a signed ID token JWT directly from Google and sends only that here.
// It is verified against Google's public keys via google-auth-library —
// never trust client-submitted profile fields directly. The previous
// version of this route accepted a raw {email, googleId} body with no
// verification at all, which let anyone log in as any email address; that
// was a real, exploitable hole, not a hypothetical one, fixed by this
// rewrite rather than left running alongside it.
router.post("/google", async (req, res) => {
    try {
        if (!googleClient) {
            return res.status(503).json({ error: "Google sign-in is not configured on this server (GOOGLE_CLIENT_ID missing)" });
        }

        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ error: "idToken is required" });
        }

        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
            payload = ticket.getPayload();
        } catch (err) {
            return res.status(401).json({ error: "Invalid Google credential" });
        }

        if (!payload?.email || !payload.sub) {
            return res.status(401).json({ error: "Invalid Google credential" });
        }
        if (!payload.email_verified) {
            return res.status(401).json({ error: "Google account email is not verified" });
        }

        const { email, name, sub: googleId } = payload;

        // Find or create user, keyed on the VERIFIED email/sub above — not
        // anything the request body claimed.
        let user = await prisma.user.findUnique({ where: { email } });

        if (user) {
            if (!user.oauthId) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { oauthProvider: "google", oauthId: googleId },
                });
            }
        } else {
            user = await prisma.user.create({
                data: {
                    email,
                    name: name || email.split("@")[0],
                    oauthProvider: "google",
                    oauthId: googleId,
                    role: "client", // Default role, user can change later
                },
            });
        }

        const result = issueToken(res, user);
        res.json(result);
    } catch (error) {
        console.error("[Auth] Google auth error:", error);
        res.status(500).json({ error: "Google authentication failed" });
    }
});

module.exports = router;
