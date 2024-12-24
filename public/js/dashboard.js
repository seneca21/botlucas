// public/js/dashboard.js
$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart; // Gráfico principal (Usuários x Compras)

    // Gráficos da aba "Estatísticas do Dia Detalhado"
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
            console.log('Dados recebidos:', data);

            //-----------------------------------------
            // SEÇÃO 1: Estatísticas do Dia (statsSection)
            //-----------------------------------------
            $('#totalUsers').text(data.totalUsers);
            $('#totalPurchases').text(data.totalPurchases);
            $('#conversionRate').text(data.conversionRate.toFixed(2) + '%');

            // Gráfico principal
            const chartData = {
                labels: ['Usuários', 'Compras'],
                datasets: [
                    {
                        label: 'Quantidade',
                        data: [data.totalUsers, data.totalPurchases],
                        backgroundColor: ['#36A2EB', '#4BC0C0']
                    }
                ]
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

            //-----------------------------------------
            // RANKING SIMPLES (rankingSimplesSection)
            //-----------------------------------------
            const botRankingTbody = $('#botRanking');
            botRankingTbody.empty();
            // data.botRanking é do "ranking simples"
            if (data.botRanking && data.botRanking.length) {
                data.botRanking.forEach((rank) => {
                    botRankingTbody.append(`
                        <tr>
                            <td>${rank.botName || 'N/A'}</td>
                            <td>${rank.vendas}</td>
                        </tr>
                    `);
                });
            }

            //-----------------------------------------
            // RANKING DETALHADO (rankingDetalhadoSection)
            //-----------------------------------------
            const detailsTbody = $('#botDetailsBody');
            detailsTbody.empty();
            if (data.botDetails && data.botDetails.length) {
                data.botDetails.forEach((bot) => {
                    let plansHtml = '';
                    bot.plans.forEach((plan) => {
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

            //-----------------------------------------
            // ABA "Estatísticas do Dia Detalhado"
            // Precisamos de:
            //  data.totalLeads,
            //  data.pagamentosConfirmados,
            //  data.taxaConversao,
            //  data.totalVendasGeradas,
            //  data.totalVendasConvertidas
            //-----------------------------------------
            const totalLeads = data.totalLeads || 0;
            const pagamentosConfirmados = data.pagamentosConfirmados || 0;
            const taxaConversao = data.taxaConversao || 0;
            const totalVendasGeradas = data.totalVendasGeradas || 0;
            const totalVendasConvertidas = data.totalVendasConvertidas || 0;

            // chartLeads
            const leadsCtx = document.getElementById('chartLeads').getContext('2d');
            const leadsConfig = {
                type: 'doughnut',
                data: {
                    labels: ['Leads'],
                    datasets: [
                        {
                            data: [totalLeads],
                            backgroundColor: ['#FF6384']
                        }
                    ]
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Total de Leads'
                        }
                    }
                }
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
                            data: [pagamentosConfirmados],
                            backgroundColor: ['#36A2EB']
                        }
                    ]
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Pagamentos Confirmados'
                        }
                    }
                }
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
                            data: [taxaConversao],
                            backgroundColor: ['#FFCE56']
                        }
                    ]
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Taxa de Conversão (%)'
                        }
                    }
                }
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
                            data: [totalVendasGeradas],
                            backgroundColor: ['#4BC0C0']
                        }
                    ]
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Total Vendas Geradas (R$)'
                        }
                    }
                }
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
                            data: [totalVendasConvertidas],
                            backgroundColor: ['#9966FF']
                        }
                    ]
                },
                options: {
                    plugins: {
                        title: {
                            display: true,
                            text: 'Vendas Convertidas (R$)'
                        }
                    }
                }
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

    // Atualiza ao carregar
    updateDashboard($('#datePicker').val());

    // Atualiza ao mudar data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });

    // Sidebar: troca as seções
    $('#sidebarNav .nav-link').on('click', function (e) {
        e.preventDefault();

        // remove active
        $('#sidebarNav .nav-link').removeClass('active');
        $(this).addClass('active');

        // esconde as sections
        $('#statsSection').addClass('d-none');
        $('#rankingSimplesSection').addClass('d-none');
        $('#rankingDetalhadoSection').addClass('d-none');
        $('#statsDayDetailSection').addClass('d-none'); // nova aba

        // mostra a section alvo
        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
    });
});
