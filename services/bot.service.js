// services/bot.service.js

const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const ConfigService = require('./config.service');
const db = require('./index'); // importa index do Sequelize
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.Bot; // Tabela bots
const logger = require('./logger');

const config = ConfigService.loadConfig();
const dbConfig = ConfigService.getDbConfig();

// Armazena as instâncias de bots e sessões em memória
const bots = [];
const userSessions = {};

// ================================
// Rate Limit e Proteções
// ================================
const verificationLimits = new Map();
const MAX_VERIFICATION_ATTEMPTS = 4;
const VERIFICATION_WINDOW_MS = 60 * 1000;
const VERIFICATION_BLOCK_TIME_FIRST = 120 * 1000;
const VERIFICATION_BLOCK_TIME_SECOND = 10 * 60 * 1000;
const VERIFICATION_BLOCK_TIME_THIRD = 24 * 60 * 60 * 1000;
const VERIFICATION_CYCLE_RESET_MS = 48 * 60 * 60 * 1000;

function canAttemptVerification(telegramId) {
  const now = Date.now();
  let userData = verificationLimits.get(telegramId);

  if (!userData) {
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
    logger.info(`Verificação: ${telegramId} - Bloqueado até ${new Date(userData.blockUntil).toISOString()}.`);
    return { allowed: false, message: `⏰ Você excedeu o número de tentativas permitidas. Tente mais tarde.` };
  }

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
    userData.attempts++;
    userData.lastAttempt = now;
    verificationLimits.set(telegramId, userData);
    logger.info(`Verificação: ${telegramId} - Tentativa ${userData.attempts} permitida.`);
    return { allowed: true };
  } else {
    userData.violations++;
    userData.attempts = 0;

    if (userData.violations === 1) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_FIRST;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado 2min.`);
      return { allowed: false, message: `🚫 Bloqueado 2min.` };
    } else if (userData.violations === 2) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_SECOND;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado 10min.`);
      return { allowed: false, message: `🚫 Bloqueado 10min.` };
    } else if (userData.violations >= 3) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_THIRD;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado 24h.`);
      return { allowed: false, message: `🚫 Bloqueado 24h.` };
    }
    verificationLimits.set(telegramId, userData);
    return { allowed: false, message: `🚫 Excedeu número de tentativas.` };
  }
}

const startLimits = new Map();
const MAX_STARTS = 5;
const START_WAIT_FIRST_MS = 5 * 60 * 1000;
const START_WAIT_SECOND_MS = 24 * 60 * 60 * 1000;

function canAttemptStart(telegramId) {
  const now = Date.now();
  let userData = startLimits.get(telegramId);

  if (!userData) {
    startLimits.set(telegramId, {
      startCount: 1,
      nextAllowedStartTime: now + START_WAIT_FIRST_MS
    });
    logger.info(`/start: ${telegramId} - Primeiro start.`);
    return true;
  }

  if (now < userData.nextAllowedStartTime) {
    logger.info(`/start: ${telegramId} - Bloqueado até ${new Date(userData.nextAllowedStartTime).toISOString()}.`);
    return false;
  }

  if (userData.startCount < MAX_STARTS) {
    userData.startCount++;
    userData.nextAllowedStartTime = now + START_WAIT_SECOND_MS;
    startLimits.set(telegramId, userData);
    logger.info(`/start: ${telegramId} - Start #${userData.startCount}.`);
    return true;
  } else {
    userData.startCount = 1;
    userData.nextAllowedStartTime = now + START_WAIT_FIRST_MS;
    startLimits.set(telegramId, userData);
    logger.info(`/start: ${telegramId} - Ciclo reiniciado.`);
    return true;
  }
}

const selectPlanLimits = new Map();
const MAX_SELECT_PLAN_ATTEMPTS = 2;
const SELECT_PLAN_BLOCK_TIME_MS = 24 * 60 * 60 * 1000;

function canAttemptSelectPlan(telegramId, planId) {
  const now = Date.now();
  let userData = selectPlanLimits.get(telegramId);

  if (!userData) {
    selectPlanLimits.set(telegramId, {
      selectedPlans: new Set([planId]),
      blockUntil: 0,
      lastAttempt: now
    });
    logger.info(`Seleção de Plano: ${telegramId} - 1º plano (${planId}).`);
    return true;
  }

  if (now < userData.blockUntil) {
    logger.info(`Seleção de Plano: ${telegramId} - Bloqueado até ${new Date(userData.blockUntil).toISOString()}.`);
    return false;
  }

  if (userData.selectedPlans.has(planId)) {
    userData.blockUntil = now + SELECT_PLAN_BLOCK_TIME_MS;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Repetida (${planId}). 24h.`);
    return false;
  }

  if (userData.selectedPlans.size < MAX_SELECT_PLAN_ATTEMPTS) {
    userData.selectedPlans.add(planId);
    userData.lastAttempt = now;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Plano (${planId}). Tot: ${userData.selectedPlans.size}.`);
    return true;
  } else {
    userData.blockUntil = now + SELECT_PLAN_BLOCK_TIME_MS;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Excedeu seleções. Bloqueado 24h.`);
    return false;
  }
}

const startFloodProtection = new Map();
const START_FLOOD_LIMIT = 20;
const START_FLOOD_WINDOW_MS = 3 * 60 * 1000;
const START_FLOOD_PAUSE_MS = 8 * 60 * 1000;

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
      logger.info(`Flood: ${botName} - pausa 8min ended.`);
    } else {
      return true;
    }
  }

  floodData.startTimestamps = floodData.startTimestamps.filter(ts => now - ts <= START_FLOOD_WINDOW_MS);
  floodData.startTimestamps.push(now);

  if (floodData.startTimestamps.length >= START_FLOOD_LIMIT) {
    floodData.isPaused = true;
    floodData.pauseUntil = now + START_FLOOD_PAUSE_MS;
    startFloodProtection.set(botName, floodData);
    logger.warn(`Flood: ${botName} - /start pausado 8min. (${floodData.startTimestamps.length} starts em 3min).`);
    return true;
  }

  startFloodProtection.set(botName, floodData);
  return false;
}

const userBlockStatus = new Map();
const BLOCK_COUNT_THRESHOLD = 2;
const BAN_COUNT_THRESHOLD = 3;
const IGNORE_DURATION_MS = 72 * 60 * 60 * 1000;
const BAN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const PAUSE_BEFORE_IGNORE_MS = 6 * 60 * 1000;

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

  blockData.blockCount++;
  if (blockData.blockCount === BLOCK_COUNT_THRESHOLD) {
    setTimeout(() => {
      blockData.isBlocked = true;
      blockData.blockExpiresAt = now + IGNORE_DURATION_MS;
      userBlockStatus.set(telegramId, blockData);
      logger.warn(`Lead ${telegramId} bloqueado por 72h (múltiplos bloqueios).`);
      setTimeout(() => {
        blockData.isBlocked = false;
        blockData.blockExpiresAt = 0;
        blockData.blockCount = 0;
        userBlockStatus.set(telegramId, blockData);
        logger.info(`Lead ${telegramId} desbloqueado após 72h.`);
      }, IGNORE_DURATION_MS);
    }, PAUSE_BEFORE_IGNORE_MS);
  } else if (blockData.blockCount >= BAN_COUNT_THRESHOLD) {
    blockData.isBanned = true;
    blockData.banExpiresAt = now + BAN_DURATION_MS;
    userBlockStatus.set(telegramId, blockData);
    logger.error(`Lead ${telegramId} banido por 1 semana.`);
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

function booleanParaTexto(value, v, f) {
  return value ? v : f;
}

// ======================
// updateBotInMemory
// ======================
function updateBotInMemory(botConfig) {
  // Remove se já existir
  const idx = bots.findIndex(b => b.contextName === botConfig.name);
  if (idx !== -1) {
    try {
      bots[idx].stop();
    } catch { }
    bots.splice(idx, 1);
  }
  // Re-inicializa esse bot
  initializeSingleBot(botConfig);
}

function initializeSingleBot(botConfig) {
  const bot = new Telegraf(botConfig.token);
  bot.contextName = botConfig.name; // para localizarmos depois

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

      const notPurchasedInterval = (botConfig.remarketing?.intervals?.not_purchased_minutes) || 5;
      setTimeout(async () => {
        try {
          const currentUser = await User.findOne({ where: { telegramId } });
          if (currentUser && !currentUser.hasPurchased && !currentUser.remarketingSent) {
            await sendRemarketingMessage(currentUser, 'not_purchased');
            currentUser.remarketingSent = true;
            await currentUser.save();
            logger.info(`✅ Mensagem remarketing -> ${telegramId}`);
          }
        } catch (err) {
          logger.error(`❌ Erro remarketing -> ${telegramId}:`, err);
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

      if (!botConfig.remarketing?.messages) return;

      const messageConfig = botConfig.remarketing.messages.find(msg => msg.condition === condition);
      if (!messageConfig) {
        logger.error(`❌ Sem mensagem remarketing p/ cond: ${condition}`);
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
    logger.error(`❌ Erro no bot ${botConfig.name}:`, err);
    if (err.response && err.response.error_code === 403) {
      logger.warn(`🚫 Bloqueado por ${ctx?.chat?.id}.`);
    }
  });

  bot.action(/^remarketing_select_plan_(\d+(\.\d+)?)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const planValue = parseFloat(ctx.match[1]);
    const mainPlan = botConfig?.buttons?.find(btn => btn.value === planValue);
    const remarketingPlan = botConfig.remarketing?.messages
      ?.flatMap(msg => msg.buttons)
      ?.find(btn => btn.value === planValue);

    const plan = mainPlan || remarketingPlan;
    if (!plan) {
      logger.error(`❌ Plano valor ${planValue} inexistente.`);
      await ctx.answerCbQuery();
      return;
    }

    const user = await User.findOne({ where: { telegramId: String(chatId) } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    const telegramId = String(chatId);
    const rateLimitResult = canAttemptVerification(telegramId);
    if (!rateLimitResult.allowed) {
      await ctx.answerCbQuery();
      handleUserBlock(telegramId);
      return;
    }

    const session = userSessions[chatId] || {};
    const remarketingCond = session.remarketingCondition || 'not_purchased';

    logger.info(`✅ Plano remarketing ${plan.name} R$${plan.value}, cond=${remarketingCond}`);

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
        `📄 PIX:\n\`\`\`\n${emv}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply(
        '⚠️ Depois de pagar, clique em "Verificar Pagamento".',
        Markup.inlineKeyboard([
          Markup.button.callback('🔍 Verificar Pagamento', `check_payment_${chargeId}`),
        ])
      );
    } catch (error) {
      logger.error('❌ Erro cobrança (remarketing):', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bloqueado: ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao criar cobrança. Tente mais tarde.');
      }
    }

    await ctx.answerCbQuery();
  });

  bot.start(async (ctx) => {
    try {
      const telegramId = String(ctx.from.id);
      const isBotPaused = checkStartFlood(botConfig.name);
      if (isBotPaused) return;

      const blockData = userBlockStatus.get(telegramId);
      if (blockData && (blockData.isBlocked || blockData.isBanned)) {
        return;
      }

      if (!canAttemptStart(telegramId)) {
        handleUserBlock(telegramId);
        return;
      }

      logger.info('📩 /start recebido');
      await registerUser(ctx);

      const videoPath = path.resolve(__dirname, `../src/videos/${botConfig.video}`);
      if (!fs.existsSync(videoPath)) {
        logger.error(`❌ Vídeo não achado: ${videoPath}`);
        await ctx.reply('⚠️ Erro ao carregar vídeo (arquivo inexistente).');
        return;
      }

      const buttonMarkup = (botConfig.buttons || []).map((btn, idx) =>
        Markup.button.callback(btn.name, `select_plan_${idx}`)
      );

      await ctx.replyWithVideo(
        { source: videoPath },
        {
          caption: botConfig.description || 'Descrição não fornecida.',
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttonMarkup, { columns: 1 }),
        }
      );

      logger.info(`🎥 Vídeo & botões enviados -> ${ctx.chat.id}`);
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
    const idx = parseInt(ctx.match[1], 10);
    const buttonConfig = (botConfig.buttons || [])[idx];

    if (!buttonConfig) {
      logger.error(`❌ Plano index ${idx} não achado.`);
      await ctx.answerCbQuery();
      return;
    }

    const user = await User.findOne({ where: { telegramId: String(chatId) } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    const telegramId = String(chatId);
    if (!canAttemptSelectPlan(telegramId, buttonConfig.name)) {
      await ctx.answerCbQuery();
      handleUserBlock(telegramId);
      return;
    }

    if (!userSessions[chatId]) userSessions[chatId] = {};
    userSessions[chatId].originCondition = 'main';
    userSessions[chatId].selectedPlan = buttonConfig;
    userSessions[chatId].paymentCheckCount = 0;

    logger.info(`✅ Plano principal ${buttonConfig.name} (R$${buttonConfig.value})`);

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
        `📄 PIX:\n\`\`\`\n${emv}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply(
        '⚠️ Após pagar, clique em "Verificar Pagamento".',
        Markup.inlineKeyboard([
          Markup.button.callback('🔍 Verificar Pagamento', `check_payment_${chargeId}`),
        ])
      );
    } catch (error) {
      logger.error('❌ Erro createCharge:', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bloqueado: ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao criar cobrança.');
      }
    }

    await ctx.answerCbQuery();
  });

  bot.command('status_pagamento', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];
    if (!session?.chargeId) {
      await ctx.reply('⚠️ Não há cobrança em andamento.');
      return;
    }

    const blockData = userBlockStatus.get(String(chatId));
    if (blockData && (blockData.isBlocked || blockData.isBanned)) {
      return;
    }

    const rateLimitResult = canAttemptVerification(String(chatId));
    if (!rateLimitResult.allowed) {
      handleUserBlock(String(chatId));
      return;
    }

    try {
      logger.info('🔍 Verificando pagamento...');
      const st = await checkPaymentStatus(session.chargeId);

      if (st.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado!');
        const user = await User.findOne({ where: { telegramId: String(chatId) } });
        if (user) {
          user.hasPurchased = true;
          await user.save();

          if (session.purchaseId) {
            await Purchase.update(
              { status: 'paid', purchasedAt: new Date() },
              { where: { id: session.purchaseId } }
            );
          }

          const purchasedInterval = (botConfig.remarketing?.intervals?.purchased_seconds) || 30;
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: String(chatId) } });
              if (currentUser && currentUser.hasPurchased) {
                await sendRemarketingMessage(currentUser, 'purchased');
                logger.info(`✅ Upsell enviado -> ${chatId}`);
              }
            } catch (err) {
              logger.error(`❌ Erro upsell -> ${chatId}:`, err);
            }
          }, purchasedInterval * 1000);

          if (session.selectedPlan?.link) {
            await ctx.reply(`🎉 Produto: [Acessar](${session.selectedPlan.link})`, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply('⚠️ Link do produto não encontrado.');
          }
        }
        delete userSessions[chatId];
      } else if (st.status === 'expired') {
        await ctx.reply('❌ Cobrança expirou.');
        delete userSessions[chatId];
      } else {
        session.paymentCheckCount = (session.paymentCheckCount || 0) + 1;
        const count = session.paymentCheckCount;
        if (count === 1) {
          await ctx.reply('⏳ Pagamento pendente');
        } else if (count === 2) {
          await ctx.reply('⏳ Ainda pendente, finalize o pagamento.');
        }
      }
    } catch (error) {
      logger.error('❌ Erro checkPaymentStatus:', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bloqueado: ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao verificar pagamento.');
      }
    }
  });

  bot.action(/check_payment_(.+)/, async (ctx) => {
    const chatId = ctx.chat.id;
    const chargeId = ctx.match[1];
    const session = userSessions[chatId];

    if (!session || session.chargeId !== chargeId) {
      await ctx.reply('⚠️ Cobrança não corresponde.');
      await ctx.answerCbQuery();
      return;
    }

    const blockData = userBlockStatus.get(String(chatId));
    if (blockData && (blockData.isBlocked || blockData.isBanned)) {
      await ctx.answerCbQuery();
      return;
    }

    const rateLimitResult = canAttemptVerification(String(chatId));
    if (!rateLimitResult.allowed) {
      await ctx.answerCbQuery();
      handleUserBlock(String(chatId));
      return;
    }

    try {
      logger.info('🔍 Verificando pagamento...');
      const st = await checkPaymentStatus(chargeId);

      if (st.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado!');
        const user = await User.findOne({ where: { telegramId: String(chatId) } });
        if (user) {
          user.hasPurchased = true;
          await user.save();

          if (session.purchaseId) {
            await Purchase.update(
              { status: 'paid', purchasedAt: new Date() },
              { where: { id: session.purchaseId } }
            );
          }

          const purchasedInterval = (botConfig.remarketing?.intervals?.purchased_seconds) || 30;
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: String(chatId) } });
              if (currentUser && currentUser.hasPurchased) {
                await sendRemarketingMessage(currentUser, 'purchased');
                logger.info(`✅ Upsell -> ${chatId}`);
              }
            } catch (err) {
              logger.error(`❌ Erro upsell -> ${chatId}:`, err);
            }
          }, purchasedInterval * 1000);

          if (session.selectedPlan?.link) {
            await ctx.reply(`🎉 Produto: [Acessar](${session.selectedPlan.link})`, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply('⚠️ Link de produto não configurado.');
          }
        }
        delete userSessions[chatId];
      } else if (st.status === 'expired') {
        await ctx.reply('❌ Expirou.');
        delete userSessions[chatId];
      } else {
        session.paymentCheckCount = (session.paymentCheckCount || 0) + 1;
        const count = session.paymentCheckCount;
        if (count === 1) {
          await ctx.reply('⏳ Pendente...');
        } else if (count === 2) {
          await ctx.reply('⏳ Ainda pendente...');
        }
      }
    } catch (error) {
      logger.error('❌ Erro checkPaymentStatus:', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bloqueado: ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao verificar pagamento.');
      }
    }

    await ctx.answerCbQuery();
  });

  // Limpezas:
  function cleanRateLimitMap(rateLimitMap, expirationFunction, mapName) {
    const now = Date.now();
    for (const [telegramId, userData] of rateLimitMap) {
      if (expirationFunction(userData, now)) {
        rateLimitMap.delete(telegramId);
        logger.info(`Limpeza: removido ${telegramId} de ${mapName}.`);
      }
    }
  }

  setInterval(() => {
    cleanRateLimitMap(startLimits, (d, now) => now > d.nextAllowedStartTime + START_WAIT_SECOND_MS, 'startLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    cleanRateLimitMap(selectPlanLimits, (d, now) => now > d.blockUntil, 'selectPlanLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    cleanRateLimitMap(verificationLimits, (d, now) => now > d.blockUntil + VERIFICATION_CYCLE_RESET_MS, 'verificationLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    const now = Date.now();
    for (const [botName, fd] of startFloodProtection) {
      if (fd.isPaused && now >= fd.pauseUntil) {
        fd.isPaused = false;
        fd.startTimestamps = [];
        startFloodProtection.set(botName, fd);
        logger.info(`Flood: ${botName} - 8min ended.`);
      }
      fd.startTimestamps = fd.startTimestamps.filter(ts => now - ts <= START_FLOOD_WINDOW_MS);
      startFloodProtection.set(botName, fd);
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
        logger.info(`Lead ${telegramId} desbloqueado após 72h.`);
      }
      if (blockData.isBanned && now >= blockData.banExpiresAt) {
        blockData.isBanned = false;
        blockData.banExpiresAt = 0;
        blockData.blockCount = 0;
        userBlockStatus.set(telegramId, blockData);
        logger.info(`Lead ${telegramId} desbanido após 1semana.`);
      }
      if (!blockData.isBlocked && !blockData.isBanned && blockData.blockCount === 0) {
        userBlockStatus.delete(telegramId);
      }
    }
  }, 60 * 60 * 1000);

  bot.launch()
    .then(() => logger.info(`🚀 Bot ${botConfig.name} iniciado com sucesso.`))
    .catch((error) => logger.error(`🔥 Erro ao iniciar bot ${botConfig.name}:`, error));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  bots.push(bot);
}

// Carrega bots do config.json e do DB
function initializeBots() {
  // Bots do config.json:
  if (config.bots && Array.isArray(config.bots)) {
    for (const botConf of config.bots) {
      initializeSingleBot(botConf);
    }
  }
}

// Carrega bots do DB:
async function reloadBotsFromDB() {
  try {
    const dbBots = await BotModel.findAll();
    for (const b of dbBots) {
      let remarketingJson = null;
      let buttonsJson = null;
      try {
        if (b.remarketingJson) remarketingJson = JSON.parse(b.remarketingJson);
      } catch { }
      try {
        if (b.buttonsJson) buttonsJson = JSON.parse(b.buttonsJson);
      } catch { }

      const memoryConfig = {
        name: b.name,
        token: b.token,
        description: b.description,
        video: b.video,
        buttons: buttonsJson || [],
        remarketing: remarketingJson || {}
      };
      initializeSingleBot(memoryConfig);
    }
    logger.info('🚀 reloadBotsFromDB finalizado.');
  } catch (err) {
    logger.error('Erro reloadBotsFromDB:', err);
  }
}

// Inicia:
initializeBots();

module.exports = {
  bots,
  reloadBotsFromDB,
  updateBotInMemory
};
