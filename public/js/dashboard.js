$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;

    async function updateDashboard(date) {
        try {
            // Faz request para a rota do backend: /api/bots-stats?date=YYYY-MM-DD
            const response = await fetch(`/api/bots-stats?date=${date}`);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }

            const data = await response.json();
            console.log('Dados recebidos da API:', data);

            // Atualizar Estatísticas Básicas
            $('#totalUsers').text(data.totalUsers);
            $('#totalPurchases').text(data.totalPurchases);
            $('#conversionRate').text(data.conversionRate.toFixed(2) + '%');

            // Montar ranking simples (botRanking)
            const botRankingTbody = $('#botRanking');
            botRankingTbody.empty();
            if (data.botRanking && data.botRanking.length > 0) {
                data.botRanking.forEach(bot => {
                    botRankingTbody.append(`
                        <tr>
                            <td>${bot.botName || 'N/A'}</td>
                            <td>${bot.vendas}</td>
                        </tr>
                    `);
                });
            }

            // Gráfico (usuários X compras)
            const chartData = {
                labels: ['Usuários (Geraram Pix)', 'Compras'],
                datasets: [{
                    label: 'Quantidade',
                    data: [data.totalUsers, data.totalPurchases],
                    backgroundColor: ['#36A2EB', '#4BC0C0']
                }]
            };

            const ctx = document.getElementById('salesChart').getContext('2d');
            if (salesChart) {
                // Atualiza se já existe
                salesChart.data = chartData;
                salesChart.update();
            } else {
                // Cria novo se não existe
                salesChart = new Chart(ctx, {
                    type: 'bar',
                    data: chartData,
                    options: {
                        scales: {
                            y: { beginAtZero: true }
                        }
                    }
                });
            }

            // Caso queira exibir mais detalhes em "botDetailsBody", implemente aqui
            // Exemplo:
            /*
            const botDetailsBody = $('#botDetailsBody');
            botDetailsBody.empty();
            if (data.botDetails && data.botDetails.length > 0) {
                data.botDetails.forEach(bot => {
                    // Exemplo de colunas
                    botDetailsBody.append(`
                        <tr>
                            <td>${bot.botName}</td>
                            <td>R$${bot.valorGerado.toFixed(2)}</td>
                            <td>${bot.totalPurchases}</td>
                            <td>--Planos e conversão--</td>
                            <td>${bot.conversionRate.toFixed(2)}%</td>
                            <td>R$${bot.averageValue.toFixed(2)}</td>
                        </tr>
                    `);
                });
            }
            */
        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    // Atualiza o dashboard quando carrega
    updateDashboard($('#datePicker').val());

    // Re-atualiza ao mudar a data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });
});
