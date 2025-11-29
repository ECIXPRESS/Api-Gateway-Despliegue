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

// Función genérica para endpoints optimizados
function createOptimizedEndpoint(service, basePath) {
    return async (req, res) => {
        const startTime = Date.now();
        const originalUrl = req.originalUrl;
        const method = req.method;

        console.log(`[GATEWAY] ${method} ${originalUrl} - Iniciando request optimizado`);

        const path = originalUrl.replace('/api', basePath);

        const options = {
            hostname: service,
            path: path,
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

        return new Promise((resolve) => {
            const request = https.request(options, (response) => {
                let data = '';

                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    const endTime = Date.now();
                    console.log(`[GATEWAY] ${method} ${originalUrl} completado en ${endTime - startTime}ms - Status: ${response.statusCode}`);

                    try {
                        // Para DELETE sin contenido
                        if (response.statusCode === 204) {
                            return res.status(204).send();
                        }

                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            const jsonData = data ? JSON.parse(data) : {};
                            res.status(response.statusCode).json(jsonData);
                        } else {
                            res.status(response.statusCode).json(data ? JSON.parse(data) : { error: 'Unknown error' });
                        }
                    } catch (e) {
                        res.status(502).json({ error: 'Invalid JSON response', details: e.message });
                    }
                    resolve();
                });
            });

            request.on('timeout', () => {
                console.log(`[GATEWAY] ${method} ${originalUrl} timeout despues de ${Date.now() - startTime}ms`);
                request.destroy();
                res.status(504).json({ error: 'Request timeout - Servicio no responde' });
                resolve();
            });

            request.on('error', (err) => {
                console.log(`[GATEWAY] ${method} ${originalUrl} error en ${Date.now() - startTime}ms:`, err.message);
                res.status(502).json({
                    error: 'Connection failed',
                    message: err.message,
                    service: service
                });
                resolve();
            });

            // Enviar body si existe
            if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
                request.write(JSON.stringify(req.body));
            }

            request.end();
        });
    };
}

// ENDPOINTS OPTIMIZADOS PARA USERS
app.post('/api/users/admins', createOptimizedEndpoint(SERVICES.users, '/users'));
app.get('/api/users/admins/:id', createOptimizedEndpoint(SERVICES.users, '/users'));
app.put('/api/users/admins/:id', createOptimizedEndpoint(SERVICES.users, '/users'));
app.delete('/api/users/admins/:id', createOptimizedEndpoint(SERVICES.users, '/users'));

app.post('/api/users/customers', createOptimizedEndpoint(SERVICES.users, '/users'));
app.get('/api/users/customers/:id', createOptimizedEndpoint(SERVICES.users, '/users'));
app.put('/api/users/customers/:id', createOptimizedEndpoint(SERVICES.users, '/users'));
app.put('/api/users/customers/:id/password', createOptimizedEndpoint(SERVICES.users, '/users'));
app.delete('/api/users/customers/:id', createOptimizedEndpoint(SERVICES.users, '/users'));

app.post('/api/users/sellers', createOptimizedEndpoint(SERVICES.users, '/users'));
app.get('/api/users/sellers/:id', createOptimizedEndpoint(SERVICES.users, '/users'));
app.get('/api/users/sellers', createOptimizedEndpoint(SERVICES.users, '/users'));
app.get('/api/users/sellers/pending', createOptimizedEndpoint(SERVICES.users, '/users'));
app.put('/api/users/sellers/:id', createOptimizedEndpoint(SERVICES.users, '/users'));
app.delete('/api/users/sellers/:id', createOptimizedEndpoint(SERVICES.users, '/users'));

// ENDPOINTS OPTIMIZADOS PARA PASSWORD RESET
app.post('/api/users/password/reset-request', createOptimizedEndpoint(SERVICES.users, '/users'));
app.post('/api/users/password/verify-code', createOptimizedEndpoint(SERVICES.users, '/users'));
app.put('/api/users/password/reset', createOptimizedEndpoint(SERVICES.users, '/users'));

// ENDPOINTS OPTIMIZADOS PARA CREDENTIALS
app.get('/api/users/credentials/:email', createOptimizedEndpoint(SERVICES.users, '/users'));
app.get('/api/users/credentials/auth', createOptimizedEndpoint(SERVICES.users, '/users'));

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

    return new Promise((resolve) => {
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
                        res.json(jsonData);
                    } else {
                        res.status(response.statusCode).json(JSON.parse(data));
                    }
                } catch (e) {
                    res.status(502).json({ error: 'Invalid JSON response' });
                }
                resolve();
            });
        });

        request.on('timeout', () => {
            console.log(`[GATEWAY] Login timeout despues de ${Date.now() - startTime}ms`);
            request.destroy();
            res.status(504).json({ error: 'Login timeout - Servicio no responde' });
            resolve();
        });

        request.on('error', (err) => {
            console.log(`[GATEWAY] Login error en ${Date.now() - startTime}ms:`, err.message);
            res.status(502).json({
                error: 'Connection failed',
                message: err.message
            });
            resolve();
        });

        request.write(JSON.stringify(req.body));
        request.end();
    });
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
        message: 'API Gateway - Todos los endpoints optimizados con conexiones persistentes',
        features: {
            login: 'Conexiones HTTPS persistentes',
            users: 'Endpoints optimizados con keep-alive',
            performance: 'Timeout 15s, conexiones reutilizables',
            pre_warmed: true
        },
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway ultra-optimizado ejecutandose en puerto ${PORT}`);
    console.log('Caracteristicas:');
    console.log('  - Todos los endpoints con conexiones HTTPS persistentes');
    console.log('  - Pre-calentamiento automatico');
    console.log('  - Timeout optimizado: 15s');
    console.log('Endpoints optimizados:');
    console.log('  - /api/users/admins');
    console.log('  - /api/users/customers');
    console.log('  - /api/users/sellers');
    console.log('  - /api/users/password');
    console.log('  - /api/users/credentials');
    console.log('  - /api/auth/login');
});