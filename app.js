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
const BotModel = db.BotModel; // Importado se precisar

const logger = require('./services/logger');
const ConfigService = require('./services/config.service');
const config = ConfigService.loadConfig(); // carrega config.json

const { initializeBot, reloadBotsFromDB } = require('./services/bot.service');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
    secret: 'chave-super-secreta',
    resave: false,
    saveUninitialized: false
}));

function checkAuth(req, res, next) {
    if (req.session.loggedIn) next();
    else res.redirect('/login');
}

//------------------------------------------------------
// Conecta DB
//------------------------------------------------------
db.sequelize
    .authenticate()
    .then(() => logger.info('✅ Conexão com DB estabelecida.'))
    .catch((err) => logger.error('❌ Erro ao conectar DB:', err));

db.sequelize
    .sync({ alter: true }) // <--- CRIAR/ALTERAR TABELAS AQUI
    .then(async () => {
        logger.info('✅ Modelos sincronizados (alter).');
        // Depois de sync, recarrega e inicializa Bots do BD
        await reloadBotsFromDB();
    })
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
//------------------------------------------------------
app.get('/api/bots-list', checkAuth, async (req, res) => {
    try {
        // Lê do BD
        const botRows = await BotModel.findAll();
        const botNames = botRows.map(b => b.name);
        res.json(botNames);
    } catch (err) {
        logger.error('Erro ao retornar lista de bots:', err);
        res.status(500).json({ error: 'Erro ao retornar lista de bots' });
    }
});

//------------------------------------------------------
// FUNÇÕES DE ESTATÍSTICAS (conforme seu código original)
//------------------------------------------------------
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

async function getDetailedStats(startDate, endDate, originCondition, botFilters = []) {
    const { Purchase, User } = db;

    const baseWhere = { pixGeneratedAt: { [Op.between]: [startDate, endDate] } };
    if (botFilters.length > 0 && !botFilters.includes('All')) {
        baseWhere.botName = { [Op.in]: botFilters };
    }
    let totalUsers = 0;
    let totalPurchases = 0;
    let sumGerado = 0;
    let sumConvertido = 0;
    let averagePaymentDelayMs = 0;
    let conversionRate = 0;
    try {
        if (originCondition === 'main') {
            const mainWhere = { ...baseWhere, originCondition: 'main' };
            const purchaseWhere = { ...mainWhere, purchasedAt: { [Op.between]: [startDate, endDate] } };
            totalUsers = await Purchase.count({
                where: mainWhere,
                distinct: true,
                col: 'userId'
            });
            totalPurchases = await Purchase.count({ where: purchaseWhere });
            sumGerado = (await Purchase.sum('planValue', { where: mainWhere })) || 0;
            sumConvertido = (await Purchase.sum('planValue', {
                where: { ...mainWhere, purchasedAt: { [Op.between]: [startDate, endDate] }, status: 'paid' }
            })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
            const paidPurchases = await Purchase.findAll({
                where: { ...mainWhere, status: 'paid', purchasedAt: { [Op.between]: [startDate, endDate] } },
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
            averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
        } else if (!originCondition) {
            const purchaseWhere = { ...baseWhere, purchasedAt: { [Op.between]: [startDate, endDate] } };
            let userWhere = { lastInteraction: { [Op.between]: [startDate, endDate] } };
            if (botFilters.length > 0 && !botFilters.includes('All')) {
                purchaseWhere.botName = { [Op.in]: botFilters };
                userWhere.botName = { [Op.in]: botFilters };
            }
            totalUsers = await User.count({ where: userWhere });
            totalPurchases = await Purchase.count({ where: purchaseWhere });
            sumGerado = (await Purchase.sum('planValue', { where: baseWhere })) || 0;
            sumConvertido = (await Purchase.sum('planValue', {
                where: { ...baseWhere, purchasedAt: { [Op.between]: [startDate, endDate] }, status: 'paid' }
            })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
            const paidPurchases = await Purchase.findAll({
                where: { ...baseWhere, status: 'paid', purchasedAt: { [Op.between]: [startDate, endDate] } },
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
            averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
        } else {
            // not_purchased ou purchased
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
            sumGerado = (await Purchase.sum('planValue', { where: { ...baseWhere, originCondition } })) || 0;
            sumConvertido = (await Purchase.sum('planValue', { where: { ...baseWhere, originCondition, status: 'paid' } })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
            const paidPurchases = await Purchase.findAll({
                where: { ...baseWhere, originCondition, status: 'paid' },
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
            averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
            totalUsers = totalLeads;
            totalPurchases = totalConfirmed;
        }
    } catch (err) {
        logger.error(`Erro interno em getDetailedStats: ${err.message}`);
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
// ROTA: /api/bots-stats
//------------------------------------------------------
app.get('/api/bots-stats', checkAuth, async (req, res) => {
    try {
        const { dateRange, startDate: customStart, endDate: customEnd, movStatus } = req.query;
        let { date } = req.query;
        let botFilters = [];
        if (req.query.botFilter) {
            botFilters = req.query.botFilter.split(',');
        }
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const offset = (page - 1) * perPage;

        let startDate, endDate;
        const now = new Date();

        if (dateRange) {
            let todayMidnight = makeDay(new Date());
            let todayEnd = new Date(todayMidnight);
            todayEnd.setHours(23, 59, 59, 999);

            switch (dateRange) {
                case 'today':
                    startDate = todayMidnight;
                    endDate = todayEnd;
                    break;
                case 'yesterday':
                    const yesterday = new Date(todayMidnight);
                    yesterday.setDate(yesterday.getDate() - 1);
                    startDate = yesterday;
                    endDate = new Date(yesterday);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'last7':
                    startDate = new Date(todayMidnight);
                    startDate.setDate(startDate.getDate() - 6);
                    endDate = todayEnd;
                    break;
                case 'last30':
                    startDate = new Date(todayMidnight);
                    startDate.setDate(startDate.getDate() - 29);
                    endDate = todayEnd;
                    break;
                case 'lastMonth':
                    const firstDayCurrentMonth = new Date(todayMidnight);
                    firstDayCurrentMonth.setDate(1);
                    const lastMonthEnd = new Date(firstDayCurrentMonth);
                    lastMonthEnd.setDate(lastMonthEnd.getDate() - 1);
                    endDate = new Date(lastMonthEnd);
                    endDate.setHours(23, 59, 59, 999);

                    const firstDayLastMonth = new Date(lastMonthEnd);
                    firstDayLastMonth.setDate(1);
                    startDate = makeDay(firstDayLastMonth);
                    break;
                case 'custom':
                    if (customStart) {
                        startDate = makeDay(new Date(customStart));
                    } else {
                        startDate = todayMidnight;
                    }
                    if (customEnd) {
                        endDate = new Date(customEnd);
                        endDate.setHours(23, 59, 59, 999);
                    } else {
                        endDate = new Date(startDate);
                        endDate.setHours(23, 59, 59, 999);
                    }
                    break;
                default:
                    break;
            }
        }

        if (!startDate || !endDate) {
            let dateArray;
            if (date && date.includes(',')) {
                dateArray = date.split(',').map(d => d.trim()).filter(d => d);
            } else if (date) {
                dateArray = [date.trim()];
            } else {
                dateArray = [new Date().toISOString().split('T')[0]];
            }

            if (dateArray.length === 1) {
                startDate = makeDay(new Date(dateArray[0]));
                endDate = new Date(startDate);
                endDate.setHours(23, 59, 59, 999);
            } else {
                const dates = dateArray.map(d => new Date(d));
                startDate = makeDay(new Date(Math.min(...dates)));
                endDate = new Date(makeDay(new Date(Math.max(...dates))));
                endDate.setHours(23, 59, 59, 999);
            }
        }

        const statsAll = await getDetailedStats(startDate, endDate, null, botFilters);
        const statsMain = await getDetailedStats(startDate, endDate, 'main', botFilters);
        const statsNotPurchased = await getDetailedStats(startDate, endDate, 'not_purchased', botFilters);
        const statsPurchased = await getDetailedStats(startDate, endDate, 'purchased', botFilters);

        const yesterdayDate = new Date(startDate.getTime());
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const startYesterday = makeDay(yesterdayDate);
        const endYesterday = new Date(startYesterday);
        endYesterday.setHours(23, 59, 59, 999);
        const statsYesterday = await getDetailedStats(startYesterday, endYesterday, null, botFilters);

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
            const dayStart = makeDay(tempDate);
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

//------------------------------------------------------
// Rotas para gerenciar Bots
//------------------------------------------------------
app.get('/admin/bots', checkAuth, (req, res) => {
    const html = `
    <h1>Cadastrar Novo Bot</h1>
    <form method="POST" action="/admin/bots" style="max-width:700px;">
      <label>Nome do Bot:</label><br/>
      <input name="name" required style="width:200px;margin-bottom:10px;"/><br/>

      <label>Token do Bot:</label><br/>
      <input name="token" required style="width:300px;margin-bottom:10px;"/><br/>

      <label>Descrição (mensagem do /start):</label><br/>
      <textarea name="description" style="width:400px;height:80px;margin-bottom:10px;"></textarea><br/>

      <label>Nome do vídeo (ex: "video.mp4"):</label><br/>
      <input name="video" style="width:300px;margin-bottom:10px;"/><br/>

      <hr/>
      <h3>Botões (até 3)</h3>
      <div style="display:flex;gap:2rem; margin-bottom:1rem;">
        <div>
          <label>Botão 1: Nome</label><br/>
          <input name="button1Name" style="width:140px;margin-bottom:6px;"/><br/>
          <label>Botão 1: Valor (R$)</label><br/>
          <input name="button1Value" type="number" step="0.01" style="width:140px;"/>
        </div>
        <div>
          <label>Botão 2: Nome</label><br/>
          <input name="button2Name" style="width:140px;margin-bottom:6px;"/><br/>
          <label>Botão 2: Valor (R$)</label><br/>
          <input name="button2Value" type="number" step="0.01" style="width:140px;"/>
        </div>
        <div>
          <label>Botão 3: Nome</label><br/>
          <input name="button3Name" style="width:140px;margin-bottom:6px;"/><br/>
          <label>Botão 3: Valor (R$)</label><br/>
          <input name="button3Value" type="number" step="0.01" style="width:140px;"/>
        </div>
      </div>

      <hr/>
      <h3>Remarketing (JSON)</h3>
      <p style="font-size:0.9rem;">Exemplo de JSON: 
        <code>{"messages":[{"condition":"not_purchased","text":"XYZ","buttons":[{"name":"Plan A","value":10}]}],"intervals":{"not_purchased_minutes":5,"purchased_seconds":30}}</code>
      </p>
      <textarea name="remarketingJson" style="width:600px;height:100px;"></textarea><br/><br/>

      <button type="submit">Salvar</button>
    </form>
    <br/>
    <a href="/">Voltar para Dashboard</a>
    `;
    res.send(html);
});

app.post('/admin/bots', checkAuth, async (req, res) => {
    try {
        const { name, token, description, video, button1Name, button1Value, button2Name, button2Value, button3Name, button3Value, remarketingJson } = req.body;

        // Montamos o array de botões a partir dos 3 inputs
        const buttonsArray = [];
        function addButtonIfValid(btnName, btnValue) {
            if (btnName && btnValue && !isNaN(parseFloat(btnValue))) {
                buttonsArray.push({
                    name: btnName.trim(),
                    value: parseFloat(btnValue)
                });
            }
        }
        addButtonIfValid(button1Name, button1Value);
        addButtonIfValid(button2Name, button2Value);
        addButtonIfValid(button3Name, button3Value);

        // Converte para string JSON
        const buttonsJson = JSON.stringify(buttonsArray);

        // Cria o registro na tabela
        const newBot = await BotModel.create({
            name,
            token,
            description,
            video,
            buttonsJson,
            remarketingJson
        });
        logger.info(`✅ Bot ${name} inserido no BD com ${buttonsArray.length} botões.`);

        // Monta config e inicia imediatamente
        const botConfig = {
            name: newBot.name,
            token: newBot.token,
            description: newBot.description || '',
            video: newBot.video || '',
            buttons: [],
            remarketing: {}
        };
        // parse do buttonsJson
        if (newBot.buttonsJson) {
            try {
                botConfig.buttons = JSON.parse(newBot.buttonsJson);
            } catch { }
        }
        // parse do remarketingJson
        if (newBot.remarketingJson) {
            try {
                botConfig.remarketing = JSON.parse(newBot.remarketingJson);
            } catch { }
        }

        // Inicia o bot
        initializeBot(botConfig);

        res.send(`Bot <strong>${name}</strong> cadastrado e iniciado com sucesso!<br/><a href="/">Voltar</a>`);
    } catch (err) {
        logger.error('Erro ao criar bot:', err);
        res.status(500).send('Erro ao criar bot: ' + err.message);
    }
});

//------------------------------------------------------
// Sobe servidor
//------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});
