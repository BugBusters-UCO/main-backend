const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const { User } = require("../models");
const { encrypt, generateSecret, decrypt, otpauthUri, verifyTotp } = require("../services/mfaService");
const { recordAudit } = require("../services/auditService");

function requireUserModel() {
  if (!User) {
    const error = new Error("Database is not enabled. Set DB_ENABLED=true and install sequelize/pg packages.");
    error.statusCode = 503;
    throw error;
  }
}

async function register(req, res, next) {
  try {
    requireUserModel();
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ message: "Name, valid email, and password with 8+ characters are required" });
    }

    const existing = await User.findOne({ where: { email: String(email).toLowerCase() } });
    if (existing) {
      return res.status(409).json({ message: "User already exists. Login instead." });
    }

    const user = await User.create({
      name,
      email: String(email).toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      role: "developer"
    });

    res.status(201).json(_authPayload(user));
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    requireUserModel();
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email: String(email || "").toLowerCase() } });
    if (!user || !(await bcrypt.compare(password || "", user.passwordHash))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    res.json(_authPayload(user));
  } catch (error) {
    next(error);
  }
}

function me(req, res) {
  res.json({ user: req.user });
}

async function beginMfa(req, res, next) {
  try {
    requireUserModel();
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const secret = generateSecret();
    await user.update({ mfaSecretEncrypted: encrypt(secret, env.identity.mfaEncryptionKey), mfaEnabled: false });
    await recordAudit(req, "mfa.enrollment_started", "user", user.id, {});
    return res.json({ secret, otpauthUri: otpauthUri(secret, user.email), message: "Confirm the code from the authenticator before MFA becomes active" });
  } catch (error) { return next(error); }
}

async function verifyMfa(req, res, next) {
  try {
    requireUserModel();
    const user = await User.findByPk(req.user.id);
    if (!user?.mfaSecretEncrypted) return res.status(400).json({ message: "MFA enrollment has not started" });
    const secret = decrypt(user.mfaSecretEncrypted, env.identity.mfaEncryptionKey);
    if (!verifyTotp(secret, req.body?.code)) return res.status(401).json({ message: "Invalid MFA code" });
    await user.update({ mfaEnabled: true });
    await recordAudit(req, "mfa.verified", "user", user.id, {});
    return res.json(_authPayload(user, true));
  } catch (error) { return next(error); }
}

async function getMfaSecret(req, res, next) {
  try {
    requireUserModel();
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    
    let secret;
    if (user.mfaSecretEncrypted) {
      secret = decrypt(user.mfaSecretEncrypted, env.identity.mfaEncryptionKey);
    } else {
      // Auto-generate if it doesn't exist
      secret = generateSecret();
      await user.update({ 
        mfaSecretEncrypted: encrypt(secret, env.identity.mfaEncryptionKey), 
        mfaEnabled: true 
      });
    }
    
    return res.json({ secret });
  } catch (error) { return next(error); }
}

function _authPayload(user, mfaVerified = null) {
  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
    ,departmentId: user.departmentId || null
    ,mfaEnabled: Boolean(user.mfaEnabled)
  };
  const verified = mfaVerified === null ? (!env.identity.mfaRequired || !safeUser.mfaEnabled) : mfaVerified;
  const token = jwt.sign({ ...safeUser, mfaVerified: verified }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  return { token, user: safeUser };
}

module.exports = { beginMfa, login, me, register, verifyMfa, getMfaSecret };
