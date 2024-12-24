// Dentro do seu app.js (ou onde você faz as rotas)

const express = require('express');
const path = require('path');
const { Op, Sequelize } = require('sequelize');
const bodyParser = require('body-parser');
const sequelize = require('./db'); // Instância do Sequelize configurado
const UserModel = require('./models/User');

// Inicializa o modelo User com a instância
const User = UserModel(sequelize);

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Testa conexão e sincroniza (opcional, se já faz em outro lugar)
sequelize.authenticate()
    .then(() => console.log('✅ Conexão com o DB estabelecida.'))
    .catch(err => console.error('❌ Erro ao conectar DB:', err));

sequelize.sync({ alter: true })
    .then(() => console.log('✅ Modelos sincronizados (alter).'))
    .catch(err => console.error('❌ Erro ao sincronizar modelos:', err));

// ------------------------------------------------------
// ROTA PRINCIPAL (ENVIA O INDEX.HTML do dashboard)
// ------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ------------------------------------------------------
// ROTA /api/bots-stats -> retorna dados para o Dashboard
// ------------------------------------------------------
app.get('/api/bots-stats', async (req, res) => {
    try {
        // 1) Pega a data do query param (ou hoje)
        const { date } = req.query;
        const selectedDate = date ? new Date(date) : new Date();

        // Ajusta início e fim do dia
        const startDate = new Date(selectedDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(selectedDate);
        endDate.setHours(23, 59, 59, 999);

        // -----------------------------------------------------
        // 2) totalUsers = usuários que geraram Pix (interagiram) no dia
        //    - interpretando "geraram Pix" como lastInteraction no dia
        // -----------------------------------------------------
        const totalUsers = await User.count({
            where: {
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // -----------------------------------------------------
        // 3) totalPurchases = quantos compraram nesse dia
        //    - assumindo que "hasPurchased = true" e lastInteraction no dia
        // -----------------------------------------------------
        const totalPurchases = await User.count({
            where: {
                hasPurchased: true,
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // -----------------------------------------------------
        // 4) Conversão = totalPurchases / totalUsers * 100
        // -----------------------------------------------------
        const conversionRate = totalUsers > 0
            ? (totalPurchases / totalUsers) * 100
            : 0;

        // -----------------------------------------------------
        // 5) DETALHES POR BOT - agrupar para saber quantas compras e soma de planValue
        //    - Agrupa por botName
        //    - Filtra hasPurchased = true
        // -----------------------------------------------------
        const botsWithPurchases = await User.findAll({
            attributes: [
                'botName',
                // quantas compras por bot
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalPurchases'],
                // soma do planValue
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue']
            ],
            where: {
                hasPurchased: true,
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                },
                botName: {
                    [Op.ne]: null // ignora se botName for null
                }
            },
            group: ['botName']
            // order: ... se quiser ordenar
        });

        // -----------------------------------------------------
        // 6) totalUsers por Bot -> pra calcular conversão por Bot
        //    - agrupa por botName, filtrando lastInteraction no dia
        // -----------------------------------------------------
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

        // Monta um MAP de botName -> totalUsers
        const botUsersMap = {};
        botsWithInteractions.forEach(item => {
            const bName = item.botName;
            const count = parseInt(item.getDataValue('totalUsers'), 10) || 0;
            botUsersMap[bName] = count;
        });

        // -----------------------------------------------------
        // 7) Vendas por PLANO e por BOT, para detalhar "Planos (Vendas e Conversão %)"
        // -----------------------------------------------------
        const planSalesByBot = await User.findAll({
            attributes: [
                'botName',
                'planName',
                // quantas vendas nesse plano
                [Sequelize.fn('COUNT', Sequelize.col('planName')), 'salesCount'],
                // soma do planValue
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

        // Monta MAP: botName -> { [planName]: { salesCount, totalValue } }
        const botPlansMap = {};
        planSalesByBot.forEach(row => {
            const bName = row.botName;
            const pName = row.planName;
            const sCount = parseInt(row.getDataValue('salesCount'), 10) || 0;
            const tValue = parseFloat(row.getDataValue('totalValue')) || 0;
            if (!botPlansMap[bName]) botPlansMap[bName] = {};
            botPlansMap[bName][pName] = { salesCount: sCount, totalValue: tValue };
        });

        // -----------------------------------------------------
        // 8) Monta array final "botDetails" => Ranking de Bots Detalhado
        // -----------------------------------------------------
        const botDetails = [];
        botsWithPurchases.forEach(row => {
            const bName = row.botName;
            const totalPurchasesBot = parseInt(row.getDataValue('totalPurchases'), 10) || 0;
            const totalValueBot = parseFloat(row.getDataValue('totalValue')) || 0;

            // totalUsers que interagiram nesse bot
            const totalUsersBot = botUsersMap[bName] || 0;

            // Conversão do Bot
            const conversionRateBot = totalUsersBot > 0
                ? (totalPurchasesBot / totalUsersBot) * 100
                : 0;

            // Valor médio
            const averageValueBot = totalPurchasesBot > 0
                ? totalValueBot / totalPurchasesBot
                : 0;

            // Pega os planos pra esse Bot
            const planInfo = [];
            const plansObj = botPlansMap[bName] || {};

            for (const [planName, info] of Object.entries(plansObj)) {
                const planConvRate = totalUsersBot > 0
                    ? (info.salesCount / totalUsersBot) * 100
                    : 0;
                planInfo.push({
                    planName,
                    salesCount: info.salesCount,
                    conversionRate: planConvRate
                });
            }

            botDetails.push({
                botName: bName,
                valorGerado: totalValueBot,            // Total do Valor Convertido
                totalPurchases: totalPurchasesBot,     // Vendas Convertidas
                totalUsers: totalUsersBot,             // Usuários que interagiram com esse Bot
                conversionRate: conversionRateBot,     // Taxa de Conversão do Bot
                averageValue: averageValueBot,         // Valor Médio por Compra
                plans: planInfo                        // Array com {planName, salesCount, conversionRate}
            });
        });

        // (Opcional) Ordena desc por "valorGerado"
        botDetails.sort((a, b) => b.valorGerado - a.valorGerado);

        // Retorna JSON
        return res.json({
            totalUsers,
            totalPurchases,
            conversionRate,
            botDetails
        });

    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        return res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

// ------------------------------------------------------
// SOBE O SERVIDOR
// ------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor web iniciado na porta ${PORT}`);
});
