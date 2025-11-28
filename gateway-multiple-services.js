const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8081;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'Origin'],
    exposedHeaders: ['Authorization'],
    credentials: true
}));

app.options('*', cors());

app.use((req, res, next) => {
    if (req.headers['expect'] || req.headers['expect'] === '100-continue') {
        delete req.headers['expect'];
    }

    if (!req.headers['content-type'] && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        req.headers['content-type'] = 'application/json';
    }

    next();
});

app.use(express.json({
    limit: '10mb'
}));

app.use(express.urlencoded({
    extended: true,
    limit: '10mb'
}));

const SERVICES = {
    users: process.env.USERS_SERVICE_URL || 'https://tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    auth: process.env.AUTH_SERVICE_URL || 'https://tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    notifications: process.env.NOTIFICATIONS_SERVICE_URL || 'https://tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net'
};

console.log('🚀 API Gateway - Microservicios Azure');
console.log('=========================================');
console.log('✅ Users:', SERVICES.users);
console.log('✅ Auth:', SERVICES.auth);
console.log('✅ Notifications:', SERVICES.notifications);
console.log('=========================================');

app.use((req, res, next) => {
    console.log(`[GATEWAY] ${req.method} ${req.originalUrl}`);
    next();
});

const createProxyOptions = (serviceName, target) => ({
    target: target,
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    secure: true,
    onProxyReq: (proxyReq, req, res) => {
        proxyReq.removeHeader('expect');
        proxyReq.removeHeader('Expect');

        if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
            const bodyData = JSON.stringify(req.body);
            if (bodyData && bodyData !== '{}') {
                proxyReq.setHeader('Content-Type', 'application/json');
                proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                proxyReq.write(bodyData);
            }
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        proxyRes.headers['access-control-allow-origin'] = '*';
        proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH';
        proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, Accept, X-Requested-With, Origin';
    },
    onError: (err, req, res) => {
        console.error(`[GATEWAY-${serviceName}] Error:`, err.message);
        res.status(503).json({
            error: `Servicio ${serviceName} no disponible`,
            message: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.use('/api/users', createProxyMiddleware({
    ...createProxyOptions('USERS', SERVICES.users),
    pathRewrite: {'^/api/users': ''}
}));

app.use('/api/auth', createProxyMiddleware({
    ...createProxyOptions('AUTH', SERVICES.auth),
    pathRewrite: {'^/api/auth': ''}
}));

app.use('/api/user-info', createProxyMiddleware({
    ...createProxyOptions('USER-INFO', SERVICES.auth),
    pathRewrite: {'^/api/user-info': ''}
}));

app.use('/api/notifications', createProxyMiddleware({
    ...createProxyOptions('NOTIFICATIONS', SERVICES.notifications),
    pathRewrite: {'^/api/notifications': ''}
}));

app.get('/health', (req, res) => {
    res.json({
        status: 'Gateway funcionando',
        port: PORT,
        environment: process.env.NODE_ENV || 'production',
        services: SERVICES,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Servicios Azure',
        services: {
            users: SERVICES.users,
            auth: SERVICES.auth,
            notifications: SERVICES.notifications
        },
        endpoints: [
            'GET  /api/users/credentials/{email}',
            'GET  /api/users/{userId}/credentials',
            'POST /api/users',
            'POST /api/auth/login',
            'POST /api/auth/refresh',
            'GET  /api/user-info',
            'POST /api/notifications'
        ],
        timestamp: new Date().toISOString()
    });
});

app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        available_routes: [
            '/api/auth/*',
            '/api/user-info/*',
            '/api/users/*',
            '/api/notifications/*',
            '/health'
        ],
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📍 Gateway ejecutándose en puerto ${PORT}`);
    console.log(`🌐 URL: https://api-gateway-despliegue.onrender.com`);
    console.log('✅ Listo para recibir peticiones');
});

process.on('SIGINT', () => {
    console.log('\n[GATEWAY] Apagando...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[GATEWAY] Apagando...');
    process.exit(0);
});