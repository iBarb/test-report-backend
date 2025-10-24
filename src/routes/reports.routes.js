const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const UploadedFile = require("../models/UploadedFile");
const Report = require("../models/Report");
const ReportHistory = require("../models/ReportHistory");
const NotificationService = require("../services/notificationService");

const auth = require("../middleware/auth");
const audit = require("../middleware/audit");
const { Sequelize, QueryTypes } = require("sequelize");
const User = require("../models/User");
const sequelize = require("../config/db");
const { buildPrompt, buildVersioningPrompt } = require("../services/promptService");

const router = express.Router();

// Configuración de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: {
        temperature: 0.7,
    }
});

// Función auxiliar: validar formato de archivo
const isValidFormat = (filename) => {
    const allowedExtensions = [".xml", ".json", ".html", ".csv", ".txt", ".log"];
    return allowedExtensions.includes(path.extname(filename).toLowerCase());
};

// Función auxiliar: limpiar markdown de la respuesta
function cleanMarkdown(response) {
    // Solo limpiar si hay markdown presente
    const hasMarkdown = response.includes('```');

    if (hasMarkdown) {
        // Eliminar backticks y etiquetas json
        response = response.replace(/```json\n?/g, '');
        response = response.replace(/```\n?/g, '');
        response = response.trim();
    }

    // Asegurar que empieza con [CONTEO] o [ERROR]
    const conteoIndex = response.indexOf('[CONTEO]');
    const errorIndex = response.indexOf('[ERROR]');

    if (conteoIndex > 0) {
        response = response.substring(conteoIndex);
    } else if (errorIndex > 0) {
        response = response.substring(errorIndex);
    }

    return response;
}


// Función auxiliar: procesar respuesta de Gemini
const processGeminiResponse = (text) => {
    // text = cleanMarkdown(text);

    if (text.includes("[ERROR]")) {
        const cleanText = text.replace(/^\[ERROR\]\s*/i, "").trim();
        return { isError: true, content: cleanText };
    }
    return { isError: false, content: text };
};

// Crear carpeta de uploads
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configurar Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedExtensions = [".xml", ".json", ".html", ".csv", ".txt", ".log"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`Formato no permitido: ${ext}`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Generación con streaming
const generateGeminiResponse = async (prompt) => {
    const maxRetries = 2;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            attempt++;
            console.log(`🔄 Intento ${attempt}/${maxRetries} de generación...`);

            let fullText = "";
            const result = await model.generateContentStream(prompt);

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                fullText += chunkText;

                if (fullText.length > 10000000) {
                    console.warn("⚠️ Respuesta muy larga, truncando...");
                    break;
                }
            }

            console.log(`✅ Generación exitosa: ${fullText.length} caracteres`);
            return fullText;

        } catch (error) {
            console.error(`❌ Error en intento ${attempt}:`, error.message);

            if (attempt === maxRetries) {
                throw new Error(`${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
};

// 🔥 PROCESAMIENTO EN BACKGROUND CON NOTIFICACIONES
const processReportInBackground = async (reportId, fileContent, prompt, userId, title, full_name,) => {
    const startTime = Date.now();

    try {
        console.log(`🚀 Procesando reporte ${reportId} en background...`);

        const report = await Report.findByPk(reportId);
        if (!report) {
            console.error(`❌ Reporte ${reportId} no encontrado`);
            return;
        }

        // Notificar inicio
        await report.update({ status: "En progreso" });
        await NotificationService.reportInProgress(userId, reportId, title);

        const fullPrompt = buildPrompt(fileContent, prompt, full_name, reportId, title);
        const geminiText = await generateGeminiResponse(fullPrompt);
        console.log(geminiText);

        const processed = processGeminiResponse(geminiText);

        if (processed.isError) {
            await report.update({
                status: "Fallido",
                content: processed.content || "Error al procesar archivo"
            });

            // Notificar fallo
            await NotificationService.reportFailed(
                userId,
                reportId,
                title,
                processed.content || "Error al procesar archivo"
            );
            return;
        }

        // Guardar historial
        await ReportHistory.create({
            report_id: reportId,
            version: 1,
            prompt: prompt || null,
            duration: Date.now() - startTime,
            content: processed.content,
            created_by: userId,
        });

        await report.update({
            content: processed.content,
            status: "Completado",
            duration: Date.now() - startTime
        });

        // Notificar éxito
        await NotificationService.reportCompleted(userId, reportId, title);

        console.log(`✅ Reporte ${reportId} completado`);

    } catch (error) {
        console.error(`❌ Error procesando reporte ${reportId}:`, error);

        try {
            const report = await Report.findByPk(reportId);
            if (report) {
                await report.update({
                    status: "Fallido",
                    content: `Error: ${error.message}`
                });

                // Notificar error
                await NotificationService.reportFailed(
                    userId,
                    reportId,
                    title,
                    error.message
                );
            }
        } catch (updateError) {
            console.error("Error actualizando estado fallido:", updateError);
        }
    }
};


/**
 * Procesamiento en background para versionado
 */
const processReportVersioningInBackground = async (
    reportId,
    newFileContent,
    previousContent,
    userPrompt,
    userName,
    userId,
    title,
    newFileId,
    history_id
) => {
    const startTime = Date.now();

    try {
        console.log(`🔄 Versionando reporte ${reportId}...`);

        const report = await Report.findByPk(reportId);
        if (!report) {
            console.error(`❌ Reporte ${reportId} no encontrado`);
            return;
        }

        // Obtener número de versión
        const lastVersion = await ReportHistory.findOne({
            where: { report_id: reportId },
            order: [['version', 'DESC']]
        });

        const newVersion = (lastVersion?.version || 0) + 1;

        // Construir prompt de versionado
        const versioningPrompt = buildVersioningPrompt(
            newFileContent,
            previousContent,
            userPrompt,
            userName,
            reportId,
            title
        );

        // Generar nueva versión con IA
        const geminiText = await generateGeminiResponse(versioningPrompt);
        console.log(versioningPrompt);

        const processed = processGeminiResponse(geminiText);

        if (processed.isError) {
            await report.update({
                status: "Completado"
            });

            await NotificationService.reportFailed(
                userId,
                reportId,
                title,
                processed.content || "Error al versionar reporte"
            );
            return;
        }

        // Crear nueva entrada en historial
        await ReportHistory.create({
            report_id: reportId,
            version: newVersion,
            content: processed.content,
            prompt: userPrompt || null,
            duration: Date.now() - startTime,
            created_by: userId,
        });

        // // Actualizar reporte principal
        const updates = {
            content: processed.content,
            status: "Completado",
            duration: Date.now() - startTime,
            updated_at: new Date()
        };

        if (newFileId) {
            updates.file_id = newFileId;
        }

        await report.update(updates);

        // Auditar cambios
        await audit("Report", "VERSION", previousContent, processed.content, userId);

        // Notificar éxito
        await NotificationService.reportCompleted(userId, reportId, title);

        console.log(`✅ Reporte ${reportId} versionado exitosamente (v${newVersion})`);

    } catch (error) {
        console.error(`❌ Error versionando reporte ${reportId}:`, error);

        const report = await Report.findByPk(reportId);

        await report.update({
            status: "Completado"
        });

        await NotificationService.reportFailed(
            userId,
            reportId,
            title,
            error.message
        );
    }
};

/**
 * 1. Generar Report (RESPUESTA INMEDIATA + PROCESAMIENTO ASYNC)
 */
router.post("/upload/:project_id", auth, upload.single("file"), async (req, res) => {
    try {
        const { project_id } = req.params;
        const { title, prompt } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: "No se proporcionó archivo" });
        }

        // Guardar archivo
        const file = await UploadedFile.create({
            project_id,
            user_id: req.user.user_id,
            file_name: req.file.originalname,
            file_type: req.file.mimetype,
            storage_path: req.file.path,
        });

        await audit("UploadedFile", "CREATE", null, file.toJSON(), req.user.user_id);

        // Validar formato
        if (!isValidFormat(file.file_name)) {
            return res.status(400).json({
                message: `Formato no permitido: ${file.file_name}`,
                allowedFormats: [".xml", ".json", ".html", ".csv", ".txt", ".log"]
            });
        }

        // Leer contenido
        const fileContent = fs.readFileSync(file.storage_path, "utf-8");

        // Crear reporte
        const reportTitle = title || `Reporte ${new Date().toISOString().split('T')[0]}`;
        const report = await Report.create({
            file_id: file.file_id,
            generated_by: req.user.user_id,
            title: reportTitle,
            prompt: prompt || null,
            content: "",
            status: "Pendiente",
        });

        await audit("Report", "CREATE", null, report.toJSON(), req.user.user_id);

        // Buscar información completa del usuario
        const User = require("../models/User");
        const user = await User.findByPk(req.user.user_id);
        const fullName = user?.full_name || "Usuario Desconocido";

        // Procesar en background
        setImmediate(() => {
            processReportInBackground(
                report.report_id,
                fileContent,
                prompt,
                req.user.user_id,
                reportTitle,
                fullName
            );
        });

        // Respuesta inmediata
        res.status(202).json({
            message: "Archivo subido. El reporte se está generando en segundo plano.",
            file: {
                file_id: file.file_id,
                file_name: file.file_name,
                file_type: file.file_type
            },
            report: {
                report_id: report.report_id,
                title: report.title,
                status: "Pendiente"
            },
            pollUrl: `/reports/${report.report_id}`
        });

    } catch (error) {
        console.error("❌ Error en upload:", error);
        res.status(500).json({
            error: "Error al subir archivo",
            details: error.message
        });
    }
});

/**
 * 2. Listar reportes de un proyecto
 */
router.get("/project/:project_id", auth, async (req, res) => {
    const projectId = req.params.project_id;
    try {
        const reports = await UploadedFile.findAll({
            where: {
                is_deleted: false,
                project_id: projectId,
                [Sequelize.Op.and]: Sequelize.literal(`
                    EXISTS (
                        SELECT 1
                        FROM "Project" AS p
                        WHERE p.project_id = "UploadedFile".project_id
                        AND p.is_deleted = false
                    )
                `)
            },
            attributes: {
                include: [
                    [
                        Sequelize.literal(`(
                            SELECT json_build_object(
                                'report_id', r.report_id,
                                'file_id', r.file_id,
                                'generated_by', r.generated_by,
                                'title', r.title,
                                'content', r.content,
                                'prompt', r.prompt,
                                'status', r.status,
                                'is_deleted', r.is_deleted,
                                'duration', r.duration,
                                'created_at', r.created_at,
                                'updated_at', r.updated_at
                            )
                            FROM "Report" AS r
                            WHERE r.file_id = "UploadedFile".file_id
                            AND r.is_deleted = false
                        )`),
                        'report'
                    ]
                ]
            },
            order: [["uploaded_at", "DESC"]],
        });

        const onlyReports = reports
            .map(file => file.dataValues.report)
            .filter(report => report !== null);

        res.json(onlyReports);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al listar reportes" });
    }
});

/** 
 * 3. Ver detalle de un reporte
 */
router.get("/:report_id", auth, async (req, res) => {
    try {
        const report = await Report.findOne({
            where: {
                report_id: req.params.report_id,
                is_deleted: false
            }
        });

        if (!report) {
            return res.status(404).json({ error: "Reporte no encontrado" });
        }

        res.json({
            ...report.toJSON(),
            isProcessing: report.status === "En progreso",
            isCompleted: report.status === "Completado",
            isFailed: report.status === "Fallido"
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener reporte" });
    }
});

/**
 * 4. Editar reporte
 */
router.put("/:report_id", auth, upload.single("file"), async (req, res) => {
    try {
        const { report_id } = req.params;
        const { title, prompt, history_id, project_id } = req.body;

        // Buscar reporte
        const report = await Report.findByPk(report_id);
        if (!report) {
            return res.status(404).json({ error: "Reporte no encontrado" });
        }


        // CASO 1: Solo actualizar título o estado (sin versionado)
        const hasFile = req.file !== undefined;
        const hasPrompt = prompt && prompt.trim() !== "";

        if (!hasFile && !hasPrompt) {
            // Solo actualizar campos simples
            const updates = {};
            if (title) updates.title = title;
            updates.updated_at = new Date();

            await report.update(updates);
            await audit("Report", "UPDATE", { title }, report.toJSON(), req.user.user_id);

            return res.json({
                message: "Reporte actualizado exitosamente.",
                status: 'Completado',
                report
            });
        }

        // CASO 2: Versionado con archivo y/o prompt
        if (!history_id) {
            return res.status(400).json({
                error: "Se requiere history_id para versionar el reporte"
            });
        }

        // Buscar versión previa
        const previousHistory = await ReportHistory.findByPk(history_id);

        if (!previousHistory || previousHistory.report_id !== parseInt(report_id)) {
            return res.status(404).json({
                error: "Versión previa no encontrada o no pertenece a este reporte"
            });
        }

        const previousContent = previousHistory.content;

        // Procesar archivo nuevo si existe
        let newFileContent = "";
        let newFile = null;

        if (hasFile) {
            // Validar formato
            if (!isValidFormat(req.file.originalname)) {
                // Eliminar archivo temporal
                fs.unlinkSync(req.file.path);
                return res.status(400).json({
                    message: `Formato no permitido: ${req.file.originalname}`,
                    allowedFormats: [".xml", ".json", ".html", ".csv", ".txt", ".log"]
                });
            }

            // Leer contenido del nuevo archivo
            newFileContent = fs.readFileSync(req.file.path, "utf-8");

            // ✨ COMPARAR SI EL ARCHIVO ES EL MISMO
            // Obtener el archivo anterior de la versión previa
            if (report.file_id) {
                const previousFile = await UploadedFile.findByPk(report.file_id);

                if (previousFile && fs.existsSync(previousFile.storage_path)) {
                    const previousFileContent = fs.readFileSync(previousFile.storage_path, "utf-8");

                    // Comparar contenido
                    if (newFileContent === previousFileContent) {
                        // Eliminar archivo temporal subido
                        fs.unlinkSync(req.file.path);

                        return res.status(400).json({
                            error: "El archivo es el mismo. Use contexto adicional para esos ajustes.",
                        });
                    }
                }
            }

            // Guardar nuevo archivo en BD
            newFile = await UploadedFile.create({
                project_id: project_id,
                user_id: req.user.user_id,
                file_name: req.file.originalname,
                file_type: req.file.mimetype,
                storage_path: req.file.path,
            });

            await audit("UploadedFile", "CREATE", null, newFile.toJSON(), req.user.user_id);
        }

        // Obtener información del usuario
        const user = await User.findByPk(req.user.user_id);
        const fullName = user?.full_name || "Usuario Desconocido";

        const reportUpdates = {
            status: "En progreso",
            updated_at: new Date()
        };

        if (title) {
            reportUpdates.title = title;
        }

        // Actualizar estado a "En progreso"
        await report.update(reportUpdates);

        // Notificar inicio
        await NotificationService.reportInProgress(
            req.user.user_id,
            report_id,
            title || report.title
        );

        // Procesar versionado en background
        setImmediate(() => {
            processReportVersioningInBackground(
                report_id,
                newFileContent,
                previousContent,
                prompt,
                fullName,
                req.user.user_id,
                title || report.title,
                newFile?.file_id,
                history_id
            );
        });

        // Respuesta inmediata
        res.status(202).json({
            message: "El reporte se está versionando en segundo plano.",
            status: "En progreso",
        });

    } catch (error) {
        console.error("❌ Error en edición de reporte:", error);
        res.status(500).json({
            error: "Error al editar reporte",
            details: error.message
        });
    }
});

/**
 * 5. Listar historial de reportes con información de usuarios
 */
router.get("/:report_id/history", auth, async (req, res) => {
    try {
        const history = await ReportHistory.findAll({
            where: { report_id: req.params.report_id },
            order: [["version", "DESC"]],
            raw: true,
        });

        const userIds = [...new Set(history.map(h => h.created_by).filter(Boolean))];

        if (userIds.length === 0) {
            return res.json(history.map(h => ({ ...h, created_by_name: null })));
        }

        const users = await User.findAll({
            where: { user_id: userIds },
            attributes: ["user_id", "full_name"],
            raw: true,
        });

        const userMap = new Map(users.map(u => [u.user_id, u.full_name]));

        res.json(history.map(h => ({
            ...h,
            created_by: userMap.get(h.created_by) || null
        })));

    } catch (error) {
        console.error("Error al obtener historial:", error);
        res.status(500).json({ error: "Error al obtener el historial" });
    }
});

/**
 * 6. Eliminar reporte (soft delete)
 */
router.delete("/:report_id", auth, async (req, res) => {
    try {
        const report = await Report.findByPk(req.params.report_id);

        if (!report) {
            return res.status(404).json({ error: "Reporte no encontrado" });
        }

        if (report.is_deleted) {
            return res.status(400).json({ error: "El reporte ya está eliminado" });
        }

        const oldReport = report.toJSON();

        // Soft delete
        await report.update({
            is_deleted: true,
            updated_at: new Date()
        });

        await audit("Report", "DELETE", oldReport, report.toJSON(), req.user.user_id);

        res.json({
            message: "Reporte eliminado exitosamente",
            report_id: report.report_id
        });

    } catch (error) {
        console.error("❌ Error al eliminar reporte:", error);
        res.status(500).json({
            error: "Error al eliminar reporte",
            details: error.message
        });
    }
});

module.exports = router;