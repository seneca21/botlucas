//------------------------------------------------------
// app.js
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { Op, Sequelize } = require('sequelize');
const db = require('./services/index'); // Index do Sequelize
const User = db.User;
const Purchase = db.Purchase;

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Testa conexão
db.sequelize
    .authenticate()
    .then(() => console.log('✅ Conexão com DB estabelecida.'))
    .catch((err) => console.error('❌ Erro ao conectar DB:', err));

// Sync
db.sequelize
    .sync({ alter: true })
    .then(() => console.log('✅ Modelos sincronizados (alter).'))
    .catch((err) => console.error('❌ Erro ao sincronizar modelos:', err));

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Função para obter estatísticas de um intervalo
 */
async function getDetailedStats(startDate, endDate, originCondition) {
    const { User, Purchase } = db;

    const purchaseWhere = {
        purchasedAt: { [Op.between]: [startDate, endDate] },
    };
    if (originCondition) {
        purchaseWhere.originCondition = originCondition;
    }

    // leads
    let userIdsWithCondition = [];
    if (originCondition) {
        const condPurchases = await Purchase.findAll({
            attributes: ['userId'],
            where: purchaseWhere,
            group: ['userId'],
        });
        userIdsWithCondition = condPurchases.map((p) => p.userId);
    }

    let totalUsers;
    if (!originCondition) {
        // statsAll => leads = user que interagiu no dia
        totalUsers = await User.count({
            where: {
                lastInteraction: { [Op.between]: [startDate, endDate] },
            },
        });
    } else {
        // statsX => leads = user que comprou nessa condition + interagiu
        totalUsers = await User.count({
            where: {
                id: { [Op.in]: userIdsWithCondition },
                lastInteraction: { [Op.between]: [startDate, endDate] },
            },
        });
    }

    // totalPurchases
    const totalPurchases = await Purchase.count({ where: purchaseWhere });

    // conversionRate
    const conversionRate = totalUsers > 0 ? (totalPurchases / totalUsers) * 100 : 0;

    // totalVendasGeradas
    const totalVendasGeradas =
        (await Purchase.sum('planValue', { where: purchaseWhere })) || 0;

    // totalVendasConvertidas (se está em Purchase, está pago)
    const totalVendasConvertidas = totalVendasGeradas;

    return {
        totalUsers,
        totalPurchases,
        conversionRate,
        totalVendasGeradas,
        totalVendasConvertidas,
    };
}

/**
 * Helper: retorna data "zerada" (00:00)
 */
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

// ROTA /api/bots-stats
app.get('/api/bots-stats', async (req, res) => {
    try {
        const { date } = req.query;
        const selectedDate = date ? new Date(date) : new Date();

        // Dia atual
        const startDate = makeDay(selectedDate);
        const endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);

        // Dia anterior
        const yesterday = new Date(startDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const startYesterday = makeDay(yesterday);
        const endYesterday = new Date(startYesterday);
        endYesterday.setHours(23, 59, 59, 999);

        // statsAll (Hoje)
        const statsAll = await getDetailedStats(startDate, endDate, null);
        // statsYesterday (Ontem)
        const statsYesterday = await getDetailedStats(startYesterday, endYesterday, null);

        // statsMain, statsNotPurchased, statsPurchased
        const statsMain = await getDetailedStats(startDate, endDate, 'main');
        const statsNotPurchased = await getDetailedStats(startDate, endDate, 'not_purchased');
        const statsPurchased = await getDetailedStats(startDate, endDate, 'purchased');

        // Ranking simples
        const botRankingRaw = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'vendas'],
            ],
            where: {
                purchasedAt: { [Op.between]: [startDate, endDate] },
            },
            group: ['botName'],
            order: [[Sequelize.literal('"vendas"'), 'DESC']],
        });
        const botRanking = botRankingRaw.map((item) => ({
            botName: item.botName,
            vendas: parseInt(item.getDataValue('vendas'), 10) || 0,
        }));

        // Ranking detalhado
        const botsWithPurchases = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalPurchases'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue'],
            ],
            where: {
                purchasedAt: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null },
            },
            group: ['botName'],
        });

        // totalUsers por bot
        const botsWithInteractions = await User.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalUsers'],
            ],
            where: {
                lastInteraction: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null },
            },
            group: ['botName'],
        });
        const botUsersMap = {};
        botsWithInteractions.forEach((item) => {
            const bName = item.botName;
            const uCount = parseInt(item.getDataValue('totalUsers'), 10) || 0;
            botUsersMap[bName] = uCount;
        });

        // planSalesByBot
        const planSalesByBot = await Purchase.findAll({
            attributes: [
                'botName',
                'planName',
                [Sequelize.fn('COUNT', Sequelize.col('planName')), 'salesCount'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'sumValue'],
            ],
            where: {
                purchasedAt: { [Op.between]: [startDate, endDate] },
                planName: { [Op.ne]: null },
                botName: { [Op.ne]: null },
            },
            group: ['botName', 'planName'],
            order: [[Sequelize.literal('"salesCount"'), 'DESC']],
        });
        const botPlansMap = {};
        planSalesByBot.forEach((row) => {
            const bName = row.botName;
            const pName = row.planName;
            const sCount = parseInt(row.getDataValue('salesCount'), 10) || 0;
            const tValue = parseFloat(row.getDataValue('sumValue')) || 0;
            if (!botPlansMap[bName]) botPlansMap[bName] = {};
            botPlansMap[bName][pName] = { salesCount: sCount, totalValue: tValue };
        });

        const botDetails = [];
        botsWithPurchases.forEach((bot) => {
            const bName = bot.botName;
            const totalPurchasesBot =
                parseInt(bot.getDataValue('totalPurchases'), 10) || 0;
            const totalValueBot =
                parseFloat(bot.getDataValue('totalValue')) || 0;
            const totalUsersBot = botUsersMap[bName] || 0;
            const conversionRateBot =
                totalUsersBot > 0 ? (totalPurchasesBot / totalUsersBot) * 100 : 0;
            const averageValueBot =
                totalPurchasesBot > 0 ? totalValueBot / totalPurchasesBot : 0;

            const plansObj = botPlansMap[bName] || {};
            const plansArray = [];
            for (const [planName, info] of Object.entries(plansObj)) {
                const planConvRate =
                    totalUsersBot > 0 ? (info.salesCount / totalUsersBot) * 100 : 0;
                plansArray.push({
                    planName,
                    salesCount: info.salesCount,
                    conversionRate: planConvRate,
                });
            }

            botDetails.push({
                botName: bName,
                valorGerado: totalValueBot,
                totalPurchases: totalPurchasesBot,
                totalUsers: totalUsersBot,
                conversionRate: conversionRateBot,
                averageValue: averageValueBot,
                plans: plansArray,
            });
        });
        botDetails.sort((a, b) => b.valorGerado - a.valorGerado);

        // Responde
        res.json({
            statsAll,        // Dia atual
            statsYesterday,  // Dia anterior
            statsMain,
            statsNotPurchased,
            statsPurchased,
            botRanking,
            botDetails,
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

// Importa o bot
require('./services/bot.service.js');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor web iniciado na porta ${PORT}`);
});
