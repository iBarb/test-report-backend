const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UploadedFile = require("../models/UploadedFile");
const auth = require("../middleware/auth");
const audit = require("../middleware/audit");

const router = express.Router();

// Configuración de Multer para guardar en carpeta local
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, "..", "uploads");
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    },
});

const upload = multer({ storage });

/**
 *  Subir archivo real y registrar en la BD
 */
router.post("/upload/:project_id", auth, upload.single("file"), async (req, res) => {
    try {
        const { project_id } = req.params;

        const file = await UploadedFile.create({
            project_id,
            user_id: req.user.user_id,
            file_name: req.file.originalname,
            file_type: req.file.mimetype,
            storage_path: req.file.path,
        });

        await audit("UploadedFile", "CREATE", null, file.toJSON(), req.user.user_id);

        res.json({
            message: "Archivo subido correctamente",
            file,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al subir archivo" });
    }
});

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
