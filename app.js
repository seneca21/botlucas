// app.js

//------------------------------------------------------
// 1) IMPORTS E CONFIGURAÇÕES BÁSICAS
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { Op, Sequelize } = require('sequelize');

// Importa a instância do Sequelize configurada em db.js
const sequelize = require('./db');

// Importa o model User (que já tem botName e planName etc)
const UserModel = require('./models/User');
const User = UserModel(sequelize);

// Inicia o Express
const app = express();

// Middlewares de JSON e de arquivos estáticos
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

//------------------------------------------------------
// 2) TESTE DE CONEXÃO E SYNC (Opcional, se já faz em outro lugar)
//------------------------------------------------------
sequelize.authenticate()
    .then(() => console.log('✅ Conexão com o DB estabelecida.'))
    .catch(err => console.error('❌ Erro ao conectar DB:', err));

sequelize.sync({ alter: true })
    .then(() => console.log('✅ Modelos sincronizados (alter).'))
    .catch(err => console.error('❌ Erro ao sincronizar modelos:', err));

//------------------------------------------------------
// 3) ROTA PRINCIPAL -> ENVIA O SEU DASHBOARD (index.html)
//------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//------------------------------------------------------
// 4) ROTA /api/bots-stats -> RETORNA DADOS PARA O DASHBOARD
//------------------------------------------------------
app.get('/api/bots-stats', async (req, res) => {
    try {
        const { date } = req.query;
        const selectedDate = date ? new Date(date) : new Date();

        // Intervalo do dia
        const startDate = new Date(selectedDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(selectedDate);
        endDate.setHours(23, 59, 59, 999);

        // 1) totalUsers = contagem de usuários que tiveram lastInteraction no dia
        const totalUsers = await User.count({
            where: {
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // 2) totalPurchases = contagem de usuários que compraram nesse dia
        //    (aqui assumimos hasPurchased = true e lastInteraction dentro do dia)
        const totalPurchases = await User.count({
            where: {
                hasPurchased: true,
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // 3) taxa de conversão
        const conversionRate = totalUsers > 0
            ? (totalPurchases / totalUsers) * 100
            : 0;

        // 4) Ranking de bots -> quantas compras por bot + soma do planValue
        const botsWithPurchases = await User.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalPurchases'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue']
            ],
            where: {
                hasPurchased: true,
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                },
                botName: {
                    [Op.ne]: null
                }
            },
            group: ['botName']
        });

        // 5) totalUsers por bot
        const botsWithInteractions = await User.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalUsers']
            ],
            where: {
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                },
                botName: {
                    [Op.ne]: null
                }
            },
            group: ['botName']
        });

        // Monta um map (botName -> totalUsers)
        const botUsersMap = {};
        botsWithInteractions.forEach(item => {
            const bName = item.botName;
            const uCount = parseInt(item.getDataValue('totalUsers'), 10) || 0;
            botUsersMap[bName] = uCount;
        });

        // 6) Vendas detalhadas por plano e por bot
        const planSalesByBot = await User.findAll({
            attributes: [
                'botName',
                'planName',
                [Sequelize.fn('COUNT', Sequelize.col('planName')), 'salesCount'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue']
            ],
            where: {
                hasPurchased: true,
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                },
                planName: {
                    [Op.ne]: null
                },
                botName: {
                    [Op.ne]: null
                }
            },
            group: ['botName', 'planName'],
            order: [[Sequelize.literal('"salesCount"'), 'DESC']]
        });

        // Monta map: { [botName]: { [planName]: { salesCount, totalValue } } }
        const botPlansMap = {};
        planSalesByBot.forEach(row => {
            const bName = row.botName;
            const pName = row.planName;
            const sCount = parseInt(row.getDataValue('salesCount'), 10) || 0;
            const tValue = parseFloat(row.getDataValue('totalValue')) || 0;
            if (!botPlansMap[bName]) botPlansMap[bName] = {};
            botPlansMap[bName][pName] = { salesCount: sCount, totalValue: tValue };
        });

        // 7) Monta array final "botDetails" para Ranking Detalhado
        const botDetails = [];
        botsWithPurchases.forEach(bot => {
            const bName = bot.botName;
            const totalPurchasesBot = parseInt(bot.getDataValue('totalPurchases'), 10) || 0;
            const totalValueBot = parseFloat(bot.getDataValue('totalValue')) || 0;
            const totalUsersBot = botUsersMap[bName] || 0;

            const conversionRateBot = totalUsersBot > 0
                ? (totalPurchasesBot / totalUsersBot) * 100
                : 0;

            // Valor médio
            const averageValueBot = totalPurchasesBot > 0
                ? totalValueBot / totalPurchasesBot
                : 0;

            // Planos desse bot
            const plansObj = botPlansMap[bName] || {};
            const plansArray = [];
            for (const [planName, info] of Object.entries(plansObj)) {
                const planConversionRate = totalUsersBot > 0
                    ? (info.salesCount / totalUsersBot) * 100
                    : 0;
                plansArray.push({
                    planName,
                    salesCount: info.salesCount,
                    conversionRate: planConversionRate
                });
            }

            // push no array final
            botDetails.push({
                botName: bName,
                valorGerado: totalValueBot,     // totalValue no dia
                totalPurchases: totalPurchasesBot,
                totalUsers: totalUsersBot,
                conversionRate: conversionRateBot,
                averageValue: averageValueBot,
                plans: plansArray
            });
        });

        // Ordena desc por valorGerado (opcional)
        botDetails.sort((a, b) => b.valorGerado - a.valorGerado);

        // Retorna ao front-end
        res.json({
            totalUsers,
            totalPurchases,
            conversionRate,
            botDetails
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

//------------------------------------------------------
// 8) IMPORTA O BOT (FAZ O BOT RODAR JUNTAMENTE COM O WEB)
//------------------------------------------------------
require('./services/bot.service.js');

//------------------------------------------------------
// 9) INICIA O SERVIDOR WEB
//------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor web iniciado na porta ${PORT}`);
});
