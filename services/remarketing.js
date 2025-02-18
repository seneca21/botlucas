// services/bot.service.js

const { Markup } = require('telegraf');
const User = require('../models/User');
const ConfigService = require('./config.service');

async function sendRemarketingMessages() {
    try {
        console.log('⏰ Executando tarefa de remarketing...');

        // Carregar configuração de remarketing
        const botConfig = ConfigService.loadConfig().bots[0];
        const remarketingMessages = botConfig.remarketing.messages;

        // Seleciona usuários que não receberam remarketing recentemente
        const users = await User.findAll({
            where: {
                remarketingSent: false,
                // Outros filtros possíveis, como lastInteraction
            },
        });

        console.log(`👥 Usuários para remarketing: ${users.length}`);

        if (users.length === 0) {
            console.log('🔍 Nenhum usuário encontrado para remarketing.');
            return;
        }

        // Itera sobre cada usuário e envia a mensagem de remarketing
        for (const user of users) {
            console.log(`🔄 Preparando para enviar mensagem para Telegram ID: ${user.telegramId}`);

            // Obter a mensagem de remarketing (apenas uma)
            const message = remarketingMessages[0];

            // Enviar vídeo com a mensagem e botões
            await bot.telegram.sendVideo(user.telegramId, { source: `./videos/${message.video}` }, {
                caption: message.text,
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    Markup.button.url(message.buttons[0].name, message.buttons[0].link),
                    Markup.button.url(message.buttons[1].name, message.buttons[1].link)
                ])
            });

            console.log(`✉️ Mensagem de remarketing enviada para ${user.telegramId}`);

            // Atualizar o campo remarketingSent para true
            user.remarketingSent = true;
            await user.save();

            console.log(`✅ Campo remarketingSent atualizado para ${user.telegramId}`);
        }
    } catch (error) {
        console.error('❌ Erro ao executar o remarketing:', error);
    }
}

module.exports = sendRemarketingMessages;
