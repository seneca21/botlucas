// services/pushinApi.js

const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const ConfigService = require('./config.service'); // Verifique o caminho relativo

const botConfig = ConfigService.loadConfig().bots[0]; // Deve funcionar agora

const PUSHIN_API_URL = botConfig.pushin_config.api_url; // Deve ser 'https://api.pushinpay.com.br/api'
const YOUR_TOKEN = botConfig.pushin_config.token; // Certifique-se de que o token está correto

// Obtenha a URL do proxy do Fixie a partir das variáveis de ambiente
const FIXIE_PROXY_URL = process.env.FIXIE_PROXY_URL;

// Verifique se FIXIE_PROXY_URL está definida
if (!FIXIE_PROXY_URL) {
    console.error('❌ FIXIE_PROXY_URL não está definida. Proxy é obrigatório para PushinPay.');
    process.exit(1); // Encerra a aplicação
}

// Log opcional para depuração (remova em produção)
console.log('YOUR_TOKEN:', YOUR_TOKEN ? 'Definido' : 'Não definido');
console.log('FIXIE_PROXY_URL:', FIXIE_PROXY_URL ? 'Definido' : 'Não definido');

// Cria um agente de proxy HTTP usando a URL do proxy
let agent;
try {
    agent = new HttpsProxyAgent(FIXIE_PROXY_URL);
    console.log('🔗 Proxy configurado com sucesso.');
} catch (error) {
    console.error('❌ Erro ao configurar o proxy:', error);
    process.exit(1); // Encerra a aplicação
}

// Cria uma instância do Axios com a configuração base e o agente de proxy
const pushinApi = axios.create({
    baseURL: PUSHIN_API_URL,
    headers: {
        Authorization: `Bearer ${YOUR_TOKEN}`, // Inclui o prefixo 'Bearer' conforme a documentação
        'Content-Type': 'application/json',
    },
    httpsAgent: agent,
});

// Adicione um interceptor para logar as requisições
pushinApi.interceptors.request.use((config) => {
    console.log('🔄 Enviando requisição para PushinPay:', config.url);
    return config;
}, (error) => {
    return Promise.reject(error);
});

module.exports = pushinApi;
