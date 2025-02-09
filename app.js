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

// MIDDLEWARE: Checa IP
function checkIP(req, res, next) {
    const allowedIPs = [
        "189.29.145.193",
        "54.175.230.252",
        "54.173.229.200",
        "193.186.4.241"
    ];

    const forwarded = req.headers['x-forwarded-for'];
    let clientIp = forwarded
        ? forwarded.split(',')[0].trim()
        : req.ip;

    clientIp = clientIp.replace('::ffff:', '');
    if (allowedIPs.includes(clientIp)) {
        next();
    } else {
        logger.warn(`IP Bloqueado: ${clientIp}`);
        return res.status(403).send("Acesso negado. Seu IP não está na whitelist.");
    }
}

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// SESSÃO
app.use(session({
    secret: 'chave-super-secreta',
    resave: false,
    saveUninitialized: false
}));

// MIDDLEWARE: Checa se usuário está logado
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
// Rotas de LOGIN / LOGOUT
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
app.get('/', checkAuth, checkIP, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servimos a pasta public também com checkAuth e checkIP
app.use(checkAuth, checkIP, express.static(path.join(__dirname, 'public')));

//------------------------------------------------------
// FUNÇÕES DE ESTATÍSTICAS AUXILIARES
//------------------------------------------------------
/**
 * getDetailedStats
 * @param {Date} startDate 
 * @param {Date} endDate 
 * @param {string|null} originCondition (ex: 'main', 'purchased'...) ou null
 * @param {string[]|null} botNames (ex: ['@Senecagay_bot'] ou null p/ todos)
 */
async function getDetailedStats(startDate, endDate, originCondition, botNames) {
    // Monta where para Purchase
    const purchaseWhere = {};
    purchaseWhere[Op.and] = [
        { purchasedAt: { [Op.between]: [startDate, endDate] } }
    ];
    if (originCondition) {
        purchaseWhere[Op.and].push({ originCondition });
    }
    if (botNames && botNames.length > 0) {
        purchaseWhere[Op.and].push({ botName: { [Op.in]: botNames } });
    }

    // Para saber que users, caso originCondition != null
    let userIdsWithCondition = [];
    if (originCondition) {
        const condPurchases = await Purchase.findAll({
            attributes: ['userId'],
            where: purchaseWhere,
            group: ['userId'],
        });
        userIdsWithCondition = condPurchases.map((p) => p.userId);
    }

    // Monta where para User (para contar totalUsers)
    const userWhere = {};
    userWhere[Op.and] = [
        { lastInteraction: { [Op.between]: [startDate, endDate] } }
    ];
    if (botNames && botNames.length > 0) {
        userWhere[Op.and].push({ botName: { [Op.in]: botNames } });
    }
    if (originCondition) {
        // Filtrar somente os users que apareceram no condPurchases
        userWhere[Op.and].push({ id: { [Op.in]: userIdsWithCondition } });
    }

    // Contagem de usuários
    const totalUsers = await User.count({ where: userWhere });

    // Compras + taxa de conversão
    const totalPurchases = await Purchase.count({ where: purchaseWhere });
    const conversionRate = totalUsers > 0 ? (totalPurchases / totalUsers) * 100 : 0;

    // Valor gerado x convertido
    const generatedWhere = {
        [Op.and]: [
            { pixGeneratedAt: { [Op.between]: [startDate, endDate] } },
            { status: { [Op.in]: ['pending', 'paid'] } },
        ]
    };
    if (originCondition) {
        generatedWhere[Op.and].push({ originCondition });
    }
    if (botNames && botNames.length > 0) {
        generatedWhere[Op.and].push({ botName: { [Op.in]: botNames } });
    }

    const sumGerado = (await Purchase.sum('planValue', { where: generatedWhere })) || 0;

    const convertedWhere = {
        [Op.and]: [
            { purchasedAt: { [Op.between]: [startDate, endDate] } },
            { status: 'paid' },
        ]
    };
    if (originCondition) {
        convertedWhere[Op.and].push({ originCondition });
    }
    if (botNames && botNames.length > 0) {
        convertedWhere[Op.and].push({ botName: { [Op.in]: botNames } });
    }
    const sumConvertido = (await Purchase.sum('planValue', { where: convertedWhere })) || 0;

    // Tempo médio de pagamento (para paid)
    const paidWhere = {
        [Op.and]: [
            { status: 'paid' },
            { purchasedAt: { [Op.between]: [startDate, endDate] } }
        ]
    };
    if (originCondition) {
        paidWhere[Op.and].push({ originCondition });
    }
    if (botNames && botNames.length > 0) {
        paidWhere[Op.and].push({ botName: { [Op.in]: botNames } });
    }
    const paidPurchases = await Purchase.findAll({
        where: paidWhere,
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

function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

//------------------------------------------------------
// /api/bots-stats
//------------------------------------------------------
app.get('/api/bots-stats', checkAuth, checkIP, async (req, res) => {
    try {
        // Query params
        const { date, movStatus } = req.query;

        // Paginação (ultimas movs)
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const offset = (page - 1) * perPage;

        // Filtro de bots
        // Ex: &bots=@Bot1,@Bot2 => selectedBots = ['@Bot1','@Bot2']
        // ou se vier vazio ou "all", então consideramos "nenhum filtro"
        let selectedBots = null;
        if (req.query.bots) {
            // Se for "all", ignora. Se for "bot1,bot2", split
            const splitted = req.query.bots.split(',');
            if (!splitted.includes('all')) {
                selectedBots = splitted;
            }
        }

        const selectedDate = date ? new Date(date) : new Date();
        const startDate = makeDay(selectedDate);
        const endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);

        // statsAll
        const statsAll = await getDetailedStats(startDate, endDate, null, selectedBots);

        // statsYesterday
        const yesterday = new Date(startDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const startYesterday = makeDay(yesterday);
        const endYesterday = new Date(startYesterday);
        endYesterday.setHours(23, 59, 59, 999);
        const statsYesterday = await getDetailedStats(startYesterday, endYesterday, null, selectedBots);

        // statsMain, statsNotPurchased, statsPurchased
        const statsMain = await getDetailedStats(startDate, endDate, 'main', selectedBots);
        const statsNotPurchased = await getDetailedStats(startDate, endDate, 'not_purchased', selectedBots);
        const statsPurchased = await getDetailedStats(startDate, endDate, 'purchased', selectedBots);

        // Ranking simples (compras pagas no dia)
        const rankingWhere = {
            [Op.and]: [
                { purchasedAt: { [Op.between]: [startDate, endDate] } },
            ]
        };
        if (selectedBots && selectedBots.length > 0) {
            rankingWhere[Op.and].push({ botName: { [Op.in]: selectedBots } });
        }

        const botRankingRaw = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'vendas'],
            ],
            where: rankingWhere,
            group: ['botName'],
            order: [[Sequelize.literal('"vendas"'), 'DESC']],
        });
        const botRanking = botRankingRaw.map((item) => ({
            botName: item.botName,
            vendas: parseInt(item.getDataValue('vendas'), 10) || 0,
        }));

        // Ranking detalhado
        const detailWhere = {
            [Op.and]: [
                { purchasedAt: { [Op.between]: [startDate, endDate] } },
                { botName: { [Op.ne]: null } }
            ]
        };
        if (selectedBots && selectedBots.length > 0) {
            detailWhere[Op.and].push({ botName: { [Op.in]: selectedBots } });
        }

        const botsWithPurchases = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalPurchases'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue'],
            ],
            where: detailWhere,
            group: ['botName'],
        });

        // Precisamos também do count de usuários, mas filtrado por bot
        const userWhere = {
            [Op.and]: [
                { lastInteraction: { [Op.between]: [startDate, endDate] } },
                { botName: { [Op.ne]: null } }
            ]
        };
        if (selectedBots && selectedBots.length > 0) {
            userWhere[Op.and].push({ botName: { [Op.in]: selectedBots } });
        }

        const botsWithInteractions = await User.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalUsers'],
            ],
            where: userWhere,
            group: ['botName'],
        });
        const botUsersMap = {};
        botsWithInteractions.forEach((item) => {
            const bName = item.botName;
            const uCount = parseInt(item.getDataValue('totalUsers'), 10) || 0;
            botUsersMap[bName] = uCount;
        });

        // Plans por bot
        const planWhere = {
            [Op.and]: [
                { purchasedAt: { [Op.between]: [startDate, endDate] } },
                { planName: { [Op.ne]: null } },
                { botName: { [Op.ne]: null } }
            ]
        };
        if (selectedBots && selectedBots.length > 0) {
            planWhere[Op.and].push({ botName: { [Op.in]: selectedBots } });
        }

        const planSalesByBot = await Purchase.findAll({
            attributes: [
                'botName',
                'planName',
                [Sequelize.fn('COUNT', Sequelize.col('planName')), 'salesCount'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'sumValue'],
            ],
            where: planWhere,
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

        // 7 dias
        const stats7Days = [];
        for (let i = 6; i >= 0; i--) {
            const tempDate = new Date(startDate);
            tempDate.setDate(tempDate.getDate() - i);
            const dayStart = makeDay(tempDate);
            const dayEnd = new Date(dayStart);
            dayEnd.setHours(23, 59, 59, 999);

            const dayStat = await getDetailedStats(dayStart, dayEnd, null, selectedBots);
            stats7Days.push({
                date: dayStart.toISOString().split('T')[0],
                totalVendasConvertidas: dayStat.totalVendasConvertidas,
                totalVendasGeradas: dayStat.totalVendasGeradas
            });
        }

        // Movimentações
        const lastMovementsWhere = {
            [Op.and]: [
                { pixGeneratedAt: { [Op.between]: [startDate, endDate] } }
            ]
        };
        if (movStatus === 'pending') {
            lastMovementsWhere[Op.and].push({ status: 'pending' });
        } else if (movStatus === 'paid') {
            lastMovementsWhere[Op.and].push({ status: 'paid' });
        }
        if (selectedBots && selectedBots.length > 0) {
            lastMovementsWhere[Op.and].push({ botName: { [Op.in]: selectedBots } });
        }

        const { rows: lastMovements, count: totalMovements } = await Purchase.findAndCountAll({
            attributes: ['pixGeneratedAt', 'purchasedAt', 'planValue', 'status'],
            where: lastMovementsWhere,
            order: [['pixGeneratedAt', 'DESC']],
            limit: perPage,
            offset: offset,
            include: [
                {
                    model: User,
                    attributes: ['telegramId']
                }
            ]
        });

        return res.json({
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

// Inicializa o bot
require('./services/bot.service.js');

// Sobe servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});
