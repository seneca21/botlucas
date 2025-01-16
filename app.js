//------------------------------------------------------
// app.js
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { Op, Sequelize } = require('sequelize');
const db = require('./services/index');
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
 * Retorna um objeto de estatísticas do dia, filtrando por originCondition se quiser.
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {String} [originCondition] pode ser "main", "not_purchased", "purchased" ou null p/ tudo
 */
async function getDetailedStats(startDate, endDate, originCondition) {
    // Filtra purchases se originCondition != null
    const purchaseWhere = {
        purchasedAt: { [Op.between]: [startDate, endDate] },
    };
    if (originCondition) {
        purchaseWhere.originCondition = originCondition;
    }

    // totalUsers = contagem de users que interagiram
    //  se originCondition está definido, precisamos filtrar somente
    //  usuários que compraram nessa condition? ou que?
    // A pedido, "Leads" é sempre quem interagiu no dia. Mas se quisermos
    //  filtrar só leads que COMPRARAM nesse originCondition, é outra lógica.
    // Aqui, assumiremos que "Leads" = Users com lastInteraction no dia
    // e se originCondition != null, pegamos quem fez Purchase nessa condition.
    // => Ajustando ao pedido: "segunda, terceira e quarta colunas" só para
    //    quem de fato comprou nesse originCondition?
    // Se for para refletir "Leads" do main, "Leads" do upsell, etc. — não está
    //  muito claro. Vamos supor que a "coluna" signifique "só as compras".
    // para ficar coerente, vamos filtrar leads => user com lastInteraction E
    //  fez purchase com originCondition. Assim fica 100% "coluna" coerente.
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
        // statsAll => leads = todo user que lastInteraction no dia
        totalUsers = await User.count({
            where: {
                lastInteraction: { [Op.between]: [startDate, endDate] },
            },
        });
    } else {
        // statsX => leads = user que lastInteraction no dia E comprou nessa condition
        totalUsers = await User.count({
            where: {
                id: { [Op.in]: userIdsWithCondition },
                lastInteraction: { [Op.between]: [startDate, endDate] },
            },
        });
    }

    // totalPurchases
    const totalPurchases = await Purchase.count({ where: purchaseWhere });

    // conversionRate = totalPurchases / totalUsers * 100
    const conversionRate = totalUsers > 0 ? (totalPurchases / totalUsers) * 100 : 0;

    // totalVendasGeradas = soma planValue
    const totalVendasGeradas = await Purchase.sum('planValue', { where: purchaseWhere }) || 0;

    // totalVendasConvertidas = aqui é igual totalVendasGeradas (pois se está em Purchase, tá pago)
    const totalVendasConvertidas = totalVendasGeradas;

    return {
        totalUsers,
        totalPurchases,
        conversionRate,
        totalVendasGeradas,
        totalVendasConvertidas,
    };
}

// ROTA /api/bots-stats
app.get('/api/bots-stats', async (req, res) => {
    try {
        const { date } = req.query;
        const selectedDate = date ? new Date(date) : new Date();

        // Intervalo do dia
        const startDate = new Date(selectedDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(selectedDate);
        endDate.setHours(23, 59, 59, 999);

        // ---- statsAll (tudo)
        const statsAll = await getDetailedStats(startDate, endDate, null);
        // ---- statsMain
        const statsMain = await getDetailedStats(startDate, endDate, 'main');
        // ---- statsNotPurchased
        const statsNotPurchased = await getDetailedStats(startDate, endDate, 'not_purchased');
        // ---- statsPurchased
        const statsPurchased = await getDetailedStats(startDate, endDate, 'purchased');

        // RANKING SIMPLES (todos)
        const botRankingRaw = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'vendas'],
            ],
            where: {
                purchasedAt: {
                    [Op.between]: [startDate, endDate],
                },
            },
            group: ['botName'],
            order: [[Sequelize.literal('"vendas"'), 'DESC']],
        });
        const botRanking = botRankingRaw.map((item) => ({
            botName: item.botName,
            vendas: parseInt(item.getDataValue('vendas'), 10) || 0,
        }));

        // RANKING DETALHADO (todos)
        // (mesma lógica anterior que você já tinha)
        const botsWithPurchases = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalPurchases'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue'],
            ],
            where: {
                purchasedAt: {
                    [Op.between]: [startDate, endDate],
                },
                botName: {
                    [Op.ne]: null,
                },
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
                lastInteraction: {
                    [Op.between]: [startDate, endDate],
                },
                botName: {
                    [Op.ne]: null,
                },
            },
            group: ['botName'],
        });

        const botUsersMap = {};
        botsWithInteractions.forEach((item) => {
            const bName = item.botName;
            const uCount = parseInt(item.getDataValue('totalUsers'), 10) || 0;
            botUsersMap[bName] = uCount;
        });

        // agrupar purchases por planName e botName
        const planSalesByBot = await Purchase.findAll({
            attributes: [
                'botName',
                'planName',
                [Sequelize.fn('COUNT', Sequelize.col('planName')), 'salesCount'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'sumValue'],
            ],
            where: {
                purchasedAt: {
                    [Op.between]: [startDate, endDate],
                },
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
            const totalValueBot = parseFloat(bot.getDataValue('totalValue')) || 0;
            const totalUsersBot = botUsersMap[bName] || 0;

            const conversionRateBot =
                totalUsersBot > 0 ? (totalPurchasesBot / totalUsersBot) * 100 : 0;
            const averageValueBot =
                totalPurchasesBot > 0 ? totalValueBot / totalPurchasesBot : 0;

            const plansObj = botPlansMap[bName] || {};
            const plansArray = [];
            for (const [planName, info] of Object.entries(plansObj)) {
                const planConversionRate =
                    totalUsersBot > 0 ? (info.salesCount / totalUsersBot) * 100 : 0;
                plansArray.push({
                    planName,
                    salesCount: info.salesCount,
                    conversionRate: planConversionRate,
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

        // Responde:
        res.json({
            // estatísticas do dia (quatro blocos)
            statsAll,
            statsMain,
            statsNotPurchased,
            statsPurchased,

            // ranking
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
