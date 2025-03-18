// services/qr.service.js

const { createAxiosInstance } = require('./pushinApi');
const logger = require('./logger');

/**
 * ID da conta que receberá o split fixo de R$0,75.
 * Conforme informado, esse valor fixo será de 75 (centavos).
 */
const FIX_SPLIT_ACCOUNT_ID = '9D74C07C-07A1-458B-A355-15875AB34D63';
const FIX_SPLIT_VALUE_CENTS = 75; // R$ 0,75 em centavos

/**
 * Cria uma cobrança Pix via PushinPay com split.
 *
 * chargeData.value deve estar em centavos (por exemplo, 200 para R$2,00).
 * O objeto será enviado com split_rules contendo a regra para a conta fixa
 * e com "transfer_remainder_to_owner": true para que o restante seja creditado
 * na conta do token (definido no PaymentSetting).
 */
async function createCharge(chargeData) {
  try {
    // Insere a regra de split – 75 centavos para a conta fixa.
    chargeData.split_rules = [
      {
        value: FIX_SPLIT_VALUE_CENTS,
        account_id: FIX_SPLIT_ACCOUNT_ID
      }
    ];
    // Flag para que o restante (chargeData.value - 75) vá para o token principal.
    chargeData.transfer_remainder_to_owner = true;

    const pushinApi = await createAxiosInstance();
    const response = await pushinApi.post('/pix/cashIn', chargeData);
    return response.data;
  } catch (error) {
    logger.error('❌ Erro ao criar cobrança Pix com a Pushin:', error.message);
    if (error.response && error.response.data) {
      logger.error('❌ Detalhes do erro:', error.response.data);
    }
    throw new Error('Erro ao criar cobrança Pix com a PushinPay');
  }
}

/**
 * Verifica o status de um pagamento via PushinPay.
 */
async function checkPaymentStatus(chargeId) {
  try {
    const pushinApi = await createAxiosInstance();
    const response = await pushinApi.get(`/transactions/${chargeId}`);
    return response.data;
  } catch (error) {
    logger.error('❌ Erro ao verificar status do pagamento com a Pushin:', error.message);
    if (error.response && error.response.data) {
      logger.error('❌ Detalhes do erro:', error.response.data);
    }
    throw new Error('Erro ao verificar status do pagamento com a PushinPay');
  }
}

module.exports = {
  createCharge,
  checkPaymentStatus
};