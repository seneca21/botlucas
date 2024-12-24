// services/bot.service.js

const { Telegraf, Markup } = require('telegraf');
const { createCharge, checkPaymentStatus } = require('./qr.service');
const path = require('path');
const fs = require('fs');
const ConfigService = require('./config.service');
const { Sequelize } = require('sequelize');
const UserModel = require('../models/User');

// Função para converter valores booleanos em textos descritivos
function booleanParaTexto(value, verdadeiro, falso) {
  return value ? verdadeiro : falso;
}

// Carrega as configurações
const config = ConfigService.loadConfig();
const dbConfig = ConfigService.getDbConfig();

// Inicializa o Sequelize com a configuração do banco de dados
const sequelize = new Sequelize(dbConfig.connectionString, {
  dialect: dbConfig.dialect,
  dialectOptions: dbConfig.dialectOptions,
  logging: false, // Desativa logs do Sequelize para evitar poluição nos logs do app
});

// Define o modelo User
const User = UserModel(sequelize);

// Sincroniza os modelos com o banco de dados e altera tabelas conforme necessário
sequelize.sync({ alter: true })
  .then(() => {
    console.log('✅ Modelos sincronizados e tabelas alteradas conforme necessário.');
  })
  .catch((err) => {
    console.error('❌ Erro ao sincronizar os modelos:', err);
  });

// Armazena as instâncias dos bots e sessões de usuários
const bots = [];
const userSessions = {};

/**
 * Função para inicializar cada bot
 */
function initializeBot(botConfig) {
  // Inicializa o bot com o token do config.json
  const bot = new Telegraf(botConfig.token);

  // Log de início do bot
  console.log(`🚀 Bot ${botConfig.name} em execução.`);

  /**
   * Função para registrar ou atualizar o usuário no banco de dados
   */
  async function registerUser(ctx) {
    try {
      const telegramId = ctx.from.id.toString();

      // Usa findOrCreate para evitar duplicatas
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
        }
      });

      const statusRemarketing = booleanParaTexto(user.remarketingSent, 'Enviado', 'Não Enviado');
      const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');

      if (created) {
        console.log(`✅ Usuário registrado: ${telegramId}, Remarketing: ${statusRemarketing}, Compra: ${statusCompra}`);
      } else {
        // Atualiza a última interação
        user.lastInteraction = new Date();
        await user.save();
        console.log(`🔄 Usuário atualizado: ${telegramId}, Remarketing: ${statusRemarketing}, Compra: ${statusCompra}`);
      }

      // Agendar mensagem de remarketing para usuários que não compraram após o intervalo definido
      const notPurchasedInterval = botConfig.remarketing.intervals.not_purchased_minutes || 5; // minutos
      setTimeout(async () => {
        try {
          const currentUser = await User.findOne({ where: { telegramId } });
          if (currentUser && !currentUser.hasPurchased && !currentUser.remarketingSent) {
            // Enviar mensagem de remarketing
            await sendRemarketingMessage(currentUser, 'not_purchased');
            // Atualizar remarketingSent
            currentUser.remarketingSent = true;
            await currentUser.save();
            console.log(`✅ Mensagem de remarketing enviada para ${telegramId}`);
          }
        } catch (err) {
          console.error(`❌ Erro ao enviar mensagem de remarketing para ${telegramId}:`, err);
        }
      }, notPurchasedInterval * 60 * 1000); // converter para milissegundos

    } catch (error) {
      console.error('❌ Erro ao registrar usuário:', error);
    }
  }

  /**
   * Função para enviar mensagem de remarketing baseada na condição
   */
  async function sendRemarketingMessage(user, condition) {
    try {
      // Encontrar a mensagem correspondente
      const messageConfig = botConfig.remarketing.messages.find(msg => msg.condition === condition);
      if (!messageConfig) {
        console.error(`❌ Mensagem de remarketing não encontrada para a condição: ${condition}`);
        return;
      }

      // Caminho completo do vídeo
      const videoPath = path.resolve(__dirname, `../src/videos/${messageConfig.video}`);

      // Verificar se o arquivo de vídeo existe
      if (!fs.existsSync(videoPath)) {
        console.error(`❌ Arquivo de vídeo não encontrado: ${videoPath}`);
        return;
      }

      // Verifique se todos os botões têm a propriedade 'name'
      for (const button of messageConfig.buttons) {
        if (!button.name) {
          console.error(`❌ Um dos botões de remarketing está faltando a propriedade 'name'.`);
          return;
        }
      }

      // Gerar botões dinamicamente com base nos planos de remarketing
      const remarketingButtonMarkup = messageConfig.buttons.map((button) =>
        Markup.button.callback(button.name, `remarketing_select_plan_${button.value}`)
      );

      // Enviar vídeo com a mensagem e botões de remarketing
      await bot.telegram.sendVideo(user.telegramId, { source: videoPath }, {
        caption: messageConfig.text,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(remarketingButtonMarkup, { columns: 1 })
      });

    } catch (error) {
      console.error(`❌ Erro ao enviar mensagem de remarketing para ${user.telegramId}:`, error);
    }
  }

  /**
   * Manipulador de Erros Global
   */
  bot.catch((err, ctx) => {
    console.error(`❌ Erro no bot:`, err);
    if (err.response && err.response.error_code === 403) {
      console.warn(`🚫 Bot foi bloqueado pelo usuário ${ctx.chat.id}.`);
    } else {
      ctx.reply('⚠️ Ocorreu um erro inesperado. Por favor, tente novamente mais tarde.');
    }
  });

  /**
   * Manipulador para seleção de plano via remarketing
   */
  bot.action(/^remarketing_select_plan_(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const planValue = parseFloat(ctx.match[1]); // Valor do plano selecionado via remarketing

    // Encontrar o plano correspondente pelo valor
    const mainPlan = botConfig.buttons.find(btn => btn.value === planValue);
    const remarketingPlan = botConfig.remarketing.messages.flatMap(msg => msg.buttons).find(btn => btn.value === planValue);
    const plan = mainPlan || remarketingPlan;

    if (!plan) {
      console.error(`❌ Plano com valor ${planValue} não encontrado.`);
      await ctx.reply('⚠️ Plano não encontrado. Por favor, tente novamente.');
      await ctx.answerCbQuery();
      return;
    }

    // Log conciso: Plano enviado com sucesso
    console.log(`✅ Plano ${plan.name} (${plan.value} R$) enviado com sucesso ✅`);

    try {
      // Dados da cobrança
      const chargeData = {
        value: plan.value * 100, // Converter para centavos
        webhook_url: null,
      };

      // Chama a função para criar a cobrança
      const chargeResult = await createCharge(chargeData);
      const chargeId = chargeResult.id;
      const emv = chargeResult.qr_code;

      // Armazena o chargeId e o plano selecionado na sessão do usuário para acompanhamento
      if (!userSessions[chatId]) userSessions[chatId] = {};
      userSessions[chatId].chargeId = chargeId;
      userSessions[chatId].selectedPlan = plan;

      // Envia o código Pix para o usuário
      await ctx.reply(
        `📄 Aqui está o seu código PIX gerado com sucesso! 🎉\n\n\`\`\`\n${emv}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );

      // Envia a mensagem com o botão 'Verificar Pagamento'
      await ctx.reply(
        '⚠️ Importante! Após o pagamento, clique no botão "Verificar Pagamento" abaixo para receber o link de acesso.',
        Markup.inlineKeyboard([
          Markup.button.callback('🔍 Verificar Pagamento', `check_payment_${chargeId}`),
        ])
      );

    } catch (error) {
      console.error('❌ Erro ao criar a cobrança via remarketing:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot foi bloqueado pelo usuário ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply(
          '⚠️ Ocorreu um erro ao criar a cobrança. Tente novamente mais tarde.'
        );
      }
    }

    // Remove a animação de "carregando" do botão
    await ctx.answerCbQuery();
  });

  /**
   * Comando /start
   */
  bot.start(async (ctx) => {
    try {
      console.info('📩 Comando /start recebido');
      await registerUser(ctx);

      const videoPath = path.resolve(__dirname, `../src/videos/${botConfig.video}`);

      // Verificar se o arquivo de vídeo existe
      if (!fs.existsSync(videoPath)) {
        console.error(`❌ Arquivo de vídeo não encontrado: ${videoPath}`);
        await ctx.reply('⚠️ Erro ao carregar o vídeo. Por favor, tente novamente mais tarde.');
        return;
      }

      // Gerar botões dinamicamente com base nos planos
      const buttonMarkup = botConfig.buttons.map((button, index) =>
        Markup.button.callback(button.name, `select_plan_${index}`)
      );

      // Enviar vídeo com os botões de plano
      await ctx.replyWithVideo(
        { source: videoPath },
        {
          caption: botConfig.description,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttonMarkup, { columns: 1 }),
        }
      );

      console.log(`🎥 Vídeo e botões de plano enviados com sucesso para ${ctx.chat.id}`);
    } catch (error) {
      console.error('❌ Erro no comando /start:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot foi bloqueado pelo usuário ${ctx.chat.id}.`);
      } else {
        await ctx.reply(
          '⚠️ Ocorreu um erro ao processar o seu comando. Tente novamente mais tarde.'
        );
      }
    }
  });

  /**
   * Manipulador para seleção de plano principal
   */
  bot.action(/^select_plan_(\d+)$/, async (ctx) => {
    const chatId = ctx.chat.id;
    const buttonIndex = parseInt(ctx.match[1], 10); // Índice do botão selecionado
    const buttonConfig = botConfig.buttons[buttonIndex]; // Configuração do plano selecionado

    if (!buttonConfig) {
      console.error(`❌ Plano com índice ${buttonIndex} não encontrado.`);
      await ctx.reply('⚠️ Plano não encontrado. Por favor, tente novamente.');
      await ctx.answerCbQuery();
      return;
    }

    // Log conciso: Plano enviado com sucesso
    console.log(`✅ Plano ${buttonConfig.name} (${buttonConfig.value} R$) enviado com sucesso ✅`);

    try {
      // Dados da cobrança
      const chargeData = {
        value: buttonConfig.value * 100, // Converter para centavos
        webhook_url: null,
      };

      // Chama a função para criar a cobrança
      const chargeResult = await createCharge(chargeData);
      const chargeId = chargeResult.id;
      const emv = chargeResult.qr_code;

      // Armazena o chargeId e o plano selecionado na sessão do usuário para acompanhamento
      if (!userSessions[chatId]) userSessions[chatId] = {};
      userSessions[chatId].chargeId = chargeId;
      userSessions[chatId].selectedPlan = buttonConfig;

      // Envia o código Pix para o usuário
      await ctx.reply(
        `📄 Aqui está o seu código PIX gerado com sucesso! 🎉\n\n\`\`\`\n${emv}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );

      // Envia a mensagem com o botão 'Verificar Pagamento'
      await ctx.reply(
        '⚠️ Importante! Após o pagamento, clique no botão "Verificar Pagamento" abaixo para receber o link de acesso.',
        Markup.inlineKeyboard([
          Markup.button.callback('🔍 Verificar Pagamento', `check_payment_${chargeId}`),
        ])
      );

    } catch (error) {
      console.error('❌ Erro ao criar a cobrança:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot foi bloqueado pelo usuário ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply(
          '⚠️ Ocorreu um erro ao criar a cobrança. Tente novamente mais tarde.'
        );
      }
    }

    // Remove a animação de "carregando" do botão
    await ctx.answerCbQuery();
  });

  /**
   * Comando /status_pagamento
   */
  bot.command('status_pagamento', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];

    if (!session || !session.chargeId) {
      await ctx.reply(
        '⚠️ Nenhuma cobrança em andamento encontrada. Inicie uma cobrança selecionando um plano.'
      );
      return;
    }

    try {
      console.info('🔍 Verificando status do pagamento...');
      const paymentStatus = await checkPaymentStatus(session.chargeId);

      if (paymentStatus.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado com sucesso!');

        // Atualizar o campo hasPurchased para true
        const user = await User.findOne({ where: { telegramId: chatId.toString() } });
        if (user) {
          user.hasPurchased = true;
          await user.save();
          const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');
          console.log(`✅ Usuário ${chatId} marcado como ${statusCompra}.`);

          // Agendar mensagem de upsell após o intervalo definido
          const purchasedInterval = botConfig.remarketing.intervals.purchased_seconds || 30; // segundos
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: chatId.toString() } });
              if (currentUser && currentUser.hasPurchased) {
                // Enviar mensagem de upsell
                await sendRemarketingMessage(currentUser, 'purchased');
                console.log(`✅ Mensagem de upsell enviada para ${chatId}`);
              }
            } catch (err) {
              console.error(`❌ Erro ao enviar mensagem de upsell para ${chatId}:`, err);
            }
          }, purchasedInterval * 1000); // converter para milissegundos
        }

        // Enviar o link do produto
        const selectedPlan = session.selectedPlan;
        if (selectedPlan && selectedPlan.link) {
          await ctx.reply(
            `🎉 Aqui está o seu produto: [Acessar Produto](${selectedPlan.link})`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply('⚠️ Não foi possível encontrar o link do produto.');
        }

        // Opcional: limpar a sessão
        delete userSessions[chatId];
      } else if (paymentStatus.status === 'expired') {
        await ctx.reply('❌ A cobrança expirou.');
        // Opcional: limpar a sessão
        delete userSessions[chatId];
      } else {
        await ctx.reply('⏳ Aguardando pagamento...');
      }
    } catch (error) {
      console.error('❌ Erro ao verificar o status do pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot foi bloqueado pelo usuário ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply(
          '⚠️ Ocorreu um erro ao verificar o status do pagamento. Tente novamente mais tarde.'
        );
      }
    }
  });

  /**
   * Manipulador do botão de verificação de pagamento
   */
  bot.action(/check_payment_(.+)/, async (ctx) => {
    const chatId = ctx.chat.id;
    const chargeId = ctx.match[1]; // Obtém o ID da cobrança do callback data

    // Verifica se o chargeId está associado ao usuário
    const session = userSessions[chatId];
    if (!session || session.chargeId !== chargeId) {
      await ctx.reply(
        '⚠️ Nenhuma cobrança em andamento encontrada ou cobrança não corresponde.'
      );
      return;
    }

    try {
      console.info('🔍 Verificando status do pagamento...');
      const paymentStatus = await checkPaymentStatus(chargeId);

      if (paymentStatus.status === 'paid') {
        await ctx.reply('🎉 Pagamento confirmado com sucesso!');

        // Atualizar o campo hasPurchased para true
        const user = await User.findOne({ where: { telegramId: chatId.toString() } });
        if (user) {
          user.hasPurchased = true;
          await user.save();
          const statusCompra = booleanParaTexto(user.hasPurchased, 'Comprado', 'Sem Compra');
          console.log(`✅ Usuário ${chatId} marcado como ${statusCompra}.`);

          // Agendar mensagem de upsell após o intervalo definido
          const purchasedInterval = botConfig.remarketing.intervals.purchased_seconds || 30; // segundos
          setTimeout(async () => {
            try {
              const currentUser = await User.findOne({ where: { telegramId: chatId.toString() } });
              if (currentUser && currentUser.hasPurchased) {
                // Enviar mensagem de upsell
                await sendRemarketingMessage(currentUser, 'purchased');
                console.log(`✅ Mensagem de upsell enviada para ${chatId}`);
              }
            } catch (err) {
              console.error(`❌ Erro ao enviar mensagem de upsell para ${chatId}:`, err);
            }
          }, purchasedInterval * 1000); // converter para milissegundos

          // Enviar o link do produto
          const selectedPlan = session.selectedPlan;
          if (selectedPlan && selectedPlan.link) {
            await ctx.reply(
              `🎉 Aqui está o seu produto: [Acessar Produto](${selectedPlan.link})`,
              { parse_mode: 'Markdown' }
            );
          } else {
            await ctx.reply('⚠️ Não foi possível encontrar o link do produto.');
          }

          // Opcional: limpar a sessão
          delete userSessions[chatId];
        }
      } else if (paymentStatus.status === 'expired') {
        await ctx.reply('❌ A cobrança expirou.');
        // Opcional: limpar a sessão
        delete userSessions[chatId];
      } else {
        await ctx.reply(
          '⏳ Pagamento ainda pendente, confirme o pagamento para receber o link de acesso.'
        );
      }
    } catch (error) {
      console.error('❌ Erro ao verificar o status do pagamento:', error);
      if (error.response && error.response.error_code === 403) {
        console.warn(`🚫 Bot foi bloqueado pelo usuário ${ctx.chat.id}.`);
        delete userSessions[chatId];
      } else {
        await ctx.reply(
          '⚠️ Ocorreu um erro ao verificar o status do pagamento. Tente novamente mais tarde.'
        );
      }
    }

    // Remove a animação de "carregando" do botão
    await ctx.answerCbQuery();
  });

  /**
   * Inicia o bot
   */
  bot.launch()
    .then(() => {
      console.info(`🚀 Bot ${botConfig.name} iniciado com sucesso.`);
    })
    .catch((error) => {
      console.error(`🔥 Erro ao iniciar o bot ${botConfig.name}:`, error);
    });

  // Habilita o encerramento gracioso do bot
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  // Adiciona o bot à lista de bots ativos
  bots.push(bot);
}

// Inicializa cada bot presente na configuração
for (const botConfig of config.bots) {
  initializeBot(botConfig);
}

module.exports = bots;
