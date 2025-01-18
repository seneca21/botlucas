// public/js/dashboard.js

$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;
    let lineComparisonChart;

    // ======== TEMA (DARK MODE) ========
    const body = $('body');
    const themeBtn = $('#themeToggleBtn');
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        body.addClass('dark-mode');
        themeBtn.text('☀');
    }

    themeBtn.on('click', function () {
        if (body.hasClass('dark-mode')) {
            body.removeClass('dark-mode');
            themeBtn.text('🌙');
            localStorage.setItem('theme', 'light');
        } else {
            body.addClass('dark-mode');
            themeBtn.text('☀');
            localStorage.setItem('theme', 'dark');
        }
    });

    // ======== TROCA DE SEÇÕES DO SIDEBAR ========
    $('#sidebarNav .nav-link').on('click', function (e) {
        e.preventDefault();
        $('#sidebarNav .nav-link').removeClass('active clicked');
        $(this).addClass('active clicked');

        $('#statsSection').addClass('d-none');
        $('#rankingSimplesSection').addClass('d-none');
        $('#rankingDetalhadoSection').addClass('d-none');
        $('#statsDetailedSection').addClass('d-none');

        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
    });

    // ======== TOGGLE SIDEBAR => SE EXPANDE O MAIN ========
    $('#toggleSidebarBtn').on('click', function () {
        // 1) Oculta/mostra o sidebar com d-none
        $('#sidebar').toggleClass('d-none');

        // 2) Se o sidebar está oculto, o main vira col-md-12 col-lg-12
        if ($('#sidebar').hasClass('d-none')) {
            // Expand main
            $('#mainContent')
                .removeClass('col-md-9 col-lg-10')
                .addClass('col-md-12 col-lg-12');
        } else {
            // Retorna ao normal
            $('#mainContent')
                .removeClass('col-md-12 col-lg-12')
                .addClass('col-md-9 col-lg-10');
        }
    });

    // ======== ATUALIZA DASHBOARD COM DADOS DA API ========
    async function updateDashboard(date) {
        try {
            const response = await fetch(`/api/bots-stats?date=${date}`);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            // (A) Estatísticas do Dia
            $('#totalUsers').text(data.statsAll.totalUsers);
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');

            // (B) Gráfico de Barras
            const barData = {
                labels: ['Usuários', 'Compras'],
                datasets: [
                    {
                        label: 'Quantidade',
                        data: [data.statsAll.totalUsers, data.statsAll.totalPurchases],
                        backgroundColor: ['#36A2EB', '#4BC0C0'],
                    },
                ],
            };
            const barCtx = document.getElementById('salesChart').getContext('2d');
            if (!salesChart) {
                salesChart = new Chart(barCtx, {
                    type: 'bar',
                    data: barData,
                    options: {
                        scales: {
                            y: { beginAtZero: true },
                        },
                    },
                });
            } else {
                salesChart.data = barData;
                salesChart.update();
            }

            // (C) Gráfico de Linha (Ontem vs Hoje)
            const lineData = {
                labels: ['Ontem', 'Hoje'],
                datasets: [
                    {
                        label: 'Valor Convertido (R$)',
                        data: [
                            data.statsYesterday.totalVendasConvertidas,
                            data.statsAll.totalVendasConvertidas,
                        ],
                        fill: false,
                        borderColor: '#ff5c5c',
                        pointBackgroundColor: '#ff5c5c',
                        pointHoverRadius: 7,
                        tension: 0.2,
                    },
                ],
            };
            const lineCtx = document.getElementById('lineComparisonChart').getContext('2d');
            if (!lineComparisonChart) {
                lineComparisonChart = new Chart(lineCtx, {
                    type: 'line',
                    data: lineData,
                    options: {
                        responsive: true,
                        scales: {
                            y: { beginAtZero: false },
                        },
                    },
                });
            } else {
                lineComparisonChart.data = lineData;
                lineComparisonChart.update();
            }

            // (D) Ranking Simples
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

            // (E) Ranking Detalhado
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

            // (F) Estatísticas Detalhadas (4 colunas)
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

    // Ao carregar
    updateDashboard($('#datePicker').val());

    // Ao mudar data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });
});
