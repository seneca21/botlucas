// services/bot.service.js

const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const ConfigService = require('./config.service');
const { Sequelize } = require('sequelize');
const UserModel = require('../models/User');

/**
 * Função auxiliar para converter boolean para texto
 */
function booleanParaTexto(value, verdadeiro, falso) {
  return value ? verdadeiro : falso;
}

// Carrega o config.json
const config = ConfigService.loadConfig();
// Carrega as configs de banco (DATABASE_URL, etc)
const dbConfig = ConfigService.getDbConfig();

// Inicializa Sequelize
const sequelize = new Sequelize(dbConfig.connectionString, {
  dialect: dbConfig.dialect,
  dialectOptions: dbConfig.dialectOptions,
  logging: false, // Desativa logs do Sequelize
});

// Puxa o model User (você já incluiu botName no model!)
const User = UserModel(sequelize);

// Sincroniza o banco (cria/altera tabelas conforme o model)
sequelize.sync({ alter: true })
  .then(() => {
    console.log('✅ Modelos sincronizados e tabelas alteradas conforme necessário.');
  })
  .catch((err) => {
    console.error('❌ Erro ao sincronizar os modelos:', err);
  });

// Array de bots e sessões de usuários em memória
const bots = [];
const userSessions = {};

/**
 * Inicializa cada bot configurado no config.json
 */
function initializeBot(botConfig) {
  const bot = new Telegraf(botConfig.token);
  console.log(`🚀 Bot ${botConfig.name} em execução.`);

  /**
   * Registra ou atualiza o usuário no banco
   */
  async function registerUser(ctx) {
    try {
      const telegramId = ctx.from.id.toString();

      // Tenta encontrar ou criar
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

          // Importante: salva o nome do bot
          botName: botConfig.name,
        },
      });

      // Info de remarketing e compra para logs
      const statusRemarketing = booleanParaTexto(user.remarketingSent, 'Enviado', 'Não Enviado');
      const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');

      if (created) {
        console.log(`✅ Usuário registrado: ${telegramId}, Remarketing: ${statusRemarketing}, Compra: ${statusCompra}`);
      } else {
        user.lastInteraction = new Date();
        // Se quiser garantir sempre o botName atualizado, faça:
        user.botName = botConfig.name;
        await user.save();
        console.log(`🔄 Usuário atualizado: ${telegramId}, Remarketing: ${statusRemarketing}, Compra: ${statusCompra}`);
      }

      // Dispara uma mensagem de remarketing se ele não comprou depois de X minutos
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
          console.error(`❌ Erro ao enviar mensagem de remarketing para ${telegramId}:`, err);
        }
      }, notPurchasedInterval * 60 * 1000);

    } catch (error) {
      console.error('❌ Erro ao registrar usuário:', error);
    }
  }

  /**
   * Envia mensagens de remarketing conforme a condição
   */
  async function sendRemarketingMessage(user, condition) {
    try {
      // Localiza a config da mensagem
      const messageConfig = botConfig.remarketing.messages.find(msg => msg.condition === condition);
      if (!messageConfig) {
        console.error(`❌ Mensagem de remarketing não encontrada para a condição: ${condition}`);
        return;
      }

      const videoPath = path.resolve(__dirname, `../src/videos/${messageConfig.video}`);
      if (!fs.existsSync(videoPath)) {
        console.error(`❌ Arquivo de vídeo não encontrado: ${videoPath}`);
        return;
      }

      // Confere se todo botão tem "name"
      for (const button of messageConfig.buttons) {
        if (!button.name) {
          console.error(`❌ Um dos botões de remarketing está sem 'name'.`);
          return;
        }
      }

      // Cria o markup dos botões
      const remarketingButtonMarkup = messageConfig.buttons.map((button) =>
        Markup.button.callback(button.name, `remarketing_select_plan_${button.value}`)
      );

      // Envia a mensagem de remarketing com vídeo
      await bot.telegram.sendVideo(user.telegramId, { source: videoPath }, {
        caption: messageConfig.text,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(remarketingButtonMarkup, { columns: 1 }),
      });
    } catch (error) {
      console.error(`❌ Erro ao enviar mensagem de remarketing:`, error);
    }
  }

  /**
   * Tratamento global de erros do Telegraf
   */
  bot.catch((err, ctx) => {
    console.error(`❌ Erro no bot:`, err);
    if (err.response && err.response.error_code === 403) {
      console.warn(`🚫 Bot bloqueado pelo usuário ${ctx.chat.id}.`);
    } else {
      ctx.reply('⚠️ Ocorreu um erro inesperado. Tente novamente mais tarde.');
    }
  });

  /**
   * Ação "remarketing_select_plan_X" - user clica em um botão de remarketing
   */
  bot.action(/^remarketing_select_plan_(\d+(\.\d+)?)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const planValue = parseFloat(ctx.match[1]);

    // Procura esse plano tanto no array principal quanto no remarketing
    const mainPlan = botConfig.buttons.find(btn => btn.value === planValue);
    const remarketingPlan = botConfig.remarketing.messages
      .flatMap(msg => msg.buttons)
      .find(btn => btn.value === planValue);

    const plan = mainPlan || remarketingPlan;
    if (!plan) {
      console.error(`❌ Plano com valor ${planValue} não encontrado.`);
      await ctx.reply('⚠️ Plano não encontrado. Tente novamente.');
      await ctx.answerCbQuery();
      return;
    }

    // Salva no user o plano escolhido (opcional)
    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name; // caso queria manter atualizado
      await user.save();
    }

    console.log(`✅ Plano ${plan.name} (${plan.value} R$) enviado com sucesso ✅`);

    try {
      // Gera a cobrança
      const chargeData = {
        value: plan.value * 100,
        webhook_url: null,
      };
      const chargeResult = await createCharge(chargeData);
      const chargeId = chargeResult.id;
      const emv = chargeResult.qr_code;

      // Salva na sessão
      if (!userSessions[chatId]) userSessions[chatId] = {};
      userSessions[chatId].chargeId = chargeId;
      userSessions[chatId].selectedPlan = plan;

      // Envia o PIX
      await ctx.reply(
        `📄 Código PIX gerado com sucesso!\n\`\`\`\n${emv}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
      // Botão de verificar pagamento
      await ctx.reply(
        '⚠️ Após pagamento, clique em "Verificar Pagamento".',
        Markup.inlineKeyboard([
          Markup.button.callback('🔍 Verificar Pagamento', `check_payment_${chargeId}`),
        ])
      );
    } catch (error) {
      console.error('❌ Erro ao criar a cobrança via remarketing:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado pelo usuário ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao criar a cobrança. Tente mais tarde.');
      }
    }

    await ctx.answerCbQuery();
  });

  /**
   * /start
   */
  bot.start(async (ctx) => {
    try {
      console.info('📩 Comando /start recebido');
      await registerUser(ctx);

      const videoPath = path.resolve(__dirname, `../src/videos/${botConfig.video}`);
      if (!fs.existsSync(videoPath)) {
        console.error(`❌ Vídeo não encontrado: ${videoPath}`);
        await ctx.reply('⚠️ Erro ao carregar o vídeo.');
        return;
      }

      // Botões de planos
      const buttonMarkup = botConfig.buttons.map((button, index) =>
        Markup.button.callback(button.name, `select_plan_${index}`)
      );

      // Envia o vídeo inicial
      await ctx.replyWithVideo(
        { source: videoPath },
        {
          caption: botConfig.description,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttonMarkup, { columns: 1 }),
        }
      );

      console.log(`🎥 Vídeo e botões de plano enviados para ${ctx.chat.id}`);
    } catch (error) {
      console.error('❌ Erro no /start:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado pelo usuário ${ctx.chat.id}.`);
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
      console.error(`❌ Plano índice ${buttonIndex} não encontrado.`);
      await ctx.reply('⚠️ Plano não encontrado.');
      await ctx.answerCbQuery();
      return;
    }

    // Atualiza user com a última interação e o botName, se quiser
    const user = await User.findOne({ where: { telegramId: chatId.toString() } });
    if (user) {
      user.lastInteraction = new Date();
      user.botName = botConfig.name;
      await user.save();
    }

    console.log(`✅ Plano ${buttonConfig.name} (${buttonConfig.value} R$) enviado com sucesso ✅`);

    try {
      // Cria cobrança
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
        '⚠️ Após pagar, clique em "Verificar Pagamento".',
        Markup.inlineKeyboard([
          Markup.button.callback('🔍 Verificar Pagamento', `check_payment_${chargeId}`),
        ])
      );
    } catch (error) {
      console.error('❌ Erro ao criar cobrança:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado por ${ctx.chat.id}.`);
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
      await ctx.reply('⚠️ Nenhuma cobrança em andamento.');
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
          console.log(`✅ Usuário ${chatId} marcado como ${statusCompra}. Plano: ${user.planName} R$${user.planValue}`);

          // Dispara upsell
          const purchasedInterval = botConfig.remarketing.intervals.purchased_seconds || 30;
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: chatId.toString() } });
              if (currentUser && currentUser.hasPurchased) {
                await sendRemarketingMessage(currentUser, 'purchased');
                console.log(`✅ Upsell enviado para ${chatId}`);
              }
            } catch (err) {
              console.error(`❌ Erro upsell ${chatId}:`, err);
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
        await ctx.reply('❌ A cobrança expirou.');
        delete userSessions[chatId];
      } else {
        await ctx.reply('⏳ Aguardando pagamento...');
      }
    } catch (error) {
      console.error('❌ Erro ao verificar pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado por ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply('⚠️ Erro ao verificar pagamento.');
      }
    }
  });

  /**
   * Ação check_payment_X
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
      console.info('🔍 Verificando pagamento...');
      const paymentStatus = await checkPaymentStatus(chargeId);

      if (paymentStatus.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado!');
        const user = await User.findOne({ where: { telegramId: chatId.toString() } });
        if (user) {
          user.hasPurchased = true;
          await user.save();
          const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');
          console.log(`✅ Usuário ${chatId} ${statusCompra}.`);

          // Envia upsell
          const purchasedInterval = botConfig.remarketing.intervals.purchased_seconds || 30;
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: chatId.toString() } });
              if (currentUser && currentUser.hasPurchased) {
                await sendRemarketingMessage(currentUser, 'purchased');
                console.log(`✅ Upsell enviado ${chatId}`);
              }
            } catch (err) {
              console.error(`❌ Erro upsell ${chatId}:`, err);
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
      console.error('❌ Erro status pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot bloqueado ${ctx.chat.id}`);
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
      console.error(`🔥 Erro ao iniciar ${botConfig.name}:`, error);
    });

  // Permite encerramento gracioso
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  // Guarda no array
  bots.push(bot);
}

// Inicia cada bot configurado
for (const botConfig of config.bots) {
  initializeBot(botConfig);
}

// Exporta se precisar
module.exports = bots;
