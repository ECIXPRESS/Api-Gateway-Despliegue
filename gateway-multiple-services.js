const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8081;

// Configuración CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'Origin'],
    exposedHeaders: ['Authorization'],
    credentials: true
}));

app.options('*', cors());

// Middleware para headers
app.use((req, res, next) => {
    if (req.headers['expect'] || req.headers['expect'] === '100-continue') {
        delete req.headers['expect'];
    }

    if (!req.headers['content-type'] && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        req.headers['content-type'] = 'application/json';
    }

    next();
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// URLs de los servicios Azure
const SERVICES = {
    users: 'https://tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    auth: 'https://tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    notifications: 'https://tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net'
};

console.log('🚀 API Gateway - Servicios Azure Configurados');
console.log('=========================================');
console.log('✅ Users Service:', SERVICES.users);
console.log('✅ Auth Service:', SERVICES.auth);
console.log('✅ Notifications Service:', SERVICES.notifications);
console.log('=========================================');

// Log de peticiones
app.use((req, res, next) => {
    console.log(`[GATEWAY] ${req.method} ${req.originalUrl}`);
    next();
});

// Configuración proxy común
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

// ==================== USERS SERVICE ENDPOINTS ====================

// Endpoints de Credenciales
app.use('/api/users/credentials', createProxyMiddleware({
    ...createProxyOptions('USERS-CREDENTIALS', SERVICES.users),
    pathRewrite: {'^/api/users/credentials': '/users/credentials'}
}));

// Endpoints de Password Reset
app.use('/api/users/password', createProxyMiddleware({
    ...createProxyOptions('USERS-PASSWORD', SERVICES.users),
    pathRewrite: {'^/api/users/password': '/users/password'}
}));

// Endpoints de Customers
app.use('/api/users/customers', createProxyMiddleware({
    ...createProxyOptions('USERS-CUSTOMERS', SERVICES.users),
    pathRewrite: {'^/api/users/customers': '/users/customers'}
}));

// Endpoints de Admins
app.use('/api/users/admins', createProxyMiddleware({
    ...createProxyOptions('USERS-ADMINS', SERVICES.users),
    pathRewrite: {'^/api/users/admins': '/users/admins'}
}));

// Endpoints de Sellers
app.use('/api/users/sellers', createProxyMiddleware({
    ...createProxyOptions('USERS-SELLERS', SERVICES.users),
    pathRewrite: {'^/api/users/sellers': '/users/sellers'}
}));

// Endpoints generales de Users (fallback)
app.use('/api/users', createProxyMiddleware({
    ...createProxyOptions('USERS', SERVICES.users),
    pathRewrite: {'^/api/users': '/users'}
}));

// ==================== AUTH SERVICE ENDPOINTS ====================

// Endpoints de Autenticación
app.use('/api/auth', createProxyMiddleware({
    ...createProxyOptions('AUTH', SERVICES.auth),
    pathRewrite: {'^/api/auth': '/auth'}
}));

// Endpoints de User Info
app.use('/api/user-info', createProxyMiddleware({
    ...createProxyOptions('USER-INFO', SERVICES.auth),
    pathRewrite: {'^/api/user-info': '/user-info'}
}));

// ==================== NOTIFICATIONS SERVICE ENDPOINTS ====================

app.use('/api/notifications', createProxyMiddleware({
    ...createProxyOptions('NOTIFICATIONS', SERVICES.notifications),
    pathRewrite: {'^/api/notifications': '/notifications'}
}));

// ==================== HEALTH & INFO ENDPOINTS ====================

app.get('/health', (req, res) => {
    res.json({
        status: 'Gateway funcionando',
        port: PORT,
        environment: process.env.NODE_ENV || 'production',
        services: SERVICES,
        timestamp: new Date().toISOString()
    });
});

app.get('/config', (req, res) => {
    res.json({
        gateway: {
            port: PORT,
            environment: process.env.NODE_ENV || 'production',
            deployed: true,
            platform: 'Render + Azure'
        },
        services: SERVICES,
        endpoints: {
            // Users Endpoints
            'GET    /api/users/credentials/{email}': 'Obtener credenciales por email',
            'GET    /api/users/credentials/auth': 'Autenticar usuario (email & password)',
            'POST   /api/users/password/reset-request': 'Solicitar reset de password',
            'POST   /api/users/password/verify-code': 'Verificar código de reset',
            'PUT    /api/users/password/reset': 'Resetear password',
            'POST   /api/users/customers': 'Crear customer',
            'GET    /api/users/customers/{id}': 'Obtener customer por ID',
            'PUT    /api/users/customers/{id}/password': 'Actualizar password',
            'PUT    /api/users/customers/{id}': 'Actualizar customer',
            'DELETE /api/users/customers/{id}': 'Eliminar customer',
            'POST   /api/users/admins': 'Crear admin',
            'GET    /api/users/admins/{id}': 'Obtener admin por ID',
            'PUT    /api/users/admins/{id}': 'Actualizar admin',
            'DELETE /api/users/admins/{id}': 'Eliminar admin',
            'POST   /api/users/sellers': 'Crear seller',
            'GET    /api/users/sellers/{id}': 'Obtener seller por ID',
            'GET    /api/users/sellers': 'Obtener todos los sellers',
            'GET    /api/users/sellers/pending': 'Obtener sellers pendientes',
            'PUT    /api/users/sellers/{id}': 'Actualizar seller',
            'DELETE /api/users/sellers/{id}': 'Eliminar seller',

            // Auth Endpoints
            'POST   /api/auth/login': 'Iniciar sesión',
            'GET    /api/auth/validate': 'Validar token',
            'GET    /api/auth/extract-username': 'Extraer email del token',
            'POST   /api/auth/refresh': 'Refrescar token',
            'GET    /api/auth/me': 'Obtener información del usuario actual',
            'GET    /api/user-info': 'Obtener información del usuario'
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Servicios Azure',
        description: 'Gateway para microservicios de Users, Authentication y Notifications',
        services: Object.keys(SERVICES),
        documentation: '/config',
        health: '/health',
        timestamp: new Date().toISOString()
    });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        message: `La ruta ${req.originalUrl} no existe`,
        available_routes: [
            '/api/auth/*',
            '/api/user-info/*',
            '/api/users/*',
            '/api/notifications/*',
            '/health',
            '/config'
        ],
        timestamp: new Date().toISOString()
    });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📍 Gateway ejecutándose en puerto ${PORT}`);
    console.log(`🌐 URL: https://api-gateway-despliegue.onrender.com`);
    console.log('✅ Listo para recibir peticiones');
    console.log('\n📋 Endpoints disponibles:');
    console.log('   GET  /api/users/credentials/{email}');
    console.log('   POST /api/auth/login');
    console.log('   GET  /api/auth/me');
    console.log('   POST /api/users/customers');
    console.log('   GET  /health');
});

process.on('SIGINT', () => {
    console.log('\n[GATEWAY] Apagando...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[GATEWAY] Apagando...');
    process.exit(0);
});