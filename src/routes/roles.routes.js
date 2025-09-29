const express = require("express");
const Role = require("../models/Role");
const auth = require("../middleware/auth");
const audit = require("../middleware/audit");

const router = express.Router();

router.get("/", auth, async (req, res) => {
    const roles = await Role.findAll({ where: { is_deleted: false } });
    res.json(roles);
});

router.post("/", auth, async (req, res) => {
    const role = await Role.create(req.body);
    await audit("Role", "CREATE", null, role.toJSON(), req.user.id);
    res.json(role);
});

router.put("/:id", auth, async (req, res) => {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "No encontrado" });

    const oldValue = role.toJSON();
    await role.update(req.body);
    await audit("Role", "UPDATE", oldValue, role.toJSON(), req.user.id);

    res.json(role);
});

router.delete("/:id", auth, async (req, res) => {
    const role = await Role.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: "No encontrado" });

    await role.update({ is_deleted: true });
    await audit("Role", "DELETE", role.toJSON(), null, req.user.id);

    res.json({ success: true });
});

module.exports = router;
