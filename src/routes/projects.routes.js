const express = require("express");
const Project = require("../models/Project");
const ProjectUser = require("../models/ProjectUser");
const audit = require("../middleware/audit");
const auth = require("../middleware/auth");
const { fn, col, Sequelize, Op } = require("sequelize");
const UploadedFile = require("../models/UploadedFile");
const sequelize = require("../config/db");
const User = require("../models/User");

const router = express.Router();

// Crear proyecto
router.post("/", auth, async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { name, description, start_date, end_date, status } = req.body;

        // 1️⃣ Crear el proyecto
        const project = await Project.create(
            {
                name,
                description,
                start_date,
                end_date,
                status,
                is_deleted: false,
            },
            { transaction }
        );

        // 2️⃣ Registrar también al usuario actual en ProjectUser
        await ProjectUser.create(
            {
                project_id: project.project_id,
                user_id: req.user.user_id,
                permissions: "admin",
                status: "activo",
                is_deleted: false,
            },
            { transaction }
        );

        // 3️⃣ Registrar auditoría
        await audit("Project", "CREATE", null, project.toJSON(), req.user.user_id, transaction);

        // 4️⃣ Confirmar todo
        await transaction.commit();

        res.json(project);
    } catch (err) {
        await transaction.rollback();
        res.status(500).json({ error: err.message });
    }
});

// Listar proyectos del usuario
router.get("/", auth, async (req, res) => {
    try {
        const userId = req.user.dataValues.user_id

        const projects = await Project.findAll({
            where: {
                is_deleted: false,
                // Solo proyectos donde el usuario tiene permisos
                [Sequelize.Op.and]: Sequelize.literal(`
                    EXISTS (
                        SELECT 1
                        FROM "ProjectUser" AS pu
                        WHERE pu.project_id = "Project".project_id
                        AND pu.user_id = ${userId}
                        AND pu.is_deleted = false
                    )
                `)
            },
            attributes: {
                include: [
                    [
                        Sequelize.literal(`(
                            SELECT COUNT(*)
                            FROM "UploadedFile" AS uf
                            WHERE uf.project_id = "Project".project_id
                            AND uf.is_deleted = false
                        )`),
                        "reports_count"
                    ],
                    [
                        Sequelize.literal(`(
                            SELECT COUNT(*)
                            FROM "ProjectUser" AS pu
                            WHERE pu.project_id = "Project".project_id
                            AND pu.is_deleted = false
                        )`),
                        "members_count"
                    ]
                ]
            }
        });

        res.json(projects);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error al listar proyectos" });
    }
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
    await audit("Project", "UPDATE", oldValue, project.toJSON(), req.user.user_id);

    res.json(project);
});

// Borrar (lógico)
router.delete("/:id", auth, async (req, res) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) return res.status(404).json({ error: "No encontrado" });

    await project.update({ is_deleted: true });
    await audit("Project", "DELETE", project.toJSON(), null, req.user.user_id);

    res.json({ success: true });
});

// Asignar usuario
router.post("/:id/users", auth, async (req, res) => {
    try {
        const { email, permissions } = req.body;

        // Validar que el email existe
        const userExists = await User.findOne({
            where: { email: email }
        });

        if (!userExists) {
            return res.status(404).json({
                error: "El correo no existe"
            });
        }

        // Validar que el correo no esté eliminado (soft delete)
        if (userExists.is_deleted) {
            return res.status(400).json({
                error: "El correo ha sido eliminado"
            });
        }

        // Validar que el correo esté activo
        if (!userExists.status) {
            return res.status(400).json({
                error: "El correo está inactivo"
            });
        }

        // Validar que el usuario no esté asignado a este proyecto
        const existingProjectUser = await ProjectUser.findOne({
            where: {
                project_id: req.params.id,
                user_id: userExists.user_id
            }
        });

        let pu;

        if (existingProjectUser) {
            // Si el usuario existe pero está eliminado, restaurarlo
            if (existingProjectUser.is_deleted) {
                existingProjectUser.is_deleted = false;
                existingProjectUser.permissions = permissions;
                await existingProjectUser.save();

                await audit("ProjectUser", "UPDATE", existingProjectUser.toJSON(), existingProjectUser.toJSON(), req.user.user_id);

                pu = existingProjectUser;
            } else {
                // Si el usuario existe y NO está eliminado, retornar error
                return res.status(409).json({
                    error: "El correo ya está asignado a este proyecto"
                });
            }
        } else {
            // Si no existe, crear uno nuevo
            pu = await ProjectUser.create({
                project_id: req.params.id,
                user_id: userExists.user_id,
                permissions,
            });

            await audit("ProjectUser", "CREATE", null, pu.toJSON(), req.user.user_id);
        }

        res.json(pu);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Listar usuarios asignados a un proyecto (dueño primero)
router.get("/:id/users", auth, async (req, res) => {
    try {
        const projectId = req.params.id;

        // 1️⃣ Obtener asignaciones activas (si quieres incluir eliminadas, quita el filtro)
        const projectUsers = await ProjectUser.findAll({
            where: {
                project_id: projectId,
                is_deleted: false,
            },
            raw: true,
        });

        // 2️⃣ Si no hay usuarios asignados
        if (projectUsers.length === 0) {
            return res.json([]);
        }

        // 3️⃣ Extraer IDs únicos de usuario
        const userIds = [...new Set(projectUsers.map(pu => pu.user_id))];

        // 4️⃣ Buscar usuarios activos y no eliminados
        const users = await User.findAll({
            where: {
                user_id: userIds,
                is_deleted: false,
            },
            attributes: ["user_id", "full_name", "email", "status"],
            raw: true,
        });

        // 5️⃣ Crear un mapa para acceso O(1)
        const userMap = Object.fromEntries(users.map(u => [u.user_id, u]));

        // 6️⃣ Combinar datos manualmente
        const result = projectUsers.map(pu => ({
            ...pu,
            user: userMap[pu.user_id] || null,
        }));

        // 7️⃣ Enviar respuesta
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Actualizar permisos de un usuario en el proyecto
router.put("/:id/users/:userId", auth, async (req, res) => {
    try {
        const { permissions } = req.body;


        // Buscar la asignación del usuario al proyecto
        const projectUser = await ProjectUser.findOne({
            where: {
                project_id: req.params.id,
                user_id: req.params.userId,
                is_deleted: false
            }
        });

        // Validar que la asignación existe
        if (!projectUser) {
            return res.status(404).json({
                error: "El usuario no está asignado a este proyecto"
            });
        }

        // Actualizar los permisos
        await projectUser.update({ permissions });

        res.json(projectUser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar usuario del proyecto (soft delete)
router.delete("/:id/users/:userId", auth, async (req, res) => {
    try {
        // Buscar la asignación del usuario al proyecto
        const projectUser = await ProjectUser.findOne({
            where: {
                project_id: req.params.id,
                user_id: req.params.userId,
                is_deleted: false
            }
        });

        // Validar que la asignación existe
        if (!projectUser) {
            return res.status(404).json({
                error: "El usuario no está asignado a este proyecto"
            });
        }

        // Soft delete: cambiar is_deleted a true
        await projectUser.update({ is_deleted: true });

        res.json({
            message: "Usuario eliminado del proyecto exitosamente",
            project_user_id: projectUser.project_user_id
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
