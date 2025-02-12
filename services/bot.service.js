// services/bot.service.js

const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const ConfigService = require('./config.service');
const db = require('./index'); // importa index do Sequelize
const User = db.User;
const Purchase = db.Purchase;

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
const MAX_VERIFICATION_ATTEMPTS = 4;  // Aumentado de 2 para 4
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
    logger.info(`Verificação: ${telegramId} - Primeira tentativa permitida.`);
    return { allowed: true };
  }

  if (now < userData.blockUntil) {
    // Usuário está bloqueado
    logger.info(`Verificação: ${telegramId} - Bloqueado até ${new Date(userData.blockUntil).toISOString()}.`);
    return { allowed: false, message: `⏰ Você excedeu o número de tentativas permitidas. Tente novamente mais tarde.` };
  }

  // Reseta as tentativas se passou o ciclo de reset
  if (now - userData.lastAttempt > VERIFICATION_CYCLE_RESET_MS) {
    verificationLimits.set(telegramId, {
      attempts: 1,
      blockUntil: 0,
      violations: 0,
      lastAttempt: now
    });
    logger.info(`Verificação: ${telegramId} - Ciclo resetado. Primeira tentativa permitida.`);
    return { allowed: true };
  }

  if (userData.attempts < MAX_VERIFICATION_ATTEMPTS) {
    // Permite a tentativa
    userData.attempts += 1;
    userData.lastAttempt = now;
    verificationLimits.set(telegramId, userData);
    logger.info(`Verificação: ${telegramId} - Tentativa ${userData.attempts} permitida.`);
    return { allowed: true };
  } else {
    // Excede as tentativas permitidas
    userData.violations += 1;
    userData.attempts = 0; // Reset das tentativas

    if (userData.violations === 1) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_FIRST;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado por 2 minutos devido a múltiplas tentativas.`);
      return { allowed: false, message: `🚫 Bloqueado por 2 minutos devido a múltiplas tentativas.` };
    } else if (userData.violations === 2) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_SECOND;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado por 10 minutos devido a múltiplas tentativas.`);
      return { allowed: false, message: `🚫 Bloqueado por 10 minutos devido a múltiplas tentativas.` };
    } else if (userData.violations >= 3) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_THIRD;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado por 24 horas devido a múltiplas tentativas.`);
      return { allowed: false, message: `🚫 Bloqueado por 24 horas devido a múltiplas tentativas.` };
    }

    verificationLimits.set(telegramId, userData);
    logger.info(`Verificação: ${telegramId} - Tentativa não permitida.`);
    return { allowed: false, message: `🚫 Você excedeu o número de tentativas permitidas. Tente novamente mais tarde.` };
  }
}

// =====================================
// Rate Limiting para o Comando /start
// =====================================

// Mapa para rastrear as tentativas do comando /start por usuário
const startLimits = new Map();

// Definições de rate limiting para o comando /start
const MAX_STARTS = 5;  // Aumentado de 3 para 5
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
    logger.info(`/start: ${telegramId} - Primeiro start permitido.`);
    return true;
  }

  if (now < userData.nextAllowedStartTime) {
    // Ainda está no período de espera
    logger.info(`/start: ${telegramId} - Bloqueado até ${new Date(userData.nextAllowedStartTime).toISOString()}.`);
    return false;
  }

  if (userData.startCount < MAX_STARTS) {
    userData.startCount++;
    userData.nextAllowedStartTime = now + START_WAIT_SECOND_MS;
    startLimits.set(telegramId, userData);
    logger.info(`/start: ${telegramId} - Start número ${userData.startCount} permitido.`);
    return true;
  } else {
    // Reinicia o ciclo após atingir o limite
    userData.startCount = 1;
    userData.nextAllowedStartTime = now + START_WAIT_FIRST_MS;
    startLimits.set(telegramId, userData);
    logger.info(`/start: ${telegramId} - Ciclo reiniciado. Primeiro start permitido novamente.`);
    return true;
  }
}

// =====================================
// Rate Limiting para os Botões select_plan
// =====================================

// Mapa para rastrear as tentativas de seleção de plano por usuário
const selectPlanLimits = new Map();

// Definições de rate limiting para seleção de planos (mantidos inalterados)
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
    logger.info(`Seleção de Plano: ${telegramId} - Primeiro plano (${planId}) selecionado.`);
    return true;
  }

  if (now < userData.blockUntil) {
    // Usuário está bloqueado
    logger.info(`Seleção de Plano: ${telegramId} - Bloqueado até ${new Date(userData.blockUntil).toISOString()}.`);
    return false;
  }

  if (userData.selectedPlans.has(planId)) {
    // Seleção repetida – bloqueia por 24 horas
    userData.blockUntil = now + SELECT_PLAN_BLOCK_TIME_MS;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Seleção repetida do plano (${planId}). Bloqueado por 24 horas.`);
    return false;
  }

  if (userData.selectedPlans.size < MAX_SELECT_PLAN_ATTEMPTS) {
    // Permite seleção e adiciona ao conjunto
    userData.selectedPlans.add(planId);
    userData.lastAttempt = now;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Plano (${planId}) selecionado. Total de seleções: ${userData.selectedPlans.size}.`);
    return true;
  } else {
    // Excedeu o número permitido – bloqueia
    userData.blockUntil = now + SELECT_PLAN_BLOCK_TIME_MS;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Excedeu o número de seleções permitidas. Bloqueado por 24 horas.`);
    return false;
  }
}

// =====================================
// Proteção contra Ataques em Massa no Comando /start
// =====================================

// Mapa para rastrear as tentativas globais de /start por bot
const startFloodProtection = new Map();

// Definições de proteção contra ataques em massa
const START_FLOOD_LIMIT = 20;
const START_FLOOD_WINDOW_MS = 3 * 60 * 1000; // 3 minutos
const START_FLOOD_PAUSE_MS = 8 * 60 * 1000; // 8 minutos

/**
 * Função para verificar e atualizar a proteção contra ataques em massa
 * @param {string} botName - Nome do bot
 * @returns {boolean} - true se o bot está pausado, false caso contrário
 */
function checkStartFlood(botName) {
  const now = Date.now();
  let floodData = startFloodProtection.get(botName);

  if (!floodData) {
    startFloodProtection.set(botName, {
      startTimestamps: [now],
      isPaused: false,
      pauseUntil: 0
    });
    return false;
  }

  if (floodData.isPaused) {
    if (now >= floodData.pauseUntil) {
      floodData.isPaused = false;
      floodData.startTimestamps = [];
      startFloodProtection.set(botName, floodData);
      logger.info(`Proteção Flood: ${botName} - Pausa de 8 minutos encerrada.`);
    } else {
      return true;
    }
  }

  floodData.startTimestamps = floodData.startTimestamps.filter(timestamp => now - timestamp <= START_FLOOD_WINDOW_MS);
  floodData.startTimestamps.push(now);

  if (floodData.startTimestamps.length >= START_FLOOD_LIMIT) {
    floodData.isPaused = true;
    floodData.pauseUntil = now + START_FLOOD_PAUSE_MS;
    startFloodProtection.set(botName, floodData);
    logger.warn(`Proteção Flood: ${botName} - Pausando respostas ao comando /start por 8 minutos devido a ${floodData.startTimestamps.length} starts em 3 minutos.`);
    return true;
  }

  startFloodProtection.set(botName, floodData);
  return false;
}

// =====================================
// Proteção contra Bloqueios Múltiplos
// =====================================

const userBlockStatus = new Map();

const BLOCK_COUNT_THRESHOLD = 2;
const BAN_COUNT_THRESHOLD = 3;
const IGNORE_DURATION_MS = 72 * 60 * 60 * 1000; // 72 horas
const BAN_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 1 semana
const PAUSE_BEFORE_IGNORE_MS = 6 * 60 * 1000; // 6 minutos

/**
 * Função para gerenciar bloqueios e banimentos de leads
 * @param {string} telegramId - ID do Telegram do usuário
 */
function handleUserBlock(telegramId) {
  const now = Date.now();
  let blockData = userBlockStatus.get(telegramId) || {
    blockCount: 0,
    isBlocked: false,
    blockExpiresAt: 0,
    isBanned: false,
    banExpiresAt: 0
  };

  if (blockData.isBanned) {
    return;
  }

  blockData.blockCount += 1;

  if (blockData.blockCount === BLOCK_COUNT_THRESHOLD) {
    setTimeout(() => {
      blockData.isBlocked = true;
      blockData.blockExpiresAt = now + IGNORE_DURATION_MS;
      userBlockStatus.set(telegramId, blockData);
      logger.warn(`Lead ${telegramId} bloqueado por 72 horas devido a múltiplos bloqueios.`);
      setTimeout(() => {
        blockData.isBlocked = false;
        blockData.blockExpiresAt = 0;
        blockData.blockCount = 0;
        userBlockStatus.set(telegramId, blockData);
        logger.info(`Lead ${telegramId} desbloqueado após 72 horas.`);
      }, IGNORE_DURATION_MS);
    }, PAUSE_BEFORE_IGNORE_MS);
  } else if (blockData.blockCount >= BAN_COUNT_THRESHOLD) {
    blockData.isBanned = true;
    blockData.banExpiresAt = now + BAN_DURATION_MS;
    userBlockStatus.set(telegramId, blockData);
    logger.error(`Lead ${telegramId} banido por 1 semana devido a múltiplos bloqueios.`);
    setTimeout(() => {
      blockData.isBanned = false;
      blockData.banExpiresAt = 0;
      blockData.blockCount = 0;
      userBlockStatus.set(telegramId, blockData);
      logger.info(`Lead ${telegramId} desbanido após 1 semana.`);
    }, BAN_DURATION_MS);
  } else {
    userBlockStatus.set(telegramId, blockData);
  }
}

function booleanParaTexto(value, verdadeiro, falso) {
  return value ? verdadeiro : falso;
}

/**
 * Inicializa cada bot configurado em config.json
 */
function initializeBot(botConfig) {
  const bot = new Telegraf(botConfig.token);
  logger.info(`🚀 Bot ${botConfig.name} em execução.`);

  async function registerUser(ctx) {
    try {
      const telegramId = ctx.from.id.toString();
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

  async function sendRemarketingMessage(user, condition) {
    try {
      if (!userSessions[user.telegramId]) {
        userSessions[user.telegramId] = {};
      }
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

  bot.catch((err, ctx) => {
    logger.error(`❌ Erro no bot:`, err);
    if (err.response && err.response.error_code === 403) {
      logger.warn(`🚫 Bot bloqueado por ${ctx.chat.id}.`);
    } else {
      ctx.reply('⚠️ Erro inesperado. Tente mais tarde.');
    }
  });

  bot.action(/^remarketing_select_plan_(\d+(\.\d+)?)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const planValue = parseFloat(ctx.match[1]);
    const mainPlan = botConfig.buttons.find(btn => btn.value === planValue);
    const remarketingPlan = botConfig.remarketing.messages
      .flatMap(msg => msg.buttons)
      .find(btn => btn.value === planValue);

    const plan = mainPlan || remarketingPlan;
    if (!plan) {
      logger.error(`❌ Plano valor ${planValue} não encontrado.`);
      await ctx.answerCbQuery();
      return;
    }

    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    const telegramId = chatId.toString();
    const rateLimitResult = canAttemptVerification(telegramId);

    if (!rateLimitResult.allowed) {
      await ctx.answerCbQuery();
      handleUserBlock(telegramId);
      return;
    }

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

      const newPurchase = await Purchase.create({
        userId: user ? user.id : null,
        planName: plan.name,
        planValue: plan.value,
        botName: botConfig.name,
        purchasedAt: null,
        status: 'pending',
        originCondition: remarketingCond,
        pixGeneratedAt: new Date()
      });

      session.chargeId = chargeId;
      session.selectedPlan = plan;
      session.originCondition = remarketingCond;
      session.paymentCheckCount = 0;
      session.purchaseId = newPurchase.id;

      userSessions[chatId] = session;

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

  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from.id.toString();
      const botName = botConfig.name;
      const isBotPaused = checkStartFlood(botName);
      if (isBotPaused) {
        return;
      }

      const blockData = userBlockStatus.get(telegramId);
      if (blockData && (blockData.isBlocked || blockData.isBanned)) {
        return;
      }

      const canStart = canAttemptStart(telegramId);
      if (!canStart) {
        handleUserBlock(telegramId);
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

  bot.action(/^select_plan_(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const buttonIndex = parseInt(ctx.match[1], 10);
    const buttonConfig = botConfig.buttons[buttonIndex];

    if (!buttonConfig) {
      logger.error(`❌ Plano index ${buttonIndex} não achado.`);
      await ctx.answerCbQuery();
      return;
    }

    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    const telegramId = chatId.toString();
    const planId = buttonConfig.name;
    const canSelectPlan = canAttemptSelectPlan(telegramId, planId);

    if (!canSelectPlan) {
      await ctx.answerCbQuery();
      handleUserBlock(telegramId);
      return;
    }

    if (!userSessions[chatId]) userSessions[chatId] = {};
    userSessions[chatId].originCondition = 'main';
    userSessions[chatId].selectedPlan = buttonConfig;
    userSessions[chatId].paymentCheckCount = 0;

    logger.info(`✅ Plano ${buttonConfig.name} (R$${buttonConfig.value}) (main) enviado.`);

    try {
      const chargeData = {
        value: buttonConfig.value * 100,
        webhook_url: null,
      };
      const chargeResult = await createCharge(chargeData);
      const chargeId = chargeResult.id;
      const emv = chargeResult.qr_code;

      const newPurchase = await Purchase.create({
        userId: user ? user.id : null,
        planName: buttonConfig.name,
        planValue: buttonConfig.value,
        botName: botConfig.name,
        originCondition: 'main',
        pixGeneratedAt: new Date(),
        status: 'pending',
        purchasedAt: null
      });

      userSessions[chatId].chargeId = chargeId;
      userSessions[chatId].purchaseId = newPurchase.id;

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

  bot.command('status_pagamento', async (ctx) => {
    const chatId = ctx.chat.id;
    const telegramId = chatId.toString();
    const session = userSessions[chatId];

    if (!session || !session.chargeId) {
      await ctx.reply('⚠️ Não há cobrança em andamento.');
      return;
    }

    const blockData = userBlockStatus.get(telegramId);
    if (blockData && (blockData.isBlocked || blockData.isBanned)) {
      return;
    }

    const rateLimitResult = canAttemptVerification(telegramId);
    if (!rateLimitResult.allowed) {
      handleUserBlock(telegramId);
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

          if (session.purchaseId) {
            await Purchase.update(
              {
                status: 'paid',
                purchasedAt: new Date()
              },
              { where: { id: session.purchaseId } }
            );
            logger.info(`✅ ${chatId} -> Purchase ID ${session.purchaseId} atualizado para status=paid.`);
          }

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

          if (session.selectedPlan && session.selectedPlan.link) {
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
        userSessions[chatId].paymentCheckCount = (userSessions[chatId].paymentCheckCount || 0) + 1;
        const count = userSessions[chatId].paymentCheckCount;

        if (count === 1) {
          await ctx.reply('⏳ Pagamento pendente');
        } else if (count === 2) {
          await ctx.reply('⏳ Pagamento pendente, conclua o pagamento para liberar o acesso.');
        }
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

  bot.action(/check_payment_(.+)/, async (ctx) => {
    const chatId = ctx.chat.id;
    const telegramId = chatId.toString();
    const chargeId = ctx.match[1];
    const session = userSessions[chatId];

    if (!session || session.chargeId !== chargeId) {
      await ctx.reply('⚠️ Cobrança não corresponde.');
      await ctx.answerCbQuery();
      return;
    }

    const blockData = userBlockStatus.get(telegramId);
    if (blockData && (blockData.isBlocked || blockData.isBanned)) {
      await ctx.answerCbQuery();
      return;
    }

    const rateLimitResult = canAttemptVerification(telegramId);
    if (!rateLimitResult.allowed) {
      await ctx.answerCbQuery();
      handleUserBlock(telegramId);
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

          if (session.purchaseId) {
            await Purchase.update(
              {
                status: 'paid',
                purchasedAt: new Date()
              },
              { where: { id: session.purchaseId } }
            );
            logger.info(`✅ ${chatId} -> comprou plano: ${session.selectedPlan.name} R$${session.selectedPlan.value} [${session.originCondition}] | purchase ID ${session.purchaseId} => status=paid`);
          }

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

          if (session.selectedPlan && session.selectedPlan.link) {
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
        userSessions[chatId].paymentCheckCount = (userSessions[chatId].paymentCheckCount || 0) + 1;
        const count = userSessions[chatId].paymentCheckCount;

        if (count === 1) {
          await ctx.reply('⏳ Pagamento pendente');
        } else if (count === 2) {
          await ctx.reply('⏳ Pagamento pendente, conclua o pagamento para liberar o acesso.');
        }
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

  // =====================================
  // Rotinas de Limpeza para Rate Limiting e Flood Protection
  // =====================================
  function cleanRateLimitMap(rateLimitMap, expirationFunction, mapName) {
    const now = Date.now();
    for (const [telegramId, userData] of rateLimitMap) {
      if (expirationFunction(userData, now)) {
        rateLimitMap.delete(telegramId);
        logger.info(`Limpeza: Removido ${telegramId} de ${mapName}.`);
      }
    }
  }

  setInterval(() => {
    cleanRateLimitMap(startLimits, (userData, now) => now > userData.nextAllowedStartTime + START_WAIT_SECOND_MS, 'startLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    cleanRateLimitMap(selectPlanLimits, (userData, now) => now > userData.blockUntil, 'selectPlanLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    cleanRateLimitMap(verificationLimits, (userData, now) => now > userData.blockUntil + VERIFICATION_CYCLE_RESET_MS, 'verificationLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    const now = Date.now();
    for (const [botName, floodData] of startFloodProtection) {
      if (floodData.isPaused && now >= floodData.pauseUntil) {
        floodData.isPaused = false;
        floodData.startTimestamps = [];
        startFloodProtection.set(botName, floodData);
        logger.info(`Proteção Flood: ${botName} - Pausa de 8 minutos encerrada.`);
      }
      floodData.startTimestamps = floodData.startTimestamps.filter(timestamp => now - timestamp <= START_FLOOD_WINDOW_MS);
      startFloodProtection.set(botName, floodData);
    }
  }, 60 * 1000);

  setInterval(() => {
    const now = Date.now();
    for (const [telegramId, blockData] of userBlockStatus) {
      if (blockData.isBlocked && now >= blockData.blockExpiresAt) {
        blockData.isBlocked = false;
        blockData.blockExpiresAt = 0;
        blockData.blockCount = 0;
        userBlockStatus.set(telegramId, blockData);
        logger.info(`Lead ${telegramId} desbloqueado após 72 horas.`);
      }
      if (blockData.isBanned && now >= blockData.banExpiresAt) {
        blockData.isBanned = false;
        blockData.banExpiresAt = 0;
        blockData.blockCount = 0;
        userBlockStatus.set(telegramId, blockData);
        logger.info(`Lead ${telegramId} desbanido após 1 semana.`);
      }
      if (!blockData.isBlocked && !blockData.isBanned && blockData.blockCount === 0) {
        userBlockStatus.delete(telegramId);
        logger.info(`Limpeza: Removido ${telegramId} de userBlockStatus.`);
      }
    }
  }, 60 * 60 * 1000);

  // =====================================
  // Lançamento do Bot
  // =====================================
  bot.launch()
    .then(() => {
      logger.info(`🚀 Bot ${botConfig.name} iniciado com sucesso.`);
    })
    .catch((error) => {
      logger.error(`🔥 Erro ao iniciar bot ${botConfig.name}:`, error);
    });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  bots.push(bot);
}

for (const botConf of config.bots) {
  initializeBot(botConf);
}

module.exports = bots;
