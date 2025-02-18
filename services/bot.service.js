//------------------------------------------------------
// services/bot.service.js
//------------------------------------------------------
const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const ConfigService = require('./config.service');
const db = require('./index'); // importa index do Sequelize
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.BotModel; // Importa o modelo BotModel

const logger = require('./logger');

const config = ConfigService.loadConfig();
const dbConfig = ConfigService.getDbConfig();

const bots = [];
const userSessions = {};

// =====================================
// Rate Limiting para Verificações de Pagamento
// =====================================
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
    return { allowed: false, message: `⏰ Você excedeu o número de tentativas permitidas. Tente novamente mais tarde.` };
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
    userData.attempts += 1;
    userData.lastAttempt = now;
    verificationLimits.set(telegramId, userData);
    logger.info(`Verificação: ${telegramId} - Tentativa ${userData.attempts} permitida.`);
    return { allowed: true };
  } else {
    userData.violations += 1;
    userData.attempts = 0;

    if (userData.violations === 1) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_FIRST;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado por 2 minutos.`);
      return { allowed: false, message: `🚫 Bloqueado por 2 minutos devido a múltiplas tentativas.` };
    } else if (userData.violations === 2) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_SECOND;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado por 10 minutos.`);
      return { allowed: false, message: `🚫 Bloqueado por 10 minutos devido a múltiplas tentativas.` };
    } else if (userData.violations >= 3) {
      userData.blockUntil = now + VERIFICATION_BLOCK_TIME_THIRD;
      verificationLimits.set(telegramId, userData);
      logger.info(`Verificação: ${telegramId} - Bloqueado por 24 horas.`);
      return { allowed: false, message: `🚫 Bloqueado por 24 horas.` };
    }

    verificationLimits.set(telegramId, userData);
    logger.info(`Verificação: ${telegramId} - Tentativa não permitida.`);
    return { allowed: false, message: `🚫 Você excedeu o número de tentativas. Tente mais tarde.` };
  }
}

// =====================================
// Rate Limiting para /start
// =====================================
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
    logger.info(`/start: ${telegramId} - Primeiro start permitido.`);
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
    logger.info(`/start: ${telegramId} - Start número ${userData.startCount} permitido.`);
    return true;
  } else {
    userData.startCount = 1;
    userData.nextAllowedStartTime = now + START_WAIT_FIRST_MS;
    startLimits.set(telegramId, userData);
    logger.info(`/start: ${telegramId} - Ciclo reiniciado.`);
    return true;
  }
}

// =====================================
// Rate Limiting para botões select_plan
// =====================================
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
    logger.info(`Seleção de Plano: ${telegramId} - Primeiro plano (${planId}) sel.`);
    return true;
  }

  if (now < userData.blockUntil) {
    logger.info(`Seleção de Plano: ${telegramId} - Bloqueado até ${new Date(userData.blockUntil).toISOString()}.`);
    return false;
  }

  if (userData.selectedPlans.has(planId)) {
    userData.blockUntil = now + SELECT_PLAN_BLOCK_TIME_MS;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Repetida do plano (${planId}). Bloqueado 24h.`);
    return false;
  }

  if (userData.selectedPlans.size < MAX_SELECT_PLAN_ATTEMPTS) {
    userData.selectedPlans.add(planId);
    userData.lastAttempt = now;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Plano (${planId}) sel. Tamanho: ${userData.selectedPlans.size}.`);
    return true;
  } else {
    userData.blockUntil = now + SELECT_PLAN_BLOCK_TIME_MS;
    selectPlanLimits.set(telegramId, userData);
    logger.info(`Seleção de Plano: ${telegramId} - Excedeu seleções. Bloqueado 24h.`);
    return false;
  }
}

// =====================================
// Proteção Flood para /start
// =====================================
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
      logger.info(`Proteção Flood: ${botName} - Pausa encerrada.`);
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
    logger.warn(`Proteção Flood: ${botName} - Pausando /start por 8min, ${floodData.startTimestamps.length} starts em 3min.`);
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

  blockData.blockCount += 1;
  if (blockData.blockCount === BLOCK_COUNT_THRESHOLD) {
    setTimeout(() => {
      blockData.isBlocked = true;
      blockData.blockExpiresAt = now + IGNORE_DURATION_MS;
      userBlockStatus.set(telegramId, blockData);
      logger.warn(`Lead ${telegramId} bloqueado por 72h devido a múltiplos bloqueios.`);
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

function booleanParaTexto(value, verdadeiro, falso) {
  return value ? verdadeiro : falso;
}

// =====================================
// Carregar bots do BD e iniciar cada um
// =====================================
async function reloadBotsFromDB() {
  try {
    const allBots = await BotModel.findAll();
    for (const botRow of allBots) {
      const botConfig = {
        name: botRow.name,
        token: botRow.token,
        description: botRow.description,
        video: botRow.video,
        buttons: [],
        remarketing: {}
      };
      if (botRow.buttonsJson) {
        try {
          botConfig.buttons = JSON.parse(botRow.buttonsJson);
        } catch (err) {
          logger.error(`Erro ao parse buttonsJson do bot ${botRow.name}:`, err);
        }
      }
      if (botRow.remarketingJson) {
        try {
          let trimmed = botRow.remarketingJson.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            botConfig.remarketing = JSON.parse(trimmed);
          } else {
            botConfig.remarketing = {};
            logger.warn(`Remarketing JSON para o bot ${botRow.name} não é válido. Usando objeto vazio.`);
          }
        } catch (err) {
          logger.error(`Erro ao parse remarketingJson do bot ${botRow.name}:`, err);
        }
      }
      initializeBot(botConfig);
    }
  } catch (err) {
    logger.error('Erro em reloadBotsFromDB:', err);
  }
}

// =====================================
// Função para inicializar um bot
// =====================================
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

      if (botConfig.remarketing && botConfig.remarketing.intervals) {
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
      }
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

      if (!botConfig.remarketing || !botConfig.remarketing.messages) {
        logger.error(`Sem config remarketing.messages no bot ${botConfig.name}`);
        return;
      }
      const messageConfig = botConfig.remarketing.messages.find(msg => msg.condition === condition);
      if (!messageConfig) {
        logger.error(`❌ Sem mensagem de remarketing para condição: ${condition}`);
        return;
      }

      // Determina a fonte do vídeo: se for URL (vindo do S3) ou local
      let videoPath;
      if (messageConfig.video && messageConfig.video.startsWith('http')) {
        videoPath = messageConfig.video;
      } else {
        videoPath = path.resolve(__dirname, `../src/videos/${messageConfig.video}`);
        if (!fs.existsSync(videoPath)) {
          logger.error(`❌ Vídeo não encontrado: ${videoPath}`);
          return;
        }
      }

      const remarketingButtons = (messageConfig.buttons || []).map((btn) =>
        Markup.button.callback(btn.name, `remarketing_select_plan_${btn.value}`)
      );

      const videoInput = videoPath.startsWith('http') ? { url: videoPath } : { source: videoPath };

      await bot.telegram.sendVideo(user.telegramId, videoInput, {
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

  // Rota /start atualizada para buscar o vídeo via URL se disponível
  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from.id.toString();
      const botName = botConfig.name;
      const isBotPaused = checkStartFlood(botName);
      if (isBotPaused) return;

      const blockData = userBlockStatus.get(telegramId);
      if (blockData && (blockData.isBlocked || blockData.isBanned)) {
        return;
      }

      const canStartNow = canAttemptStart(telegramId);
      if (!canStartNow) {
        handleUserBlock(telegramId);
        return;
      }

      logger.info('📩 /start recebido');
      await registerUser(ctx);

      // Se o campo video já for uma URL (vindo do S3) utiliza-o; senão, busca no diretório local.
      let videoSource;
      if (botConfig.video && botConfig.video.startsWith('http')) {
        videoSource = botConfig.video;
      } else {
        videoSource = path.resolve(__dirname, `../src/videos/${botConfig.video}`);
        if (!fs.existsSync(videoSource)) {
          logger.error(`❌ Vídeo não achado: ${videoSource}`);
          await ctx.reply('⚠️ Erro ao carregar vídeo.');
          return;
        }
      }

      const buttonMarkup = (botConfig.buttons || []).map((btn, idx) =>
        Markup.button.callback(btn.name, `select_plan_${idx}`)
      );

      const videoInput = videoSource.startsWith('http') ? { url: videoSource } : { source: videoSource };

      await ctx.replyWithVideo(
        videoInput,
        {
          caption: botConfig.description || 'Sem descrição',
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

  bot.action(/^remarketing_select_plan_(\d+(\.\d+)?)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const planValue = parseFloat(ctx.match[1]);
    const mainPlan = (botConfig.buttons || []).find(btn => btn.value === planValue);
    let remarketingPlan = null;
    if (botConfig.remarketing && botConfig.remarketing.messages) {
      remarketingPlan = botConfig.remarketing.messages
        .flatMap(msg => msg.buttons || [])
        .find(btn => btn.value === planValue);
    }
    const plan = mainPlan || remarketingPlan;
    if (!plan) {
      logger.error(`❌ Plano valor ${planValue} não encontrado no bot ${botConfig.name}.`);
      await ctx.answerCbQuery();
      return;
    }

    const user = await User.findOne({ where: { telegramId: ctx.chat.id.toString() } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    const telegramId = ctx.chat.id.toString();
    const canSelect = canAttemptSelectPlan(telegramId, plan.name);
    if (!canSelect) {
      await ctx.answerCbQuery();
      handleUserBlock(telegramId);
      return;
    }

    if (!userSessions[ctx.chat.id]) userSessions[ctx.chat.id] = {};
    userSessions[ctx.chat.id].originCondition = 'main';
    userSessions[ctx.chat.id].selectedPlan = plan;
    userSessions[ctx.chat.id].paymentCheckCount = 0;

    logger.info(`✅ Plano ${plan.name} (R$${plan.value}) (main) enviado.`);

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
        originCondition: 'main',
        pixGeneratedAt: new Date(),
        status: 'pending',
        purchasedAt: null
      });

      userSessions[ctx.chat.id].chargeId = chargeId;
      userSessions[ctx.chat.id].purchaseId = newPurchase.id;

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
        delete userSessions[ctx.chat.id];
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
              { status: 'paid', purchasedAt: new Date() },
              { where: { id: session.purchaseId } }
            );
            logger.info(`✅ ${chatId} -> Purchase ID ${session.purchaseId} atualizado para paid.`);
          }

          if (botConfig.remarketing && botConfig.remarketing.intervals) {
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
          }

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
        session.paymentCheckCount = (session.paymentCheckCount || 0) + 1;
        const count = session.paymentCheckCount;
        if (count === 1) {
          await ctx.reply('⏳ Pagamento pendente');
        } else if (count === 2) {
          await ctx.reply('⏳ Pagamento pendente, conclua o pagamento.');
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
              { status: 'paid', purchasedAt: new Date() },
              { where: { id: session.purchaseId } }
            );
            logger.info(`✅ ${chatId} -> comprou plano: ${session.selectedPlan.name} R$${session.selectedPlan.value}.`);
          }

          if (botConfig.remarketing && botConfig.remarketing.intervals) {
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
          }

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
        session.paymentCheckCount = (session.paymentCheckCount || 0) + 1;
        const count = session.paymentCheckCount;
        if (count === 1) {
          await ctx.reply('⏳ Pagamento pendente');
        } else if (count === 2) {
          await ctx.reply('⏳ Pagamento pendente, conclua o pagamento.');
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

  // Rotinas de limpeza
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
    cleanRateLimitMap(startLimits, (ud, now) => now > ud.nextAllowedStartTime + START_WAIT_SECOND_MS, 'startLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    cleanRateLimitMap(selectPlanLimits, (ud, now) => now > ud.blockUntil, 'selectPlanLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    cleanRateLimitMap(verificationLimits, (ud, now) => now > ud.blockUntil + VERIFICATION_CYCLE_RESET_MS, 'verificationLimits');
  }, 60 * 60 * 1000);

  setInterval(() => {
    const now = Date.now();
    for (const [botName, floodData] of startFloodProtection) {
      if (floodData.isPaused && now >= floodData.pauseUntil) {
        floodData.isPaused = false;
        floodData.startTimestamps = [];
        startFloodProtection.set(botName, floodData);
        logger.info(`Proteção Flood: ${botName} - pausa encerrada.`);
      }
      floodData.startTimestamps = floodData.startTimestamps.filter(ts => now - ts <= START_FLOOD_WINDOW_MS);
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
        logger.info(`Lead ${telegramId} desbloqueado após 72h.`);
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
        logger.info(`Removido ${telegramId} de userBlockStatus.`);
      }
    }
  }, 60 * 60 * 1000);

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

// =====================================
// Função para atualizar a instância do bot em memória
// =====================================
function updateBotInMemory(id, newConfig) {
  logger.info(`Atualizando bot em memória (ID: ${id}).`);
  // Para simplificar, reinicia o bot com a nova configuração.
  initializeBot(newConfig);
}

module.exports = {
  initializeBot,
  reloadBotsFromDB,
  updateBotInMemory
};