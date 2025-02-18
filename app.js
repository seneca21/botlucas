//------------------------------------------------------
// app.js
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Op, Sequelize } = require('sequelize');

// Para upload de arquivos via S3 (Bucketeer)
const AWS = require('aws-sdk');
const multerS3 = require('multer-s3-v3');
const multer = require('multer');
const fs = require('fs');

const db = require('./services/index'); // Index do Sequelize
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.BotModel; // IMPORTANTE: use o modelo BotModel exportado pelo index.js

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
// Configuração do Multer para uploads de vídeo via S3 (Bucketeer)
//------------------------------------------------------
AWS.config.update({
    accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY,
    region: process.env.BUCKETEER_AWS_REGION
});
const s3 = new AWS.S3();
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.BUCKETEER_BUCKET_NAME,
        acl: 'public-read', // para acesso público
        key: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
            cb(null, uniqueSuffix);
        }
    })
});

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

// Função para obter estatísticas detalhadas (omita ou mantenha conforme seu código atual)
async function getDetailedStats(startDate, endDate, originCondition, botFilters = []) {
    // ... implementação original ...
}

// Rota /api/bots-stats (mantenha sua implementação atual)
app.get('/api/bots-stats', checkAuth, async (req, res) => {
    // ... implementação original ...
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
            videoFilename = req.file.location;
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
            videoFilename = req.file.location;
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