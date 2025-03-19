// services/config.service.js

const fs = require('fs');
const path = require('path');

class ConfigService {
  /**
   * Carrega a configuração do bot a partir do config.json
   */
  static loadConfig() {
    const configPath = path.resolve(process.cwd(), 'config.json');

    console.log(`📂 Caminho absoluto do config.json: ${configPath}`); // Log para depuração

    if (!fs.existsSync(configPath)) {
      throw new Error(`❌ Arquivo de configuração não encontrado: ${configPath}`);
    }

    const configFile = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configFile);
    return config;
  }

  /**
   * Obtém a configuração do banco de dados a partir de DATABASE_URL
   */
  static getDbConfig() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('❌ DATABASE_URL não está definido nas variáveis de ambiente.');
    }

    return {
      connectionString,
      dialect: 'postgres',
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      },
      logging: false,
    };
  }
}

module.exports = ConfigService;