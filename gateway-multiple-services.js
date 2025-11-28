const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const GATEWAY_PORT = process.env.PORT || 8081;

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
        console.log('[GATEWAY] Eliminando header Expect problemático');
        delete req.headers['expect'];
    }

    if (!req.headers['content-type'] && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        req.headers['content-type'] = 'application/json';
    }

    next();
});

app.use(express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
        try {
            if (buf && buf.length > 0) {
                JSON.parse(buf.toString());
            }
        } catch (e) {
            console.log('[GATEWAY] Body JSON no válido, pero continuando...');
        }
    }
}));

app.use(express.urlencoded({
    extended: true,
    limit: '10mb'
}));

const services = {
    usuarios: process.env.USERS_SERVICE_URL || 'https://tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    autenticacion: process.env.AUTH_SERVICE_URL || 'https://tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net'
};

const validateServiceUrl = (url, serviceName) => {
    if (!url || url.includes('tu-') || url.includes('localhost')) {
        console.warn(`⚠️  Servicio ${serviceName} no configurado: ${url}`);
        return null;
    }
    return url;
};

const validatedServices = {
    usuarios: validateServiceUrl(services.usuarios, 'USERS'),
    autenticacion: validateServiceUrl(services.autenticacion, 'AUTH')
};

console.log('🎯 CONFIGURACIÓN DE SERVICIOS ACTIVOS:');
console.log('=========================================');
Object.entries(validatedServices).forEach(([key, value]) => {
    if (value) {
        console.log(`✅ ${key.toUpperCase()}: ${value}`);
    } else {
        console.log(`❌ ${key.toUpperCase()}: NO CONFIGURADO`);
    }
});
console.log('=========================================');

app.use((req, res, next) => {
    console.log('[GATEWAY] ======== NUEVA PETICIÓN ========');
    console.log(`[GATEWAY] ${req.method} ${req.originalUrl}`);
    console.log(`[GATEWAY] Headers:`, JSON.stringify(req.headers, null, 2));

    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`[GATEWAY] Body:`, JSON.stringify(req.body, null, 2));
    } else {
        console.log(`[GATEWAY] Body: vacío o no JSON`);
    }

    next();
});

app.get('/health', (req, res) => {
    const activeServices = {};
    Object.entries(validatedServices).forEach(([key, value]) => {
        if (value) activeServices[key] = value;
    });

    res.json({
        status: 'Gateway funcionando',
        port: GATEWAY_PORT,
        environment: process.env.NODE_ENV || 'production',
        services_active: Object.keys(activeServices).length,
        microservicios: activeServices,
        timestamp: new Date().toISOString()
    });
});

const createProxyOptions = (serviceName, target) => ({
    target: target,
    changeOrigin: true,
    timeout: 30000,
    proxyTimeout: 30000,
    secure: true,
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[GATEWAY-${serviceName}] Proxying to: ${target}${req.url}`);
        console.log(`[GATEWAY-${serviceName}] Method: ${req.method}`);

        proxyReq.removeHeader('expect');
        proxyReq.removeHeader('Expect');

        proxyReq.setHeader('Accept', 'application/json');
        proxyReq.setHeader('X-Forwarded-For', req.ip);
        proxyReq.setHeader('X-Forwarded-Host', req.hostname);
        proxyReq.setHeader('X-Forwarded-Proto', req.protocol);

        if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
            const bodyData = JSON.stringify(req.body);
            console.log(`[GATEWAY-${serviceName}] Body data: ${bodyData}`);

            if (bodyData && bodyData !== '{}') {
                proxyReq.setHeader('Content-Type', 'application/json');
                proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                proxyReq.write(bodyData);
            }
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[GATEWAY-${serviceName}] Response Status: ${proxyRes.statusCode}`);
        console.log(`[GATEWAY-${serviceName}] Response Headers:`, JSON.stringify(proxyRes.headers, null, 2));

        proxyRes.headers['access-control-allow-origin'] = '*';
        proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH';
        proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, Accept, X-Requested-With, Origin';
    },
    onError: (err, req, res) => {
        console.error(`[GATEWAY-${serviceName}] Proxy error:`, err.message);
        console.error(`[GATEWAY-${serviceName}] Error code:`, err.code);

        if (err.code === 'ECONNREFUSED') {
            res.status(503).json({
                error: `Servicio ${serviceName} no disponible`,
                message: `No se puede conectar a ${target}`,
                details: err.message,
                timestamp: new Date().toISOString()
            });
        } else if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
            res.status(504).json({
                error: `Timeout del servicio ${serviceName}`,
                message: `El servicio no respondió a tiempo`,
                details: err.message,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                error: `Error en proxy ${serviceName}`,
                message: err.message,
                code: err.code,
                timestamp: new Date().toISOString()
            });
        }
    }
});

if (validatedServices.usuarios) {
    app.use('/api/users', createProxyMiddleware({
        ...createProxyOptions('USERS', validatedServices.usuarios),
        pathRewrite: {
            '^/api/users': ''
        },
        onProxyReq: (proxyReq, req, res) => {
            console.log(`[GATEWAY-USERS] === PROXY USERS DETALLADO ===`);
            console.log(`[GATEWAY-USERS] Original URL: ${req.originalUrl}`);
            console.log(`[GATEWAY-USERS] Rewritten URL: ${req.url.replace('/api/users', '')}`);

            proxyReq.removeHeader('expect');
            proxyReq.removeHeader('Expect');

            if (req.body) {
                console.log(`[GATEWAY-USERS] Body recibido:`, JSON.stringify(req.body, null, 2));

                const bodyData = JSON.stringify(req.body);
                if (bodyData && bodyData !== '{}') {
                    proxyReq.setHeader('Content-Type', 'application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    proxyReq.write(bodyData);
                    console.log(`[GATEWAY-USERS] Body enviado: ${bodyData}`);
                }
            }

            console.log(`[GATEWAY-USERS] Headers finales:`, JSON.stringify(proxyReq.getHeaders(), null, 2));
        }
    }));
    console.log('✅ Proxy USERS configurado');
} else {
    console.log('❌ Proxy USERS NO configurado - URL no válida');
}

if (validatedServices.autenticacion) {
    app.use('/api/auth', createProxyMiddleware({
        ...createProxyOptions('AUTH', validatedServices.autenticacion),
        pathRewrite: {
            '^/api/auth': ''
        }
    }));

    app.use('/api/user-info', createProxyMiddleware({
        ...createProxyOptions('USER-INFO', validatedServices.autenticacion),
        pathRewrite: {
            '^/api/user-info': ''
        }
    }));
    console.log('✅ Proxy AUTH configurado');
} else {
    console.log('❌ Proxy AUTH NO configurado - URL no válida');
}

app.get('/config', (req, res) => {
    const activeServices = {};
    Object.entries(validatedServices).forEach(([key, value]) => {
        if (value) activeServices[key] = value;
    });

    res.json({
        gateway: {
            port: GATEWAY_PORT,
            environment: process.env.NODE_ENV || 'production',
            deployed: true,
            platform: 'Render + Azure',
            services_active: Object.keys(activeServices).length
        },
        services: activeServices,
        endpoints_activos: {
            'POST /api/auth/login': 'Iniciar sesión',
            'POST /api/auth/refresh': 'Refrescar token',
            'GET /api/user-info': 'Obtener información del usuario',
            'GET /api/users/credentials/{email}': 'Obtener credenciales de usuario',
            'GET /api/users/credentials/auth': 'Validar credenciales',
            'GET /api/users/{userId}/credentials': 'Obtener usuario por ID',
            'POST /api/users': 'Crear usuario',
            'GET /api/users/{id}': 'Obtener usuario por ID',
            'PUT /api/users/{id}': 'Actualizar usuario',
            'POST /api/users/password/reset-request': 'Solicitar reset de password',
            'POST /api/users/password/verify-code': 'Verificar código',
            'PUT /api/users/password/reset': 'Resetear password'
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/api/test-proxy', (req, res) => {
    const activeServices = {};
    Object.entries(validatedServices).forEach(([key, value]) => {
        if (value) activeServices[key] = value;
    });

    res.json({
        message: 'Test de proxy exitoso',
        services: activeServices,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    const activeServices = {};
    Object.entries(validatedServices).forEach(([key, value]) => {
        if (value) activeServices[key] = value;
    });

    res.json({
        message: 'Gateway funcionando - SERVICIOS USERS Y AUTH ACTIVOS',
        environment: process.env.NODE_ENV || 'production',
        services_active: Object.keys(activeServices).length,
        microservicios: activeServices,
        endpoints: [
            'POST /api/auth/login',
            'POST /api/auth/refresh',
            'GET /api/user-info',
            'GET /api/users/credentials/{email}',
            'GET /api/users/credentials/auth',
            'GET /api/users/{userId}/credentials',
            'POST /api/users',
            'GET /api/users/{id}',
            'PUT /api/users/{id}',
            'POST /api/users/password/reset-request',
            'POST /api/users/password/verify-code',
            'PUT /api/users/password/reset'
        ],
        timestamp: new Date().toISOString()
    });
});

app.use((err, req, res, next) => {
    console.error('[GATEWAY] Error no manejado:', err);
    console.error('[GATEWAY] Error stack:', err.stack);

    res.status(500).json({
        error: 'Error interno del gateway',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

app.use('*', (req, res) => {
    console.log(`[GATEWAY] Ruta no encontrada: ${req.originalUrl}`);
    res.status(404).json({
        error: 'Ruta no encontrada',
        message: `La ruta ${req.originalUrl} no existe`,
        available_routes: [
            '/api/auth/*',
            '/api/user-info/*',
            '/api/users/*',
            '/health',
            '/config',
            '/api/test-proxy'
        ],
        timestamp: new Date().toISOString()
    });
});

app.listen(GATEWAY_PORT, '0.0.0.0', () => {
    console.log('=========================================');
    console.log('🚀 GATEWAY INICIADO - PATH REWRITE CORREGIDO');
    console.log('=========================================');
    console.log(`URL: https://api-gateway-despliegue.onrender.com`);
    console.log('Environment:', process.env.NODE_ENV || 'production');
    console.log('Servicios activos:');

    Object.entries(validatedServices).forEach(([key, value]) => {
        if (value) {
            console.log(`✅ ${key.toUpperCase()}: ${value}`);
        }
    });

    console.log('Endpoints disponibles:');
    console.log('- POST   /api/auth/login');
    console.log('- POST   /api/auth/refresh');
    console.log('- GET    /api/user-info');
    console.log('- GET    /api/users/credentials/{email}');
    console.log('- GET    /api/users/credentials/auth');
    console.log('- GET    /api/users/{userId}/credentials');
    console.log('- POST   /api/users');
    console.log('- GET    /api/users/{id}');
    console.log('- PUT    /api/users/{id}');
    console.log('- POST   /api/users/password/reset-request');
    console.log('- POST   /api/users/password/verify-code');
    console.log('- PUT    /api/users/password/reset');
    console.log('=========================================');
});

process.on('SIGINT', () => {
    console.log('\n[GATEWAY] Apagando gateway...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[GATEWAY] Apagando gateway...');
    process.exit(0);
});