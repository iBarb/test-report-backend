const express = require("express");

const UploadedFile = require("../models/UploadedFile");
const auth = require("../middleware/auth");
const audit = require("../middleware/audit");

const router = express.Router();


/**
 *  Listar archivos de un proyecto
 */
router.get("/:project_id", auth, async (req, res) => {
    try {
        const files = await UploadedFile.findAll({
            where: { project_id: req.params.project_id, is_deleted: false },
        });

        res.json(files);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener archivos" });
    }
});

module.exports = router;
