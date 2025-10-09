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
const { Sequelize } = require("sequelize");

const router = express.Router();

// Configuración de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: {
        temperature: 0.4,
    }
});

// Función auxiliar: validar formato de archivo
const isValidFormat = (filename) => {
    const allowedExtensions = [".xml", ".json", ".html", ".csv", ".txt", ".log"];
    return allowedExtensions.includes(path.extname(filename).toLowerCase());
};

// Función auxiliar: procesar respuesta de Gemini
const processGeminiResponse = (text) => {
    if (text.includes("[ERROR]")) {
        const cleanText = text.replace(/\[ERROR\].*/i, "").trim();
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

// Prompt base
const buildPrompt = (fileContent, userPrompt = "", UserName = "") => `
    Eres un asistente experto en pruebas de software y en la norma ISO/IEC/IEEE 29119-3. Tu tarea es procesar un archivo de resultados de pruebas:
    ${fileContent}

    Instrucciones:
    Verifica que el archivo tenga un formato compatible con herramientas de testing, como XML, JSON, HTML, CSV, TXT o logs.

    Si el formato no es válido, devuelve únicamente:
    [ERROR] (Indica por qué no se aceptó el archivo)

    Si el Formato es aceptado 
    Extrae los datos relevantes y genera únicamente la información siguiendo los formatos de ISO/IEC/IEEE 29119-3.
    El TEL debe ser uno u contener todas las ejecuciones de prueba. El TIR debe ser uno para cada ejecucion fallida.

    -El usuario que revisa el informe es "${UserName}"
    -El archivo es preparado por "QA Automation System"
    -El informe es de ${fileContent}
    -La introduccion debe tener al menos 100 a 250 palabras
    -Los codigoos de TIR deben ser INC-001, INC-002, INC-003, etc.

    Solo retorna Formato de salida sin nada mas, sin formatear. agrega todos los testIncidentReports que sean necesarios.

    Formato de salida:

    [CONTEO]
    {
        Ejecuciones: "", // numero de ejecuciones totales
        Exitosas: "", // numero de ejecuciones exitosas
        Fallidas: "", // numero de ejecuciones fallidas
    }

    [TEL]
    {
    "documentApprovalHistory": { "preparedBy": "", "Reviewed By": "", "Approved By": "" },
    "documentRevisionHistory": [
        { "date": "", "documentVersion": "", "revisionDescription": "", "author": "" }
    ],
    "introduction": "",
    "testExecutionLog": [
        { "testCaseId": "", "testCaseDescription": "", "status": "Passed|Failed|Blocked|Skipped", "executionStart": "", "executionEnd": "", "durationMs": , "tester": "", "defectId": , "comments": "" }
    ]
    }

    [TIR]
    {
    "documentApprovalHistory": { "preparedBy": "", "Reviewed By": "",, "Approved By": "" },
    "documentRevisionHistory": [
        { "date": "", "documentVersion": "", "revisionDescription": "", "author": "" }
    ],
    "introduction": "",
    "testIncidentReports": [
        {
            "generalInformation": {
                "projectName": "",
                "testLevel": "Unit|Integration|System|Performance|Acceptance|Other",
                "incidentDate": "",
                "incidentNumber": "",
                "testCaseId": "",
                "application": "",
                "buildVersion": ""
            },
            "incidentDetails": {
                "dateTime": "",
                "originatorAndTitle": "",
                "environmentInformation": "",
                "incidentDescription": "",
                "expectedResults": "",
                "actualResults": "",
                "variance": "",
                "severity": "Alto|Medio|Bajo",
                "priority": "Alto|Medio|Bajo",
                "risk": "",
                "incidentStatus": "Abierto|Aprobado para resolución|Corregido|Reevaluado y confirmado|Cerrado|Rechazado|Retirado"
            }
        }
    ]
    }

    Instrucción adicional del usuario:
    ${userPrompt || "Genera un reporte técnico estándar"}
    `;

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

                if (fullText.length > 1000000) {
                    console.warn("⚠️ Respuesta muy larga, truncando...");
                    break;
                }
            }

            if (fullText.length < 50) {
                throw new Error("Respuesta vacía o muy corta");
            }

            console.log(`✅ Generación exitosa: ${fullText.length} caracteres`);
            return fullText;

        } catch (error) {
            console.error(`❌ Error en intento ${attempt}:`, error.message);

            if (attempt === maxRetries) {
                throw new Error(`Falló después de ${maxRetries} intentos: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
};

// 🔥 PROCESAMIENTO EN BACKGROUND CON NOTIFICACIONES
const processReportInBackground = async (reportId, fileContent, prompt, userId, title, full_name) => {
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

        const fullPrompt = buildPrompt(fileContent, prompt, full_name);
        const geminiText = await generateGeminiResponse(fullPrompt);
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
        const report = await Report.findByPk(req.params.report_id);
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
router.put("/:report_id", auth, async (req, res) => {
    try {
        const { title, status, prompt, file_id } = req.body;
        const report = await Report.findByPk(req.params.report_id);

        if (!report) {
            return res.status(404).json({ error: "Reporte no encontrado" });
        }

        // Caso 1: Solo actualizar título/estado
        if (!prompt && !file_id) {
            await report.update({ title, status });
            return res.json({ message: "Reporte actualizado", report });
        }

        // Caso 2: Regenerar
        let fileContent;
        if (file_id) {
            const file = await UploadedFile.findByPk(file_id);
            if (!file) return res.status(404).json({ error: "Archivo no encontrado" });
            if (!isValidFormat(file.file_name)) {
                return res.status(400).json({ error: "Formato no permitido" });
            }
            fileContent = fs.readFileSync(file.storage_path, "utf-8");
            await report.update({ file_id });
        } else {
            const file = await UploadedFile.findByPk(report.file_id);
            fileContent = fs.readFileSync(file.storage_path, "utf-8");
        }

        const reportTitle = title || report.title;
        await report.update({
            status: "Pendiente",
            title: reportTitle
        });

        // Calcular nueva versión
        const lastHistory = await ReportHistory.findOne({
            where: { report_id: report.report_id },
            order: [["version", "DESC"]],
        });
        const newVersion = (lastHistory?.version || 0) + 1;

        // Procesar en background
        setImmediate(async () => {
            try {
                await report.update({ status: "En progreso" });
                await NotificationService.reportInProgress(
                    req.user.user_id,
                    report.report_id,
                    reportTitle
                );

                const fullPrompt = buildPrompt(fileContent, prompt, req.user.full_name);
                const geminiText = await generateGeminiResponse(fullPrompt);
                const processed = processGeminiResponse(geminiText);

                if (!processed.isError) {
                    await ReportHistory.create({
                        report_id: report.report_id,
                        version: newVersion,
                        prompt: prompt || null,
                        content: processed.content,
                        created_by: req.user.user_id,
                    });

                    await report.update({
                        content: processed.content,
                        status: "Completado"
                    });

                    await NotificationService.reportCompleted(
                        req.user.user_id,
                        report.report_id,
                        reportTitle
                    );
                } else {
                    await report.update({ status: "Fallido" });
                    await NotificationService.reportFailed(
                        req.user.user_id,
                        report.report_id,
                        reportTitle,
                        processed.content
                    );
                }
            } catch (error) {
                console.error("Error en regeneración:", error);
                await report.update({ status: "Fallido" });
                await NotificationService.reportFailed(
                    req.user.user_id,
                    report.report_id,
                    reportTitle,
                    error.message
                );
            }
        });

        res.status(202).json({
            message: "Regeneración iniciada",
            report: report.toJSON(),
            pollUrl: `/reports/${report.report_id}`
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al editar reporte" });
    }
});

/**
 * 5. Listar historial
 */
router.get("/:report_id/history", auth, async (req, res) => {
    try {
        const history = await ReportHistory.findAll({
            where: { report_id: req.params.report_id },
            order: [["version", "ASC"]],
        });
        res.json(history);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al obtener historial" });
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