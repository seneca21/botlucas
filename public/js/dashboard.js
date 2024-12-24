$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;

    // Função principal de atualização
    async function updateDashboard(date) {
        try {
            const response = await fetch(`/api/bots-stats?date=${date}`);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }

            const data = await response.json();
            console.log('Dados recebidos:', data);

            // Estatísticas básicas
            $('#totalUsers').text(data.totalUsers);
            $('#totalPurchases').text(data.totalPurchases);
            $('#conversionRate').text(data.conversionRate.toFixed(2) + '%');

            // Gráfico
            const chartData = {
                labels: ['Usuários', 'Compras'],
                datasets: [{
                    label: 'Quantidade',
                    data: [data.totalUsers, data.totalPurchases],
                    backgroundColor: ['#36A2EB', '#4BC0C0']
                }]
            };
            const ctx = document.getElementById('salesChart').getContext('2d');
            if (salesChart) {
                salesChart.data = chartData;
                salesChart.update();
            } else {
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

            // Ranking Simples (botRanking)
            const botRankingTbody = $('#botRanking');
            botRankingTbody.empty();
            // Se quiser exibir um ranking simples,
            // podemos criar um "botRanking" no backend (ARRAY) ou exibir parte do "botDetails".
            // Exemplo hipotético: data.botRanking
            // Mas no seu app, você não tinha "botRanking"? Então crie no backend ou aproveite data.botDetails.

            // Exemplo: se usarmos data.botDetails para exibir "botName" e "totalPurchases":
            // Filtra para Ranking Simples
            if (data.botDetails) {
                data.botDetails.forEach(bot => {
                    botRankingTbody.append(`
                        <tr>
                            <td>${bot.botName}</td>
                            <td>${bot.totalPurchases}</td>
                        </tr>
                    `);
                });
            }

            // Ranking Detalhado (botDetailsBody)
            const detailsTbody = $('#botDetailsBody');
            detailsTbody.empty();

            if (data.botDetails) {
                data.botDetails.forEach(bot => {
                    // Monta a lista de planos
                    let plansHtml = '';
                    bot.plans.forEach(plan => {
                        plansHtml += `${plan.planName}: ${plan.salesCount} vendas (${plan.conversionRate.toFixed(2)}%)<br>`;
                    });

                    detailsTbody.append(`
                        <tr>
                            <td>${bot.botName}</td>
                            <td>R$${bot.valorGerado.toFixed(2)}</td>
                            <td>${bot.totalPurchases}</td>
                            <td>${plansHtml}</td>
                            <td>${bot.conversionRate.toFixed(2)}%</td>
                            <td>R$${bot.averageValue.toFixed(2)}</td>
                        </tr>
                    `);
                });
            }

        } catch (error) {
            console.error('Erro ao atualizar o dashboard:', error);
        }
    }

    // 1) Atualiza ao carregar
    updateDashboard($('#datePicker').val());

    // 2) Atualiza ao mudar data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });

    // 3) Lógica de Sidebar: troca visibilidade das sections
    $('#sidebarNav .nav-link').on('click', function (e) {
        e.preventDefault();

        // Remove 'active' das links
        $('#sidebarNav .nav-link').removeClass('active');
        $(this).addClass('active');

        // Esconde todas as sections
        $('#statsSection').addClass('d-none');
        $('#rankingSimplesSection').addClass('d-none');
        $('#rankingDetalhadoSection').addClass('d-none');

        // Mostra apenas a section clicada
        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
    });
});
