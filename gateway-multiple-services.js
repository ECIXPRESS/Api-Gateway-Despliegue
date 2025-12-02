const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
    keepAliveMsecs: 1000
});

const SERVICES = {
    auth: 'tsukuyomi-authentication-dev-h9ajhmhre8gxhzcp.eastus2-01.azurewebsites.net',
    users: 'tsukuyomi-users-dev-f2dzeqangrebakdw.eastus2-01.azurewebsites.net',
    notifications: 'tsukuyomi-notifications-dev-gmctdechaqf5fqaj.eastus2-01.azurewebsites.net'
};

function createOptimizedEndpoint(basePath) {
    return (req, res) => {
        const startTime = Date.now();
        const method = req.method;

        let targetPath = basePath;

        if (req.params) {
            Object.keys(req.params).forEach(key => {
                const paramValue = req.params[key];
                const encodedValue = encodeURIComponent(paramValue);
                targetPath = targetPath.replace(`:${key}`, encodedValue);
            });
        }

        if (Object.keys(req.query).length > 0) {
            const queryParams = new URLSearchParams(req.query).toString();
            targetPath += `?${queryParams}`;
        }

        const serviceMatch = basePath.includes('/auth/') ? 'auth' :
            basePath.includes('/users/') ? 'users' :
                basePath.includes('/notifications/') ? 'notifications' : 'auth';

        const serviceHost = SERVICES[serviceMatch];

        const options = {
            hostname: serviceHost,
            path: targetPath,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Connection': 'keep-alive',
                'User-Agent': 'Render-API-Gateway/1.0'
            },
            agent: keepAliveAgent,
            timeout: 30000
        };

        let responseSent = false;

        const sendResponse = (status, data) => {
            if (!responseSent) {
                responseSent = true;
                res.status(status).json(data);
            }
        };

        const request = https.request(options, (response) => {
            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                try {
                    if (response.statusCode === 204) {
                        return sendResponse(204);
                    }

                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        const jsonData = data ? JSON.parse(data) : {};
                        sendResponse(response.statusCode, jsonData);
                    } else {
                        sendResponse(response.statusCode, data ? JSON.parse(data) : { error: 'Unknown error' });
                    }
                } catch (e) {
                    sendResponse(502, {
                        error: 'Invalid JSON response',
                        details: e.message
                    });
                }
            });
        });

        request.on('timeout', () => {
            request.destroy();
            sendResponse(504, {
                error: 'Request timeout',
                message: `Servicio ${serviceMatch} está iniciándose`,
                suggestion: 'Intenta nuevamente en 5 segundos'
            });
        });

        request.on('error', (err) => {
            sendResponse(502, {
                error: 'Service starting',
                message: `Microservicio ${serviceMatch} se está activando`,
                details: err.message,
                retry: true
            });
        });

        if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
            request.write(JSON.stringify(req.body));
        }

        request.end();
    };
}

app.post('/api/auth/login', createOptimizedEndpoint('/auth/login'));

app.post('/api/users/admins', createOptimizedEndpoint('/users/admins'));
app.get('/api/users/admins/:id', createOptimizedEndpoint('/users/admins/:id'));
app.put('/api/users/admins/:id', createOptimizedEndpoint('/users/admins/:id'));
app.delete('/api/users/admins/:id', createOptimizedEndpoint('/users/admins/:id'));

app.post('/api/users/customers', createOptimizedEndpoint('/users/customers'));
app.get('/api/users/customers/:id', createOptimizedEndpoint('/users/customers/:id'));
app.put('/api/users/customers/:id', createOptimizedEndpoint('/users/customers/:id'));
app.put('/api/users/customers/:id/password', createOptimizedEndpoint('/users/customers/:id/password'));
app.delete('/api/users/customers/:id', createOptimizedEndpoint('/users/customers/:id'));

app.post('/api/users/sellers', createOptimizedEndpoint('/users/sellers'));
app.get('/api/users/sellers/:id', createOptimizedEndpoint('/users/sellers/:id'));
app.get('/api/users/sellers', createOptimizedEndpoint('/users/sellers'));
app.get('/api/users/sellers/pending', createOptimizedEndpoint('/users/sellers/pending'));
app.put('/api/users/sellers/:id', createOptimizedEndpoint('/users/sellers/:id'));
app.delete('/api/users/sellers/:id', createOptimizedEndpoint('/users/sellers/:id'));

app.post('/api/users/password/reset-request', createOptimizedEndpoint('/users/password/reset-request'));
app.post('/api/users/password/verify-code', createOptimizedEndpoint('/users/password/verify-code'));
app.put('/api/users/password/reset', createOptimizedEndpoint('/users/password/reset'));

app.get('/api/users/credentials/:email', createOptimizedEndpoint('/users/credentials/:email'));
app.get('/api/users/credentials/auth', createOptimizedEndpoint('/users/credentials/auth'));

app.post('/api/notifications', createOptimizedEndpoint('/notifications'));
app.get('/api/notifications/:userId', createOptimizedEndpoint('/notifications/:userId'));
app.put('/api/notifications/:id/read', createOptimizedEndpoint('/notifications/:id/read'));

app.get('/api/user-info/:token', createOptimizedEndpoint('/user-info/:token'));

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        gateway: 'ECI-EXPRESS API Gateway',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway - Microservices',
        status: 'running'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`API Gateway ejecutándose en puerto ${PORT}`);
});