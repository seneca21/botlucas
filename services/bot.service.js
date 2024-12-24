// services/bot.service.js

const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const ConfigService = require('./config.service');
const { Sequelize } = require('sequelize');
const UserModel = require('../models/User');

/**
 * Função auxiliar para converter boolean para texto (logs)
 */
function booleanParaTexto(value, verdadeiro, falso) {
  return value ? verdadeiro : falso;
}

// Carrega o config.json
const config = ConfigService.loadConfig();
// Carrega configs de banco (DATABASE_URL, etc)
const dbConfig = ConfigService.getDbConfig();

// Inicializa Sequelize
const sequelize = new Sequelize(dbConfig.connectionString, {
  dialect: dbConfig.dialect,
  dialectOptions: dbConfig.dialectOptions,
  logging: false, // Desativa logs do Sequelize
});

// Model User (com botName, planName, planValue, etc.)
const User = UserModel(sequelize);

// Sincroniza o banco
sequelize.sync({ alter: true })
  .then(() => {
    console.log('✅ Modelos sincronizados e tabelas alteradas conforme necessário.');
  })
  .catch((err) => {
    console.error('❌ Erro ao sincronizar os modelos:', err);
  });

// Armazena as instâncias de bots e sessões em memória
const bots = [];
const userSessions = {};

/**
 * Inicializa cada bot configurado em config.json
 */
function initializeBot(botConfig) {
  const bot = new Telegraf(botConfig.token);
  console.log(`🚀 Bot ${botConfig.name} em execução.`);

  /**
   * Registra ou atualiza o usuário
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
          botName: botConfig.name, // registra qual bot o user está usando
        },
      });

      const statusRemarketing = booleanParaTexto(user.remarketingSent, 'Enviado', 'Não Enviado');
      const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');

      if (created) {
        console.log(`✅ Novo usuário: ${telegramId}, Remarketing: ${statusRemarketing}, Compra: ${statusCompra}`);
      } else {
        user.lastInteraction = new Date();
        user.botName = botConfig.name; // se quiser sempre atualizar o nome do bot
        await user.save();
        console.log(`🔄 Usuário atualizado: ${telegramId}, Remarketing: ${statusRemarketing}, Compra: ${statusCompra}`);
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
            console.log(`✅ Mensagem de remarketing enviada para ${telegramId}`);
          }
        } catch (err) {
          console.error(`❌ Erro ao enviar remarketing para ${telegramId}:`, err);
        }
      }, notPurchasedInterval * 60 * 1000);

    } catch (error) {
      console.error('❌ Erro ao registrar usuário:', error);
    }
  }

  /**
   * Envia mensagens de remarketing
   */
  async function sendRemarketingMessage(user, condition) {
    try {
      const messageConfig = botConfig.remarketing.messages.find(msg => msg.condition === condition);
      if (!messageConfig) {
        console.error(`❌ Sem mensagem de remarketing para condição: ${condition}`);
        return;
      }

      const videoPath = path.resolve(__dirname, `../src/videos/${messageConfig.video}`);
      if (!fs.existsSync(videoPath)) {
        console.error(`❌ Vídeo não encontrado: ${videoPath}`);
        return;
      }

      for (const button of messageConfig.buttons) {
        if (!button.name) {
          console.error(`❌ Botão de remarketing sem 'name'.`);
          return;
        }
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
      console.error(`❌ Erro remarketing:`, error);
    }
  }

  // Tratamento de erros geral
  bot.catch((err, ctx) => {
    console.error(`❌ Erro no bot:`, err);
    if (err.response && err.response.error_code === 403) {
      console.warn(`🚫 Bot bloqueado por ${ctx.chat.id}.`);
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

    // Tenta achar esse plano nas configs
    const mainPlan = botConfig.buttons.find(btn => btn.value === planValue);
    const remarketingPlan = botConfig.remarketing.messages
      .flatMap(msg => msg.buttons)
      .find(btn => btn.value === planValue);

    const plan = mainPlan || remarketingPlan;
    if (!plan) {
      console.error(`❌ Plano valor ${planValue} não encontrado.`);
      await ctx.reply('⚠️ Plano inexistente. Tente novamente.');
      await ctx.answerCbQuery();
      return;
    }

    // Seta planName e planValue no user, se existir
    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.planName = plan.name;    // Ex.: "Plano Mensal"
      user.planValue = plan.value;  // Ex.: 49.90
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    console.log(`✅ Plano remarketing ${plan.name} R$${plan.value} selecionado.`);

    try {
      const chargeData = {
        value: plan.value * 100,
        webhook_url: null,
      };
      const chargeResult = await createCharge(chargeData);
      const chargeId = chargeResult.id;
      const emv = chargeResult.qr_code;

      if (!userSessions[chatId]) userSessions[chatId] = {};
      userSessions[chatId].chargeId = chargeId;
      userSessions[chatId].selectedPlan = plan;

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
      console.error('❌ Erro cobrança (remarketing):', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado por ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao criar cobrança. Tente mais tarde.');
      }
    }

    await ctx.answerCbQuery();
  });

  /**
   * /start
   */
  bot.start(async (ctx) => {
    try {
      console.info('📩 /start recebido');
      await registerUser(ctx);

      const videoPath = path.resolve(__dirname, `../src/videos/${botConfig.video}`);
      if (!fs.existsSync(videoPath)) {
        console.error(`❌ Vídeo não achado: ${videoPath}`);
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

      console.log(`🎥 Vídeo & botões enviados para ${ctx.chat.id}`);
    } catch (error) {
      console.error('❌ Erro /start:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado: ${ctx.chat.id}.`);
      } else {
        await ctx.reply('⚠️ Erro ao processar /start.');
      }
    }
  });

  /**
   * Ação "select_plan_X"
   */
  bot.action(/^select_plan_(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const buttonIndex = parseInt(ctx.match[1], 10);
    const buttonConfig = botConfig.buttons[buttonIndex];

    if (!buttonConfig) {
      console.error(`❌ Plano index ${buttonIndex} não achado.`);
      await ctx.reply('⚠️ Plano inexistente.');
      await ctx.answerCbQuery();
      return;
    }

    // Seta planName, planValue no user
    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.planName = buttonConfig.name;   // ex.: "Mensal"
      user.planValue = buttonConfig.value; // ex.: 49.90
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    console.log(`✅ Plano ${buttonConfig.name} (R$${buttonConfig.value}) enviado.`);

    try {
      const chargeData = {
        value: buttonConfig.value * 100,
        webhook_url: null,
      };
      const chargeResult = await createCharge(chargeData);
      const chargeId = chargeResult.id;
      const emv = chargeResult.qr_code;

      if (!userSessions[chatId]) userSessions[chatId] = {};
      userSessions[chatId].chargeId = chargeId;
      userSessions[chatId].selectedPlan = buttonConfig;

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
      console.error('❌ Erro ao criar cobrança:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bloqueado por ${ctx.chat.id}.`);
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
      console.info('🔍 Verificando pagamento...');
      const paymentStatus = await checkPaymentStatus(session.chargeId);

      if (paymentStatus.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado!');
        const user = await User.findOne({ where: { telegramId: chatId.toString() } });
        if (user) {
          user.hasPurchased = true;
          await user.save();
          const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');
          console.log(`✅ ${chatId} -> ${statusCompra}. Plano: ${user.planName} R$${user.planValue}`);

          // Envia upsell depois de X seg
          const purchasedInterval = botConfig.remarketing.intervals.purchased_seconds || 30;
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: chatId.toString() } });
              if (currentUser && currentUser.hasPurchased) {
                await sendRemarketingMessage(currentUser, 'purchased');
                console.log(`✅ Upsell enviado -> ${chatId}`);
              }
            } catch (err) {
              console.error(`❌ Erro upsell -> ${chatId}:`, err);
            }
          }, purchasedInterval * 1000);
        }

        // Link do produto
        const selectedPlan = session.selectedPlan;
        if (selectedPlan && selectedPlan.link) {
          await ctx.reply(`🎉 Produto: [Acessar](${selectedPlan.link})`, { parse_mode: 'Markdown' });
        } else {
          await ctx.reply('⚠️ Link do produto não encontrado.');
        }

        delete userSessions[chatId];
      } else if (paymentStatus.status === 'expired') {
        await ctx.reply('❌ Cobrança expirou.');
        delete userSessions[chatId];
      } else {
        await ctx.reply('⏳ Ainda aguardando pagamento...');
      }
    } catch (error) {
      console.error('❌ Erro ao verificar pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado: ${ctx.chat.id}.`);
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
      return;
    }

    try {
      console.info('🔍 Ver status pagamento...');
      const paymentStatus = await checkPaymentStatus(chargeId);

      if (paymentStatus.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado!');
        const user = await User.findOne({ where: { telegramId: chatId.toString() } });
        if (user) {
          user.hasPurchased = true;
          await user.save();
          const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');
          console.log(`✅ ${chatId} -> ${statusCompra}. Plano: ${user.planName} R$${user.planValue}`);

          // Upsell
          const purchasedInterval = botConfig.remarketing.intervals.purchased_seconds || 30;
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: chatId.toString() } });
              if (currentUser && currentUser.hasPurchased) {
                await sendRemarketingMessage(currentUser, 'purchased');
                console.log(`✅ Upsell enviado -> ${chatId}`);
              }
            } catch (err) {
              console.error(`❌ Erro upsell -> ${chatId}:`, err);
            }
          }, purchasedInterval * 1000);

          // Link do produto
          const selectedPlan = session.selectedPlan;
          if (selectedPlan && selectedPlan.link) {
            await ctx.reply(`🎉 Produto: [Acessar](${selectedPlan.link})`, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply('⚠️ Link do produto não encontrado.');
          }
          delete userSessions[chatId];
        }
      } else if (paymentStatus.status === 'expired') {
        await ctx.reply('❌ Cobrança expirada.');
        delete userSessions[chatId];
      } else {
        await ctx.reply('⏳ Pagamento pendente.');
      }
    } catch (error) {
      console.error('❌ Erro ao verificar pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado: ${ctx.chat.id}.`);
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
      console.info(`🚀 Bot ${botConfig.name} iniciado com sucesso.`);
    })
    .catch((error) => {
      console.error(`🔥 Erro ao iniciar bot ${botConfig.name}:`, error);
    });

  // Encerramento gracioso
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  // Salva no array
  bots.push(bot);
}

// Inicia cada bot do array config.bots
for (const botConfig of config.bots) {
  initializeBot(botConfig);
}

// Exporta se precisar
module.exports = bots;
