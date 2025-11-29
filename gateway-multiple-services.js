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
            timeout: 10000
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

// Función optimizada para endpoints de users - CORREGIDA
function createOptimizedUsersEndpoint(basePath) {
    return async (req, res) => {
        const startTime = Date.now();
        const method = req.method;

        // CORRECCIÓN CRÍTICA: Construir el path dinámicamente con los parámetros reales
        let targetPath = basePath;

        // Reemplazar parámetros de la URL con los valores reales (codificados)
        if (req.params) {
            Object.keys(req.params).forEach(key => {
                const paramValue = req.params[key];
                // CORRECCIÓN: Usar encodeURIComponent para emails y otros parámetros
                const encodedValue = encodeURIComponent(paramValue);
                targetPath = targetPath.replace(`:${key}`, encodedValue);
            });
        }

        // Preservar query parameters si existen
        if (Object.keys(req.query).length > 0) {
            const queryParams = new URLSearchParams(req.query).toString();
            targetPath += `?${queryParams}`;
        }

        console.log(`[GATEWAY] ${method} ${req.originalUrl} -> ${targetPath}`);

        const options = {
            hostname: SERVICES.users,
            path: targetPath,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Connection': 'keep-alive',
                'User-Agent': 'API-Gateway/1.0'
            },
            agent: keepAliveAgent,
            timeout: 15000
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
                        sendResponse(response.statusCode, data ? JSON.parse(data) : { error: 'Unknown error' });
                    }
                } catch (e) {
                    sendResponse(502, { error: 'Invalid JSON response', details: e.message });
                }
            });
        });

        request.on('timeout', () => {
            console.log(`[GATEWAY] ${method} ${req.originalUrl} timeout después de ${Date.now() - startTime}ms`);
            request.destroy();
            sendResponse(504, { error: 'Request timeout - Servicio no responde' });
        });

        request.on('error', (err) => {
            console.log(`[GATEWAY] ${method} ${req.originalUrl} error en ${Date.now() - startTime}ms:`, err.message);
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

// ENDPOINTS OPTIMIZADOS PARA USERS - CORREGIDOS
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

// Credentials endpoints - AHORA FUNCIONARÁN CON EMAILS
app.get('/api/users/credentials/:email', createOptimizedUsersEndpoint('/users/credentials/:email'));
app.get('/api/users/credentials/auth', createOptimizedUsersEndpoint('/users/credentials/auth'));

// LOGIN OPTIMIZADO (MANTENER)
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
            'User-Agent': 'API-Gateway/1.0'
        },
        agent: keepAliveAgent,
        timeout: 15000
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

// Proxy normal para endpoints menos críticos
const proxyOptions = {
    changeOrigin: true,
    timeout: 10000,
    proxyTimeout: 10000,
    secure: true
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
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Corregido para manejar parámetros dinámicos',
        features: {
            login: 'Conexiones HTTPS persistentes',
            users: 'Endpoints optimizados con parámetros dinámicos',
            performance: 'Timeout 15s, conexiones reutilizables',
            url_encoding: 'Manejo correcto de caracteres especiales',
            pre_warmed: true
        },
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway corregido ejecutándose en puerto ${PORT}`);
    console.log('Mejoras:');
    console.log('  - Manejo dinámico de parámetros en URLs');
    console.log('  - Encoding automático de caracteres especiales');
    console.log('  - Preservación de query parameters');
    console.log('Endpoints que ahora funcionarán:');
    console.log('  - /api/users/credentials/:email (con emails como manuelalejandro.guarnizo@gmail.com)');
    console.log('  - Todos los endpoints con parámetros dinámicos');
});