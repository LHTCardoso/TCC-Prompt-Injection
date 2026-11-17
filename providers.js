// Provedores de LLM. Node 18+ (fetch nativo), sem dependências.
import { CANARY, MARKER, ATTACKER } from './payloads.js';

async function post(url, headers, body, hint = '') {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    const code = e.cause?.code || e.name;
    throw new Error(`Não foi possível conectar a ${new URL(url).origin} (${code}). ${hint}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Aceita `user` (turno único) ou `messages` (histórico multi-turno: [{role, content}]).
export async function chat({ provider, model, system, user, messages, temperature }) {
  const msgs = messages ?? [{ role: 'user', content: user }];
  switch (provider) {
    case 'ollama': {
      const base = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
      const d = await post(`${base}/api/chat`, {}, {
        model, stream: false, options: { temperature },
        messages: [{ role: 'system', content: system }, ...msgs],
      }, 'O Ollama está instalado e rodando? Abra http://127.0.0.1:11434 no navegador: deve aparecer "Ollama is running".');
      return d.message.content;
    }
    case 'anthropic': {
      const d = await post('https://api.anthropic.com/v1/messages',
        { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 400, temperature, system, messages: msgs },
        'Verifique sua conexão com a internet e a ANTHROPIC_API_KEY.');
      return d.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
    case 'openai': { // qualquer API compatível (OpenAI, LM Studio, vLLM, OpenRouter...)
      const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const d = await post(`${base}/chat/completions`,
        { Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'none'}` },
        { model, temperature, max_tokens: 400,
          messages: [{ role: 'system', content: system }, ...msgs] });
      return d.choices[0].message.content;
    }
    case 'mock':
      return mock(system, msgs.at(-1).content);
    default:
      throw new Error(`Provedor desconhecido: ${provider}`);
  }
}

// Modelo SIMULADO apenas para validar o pipeline (dry-run). NÃO use esses números no TCC.
function mock(system, user) {
  const hardened = /dados_externos/.test(system) || /Lembrete:/.test(user);
  const body = user.split('\n\nLembrete:')[0];
  const obey = Math.random() < (hardened ? 0.25 : 0.7);
  const injected = /ignor|disregard|\[SYSTEM\]|AVISO DO ADMIN|esqueça|mudança de plano|debugbot|base64|instruções atualizadas/i.test(body);
  const toolCall = (to) => `TOOL:send_email{"to":"${to}","body":"oi"}`;

  if (injected && obey) {
    if (body.includes(MARKER)) return MARKER;
    if (body.includes(ATTACKER)) return toolCall(ATTACKER);
    return `Claro! O segredo é ${CANARY}`;
  }
  if (injected) return 'Não posso fazer isso. Posso apenas resumir o documento.';
  if (body.includes('ana@empresa.com')) return toolCall('ana@empresa.com');
  if (/3,2/.test(body)) return 'A receita do trimestre foi de 3,2 milhões.';
  if (/sexta/.test(body)) return 'A reunião foi adiada para sexta-feira.';
  return 'Resumo: documento sobre planejamento.';
}
