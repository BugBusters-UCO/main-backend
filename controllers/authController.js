const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const env = require("../config/env");
const { User } = require("../models");

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

function _authPayload(user) {
  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
  const token = jwt.sign(safeUser, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  return { token, user: safeUser };
}

module.exports = { login, me, register };
