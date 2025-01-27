//------------------------------------------------------
// app.js - Versão simples com login fixo
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Op, Sequelize } = require('sequelize');
const db = require('./services/index'); // Index do Sequelize
const User = db.User;
const Purchase = db.Purchase;

// Configurações básicas do express
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configura sessão
app.use(session({
    secret: 'chave-super-secreta', // Troque para algo mais seguro
    resave: false,
    saveUninitialized: false
}));

// Função para verificar login
function checkAuth(req, res, next) {
    if (req.session.loggedIn) {
        return next();
    } else {
        return res.redirect('/login');
    }
}

//------------------------------------------------------
// Testa conexão com DB e sincroniza
//------------------------------------------------------
db.sequelize
    .authenticate()
    .then(() => console.log('✅ Conexão com DB estabelecida.'))
    .catch((err) => console.error('❌ Erro ao conectar DB:', err));

db.sequelize
    .sync({ alter: true })
    .then(() => console.log('✅ Modelos sincronizados (alter).'))
    .catch((err) => console.error('❌ Erro ao sincronizar modelos:', err));

//------------------------------------------------------
// Rota raiz ("/") - Redireciona para dashboard ou login
//------------------------------------------------------
app.get('/', (req, res) => {
    if (req.session.loggedIn) {
        return res.redirect('/dashboard');
    } else {
        return res.redirect('/login');
    }
});

//------------------------------------------------------
// Rotas de LOGIN
//------------------------------------------------------

// GET /login (formulário simples)
app.get('/login', (req, res) => {
    if (req.session.loggedIn) {
        return res.redirect('/dashboard');
    }
    // Exibe um formulário HTML simples
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

// POST /login (valida credenciais fixas)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Credenciais fixas de exemplo
    const ADMIN_USER = 'admin';
    const ADMIN_PASS = '1234';

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.loggedIn = true;
        return res.redirect('/dashboard');
    } else {
        return res.send('Credenciais inválidas. <a href="/login">Tentar novamente</a>');
    }
});

// GET /logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.send('Você saiu! <a href="/login">Fazer login novamente</a>');
    });
});

//------------------------------------------------------
// Rota da Dashboard
//------------------------------------------------------
// Quando logado, serve o index.html dentro de /public
app.get('/dashboard', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Caso queira servir também CSS/JS da pasta public
// somente para usuários logados:
app.use('/public', checkAuth, express.static(path.join(__dirname, 'public')));

//------------------------------------------------------
// FUNÇÕES DE ESTATÍSTICAS
//------------------------------------------------------
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

// Helper para data zerada
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

//------------------------------------------------------
// ROTA /api/bots-stats (protegida também)
//------------------------------------------------------
app.get('/api/bots-stats', checkAuth, async (req, res) => {
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

        // Responde com JSON
        res.json({
            statsAll,
            statsYesterday,
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

//------------------------------------------------------
// Importa o bot e inicia o servidor
//------------------------------------------------------
require('./services/bot.service.js');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor web iniciado na porta ${PORT}`);
});
