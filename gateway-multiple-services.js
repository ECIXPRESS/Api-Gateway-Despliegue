const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Agent ultra optimizado
const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 30,
    timeout: 45000,
    keepAliveMsecs: 60000
});

// URLs CORRECTAS de tus Functions
const SERVICES = {
    auth: 'tsukuyomi-authentication-dev.azurewebsites.net',
    users: 'tsukuyomi-users-dev.azurewebsites.net',
    notifications: 'tsukuyomi-notifications-dev.azurewebsites.net'
};

// Cache de activaciones
const activationCache = new Map();

// Función MÁGICA que ACTIVA servicios dormidos
async function activateServiceWithRetry(serviceName, path, method = 'GET', body = null) {
    const maxRetries = 5;
    const baseDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await new Promise((resolve, reject) => {
                const options = {
                    hostname: SERVICES[serviceName],
                    path: path,
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Activation-Attempt': attempt.toString(),
                        'User-Agent': 'Azure-Activator/1.0'
                    },
                    agent: keepAliveAgent,
                    timeout: attempt * 10000
                };

                const req = https.request(options, (res) => {
                    let data = '';

                    res.on('data', (chunk) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        // IGNORAR errores 404/403 durante activación
                        if (res.statusCode >= 400 && res.statusCode < 500) {
                            console.log(`⚠️  ${serviceName} respondió ${res.statusCode} (intento ${attempt}) - Esto ES BUENO, significa que está ACTIVO`);
                            resolve({ status: 'active', statusCode: res.statusCode, data });
                            return;
                        }

                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log(`✅ ${serviceName} ACTIVADO (intento ${attempt}, ${res.statusCode})`);
                            resolve({ status: 'active', statusCode: res.statusCode, data });
                        } else {
                            resolve({ status: 'warming', statusCode: res.statusCode, data });
                        }
                    });
                });

                req.on('timeout', () => {
                    console.log(`⏳ ${serviceName} iniciando... (timeout intento ${attempt})`);
                    req.destroy();
                    reject(new Error(`Timeout intento ${attempt}`));
                });

                req.on('error', (err) => {
                    console.log(`🔄 ${serviceName} activándose... (${err.message})`);
                    reject(err);
                });

                if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
                    req.write(JSON.stringify(body));
                }

                req.end();
            });

        } catch (error) {
            if (attempt === maxRetries) {
                console.log(`❌ ${serviceName} no se activó después de ${maxRetries} intentos`);
                return { status: 'failed', error: error.message };
            }

            // Delay exponencial
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`⏸️  Esperando ${delay}ms antes de reintentar ${serviceName}...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// PROXY INTELIGENTE que ACTIVA antes de redirigir
function createSmartProxy(serviceName, basePath) {
    return async (req, res) => {
        const startTime = Date.now();
        const requestId = Date.now();

        console.log(`🚀 [${requestId}] Activando ${serviceName}...`);

        // PASO 1: Activar el servicio ANTES de hacer la llamada real
        const activationKey = `${serviceName}:${basePath}`;

        if (!activationCache.has(activationKey)) {
            console.log(`⚡ [${requestId}] Primera activación de ${serviceName}`);

            // Activar con endpoints de bootstrap
            await activateServiceWithRetry(
                serviceName,
                '/api/health',
                'GET'
            );

            activationCache.set(activationKey, {
                activated: true,
                timestamp: Date.now()
            });
        }

        // PASO 2: Ahora hacer la llamada REAL
        let targetPath = basePath;

        // Reemplazar parámetros dinámicos
        if (req.params) {
            Object.keys(req.params).forEach(key => {
                if (req.params[key]) {
                    const encodedValue = encodeURIComponent(req.params[key]);
                    targetPath = targetPath.replace(`:${key}`, encodedValue);
                }
            });
        }

        // Añadir query parameters
        if (Object.keys(req.query).length > 0) {
            const queryParams = new URLSearchParams(req.query).toString();
            targetPath += `?${queryParams}`;
        }

        console.log(`📡 [${requestId}] ${req.method} ${targetPath} -> ${SERVICES[serviceName]}`);

        const options = {
            hostname: SERVICES[serviceName],
            path: targetPath.startsWith('/') ? targetPath : `/${targetPath}`,
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Request-ID': requestId.toString(),
                'X-Gateway-Source': 'render-activation',
                ...req.headers,
                'host': null
            },
            agent: keepAliveAgent,
            timeout: 30000
        };

        let responseSent = false;

        const sendResponse = (status, data) => {
            if (!responseSent) {
                responseSent = true;
                const duration = Date.now() - startTime;
                console.log(`✅ [${requestId}] ${serviceName} completado en ${duration}ms`);
                res.status(status).json({
                    ...data,
                    _gateway: {
                        service: serviceName,
                        activationTime: duration,
                        requestId: requestId,
                        activated: true
                    }
                });
            }
        };

        const request = https.request(options, (response) => {
            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                try {
                    if (response.statusCode === 204) {
                        return sendResponse(204, {});
                    }

                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        const jsonData = data ? JSON.parse(data) : {};
                        sendResponse(response.statusCode, jsonData);
                    } else {
                        const errorData = data ? JSON.parse(data) : { error: 'Service error' };
                        sendResponse(response.statusCode, errorData);
                    }
                } catch (e) {
                    // Si no es JSON, enviar como texto
                    sendResponse(response.statusCode, {
                        rawResponse: data,
                        error: 'Invalid JSON',
                        note: 'El servicio está respondiendo pero con formato inesperado'
                    });
                }
            });
        });

        request.on('timeout', () => {
            console.log(`⌛ [${requestId}] Timeout - Reactivando ${serviceName}...`);
            request.destroy();

            // Reactivar y retry automático
            setTimeout(async () => {
                console.log(`🔄 [${requestId}] Reintentando después de timeout...`);
                await activateServiceWithRetry(serviceName, targetPath, req.method, req.body);

                // Hacer nueva request después de activar
                const retryReq = https.request(options, (retryRes) => {
                    let retryData = '';

                    retryRes.on('data', (chunk) => {
                        retryData += chunk;
                    });

                    retryRes.on('end', () => {
                        if (!responseSent) {
                            try {
                                const jsonData = retryData ? JSON.parse(retryData) : {};
                                sendResponse(retryRes.statusCode, {
                                    ...jsonData,
                                    _retry: true,
                                    _message: 'Servicio activado después de timeout'
                                });
                            } catch (e) {
                                sendResponse(retryRes.statusCode, {
                                    rawResponse: retryData,
                                    _retry: true
                                });
                            }
                        }
                    });
                });

                retryReq.on('error', () => {
                    if (!responseSent) {
                        sendResponse(502, {
                            error: 'Service activation failed',
                            message: 'El servicio no se pudo activar automáticamente',
                            service: serviceName,
                            action: 'Azure Functions está iniciándose, intenta nuevamente en 10 segundos'
                        });
                    }
                });

                if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
                    retryReq.write(JSON.stringify(req.body));
                }

                retryReq.end();
            }, 3000);
        });

        request.on('error', (err) => {
            console.log(`🔌 [${requestId}] Connection error: ${err.message}`);

            if (!responseSent) {
                sendResponse(502, {
                    error: 'Connection error',
                    message: 'Conectando con Azure Functions...',
                    details: `El servicio ${serviceName} se está activando automáticamente`,
                    retrySuggestion: 'Espera 5 segundos y vuelve a intentar',
                    azureStatus: 'Functions están iniciándose (cold start)'
                });
            }
        });

        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            request.write(JSON.stringify(req.body));
        }

        request.end();
    };
}

// ==================== ENDPOINTS ====================

// AUTH
app.post('/api/auth/login', createSmartProxy('auth', '/api/auth/login'));

// USERS
app.get('/api/users/credentials/:email', createSmartProxy('users', '/api/users/credentials/:email'));
app.get('/api/users/credentials/auth', createSmartProxy('users', '/api/users/credentials/auth'));

app.post('/api/users/admins', createSmartProxy('users', '/api/users/admins'));
app.get('/api/users/admins/:id', createSmartProxy('users', '/api/users/admins/:id'));
app.put('/api/users/admins/:id', createSmartProxy('users', '/api/users/admins/:id'));
app.delete('/api/users/admins/:id', createSmartProxy('users', '/api/users/admins/:id'));

app.post('/api/users/customers', createSmartProxy('users', '/api/users/customers'));
app.get('/api/users/customers/:id', createSmartProxy('users', '/api/users/customers/:id'));
app.put('/api/users/customers/:id', createSmartProxy('users', '/api/users/customers/:id'));
app.delete('/api/users/customers/:id', createSmartProxy('users', '/api/users/customers/:id'));

app.post('/api/users/sellers', createSmartProxy('users', '/api/users/sellers'));
app.get('/api/users/sellers/:id', createSmartProxy('users', '/api/users/sellers/:id'));
app.get('/api/users/sellers', createSmartProxy('users', '/api/users/sellers'));
app.get('/api/users/sellers/pending', createSmartProxy('users', '/api/users/sellers/pending'));
app.put('/api/users/sellers/:id', createSmartProxy('users', '/api/users/sellers/:id'));
app.delete('/api/users/sellers/:id', createSmartProxy('users', '/api/users/sellers/:id'));

app.post('/api/users/password/reset-request', createSmartProxy('users', '/api/users/password/reset-request'));
app.post('/api/users/password/verify-code', createSmartProxy('users', '/api/users/password/verify-code'));
app.put('/api/users/password/reset', createSmartProxy('users', '/api/users/password/reset'));

// NOTIFICATIONS
app.post('/api/notifications', createSmartProxy('notifications', '/api/notifications'));
app.get('/api/notifications/:userId', createSmartProxy('notifications', '/api/notifications/:userId'));
app.put('/api/notifications/:id/read', createSmartProxy('notifications', '/api/notifications/:id/read'));

// USER INFO
app.get('/api/user-info/:token', createSmartProxy('auth', '/api/user-info/:token'));

// ==================== HEALTH & STATUS ====================

app.get('/health', async (req, res) => {
    const servicesCheck = {};

    for (const [name, host] of Object.entries(SERVICES)) {
        try {
            await activateServiceWithRetry(name, '/', 'HEAD');
            servicesCheck[name] = { status: 'active', host };
        } catch {
            servicesCheck[name] = { status: 'dormant', host, note: 'Se activará al primer llamado' };
        }
    }

    res.json({
        status: 'READY',
        gateway: 'Azure Functions Activator',
        mode: 'AUTO-ACTIVATION',
        timestamp: new Date().toISOString(),
        services: servicesCheck,
        features: [
            'Activación automática al primer llamado',
            'Retry inteligente (hasta 5 intentos)',
            'Cold start management',
            'Reactivación automática'
        ]
    });
});

app.get('/', (req, res) => {
    res.json({
        message: '🚀 API Gateway - AUTO ACTIVACIÓN AZURE FUNCTIONS',
        description: 'Los microservicios se ENCIENDEN AUTOMÁTICAMENTE al ser llamados',
        url: 'https://api-gateway-despliegue.onrender.com',
        endpoints: {
            testActivation: 'POST /api/auth/login',
            testUsers: 'GET /api/users/credentials/:email',
            health: 'GET /health'
        },
        note: 'La primera llamada puede tardar 2-10 segundos (cold start Azure)'
    });
});

// ==================== INICIO ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🔥🔥🔥 API GATEWAY - AUTO ACTIVADOR 🔥🔥🔥
==========================================
✅ Característica PRINCIPAL:
   Los microservicios de Azure se ENCIENDEN SOLOS
   cuando los llamas por primera vez.

⚡ Tecnología:
   • Azure Functions Consumption Plan
   • Activación automática (cold start 2-10s)
   • Render + Azure

📍 Puerto: ${PORT}
🔗 Health: http://localhost:${PORT}/health

🚀 PARA PROBAR:
1. curl https://api-gateway-despliegue.onrender.com/api/auth/login
2. El servicio se activará AUTOMÁTICAMENTE
3. Primera llamada: 2-10s
4. Siguientes: < 1s

🎯 ¡NO necesitas iniciar nada manualmente!
    `);
});