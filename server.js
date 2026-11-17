#!/usr/bin/env node
// Servidor local do laboratório interativo. Sem dependências.
// Uso: node server.js   →   http://localhost:3000
// As chaves de API ficam em variáveis de ambiente do servidor, nunca no navegador.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chat } from './providers.js';
import { PAYLOADS, DOC } from './payloads.js';
import { DEFENSES, prepare, guardOutput, inputBlocked, parseToolCall } from './defenses.js';
import { CHECKS, breachScore } from './judge.js';

const PORT = Number(process.env.PORT) || 3000;
const dir = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS = new Set(['ollama', 'anthropic', 'openai', 'mock']);

const send = (res, code, type, body) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) { reject(new Error('Corpo da requisição grande demais')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}

const verdictOf = (o) => ({ leak: CHECKS.leak(o), tool: CHECKS.tool(o), hijack: CHECKS.hijack(o) });

async function handleChat(body) {
  const provider = PROVIDERS.has(body.provider) ? body.provider : 'ollama';
  const model = String(body.model || '');
  const f = body.flags || {};
  const flags = {
    delimit: !!f.delimit,
    sandwich: !!f.sandwich,
    inputFilter: !!f.inputFilter,
    outputGuard: !!f.outputGuard,
    backendEnforced: !!f.backendEnforced,
  };
  const userTask = String(body.userTask || '');
  const untrusted = body.untrusted ? String(body.untrusted) : null;
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-40);
  if (!userTask.trim()) throw new Error('Mensagem vazia');

  const { system, user } = prepare(flags, { userTask, untrusted });
  const base = { system, user, flags };

  if (flags.inputFilter && inputBlocked({ userTask, untrusted })) {
    const out = '[BLOQUEADO PELO FILTRO DE ENTRADA]';
    return { ...base, blocked: true, output: out, rawOutput: out, verdict: verdictOf(out), rawVerdict: verdictOf(out), tool: null, progress: 2 };
  }

  const temperature = body.temperature === '' || body.temperature == null ? undefined : Number(body.temperature);
  const rawOutput = await chat({
    provider, model, system, messages: [...history, { role: 'user', content: user }],
    temperature: Number.isNaN(temperature) ? undefined : temperature,
  });
  const guarded = (flags.outputGuard || flags.backendEnforced) ? guardOutput(rawOutput, { flags, userTask }) : rawOutput;
  const output = guarded;
  const rawCall = parseToolCall(rawOutput);
  const guardedCall = parseToolCall(output);
  const verdict = verdictOf(output), rawVerdict = verdictOf(rawOutput);
  const tool = rawCall ? { to: rawCall.to, executed: !!guardedCall && guardedCall.to === rawCall.to } : null;
  return {
    ...base, blocked: false, output, rawOutput, verdict, rawVerdict, tool,
    progress: breachScore({ rawOutput, blocked: false, verdict, rawVerdict, tool: rawCall }),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, 'text/html; charset=utf-8', readFileSync(path.join(dir, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { defenses: DEFENSES, payloads: PAYLOADS, docTemplate: DOC('{{INJECAO}}') });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      // Evita que outro site aberto no seu navegador use este servidor (e suas chaves) às escondidas.
           const origin = req.headers.origin;
      const okLocal = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
      const cs = process.env.CODESPACE_NAME;
      const okCodespace = cs && origin === `https://${cs}-${PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
      if (origin && !okLocal && !okCodespace) return json(res, 403, { error: 'Origem não permitida' });
      return json(res, 200, await handleChat(await readJson(req)));
    }
    send(res, 404, 'text/plain; charset=utf-8', 'Não encontrado');
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Prompt Injection Lab (interativo) em http://localhost:${PORT}`);
  console.log('Chaves de API lidas de: ANTHROPIC_API_KEY, OPENAI_API_KEY (opcional OPENAI_BASE_URL, OLLAMA_URL). Ctrl+C para sair.');
});
