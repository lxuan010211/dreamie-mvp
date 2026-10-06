import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { basename, resolve } from 'node:path';
import dotenv from 'dotenv';
import { OpenAIProvider, Runner, setTracingDisabled } from '@openai/agents';

import { findSleepAudioById } from './audio-catalog.js';
import { loadConfig, loadDashScopeAsrConfig } from './config.js';
import { createDashScopeAsr } from './dashscope-asr.js';
import { createDreamieAgent, parseSleepPlan } from './dreamie.js';
import { openMemoryStoreOrNull } from './memory-store.js';
import { createWebSessionService } from './web-session.js';

dotenv.config({ path: '.env.local', quiet: true });

const root = resolve(process.cwd(), '..');
const localHttpsDirectory = resolve(process.cwd(), '.local-https');
const staticFiles = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css']]);

export function createDreamieWebServer() {
  const config = loadConfig(process.env);
  const asrConfig = loadDashScopeAsrConfig(process.env);
  const asr = createDashScopeAsr(asrConfig);
  setTracingDisabled(true);
  const provider = new OpenAIProvider({ apiKey: config.apiKey, baseURL: config.baseURL, useResponses: false, strictFeatureValidation: true });
  const runner = new Runner({ modelProvider: provider });
  const memoryStore = openMemoryStoreOrNull(`${process.cwd()}/data/dreamie.db`, () => console.warn('提示：本次偏好未保存。'));
  const sessions = createWebSessionService({ memoryStore, getSleepPlan: async (prompt) => {
    const result = await runner.run(createDreamieAgent(config.model), prompt, { maxTurns: 1 });
    if (!result.finalOutput) throw new Error('Dreamie 暂时没有回应。');
    return parseSleepPlan(result.finalOutput);
  } });
  const handler = async (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readJsonBody(request, 20_000, '消息太长。');
        const input = JSON.parse(body) as { userId?: string; sessionId?: string; message?: string };
        if (typeof input.message !== 'string') return json(response, 400, { error: '请输入文字消息。' });
        if (!isUuid(input.userId)) return json(response, 400, { error: '浏览器身份无效，请刷新页面后重试。' });
        return json(response, 200, await sessions.handleMessage({ userId: input.userId, sessionId: input.sessionId, message: input.message }));
      }
      if (request.method === 'POST' && url.pathname === '/api/transcribe') {
        const body = await readJsonBody(request, 8_000_000, '录音太长，请控制在 5 分钟内。');
        const input = JSON.parse(body) as { dataUrl?: string; format?: string };
        if (typeof input.dataUrl !== 'string' || typeof input.format !== 'string') return json(response, 400, { error: '请上传有效的录音。' });
        return json(response, 200, { text: await asr.transcribe({ dataUrl: input.dataUrl, format: input.format }) });
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
        const track = findSleepAudioById(decodeURIComponent(url.pathname.slice('/api/audio/'.length)));
        if (!track || !existsSync(track.filePath)) return json(response, 404, { error: '未找到这段背景音。' });
        response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }); createReadStream(track.filePath).pipe(response); return;
      }
      if (request.method === 'GET' && url.pathname === '/dreamie-local-ca.crt') {
        const caPath = resolve(localHttpsDirectory, 'dreamie-local-ca.crt');
        if (!existsSync(caPath)) return json(response, 404, { error: '未找到本地 HTTPS 证书。' });
        response.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="dreamie-local-ca.crt"', 'Cache-Control': 'no-store' });
        response.end(readFileSync(caPath));
        return;
      }
      const file = staticFiles.get(url.pathname) ?? (url.pathname.startsWith('/assets/mascots/') ? url.pathname.slice(1) : undefined);
      if (!file || file.includes('..')) return json(response, 404, { error: '未找到页面资源。' });
      const path = resolve(root, file); if (!path.startsWith(root) || !existsSync(path)) return json(response, 404, { error: '未找到页面资源。' });
      const type = basename(path).endsWith('.js') ? 'text/javascript; charset=utf-8' : basename(path).endsWith('.css') ? 'text/css; charset=utf-8' : path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
      response.writeHead(200, { 'Content-Type': type }); response.end(readFileSync(path));
    } catch (error) { json(response, 500, { error: error instanceof Error ? error.message : '服务暂时不可用。' }); }
  };
  const server = createServer(handler);
  const keyPath = resolve(localHttpsDirectory, 'dreamie-local.key');
  const certificatePath = resolve(localHttpsDirectory, 'dreamie-local.crt');
  const httpsServer = existsSync(keyPath) && existsSync(certificatePath)
    ? createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, handler)
    : undefined;
  return { server, httpsServer, close: async () => { await provider.close(); } };
}

function json(response: import('node:http').ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function readJsonBody(request: import('node:http').IncomingMessage, limit: number, message: string) { let body = ''; for await (const chunk of request) { body += chunk; if (body.length > limit) throw new Error(message); } return body; }
function lanIp() { for (const values of Object.values(networkInterfaces())) for (const value of values ?? []) if (value.family === 'IPv4' && !value.internal) return value.address; return '127.0.0.1'; }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
export function getLocalPreviewUrls(address: string) { return { http: `http://${address}:3000`, https: `https://${address}:3443` }; }
export function getLocalCertificateUrl(address: string) { return `http://${address}:3000/dreamie-local-ca.crt`; }
if (process.argv[1]?.endsWith('web-server.ts')) {
  const { server, httpsServer } = createDreamieWebServer();
  const urls = getLocalPreviewUrls(lanIp());
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0');
  if (!process.env.PORT) httpsServer?.listen(3443, '0.0.0.0');
  console.log(`Dreamie 已启动：\nhttp://127.0.0.1:3000\n${urls.http}${httpsServer ? `\n${urls.https}` : '\n提示：尚未找到本地 HTTPS 证书。'}`);
}
