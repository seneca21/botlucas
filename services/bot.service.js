// services/bot.service.js

const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const ConfigService = require('./config.service');
const db = require('./index'); // importa index do Sequelize (da pasta services)
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.BotModel; // Importa o modelo BotModel

const logger = require('./logger');

const config = ConfigService.loadConfig();
const dbConfig = ConfigService.getDbConfig();

const bots = [];
const userSessions = {};

// Mapas de rate limiting e bloqueio (implementação simplificada; ajuste conforme sua lógica)
const verificationLimits = new Map();
const startLimits = new Map();
const selectPlanLimits = new Map();
const startFloodProtection = new Map();
const userBlockStatus = new Map();

// Funções de rate limiting (aqui você pode incluir sua lógica detalhada)
function canAttemptVerification(telegramId) {
  // IMPLEMENTE aqui sua lógica de rate limit para verificação
  return true;
}

function canAttemptStart(telegramId) {
  // IMPLEMENTE sua lógica de /start
  return true;
}

function canAttemptSelectPlan(telegramId, planId) {
  // IMPLEMENTE sua lógica para seleção de plano
  return true;
}

function checkStartFlood(botName) {
  // IMPLEMENTE sua lógica de proteção contra flood
  return false;
}

function handleUserBlock(telegramId) {
  // IMPLEMENTE sua lógica de bloqueio de usuário
  logger.warn(`Usuário ${telegramId} bloqueado temporariamente.`);
}

// (Você pode adicionar funções para limpar os mapas periodicamente se necessário)

// Função para inicializar um bot
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

      const statusRemarketing = user.remarketingSent ? 'Enviado' : 'Não Enviado';
      const statusCompra = user.hasPurchased ? 'Comprado' : 'Sem Compra';
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

      // Monta a URL do vídeo a partir do bucket S3
      const videoUrl = `https://${process.env.BUCKETEER_BUCKET_NAME}.s3.${process.env.BUCKETEER_AWS_REGION}.amazonaws.com/${messageConfig.video}`;
      if (!videoUrl) {
        logger.error(`❌ Vídeo não disponível: ${videoUrl}`);
        return;
      }

      const remarketingButtons = (messageConfig.buttons || []).map((btn) =>
        Markup.button.callback(btn.name, `remarketing_select_plan_${btn.value}`)
      );

      await bot.telegram.sendVideo(user.telegramId, videoUrl, {
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

  // Rota /start
  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from.id.toString();
      const botName = botConfig.name;
      if (checkStartFlood(botName)) return;
      if (!canAttemptStart(telegramId)) {
        handleUserBlock(telegramId);
        return;
      }

      logger.info('📩 /start recebido');
      await registerUser(ctx);

      // Monta a URL pública do vídeo do bot no S3
      const videoUrl = `https://${process.env.BUCKETEER_BUCKET_NAME}.s3.${process.env.BUCKETEER_AWS_REGION}.amazonaws.com/${botConfig.video}`;
      if (!videoUrl) {
        logger.error(`❌ Vídeo não disponível para o bot ${botConfig.name}`);
        await ctx.reply('⚠️ Erro ao carregar vídeo.');
        return;
      }

      const buttonMarkup = (botConfig.buttons || []).map((btn, idx) =>
        Markup.button.callback(btn.name, `select_plan_${idx}`)
      );

      await ctx.replyWithVideo(
        videoUrl,
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
    if (!canAttemptSelectPlan(telegramId, plan.name)) {
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

    if (!canAttemptVerification(telegramId)) {
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

    if (!canAttemptVerification(telegramId)) {
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
      logger.error('❌ Erro ao verificar o status do pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        logger.warn(`🚫 Bot bloqueado: ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao verificar pagamento.');
      }
    }

    await ctx.answerCbQuery();
  });

  // Lançamento e encerramento do bot
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

// Função para atualizar a instância do bot em memória
function updateBotInMemory(id, newConfig) {
  logger.info(`Atualizando bot em memória (ID: ${id}).`);
  // Para simplificar, reinicia o bot com a nova configuração.
  initializeBot(newConfig);
}

module.exports = {
  initializeBot,
  reloadBotsFromDB: async function reloadBotsFromDB() {
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
  },
  updateBotInMemory
};