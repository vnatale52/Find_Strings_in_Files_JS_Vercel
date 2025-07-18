const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;
const { generarInforme } = require('./buscador-core.js');

async function startServer() {
    try {
        console.log("Iniciando la conexión a Redis...");
        
        if (!process.env.REDIS_URL) {
            throw new Error("La variable de entorno REDIS_URL no está definida.");
        }

        const redisClient = createClient({ url: process.env.REDIS_URL });
        redisClient.on('error', err => console.error('Error del Cliente Redis:', err));
        await redisClient.connect();
        console.log("Conectado a Redis exitosamente.");

        const redisStore = new RedisStore({
            client: redisClient,
            prefix: 'buscadorapp:',
        });

        const app = express();

        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, 'views'));
        app.use(express.static(path.join(__dirname, 'static')));
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            store: redisStore,
            secret: 'una-clave-secreta-muy-dificil-de-adivinar-en-nodejs',
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: true,
                httpOnly: true,
                maxAge: 1000 * 60 * 60
            }
        }));

        const storage = multer.memoryStorage();
        const upload = multer({
            storage: storage,
            limits: { fileSize: 128 * 1024 * 1024 }
        });

        app.get('/', (req, res) => {
            res.render('index', { messages: req.session.messages || [] });
            req.session.messages = [];
        });
        
        app.post('/buscar', upload.array('files'), async (req, res) => {
            const files = req.files;
            const searchStringsRaw = req.body.search_strings;
            let context_chars = parseInt(req.body.context_chars, 10);

            if (isNaN(context_chars) || context_chars < 0 || context_chars > 1000) {
                context_chars = 240;
            }

            if (!files || files.length === 0) {
                req.session.messages = [{ category: 'danger', text: 'No se seleccionó ningún archivo.' }];
                return res.redirect('/');
            }
            
            if (!searchStringsRaw || !searchStringsRaw.trim()) {
                req.session.messages = [{ category: 'danger', text: 'Debes introducir al menos un texto para buscar.' }];
                return res.redirect('/');
            }
        
            const listaStrings = searchStringsRaw.split(';').map(s => s.trim()).filter(s => s);
            
            try {
                const reporteStr = await generarInforme(files, listaStrings, context_chars);
                req.session.reporte = reporteStr;
                res.render('resultados', { report_content: reporteStr });
            } catch (error) {
                console.error("Error al generar el informe:", error);
                req.session.messages = [{ category: 'danger', text: 'Ocurrió un error al procesar los archivos.' }];
                res.redirect('/');
            }
        });

        app.get('/descargar_reporte', (req, res) => {
            const reporte = req.session.reporte || 'No hay ningún informe para descargar.';
            res.setHeader('Content-disposition', 'attachment; filename=informe_busqueda_contexto.txt');
            res.setHeader('Content-type', 'text/plain');
            res.charset = 'UTF-8';
            res.write(reporte);
            res.end();
        });

        return app;

    } catch (error) {
        console.error("FALLO CRÍTICO AL INICIAR EL SERVIDOR:", error);
        const errorApp = express();
        errorApp.get('*', (req, res) => {
            res.status(503).send("Servicio no disponible debido a un problema de configuración. Por favor, revise los logs del servidor.");
        });
        return errorApp;
    }
}

module.exports = startServer();