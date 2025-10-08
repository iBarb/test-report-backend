const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async (req, res, next) => {
    try {
        // Obtener el token desde los headers
        const token = req.headers["authorization"]?.split(" ")[1];
        if (!token) {
            return res.status(401).json({ error: "Token no encontrado" });
        }

        // Verificar token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");

        // Buscar usuario en la base de datos
        const user = await User.findOne({
            where: { user_id: decoded.id },
            attributes: ["user_id", "email", "is_deleted", "status"] // Ajusta según tus columnas reales
        });

        // Validar existencia
        if (!user) {
            return res.status(403).json({ error: "Usuario no encontrado" });
        }

        // Verificar si el usuario está eliminado o inactivo
        if (user.is_deleted || user.status === false) {
            return res.status(403).json({ error: "Usuario inactivo o eliminado" });
        }

        // Guardar info del usuario en la request
        req.user = user;

        // Continuar con la ruta
        next();
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ error: "Token expirado" });
        }
        return res.status(403).json({ error: "Token inválido" });
    }
};
