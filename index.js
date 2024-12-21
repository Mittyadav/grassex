const WebSocket = require('ws');
const fs = require('fs');
const crypto = require('crypto');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { v4: uuidv4, v3: uuidv3 } = require('uuid');
const pino = require('pino');
const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });
const config = require('./configuration');

let CoderMarkPrinted = false;

const cl = {
    gr: '\x1b[32m',
    br: '\x1b[34m',
    red: '\x1b[31m',
    yl: '\x1b[33m',
    gb: '\x1b[4m',
    rt: '\x1b[0m'
};

function CoderMark() {
    if (!CoderMarkPrinted) {
        console.log(`
╭━━━╮╱╱╱╱╱╱╱╱╱╱╱╱╱╭━━━┳╮
┃╭━━╯╱╱╱╱╱╱╱╱╱╱╱╱╱┃╭━━┫┃${cl.gr}
┃╰━━┳╮╭┳━┳━━┳━━┳━╮┃╰━━┫┃╭╮╱╭┳━╮╭━╮
┃╭━━┫┃┃┃╭┫╭╮┃╭╮┃╭╮┫╭━━┫┃┃┃╱┃┃╭╮┫╭╮╮${cl.br}
┃┃╱╱┃╰╯┃┃┃╰╯┃╰╯┃┃┃┃┃╱╱┃╰┫╰━╯┃┃┃┃┃┃┃
╰╯╱╱╰━━┻╯╰━╮┣━━┻╯╰┻╯╱╱╰━┻━╮╭┻╯╰┻╯╰╯${cl.rt}
╱╱╱╱╱╱╱╱╱╱╱┃┃╱╱╱╱╱╱╱╱╱╱╱╭━╯┃
╱╱╱╱╱╱╱╱╱╱╱╰╯╱╱╱╱╱╱╱╱╱╱╱╰━━╯
\n${cl.gb}${cl.yl}getGrass Minner Bot ${cl.rt}${cl.gb}v0.2${cl.rt}
        `);
        CoderMarkPrinted = true;
    }
}

async function connectToWss(socks5Proxy, userId) {
    const deviceId = uuidv3(socks5Proxy, uuidv3.DNS);
    logger.info(deviceId);
    while (true) {
        try {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 900 + 100));
            const customHeaders = { "User-Agent": config.UserAgent };
            const uriList = ["wss://proxy2.wynd.network:4444/", "wss://proxy2.wynd.network:4650/"];
            const uri = uriList[Math.floor(Math.random() * uriList.length)];
            const agent = new SocksProxyAgent(socks5Proxy);
            const ws = new WebSocket(uri, {
                agent: agent,
                headers: {
                    "Origin": config["Origin"],
                    "User-Agent": customHeaders["User-Agent"]
                },
                rejectUnauthorized: false
            });
            ws.on('open', () => {
                const sendPing = () => {
                    const sendMessage = JSON.stringify({ id: uuidv4(), version: "1.0.0", action: "PING", data: {} });
                    logger.debug(sendMessage);
                    ws.send(sendMessage);
                    setTimeout(sendPing, 110000);
                };
                sendPing();
            });

            ws.on('message', (data) => {
                const message = JSON.parse(data);
                logger.info(message);
                if (message.action === "AUTH") {
                    const authResponse = {
                        id: message.id,
                        origin_action: "AUTH",
                        result: {
                            browser_id: deviceId,
                            user_id: userId,
                            user_agent: customHeaders['User-Agent'],
                            timestamp: Math.floor(Date.now() / 1000),
                            device_type: "extension",
                            version: "4.26.2",
                            extension_id: config.extension_id
                        }
                    };
                    logger.debug(authResponse);
                    ws.send(JSON.stringify(authResponse));
                } else if (message.action === "PONG") {
                    const pongResponse = { id: message.id, origin_action: "PONG" };
                    logger.debug(pongResponse);
                    ws.send(JSON.stringify(pongResponse));
                }
            });

            await new Promise((resolve, reject) => {
                ws.on('close', () => reject(new Error('WebSocket closed')));
                ws.on('error', (error) => reject(error));
            });
        } catch (e) {
            logger.error(`Error with proxy ${socks5Proxy}: ${e.message}`);
            if (["Host unreachable", "[SSL: WRONG_VERSION_NUMBER]", "invalid length of packed IP address string", "Empty connect reply", "Device creation limit exceeded", "sent 1011 (internal error) keepalive ping timeout; no close frame received"].some(msg => e.message.includes(msg))) {
                logger.info(`Removing error proxy from the list: ${socks5Proxy}`);
                removeProxyFromList(socks5Proxy);
                return null;
            }
        }
    }
}

async function main() {
    const proxyFile = config.proxyFile;
    const userId = config.userId;
    const allProxies = fs.readFileSync(proxyFile, 'utf-8').split('\n').filter(Boolean);
    let activeProxies = allProxies.sort(() => 0.5 - Math.random()).slice(0, 100);
    let tasks = new Map(activeProxies.map(proxy => [connectToWss(proxy, userId), proxy]));

    while (true) {
        const [done] = await Promise.race([...tasks.keys()].map(p => p.then(() => [p])));
        const failedProxy = tasks.get(done);
        tasks.delete(done);

        if (await done === null) {
            logger.info(`Removing and replacing failed proxy: ${failedProxy}`);
            activeProxies = activeProxies.filter(p => p !== failedProxy);
            const newProxy = allProxies[Math.floor(Math.random() * allProxies.length)];
            activeProxies.push(newProxy);
            tasks.set(connectToWss(newProxy, userId), newProxy);
        }

        for (const proxy of activeProxies) {
            if (![...tasks.values()].includes(proxy)) {
                tasks.set(connectToWss(proxy, userId), proxy);
            }
        }
    }
}

function removeProxyFromList(proxy) {
    const proxyFile = config.proxyFile;
    const proxyList = fs.readFileSync(proxyFile, "utf-8").split('\n');
    const updatedList = proxyList.filter(line => line.trim() !== proxy);
    fs.writeFileSync(proxyFile, updatedList.join('\n'));
}
CoderMark();
main().catch(console.error);
