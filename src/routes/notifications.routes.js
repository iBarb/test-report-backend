const express = require("express");
const Notification = require("../models/Notification");
const auth = require("../middleware/auth");
const audit = require("../middleware/audit");

const router = express.Router();

// Listar notificaciones del usuario
router.get("/", auth, async (req, res) => {
    const notes = await Notification.findAll({
        where: { user_id: req.user.id, is_deleted: false },
    });
    res.json(notes);
});

// Marcar como leído
router.put("/:id/read", auth, async (req, res) => {
    const note = await Notification.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: "No encontrado" });

    const oldValue = note.toJSON();
    await note.update({ status: "leído" });

    await audit("Notification", "UPDATE", oldValue, note.toJSON(), req.user.id);

    res.json(note);
});

module.exports = router;
