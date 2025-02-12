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
const config = ConfigService.loadConfig(); // carrega config.json

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
    // Página de login sofisticada, com fundo cinza, formulário centralizado e "olho" para mostrar/esconder senha
    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Login</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/css/bootstrap.min.css">
      <style>
        body {
          background-color: #f8f9fa;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .login-container {
          background-color: #fff;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          width: 300px;
        }
        .login-container h1 {
          font-size: 1.5rem;
          margin-bottom: 1.5rem;
          text-align: center;
        }
        .btn-login {
          border-radius: 50px;
        }
        .input-group-text {
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h1>Login</h1>
        <form method="POST" action="/login">
          <div class="form-group">
            <label for="username">Usuário</label>
            <input type="text" class="form-control" id="username" name="username" placeholder="Digite seu usuário" required>
          </div>
          <div class="form-group">
            <label for="password">Senha</label>
            <div class="input-group">
              <input type="password" class="form-control" id="password" name="password" placeholder="Digite sua senha" required>
              <div class="input-group-append">
                <span class="input-group-text" id="togglePassword">&#128065;</span>
              </div>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-block btn-login">Entrar</button>
        </form>
      </div>
      <script>
        // Alterna a visibilidade da senha
        document.getElementById('togglePassword').addEventListener('click', function () {
          const passwordInput = document.getElementById('password');
          const currentType = passwordInput.getAttribute('type');
          const newType = currentType === 'password' ? 'text' : 'password';
          passwordInput.setAttribute('type', newType);
        });
      </script>
    </body>
    </html>
  `;
    res.send(html);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = 'perufe';
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

// Servimos a pasta public
app.use(checkAuth, express.static(path.join(__dirname, 'public')));

//------------------------------------------------------
// ROTA: /api/bots-list => retorna array de nomes de bots
//------------------------------------------------------
app.get('/api/bots-list', checkAuth, (req, res) => {
    try {
        const botNames = config.bots.map(b => b.name);
        res.json(botNames);
    } catch (err) {
        logger.error('Erro ao retornar lista de bots:', err);
        res.status(500).json({ error: 'Erro ao retornar lista de bots' });
    }
});

//------------------------------------------------------
// FUNÇÕES DE ESTATÍSTICAS AUXILIARES
//------------------------------------------------------
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/*
  A função getDetailedStats foi reestruturada em três ramos:
  1. Se originCondition === 'main': calcula apenas as estatísticas dos registros com originCondition "main"
  2. Se originCondition é nulo (ou não informado): considera TODOS os registros (todas as compras)
  3. Caso contrário (para remarketing ou upsell): utiliza o originCondition informado.
*/
async function getDetailedStats(startDate, endDate, originCondition, botFilters = []) {
    // Filtro base: registros cujo pixGeneratedAt está entre startDate e endDate
    const baseWhere = {
        pixGeneratedAt: { [Op.between]: [startDate, endDate] }
    };
    if (botFilters.length > 0 && !botFilters.includes('All')) {
        baseWhere.botName = { [Op.in]: botFilters };
    }

    if (originCondition === 'main') {
        // Apenas para o plano principal
        const mainWhere = { ...baseWhere, originCondition: 'main' };
        const purchaseWhere = {
            ...mainWhere,
            purchasedAt: { [Op.between]: [startDate, endDate] }
        };
        const totalUsers = await Purchase.count({
            where: mainWhere,
            distinct: true,
            col: 'userId'
        });
        const totalPurchases = await Purchase.count({ where: purchaseWhere });
        const sumGerado = (await Purchase.sum('planValue', { where: mainWhere })) || 0;
        const sumConvertido = (await Purchase.sum('planValue', {
            where: { ...mainWhere, purchasedAt: { [Op.between]: [startDate, endDate] }, status: 'paid' }
        })) || 0;
        const conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
        const paidPurchases = await Purchase.findAll({
            where: {
                ...mainWhere,
                status: 'paid',
                purchasedAt: { [Op.between]: [startDate, endDate] }
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
        const averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
        return {
            totalUsers,
            totalPurchases,
            conversionRate,
            totalVendasGeradas: sumGerado,
            totalVendasConvertidas: sumConvertido,
            averagePaymentDelayMs
        };
    } else if (!originCondition) {
        // Todas as compras: não filtra por originCondition
        const purchaseWhere = {
            ...baseWhere,
            purchasedAt: { [Op.between]: [startDate, endDate] }
        };
        const userWhere = {
            lastInteraction: { [Op.between]: [startDate, endDate] }
        };
        if (botFilters.length > 0 && !botFilters.includes('All')) {
            purchaseWhere.botName = { [Op.in]: botFilters };
            userWhere.botName = { [Op.in]: botFilters };
        }
        const totalUsers = await User.count({ where: userWhere });
        const totalPurchases = await Purchase.count({ where: purchaseWhere });
        const sumGerado = (await Purchase.sum('planValue', { where: baseWhere })) || 0;
        const sumConvertido = (await Purchase.sum('planValue', {
            where: { ...baseWhere, purchasedAt: { [Op.between]: [startDate, endDate] }, status: 'paid' }
        })) || 0;
        const conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
        const paidPurchases = await Purchase.findAll({
            where: {
                ...baseWhere,
                status: 'paid',
                purchasedAt: { [Op.between]: [startDate, endDate] }
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
        const averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
        return {
            totalUsers,
            totalPurchases,
            conversionRate,
            totalVendasGeradas: sumGerado,
            totalVendasConvertidas: sumConvertido,
            averagePaymentDelayMs
        };
    } else {
        // Para remarketing ("not_purchased") e upsell ("purchased")
        const purchaseWhere = { ...baseWhere, originCondition };
        const totalLeads = await Purchase.count({
            where: { ...baseWhere, originCondition },
            distinct: true,
            col: 'userId'
        });
        const totalConfirmed = await Purchase.count({
            where: { ...baseWhere, originCondition, status: 'paid' },
            distinct: true,
            col: 'userId'
        });
        const sumGerado = (await Purchase.sum('planValue', { where: { ...baseWhere, originCondition } })) || 0;
        const sumConvertido = (await Purchase.sum('planValue', { where: { ...baseWhere, originCondition, status: 'paid' } })) || 0;
        const conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
        const paidPurchases = await Purchase.findAll({
            where: {
                ...baseWhere,
                originCondition,
                status: 'paid',
                ...(botFilters.length > 0 && !botFilters.includes('All') ? { botName: { [Op.in]: botFilters } } : {})
            },
            attributes: ['pixGeneratedAt', 'purchasedAt']
        });
        let sumDiffMs = 0, countPaid = 0;
        for (const p of paidPurchases) {
            if (p.pixGeneratedAt && p.purchasedAt) {
                const diff = p.purchasedAt.getTime() - p.pixGeneratedAt.getTime();
                if (diff >= 0) {
                    sumDiffMs += diff;
                    countPaid++;
                }
            }
        }
        const averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
        return {
            totalUsers: totalLeads,
            totalPurchases: totalConfirmed,
            conversionRate,
            totalVendasGeradas: sumGerado,
            totalVendasConvertidas: sumConvertido,
            averagePaymentDelayMs
        };
    }
}

//------------------------------------------------------
// ROTA: /api/bots-stats
//------------------------------------------------------
app.get('/api/bots-stats', checkAuth, async (req, res) => {
    try {
        const { date, movStatus } = req.query;
        let botFilters = [];
        if (req.query.botFilter) {
            botFilters = req.query.botFilter.split(',');
        }

        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const offset = (page - 1) * perPage;

        const selectedDate = date ? new Date(date) : new Date();
        const startDate = makeDay(selectedDate);
        const endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);

        const statsAll = await getDetailedStats(startDate, endDate, null, botFilters);
        const statsMain = await getDetailedStats(startDate, endDate, 'main', botFilters);
        const statsNotPurchased = await getDetailedStats(startDate, endDate, 'not_purchased', botFilters);
        const statsPurchased = await getDetailedStats(startDate, endDate, 'purchased', botFilters);

        // "Ontem": cria nova data sem alterar startDate
        const yesterdayDate = new Date(startDate.getTime());
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const startYesterday = makeDay(yesterdayDate);
        const endYesterday = new Date(startYesterday);
        endYesterday.setHours(23, 59, 59, 999);
        const statsYesterday = await getDetailedStats(startYesterday, endYesterday, null, botFilters);

        // Ranking simples (global)
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
        const botRanking = botRankingRaw.map(item => ({
            botName: item.botName,
            vendas: parseInt(item.getDataValue('vendas'), 10) || 0,
        }));

        // Ranking detalhado (global) – para os pagamentos confirmados
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

        // Total gerado por bot (incluindo pendentes e pagos)
        const generatedByBot = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'generatedValue']
            ],
            where: {
                pixGeneratedAt: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null }
            },
            group: ['botName']
        });
        const generatedMap = {};
        generatedByBot.forEach(item => {
            generatedMap[item.botName] = parseFloat(item.getDataValue('generatedValue')) || 0;
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
        botsWithInteractions.forEach(item => {
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
        planSalesByBot.forEach(row => {
            const bName = row.botName;
            const pName = row.planName;
            const sCount = parseInt(row.getDataValue('salesCount'), 10) || 0;
            const tValue = parseFloat(row.getDataValue('sumValue')) || 0;
            if (!botPlansMap[bName]) botPlansMap[bName] = {};
            botPlansMap[bName][pName] = { salesCount: sCount, totalValue: tValue };
        });

        // Monta os detalhes de cada bot para o plano principal:
        const botDetails = [];
        for (const bot of botsWithPurchases) {
            const bName = bot.botName;
            const totalPurchasesBot = parseInt(bot.getDataValue('totalPurchases'), 10) || 0;
            const totalValueBot = parseFloat(bot.getDataValue('totalValue')) || 0;
            // Aqui, para o plano principal, isolamos os registros com originCondition "main"
            const totalUsersBot = await Purchase.count({
                where: { pixGeneratedAt: { [Op.between]: [startDate, endDate] }, originCondition: 'main', botName: bName },
                distinct: true,
                col: 'userId'
            });
            // Também soma somente os valores gerados com originCondition "main"
            const generatedForBot = (await Purchase.sum('planValue', {
                where: { pixGeneratedAt: { [Op.between]: [startDate, endDate] }, originCondition: 'main', botName: bName }
            })) || 0;
            const conversionRateBot = generatedForBot > 0 ? (totalValueBot / generatedForBot) * 100 : 0;
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
        }
        botDetails.sort((a, b) => b.valorGerado - a.valorGerado);

        // Estatísticas para os últimos 7 dias
        const stats7Days = [];
        for (let i = 6; i >= 0; i--) {
            const tempDate = new Date(startDate);
            tempDate.setDate(tempDate.getDate() - i);
            const dayStart = makeDay(tempDate);
            const dayEnd = new Date(dayStart);
            dayEnd.setHours(23, 59, 59, 999);

            const dayStat = await getDetailedStats(dayStart, dayEnd, null, botFilters);
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
        if (botFilters.length > 0 && !botFilters.includes('All')) {
            lastMovementsWhere.botName = { [Op.in]: botFilters };
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

// Função auxiliar (mantida)
function originConditionForBot(botName, botDetailsArray) {
    return null;
}

// Inicializa o bot
require('./services/bot.service.js');

// Sobe servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});
