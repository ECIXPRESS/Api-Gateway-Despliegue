const express = require('express');
const cors = require('cors');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Agent optimizado con mejor configuración
const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,  // Aumentado
    maxFreeSockets: 20,
    timeout: 30000,  // Aumentado a 30s
    keepAliveMsecs: 1000,
    freeSocketTimeout: 60000  // Aumentado a 60s
});

const SERVICES = {
    auth: 'tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    users: 'tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    notifications: 'tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net',
    chat: 'tsukuyomi-chat-dev-a7dcckcvdra5c3g6.eastus2-01.azurewebsites.net'  // AGREGADO
};

console.log('GATEWAY OPTIMIZADO - CONEXIONES PERSISTENTES');

// Pre-calentar conexiones
function preWarmConnections() {
    console.log('Pre-calentando conexiones...');

    Object.values(SERVICES).forEach(service => {
        const preWarmOptions = {
            hostname: service,
            path: '/',
            method: 'HEAD',
            agent: keepAliveAgent,
            rejectUnauthorized: false,  // Añadido para desarrollo
            timeout: 10000
        };

        const req = https.request(preWarmOptions, (res) => {
            console.log(`✓ Conexión pre-calentada con ${service}`);
        });

        req.on('error', (err) => {
            console.log(`⚠ Pre-calentamiento ${service}: ${err.message}`);
        });

        req.end();
    });
}

preWarmConnections();

// Función optimizada con mejor manejo de errores
function createOptimizedUsersEndpoint(basePath) {
    return async (req, res) => {
        const startTime = Date.now();
        const method = req.method;

        // Construir path dinámico
        let targetPath = basePath;

        if (req.params) {
            Object.keys(req.params).forEach(key => {
                const paramValue = req.params[key];
                const encodedValue = encodeURIComponent(paramValue);
                targetPath = targetPath.replace(`:${key}`, encodedValue);
            });
        }

        // Preservar query parameters
        if (Object.keys(req.query).length > 0) {
            const queryParams = new URLSearchParams(req.query).toString();
            targetPath += `?${queryParams}`;
        }

        console.log(`[GATEWAY] ${method} ${req.originalUrl} -> ${SERVICES.users}${targetPath}`);

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Connection': 'keep-alive',
            'User-Agent': 'API-Gateway/1.0'
        };

        const options = {
            hostname: SERVICES.users,
            path: targetPath,
            method: method,
            headers: headers,
            agent: keepAliveAgent,
            timeout: 30000,  // Aumentado a 30s
            rejectUnauthorized: false  // Para desarrollo
        };

        let responseSent = false;

        const sendResponse = (status, data) => {
            if (!responseSent) {
                responseSent = true;
                res.status(status).json(data);
            }
        };

        const request = https.request(options, (response) => {
            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                const endTime = Date.now();
                console.log(`[GATEWAY] ${method} ${req.originalUrl} completado en ${endTime - startTime}ms - Status: ${response.statusCode}`);

                try {
                    if (response.statusCode === 204) {
                        return sendResponse(204);
                    }

                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        const jsonData = data ? JSON.parse(data) : {};
                        sendResponse(response.statusCode, jsonData);
                    } else {
                        const errorData = data ? JSON.parse(data) : {
                            error: 'Error del servicio',
                            statusCode: response.statusCode
                        };
                        sendResponse(response.statusCode, errorData);
                    }
                } catch (e) {
                    console.error(`[GATEWAY] Error parsing response:`, e.message);
                    sendResponse(502, {
                        error: 'Invalid JSON response',
                        details: e.message,
                        rawResponse: data.substring(0, 500) // Log parcial para debug
                    });
                }
            });
        });

        request.on('timeout', () => {
            console.error(`[GATEWAY] ${method} ${req.originalUrl} timeout después de ${Date.now() - startTime}ms`);
            request.destroy();
            sendResponse(504, {
                error: 'Request timeout',
                message: 'El servicio de usuarios no respondió en 30 segundos',
                service: SERVICES.users
            });
        });

        request.on('error', (err) => {
            console.error(`[GATEWAY] ${method} ${req.originalUrl} error en ${Date.now() - startTime}ms:`, {
                message: err.message,
                code: err.code,
                stack: err.stack
            });

            let statusCode = 502;
            let errorMessage = 'Connection failed';

            if (err.code === 'ECONNRESET') {
                errorMessage = 'Conexión reiniciada por el servidor';
            } else if (err.code === 'ETIMEDOUT') {
                statusCode = 504;
                errorMessage = 'Connection timeout';
            }

            sendResponse(statusCode, {
                error: errorMessage,
                message: err.message,
                code: err.code,
                service: SERVICES.users
            });
        });

        // CORRECCIÓN CRÍTICA: Manejar el body correctamente
        if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
            const bodyData = JSON.stringify(req.body);
            console.log(`[GATEWAY] Enviando body:`, JSON.stringify(req.body, null, 2));

            // Añadir Content-Length header
            headers['Content-Length'] = Buffer.byteLength(bodyData);

            request.write(bodyData);
        } else {
            // Para GET, DELETE, etc.
            headers['Content-Length'] = 0;
        }

        request.end();
    };
}

// ENDPOINTS PARA CUSTOMERS - CORREGIDOS
app.post('/api/users/customers', createOptimizedUsersEndpoint('/users/customers'));
app.get('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));
app.put('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));
app.put('/api/users/customers/:id/password', createOptimizedUsersEndpoint('/users/customers/:id/password'));
app.delete('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));

// Añadir también GET para listar todos los customers si es necesario
app.get('/api/users/customers', createOptimizedUsersEndpoint('/users/customers'));

// Otros endpoints...
app.post('/api/users/admins', createOptimizedUsersEndpoint('/users/admins'));
app.get('/api/users/admins/:id', createOptimizedUsersEndpoint('/users/admins/:id'));
app.put('/api/users/admins/:id', createOptimizedUsersEndpoint('/users/admins/:id'));
app.delete('/api/users/admins/:id', createOptimizedUsersEndpoint('/users/admins/:id'));

app.post('/api/users/sellers', createOptimizedUsersEndpoint('/users/sellers'));
app.get('/api/users/sellers/:id', createOptimizedUsersEndpoint('/users/sellers/:id'));
app.get('/api/users/sellers', createOptimizedUsersEndpoint('/users/sellers'));
app.get('/api/users/sellers/pending', createOptimizedUsersEndpoint('/users/sellers/pending'));
app.put('/api/users/sellers/:id', createOptimizedUsersEndpoint('/users/sellers/:id'));
app.delete('/api/users/sellers/:id', createOptimizedUsersEndpoint('/users/sellers/:id'));

// Password endpoints
app.post('/api/users/password/reset-request', createOptimizedUsersEndpoint('/users/password/reset-request'));
app.post('/api/users/password/verify-code', createOptimizedUsersEndpoint('/users/password/verify-code'));
app.put('/api/users/password/reset', createOptimizedUsersEndpoint('/users/password/reset'));

// Credentials endpoints
app.get('/api/users/credentials/:email', createOptimizedUsersEndpoint('/users/credentials/:email'));
app.get('/api/users/credentials/auth', createOptimizedUsersEndpoint('/users/credentials/auth'));

// LOGIN OPTIMIZADO (con las mismas mejoras)
app.post('/api/auth/login', async (req, res) => {
    const startTime = Date.now();
    console.log(`[GATEWAY] Iniciando login`);

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Connection': 'keep-alive',
        'User-Agent': 'API-Gateway/1.0'
    };

    const options = {
        hostname: SERVICES.auth,
        path: '/auth/login',
        method: 'POST',
        headers: headers,
        agent: keepAliveAgent,
        timeout: 30000,
        rejectUnauthorized: false
    };

    let responseSent = false;

    const sendResponse = (status, data) => {
        if (!responseSent) {
            responseSent = true;
            res.status(status).json(data);
        }
    };

    const request = https.request(options, (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            const endTime = Date.now();
            console.log(`[GATEWAY] Login completado en ${endTime - startTime}ms - Status: ${response.statusCode}`);

            try {
                const jsonData = data ? JSON.parse(data) : {};
                sendResponse(response.statusCode, jsonData);
            } catch (e) {
                sendResponse(502, {
                    error: 'Invalid JSON response',
                    details: e.message
                });
            }
        });
    });

    request.on('timeout', () => {
        console.error(`[GATEWAY] Login timeout después de ${Date.now() - startTime}ms`);
        request.destroy();
        sendResponse(504, { error: 'Login timeout - Servicio no responde' });
    });

    request.on('error', (err) => {
        console.error(`[GATEWAY] Login error en ${Date.now() - startTime}ms:`, err.message);
        sendResponse(502, {
            error: 'Connection failed',
            message: err.message,
            code: err.code
        });
    });

    // Añadir Content-Length para login también
    const bodyData = JSON.stringify(req.body);
    headers['Content-Length'] = Buffer.byteLength(bodyData);
    request.write(bodyData);
    request.end();
});

// Proxy normal para otros endpoints
const proxyOptions = {
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    secure: false,  // Cambiado a false para desarrollo
    agent: keepAliveAgent
};

app.use('/api/auth', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.auth}`,
    pathRewrite: { '^/api/auth': '/auth' },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[PROXY] ${req.method} ${req.originalUrl} -> ${SERVICES.auth}`);
    },
    onError: (err, req, res) => {
        console.error(`[PROXY ERROR] ${req.method} ${req.originalUrl}:`, err.message);
        res.status(502).json({ error: 'Proxy error', details: err.message });
    }
}));

app.use('/api/user-info', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.auth}`,
    pathRewrite: { '^/api/user-info': '/user-info' }
}));

app.use('/api/notifications', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.notifications}`,
    pathRewrite: { '^/api/notifications': '/notifications' }
}));

// =================================================================
// PROXY PARA CHAT - SOLO AGREGADO, SIN MODIFICAR LO EXISTENTE
// =================================================================

// Proxy para WebSocket de Chat
app.use('/ws', createProxyMiddleware({
    target: `wss://${SERVICES.chat}`,
    ws: true,
    changeOrigin: true,
    secure: false,
    pathRewrite: { '^/ws': '/ws' },
    logLevel: 'silent'  // Para reducir logs del proxy
}));

// Proxy para HTTP de Chat con logging detallado
const chatProxy = createProxyMiddleware({
    target: `https://${SERVICES.chat}`,
    changeOrigin: true,
    secure: false,
    agent: keepAliveAgent,
    pathRewrite: { '^/api/chat': '' },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[CHAT-PROXY] === INICIO PROXY CHAT ===`);
        console.log(`[CHAT-PROXY] Método: ${req.method}`);
        console.log(`[CHAT-PROXY] URL Original: ${req.originalUrl}`);
        console.log(`[CHAT-PROXY] URL Destino: ${req.url.replace('/api/chat', '')}`);

        // Remover headers de expect para evitar problemas
        proxyReq.removeHeader('expect');
        proxyReq.removeHeader('Expect');

        // Log del body si existe
        if (req.body && Object.keys(req.body).length > 0) {
            console.log(`[CHAT-PROXY] Body Recibido:`, JSON.stringify(req.body, null, 2));

            const bodyData = JSON.stringify(req.body);
            if (bodyData && bodyData !== '{}') {
                proxyReq.setHeader('Content-Type', 'application/json');
                proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                proxyReq.write(bodyData);
                console.log(`[CHAT-PROXY] Body Enviado: ${bodyData.substring(0, 200)}...`);
            }
        }

        console.log(`[CHAT-PROXY] Headers Finales:`, JSON.stringify(proxyReq.getHeaders(), null, 2));
        console.log(`[CHAT-PROXY] === FIN PROXY CHAT ===`);
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[CHAT-PROXY] Respuesta recibida - Status: ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
        console.error(`[CHAT-PROXY ERROR] ${req.method} ${req.originalUrl}:`, err.message);
        res.status(502).json({
            error: 'Chat service error',
            details: err.message,
            service: 'chat'
        });
    }
});

app.use('/api/chat', chatProxy);

// =================================================================
// ENDPOINTS ESPECÍFICOS DE CHAT PARA MEJOR LOGGING (OPCIONAL)
// =================================================================

// Estos endpoints son opcionales pero ayudan con debugging específico
app.post('/api/chat/eciexpress/conversations', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Creando conversación:`, req.body);
    chatProxy(req, res, next);
});

app.get('/api/chat/eciexpress/chatuser/:id/conversations', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Obteniendo conversaciones para usuario: ${req.params.id}`);
    chatProxy(req, res, next);
});

app.get('/api/chat/eciexpress/conversations/:id/messages', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Obteniendo mensajes de conversación: ${req.params.id}`);
    chatProxy(req, res, next);
});

app.delete('/api/chat/eciexpress/conversations', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Eliminando conversación`);
    chatProxy(req, res, next);
});

app.get('/api/chat/eciexpress/chatuser/:id/filter/contacts', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Filtrando contactos para usuario: ${req.params.id}`);
    chatProxy(req, res, next);
});

app.get('/api/chat/eciexpress/chatuser/:id/contacts', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Obteniendo contactos para usuario: ${req.params.id}`);
    chatProxy(req, res, next);
});

app.get('/api/chat/eciexpress/chatuser/:id/messages', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Obteniendo mensajes para usuario: ${req.params.id}`);
    chatProxy(req, res, next);
});

app.post('/api/chat/eciexpress/chatuser/add-contact', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Agregando contacto:`, req.body);
    chatProxy(req, res, next);
});

app.post('/api/chat/eciexpress/chatuser/create-test-users', (req, res, next) => {
    console.log(`[CHAT-ENDPOINT] Creando usuarios de prueba (TEST)`);
    chatProxy(req, res, next);
});

// =================================================================
// Health check mejorado (ACTUALIZADO para incluir chat)
// =================================================================

app.get('/health', async (req, res) => {
    const healthChecks = {
        gateway: 'OK',
        persistent_connections: true,
        timestamp: new Date().toISOString(),
        services: {}
    };

    // Verificar cada servicio
    for (const [name, host] of Object.entries(SERVICES)) {
        try {
            const startTime = Date.now();
            await new Promise((resolve, reject) => {
                const req = https.request({
                    hostname: host,
                    path: '/',
                    method: 'HEAD',
                    agent: keepAliveAgent,
                    timeout: 5000,
                    rejectUnauthorized: false
                }, (res) => {
                    healthChecks.services[name] = {
                        status: 'OK',
                        responseTime: Date.now() - startTime,
                        statusCode: res.statusCode
                    };
                    resolve();
                });

                req.on('error', (err) => {
                    healthChecks.services[name] = {
                        status: 'ERROR',
                        error: err.message,
                        code: err.code
                    };
                    resolve(); // No rechazar para no romper el health check
                });

                req.end();
            });
        } catch (error) {
            healthChecks.services[name] = {
                status: 'ERROR',
                error: error.message
            };
        }
    }

    res.json(healthChecks);
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Optimizado y Corregido',
        status: 'operational',
        features: {
            timeout: '30 segundos',
            persistent_connections: true,
            error_handling: 'mejorado',
            debug_logging: 'habilitado',
            chat_support: 'agregado'  // AGREGADO
        },
        endpoints: {
            customers: 'POST /api/users/customers (funcional)',
            login: 'POST /api/auth/login (optimizado)',
            health: 'GET /health (con verificación de servicios)',
            chat: {  // AGREGADO
                http: 'Todos los endpoints bajo /api/chat',
                websocket: 'WebSocket en /ws',
                examples: {
                    create_conversation: 'POST /api/chat/eciexpress/conversations',
                    get_conversations: 'GET /api/chat/eciexpress/chatuser/{id}/conversations',
                    get_messages: 'GET /api/chat/eciexpress/conversations/{id}/messages',
                    websocket_connect: 'Connect to ws://your-gateway/ws'
                }
            }
        },
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gateway corregido ejecutándose en puerto ${PORT}`);
    console.log('✅ Mejoras implementadas:');
    console.log('   • Timeout aumentado a 30s');
    console.log('   • Content-Length header añadido');
    console.log('   • Mejor manejo de errores ECONNRESET');
    console.log('   • Logging detallado para debug');
    console.log('   • Health check con verificación de servicios');
    console.log('   • CHAT SERVICE AGREGADO (sin modificar lo existente)');  // AGREGADO
    console.log('');
    console.log('📡 Endpoints disponibles:');
    console.log('   POST /api/users/customers - Crear customer');
    console.log('   POST /api/auth/login - Login optimizado');
    console.log('   GET /health - Estado del sistema');
    console.log('');  // AGREGADO
    console.log('💬 CHAT ENDPOINTS AGREGADOS:');  // AGREGADO
    console.log('   HTTP: Todos los endpoints bajo /api/chat');
    console.log('   WebSocket: Conecta a /ws');
    console.log('   Ejemplos específicos:');
    console.log('     POST /api/chat/eciexpress/conversations');
    console.log('     GET  /api/chat/eciexpress/chatuser/{id}/conversations');
    console.log('     GET  /api/chat/eciexpress/conversations/{id}/messages');
});