// services/logger.js
// Logger customizado que limita a quantidade de logs e pausa o log quando excede o limite

const Logger = (() => {
    // Configurações de throttling
    const MAX_LOGS = 15;             // Limite de logs por janela
    const WINDOW_MS = 15 * 1000;     // 15 segundos
    const PAUSE_MS = 5 * 60 * 1000;  // 5 minutos

    // Preserva os métodos originais do console
    const originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    };

    // Variáveis internas para controle de logs
    let logCount = 0;
    let windowStart = Date.now();
    let pauseUntil = 0;

    /**
     * Função interna para gerenciar o throttling de logs
     * @param {Function} nativeMethod - Método original do console (log, warn, error)
     * @param  {...any} args - Argumentos para o método de log
     */
    function baseLog(nativeMethod, ...args) {
        const now = Date.now();

        // Se estamos em pausa, não faz nada
        if (now < pauseUntil) {
            return;
        }

        // Verifica se passou a janela de tempo, se sim, reseta contadores
        if (now - windowStart > WINDOW_MS) {
            logCount = 0;
            windowStart = now;
        }

        logCount++;

        // Se ainda não bateu o limite, loga normalmente
        if (logCount <= MAX_LOGS) {
            nativeMethod(...args);
        } else if (logCount === MAX_LOGS + 1) {
            // Apenas no primeiro excesso, envia uma mensagem de aviso
            nativeMethod(`⚠️ [LOGGER] Excesso de logs detectado. Pausando logs por 5 minutos.`);
            pauseUntil = now + PAUSE_MS;
        }
        // Logs além do limite +1 não são emitidos
    }

    // Retorna as funções de log substitutas
    return {
        log: (...args) => baseLog(originalConsole.log, ...args),
        warn: (...args) => baseLog(originalConsole.warn, ...args),
        error: (...args) => baseLog(originalConsole.error, ...args),
    };
})();

module.exports = Logger;
