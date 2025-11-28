const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware básico
app.use(cors());
app.use(express.json());

// URLs DIRECTAS - SIN VARIABLES DE ENTORNO
const SERVICES = {
    users: 'https://tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    auth: 'https://tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    notifications: 'https://tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net'
};

console.log('🚀 GATEWAY INICIADO - URLs DIRECTAS');
console.log('Users:', SERVICES.users);
console.log('Auth:', SERVICES.auth);
console.log('Notifications:', SERVICES.notifications);

// Configuración proxy MUY SIMPLE
const proxyOptions = {
    changeOrigin: true,
    timeout: 30000,
    secure: true,
    onError: (err, req, res) => {
        console.error('Proxy Error:', err.message);
        res.status(502).json({
            error: 'Service unavailable',
            message: err.message
        });
    }
};

// PROXY PARA USERS SERVICE
app.use('/api/users', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.users,
    pathRewrite: {
        '^/api/users': '/users'
    }
}));

// PROXY PARA AUTH SERVICE
app.use('/api/auth', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.auth,
    pathRewrite: {
        '^/api/auth': '/auth'
    }
}));

// PROXY PARA NOTIFICATIONS SERVICE
app.use('/api/notifications', createProxyMiddleware({
    ...proxyOptions,
    target: SERVICES.notifications,
    pathRewrite: {
        '^/api/notifications': '/notifications'
    }
}));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        services: {
            users: SERVICES.users,
            auth: SERVICES.auth,
            notifications: SERVICES.notifications
        },
        timestamp: new Date().toISOString()
    });
});

// Ruta principal
app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Servicios Azure',
        endpoints: {
            'GET  /api/users/credentials/{email}': 'Obtener usuario por email',
            'POST /api/auth/login': 'Iniciar sesión',
            'GET  /api/auth/me': 'Obtener usuario actual',
            'GET  /health': 'Health check'
        }
    });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Gateway ejecutándose en puerto ${PORT}`);
    console.log('📝 Endpoints:');
    console.log('   GET  /api/users/credentials/{email}');
    console.log('   POST /api/auth/login');
    console.log('   GET  /health');
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error global:', err);
    res.status(500).json({ error: 'Internal server error' });
});