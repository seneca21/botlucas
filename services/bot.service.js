const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ConfigService = require('./config.service');
const db = require('./index'); // importa index do Sequelize
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.BotModel; // Importa o modelo BotModel

const logger = require('./logger');

const config = ConfigService.loadConfig();
const dbConfig = ConfigService.getDbConfig();

// ================================
// Configuração do AWS S3 Client (Bucketeer)
// ================================
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = new S3Client({
  region: process.env.BUCKETEER_AWS_REGION,
  credentials: {
    accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY
  }
});

/**
 * Obtém o stream do vídeo a partir do Bucketeer (S3) utilizando a URL.
 * @param {string} videoUrl
 * @returns {Promise<Stream>}
 */
async function getS3VideoStream(videoUrl) {
  try {
    const urlObj = new URL(videoUrl);
    const key = urlObj.pathname.substring(1);
    const command = new GetObjectCommand({
      Bucket: process.env.BUCKETEER_BUCKET_NAME,
      Key: key
    });
    const response = await s3Client.send(command);
    return response.Body;
  } catch (err) {
    logger.error('Erro ao obter stream do S3:', err);
    throw err;
  }
}

const bots = [];
const userSessions = {};

// (As funções de rate limiting permanecem inalteradas)
// ... [código de rate limiting igual ao anterior] ...

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
      logger.info(created
        ? `✅ Novo usuário: ${telegramId}`
        : `🔄 Usuário atualizado: ${telegramId}`);
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
      // Se houver remarketingVideo e remarketingButtons definidos, usá-los
      if (botConfig.remarketingVideo) {
        let videoInput;
        if (botConfig.remarketingVideo.startsWith('http')) {
          videoInput = { source: await getS3VideoStream(botConfig.remarketingVideo) };
        } else {
          const videoPath = path.resolve(__dirname, `../src/videos/${botConfig.remarketingVideo}`);
          if (!fs.existsSync(videoPath)) {
            logger.error(`❌ Vídeo de remarketing não encontrado: ${videoPath}`);
            return;
          }
          videoInput = { source: fs.createReadStream(videoPath) };
        }
        // Se remarketingButtons estiver definido
        let buttons = [];
        if (botConfig.remarketingButtons && botConfig.remarketingButtons.length > 0) {
          buttons = botConfig.remarketingButtons.map(btn =>
            Markup.button.callback(btn.name, `remarketing_select_plan_${btn.value}`)
          );
        }
        await bot.telegram.sendVideo(user.telegramId, videoInput, {
          caption: botConfig.remarketing && botConfig.remarketing.text ? botConfig.remarketing.text : '',
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons, { columns: 1 })
        });
      } else if (botConfig.remarketing && botConfig.remarketing.messages) {
        // Caso contrário, utiliza a configuração anterior
        const messageConfig = botConfig.remarketing.messages.find(msg => msg.condition === condition);
        if (!messageConfig) {
          logger.error(`❌ Sem mensagem de remarketing para condição: ${condition}`);
          return;
        }
        let videoInput;
        if (messageConfig.video && messageConfig.video.startsWith('http')) {
          videoInput = { source: await getS3VideoStream(messageConfig.video) };
        } else {
          let videoPath = path.resolve(__dirname, `../src/videos/${messageConfig.video}`);
          if (!fs.existsSync(videoPath)) {
            logger.error(`❌ Vídeo não encontrado: ${videoPath}`);
            return;
          }
          videoInput = { source: fs.createReadStream(videoPath) };
        }
        const remarketingButtons = (messageConfig.buttons || []).map((btn) =>
          Markup.button.callback(btn.name, `remarketing_select_plan_${btn.value}`)
        );
        await bot.telegram.sendVideo(user.telegramId, videoInput, {
          caption: messageConfig.text,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(remarketingButtons, { columns: 1 })
        });
      }
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

  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from.id.toString();
      if (checkStartFlood(botConfig.name)) return;
      const blockData = userBlockStatus.get(telegramId);
      if (blockData && (blockData.isBlocked || blockData.isBanned)) return;
      if (!canAttemptStart(telegramId)) {
        handleUserBlock(telegramId);
        return;
      }
      logger.info('📩 /start recebido');
      await registerUser(ctx);
      let videoInput;
      if (botConfig.video && botConfig.video.startsWith('http')) {
        videoInput = { source: await getS3VideoStream(botConfig.video) };
      } else {
        const videoPath = path.resolve(__dirname, `../src/videos/${botConfig.video}`);
        if (!fs.existsSync(videoPath)) {
          logger.error(`❌ Vídeo não achado: ${videoPath}`);
          await ctx.reply('⚠️ Erro ao carregar vídeo.');
          return;
        }
        videoInput = { source: fs.createReadStream(videoPath) };
      }
      const buttonMarkup = (botConfig.buttons || []).map((btn, idx) =>
        Markup.button.callback(btn.name, `select_plan_${idx}`)
      );
      await ctx.replyWithVideo(videoInput, {
        caption: botConfig.description || 'Sem descrição',
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttonMarkup, { columns: 1 }),
      });
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

  // Handlers para os botões de remarketing e seleção de plano (mantidos praticamente iguais)
  bot.action(/^remarketing_select_plan_(\d+(\.\d+)?)$/, async (ctx) => {
    // (handler inalterado, conforme código anterior)
    // ...
  });

  bot.action(/^select_plan_(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const index = parseInt(ctx.match[1]);
    const plan = (botConfig.buttons || [])[index];
    if (!plan) {
      logger.error(`❌ Plano não encontrado para o índice ${index} no bot ${botConfig.name}.`);
      await ctx.answerCbQuery("Plano não encontrado.");
      return;
    }
    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }
    const telegramId = chatId.toString();
    if (!canAttemptSelectPlan(telegramId, plan.name)) {
      await ctx.answerCbQuery();
      handleUserBlock(telegramId);
      return;
    }
    if (!userSessions[chatId]) userSessions[chatId] = {};
    userSessions[chatId].originCondition = 'main';
    userSessions[chatId].selectedPlan = plan;
    userSessions[chatId].paymentCheckCount = 0;
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
      userSessions[chatId].chargeId = chargeId;
      userSessions[chatId].purchaseId = newPurchase.id;
      await ctx.reply(
        `📄 Código PIX gerado!\n\`\`\`\n${emv}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
      // Se não houver link definido no plano, usa vipLink
      if (plan.link) {
        await ctx.reply(`🎉 Produto: [Acessar](${plan.link})`, { parse_mode: 'Markdown' });
      } else if (botConfig.vipLink) {
        await ctx.reply(`🎉 Produto: [Acessar Grupo VIP](${botConfig.vipLink})`, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply('⚠️ Link do produto não encontrado.');
      }
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
    // (handler semelhante ao anterior, com a alteração de usar vipLink se necessário)
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
    if (!canAttemptVerification(telegramId).allowed) {
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
          // Envia remarketing se aplicável
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
          } else if (botConfig.vipLink) {
            await ctx.reply(`🎉 Produto: [Acessar Grupo VIP](${botConfig.vipLink})`, { parse_mode: 'Markdown' });
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
    // (handler semelhante ao anterior)
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
    if (!canAttemptVerification(telegramId).allowed) {
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
          } else if (botConfig.vipLink) {
            await ctx.reply(`🎉 Produto: [Acessar Grupo VIP](${botConfig.vipLink})`, { parse_mode: 'Markdown' });
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

  // Rotinas de limpeza (inalteradas)
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

function updateBotInMemory(id, newConfig) {
  logger.info(`Atualizando bot em memória (ID: ${id}).`);
  initializeBot(newConfig);
}

module.exports = {
  initializeBot,
  reloadBotsFromDB,
  updateBotInMemory
};