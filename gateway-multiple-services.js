const express = require('express');
const cors = require('cors');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Agent con conexiones persistentes optimizadas
const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
    freeSocketTimeout: 30000
});

const SERVICES = {
    auth: 'tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    users: 'tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    notifications: 'tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net'
};

console.log('GATEWAY OPTIMIZADO - CONEXIONES PERSISTENTES');

// Pre-calentar conexiones al iniciar
function preWarmConnections() {
    console.log('Pre-calentando conexiones persistentes...');

    Object.values(SERVICES).forEach(service => {
        const preWarmOptions = {
            hostname: service,
            path: '/',
            method: 'HEAD',
            agent: keepAliveAgent,
            timeout: 10000,
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        };

        const req = https.request(preWarmOptions, (res) => {
            console.log(`Conexion pre-calentada con ${service}`);
        });

        req.on('error', (err) => {
            console.log(`Pre-calentamiento ${service}: ${err.message}`);
        });

        req.end();
    });
}

preWarmConnections();

// Función optimizada para endpoints de users CON CACHE CONTROL
function createOptimizedUsersEndpoint(path) {
    return async (req, res) => {
        const startTime = Date.now();
        const originalUrl = req.originalUrl;
        const method = req.method;

        console.log(`[GATEWAY] ${method} ${originalUrl} - Iniciando request optimizado`);

        const options = {
            hostname: SERVICES.users,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Connection': 'keep-alive',
                'User-Agent': 'API-Gateway/1.0',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            agent: keepAliveAgent,
            timeout: 15000
        };

        let responseSent = false;

        const sendResponse = (status, data) => {
            if (!responseSent) {
                responseSent = true;
                // Agregar headers de no-cache en la respuesta también
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
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
                console.log(`[GATEWAY] ${method} ${originalUrl} completado en ${endTime - startTime}ms - Status: ${response.statusCode}`);

                try {
                    if (response.statusCode === 204) {
                        return sendResponse(204);
                    }

                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        const jsonData = data ? JSON.parse(data) : {};
                        sendResponse(response.statusCode, jsonData);
                    } else {
                        sendResponse(response.statusCode, data ? JSON.parse(data) : { error: 'Unknown error' });
                    }
                } catch (e) {
                    sendResponse(502, { error: 'Invalid JSON response', details: e.message });
                }
            });
        });

        request.on('timeout', () => {
            console.log(`[GATEWAY] ${method} ${originalUrl} timeout después de ${Date.now() - startTime}ms`);
            request.destroy();
            sendResponse(504, { error: 'Request timeout - Servicio no responde' });
        });

        request.on('error', (err) => {
            console.log(`[GATEWAY] ${method} ${originalUrl} error en ${Date.now() - startTime}ms:`, err.message);
            sendResponse(502, {
                error: 'Connection failed',
                message: err.message,
                service: SERVICES.users
            });
        });

        if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
            request.write(JSON.stringify(req.body));
        }

        request.end();
    };
}

// ENDPOINTS OPTIMIZADOS PARA USERS CON CACHE CONTROL
app.post('/api/users/admins', createOptimizedUsersEndpoint('/users/admins'));
app.get('/api/users/admins/:id', createOptimizedUsersEndpoint('/users/admins/:id'));
app.put('/api/users/admins/:id', createOptimizedUsersEndpoint('/users/admins/:id'));
app.delete('/api/users/admins/:id', createOptimizedUsersEndpoint('/users/admins/:id'));

app.post('/api/users/customers', createOptimizedUsersEndpoint('/users/customers'));
app.get('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));
app.put('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));
app.put('/api/users/customers/:id/password', createOptimizedUsersEndpoint('/users/customers/:id/password'));
app.delete('/api/users/customers/:id', createOptimizedUsersEndpoint('/users/customers/:id'));

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

// LOGIN OPTIMIZADO CON CACHE CONTROL
app.post('/api/auth/login', async (req, res) => {
    const startTime = Date.now();
    console.log(`[GATEWAY] Iniciando login optimizado`);

    const options = {
        hostname: SERVICES.auth,
        path: '/auth/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Connection': 'keep-alive',
            'User-Agent': 'API-Gateway/1.0',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        },
        agent: keepAliveAgent,
        timeout: 15000
    };

    let responseSent = false;

    const sendResponse = (status, data) => {
        if (!responseSent) {
            responseSent = true;
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
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
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    const jsonData = JSON.parse(data);
                    sendResponse(response.statusCode, jsonData);
                } else {
                    sendResponse(response.statusCode, JSON.parse(data));
                }
            } catch (e) {
                sendResponse(502, { error: 'Invalid JSON response' });
            }
        });
    });

    request.on('timeout', () => {
        console.log(`[GATEWAY] Login timeout después de ${Date.now() - startTime}ms`);
        request.destroy();
        sendResponse(504, { error: 'Login timeout - Servicio no responde' });
    });

    request.on('error', (err) => {
        console.log(`[GATEWAY] Login error en ${Date.now() - startTime}ms:`, err.message);
        sendResponse(502, {
            error: 'Connection failed',
            message: err.message
        });
    });

    request.write(JSON.stringify(req.body));
    request.end();
});

// ENDPOINT PARA LIMPIAR CONEXIONES (útil para desarrollo)
app.get('/api/clear-connections', (req, res) => {
    keepAliveAgent.destroy();
    console.log('Conexiones persistentes limpiadas manualmente');
    res.json({
        message: 'Conexiones persistentes limpiadas',
        timestamp: new Date().toISOString(),
        cache_cleared: true
    });
});

// Proxy normal para endpoints menos críticos CON CACHE CONTROL
const proxyOptions = {
    changeOrigin: true,
    timeout: 10000,
    proxyTimeout: 10000,
    secure: true,
    onProxyReq: (proxyReq, req, res) => {
        proxyReq.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        proxyReq.setHeader('Pragma', 'no-cache');
        proxyReq.setHeader('Expires', '0');
    },
    onProxyRes: (proxyRes, req, res) => {
        proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
        proxyRes.headers['pragma'] = 'no-cache';
        proxyRes.headers['expires'] = '0';
    }
};

app.use('/api/auth', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.auth}`,
    pathRewrite: { '^/api/auth': '/auth' }
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

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        optimized: true,
        persistent_connections: true,
        cache_control: true,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Optimizado con control de cache',
        features: {
            login: 'Conexiones HTTPS persistentes',
            users: 'Endpoints optimizados con keep-alive',
            cache_control: 'Headers anti-cache en todas las respuestas',
            performance: 'Timeout 15s, conexiones reutilizables',
            pre_warmed: true,
            cache_clear_endpoint: '/api/clear-connections'
        },
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway ultra-optimizado ejecutándose en puerto ${PORT}`);
    console.log('Características:');
    console.log('  - Todos los endpoints con conexiones HTTPS persistentes');
    console.log('  - Control de cache implementado en todos los endpoints');
    console.log('  - Pre-calentamiento automático');
    console.log('  - Timeout optimizado: 15s');
    console.log('  - Endpoint para limpiar conexiones: /api/clear-connections');
    console.log('Endpoints optimizados:');
    console.log('  - /api/users/admins');
    console.log('  - /api/users/customers');
    console.log('  - /api/users/sellers');
    console.log('  - /api/users/password');
    console.log('  - /api/users/credentials');
    console.log('  - /api/auth/login');
});