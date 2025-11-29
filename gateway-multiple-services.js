const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const SERVICES = {
    users: 'https://tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    auth: 'https://tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    notifications: 'https://tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net'
};

console.log('GATEWAY INICIADO - CON PRE-CALENTAMIENTO');

// Pre-calentar conexiones al iniciar
async function preWarmConnections() {
    console.log('Pre-calentando conexiones...');

    const preWarmUrls = [
        `${SERVICES.auth}/auth/login`,
        `${SERVICES.users}/users/credentials/manuelalejandro.guarnizo@gmail.com`
    ];

    for (const url of preWarmUrls) {
        try {
            await axios.get(url, { timeout: 10000 });
            console.log(`Pre-calentado: ${url}`);
        } catch (error) {
            console.log(`Pre-calentado (ignorando error): ${url}`);
        }
    }
    console.log('Pre-calentamiento completado');
}

// Iniciar pre-calentamiento (no bloqueante)
preWarmConnections();

const proxyOptions = {
    changeOrigin: true,
    timeout: 25000, // 25 segundos
    proxyTimeout: 25000,
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

// Endpoint de login con conexión pre-calentada
app.post('/api/auth/login', async (req, res) => {
    console.log('[GATEWAY] Login con conexión pre-calentada');

    try {
        const response = await axios({
            method: 'POST',
            url: `${SERVICES.auth}/auth/login`,
            data: req.body,
            timeout: 20000,
            headers: {
                'Content-Type': 'application/json',
                'Connection': 'keep-alive'
            },
            httpAgent: new require('http').Agent({ keepAlive: true }),
            httpsAgent: new require('https').Agent({ keepAlive: true })
        });

        res.json(response.data);
    } catch (error) {
        console.error('[GATEWAY] Login error:', error.message);
        if (error.code === 'ECONNABORTED') {
            res.status(504).json({ error: 'Login timeout' });
        } else {
            res.status(502).json({ error: 'Login service unavailable' });
        }
    }
});

// Los demás endpoints con proxy normal
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
        preWarmed: true,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Con pre-calentamiento',
        services: SERVICES,
        endpoints: {
            'POST /api/auth/login': 'Login (conexión pre-calentada)',
            'GET  /api/users/credentials/{email}': 'Obtener usuario',
            'POST /api/users/customers': 'Crear customer',
            'GET  /health': 'Health check'
        },
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway ejecutandose en puerto ${PORT}`);
    console.log('Pre-calentamiento activado');
});