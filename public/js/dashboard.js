// public/js/dashboard.js
$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;

    async function updateDashboard(date) {
        try {
            const response = await fetch(`/api/bots-stats?date=${date}`);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            //-------------------------------------------
            // 1) Estatísticas do Dia (Aba statsSection)
            //-------------------------------------------
            $('#totalUsers').text(data.statsAll.totalUsers);
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');

            // Gráfico Bar (usuários x compras)
            const chartData = {
                labels: ['Usuários', 'Compras'],
                datasets: [
                    {
                        label: 'Quantidade',
                        data: [data.statsAll.totalUsers, data.statsAll.totalPurchases],
                        backgroundColor: ['#36A2EB', '#4BC0C0'],
                    },
                ],
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
                            y: { beginAtZero: true },
                        },
                    },
                });
            }

            //-------------------------------------------
            // 2) Ranking Simples (Aba rankingSimplesSection)
            //-------------------------------------------
            const botRankingTbody = $('#botRanking');
            botRankingTbody.empty();
            if (data.botRanking && data.botRanking.length > 0) {
                data.botRanking.forEach((bot) => {
                    botRankingTbody.append(`
            <tr>
              <td>${bot.botName || 'N/A'}</td>
              <td>${bot.vendas}</td>
            </tr>
          `);
                });
            }

            //-------------------------------------------
            // 3) Ranking Detalhado (Aba rankingDetalhadoSection)
            //-------------------------------------------
            const detailsTbody = $('#botDetailsBody');
            detailsTbody.empty();
            if (data.botDetails && data.botDetails.length > 0) {
                data.botDetails.forEach((bot) => {
                    let plansHtml = '';
                    bot.plans.forEach((plan) => {
                        plansHtml += `${plan.planName}: ${plan.salesCount} vendas (${plan.conversionRate.toFixed(
                            2
                        )}%)<br>`;
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

            //-------------------------------------------
            // 4) Estatísticas do Dia (Detalhado) - 4 colunas
            //-------------------------------------------
            // (A) statsAll
            $('#cardAllLeads').text(data.statsAll.totalUsers);
            $('#cardAllPaymentsConfirmed').text(data.statsAll.totalPurchases);
            $('#cardAllConversionRateDetailed').text(
                data.statsAll.conversionRate.toFixed(2) + '%'
            );
            $('#cardAllTotalVolume').text(
                'R$ ' + data.statsAll.totalVendasGeradas.toFixed(2)
            );
            $('#cardAllTotalPaidVolume').text(
                'R$ ' + data.statsAll.totalVendasConvertidas.toFixed(2)
            );

            // (B) statsMain
            $('#cardMainLeads').text(data.statsMain.totalUsers);
            $('#cardMainPaymentsConfirmed').text(data.statsMain.totalPurchases);
            $('#cardMainConversionRateDetailed').text(
                data.statsMain.conversionRate.toFixed(2) + '%'
            );
            $('#cardMainTotalVolume').text(
                'R$ ' + data.statsMain.totalVendasGeradas.toFixed(2)
            );
            $('#cardMainTotalPaidVolume').text(
                'R$ ' + data.statsMain.totalVendasConvertidas.toFixed(2)
            );

            // (C) statsNotPurchased
            $('#cardNotPurchasedLeads').text(data.statsNotPurchased.totalUsers);
            $('#cardNotPurchasedPaymentsConfirmed').text(
                data.statsNotPurchased.totalPurchases
            );
            $('#cardNotPurchasedConversionRateDetailed').text(
                data.statsNotPurchased.conversionRate.toFixed(2) + '%'
            );
            $('#cardNotPurchasedTotalVolume').text(
                'R$ ' + data.statsNotPurchased.totalVendasGeradas.toFixed(2)
            );
            $('#cardNotPurchasedTotalPaidVolume').text(
                'R$ ' + data.statsNotPurchased.totalVendasConvertidas.toFixed(2)
            );

            // (D) statsPurchased
            $('#cardPurchasedLeads').text(data.statsPurchased.totalUsers);
            $('#cardPurchasedPaymentsConfirmed').text(
                data.statsPurchased.totalPurchases
            );
            $('#cardPurchasedConversionRateDetailed').text(
                data.statsPurchased.conversionRate.toFixed(2) + '%'
            );
            $('#cardPurchasedTotalVolume').text(
                'R$ ' + data.statsPurchased.totalVendasGeradas.toFixed(2)
            );
            $('#cardPurchasedTotalPaidVolume').text(
                'R$ ' + data.statsPurchased.totalVendasConvertidas.toFixed(2)
            );
        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    // (A) Atualiza ao carregar
    updateDashboard($('#datePicker').val());

    // (B) Atualiza ao mudar data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });

    // (C) Lógica de Sidebar para trocar seções
    $('#sidebarNav .nav-link').on('click', function (e) {
        e.preventDefault();
        $('#sidebarNav .nav-link').removeClass('active');
        $(this).addClass('active');

        $('#statsSection').addClass('d-none');
        $('#rankingSimplesSection').addClass('d-none');
        $('#rankingDetalhadoSection').addClass('d-none');
        $('#statsDetailedSection').addClass('d-none');

        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
    });

    // (D) Ícone hambúrguer -> recolhe/expande sidebar
    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
    });
});
