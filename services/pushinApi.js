// services/pushinApi.js

const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const db = require('./index'); // Importa o index do Sequelize
const PaymentSetting = db.PaymentSetting; // Modelo que guarda o token da PushinPay
const logger = require('./logger');

/**
 * Cria dinamicamente uma instância do Axios,
 * injetando o token salvo no DB (PaymentSetting).
 */
async function createAxiosInstance() {
    // Busca o token no banco
    const setting = await PaymentSetting.findOne();
    if (!setting || !setting.pushinToken) {
        throw new Error('Nenhum token da PushinPay definido. Configure em /admin/payment-setting');
    }
    const pushinToken = setting.pushinToken;

    // Define a URL da API da PushinPay
    const PUSHIN_API_URL = 'https://api.pushinpay.com.br/api';

    // Se você utiliza o proxy Fixie, pegue a URL do ambiente
    const FIXIE_PROXY_URL = process.env.FIXIE_PROXY_URL;
    if (!FIXIE_PROXY_URL) {
        logger.error('❌ FIXIE_PROXY_URL não está definida. Proxy é obrigatório para PushinPay.');
        throw new Error('FIXIE_PROXY_URL não está definida nas variáveis de ambiente.');
    }

    let agent;
    try {
        agent = new HttpsProxyAgent(FIXIE_PROXY_URL);
    } catch (err) {
        logger.error('❌ Erro ao configurar proxy Fixie:', err);
        throw err;
    }

    // Cria a instância do Axios, utilizando o token lido do DB
    const instance = axios.create({
        baseURL: PUSHIN_API_URL,
        headers: {
            Authorization: `Bearer ${pushinToken}`,
            'Content-Type': 'application/json'
        },
        httpsAgent: agent
    });

    // Interceptor para log (opcional)
    instance.interceptors.request.use(
        (config) => {
            logger.info(`🔄 Enviando requisição para PushinPay: ${config.url}`);
            return config;
        },
        (error) => Promise.reject(error)
    );

    return instance;
}

module.exports = {
    createAxiosInstance
};