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
    timeout: 30000,
    proxyTimeout: 30000,
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

app.use('/api/users', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.users,
    pathRewrite: { '^/api/users': '/users' }
}));

app.use('/api/auth', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.auth,
    pathRewrite: { '^/api/auth': '/auth' }
}));

app.use('/api/user-info', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.auth,
    pathRewrite: { '^/api/user-info': '/user-info' }
}));

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

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Servicios Azure',
        services: {
            users: SERVICES.users,
            auth: SERVICES.auth,
            notifications: SERVICES.notifications
        },
        endpoints: {
            'GET  /api/users/credentials/{email}': 'Obtener usuario por email',
            'POST /api/auth/login': 'Iniciar sesion',
            'GET  /api/auth/me': 'Obtener usuario actual',
            'POST /api/users/customers': 'Crear customer',
            'GET  /health': 'Health check'
        },
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
            '/health'
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
});