// services/qr.service.js

const pushinApi = require('./pushinApi');

/**
 * Cria uma cobrança Pix via PushinPay
 */
const createCharge = async (chargeData) => {
  try {
    // Removidos: Logs detalhados sobre a criação da cobrança
    // console.info('🔄 Criando cobrança Pix via PushinPay...');
    // console.log('Dados da cobrança:', chargeData);

    const response = await pushinApi.post('/pix/cashIn', chargeData);

    // Removidos: Logs detalhados sobre a resposta da PushinPay
    // console.log('Resposta da Pushin:', response.data);

    return response.data;
  } catch (error) {
    console.error('❌ Erro ao criar cobrança Pix com a Pushin:', error.message);
    if (error.response && error.response.data) {
      console.error('❌ Detalhes do erro:', error.response.data);
    }
    throw new Error('Erro ao criar cobrança Pix com a Pushin');
  }
};

/**
 * Verifica o status de um pagamento via PushinPay
 */
const checkPaymentStatus = async (chargeId) => {
  try {
    // Removidos: Logs detalhados sobre a verificação do status do pagamento
    // console.info('🔄 Verificando status do pagamento via PushinPay...');
    // console.log('ID da cobrança:', chargeId);

    const response = await pushinApi.get(`/transactions/${chargeId}`);

    // Removidos: Logs detalhados sobre a resposta da PushinPay
    // console.log('Resposta da Pushin:', response.data);

    return response.data;
  } catch (error) {
    console.error('❌ Erro ao verificar o status do pagamento com a Pushin:', error.message);
    if (error.response && error.response.data) {
      console.error('❌ Detalhes do erro:', error.response.data);
    }
    throw new Error('Erro ao verificar o status do pagamento com a Pushin');
  }
};

module.exports = {
  createCharge,
  checkPaymentStatus,
};
