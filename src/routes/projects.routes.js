const express = require("express");
const Project = require("../models/Project");
const ProjectUser = require("../models/ProjectUser");
const audit = require("../middleware/audit");
const auth = require("../middleware/auth");

const router = express.Router();

// Crear proyecto
router.post("/", auth, async (req, res) => {
    try {
        const project = await Project.create(req.body);
        await audit("Project", "CREATE", null, project.toJSON(), req.user.id);
        res.json(project);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Listar proyectos
router.get("/", auth, async (req, res) => {
    const projects = await Project.findAll({ where: { is_deleted: false } });
    res.json(projects);
});

// Ver proyecto
router.get("/:id", auth, async (req, res) => {
    const project = await Project.findOne({
        where: { project_id: req.params.id, is_deleted: false },
    });
    if (!project) return res.status(404).json({ error: "No encontrado" });
    res.json(project);
});

// Editar proyecto
router.put("/:id", auth, async (req, res) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ error: "No encontrado" });

    const oldValue = project.toJSON();
    await project.update(req.body);
    await audit("Project", "UPDATE", oldValue, project.toJSON(), req.user.id);

    res.json(project);
});

// Borrar (lógico)
router.delete("/:id", auth, async (req, res) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ error: "No encontrado" });

    await project.update({ is_deleted: true });
    await audit("Project", "DELETE", project.toJSON(), null, req.user.id);

    res.json({ success: true });
});

// Asignar usuario
router.post("/:id/users", auth, async (req, res) => {
    try {
        const { user_id, role_id, permissions, status } = req.body;
        const pu = await ProjectUser.create({
            project_id: req.params.id,
            user_id,
            role_id,
            permissions,
            status,
        });

        await audit("ProjectUser", "CREATE", null, pu.toJSON(), req.user.id);

        res.json(pu);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
