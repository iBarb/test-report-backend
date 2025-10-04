const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const UploadedFile = require("../models/UploadedFile");
const Report = require("../models/Report");
const ReportHistory = require("../models/ReportHistory");

const auth = require("../middleware/auth");
const audit = require("../middleware/audit");

const router = express.Router();

// 📌 Configuración de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 🔥 Usar modelo más ligero y eficiente
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-pro",
    generationConfig: {
        temperature: 0.4,
    }
});

// 🔹 Función auxiliar: validar formato de archivo
const isValidFormat = (filename) => {
    const allowedExtensions = [".xml", ".json", ".html", ".csv", ".txt", ".log"];
    return allowedExtensions.includes(path.extname(filename).toLowerCase());
};

// 🔹 Función auxiliar: procesar respuesta de Gemini
const processGeminiResponse = (text) => {
    if (text.includes("[ERROR]")) {
        const cleanText = text.replace(/\[ERROR\].*/i, "").trim();
        return { isError: true, content: cleanText };
    }
    return { isError: false, content: text };
};

// 🔥 1. CREAR CARPETA SI NO EXISTE
const uploadDir = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log("✅ Carpeta 'uploads' creada");
}

// 🔥 2. CONFIGURAR MULTER
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

// 🔥 3. FILTRO DE ARCHIVOS (¡ESTO FALTABA!)
const fileFilter = (req, file, cb) => {
    const allowedExtensions = [".xml", ".json", ".html", ".csv", ".txt", ".log"];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(ext)) {
        cb(null, true); // Aceptar
    } else {
        cb(new Error(`Formato no permitido: ${ext}`), false); // Rechazar
    }
};

// 🔥 4. INICIALIZAR MULTER
const upload = multer({
    storage: storage,
    fileFilter: fileFilter, // ✅ Ahora sí existe
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB
    }
});

// 🔹 Prompt base (OPTIMIZADO - más corto)
const buildPrompt = (fileContent, userPrompt = "") => `
    Eres un asistente experto en pruebas de software y en la norma ISO/IEC/IEEE 29119-3. Tu tarea es procesar un archivo de resultados de pruebas:
    ${fileContent}

    Instrucciones:
    Verifica que el archivo tenga un formato compatible con herramientas de testing, como XML, JSON, HTML, CSV, TXT o logs.

    Si el formato no es válido, devuelve únicamente:
    [ERROR] (Indica por qué no se aceptó el archivo)

    Si el Formato es aceptado 
    Extrae los datos relevantes y genera únicamente la información siguiendo los formatos de ISO/IEC/IEEE 29119-3.
    El TEL debe ser uno u contener todas las ejecuciones de prueba. El TIR debe ser uno para cada ejecucion fallida.

    Solo retorna Formato de salida sin nada mas, sin formatear. agrega todos los [TIR] que sean necesarios.

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
    "introduction": "Breve definición de Test Execution Log según ISO/IEC/IEEE 29119-3: documento que registra la ejecución de casos de prueba, incluyendo resultados, defectos y observaciones.",
    "testExecutionLog": [
        { "testCaseId": "", "testCaseDescription": "", "status": "", "executionStart": "", "executionEnd": "", "durationMs": , "tester": "", "defectId": , "comments": "" }
    ]
    }

    [TIR]
    {
    "documentApprovalHistory": { "preparedBy": "", "Reviewed By": "", "Approved By": "" },
    "documentRevisionHistory": [
        { "date": "", "documentVersion": "", "revisionDescription": "", "author": "" }
    ],
    "introduction": "Plantilla de Informe de Incidente de Prueba (Test Incident Report) para registrar incidentes durante los diferentes niveles de prueba según ISO/IEC/IEEE 29119-3.",
    "testIncidentReports": [
        {
        "generalInformation": {
            "projectName": "",
            "testLevel": "Unitario|Integración|Sistema|Rendimiento|Aceptación|Otro",
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

// 🔥 GENERACIÓN CON STREAMING Y MANEJO DE ERRORES ROBUSTO
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

                // 🔥 LÍMITE de seguridad para evitar memoria infinita
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

            // Esperar antes de reintentar
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
};

// 🔥 FUNCIÓN DE PROCESAMIENTO EN BACKGROUND
const processReportInBackground = async (reportId, fileContent, prompt, userId) => {
    try {
        console.log(`🚀 Procesando reporte ${reportId} en background...`);

        const report = await Report.findByPk(reportId);
        if (!report) {
            console.error(`❌ Reporte ${reportId} no encontrado`);
            return;
        }

        await report.update({ status: "En progreso" });

        const fullPrompt = buildPrompt(fileContent, prompt);
        const geminiText = await generateGeminiResponse(fullPrompt);
        const processed = processGeminiResponse(geminiText);
        console.log(`✅ Generación exitosa: ${geminiText.length} caracteres`);

        if (processed.isError) {
            await report.update({
                status: "failed",
                content: processed.content || "Error al procesar archivo"
            });
            return;
        }

        // Guardar historial
        await ReportHistory.create({
            report_id: reportId,
            version: 1,
            prompt: prompt || null,
            content: processed.content,
            created_by: userId,
        });

        await report.update({
            content: processed.content,
            status: "Completado"
        });

        console.log(`✅ Reporte ${reportId} completado`);

    } catch (error) {
        console.error(`❌ Error procesando reporte ${reportId}:`, error);

        try {
            const report = await Report.findByPk(reportId);
            if (report) {
                await report.update({
                    status: "failed",
                    content: `Error: ${error.message}`
                });
            }
        } catch (updateError) {
            console.error("Error actualizando estado fallido:", updateError);
        }
    }
};

/**
 * 📌 1. Generar Report (RESPUESTA INMEDIATA + PROCESAMIENTO ASYNC)
 */
router.post("/upload/:project_id", auth, upload.single("file"), async (req, res) => {
    try {
        const { project_id } = req.params;
        const { title, prompt } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: "No se proporcionó archivo" });
        }

        // 1️⃣ Guardar archivo
        const file = await UploadedFile.create({
            project_id,
            user_id: req.user.user_id,
            file_name: req.file.originalname,
            file_type: req.file.mimetype,
            storage_path: req.file.path,
        });

        await audit("UploadedFile", "CREATE", null, file.toJSON(), req.user.user_id);

        // 2️⃣ Validar formato
        if (!isValidFormat(file.file_name)) {
            return res.status(400).json({
                message: `Formato no permitido: ${file.file_name}`,
                allowedFormats: [".xml", ".json", ".html", ".csv", ".txt", ".log"]
            });
        }

        // 3️⃣ Leer contenido
        const fileContent = fs.readFileSync(file.storage_path, "utf-8");

        // 4️⃣ Crear reporte con estado "En progreso"
        const report = await Report.create({
            file_id: file.file_id,
            generated_by: req.user.user_id,
            title: title || `Reporte ${new Date().toISOString().split('T')[0]}`,
            prompt: prompt || null,
            content: "",
            status: "En progreso",
        });

        await audit("Report", "CREATE", null, report.toJSON(), req.user.user_id);

        // 🔥 5️⃣ PROCESAR EN BACKGROUND (no esperar respuesta)
        setImmediate(() => {
            processReportInBackground(
                report.report_id,
                fileContent,
                prompt,
                req.user.user_id
            );
        });

        // ✅ RESPUESTA INMEDIATA al cliente
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
                status: "En progreso"
            },
            pollUrl: `/api/reports/${report.report_id}` // URL para verificar estado
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
 * 📌 2. Listar reportes de un proyecto
 */
router.get("/project/:project_id", auth, async (req, res) => {
    try {
        const reports = await Report.findAll({
            where: { is_deleted: false },
            order: [["created_at", "DESC"]]
        });
        res.json(reports);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al listar reportes" });
    }
});

/**
 * 📌 3. Ver detalle de un reporte (CON ESTADO)
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
 * 📌 4. Editar reporte (TAMBIÉN ASYNC)
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

        await report.update({
            status: "En progreso",
            title: title || report.title
        });

        // Calcular nueva versión
        const lastHistory = await ReportHistory.findOne({
            where: { report_id: report.report_id },
            order: [["version", "DESC"]],
        });
        const newVersion = (lastHistory?.version || 0) + 1;

        // 🔥 PROCESAR EN BACKGROUND
        setImmediate(async () => {
            try {
                const fullPrompt = buildPrompt(fileContent, prompt);
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
                } else {
                    await report.update({ status: "failed" });
                }
            } catch (error) {
                console.error("Error en regeneración:", error);
                await report.update({ status: "failed" });
            }
        });

        res.status(202).json({
            message: "Regeneración iniciada",
            report: report.toJSON(),
            pollUrl: `/api/reports/${report.report_id}`
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error al editar reporte" });
    }
});

/**
 * 📌 5. Listar historial
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

module.exports = router;