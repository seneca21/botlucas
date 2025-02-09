//------------------------------------------------------
// app.js
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Op, Sequelize } = require('sequelize');

const db = require('./services/index'); // Index do Sequelize
const User = db.User;
const Purchase = db.Purchase;

const logger = require('./services/logger');
const ConfigService = require('./services/config.service');
const config = ConfigService.loadConfig();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Sessão
app.use(session({
    secret: 'chave-super-secreta',
    resave: false,
    saveUninitialized: false
}));

function checkAuth(req, res, next) {
    if (req.session.loggedIn) {
        next();
    } else {
        res.redirect('/login');
    }
}

//------------------------------------------------------
// Conecta DB
//------------------------------------------------------
db.sequelize
    .authenticate()
    .then(() => logger.info('✅ Conexão com DB estabelecida.'))
    .catch((err) => logger.error('❌ Erro ao conectar DB:', err));

db.sequelize
    .sync({ alter: true })
    .then(() => logger.info('✅ Modelos sincronizados (alter).'))
    .catch((err) => logger.error('❌ Erro ao sincronizar modelos:', err));

//------------------------------------------------------
// Rotas Login/Logout
//------------------------------------------------------
app.get('/login', (req, res) => {
    if (req.session.loggedIn) {
        return res.redirect('/');
    }
    const html = `
    <html>
      <head><title>Login</title></head>
      <body>
        <h1>Login</h1>
        <form method="POST" action="/login">
          <label>Usuário:</label>
          <input type="text" name="username" /><br/><br/>
          <label>Senha:</label>
          <input type="password" name="password" /><br/><br/>
          <button type="submit">Entrar</button>
        </form>
      </body>
    </html>
  `;
    res.send(html);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = 'pfjru';
    const ADMIN_PASS = 'oppushin1234';

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.loggedIn = true;
        logger.info(`✅ Usuário ${username} logou com sucesso.`);
        return res.redirect('/');
    } else {
        logger.warn(`❌ Tentativa de login inválida com usuário: ${username}`);
        return res.send('Credenciais inválidas. <a href="/login">Tentar novamente</a>');
    }
});

app.get('/logout', (req, res) => {
    const username = req.session.loggedIn ? 'Admin' : 'Desconhecido';
    req.session.destroy(() => {
        logger.info(`✅ Usuário ${username} deslogou.`);
        res.send('Você saiu! <a href="/login">Fazer login novamente</a>');
    });
});

//------------------------------------------------------
// Rota principal -> index.html
//------------------------------------------------------
app.get('/', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(checkAuth, express.static(path.join(__dirname, 'public')));

//------------------------------------------------------
// /api/bots-list => retorna array de nomes
//------------------------------------------------------
app.get('/api/bots-list', checkAuth, (req, res) => {
    try {
        const botNames = config.bots.map(b => b.name);
        res.json(botNames);
    } catch (err) {
        logger.error('Erro /api/bots-list:', err);
        res.status(500).json({ error: 'Erro ao retornar lista de bots' });
    }
});

//------------------------------------------------------
// Helpers
//------------------------------------------------------
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

async function getDetailedStats(startDate, endDate, originCondition, botFilterArray) {
    // botFilterArray é array de bots ou vazio (se nenhum).
    // Se botFilterArray for vazio => "ver todos"
    const purchaseWhere = {
        purchasedAt: { [Op.between]: [startDate, endDate] }
    };
    if (originCondition) {
        purchaseWhere.originCondition = originCondition;
    }
    if (botFilterArray && botFilterArray.length > 0) {
        purchaseWhere.botName = { [Op.in]: botFilterArray };
    }

    const userWhere = {
        lastInteraction: { [Op.between]: [startDate, endDate] }
    };
    if (botFilterArray && botFilterArray.length > 0) {
        userWhere.botName = { [Op.in]: botFilterArray };
    }

    const totalPurchases = await Purchase.count({ where: purchaseWhere });
    const totalUsers = await User.count({ where: userWhere });
    const conversionRate = totalUsers > 0 ? (totalPurchases / totalUsers) * 100 : 0;

    // Valor gerado x convertido
    const generatedWhere = {
        pixGeneratedAt: { [Op.between]: [startDate, endDate] },
        status: { [Op.in]: ['pending', 'paid'] },
        ...(originCondition ? { originCondition } : {})
    };
    if (botFilterArray && botFilterArray.length > 0) {
        generatedWhere.botName = { [Op.in]: botFilterArray };
    }

    const convertedWhere = {
        purchasedAt: { [Op.between]: [startDate, endDate] },
        status: 'paid',
        ...(originCondition ? { originCondition } : {})
    };
    if (botFilterArray && botFilterArray.length > 0) {
        convertedWhere.botName = { [Op.in]: botFilterArray };
    }

    const sumGerado = (await Purchase.sum('planValue', { where: generatedWhere })) || 0;
    const sumConvertido = (await Purchase.sum('planValue', { where: convertedWhere })) || 0;

    // Tempo médio de pagamento
    const paidPurchases = await Purchase.findAll({
        where: {
            status: 'paid',
            purchasedAt: { [Op.between]: [startDate, endDate] },
            ...(originCondition ? { originCondition } : {}),
            ...(botFilterArray && botFilterArray.length > 0 ? { botName: { [Op.in]: botFilterArray } } : {})
        },
        attributes: ['pixGeneratedAt', 'purchasedAt']
    });

    let sumDiffMs = 0;
    let countPaid = 0;
    for (const p of paidPurchases) {
        if (p.pixGeneratedAt && p.purchasedAt) {
            const diff = p.purchasedAt.getTime() - p.pixGeneratedAt.getTime();
            if (diff >= 0) {
                sumDiffMs += diff;
                countPaid++;
            }
        }
    }
    let averagePaymentDelayMs = 0;
    if (countPaid > 0) {
        averagePaymentDelayMs = Math.round(sumDiffMs / countPaid);
    }

    return {
        totalUsers,
        totalPurchases,
        conversionRate,
        totalVendasGeradas: sumGerado,
        totalVendasConvertidas: sumConvertido,
        averagePaymentDelayMs
    };
}

//------------------------------------------------------
// GET /api/bots-stats
//------------------------------------------------------
app.get('/api/bots-stats', checkAuth, async (req, res) => {
    try {
        const { date, movStatus } = req.query;
        let botFilter = req.query.botFilter || '';
        // Ex: botFilter = "@BotUm,@BotDois"

        // Converte para array, ignorando vazios
        let botFilterArray = [];
        if (botFilter.trim() !== '') {
            botFilterArray = botFilter.split(',').map(s => s.trim()).filter(Boolean);
        }
        // Se ficar vazio => ver todos

        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const offset = (page - 1) * perPage;

        const selectedDate = date ? new Date(date) : new Date();
        const startDate = makeDay(selectedDate);
        const endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);

        // Stats
        const statsAll = await getDetailedStats(startDate, endDate, null, botFilterArray);
        const yesterday = new Date(startDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const startYesterday = makeDay(yesterday);
        const endYesterday = new Date(startYesterday);
        endYesterday.setHours(23, 59, 59, 999);
        const statsYesterday = await getDetailedStats(startYesterday, endYesterday, null, botFilterArray);

        const statsMain = await getDetailedStats(startDate, endDate, 'main', botFilterArray);
        const statsNotPurchased = await getDetailedStats(startDate, endDate, 'not_purchased', botFilterArray);
        const statsPurchased = await getDetailedStats(startDate, endDate, 'purchased', botFilterArray);

        // Ranking (global, sem filtrar bots)
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

        // Ranking Detalhado (global)
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
            const totalPurchasesBot = parseInt(bot.getDataValue('totalPurchases'), 10) || 0;
            const totalValueBot = parseFloat(bot.getDataValue('totalValue')) || 0;
            const totalUsersBot = botUsersMap[bName] || 0;
            const conversionRateBot = totalUsersBot > 0 ? (totalPurchasesBot / totalUsersBot) * 100 : 0;
            const averageValueBot = totalPurchasesBot > 0 ? totalValueBot / totalPurchasesBot : 0;

            const plansObj = botPlansMap[bName] || {};
            const plansArray = [];
            for (const [planName, info] of Object.entries(plansObj)) {
                const planConvRate = totalUsersBot > 0 ? (info.salesCount / totalUsersBot) * 100 : 0;
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

        // 7 dias
        const stats7Days = [];
        for (let i = 6; i >= 0; i--) {
            const tempDate = new Date(startDate);
            tempDate.setDate(tempDate.getDate() - i);
            const dayStart = makeDay(tempDate);
            const dayEnd = new Date(dayStart);
            dayEnd.setHours(23, 59, 59, 999);

            const dayStat = await getDetailedStats(dayStart, dayEnd, null, botFilterArray);
            stats7Days.push({
                date: dayStart.toISOString().split('T')[0],
                totalVendasConvertidas: dayStat.totalVendasConvertidas,
                totalVendasGeradas: dayStat.totalVendasGeradas
            });
        }

        // Movimentações + paginação
        const lastMovementsWhere = {
            pixGeneratedAt: { [Op.between]: [startDate, endDate] }
        };
        if (movStatus === 'pending') {
            lastMovementsWhere.status = 'pending';
        } else if (movStatus === 'paid') {
            lastMovementsWhere.status = 'paid';
        }
        if (botFilterArray && botFilterArray.length > 0) {
            lastMovementsWhere.botName = { [Op.in]: botFilterArray };
        }

        const { rows: lastMovements, count: totalMovements } = await Purchase.findAndCountAll({
            attributes: ['pixGeneratedAt', 'purchasedAt', 'planValue', 'status'],
            where: lastMovementsWhere,
            order: [['pixGeneratedAt', 'DESC']],
            limit: perPage,
            offset,
            include: [
                {
                    model: User,
                    attributes: ['telegramId']
                }
            ]
        });

        res.json({
            statsAll,
            statsYesterday,
            statsMain,
            statsNotPurchased,
            statsPurchased,
            botRanking,
            botDetails,
            stats7Days,
            lastMovements,
            totalMovements
        });
    } catch (error) {
        logger.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

// Inicia bot
require('./services/bot.service.js');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});
