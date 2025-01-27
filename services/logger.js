// services/logger.js
// Lógica de throttling de logs console.*
// Ao ultrapassar 15 logs em 15s, pausa logs por 5 min

const Logger = (() => {
    // Configurações de throttling
    const MAX_LOGS = 15;             // Limite de logs por janela
    const WINDOW_MS = 15 * 1000;     // 15 segundos
    const PAUSE_MS = 5 * 60 * 1000;  // 5 minutos

    // Variáveis internas
    let logCount = 0;
    let windowStart = Date.now();
    let pauseUntil = 0;

    // Função interna que faz a checagem e decide se loga ou pausa
    function baseLog(nativeMethod, ...args) {
        const now = Date.now();

        // Se estamos em pausa, não faz nada
        if (now < pauseUntil) {
            return;
        }

        // Verifica se passou a janela de 15s, se sim, reseta contadores
        if ((now - windowStart) > WINDOW_MS) {
            logCount = 0;
            windowStart = now;
        }

        logCount++;

        // Se ainda não bateu o limite, loga normalmente
        if (logCount <= MAX_LOGS) {
            nativeMethod(...args);
        } else {
            // Se bateu o limite, faz 1 log de aviso e entra em pausa
            nativeMethod(`⚠️ [LOGGER] Excesso de logs detectado. Pausando logs por 5 minutos.`);
            pauseUntil = now + PAUSE_MS;
        }
    }

    // Retorna as funções de log substitutas
    return {
        log: (...args) => baseLog(console.log, ...args),
        warn: (...args) => baseLog(console.warn, ...args),
        error: (...args) => baseLog(console.error, ...args),
    };
})();

module.exports = Logger;
