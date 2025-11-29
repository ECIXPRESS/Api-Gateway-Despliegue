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

    const preWarmOptions = {
        hostname: SERVICES.auth,
        path: '/auth/login',
        method: 'HEAD',
        agent: keepAliveAgent,
        timeout: 10000
    };

    const req = https.request(preWarmOptions, (res) => {
        console.log('Conexión pre-calentada establecida');
    });

    req.on('error', () => {
        console.log('Pre-calentamiento completado (ignorando errores)');
    });

    req.end();
}

preWarmConnections();

// LOGIN ULTRA-OPTIMIZADO con HTTPS nativo
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
            console.log(`[GATEWAY] Login timeout después de ${Date.now() - startTime}ms`);
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

        // Enviar body
        request.write(JSON.stringify(req.body));
        request.end();
    });
});

// Proxy normal para los demás endpoints (más rápidos)
const proxyOptions = {
    changeOrigin: true,
    timeout: 10000,
    proxyTimeout: 10000,
    secure: true
};

// ENDPOINTS DE USERS - CORREGIDOS
app.use('/api/users/admins', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.users}`,
    pathRewrite: { '^/api/users/admins': '/users/admins' }
}));

app.use('/api/users/customers', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.users}`,
    pathRewrite: { '^/api/users/customers': '/users/customers' }
}));

app.use('/api/users/sellers', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.users}`,
    pathRewrite: { '^/api/users/sellers': '/users/sellers' }
}));

app.use('/api/users/password', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.users}`,
    pathRewrite: { '^/api/users/password': '/users/password' }
}));

// ENDPOINTS EXISTENTES (MANTENER)
app.use('/api/users/credentials', createProxyMiddleware({
    ...proxyOptions,
    target: `https://${SERVICES.users}`,
    pathRewrite: { '^/api/users/credentials': '/users/credentials' }
}));

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
        message: 'API Gateway - Optimizado con conexiones persistentes',
        features: {
            login: 'Conexiones HTTPS persistentes',
            other_endpoints: 'Proxy normal',
            pre_warmed: true,
            endpoints: [
                '/api/auth/login',
                '/api/users/admins',
                '/api/users/customers',
                '/api/users/sellers',
                '/api/users/password',
                '/api/users/credentials',
                '/api/notifications'
            ]
        },
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway optimizado ejecutándose en puerto ${PORT}`);
    console.log('Características:');
    console.log('  - Conexiones HTTPS persistentes');
    console.log('  - Pre-calentamiento automático');
    console.log('  - Timeout optimizado: 15s login, 10s otros');
    console.log('Endpoints disponibles:');
    console.log('  - /api/auth/login');
    console.log('  - /api/users/admins');
    console.log('  - /api/users/customers');
    console.log('  - /api/users/sellers');
    console.log('  - /api/users/password');
    console.log('  - /api/users/credentials');
    console.log('  - /api/notifications');
});