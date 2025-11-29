const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const SERVICES = {
    users: 'https://tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    auth: 'https://tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    notifications: 'https://tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net'
};

console.log('GATEWAY INICIADO');
console.log('Users Service:', SERVICES.users);
console.log('Auth Service:', SERVICES.auth);
console.log('Notifications Service:', SERVICES.notifications);

const proxyOptions = {
    changeOrigin: true,
    timeout: 60000000000000000000000000000000000000000000000000000,
    proxyTimeout: 600000000000000000000000000000000000000000000000,
    secure: true,
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[GATEWAY] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[GATEWAY] ${req.method} ${req.originalUrl} -> Status: ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
        console.error('[GATEWAY] Proxy Error:', err.code, err.message);
        res.status(502).json({
            error: 'Service unavailable',
            message: err.message,
            code: err.code
        });
    }
};

// PROXY PARA USERS SERVICE
app.use('/api/users', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.users,
    pathRewrite: { '^/api/users': '/users' }
}));

// PROXY PARA AUTH SERVICE
app.use('/api/auth', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.auth,
    pathRewrite: { '^/api/auth': '/auth' }
}));

// PROXY PARA USER-INFO (también va al auth service)
app.use('/api/user-info', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.auth,
    pathRewrite: { '^/api/user-info': '/user-info' }
}));

// PROXY PARA NOTIFICATIONS SERVICE
app.use('/api/notifications', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.notifications,
    pathRewrite: { '^/api/notifications': '/notifications' }
}));

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        services: SERVICES,
        timestamp: new Date().toISOString()
    });
});

app.get('/config', (req, res) => {
    res.json({
        gateway: {
            port: PORT,
            environment: process.env.NODE_ENV || 'production',
            deployed: true
        },
        services: SERVICES,
        endpoints: {
            // Auth endpoints
            'POST /api/auth/login': 'Iniciar sesion',
            'POST /api/auth/refresh': 'Refrescar token',
            'GET  /api/auth/validate': 'Validar token',
            'GET  /api/auth/extract-username': 'Extraer email del token',
            'GET  /api/auth/me': 'Obtener usuario actual',

            // User info
            'GET  /api/user-info': 'Obtener informacion del usuario',

            // Users endpoints
            'GET  /api/users/credentials/{email}': 'Obtener credenciales por email',
            'GET  /api/users/credentials/auth': 'Autenticar usuario (email & password)',
            'GET  /api/users/{userId}/credentials': 'Obtener usuario por ID',

            // Password reset
            'POST /api/users/password/reset-request': 'Solicitar reset de password',
            'POST /api/users/password/verify-code': 'Verificar codigo',
            'PUT  /api/users/password/reset': 'Resetear password',

            // Customers
            'POST /api/users/customers': 'Crear customer',
            'GET  /api/users/customers/{id}': 'Obtener customer por ID',
            'PUT  /api/users/customers/{id}/password': 'Actualizar password',
            'PUT  /api/users/customers/{id}': 'Actualizar customer',
            'DELETE /api/users/customers/{id}': 'Eliminar customer',

            // Admins
            'POST /api/users/admins': 'Crear admin',
            'GET  /api/users/admins/{id}': 'Obtener admin por ID',
            'PUT  /api/users/admins/{id}': 'Actualizar admin',
            'DELETE /api/users/admins/{id}': 'Eliminar admin',

            // Sellers
            'POST /api/users/sellers': 'Crear seller',
            'GET  /api/users/sellers/{id}': 'Obtener seller por ID',
            'GET  /api/users/sellers': 'Obtener todos los sellers',
            'GET  /api/users/sellers/pending': 'Obtener sellers pendientes',
            'PUT  /api/users/sellers/{id}': 'Actualizar seller',
            'DELETE /api/users/sellers/{id}': 'Eliminar seller',

            // Notifications
            'POST /api/notifications': 'Crear notificacion',
            'GET  /api/notifications': 'Obtener notificaciones'
        }
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

app.use((err, req, res, next) => {
    console.error('Error global:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway ejecutandose en puerto ${PORT}`);
    console.log('URL: https://api-gateway-despliegue.onrender.com');
    console.log('Endpoints disponibles:');
    console.log('   GET  /api/users/credentials/{email}');
    console.log('   POST /api/auth/login');
    console.log('   POST /api/users/customers');
    console.log('   GET  /health');
    console.log('   GET  /config');
});