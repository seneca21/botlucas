//------------------------------------------------------
// app.js (com horário de Brasília)
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Op, Sequelize } = require('sequelize');

const db = require('./services/index'); // Index do Sequelize
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.BotModel; // Modelo Bot

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
// Se houver registros na tabela Bots, utiliza-os; caso contrário, utiliza a configuração do config.json
//------------------------------------------------------
app.get('/api/bots-list', checkAuth, async (req, res) => {
    try {
        let bots = await BotModel.findAll({ attributes: ['name'] });
        if (!bots || bots.length === 0) {
            // Fallback para os bots definidos em config.json
            bots = config.bots.map(b => ({ name: b.name }));
        }
        const botNames = bots.map(b => b.name);
        res.json(botNames);
    } catch (err) {
        logger.error('Erro ao retornar lista de bots:', err);
        res.status(500).json({ error: 'Erro ao retornar lista de bots' });
    }
});

//------------------------------------------------------
// FUNÇÃO Auxiliar -> converte data para "meia-noite" em Brasília
//------------------------------------------------------
function makeDayBrasilia(rawDate) {
    const dateStringBr = new Date(rawDate).toLocaleString("en-US", {
        timeZone: "America/Sao_Paulo"
    });
    const localBrDate = new Date(dateStringBr);
    localBrDate.setHours(0, 0, 0, 0);
    return localBrDate;
}

//------------------------------------------------------
// /api/bots-stats => obtém estatísticas detalhadas
//------------------------------------------------------
app.get('/api/bots-stats', checkAuth, async (req, res) => {
    try {
        const {
            dateRange,
            startDate: customStart,
            endDate: customEnd,
            movStatus
        } = req.query;

        let { date } = req.query; // compatibilidade com o param 'date' antigo
        let botFilters = [];
        if (req.query.botFilter) {
            botFilters = req.query.botFilter.split(',');
        }

        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const offset = (page - 1) * perPage;

        let startDate, endDate;
        if (dateRange) {
            switch (dateRange) {
                case 'today': {
                    const todayStartBr = makeDayBrasilia(new Date());
                    startDate = todayStartBr;
                    endDate = new Date(todayStartBr);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case 'yesterday': {
                    const todayStartBr = makeDayBrasilia(new Date());
                    const yesterdayStartBr = new Date(todayStartBr);
                    yesterdayStartBr.setDate(yesterdayStartBr.getDate() - 1);
                    startDate = yesterdayStartBr;
                    endDate = new Date(yesterdayStartBr);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case 'last7': {
                    const todayStartBr = makeDayBrasilia(new Date());
                    const last7Start = new Date(todayStartBr);
                    last7Start.setDate(last7Start.getDate() - 6);
                    startDate = last7Start;
                    endDate = new Date(todayStartBr);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case 'last30': {
                    const todayStartBr = makeDayBrasilia(new Date());
                    const last30Start = new Date(todayStartBr);
                    last30Start.setDate(last30Start.getDate() - 29);
                    startDate = last30Start;
                    endDate = new Date(todayStartBr);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case 'lastMonth': {
                    const todayStartBr = makeDayBrasilia(new Date());
                    const firstDayThisMonth = new Date(todayStartBr);
                    firstDayThisMonth.setDate(1);
                    const lastDayLastMonth = new Date(firstDayThisMonth);
                    lastDayLastMonth.setDate(lastDayLastMonth.getDate() - 1);
                    lastDayLastMonth.setHours(23, 59, 59, 999);
                    const firstDayLastMonth = makeDayBrasilia(lastDayLastMonth);
                    firstDayLastMonth.setDate(1);
                    startDate = firstDayLastMonth;
                    endDate = lastDayLastMonth;
                    break;
                }
                case 'custom': {
                    startDate = customStart ? makeDayBrasilia(new Date(customStart)) : makeDayBrasilia(new Date());
                    if (customEnd) {
                        const endBr = makeDayBrasilia(new Date(customEnd));
                        endDate = new Date(endBr);
                        endDate.setHours(23, 59, 59, 999);
                    } else {
                        endDate = new Date(startDate);
                        endDate.setHours(23, 59, 59, 999);
                    }
                    break;
                }
            }
        }
        if (!startDate || !endDate) {
            let dateArray;
            if (date && date.includes(',')) {
                dateArray = date.split(',').map(d => d.trim()).filter(d => d);
            } else if (date) {
                dateArray = [date.trim()];
            } else {
                const brToday = makeDayBrasilia(new Date());
                startDate = brToday;
                endDate = new Date(brToday);
                endDate.setHours(23, 59, 59, 999);
            }
            if (!startDate || !endDate) {
                if (dateArray && dateArray.length === 1) {
                    startDate = makeDayBrasilia(new Date(dateArray[0]));
                    endDate = new Date(startDate);
                    endDate.setHours(23, 59, 59, 999);
                } else if (dateArray && dateArray.length > 1) {
                    const dateObjs = dateArray.map(d => new Date(d));
                    const minDate = new Date(Math.min(...dateObjs));
                    const maxDate = new Date(Math.max(...dateObjs));
                    startDate = makeDayBrasilia(minDate);
                    endDate = makeDayBrasilia(maxDate);
                    endDate.setHours(23, 59, 59, 999);
                }
            }
        }
        if (!startDate || !endDate) {
            const brToday = makeDayBrasilia(new Date());
            startDate = brToday;
            endDate = new Date(brToday);
            endDate.setHours(23, 59, 59, 999);
        }

        // Carrega estatísticas (as funções getDetailedStats permanecem inalteradas no seu código)
        const statsAll = await getDetailedStats(startDate, endDate, null, botFilters);
        const statsMain = await getDetailedStats(startDate, endDate, 'main', botFilters);
        const statsNotPurchased = await getDetailedStats(startDate, endDate, 'not_purchased', botFilters);
        const statsPurchased = await getDetailedStats(startDate, endDate, 'purchased', botFilters);

        const startDateCopy = new Date(startDate);
        const yesterdayDate = new Date(startDateCopy);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const startYesterday = makeDayBrasilia(yesterdayDate);
        const endYesterday = new Date(startYesterday);
        endYesterday.setHours(23, 59, 59, 999);
        const statsYesterday = await getDetailedStats(startYesterday, endYesterday, null, botFilters);

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
        const botRanking = botRankingRaw.map(item => ({
            botName: item.botName,
            vendas: parseInt(item.getDataValue('vendas'), 10) || 0,
        }));

        // Ranking detalhado e estatísticas adicionais (conforme seu código atual)
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
        const botDetails = [];
        for (const bot of botsWithPurchases) {
            const bName = bot.botName;
            const totalPurchasesBot = parseInt(bot.getDataValue('totalPurchases'), 10) || 0;
            const totalValueBot = parseFloat(bot.getDataValue('totalValue')) || 0;
            const totalUsersBot = await Purchase.count({
                where: {
                    pixGeneratedAt: { [Op.between]: [startDate, endDate] },
                    originCondition: 'main',
                    botName: bName
                },
                distinct: true,
                col: 'userId'
            });
            const generatedForBot = (await Purchase.sum('planValue', {
                where: {
                    pixGeneratedAt: { [Op.between]: [startDate, endDate] },
                    originCondition: 'main',
                    botName: bName
                }
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

        const stats7Days = [];
        for (let i = 6; i >= 0; i--) {
            const tempDate = new Date(startDate);
            tempDate.setDate(tempDate.getDate() - i);
            const dayStart = makeDayBrasilia(tempDate);
            const dayEnd = new Date(dayStart);
            dayEnd.setHours(23, 59, 59, 999);
            const dayStat = await getDetailedStats(dayStart, dayEnd, null, botFilters) || {};
            stats7Days.push({
                date: dayStart.toISOString().split('T')[0],
                totalVendasConvertidas: dayStat.totalVendasConvertidas || 0,
                totalVendasGeradas: dayStat.totalVendasGeradas || 0
            });
        }

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
            include: [{
                model: User,
                attributes: ['telegramId']
            }]
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

// Inicializa o bot (arquivo bot.service.js já cuida da inicialização)
require('./services/bot.service.js');

// Sobe servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});