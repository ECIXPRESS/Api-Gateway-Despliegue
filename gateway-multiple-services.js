const express = require('express');
const cors = require('cors');
const https = require('https');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Agent optimizado con más conexiones
const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 30,
    timeout: 60000,
    keepAliveMsecs: 30000
});

// Servicios con endpoints de warmup
const SERVICES = {
    auth: {
        host: 'tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
        warmupPaths: ['/auth/health', '/auth/login'],
        status: 'pending'
    },
    users: {
        host: 'tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
        warmupPaths: ['/users/health', '/users/admins'],
        status: 'pending'
    },
    notifications: {
        host: 'tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net',
        warmupPaths: ['/notifications/health', '/notifications'],
        status: 'pending'
    }
};

// Cache para respuestas mientras se activan
const responseCache = new Map();
const CACHE_DURATION = 5000; // 5 segundos

// Función para activar TODOS los servicios al inicio
async function warmupAllServices() {
    console.log('🔥 Activando todos los microservicios de Azure...');

    const warmupPromises = [];

    for (const [serviceName, service] of Object.entries(SERVICES)) {
        for (const path of service.warmupPaths) {
            warmupPromises.push(
                new Promise((resolve) => {
                    const options = {
                        hostname: service.host,
                        path: path,
                        method: 'GET',
                        agent: keepAliveAgent,
                        timeout: 10000,
                        headers: {
                            'X-Warmup': 'true',
                            'User-Agent': 'API-Gateway-Warmup/1.0'
                        }
                    };

                    const req = https.request(options, (res) => {
                        console.log(`✅ ${serviceName} activado (${res.statusCode})`);
                        SERVICES[serviceName].status = 'active';
                        resolve(true);
                    });

                    req.on('error', (err) => {
                        console.log(`⚠ ${serviceName} en proceso: ${err.message}`);
                        SERVICES[serviceName].status = 'starting';
                        resolve(false);
                    });

                    req.on('timeout', () => {
                        console.log(`⏳ ${serviceName} iniciando (timeout)...`);
                        SERVICES[serviceName].status = 'warming';
                        resolve(false);
                    });

                    req.end();
                })
            );

            // Pequeño delay entre requests
            await new Promise(r => setTimeout(r, 500));
        }
    }

    await Promise.all(warmupPromises);
    console.log('🎯 Warmup completado. Servicios listos.');
}

// Warmup al iniciar
warmupAllServices();

// Warmup periódico cada 3 minutos
setInterval(warmupAllServices, 3 * 60 * 1000);

// Middleware para manejar servicios en calentamiento
app.use((req, res, next) => {
    const servicePath = req.path;
    let serviceName = '';

    if (servicePath.includes('/auth/')) serviceName = 'auth';
    else if (servicePath.includes('/users/')) serviceName = 'users';
    else if (servicePath.includes('/notifications/')) serviceName = 'notifications';

    if (serviceName && SERVICES[serviceName].status !== 'active') {
        // Si el servicio no está activo, activarlo inmediatamente
        console.log(`🚀 Activando ${serviceName} bajo demanda...`);
        warmupServiceImmediately(serviceName);
    }

    next();
});

function warmupServiceImmediately(serviceName) {
    const service = SERVICES[serviceName];

    // Activación inmediata en segundo plano
    setTimeout(() => {
        service.warmupPaths.forEach(path => {
            const req = https.request({
                hostname: service.host,
                path: path,
                method: 'GET',
                agent: keepAliveAgent,
                timeout: 5000
            }, () => {
                SERVICES[serviceName].status = 'active';
            });

            req.on('error', () => {});
            req.end();
        });
    }, 100);
}

// Proxy optimizado con retry automático
function createOptimizedProxy(serviceName) {
    return async (req, res) => {
        const startTime = Date.now();
        const method = req.method;
        const originalPath = req.params[0] || '';

        const service = SERVICES[serviceName];
        const cacheKey = `${method}:${req.originalUrl}`;

        // Intentar cache primero si es GET
        if (method === 'GET' && responseCache.has(cacheKey)) {
            const cached = responseCache.get(cacheKey);
            if (Date.now() - cached.timestamp < CACHE_DURATION) {
                console.log(`📦 Cache hit: ${req.originalUrl}`);
                return res.status(cached.status).json(cached.data);
            }
        }

        let targetPath = `/${originalPath}`;
        if (Object.keys(req.query).length > 0) {
            const queryParams = new URLSearchParams(req.query).toString();
            targetPath += `?${queryParams}`;
        }

        // Función para intentar la llamada con retry
        const tryRequest = async (attempt = 1) => {
            return new Promise((resolve) => {
                const options = {
                    hostname: service.host,
                    path: targetPath,
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Connection': 'keep-alive',
                        ...req.headers,
                        'host': null
                    },
                    agent: keepAliveAgent,
                    timeout: attempt === 1 ? 10000 : 15000
                };

                const request = https.request(options, (response) => {
                    let data = '';

                    response.on('data', (chunk) => {
                        data += chunk;
                    });

                    response.on('end', () => {
                        const duration = Date.now() - startTime;

                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            SERVICES[serviceName].status = 'active';
                        }

                        resolve({
                            status: response.statusCode,
                            data: data ? JSON.parse(data) : null,
                            headers: response.headers,
                            duration: duration
                        });
                    });
                });

                request.on('timeout', () => {
                    request.destroy();
                    resolve({
                        status: 504,
                        data: {
                            error: 'Service warming up',
                            message: `Servicio ${serviceName} se está activando (attempt ${attempt})`,
                            retry: true
                        },
                        duration: Date.now() - startTime
                    });
                });

                request.on('error', (err) => {
                    resolve({
                        status: 502,
                        data: {
                            error: 'Service starting',
                            message: `Activando ${serviceName}...`,
                            attempt: attempt,
                            retry: attempt < 3
                        },
                        duration: Date.now() - startTime
                    });
                });

                if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
                    request.write(JSON.stringify(req.body));
                }

                request.end();
            });
        };

        // Intentar hasta 3 veces con delay progresivo
        let result;
        for (let attempt = 1; attempt <= 3; attempt++) {
            result = await tryRequest(attempt);

            if (result.status !== 502 && result.status !== 504) {
                break;
            }

            if (attempt < 3) {
                console.log(`🔄 Retry ${attempt} para ${serviceName}...`);
                await new Promise(r => setTimeout(r, attempt * 1000));
            }
        }

        // Cachear respuestas exitosas GET
        if (method === 'GET' && result.status >= 200 && result.status < 300) {
            responseCache.set(cacheKey, {
                data: result.data,
                status: result.status,
                timestamp: Date.now()
            });
        }

        // Enviar respuesta
        res.status(result.status).json(result.data);
    };
}

// Definir endpoints
app.post('/api/auth/login', createOptimizedProxy('auth'));
app.get('/api/auth/verify', createOptimizedProxy('auth'));

app.get('/api/users/credentials/:email', createOptimizedProxy('users'));
app.post('/api/users/admins', createOptimizedProxy('users'));
app.get('/api/users/admins/:id', createOptimizedProxy('users'));
app.put('/api/users/admins/:id', createOptimizedProxy('users'));
app.delete('/api/users/admins/:id', createOptimizedProxy('users'));

app.post('/api/users/customers', createOptimizedProxy('users'));
app.get('/api/users/customers/:id', createOptimizedProxy('users'));
app.put('/api/users/customers/:id', createOptimizedProxy('users'));
app.delete('/api/users/customers/:id', createOptimizedProxy('users'));

app.post('/api/users/sellers', createOptimizedProxy('users'));
app.get('/api/users/sellers/:id', createOptimizedProxy('users'));
app.get('/api/users/sellers', createOptimizedProxy('users'));
app.get('/api/users/sellers/pending', createOptimizedProxy('users'));
app.put('/api/users/sellers/:id', createOptimizedProxy('users'));
app.delete('/api/users/sellers/:id', createOptimizedProxy('users'));

app.post('/api/notifications', createOptimizedProxy('notifications'));
app.get('/api/notifications/:userId', createOptimizedProxy('notifications'));

// Health check mejorado
app.get('/health', (req, res) => {
    const servicesStatus = {};
    Object.entries(SERVICES).forEach(([name, service]) => {
        servicesStatus[name] = {
            status: service.status,
            host: service.host
        };
    });

    res.json({
        status: 'OK',
        gateway: 'ECI-EXPRESS (Optimizado)',
        timestamp: new Date().toISOString(),
        services: servicesStatus,
        features: {
            warmup: 'Automático al inicio',
            retry: '3 intentos automáticos',
            cache: 'GET requests cacheados',
            keepAlive: 'Conexiones persistentes'
        }
    });
});

// Endpoint para forzar warmup
app.post('/warmup', async (req, res) => {
    await warmupAllServices();
    res.json({ message: 'Warmup ejecutado manualmente' });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway Optimizado',
        description: 'Servicios se activan automáticamente al inicio',
        endpoints: {
            auth: 'POST /api/auth/login',
            users: 'GET /api/users/credentials/:email',
            notifications: 'POST /api/notifications',
            health: 'GET /health',
            warmup: 'POST /warmup'
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 API GATEWAY OPTIMIZADO
    ========================
    Puerto: ${PORT}
    
    🔥 Características:
    • Warmup automático al inicio
    • Retry automático (3 intentos)
    • Cache para respuestas
    • Conexiones persistentes
    • Activación bajo demanda
    
    ⚡ Los servicios se activarán automáticamente
    en los primeros 10-15 segundos.
    
    📍 Endpoints:
    Health: http://localhost:${PORT}/health
    Warmup: POST http://localhost:${PORT}/warmup
    `);
});