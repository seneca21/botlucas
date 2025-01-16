//------------------------------------------------------
// app.js
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { Op, Sequelize } = require('sequelize');

// Importa a instância do Sequelize (com models)
const db = require('./services/index');
const User = db.User;
const Purchase = db.Purchase;

// Inicia o Express
const app = express();

// Middlewares
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Testa conexão
db.sequelize.authenticate()
    .then(() => console.log('✅ Conexão com DB estabelecida.'))
    .catch(err => console.error('❌ Erro ao conectar DB:', err));

// Sync (alter)
db.sequelize.sync({ alter: true })
    .then(() => console.log('✅ Modelos sincronizados (alter).'))
    .catch(err => console.error('❌ Erro ao sincronizar modelos:', err));

// Rota Principal -> index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//------------------------------------------------------
// ROTA /api/bots-stats -> agora usando Purchases
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

        // (A) totalUsers = usuários que interagiram no dia
        const totalUsers = await User.count({
            where: {
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // (B) totalPurchases = total de compras no dia (Purchases)
        const totalPurchases = await Purchase.count({
            where: {
                purchasedAt: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // (C) taxa de conversão => totalPurchases / totalUsers
        const conversionRate = totalUsers > 0
            ? (totalPurchases / totalUsers) * 100
            : 0;

        //---------------------------------------------------------------
        // Estatísticas Detalhadas
        // - totalLeads = totalUsers
        // - pagamentosConfirmados = totalPurchases
        // - taxaConversao = conversionRate
        // - totalVendasGeradas = soma de planValue (purchase) no dia
        // - totalVendasConvertidas = igual a totalVendasGeradas, pois
        //   todas as Purchases nesse contexto são confirmadas.
        //---------------------------------------------------------------
        const totalLeads = totalUsers;
        const pagamentosConfirmados = totalPurchases;
        const taxaConversao = conversionRate;

        // totalVendasGeradas
        const totalVendasGeradas = await Purchase.sum('planValue', {
            where: {
                purchasedAt: {
                    [Op.between]: [startDate, endDate]
                }
            }
        }) || 0;

        // totalVendasConvertidas ( = totalVendasGeradas, pois se tá em Purchase é pago)
        const totalVendasConvertidas = totalVendasGeradas;

        //---------------------------------------------------------------
        // RANKING SIMPLES: contagem de VENDAS por botName
        //---------------------------------------------------------------
        const botRankingRaw = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'vendas']
            ],
            where: {
                purchasedAt: {
                    [Op.between]: [startDate, endDate]
                }
            },
            group: ['botName'],
            order: [[Sequelize.literal('"vendas"'), 'DESC']]
        });

        const botRanking = botRankingRaw.map(item => ({
            botName: item.botName,
            vendas: parseInt(item.getDataValue('vendas'), 10) || 0
        }));

        //---------------------------------------------------------------
        // RANKING DETALHADO
        //---------------------------------------------------------------
        // a) Purchases agrupadas por bot
        const botsWithPurchases = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalPurchases'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue']
            ],
            where: {
                purchasedAt: {
                    [Op.between]: [startDate, endDate]
                },
                botName: {
                    [Op.ne]: null
                }
            },
            group: ['botName']
        });

        // b) totalUsers (com lastInteraction) por bot (usando model User)
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

        // Monta map botName->totalUsers
        const botUsersMap = {};
        botsWithInteractions.forEach(item => {
            const bName = item.botName;
            const uCount = parseInt(item.getDataValue('totalUsers'), 10) || 0;
            botUsersMap[bName] = uCount;
        });

        // c) agrupar purchases por planName e botName
        const planSalesByBot = await Purchase.findAll({
            attributes: [
                'botName',
                'planName',
                [Sequelize.fn('COUNT', Sequelize.col('planName')), 'salesCount'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'sumValue']
            ],
            where: {
                purchasedAt: {
                    [Op.between]: [startDate, endDate]
                },
                planName: { [Op.ne]: null },
                botName: { [Op.ne]: null }
            },
            group: ['botName', 'planName'],
            order: [[Sequelize.literal('"salesCount"'), 'DESC']]
        });

        // Monta map { [botName]: { [planName]: { salesCount, totalValue } } }
        const botPlansMap = {};
        planSalesByBot.forEach(row => {
            const bName = row.botName;
            const pName = row.planName;
            const sCount = parseInt(row.getDataValue('salesCount'), 10) || 0;
            const tValue = parseFloat(row.getDataValue('sumValue')) || 0;

            if (!botPlansMap[bName]) botPlansMap[bName] = {};
            botPlansMap[bName][pName] = { salesCount: sCount, totalValue: tValue };
        });

        // d) Monta array final "botDetails"
        const botDetails = [];
        botsWithPurchases.forEach(bot => {
            const bName = bot.botName;
            const totalPurchasesBot = parseInt(bot.getDataValue('totalPurchases'), 10) || 0;
            const totalValueBot = parseFloat(bot.getDataValue('totalValue')) || 0;
            const totalUsersBot = botUsersMap[bName] || 0;

            const conversionRateBot = totalUsersBot > 0
                ? (totalPurchasesBot / totalUsersBot) * 100
                : 0;

            const averageValueBot = totalPurchasesBot > 0
                ? totalValueBot / totalPurchasesBot
                : 0;

            // Planos
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

            botDetails.push({
                botName: bName,
                valorGerado: totalValueBot,
                totalPurchases: totalPurchasesBot,
                totalUsers: totalUsersBot,
                conversionRate: conversionRateBot,
                averageValue: averageValueBot,
                plans: plansArray
            });
        });

        // Ordena desc por valorGerado
        botDetails.sort((a, b) => b.valorGerado - a.valorGerado);

        // Retorna ao front-end
        res.json({
            totalUsers,
            totalPurchases,
            conversionRate,

            totalLeads,
            pagamentosConfirmados,
            taxaConversao,
            totalVendasGeradas,
            totalVendasConvertidas,

            botRanking,
            botDetails
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

// Importa o bot (para rodar junto do Web)
require('./services/bot.service.js');

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor web iniciado na porta ${PORT}`);
});
