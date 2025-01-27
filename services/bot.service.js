// services/bot.service.js

const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const ConfigService = require('./config.service');
const db = require('./index'); // importa index do Sequelize
const User = db.User;
const Purchase = db.Purchase;

// IMPORTANTE: Pacote de rate-limit
const rateLimit = require('telegraf-ratelimit');

// Importa o logger
const logger = require('./logger');

const config = ConfigService.loadConfig();
const dbConfig = ConfigService.getDbConfig();

// Armazena as instâncias de bots e sessões em memória
const bots = [];
const userSessions = {};

// =====================================
// Rate Limiting para Verificações de Pagamento
// =====================================

// Mapa para rastrear as tentativas de verificação por usuário
const verificationLimits = new Map();

// Definições de rate limiting para verificações de pagamento
const MAX_VERIFICATION_ATTEMPTS = 2;
const VERIFICATION_WINDOW_MS = 60 * 1000; // 1 minuto
const VERIFICATION_BLOCK_TIME_FIRST = 120 * 1000; // 2 minutos
const VERIFICATION_BLOCK_TIME_SECOND = 10 * 60 * 1000; // 10 minutos
const VERIFICATION_BLOCK_TIME_THIRD = 24 * 60 * 60 * 1000; // 24 horas
const VERIFICATION_CYCLE_RESET_MS = 48 * 60 * 60 * 1000; // 48 horas

/**
 * Função para verificar se o usuário pode realizar uma nova tentativa de verificação
 * @param {string} telegramId - ID do Telegram do usuário
 * @returns {object} - { allowed: boolean, message: string (apenas para check_payment) }
 */
function canAttemptVerification(telegramId) {
  const now = Date.now();
  let userData = verificationLimits.get(telegramId);

  if (!userData) {
    // Primeira tentativa
    verificationLimits.set(telegramId, {
      attempts: 1,
      blockUntil: 0,
      violations: 0,
      lastAttempt: now
    });
    return { allowed: true };
  }

  if (now < userData.blockUntil) {
    // Usuário está bloqueado
    return { allowed: false, message: `⏰ Você excedeu o número de tentativas permitidas. Tente novamente em ${Math.ceil((userData.blockUntil - now) / 1000)} segundos.` };
  }

  // Reseta as tentativas se passou o ciclo de reset
  if (now - userData.lastAttempt > VERIFICATION_CYCLE_RESET_MS) {
    verificationLimits.set(telegramId, {
      attempts: 1,
      blockUntil: 0,
      violations: 0,
      lastAttempt: now
    });
    return { allowed: true };
  }

  if (userData.attempts < MAX_VERIFICATION_ATTEMPTS) {
    // Permite a tentativa
    userData.attempts += 1;
    userData.lastAttempt = now;
    verificationLimits.set(telegramId, userData);
    return { allowed: true };
  } else {
    // Excede as tentativas permitidas
    userData.violations += 1;
    userData.attempts = 0; // Reset das tentativas

    if (userData.violations === 1) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_FIRST;
      verificationLimits.set(telegramId, userData);
      return { allowed: false, message: `🚫 Bloqueado por 2 minutos devido a múltiplas tentativas.` };
    } else if (userData.violations === 2) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_SECOND;
      verificationLimits.set(telegramId, userData);
      return { allowed: false, message: `🚫 Bloqueado por 10 minutos devido a múltiplas tentativas.` };
    } else if (userData.violations >= 3) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_THIRD;
      verificationLimits.set(telegramId, userData);
      return { allowed: false, message: `🚫 Bloqueado por 24 horas devido a múltiplas tentativas.` };
    }

    verificationLimits.set(telegramId, userData);
    return { allowed: false, message: `🚫 Você excedeu o número de tentativas permitidas. Tente novamente mais tarde.` };
  }
}

// =====================================
// Rate Limiting para o Comando /start
// =====================================

// Mapa para rastrear as tentativas do comando /start por usuário
const startLimits = new Map();

// Definições de rate limiting para o comando /start
const MAX_STARTS = 3;
const START_WAIT_FIRST_MS = 5 * 60 * 1000; // 5 minutos
const START_WAIT_SECOND_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Função para verificar se o usuário pode realizar um novo /start
 * @param {string} telegramId - ID do Telegram do usuário
 * @returns {boolean} - true se permitido, false se bloqueado
 */
function canAttemptStart(telegramId) {
  const now = Date.now();
  let userData = startLimits.get(telegramId);

  if (!userData) {
    // Primeiro /start
    startLimits.set(telegramId, {
      startCount: 1,
      nextAllowedStartTime: now + START_WAIT_FIRST_MS
    });
    return true;
  }

  if (now < userData.nextAllowedStartTime) {
    // Ainda está no período de espera
    return false;
  }

  if (userData.startCount === 1) {
    // Segundo /start após 5 minutos
    userData.startCount = 2;
    userData.nextAllowedStartTime = now + START_WAIT_SECOND_MS;
    startLimits.set(telegramId, userData);
    return true;
  }

  if (userData.startCount === 2) {
    // Terceiro /start após 24 horas
    userData.startCount = 3;
    userData.nextAllowedStartTime = now + START_WAIT_SECOND_MS; // Mantém 24h para reiniciar
    startLimits.set(telegramId, userData);
    return true;
  }

  if (userData.startCount >= 3) {
    // Reinicia o ciclo após o terceiro /start
    userData.startCount = 1;
    userData.nextAllowedStartTime = now + START_WAIT_FIRST_MS;
    startLimits.set(telegramId, userData);
    return true;
  }

  return false;
}

// =====================================
// Rate Limiting para os Botões select_plan
// =====================================

// Mapa para rastrear as tentativas de seleção de plano por usuário
const selectPlanLimits = new Map();

// Definições de rate limiting para seleção de planos
const MAX_SELECT_PLAN_ATTEMPTS = 2;
const SELECT_PLAN_BLOCK_TIME_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Função para verificar se o usuário pode realizar uma nova seleção de plano
 * @param {string} telegramId - ID do Telegram do usuário
 * @param {string} planId - ID ou nome único do plano selecionado
 * @returns {boolean} - true se permitido, false se bloqueado
 */
function canAttemptSelectPlan(telegramId, planId) {
  const now = Date.now();
  let userData = selectPlanLimits.get(telegramId);

  if (!userData) {
    // Primeira seleção
    selectPlanLimits.set(telegramId, {
      selectedPlans: new Set([planId]),
      blockUntil: 0,
      lastAttempt: now
    });
    return true;
  }

  if (now < userData.blockUntil) {
    // Usuário está bloqueado
    return false;
  }

  if (userData.selectedPlans.has(planId)) {
    // Usuário está tentando selecionar o mesmo plano novamente
    // Bloqueia por 24 horas
    userData.blockUntil = now + SELECT_PLAN_BLOCK_TIME_MS;
    selectPlanLimits.set(telegramId, userData);
    return false;
  }

  if (userData.selectedPlans.size < MAX_SELECT_PLAN_ATTEMPTS) {
    // Permite seleção e adiciona ao conjunto
    userData.selectedPlans.add(planId);
    userData.lastAttempt = now;
    selectPlanLimits.set(telegramId, userData);
    return true;
  } else {
    // Usuário já selecionou 2 diferentes planos, bloqueia
    userData.blockUntil = now + SELECT_PLAN_BLOCK_TIME_MS;
    selectPlanLimits.set(telegramId, userData);
    return false;
  }
}

// =====================================
// Função auxiliar para converter boolean -> texto (logs)
// =====================================
function booleanParaTexto(value, verdadeiro, falso) {
  return value ? verdadeiro : falso;
}

/**
 * Inicializa cada bot configurado em config.json
 */
function initializeBot(botConfig) {
  const bot = new Telegraf(botConfig.token);
  logger.info(`🚀 Bot ${botConfig.name} em execução.`);

  // ===============[ RATE-LIMIT CONFIG ]================
  // Limite de 2 interações a cada 50seg. Se exceder, IGNORA.
  const limitConfig = {
    window: 50000, // 50 segundos
    limit: 2,      // max 2 msgs nesse intervalo
    onLimitExceeded: (ctx, next) => {
      // Aqui não respondemos nada, simplesmente ignoramos.
      logger.warn(`⚠️ [RateLimit] Ignorando mensagem do user ${ctx.from?.id} (excedeu limite)`);
      // Não chamamos next(), paramos a cadeia.
    }
  };
  bot.use(rateLimit(limitConfig));
  // ======================================================

  /**
   * Registra ou atualiza o usuário no banco
   */
  async function registerUser(ctx) {
    try {
      const telegramId = ctx.from.id.toString();

      // Tenta criar ou encontrar
      const [user, created] = await User.findOrCreate({
        where: { telegramId },
        defaults: {
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          languageCode: ctx.from.language_code,
          isBot: ctx.from.is_bot,
          lastInteraction: new Date(),
          remarketingSent: false,
          hasPurchased: false,
          botName: botConfig.name,
        },
      });

      if (!created) {
        user.lastInteraction = new Date();
        user.botName = botConfig.name;
        await user.save();
      }

      const statusRemarketing = booleanParaTexto(user.remarketingSent, 'Enviado', 'Não Enviado');
      const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');

      if (created) {
        logger.info(`✅ Novo usuário: ${telegramId}, Remarketing: ${statusRemarketing}, Compra: ${statusCompra}`);
      } else {
        logger.info(`🔄 Usuário atualizado: ${telegramId}, Remarketing: ${statusRemarketing}, Compra: ${statusCompra}`);
      }

      // Dispara remarketing para não-comprados após X minutos
      const notPurchasedInterval = botConfig.remarketing.intervals.not_purchased_minutes || 5;
      setTimeout(async () => {
        try {
          const currentUser = await User.findOne({ where: { telegramId } });
          if (currentUser && !currentUser.hasPurchased && !currentUser.remarketingSent) {
            await sendRemarketingMessage(currentUser, 'not_purchased');
            currentUser.remarketingSent = true;
            await currentUser.save();
            logger.info(`✅ Mensagem de remarketing enviada para ${telegramId}`);
          }
        } catch (err) {
          logger.error(`❌ Erro ao enviar remarketing para ${telegramId}:`, err);
        }
      }, notPurchasedInterval * 60 * 1000);
    } catch (error) {
      logger.error('❌ Erro ao registrar usuário:', error);
    }
  }

  /**
   * Envia mensagens de remarketing.
   * - condition pode ser "not_purchased" ou "purchased"
   */
  async function sendRemarketingMessage(user, condition) {
    try {
      if (!userSessions[user.telegramId]) {
        userSessions[user.telegramId] = {};
      }
      // Guardamos no session para saber qual condition
      userSessions[user.telegramId].remarketingCondition = condition;

      const messageConfig = botConfig.remarketing.messages.find(msg => msg.condition === condition);
      if (!messageConfig) {
        logger.error(`❌ Sem mensagem de remarketing para condição: ${condition}`);
        return;
      }

      const videoPath = path.resolve(__dirname, `../src/videos/${messageConfig.video}`);
      if (!fs.existsSync(videoPath)) {
        logger.error(`❌ Vídeo não encontrado: ${videoPath}`);
        return;
      }

      const remarketingButtons = messageConfig.buttons.map((btn) =>
        Markup.button.callback(btn.name, `remarketing_select_plan_${btn.value}`)
      );

      await bot.telegram.sendVideo(user.telegramId, { source: videoPath }, {
        caption: messageConfig.text,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(remarketingButtons, { columns: 1 }),
      });
    } catch (error) {
      logger.error(`❌ Erro remarketing:`, error);
    }
  }

  // Tratamento de erros geral
  bot.catch((err, ctx) => {
    logger.error(`❌ Erro no bot:`, err);
    if (err.response && err.response.error_code === 403) {
      logger.warn(`🚫 Bot bloqueado por ${ctx.chat.id}.`);
    } else {
      ctx.reply('⚠️ Erro inesperado. Tente mais tarde.');
    }
  });

  /**
   * Ação remarketing_select_plan_X
   */
  bot.action(/^remarketing_select_plan_(\d+(\.\d+)?)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const planValue = parseFloat(ctx.match[1]);

    // Descobre o plano clicado
    const mainPlan = botConfig.buttons.find(btn => btn.value === planValue);
    const remarketingPlan = botConfig.remarketing.messages
      .flatMap(msg => msg.buttons)
      .find(btn => btn.value === planValue);

    const plan = mainPlan || remarketingPlan;
    if (!plan) {
      logger.error(`❌ Plano valor ${planValue} não encontrado.`);
      await ctx.answerCbQuery(); // Apenas responde para evitar que o botão fique carregando
      return;
    }

    // Se o user existe, atualiza lastInteraction
    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    // Implementação do Rate Limiting para Verificações
    const telegramId = chatId.toString();
    const rateLimitResult = canAttemptVerification(telegramId);

    if (!rateLimitResult.allowed) {
      // Ignora silenciosamente
      await ctx.answerCbQuery();
      return;
    }

    // Descobre se este remarketing era "not_purchased" ou "purchased"
    const session = userSessions[chatId] || {};
    const remarketingCond = session.remarketingCondition || 'not_purchased';

    logger.info(`✅ Plano remarketing ${plan.name} R$${plan.value} selecionado. Condition = ${remarketingCond}`);

    try {
      const chargeData = {
        value: plan.value * 100,
        webhook_url: null,
      };
      const chargeResult = await createCharge(chargeData);
      const chargeId = chargeResult.id;
      const emv = chargeResult.qr_code;

      session.chargeId = chargeId;
      session.selectedPlan = plan;
      session.originCondition = remarketingCond;

      await ctx.reply(
        `📄 Código PIX gerado!\n\`\`\`\n${emv}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply(
        '⚠️ Após pagamento, clique em "Verificar Pagamento".',
        Markup.inlineKeyboard([
          Markup.button.callback('🔍 Verificar Pagamento', `check_payment_${chargeId}`),
        ])
      );
    } catch (error) {
      logger.error('❌ Erro cobrança (remarketing):', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bot bloqueado por ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao criar cobrança. Tente mais tarde.');
      }
    }

    await ctx.answerCbQuery();
  });

  /**
   * /start (plano principal) => originCondition = 'main'
   */
  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from.id.toString();
      const canStart = canAttemptStart(telegramId);

      if (!canStart) {
        // Ignora silenciosamente
        return;
      }

      logger.info('📩 /start recebido');
      await registerUser(ctx);

      const videoPath = path.resolve(__dirname, `../src/videos/${botConfig.video}`);
      if (!fs.existsSync(videoPath)) {
        logger.error(`❌ Vídeo não achado: ${videoPath}`);
        await ctx.reply('⚠️ Erro ao carregar vídeo.');
        return;
      }

      // Botões da config principal
      const buttonMarkup = botConfig.buttons.map((btn, idx) =>
        Markup.button.callback(btn.name, `select_plan_${idx}`)
      );

      await ctx.replyWithVideo(
        { source: videoPath },
        {
          caption: botConfig.description,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttonMarkup, { columns: 1 }),
        }
      );

      logger.info(`🎥 Vídeo & botões enviados para ${ctx.chat.id}`);
    } catch (error) {
      logger.error('❌ Erro /start:', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bot bloqueado: ${ctx.chat.id}.`);
      } else {
        await ctx.reply('⚠️ Erro ao processar /start.');
      }
    }
  });

  /**
   * Ação "select_plan_X" => plano principal -> originCondition = 'main'
   */
  bot.action(/^select_plan_(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const buttonIndex = parseInt(ctx.match[1], 10);
    const buttonConfig = botConfig.buttons[buttonIndex];

    if (!buttonConfig) {
      logger.error(`❌ Plano index ${buttonIndex} não achado.`);
      await ctx.answerCbQuery(); // Apenas responde para evitar que o botão fique carregando
      return;
    }

    // user
    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    // Implementação do Rate Limiting para Seleção de Plano
    const telegramId = chatId.toString();
    const planId = buttonConfig.name; // Utilize um identificador único para o plano
    const canSelectPlan = canAttemptSelectPlan(telegramId, planId);

    if (!canSelectPlan) {
      // Ignora silenciosamente
      await ctx.answerCbQuery();
      return;
    }

    // Sessão do user
    if (!userSessions[chatId]) userSessions[chatId] = {};
    userSessions[chatId].originCondition = 'main';
    userSessions[chatId].selectedPlan = buttonConfig;

    logger.info(`✅ Plano ${buttonConfig.name} (R$${buttonConfig.value}) (main) enviado.`);

    try {
      const chargeData = {
        value: buttonConfig.value * 100,
        webhook_url: null,
      };
      const chargeResult = await createCharge(chargeData);
      const chargeId = chargeResult.id;
      const emv = chargeResult.qr_code;

      userSessions[chatId].chargeId = chargeId;

      await ctx.reply(
        `📄 Código PIX gerado!\n\`\`\`\n${emv}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply(
        '⚠️ Depois de pagar, clique em "Verificar Pagamento".',
        Markup.inlineKeyboard([
          Markup.button.callback('🔍 Verificar Pagamento', `check_payment_${chargeId}`),
        ])
      );
    } catch (error) {
      logger.error('❌ Erro ao criar cobrança:', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bloqueado por ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao criar cobrança.');
      }
    }

    await ctx.answerCbQuery();
  });

  /**
   * /status_pagamento
   */
  bot.command('status_pagamento', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];

    if (!session || !session.chargeId) {
      await ctx.reply('⚠️ Não há cobrança em andamento.');
      return;
    }

    try {
      logger.info('🔍 Verificando pagamento...');
      const paymentStatus = await checkPaymentStatus(session.chargeId);

      if (paymentStatus.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado!');
        const user = await User.findOne({ where: { telegramId: chatId.toString() } });
        if (user) {
          user.hasPurchased = true;
          await user.save();

          // Cria Purchase
          await Purchase.create({
            userId: user.id,
            planName: session.selectedPlan.name,
            planValue: session.selectedPlan.value,
            botName: botConfig.name,
            purchasedAt: new Date(),
            originCondition: session.originCondition || 'main',
          });

          logger.info(`✅ ${chatId} -> comprou plano: ${session.selectedPlan.name} R$${session.selectedPlan.value} [${session.originCondition}]`);

          // Envia upsell
          const purchasedInterval = botConfig.remarketing.intervals.purchased_seconds || 30;
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: chatId.toString() } });
              if (currentUser && currentUser.hasPurchased) {
                await sendRemarketingMessage(currentUser, 'purchased');
                logger.info(`✅ Upsell enviado -> ${chatId}`);
              }
            } catch (err) {
              logger.error(`❌ Erro upsell -> ${chatId}:`, err);
            }
          }, purchasedInterval * 1000);

          // Link do produto
          if (session.selectedPlan.link) {
            await ctx.reply(`🎉 Produto: [Acessar](${session.selectedPlan.link})`, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply('⚠️ Link do produto não encontrado.');
          }
        }

        delete userSessions[chatId];
      } else if (paymentStatus.status === 'expired') {
        await ctx.reply('❌ Cobrança expirou.');
        delete userSessions[chatId];
      } else {
        await ctx.reply('⏳ Pagamento pendente.');
      }
    } catch (error) {
      logger.error('❌ Erro ao verificar pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bot bloqueado por ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao verificar pagamento.');
      }
    }
  });

  /**
   * Ação "check_payment_X"
   */
  bot.action(/check_payment_(.+)/, async (ctx) => {
    const chatId = ctx.chat.id;
    const chargeId = ctx.match[1];
    const session = userSessions[chatId];

    if (!session || session.chargeId !== chargeId) {
      await ctx.reply('⚠️ Cobrança não corresponde.');
      await ctx.answerCbQuery();
      return;
    }

    try {
      logger.info('🔍 Verificando pagamento...');
      const paymentStatus = await checkPaymentStatus(chargeId);

      if (paymentStatus.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado!');
        const user = await User.findOne({ where: { telegramId: chatId.toString() } });
        if (user) {
          user.hasPurchased = true;
          await user.save();

          // Cria Purchase
          await Purchase.create({
            userId: user.id,
            planName: session.selectedPlan.name,
            planValue: session.selectedPlan.value,
            botName: botConfig.name,
            purchasedAt: new Date(),
            originCondition: session.originCondition || 'main',
          });

          logger.info(`✅ ${chatId} -> comprou plano: ${session.selectedPlan.name} R$${session.selectedPlan.value} [${session.originCondition}]`);

          // Envia upsell
          const purchasedInterval = botConfig.remarketing.intervals.purchased_seconds || 30;
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: chatId.toString() } });
              if (currentUser && currentUser.hasPurchased) {
                await sendRemarketingMessage(currentUser, 'purchased');
                logger.info(`✅ Upsell enviado -> ${chatId}`);
              }
            } catch (err) {
              logger.error(`❌ Erro upsell -> ${chatId}:`, err);
            }
          }, purchasedInterval * 1000);

          // Link do produto
          if (session.selectedPlan.link) {
            await ctx.reply(`🎉 Produto: [Acessar](${session.selectedPlan.link})`, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply('⚠️ Link do produto não encontrado.');
          }
        }
        delete userSessions[chatId];
      } else if (paymentStatus.status === 'expired') {
        await ctx.reply('❌ Cobrança expirou.');
        delete userSessions[chatId];
      } else {
        await ctx.reply('⏳ Pagamento pendente.');
      }
    } catch (error) {
      logger.error('❌ Erro ao verificar pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bot bloqueado: ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao verificar pagamento.');
      }
    }

    await ctx.answerCbQuery();
  });

  // Lança o bot
  bot.launch()
    .then(() => {
      logger.info(`🚀 Bot ${botConfig.name} iniciado com sucesso.`);
    })
    .catch((error) => {
      logger.error(`🔥 Erro ao iniciar bot ${botConfig.name}:`, error);
    });

  // Encerramento gracioso
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  // Salva no array
  bots.push(bot);
}

// Inicia cada bot
for (const botConf of config.bots) {
  initializeBot(botConf);
}

module.exports = bots;
