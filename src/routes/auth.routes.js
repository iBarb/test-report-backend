const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const validator = require("validator");
const User = require("../models/User");
const LoginTracking = require("../models/LoginTracking");
const audit = require("../middleware/audit");

const router = express.Router();

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
const TOKEN_EXPIRATION = process.env.JWT_EXPIRES_IN || "1h";

// Función auxiliar para generar JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user.user_id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRATION }
  );
};

// ===================== Registro =====================
router.post("/register", async (req, res) => {
  try {
    let { full_name, email, password } = req.body;

    // Validación básica
    if (!full_name || !email || !password) {
      return res.status(400).json({ status: "error", message: "Todos los campos son obligatorios" });
    }

    // Normalizar email
    email = email.trim().toLowerCase();

    // Validar formato de email
    if (!validator.isEmail(email)) {
      return res.status(400).json({ status: "error", message: "Correo inválido" });
    }

    // Verificar si ya existe usuario
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ status: "error", message: "El correo ya está registrado" });
    }

    // Validar contraseña mínima
    if (password.length < 8) {
      return res.status(400).json({ status: "error", message: "La contraseña debe tener al menos 8 caracteres" });
    }

    // Hashear password
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Crear usuario
    const user = await User.create({
      full_name,
      email,
      password_hash: hash,
    });

    // Registrar auditoría (si falla, no rompe el flujo principal)
    try {
      await audit("User", "CREATE", null, user.toJSON(), user.user_id);
    } catch (auditErr) {
      console.error("Error en auditoría:", auditErr.message);
    }

    // Generar token de sesión
    const token = generateToken(user);

    // Guardar tracking de login automático
    try {
      await LoginTracking.create({
        user_id: user.user_id,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
        login_time: new Date(),
      });
    } catch (trackErr) {
      console.error("Error en login tracking:", trackErr.message);
    }

    // Retornar usuario + token
    res.status(201).json({
      status: "success",
      message: "Usuario registrado con éxito",
      data: {
        token,
        user: {
          id: user.user_id,
          full_name: user.full_name,
          email: user.email,
        },
      },
    });
  } catch (err) {
    console.error("Error en /register:", err.message);
    res.status(500).json({ status: "error", message: "Error en el servidor" });
  }
});

// ===================== Login =====================
router.post("/login", async (req, res) => {
  try {
    let { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ status: "error", message: "Correo y contraseña son obligatorios" });
    }

    // Normalizar email
    email = email.trim().toLowerCase();

    const user = await User.findOne({ where: { email, is_deleted: false } });
    if (!user) {
      return res.status(401).json({ status: "error", message: "Credenciales inválidas" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ status: "error", message: "Credenciales inválidas" });
    }

    const token = generateToken(user);

    // Tracking de login
    try {
      await LoginTracking.create({
        user_id: user.user_id,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
        login_time: new Date(),
      });
    } catch (trackErr) {
      console.error("Error en login tracking:", trackErr.message);
    }

    res.json({
      status: "success",
      message: "Inicio de sesión exitoso",
      data: {
        token,
        user: {
          id: user.user_id,
          full_name: user.full_name,
          email: user.email,
        },
      },
    });
  } catch (err) {
    console.error("Error en /login:", err.message);
    res.status(500).json({ status: "error", message: "Error en el servidor" });
  }
});

module.exports = router;
