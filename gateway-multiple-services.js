const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    timeout: 30000
});

// 🎯 URLs CORRECTAS de tus Functions
const SERVICES = {
    auth: 'tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    users: 'tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    notifications: 'tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net'
};

console.log('🔧 Servicios configurados:');
Object.entries(SERVICES).forEach(([name, url]) => {
    console.log(`  ${name}: ${url}`);
});

// Función simple de proxy que SE CONECTA DIRECTAMENTE
function createDirectProxy(serviceName, azurePath) {
    return (req, res) => {
        const startTime = Date.now();
        const requestId = Date.now();

        console.log(`📞 [${requestId}] Llamando a ${serviceName}...`);
        console.log(`   URL: https://${SERVICES[serviceName]}${azurePath}`);

        // Construir path dinámico
        let targetPath = azurePath;

        // Reemplazar parámetros como :email
        if (req.params) {
            Object.keys(req.params).forEach(key => {
                if (req.params[key]) {
                    const encodedValue = encodeURIComponent(req.params[key]);
                    targetPath = targetPath.replace(`:${key}`, encodedValue);
                }
            });
        }

        // Añadir query parameters
        if (Object.keys(req.query).length > 0) {
            const queryParams = new URLSearchParams(req.query).toString();
            targetPath += `?${queryParams}`;
        }

        const options = {
            hostname: SERVICES[serviceName],
            path: targetPath,
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Request-ID': requestId,
                'User-Agent': 'Render-Gateway/1.0',
                ...req.headers,
                'host': SERVICES[serviceName]
            },
            agent: keepAliveAgent,
            timeout: 45000  // 45 segundos para cold start
        };

        console.log(`   Path final: ${targetPath}`);
        console.log(`   Method: ${req.method}`);

        let responseSent = false;

        const sendResponse = (status, data) => {
            if (!responseSent) {
                responseSent = true;
                const duration = Date.now() - startTime;
                console.log(`✅ [${requestId}] ${serviceName} → ${duration}ms`);
                res.status(status).json(data);
            }
        };

        const request = https.request(options, (response) => {
            console.log(`   Azure respondió: ${response.statusCode}`);

            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                console.log(`   Bytes recibidos: ${data.length}`);

                try {
                    if (response.statusCode === 204) {
                        return sendResponse(204, {});
                    }

                    if (data) {
                        const jsonData = JSON.parse(data);
                        sendResponse(response.statusCode, jsonData);
                    } else {
                        sendResponse(response.statusCode, {
                            message: 'Empty response',
                            status: response.statusCode
                        });
                    }
                } catch (e) {
                    console.log(`   Error parseando JSON: ${e.message}`);
                    console.log(`   Respuesta cruda: ${data.substring(0, 200)}...`);

                    sendResponse(response.statusCode, {
                        raw: data,
                        error: 'Invalid JSON',
                        azureStatus: response.statusCode,
                        note: 'Azure Functions está respondiendo pero con formato inesperado'
                    });
                }
            });
        });

        request.on('timeout', () => {
            console.log(`⏳ [${requestId}] Timeout - Azure Functions está en COLD START`);
            request.destroy();

            sendResponse(504, {
                error: 'Azure Functions starting',
                message: 'El servicio se está iniciando automáticamente (cold start)',
                service: serviceName,
                azureUrl: `https://${SERVICES[serviceName]}`,
                action: 'Intenta nuevamente en 5-10 segundos. Azure Functions se activa solo.',
                estimatedTime: '2-10 segundos para primera activación'
            });
        });

        request.on('error', (err) => {
            console.log(`🔌 [${requestId}] Error conexión: ${err.code} - ${err.message}`);

            sendResponse(502, {
                error: 'Azure Connection',
                code: err.code,
                message: err.message,
                service: serviceName,
                realUrl: `https://${SERVICES[serviceName]}`,
                whatHappening: 'Azure Functions se está ACTIVANDO AUTOMÁTICAMENTE',
                whatToDo: 'Espera 10 segundos y vuelve a intentar. La primera activación tarda 2-10s.'
            });
        });

        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            console.log(`   Body: ${JSON.stringify(req.body).substring(0, 100)}...`);
            request.write(JSON.stringify(req.body));
        }

        request.end();
    };
}

// ==================== ENDPOINTS ====================

// AUTH
app.post('/api/auth/login', createDirectProxy('auth', '/api/auth/login'));

// USERS
app.get('/api/users/credentials/:email', createDirectProxy('users', '/api/users/credentials/:email'));
app.get('/api/users/credentials/auth', createDirectProxy('users', '/api/users/credentials/auth'));

app.post('/api/users/admins', createDirectProxy('users', '/api/users/admins'));
app.get('/api/users/admins/:id', createDirectProxy('users', '/api/users/admins/:id'));
app.put('/api/users/admins/:id', createDirectProxy('users', '/api/users/admins/:id'));
app.delete('/api/users/admins/:id', createDirectProxy('users', '/api/users/admins/:id'));

app.post('/api/users/customers', createDirectProxy('users', '/api/users/customers'));
app.get('/api/users/customers/:id', createDirectProxy('users', '/api/users/customers/:id'));
app.put('/api/users/customers/:id', createDirectProxy('users', '/api/users/customers/:id'));
app.delete('/api/users/customers/:id', createDirectProxy('users', '/api/users/customers/:id'));

app.post('/api/users/sellers', createDirectProxy('users', '/api/users/sellers'));
app.get('/api/users/sellers/:id', createDirectProxy('users', '/api/users/sellers/:id'));
app.get('/api/users/sellers', createDirectProxy('users', '/api/users/sellers'));
app.get('/api/users/sellers/pending', createDirectProxy('users', '/api/users/sellers/pending'));
app.put('/api/users/sellers/:id', createDirectProxy('users', '/api/users/sellers/:id'));
app.delete('/api/users/sellers/:id', createDirectProxy('users', '/api/users/sellers/:id'));

app.post('/api/users/password/reset-request', createDirectProxy('users', '/api/users/password/reset-request'));
app.post('/api/users/password/verify-code', createDirectProxy('users', '/api/users/password/verify-code'));
app.put('/api/users/password/reset', createDirectProxy('users', '/api/users/password/reset'));

// NOTIFICATIONS
app.post('/api/notifications', createDirectProxy('notifications', '/api/notifications'));
app.get('/api/notifications/:userId', createDirectProxy('notifications', '/api/notifications/:userId'));
app.put('/api/notifications/:id/read', createDirectProxy('notifications', '/api/notifications/:id/read'));

// USER INFO
app.get('/api/user-info/:token', createDirectProxy('auth', '/api/user-info/:token'));

// ==================== HEALTH ====================

app.get('/health', (req, res) => {
    res.json({
        status: 'READY',
        gateway: 'Direct Azure Proxy',
        timestamp: new Date().toISOString(),
        services: SERVICES,
        note: 'Azure Functions se activan automáticamente al primer llamado'
    });
});

app.get('/api/test/urls', (req, res) => {
    res.json({
        message: 'URLs configuradas en el gateway',
        urls: SERVICES,
        testLogin: `https://${SERVICES.auth}/api/auth/login`,
        testUsers: `https://${SERVICES.users}/api/users/credentials/test@example.com`
    });
});

app.get('/', (req, res) => {
    res.json({
        message: '🚀 API Gateway - Conexión DIRECTA a Azure',
        description: 'Conecta directamente a Azure Functions. Se activan solos.',
        urls: SERVICES,
        example: 'POST /api/auth/login se convierte en POST https://' + SERVICES.auth + '/api/auth/login',
        note: 'La primera llamada activa Azure Functions automáticamente (2-10s cold start)'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🎯 API GATEWAY - URLs CORRECTAS
===============================
✅ Conectando DIRECTAMENTE a:

🔐 AUTH: ${SERVICES.auth}
👥 USERS: ${SERVICES.users}
🔔 NOTIFICATIONS: ${SERVICES.notifications}

⚡ Modo: Activación automática Azure Functions
⏱️  Cold start estimado: 2-10 segundos (primera vez)
🚀 Puerto: ${PORT}

🧪 PARA PROBAR (PowerShell):
1. Verificar URLs:
   Invoke-RestMethod "https://api-gateway-despliegue.onrender.com/api/test/urls"

2. Probar login (se activará solo):
   $body = '{"email":"manuelalejandro.guarnizo@gmail.com","password":"Tolima1234"}'
   Invoke-RestMethod -Uri "https://api-gateway-despliegue.onrender.com/api/auth/login" -Method Post -Body $body -ContentType "application/json"

⚠️  NOTA: Si ves error 502/504, es NORMAL la primera vez.
    Azure Functions tarda 2-10s en activarse.
    Intenta nuevamente después de 10 segundos.
    `);
});