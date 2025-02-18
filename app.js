//------------------------------------------------------
// app.js
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Op, Sequelize } = require('sequelize');

// Para upload de arquivos (multer):
const multer = require('multer');
const aws = require('aws-sdk');
const multerS3 = require('multer-s3');
const fs = require('fs');

const db = require('./services/index'); // Index do Sequelize (arquivo na pasta services)
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.BotModel; // IMPORTANTE: use o modelo BotModel exportado pelo index.js dos serviços

const logger = require('./services/logger');
const ConfigService = require('./services/config.service');
const config = ConfigService.loadConfig(); // carrega config.json

// Importa funções para inicializar/editar bots
const { initializeBot, reloadBotsFromDB, updateBotInMemory } = require('./services/bot.service');

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
    if (req.session.loggedIn) next();
    else res.redirect('/login');
}

//------------------------------------------------------
// Conexão com o Banco de Dados
//------------------------------------------------------
db.sequelize
    .authenticate()
    .then(() => logger.info('✅ Conexão com DB estabelecida.'))
    .catch((err) => logger.error('❌ Erro ao conectar DB:', err));

db.sequelize
    .sync({ alter: true })
    .then(async () => {
        logger.info('✅ Modelos sincronizados (alter).');
        // Ao iniciar, recarregamos todos os bots já cadastrados no BD
        await reloadBotsFromDB();
    })
    .catch((err) => logger.error('❌ Erro ao sincronizar modelos:', err));

//------------------------------------------------------
// Configuração do Multer para uploads de vídeo usando S3 via Bucketter
//------------------------------------------------------
aws.config.update({
    accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY,
    region: process.env.BUCKETEER_AWS_REGION
});
const s3 = new aws.S3();

const storage = multerS3({
    s3: s3,
    bucket: process.env.BUCKETEER_BUCKET_NAME,
    acl: 'public-read',
    key: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
        cb(null, uniqueSuffix);
    }
});
const upload = multer({ storage });

//------------------------------------------------------
// Rotas de LOGIN/LOGOUT
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
// Rotas de ESTATÍSTICAS & BOT LIST
//------------------------------------------------------
app.get('/api/bots-list', checkAuth, async (req, res) => {
    try {
        const botRows = await BotModel.findAll();
        const botNames = botRows.map(b => b.name);
        res.json(botNames);
    } catch (err) {
        logger.error('Erro ao retornar lista de bots:', err);
        res.status(500).json({ error: 'Erro ao retornar lista de bots' });
    }
});

// Função makeDay
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

// Função para obter estatísticas detalhadas
async function getDetailedStats(startDate, endDate, originCondition, botFilters = []) {
    // (Implementação completa conforme sua versão original)
    let totalUsers = 0, totalPurchases = 0, sumGerado = 0, sumConvertido = 0, averagePaymentDelayMs = 0, conversionRate = 0;
    try {
        if (originCondition === 'main') {
            const mainWhere = { pixGeneratedAt: { [Op.between]: [startDate, endDate] }, originCondition: 'main' };
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
        }
        // Outros casos de originCondition (null, not_purchased, etc.) seguem lógica similar...
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
                    startDate = customStart ? makeDay(new Date(customStart)) : todayMidnight;
                    endDate = customEnd ? new Date(customEnd) : new Date(startDate);
                    endDate.setHours(23, 59, 59, 999);
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

        // Bot Ranking e outros cálculos permanecem conforme sua lógica original...
        // (Implemente todas as queries conforme sua versão)
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

        // Últimas movimentações com paginação
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
            statsMain,
            statsNotPurchased,
            statsPurchased,
            botRanking,
            lastMovements,
            totalMovements
        });
    } catch (error) {
        logger.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

//------------------------------------------------------
// Rotas de Gerenciar Bots
//------------------------------------------------------

// [POST] Criar Novo Bot (com upload de vídeo opcional)
app.post('/admin/bots', checkAuth, upload.single('videoFile'), async (req, res) => {
    try {
        const payload = req.body;
        const {
            name,
            token,
            description,
            buttonName1,
            buttonValue1,
            buttonName2,
            buttonValue2,
            buttonName3,
            buttonValue3,
            remarketingJson
        } = payload;

        // Monta array de botões
        const buttons = [];
        function pushButtonIfValid(bName, bValue) {
            if (bName && bName.trim() !== '' && bValue && !isNaN(parseFloat(bValue))) {
                buttons.push({ name: bName.trim(), value: parseFloat(bValue) });
            }
        }
        pushButtonIfValid(buttonName1, buttonValue1);
        pushButtonIfValid(buttonName2, buttonValue2);
        pushButtonIfValid(buttonName3, buttonValue3);
        const buttonsJson = JSON.stringify(buttons);

        const safeRemarketingJson = remarketingJson || '';

        let videoFilename = '';
        if (req.file) {
            videoFilename = req.file.key; // A key gerada pelo multer-s3
        }

        const newBot = await BotModel.create({
            name,
            token,
            description,
            video: videoFilename,
            buttonsJson,
            remarketingJson: safeRemarketingJson
        });
        logger.info(`✅ Bot ${name} inserido no BD.`);

        const bc = {
            name: newBot.name,
            token: newBot.token,
            description: newBot.description,
            video: newBot.video,
            buttons: buttons,
            remarketing: {}
        };
        if (safeRemarketingJson) {
            try {
                let trimmed = safeRemarketingJson.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    bc.remarketing = JSON.parse(trimmed);
                } else {
                    bc.remarketing = {};
                    logger.warn(`Remarketing JSON para o bot ${newBot.name} não é válido. Usando objeto vazio.`);
                }
            } catch (e) {
                logger.warn(`Remarketing JSON inválido para o bot ${newBot.name}.`, e);
                bc.remarketing = {};
            }
        }

        initializeBot(bc);
        res.send(`
            <div class="alert alert-success">
              Bot <strong>${name}</strong> cadastrado e iniciado com sucesso!
            </div>
        `);
    } catch (err) {
        logger.error('Erro ao criar bot:', err);
        res.status(500).send('Erro ao criar bot: ' + err.message);
    }
});

// [GET] Lista de bots (JSON)
app.get('/admin/bots/list', checkAuth, async (req, res) => {
    try {
        const bots = await BotModel.findAll();
        res.json(bots);
    } catch (err) {
        logger.error('Erro ao listar bots:', err);
        res.status(500).json({ error: 'Erro ao listar bots' });
    }
});

// [GET] Retorna 1 bot (para edição) em JSON
app.get('/admin/bots/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const bot = await BotModel.findByPk(id);
        if (!bot) {
            return res.status(404).json({ error: 'Bot não encontrado' });
        }
        res.json(bot);
    } catch (err) {
        logger.error('Erro ao obter bot:', err);
        res.status(500).json({ error: 'Erro ao obter bot' });
    }
});

// [POST] Editar bot existente (com upload de vídeo opcional)
app.post('/admin/bots/edit/:id', checkAuth, upload.single('videoFile'), async (req, res) => {
    try {
        const { id } = req.params;
        const bot = await BotModel.findByPk(id);
        if (!bot) {
            return res.status(404).send('Bot não encontrado');
        }

        const {
            name,
            token,
            description,
            buttonName1,
            buttonValue1,
            buttonName2,
            buttonValue2,
            buttonName3,
            buttonValue3,
            remarketingJson
        } = req.body;

        const buttons = [];
        function pushButtonIfValid(bName, bValue) {
            if (bName && bName.trim() !== '' && bValue && !isNaN(parseFloat(bValue))) {
                buttons.push({ name: bName.trim(), value: parseFloat(bValue) });
            }
        }
        pushButtonIfValid(buttonName1, buttonValue1);
        pushButtonIfValid(buttonName2, buttonValue2);
        pushButtonIfValid(buttonName3, buttonValue3);
        const buttonsJson = JSON.stringify(buttons);

        let videoFilename = bot.video;
        if (req.file) {
            videoFilename = req.file.key;
        }

        const safeRemarketingJson = remarketingJson || '';

        bot.name = name;
        bot.token = token;
        bot.description = description;
        bot.video = videoFilename;
        bot.buttonsJson = buttonsJson;
        bot.remarketingJson = safeRemarketingJson;
        await bot.save();
        logger.info(`✅ Bot ${name} (ID ${bot.id}) atualizado no BD.`);

        const bc = {
            name: bot.name,
            token: bot.token,
            description: bot.description,
            video: bot.video,
            buttons: buttons,
            remarketing: {}
        };
        if (safeRemarketingJson) {
            try {
                let trimmed = safeRemarketingJson.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    bc.remarketing = JSON.parse(trimmed);
                } else {
                    bc.remarketing = {};
                    logger.warn(`Remarketing JSON para o bot ${bot.name} não é válido. Usando objeto vazio.`);
                }
            } catch (e) {
                logger.warn(`Remarketing JSON inválido para o bot ${bot.name}.`, e);
                bc.remarketing = {};
            }
        }

        // Atualiza a instância em memória
        updateBotInMemory(id, bc);

        res.send(`
            <div class="alert alert-success">
              Bot <strong>${bot.name}</strong> atualizado e reiniciado com sucesso!
            </div>
        `);
    } catch (err) {
        logger.error('Erro ao editar bot:', err);
        res.status(500).send('Erro ao editar bot: ' + err.message);
    }
});

//------------------------------------------------------
// Sobe servidor
//------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});