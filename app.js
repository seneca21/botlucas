//------------------------------------------------------
// app.js
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { Op, Sequelize } = require('sequelize');

// Instância Sequelize (db.js configurado)
const sequelize = require('./db');

// Model User (já contendo botName, planName, planValue etc.)
const UserModel = require('./models/User');
const User = UserModel(sequelize);

// Inicializa Express
const app = express();

// Middlewares
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Teste e sincroniza DB (opcional)
sequelize.authenticate()
    .then(() => console.log('✅ Conexão com o DB estabelecida.'))
    .catch(err => console.error('❌ Erro ao conectar DB:', err));

sequelize.sync({ alter: true })
    .then(() => console.log('✅ Modelos sincronizados (alter).'))
    .catch(err => console.error('❌ Erro ao sincronizar modelos:', err));

//------------------------------------------------------
// ROTA PRINCIPAL -> envia o 'index.html' do dashboard
//------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//------------------------------------------------------
// ROTA /api/bots-stats -> retorna dados para o dashboard
//------------------------------------------------------
app.get('/api/bots-stats', async (req, res) => {
    try {
        const { date } = req.query;
        const selectedDate = date ? new Date(date) : new Date();

        // Define início/fim do dia
        const startDate = new Date(selectedDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(selectedDate);
        endDate.setHours(23, 59, 59, 999);

        // 1) totalUsers: usuários com lastInteraction no dia
        const totalUsers = await User.count({
            where: {
                lastInteraction: { [Op.between]: [startDate, endDate] }
            }
        });

        // 2) totalPurchases: usuários (hasPurchased=true) no dia
        const totalPurchases = await User.count({
            where: {
                hasPurchased: true,
                lastInteraction: { [Op.between]: [startDate, endDate] }
            }
        });

        // 3) Taxa de conversão
        const conversionRate = totalUsers > 0
            ? (totalPurchases / totalUsers) * 100
            : 0;

        // ----------------------------------------------------
        // RANKING SIMPLES: botName x quantidade de vendas
        // ----------------------------------------------------
        const botRankingRaw = await User.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'vendas']
            ],
            where: {
                hasPurchased: true,
                lastInteraction: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null }
            },
            group: ['botName'],
            order: [[Sequelize.literal('"vendas"'), 'DESC']]
        });
        const botRanking = botRankingRaw.map(item => ({
            botName: item.botName,
            vendas: parseInt(item.getDataValue('vendas'), 10) || 0
        }));

        // ----------------------------------------------------
        // RANKING DETALHADO (botDetails)
        // ----------------------------------------------------
        // a) Traz contagem e soma de planValue por bot
        const botsWithPurchases = await User.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalPurchases'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue']
            ],
            where: {
                hasPurchased: true,
                lastInteraction: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null }
            },
            group: ['botName']
        });

        // b) totalUsers por bot
        const botsWithInteractions = await User.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalUsers']
            ],
            where: {
                lastInteraction: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null }
            },
            group: ['botName']
        });

        // Mapa (botName -> totalUsers)
        const botUsersMap = {};
        botsWithInteractions.forEach(item => {
            const bName = item.botName;
            const uCount = parseInt(item.getDataValue('totalUsers'), 10) || 0;
            botUsersMap[bName] = uCount;
        });

        // c) Vendas por planoName e por bot
        const planSalesByBot = await User.findAll({
            attributes: [
                'botName',
                'planName',
                [Sequelize.fn('COUNT', Sequelize.col('planName')), 'salesCount'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue']
            ],
            where: {
                hasPurchased: true,
                lastInteraction: { [Op.between]: [startDate, endDate] },
                planName: { [Op.ne]: null },
                botName: { [Op.ne]: null }
            },
            group: ['botName', 'planName'],
            order: [[Sequelize.literal('"salesCount"'), 'DESC']]
        });

        // Monta map: { botName: { planName: { salesCount, totalValue } } }
        const botPlansMap = {};
        planSalesByBot.forEach(row => {
            const bName = row.botName;
            const pName = row.planName;
            const sCount = parseInt(row.getDataValue('salesCount'), 10) || 0;
            const tValue = parseFloat(row.getDataValue('totalValue')) || 0;
            if (!botPlansMap[bName]) botPlansMap[bName] = {};
            botPlansMap[bName][pName] = { salesCount: sCount, totalValue: tValue };
        });

        // d) Array final "botDetails" c/ conversão, planos etc.
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

            // Pega os planos do bot
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

        // Ordena desc por valorGerado, se quiser
        botDetails.sort((a, b) => b.valorGerado - a.valorGerado);

        // SUPOSTO: Caso precise mandar também "totalLeads", "pagamentosConfirmados" etc.
        // Aqui é só exemplo. Adapte a lógica real:
        const totalLeads = totalUsers; // Exemplo: ou outra métrica de "pessoas que deram start"
        const pagamentosConfirmados = totalPurchases;
        const taxaConversao = conversionRate; // etc.
        const totalVendasGeradas = 500; // Exemplo fixo, troque por uma soma real
        const totalVendasConvertidas = 300; // idem

        // Retorna JSON ao frontend
        res.json({
            // Estatísticas simples
            totalUsers,
            totalPurchases,
            conversionRate,

            // Ranking simples
            botRanking,

            // Ranking detalhado
            botDetails,

            // Estatísticas do Dia Detalhado (exemplo)
            totalLeads,
            pagamentosConfirmados,
            taxaConversao,
            totalVendasGeradas,
            totalVendasConvertidas,
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

// Importa e executa o bot (services/bot.service.js)
require('./services/bot.service.js');

// Sobe servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor web iniciado na porta ${PORT}`);
});
