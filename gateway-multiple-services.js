const express = require('express');
const cors = require('cors');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');
const WebSocket = require('ws');
const { createServer } = require('http');

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 10000;

// WebSocket server
const wss = new WebSocket.Server({
    server,
    path: '/api/chat/ws',
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
        },
        zlibInflateOptions: {
            chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
    }
});

app.use(cors());
app.use(express.json());

// Agent optimizado con mejor configuración
const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 20,
    timeout: 30000,
    keepAliveMsecs: 1000,
    freeSocketTimeout: 60000
});

const SERVICES = {
    auth: 'tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    users: 'tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    notifications: 'tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net',
    chat: 'tsukuyomi-chat-dev-a7dcckcvdra5c3g6.eastus2-01.azurewebsites.net'
};

console.log('GATEWAY OPTIMIZADO - CONEXIONES PERSISTENTES + CHAT WEBSOCKET');

// WebSocket Connection Manager
const wsConnections = new Map();

wss.on('connection', (ws, req) => {
    const connectionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    console.log(`[WS-GATEWAY] Nueva conexión WebSocket: ${connectionId} desde ${clientIp}`);

    wsConnections.set(connectionId, {
        ws,
        createdAt: new Date(),
        ip: clientIp
    });

    // Mensaje de bienvenida
    ws.send(JSON.stringify({
        type: 'connection_established',
        connectionId,
        timestamp: new Date().toISOString(),
        message: 'Conectado al WebSocket Gateway'
    }));

    // Manejar mensajes del cliente
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`[WS-GATEWAY] ${connectionId} recibió:`, data);

            // Enrutar mensajes STOMP-like
            if (data.destination) {
                await handleStompMessage(connectionId, data, ws);
            } else {
                // Mensaje directo al servicio de chat
                await forwardToChatService(connectionId, data, ws);
            }
        } catch (error) {
            console.error(`[WS-GATEWAY] Error procesando mensaje:`, error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Error procesando mensaje',
                error: error.message
            }));
        }
    });

    // Manejar desconexión
    ws.on('close', () => {
        console.log(`[WS-GATEWAY] Conexión cerrada: ${connectionId}`);
        wsConnections.delete(connectionId);
    });

    // Manejar errores
    ws.on('error', (error) => {
        console.error(`[WS-GATEWAY] Error en conexión ${connectionId}:`, error);
        wsConnections.delete(connectionId);
    });
});

// Función para manejar mensajes STOMP
async function handleStompMessage(connectionId, data, ws) {
    const { destination, content, headers = {} } = data;

    // Mapear destinos STOMP a endpoints HTTP
    const destinationMap = {
        '/app/sendMessage': '/api/chat/eciexpress/messages',
        '/app/typing': '/api/chat/eciexpress/typing',
        '/app/markAsRead': '/api/chat/eciexpress/messages/read'
    };

    const httpEndpoint = destinationMap[destination];

    if (httpEndpoint) {
        // Convertir a petición HTTP
        const method = destination === '/app/sendMessage' ? 'POST' : 'PUT';

        try {
            const response = await makeChatHttpRequest({
                method,
                path: httpEndpoint,
                body: content || {},
                headers
            });

            ws.send(JSON.stringify({
                type: 'stomp_response',
                destination,
                content: response,
                timestamp: new Date().toISOString()
            }));
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'error',
                destination,
                message: 'Error forwarding STOMP message',
                error: error.message
            }));
        }
    } else if (destination.startsWith('/topic/')) {
        // Suscripciones a topics (simuladas)
        ws.send(JSON.stringify({
            type: 'subscription_confirmed',
            destination,
            subscriptionId: 'sub-' + Math.random().toString(36).substr(2, 9),
            timestamp: new Date().toISOString()
        }));
    } else {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Destination not supported',
            destination
        }));
    }
}

// Función para forward a servicio de chat
async function forwardToChatService(connectionId, data, ws) {
    const { action, payload } = data;

    const actionMap = {
        'send_message': { method: 'POST', path: '/api/chat/eciexpress/messages' },
        'typing': { method: 'PUT', path: '/api/chat/eciexpress/typing' },
        'mark_read': { method: 'PUT', path: '/api/chat/eciexpress/messages/read' },
        'create_conversation': { method: 'POST', path: '/api/chat/eciexpress/conversations' },
        'get_conversations': { method: 'GET', path: '/api/chat/eciexpress/chatuser/{id}/conversations' },
        'get_messages': { method: 'GET', path: '/api/chat/eciexpress/conversations/{id}/messages' },
        'add_contact': { method: 'POST', path: '/api/chat/eciexpress/chatuser/add-contact' }
    };

    const config = actionMap[action];

    if (config) {
        try {
            // Reemplazar placeholders en el path
            let path = config.path;
            if (payload && payload.id) {
                path = path.replace('{id}', payload.id);
            }

            const response = await makeChatHttpRequest({
                method: config.method,
                path: path,
                body: payload,
                headers: { 'Connection-Id': connectionId }
            });

            ws.send(JSON.stringify({
                type: 'chat_response',
                action,
                data: response,
                timestamp: new Date().toISOString()
            }));
        } catch (error) {
            ws.send(JSON.stringify({
                type: 'error',
                action,
                message: 'Error processing chat action',
                error: error.message
            }));
        }
    } else {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Action not supported',
            action
        }));
    }
}

// Función para hacer peticiones HTTP al servicio de chat
function makeChatHttpRequest({ method, path, body, headers = {} }) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const options = {
            hostname: SERVICES.chat,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Connection': 'keep-alive',
                'User-Agent': 'API-Gateway-Chat/1.0',
                ...headers
            },
            agent: keepAliveAgent,
            timeout: 30000,
            rejectUnauthorized: false
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                const endTime = Date.now();
                console.log(`[CHAT-HTTP] ${method} ${path} completado en ${endTime - startTime}ms - Status: ${res.statusCode}`);

                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        const jsonData = data ? JSON.parse(data) : {};
                        resolve(jsonData);
                    } else {
                        const errorData = data ? JSON.parse(data) : {
                            error: 'Chat service error',
                            statusCode: res.statusCode
                        };
                        reject(new Error(JSON.stringify(errorData)));
                    }
                } catch (e) {
                    reject(new Error(`Invalid JSON response: ${e.message}`));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Chat service timeout after 30s'));
        });

        req.on('error', (err) => {
            console.error(`[CHAT-HTTP] Error en ${method} ${path}:`, err.message);
            reject(err);
        });

        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
            const bodyData = JSON.stringify(body);
            options.headers['Content-Length'] = Buffer.byteLength(bodyData);
            req.write(bodyData);
        }

        req.end();
    });
}

// Pre-calentar conexiones
function preWarmConnections() {
    console.log('Pre-calentando conexiones...');

    Object.values(SERVICES).forEach(service => {
        const preWarmOptions = {
            hostname: service,
            path: '/',
            method: 'HEAD',
            agent: keepAliveAgent,
            rejectUnauthorized: false,
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

// Función optimizada con mejor manejo de errores (mantenida de tu código original)
function createOptimizedUsersEndpoint(basePath) {
    return async (req, res) => {
        const startTime = Date.now();
        const method = req.method;

        let targetPath = basePath;

        if (req.params) {
            Object.keys(req.params).forEach(key => {
                const paramValue = req.params[key];
                const encodedValue = encodeURIComponent(paramValue);
                targetPath = targetPath.replace(`:${key}`, encodedValue);
            });
        }

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
                        rawResponse: data.substring(0, 500)
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

        if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
            const bodyData = JSON.stringify(req.body);
            console.log(`[GATEWAY] Enviando body:`, JSON.stringify(req.body, null, 2));
            headers['Content-Length'] = Buffer.byteLength(bodyData);
            request.write(bodyData);
        } else {
            headers['Content-Length'] = 0;
        }

        request.end();
    };
}

// ENDPOINTS PARA CUSTOMERS
app.post('/api/users/customers', createOptimizedUsersEndpoint('/users/customers'));
app.get('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));
app.put('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));
app.put('/api/users/customers/:id/password', createOptimizedUsersEndpoint('/users/customers/:id/password'));
app.delete('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));
app.get('/api/users/customers', createOptimizedUsersEndpoint('/users/customers'));

// Otros endpoints de usuarios...
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

// LOGIN OPTIMIZADO
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

    const bodyData = JSON.stringify(req.body);
    headers['Content-Length'] = Buffer.byteLength(bodyData);
    request.write(bodyData);
    request.end();
});

// Proxy optimizado para Chat HTTP
app.use('/api/chat', createProxyMiddleware({
    changeOrigin: true,
    target: `https://${SERVICES.chat}`,
    pathRewrite: { '^/api/chat': '' },
    timeout: 30000,
    proxyTimeout: 30000,
    secure: false,
    agent: keepAliveAgent,
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[GATEWAY-CHAT-HTTP] === PROXY CHAT DETALLADO ===`);
        console.log(`[GATEWAY-CHAT-HTTP] Original URL: ${req.originalUrl}`);
        console.log(`[GATEWAY-CHAT-HTTP] Rewritten URL: ${req.url.replace('/api/chat', '')}`);

        proxyReq.removeHeader('expect');
        proxyReq.removeHeader('Expect');

        if (req.body) {
            console.log(`[GATEWAY-CHAT-HTTP] Body recibido:`, JSON.stringify(req.body, null, 2));

            const bodyData = JSON.stringify(req.body);
            if (bodyData && bodyData !== '{}') {
                proxyReq.setHeader('Content-Type', 'application/json');
                proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                proxyReq.write(bodyData);
                console.log(`[GATEWAY-CHAT-HTTP] Body enviado: ${bodyData}`);
            }
        }

        console.log(`[GATEWAY-CHAT-HTTP] Headers finales:`, JSON.stringify(proxyReq.getHeaders(), null, 2));
    },
    onError: (err, req, res) => {
        console.error(`[GATEWAY-CHAT-HTTP] Proxy error:`, err.message);
        res.status(502).json({
            error: 'Chat service proxy error',
            details: err.message,
            service: SERVICES.chat
        });
    }
}));

// Endpoints específicos de Chat HTTP para mejor logging
app.post('/api/chat/eciexpress/conversations', (req, res) => {
    console.log(`[CHAT-ENDPOINT] Creando conversación:`, req.body);
    createProxyMiddleware({
        changeOrigin: true,
        target: `https://${SERVICES.chat}`,
        pathRewrite: { '^/api/chat': '' },
        secure: false
    })(req, res);
});

app.get('/api/chat/eciexpress/chatuser/:id/conversations', (req, res) => {
    console.log(`[CHAT-ENDPOINT] Obteniendo conversaciones para usuario: ${req.params.id}`);
    createProxyMiddleware({
        changeOrigin: true,
        target: `https://${SERVICES.chat}`,
        pathRewrite: { '^/api/chat': '' },
        secure: false
    })(req, res);
});

app.get('/api/chat/eciexpress/conversations/:id/messages', (req, res) => {
    console.log(`[CHAT-ENDPOINT] Obteniendo mensajes de conversación: ${req.params.id}`);
    createProxyMiddleware({
        changeOrigin: true,
        target: `https://${SERVICES.chat}`,
        pathRewrite: { '^/api/chat': '' },
        secure: false
    })(req, res);
});

// Proxy normal para otros endpoints
const proxyOptions = {
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    secure: false,
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

// Health check mejorado
app.get('/health', async (req, res) => {
    const healthChecks = {
        gateway: 'OK',
        persistent_connections: true,
        timestamp: new Date().toISOString(),
        websocket_connections: wsConnections.size,
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
                    resolve();
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

// WebSocket status endpoint
app.get('/api/chat/ws/status', (req, res) => {
    const connections = [];

    wsConnections.forEach((conn, id) => {
        connections.push({
            id,
            ip: conn.ip,
            age: Math.floor((new Date() - conn.createdAt) / 1000) + 's',
            readyState: conn.ws.readyState
        });
    });

    res.json({
        status: 'OK',
        total_connections: wsConnections.size,
        connections: connections,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Optimizado y Corregido',
        status: 'operational',
        features: {
            timeout: '30 segundos',
            persistent_connections: true,
            websocket_support: true,
            error_handling: 'mejorado',
            debug_logging: 'habilitado'
        },
        endpoints: {
            customers: 'POST /api/users/customers (funcional)',
            login: 'POST /api/auth/login (optimizado)',
            chat_http: 'Multiple endpoints bajo /api/chat',
            chat_websocket: 'WS /api/chat/ws',
            health: 'GET /health (con verificación de servicios)'
        },
        chat_websocket: {
            connect_to: 'wss://tu-gateway.com/api/chat/ws',
            send_messages_to: [
                '/app/sendMessage',
                '/app/typing',
                '/app/markAsRead'
            ],
            subscribe_to: [
                '/topic/conversations/{conversationId}',
                '/topic/conversations/{conversationId}/typing',
                '/topic/conversations/{conversationId}/receipts'
            ],
            example_message: {
                destination: '/app/sendMessage',
                content: {
                    conversationId: '123',
                    senderId: 'user1',
                    content: 'Hello World'
                }
            }
        },
        timestamp: new Date().toISOString()
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gateway con WebSocket ejecutándose en puerto ${PORT}`);
    console.log('✅ Mejoras implementadas:');
    console.log('   • WebSocket Server en /api/chat/ws');
    console.log('   • STOMP-like message routing');
    console.log('   • HTTP Chat proxy optimizado');
    console.log('   • Timeout aumentado a 30s');
    console.log('   • Content-Length header añadido');
    console.log('   • Mejor manejo de errores');
    console.log('   • Logging detallado para debug');
    console.log('');
    console.log('📡 Endpoints principales:');
    console.log('   POST /api/users/customers - Crear customer');
    console.log('   POST /api/auth/login - Login optimizado');
    console.log('   WS   /api/chat/ws - Chat WebSocket');
    console.log('   GET /health - Estado del sistema');
    console.log('');
    console.log('💬 Ejemplo de conexión WebSocket:');
    console.log(`
        const ws = new WebSocket('ws://localhost:${PORT}/api/chat/ws');
        
        ws.onopen = () => {
            // Enviar mensaje
            ws.send(JSON.stringify({
                destination: '/app/sendMessage',
                content: {
                    conversationId: '123',
                    senderId: 'user1',
                    content: 'Hello World'
                }
            }));
            
            // O usando acción simple
            ws.send(JSON.stringify({
                action: 'send_message',
                payload: {
                    conversationId: '123',
                    senderId: 'user1',
                    content: 'Hello World'
                }
            }));
        };
    `);
});