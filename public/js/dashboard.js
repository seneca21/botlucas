$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart; // gráfico principal da 1ª aba

    // Novos gráficos na aba "statsDayDetailSection"
    let chartLeads;
    let chartPagamentos;
    let chartTaxaConversao;
    let chartVendasGeradas;
    let chartVendasConvertidas;

    async function updateDashboard(date) {
        try {
            const response = await fetch(`/api/bots-stats?date=${date}`);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            // -------------------------------
            // SEÇÃO 1: Estatísticas do Dia
            // -------------------------------
            $('#totalUsers').text(data.totalUsers);
            $('#totalPurchases').text(data.totalPurchases);
            $('#conversionRate').text(data.conversionRate.toFixed(2) + '%');

            // Gráfico principal (Usuários x Compras)
            const chartData = {
                labels: ['Usuários', 'Compras'],
                datasets: [{
                    label: 'Quantidade',
                    data: [data.totalUsers, data.totalPurchases],
                    backgroundColor: ['#36A2EB', '#4BC0C0'],
                }],
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

            // -------------------------------
            // Ranking Simples
            // -------------------------------
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

            // -------------------------------
            // Ranking Detalhado
            // -------------------------------
            const detailsTbody = $('#botDetailsBody');
            detailsTbody.empty();
            if (data.botDetails && data.botDetails.length > 0) {
                data.botDetails.forEach(bot => {
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

            // -------------------------------
            // SEÇÃO "Estatísticas do Dia Detalhado"
            // Precisamos de 5 métricas:
            //   totalLeads, pagamentosConfirmados,
            //   taxaConversao, totalVendasGeradas,
            //   totalVendasConvertidas
            // -------------------------------
            const {
                totalLeads,
                pagamentosConfirmados,
                taxaConversao,
                totalVendasGeradas,
                totalVendasConvertidas
            } = data;

            // chartLeads (exemplo: doughnut)
            const leadsCtx = document.getElementById('chartLeads').getContext('2d');
            const leadsConfig = {
                type: 'doughnut',
                data: {
                    labels: ['Leads'],
                    datasets: [
                        {
                            data: [totalLeads || 0],
                            backgroundColor: ['#FF6384'],
                        },
                    ],
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Total Leads',
                        },
                    },
                },
            };
            if (chartLeads) {
                chartLeads.data = leadsConfig.data;
                chartLeads.update();
            } else {
                chartLeads = new Chart(leadsCtx, leadsConfig);
            }

            // chartPagamentos
            const pgCtx = document.getElementById('chartPagamentos').getContext('2d');
            const pgConfig = {
                type: 'doughnut',
                data: {
                    labels: ['Pagamentos'],
                    datasets: [
                        {
                            data: [pagamentosConfirmados || 0],
                            backgroundColor: ['#36A2EB'],
                        },
                    ],
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Pagamentos Confirmados',
                        },
                    },
                },
            };
            if (chartPagamentos) {
                chartPagamentos.data = pgConfig.data;
                chartPagamentos.update();
            } else {
                chartPagamentos = new Chart(pgCtx, pgConfig);
            }

            // chartTaxaConversao
            const txCtx = document.getElementById('chartTaxaConversao').getContext('2d');
            const txConfig = {
                type: 'doughnut',
                data: {
                    labels: ['Taxa %'],
                    datasets: [
                        {
                            data: [taxaConversao || 0],
                            backgroundColor: ['#FFCE56'],
                        },
                    ],
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Taxa Conversão (%)',
                        },
                    },
                },
            };
            if (chartTaxaConversao) {
                chartTaxaConversao.data = txConfig.data;
                chartTaxaConversao.update();
            } else {
                chartTaxaConversao = new Chart(txCtx, txConfig);
            }

            // chartVendasGeradas
            const vgCtx = document.getElementById('chartVendasGeradas').getContext('2d');
            const vgConfig = {
                type: 'doughnut',
                data: {
                    labels: ['Vendas Geradas (R$)'],
                    datasets: [
                        {
                            data: [totalVendasGeradas || 0],
                            backgroundColor: ['#4BC0C0'],
                        },
                    ],
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Total Vendas Geradas (R$)',
                        },
                    },
                },
            };
            if (chartVendasGeradas) {
                chartVendasGeradas.data = vgConfig.data;
                chartVendasGeradas.update();
            } else {
                chartVendasGeradas = new Chart(vgCtx, vgConfig);
            }

            // chartVendasConvertidas
            const vcCtx = document.getElementById('chartVendasConvertidas').getContext('2d');
            const vcConfig = {
                type: 'doughnut',
                data: {
                    labels: ['Vendas Convertidas (R$)'],
                    datasets: [
                        {
                            data: [totalVendasConvertidas || 0],
                            backgroundColor: ['#9966FF'],
                        },
                    ],
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Vendas Convertidas (R$)',
                        },
                    },
                },
            };
            if (chartVendasConvertidas) {
                chartVendasConvertidas.data = vcConfig.data;
                chartVendasConvertidas.update();
            } else {
                chartVendasConvertidas = new Chart(vcCtx, vcConfig);
            }

        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    // 1) Atualiza ao carregar
    updateDashboard($('#datePicker').val());

    // 2) Atualiza ao mudar a data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });

    // 3) Lógica de Sidebar para trocar seções
    $('#sidebarNav .nav-link').on('click', function (e) {
        e.preventDefault();

        // remove 'active' de todos
        $('#sidebarNav .nav-link').removeClass('active');
        $(this).addClass('active');

        // esconde as sections
        $('#statsSection').addClass('d-none');
        $('#rankingSimplesSection').addClass('d-none');
        $('#rankingDetalhadoSection').addClass('d-none');
        $('#statsDayDetailSection').addClass('d-none'); // nova

        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
    });
});
