const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// --- HTTP Server for Static Files ---
const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                fs.readFile('./404.html', (error, content) => { // Simple 404 page
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end(content, 'utf-8');
                });
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// --- WebSocket Server ---
const wss = new WebSocket.Server({ server });

let clients = new Set();
let waitingClient = null;
let pairs = new Map(); // Stores client -> partnerClient

function broadcastUserCount() {
    const userCount = clients.size;
    const message = JSON.stringify({ type: 'userCount', count: userCount });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function pairClients(client1, client2) {
    pairs.set(client1, client2);
    pairs.set(client2, client1);
    client1.send(JSON.stringify({ type: 'status', message: 'paired' }));
    client2.send(JSON.stringify({ type: 'status', message: 'paired' }));
    console.log("Clients paired");
}

function unpairClient(client) {
    const partner = pairs.get(client);
    if (partner) {
        pairs.delete(client);
        pairs.delete(partner);
        if (partner.readyState === WebSocket.OPEN) {
            partner.send(JSON.stringify({ type: 'status', message: 'partnerDisconnected' }));
        }
        console.log("Client unpaired");
        return partner; // Return the partner so they can be put back in waiting
    }
    return null;
}


wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('Client connected. Total clients:', clients.size);
    broadcastUserCount();

    ws.send(JSON.stringify({ type: 'status', message: 'connectedToServer' }));

    if (waitingClient && waitingClient.readyState === WebSocket.OPEN) {
        const partner = waitingClient;
        waitingClient = null;
        pairClients(ws, partner);
    } else {
        waitingClient = ws;
        ws.send(JSON.stringify({ type: 'status', message: 'waiting' }));
        console.log("Client is waiting for a partner");
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const partner = pairs.get(ws);

            if (partner && partner.readyState === WebSocket.OPEN) {
                if (data.type === 'chatMessage') {
                    partner.send(JSON.stringify({ type: 'chatMessage', content: data.content, sender: 'them' }));
                } else if (data.type === 'typing') {
                    partner.send(JSON.stringify({ type: 'typing', isTyping: data.isTyping }));
                }
            } else if (data.type === 'disconnectMe') { // Client initiated disconnect from partner
                 const previouslyPairedPartner = unpairClient(ws);
                 ws.send(JSON.stringify({ type: 'status', message: 'disconnectedFromPartner' }));
                 if (previouslyPairedPartner && previouslyPairedPartner.readyState === WebSocket.OPEN) {
                     waitingClient = previouslyPairedPartner; // Put the other client back in waiting
                     previouslyPairedPartner.send(JSON.stringify({ type: 'status', message: 'waiting' }));
                 } else if (!waitingClient) { // If there's no one waiting, this client becomes waiting
                     waitingClient = ws;
                     ws.send(JSON.stringify({ type: 'status', message: 'waiting' }));
                 }
            }

        } catch (error) {
            console.error('Failed to parse message or handle client message:', error);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('Client disconnected. Total clients:', clients.size);
        broadcastUserCount();

        const partner = unpairClient(ws);

        if (ws === waitingClient) {
            waitingClient = null;
            console.log("Waiting client disconnected");
        } else if (partner && partner.readyState === WebSocket.OPEN) {
            // If the disconnected client had a partner, make the partner wait for a new one
            waitingClient = partner;
            partner.send(JSON.stringify({ type: 'status', message: 'waiting' }));
            console.log("Partner is now waiting");
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        // Optional: Clean up client if it's in waitingClient or pairs
        if (ws === waitingClient) waitingClient = null;
        unpairClient(ws); // Attempt to unpair if it was paired
        clients.delete(ws);
        broadcastUserCount();
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});
