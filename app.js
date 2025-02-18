// app.js

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const multer = require('multer');
const { Op, Sequelize } = require('sequelize');

const db = require('./services/index');
const User = db.User;
const Purchase = db.Purchase;
const Bot = db.Bot;

const logger = require('./services/logger');
const ConfigService = require('./services/config.service');
const config = ConfigService.loadConfig();

const { reloadBotsFromDB, updateBotInMemory } = require('./services/bot.service.js');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const upload = multer({ dest: 'src/videos/' }); // salva local

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

// Conecta DB
db.sequelize
    .authenticate()
    .then(() => logger.info('✅ Conexão com DB estabelecida.'))
    .catch(err => logger.error('❌ Erro ao conectar DB:', err));

db.sequelize
    .sync({ alter: true })
    .then(() => {
        logger.info('✅ Modelos sincronizados (alter).');
        // Carrega bots do DB (adicional ao config.json)
        reloadBotsFromDB();
    })
    .catch(err => logger.error('❌ Erro ao sincronizar modelos:', err));

// Rotas de LOGIN
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
        logger.warn(`❌ Tentativa login inválida: ${username}`);
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

// Rota principal
app.get('/', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servir pasta public
app.use(checkAuth, express.static(path.join(__dirname, 'public')));

// ROTA GET: /api/bots-list
app.get('/api/bots-list', checkAuth, (req, res) => {
    try {
        // Pega do config e do BD
        const configBots = config.bots?.map(b => b.name) || [];
        Bot.findAll().then(dbBots => {
            const dbNames = dbBots.map(b => b.name);
            const merged = Array.from(new Set([...configBots, ...dbNames]));
            res.json(merged);
        }).catch(err => {
            logger.error('Erro DB bot-list:', err);
            res.json(configBots);
        });
    } catch (err) {
        logger.error('Erro /api/bots-list:', err);
        res.status(500).json({ error: 'Erro' });
    }
});

// FUNÇÃO makeDay
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

// getDetailedStats (igual ao seu)
async function getDetailedStats(startDate, endDate, originCondition, botFilters = []) {
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
            totalUsers = await Purchase.count({ where: mainWhere, distinct: true, col: 'userId' });
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
            const paid = await Purchase.findAll({
                where: { ...baseWhere, status: 'paid', purchasedAt: { [Op.between]: [startDate, endDate] } },
                attributes: ['pixGeneratedAt', 'purchasedAt']
            });
            let sumDiffMs = 0;
            let cPaid = 0;
            for (const p of paid) {
                if (p.pixGeneratedAt && p.purchasedAt) {
                    const diff = p.purchasedAt.getTime() - p.pixGeneratedAt.getTime();
                    if (diff >= 0) {
                        sumDiffMs += diff;
                        cPaid++;
                    }
                }
            }
            averagePaymentDelayMs = cPaid > 0 ? Math.round(sumDiffMs / cPaid) : 0;

        } else {
            // not_purchased / purchased
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
        logger.error(`Erro interno getDetailedStats: ${err.message}`);
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

// /api/bots-stats
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
            where: { purchasedAt: { [Op.between]: [startDate, endDate] } },
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
            where: { purchasedAt: { [Op.between]: [startDate, endDate] }, botName: { [Op.ne]: null } },
            group: ['botName'],
        });

        const generatedByBot = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'generatedValue']
            ],
            where: { pixGeneratedAt: { [Op.between]: [startDate, endDate] }, botName: { [Op.ne]: null } },
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
            where: { lastInteraction: { [Op.between]: [startDate, endDate] }, botName: { [Op.ne]: null } },
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

// ============================
// Rotas de Gerenciar Bots
// ============================

// Lista
app.get('/admin/bots/list', checkAuth, async (req, res) => {
    try {
        const bots = await Bot.findAll();
        let html = `<h3>Lista de Bots no BD:</h3><ul>`;
        bots.forEach(b => {
            html += `<li><a href="/admin/bots/${b.id}">${b.name}</a></li>`;
        });
        html += `</ul>
    <a href="/admin/bots/new">[Criar Novo Bot]</a>
    `;
        res.send(html);
    } catch (err) {
        logger.error('Erro ao listar bots:', err);
        res.send('Erro ao listar bots.');
    }
});

// Form new
app.get('/admin/bots/new', checkAuth, (req, res) => {
    const form = `
  <h2>Novo Bot</h2>
  <form action="/admin/bots" method="POST" enctype="multipart/form-data">
    <div>Nome: <input name="name" required></div>
    <div>Token: <input name="token" required></div>
    <div>Descrição: <textarea name="description" rows="3"></textarea></div>
    <div>Video (arquivo): <input type="file" name="videoFile"></div>
    <div>Buttons JSON: <textarea name="buttonsJson" rows="3"></textarea></div>
    <div>Remarketing JSON: <textarea name="remarketingJson" rows="3"></textarea></div>
    <button type="submit">Salvar</button>
  </form>
  <a href="/admin/bots/list">[Voltar]</a>
  `;
    res.send(form);
});

// Create
app.post('/admin/bots', checkAuth, upload.single('videoFile'), async (req, res) => {
    try {
        const { name, token, description } = req.body;
        let videoFilename = req.body.video || null;
        if (req.file) {
            // Se subiu arquivo, renomeamos como o nome do original ou algo:
            videoFilename = req.file.originalname;
            // Mover do temp "req.file.path" para "src/videos/videoFilename"
            const targetPath = path.join(__dirname, 'src', 'videos', videoFilename);
            fs.renameSync(req.file.path, targetPath);
        }
        const buttonsJson = req.body.buttonsJson || '[]';
        const remarketingJson = req.body.remarketingJson || '{}';

        const newBot = await Bot.create({
            name,
            token,
            description,
            video: videoFilename,
            buttonsJson,
            remarketingJson
        });

        logger.info(`✅ Bot ${name} inserido no BD.`);

        // Tenta parse remarketing
        let remarketingParsed = null;
        try {
            remarketingParsed = JSON.parse(remarketingJson);
        } catch (jsonErr) {
            logger.warn(`Remarketing JSON inválido p/ bot ${name}. ${jsonErr}`);
        }
        let buttonsParsed = null;
        try {
            buttonsParsed = JSON.parse(buttonsJson);
        } catch { }

        // re-inicializa em memória
        const memoryConfig = {
            name,
            token,
            description,
            video: videoFilename,
            buttons: buttonsParsed || [],
            remarketing: remarketingParsed || {}
        };
        // Inicia
        require('./services/bot.service').initializeSingleBot(memoryConfig);

        res.send(`
      Bot criado com sucesso! <br>
      <a href="/admin/bots/list">[Voltar]</a>
    `);
    } catch (err) {
        logger.error('Erro ao criar bot:', err);
        res.status(500).send('Erro ao criar bot. ' + err.message);
    }
});

// Edit form
app.get('/admin/bots/:id', checkAuth, async (req, res) => {
    try {
        const b = await Bot.findByPk(req.params.id);
        if (!b) return res.send('Bot não encontrado.');

        const form = `
    <h2>Editar Bot #${b.id}</h2>
    <form action="/admin/bots/edit/${b.id}" method="POST" enctype="multipart/form-data">
      <div>Nome: <input name="name" value="${b.name}" required></div>
      <div>Token: <input name="token" value="${b.token}" required></div>
      <div>Descrição: <textarea name="description" rows="3">${b.description || ''}</textarea></div>
      <div>Video atual: <b>${b.video || '-- sem vídeo --'}</b></div>
      <div>Alterar vídeo: <input type="file" name="videoFile"></div>
      <div>Buttons JSON: <textarea name="buttonsJson" rows="3">${b.buttonsJson || ''}</textarea></div>
      <div>Remarketing JSON: <textarea name="remarketingJson" rows="3">${b.remarketingJson || ''}</textarea></div>
      <button type="submit">Salvar</button>
    </form>
    <a href="/admin/bots/list">[Voltar]</a>
    `;
        res.send(form);
    } catch (err) {
        logger.error('Erro ao pegar bot:', err);
        res.send('Erro ao pegar bot.');
    }
});

// Update
app.post('/admin/bots/edit/:id', checkAuth, upload.single('videoFile'), async (req, res) => {
    try {
        const b = await Bot.findByPk(req.params.id);
        if (!b) return res.send('Bot não encontrado.');

        b.name = req.body.name;
        b.token = req.body.token;
        b.description = req.body.description || '';
        if (req.file) {
            const newFilename = req.file.originalname;
            const targetPath = path.join(__dirname, 'src', 'videos', newFilename);
            fs.renameSync(req.file.path, targetPath);
            b.video = newFilename;
        }
        b.buttonsJson = req.body.buttonsJson || '[]';
        b.remarketingJson = req.body.remarketingJson || '{}';
        await b.save();

        logger.info(`✅ Bot ${b.name} (ID ${b.id}) atualizado no BD.`);

        // Tenta atualizar em memória
        // Precisamos parse:
        let remarketingParsed = null;
        try {
            remarketingParsed = JSON.parse(b.remarketingJson);
        } catch (e) {
            logger.warn(`remarketing JSON parse fail: ${e}`);
        }
        let buttonsParsed = null;
        try {
            buttonsParsed = JSON.parse(b.buttonsJson);
        } catch (e) {
            logger.warn(`buttons JSON parse fail: ${e}`);
        }

        const memConfig = {
            name: b.name,
            token: b.token,
            description: b.description,
            video: b.video,
            buttons: buttonsParsed || [],
            remarketing: remarketingParsed || {}
        };

        // Correção do erro: "updateBotInMemory is not a function"
        // Precisamos do updateBotInMemory
        updateBotInMemory(memConfig);

        res.send(`
      Bot editado com sucesso! <br>
      <a href="/admin/bots/list">[Voltar]</a>
    `);
    } catch (err) {
        logger.error('Erro ao editar bot:', err);
        res.status(500).send('Erro ao editar bot. ' + err.message);
    }
});

// Subir server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});
