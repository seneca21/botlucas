// public/js/dashboard.js
$(document).ready(function () {
    let salesChart;
    let lineComparisonChart;
    let currentPage = 1;
    let currentPerPage = 10;
    let totalMovementsCount = 0;
    let totalPages = 1;
    let selectedBots = [];
    let currentRevenueValue = 0; // Valor atual do faturamento para o tooltip

    // Variáveis para a aba "Todas as Transações"
    let allCurrentPage = 1;
    let allCurrentPerPage = 10;
    let allTotalMovementsCount = 0;
    let allTotalPages = 1;

    // Cria o seletor de status (usado em "Últimas Transações" no dashboard principal)
    let mobileStatusFilter = $(
        `<select id="movStatusFilter" class="form-control form-control-sm" style="max-width: 150px;">
            <option value="">Todos</option>
            <option value="pending">Pendentes</option>
            <option value="paid">Pagos</option>
            <option value="cancelado">Cancelado</option>
        </select>`
    );

    //------------------------------------------------------------
    // PLUGIN: Background chart
    //------------------------------------------------------------
    const chartBackgroundPlugin = {
        id: 'chartBackground',
        beforeDraw(chart, args, options) {
            const { ctx, chartArea } = chart;
            ctx.save();
            ctx.fillStyle = options.color || '#fff';
            ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
            ctx.restore();
        }
    };
    Chart.register(chartBackgroundPlugin);

    //------------------------------------------------------------
    // DARK MODE
    //------------------------------------------------------------
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
        updateChartsIfExist();
    });

    function updateChartsIfExist() {
        if (salesChart) {
            applyChartOptions(salesChart);
            salesChart.update();
        }
        if (lineComparisonChart) {
            applyChartOptions(lineComparisonChart);
            lineComparisonChart.update();
        }
    }

    function getChartConfigs() {
        const isDark = body.hasClass('dark-mode');
        return {
            backgroundColor: isDark ? '#1e1e1e' : '#fff',
            axisColor: isDark ? '#fff' : '#000',
            gridColor: isDark ? '#555' : '#ccc'
        };
    }

    function applyChartOptions(chartInstance) {
        const cfg = getChartConfigs();
        chartInstance.options.plugins.chartBackground = { color: cfg.backgroundColor };
        if (chartInstance.options.scales) {
            Object.values(chartInstance.options.scales).forEach(scale => {
                if (scale.ticks) scale.ticks.color = cfg.axisColor;
                if (scale.grid) scale.grid.color = cfg.gridColor;
            });
        }
    }

    //------------------------------------------------------------
    // formatDuration
    //------------------------------------------------------------
    function formatDuration(ms) {
        if (ms <= 0) return '0s';
        const totalSec = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return `${minutes}m ${seconds}s`;
    }

    //------------------------------------------------------------
    // PAGINAÇÃO (usada somente em "Todas as Transações")
    //------------------------------------------------------------
    function renderPaginationAll(total, page, perPage) {
        allTotalPages = Math.ceil(total / perPage);
        const paginationContainer = $('#allPaginationContainer');
        paginationContainer.empty();
        if (allTotalPages <= 1) return;

        const group = $('<div class="btn-group btn-group-sm" role="group"></div>');
        const doubleLeft = $('<button class="btn btn-light">&laquo;&laquo;</button>');
        if (page > 10) {
            doubleLeft.on('click', () => {
                allCurrentPage = Math.max(1, page - 10);
                updateAllTransactions(allCurrentPage, allCurrentPerPage);
            });
        } else {
            doubleLeft.prop('disabled', true);
        }
        group.append(doubleLeft);

        const singleLeft = $('<button class="btn btn-light">&laquo;</button>');
        if (page > 1) {
            singleLeft.on('click', () => {
                allCurrentPage = page - 1;
                updateAllTransactions(allCurrentPage, allCurrentPerPage);
            });
        } else {
            singleLeft.prop('disabled', true);
        }
        group.append(singleLeft);

        let startPage = page - 1;
        let endPage = page + 1;
        if (startPage < 1) {
            startPage = 1;
            endPage = 3;
        }
        if (endPage > allTotalPages) {
            endPage = allTotalPages;
            startPage = endPage - 2;
            if (startPage < 1) startPage = 1;
        }
        for (let p = startPage; p <= endPage; p++) {
            const btn = $(`<button class="btn btn-light">${p}</button>`);
            if (p === page) {
                btn.addClass('btn-primary');
            } else {
                btn.on('click', () => {
                    allCurrentPage = p;
                    updateAllTransactions(allCurrentPage, allCurrentPerPage);
                });
            }
            group.append(btn);
        }

        const singleRight = $('<button class="btn btn-light">&raquo;</button>');
        if (page < allTotalPages) {
            singleRight.on('click', () => {
                allCurrentPage = page + 1;
                updateAllTransactions(allCurrentPage, allCurrentPerPage);
            });
        } else {
            singleRight.prop('disabled', true);
        }
        group.append(singleRight);

        const doubleRight = $('<button class="btn btn-light">&raquo;&raquo;</button>');
        if (page + 10 <= allTotalPages) {
            doubleRight.on('click', () => {
                allCurrentPage = Math.min(allTotalPages, page + 10);
                updateAllTransactions(allCurrentPage, allCurrentPerPage);
            });
        } else {
            doubleRight.prop('disabled', true);
        }
        group.append(doubleRight);

        paginationContainer.append(group);
    }

    //------------------------------------------------------------
    // CARREGAR LISTA DE BOTS (para filtros)
    //------------------------------------------------------------
    function loadBotList() {
        fetch('/api/bots-list')
            .then((res) => res.json())
            .then((botNames) => {
                renderBotCheckboxDropdown(botNames);
                renderBotFilterMobile(botNames);
            })
            .catch((err) => console.error('Erro ao carregar bots-list:', err));
    }

    function handleBotFilterChange() {
        currentPage = 1;
        allCurrentPage = 1;
        if ($('#allTransactionsSection').is(':visible')) {
            updateAllTransactions(allCurrentPage, allCurrentPerPage);
        } else {
            refreshDashboard();
        }
    }

    function renderBotCheckboxDropdown(botNames) {
        const container = $('#botFilterContainer');
        container.empty();
        const toggleBtn = $(`
            <button type="button" class="btn btn-sm btn-outline-secondary dropdown-toggle" data-toggle="dropdown">
                Bots
            </button>
        `);
        const checkList = $('<div class="dropdown-menu" style="max-height:250px; overflow:auto;"></div>');
        const allId = 'bot_all';
        const allItem = $(`
            <div class="form-check pl-2">
                <input class="form-check-input" type="checkbox" id="${allId}" value="All">
                <label class="form-check-label" for="${allId}">All</label>
            </div>
        `);
        allItem.find('input').on('change', function () {
            if ($(this).prop('checked')) {
                checkList.find('input[type="checkbox"]').not(`#${allId}`).prop('checked', false);
                selectedBots = ['All'];
            } else {
                selectedBots = [];
            }
            handleBotFilterChange();
        });
        checkList.append(allItem);
        botNames.forEach(bot => {
            const safeId = 'bot_' + bot.replace('@', '_').replace(/\W/g, '_');
            const item = $(`
                <div class="form-check pl-2">
                    <input class="form-check-input" type="checkbox" id="${safeId}" value="${bot}">
                    <label class="form-check-label" for="${safeId}">${bot}</label>
                </div>
            `);
            item.find('input').on('change', function () {
                if ($(this).prop('checked')) {
                    checkList.find(`#${allId}`).prop('checked', false);
                    selectedBots = selectedBots.filter(b => b !== 'All');
                    selectedBots.push(bot);
                } else {
                    selectedBots = selectedBots.filter(b => b !== bot);
                }
                handleBotFilterChange();
            });
            checkList.append(item);
        });
        const dropDiv = $('<div class="dropdown-multi"></div>');
        dropDiv.append(toggleBtn).append(checkList);
        toggleBtn.on('click', function (e) {
            e.stopPropagation();
            checkList.toggleClass('show');
        });
        $(document).on('click', function (e) {
            if (!dropDiv.is(e.target) && dropDiv.has(e.target).length === 0) {
                checkList.removeClass('show');
            }
        });
        container.append(dropDiv);
    }

    function renderBotFilterMobile(botNames) {
        const containerMobile = $('#botFilterContainerMobile');
        if (!containerMobile || containerMobile.length === 0) return;
        containerMobile.empty();
        const selectEl = $(`
            <select id="botFilterSelectorMobile" class="form-control form-control-sm">
                <option value="All">All</option>
            </select>
        `);
        botNames.forEach(bot => {
            const option = $(`<option value="${bot}">${bot}</option>`);
            selectEl.append(option);
        });
        selectEl.on('change', function () {
            const val = $(this).val();
            if (val === 'All') {
                selectedBots = ['All'];
            } else {
                selectedBots = [val];
            }
            handleBotFilterChange();
        });
        containerMobile.append(selectEl);
    }

    //------------------------------------------------------------
    // OBTÉM PARÂMETROS DE DATA
    //------------------------------------------------------------
    function getDateRangeParams() {
        const rangeValue = $('#dateRangeSelector').val();
        if (rangeValue === 'custom') {
            const sDate = $('#startDateInput').val();
            const eDate = $('#endDateInput').val();
            return {
                dateRange: 'custom',
                startDate: sDate,
                endDate: eDate
            };
        }
        return { dateRange: rangeValue };
    }

    //------------------------------------------------------------
    // ATUALIZAR DASHBOARD (Estatísticas do Dia)
    //------------------------------------------------------------
    async function updateDashboard(page, perPage) {
        try {
            const dr = getDateRangeParams();
            const movStatus = $('#movStatusFilter').val() || '';
            let botFilterParam = '';
            if (selectedBots.length > 0) {
                botFilterParam = selectedBots.join(',');
            }
            // Lê o valor do novo filtro de compra
            let purchaseFilter = $('#purchaseFilter').val() || "all";
            // Se estivermos na seção "Planos Detalhados", forçamos o filtro para "all"
            if ($('#statsDetailedSection').is(':visible')) {
                purchaseFilter = "all";
            }
            let url = `/api/bots-stats?page=${page}&perPage=${perPage}`;
            if (movStatus) url += `&movStatus=${movStatus}`;
            if (botFilterParam) url += `&botFilter=${botFilterParam}`;
            url += `&purchaseFilter=${purchaseFilter}`;
            if (dr.dateRange === 'custom') {
                url += `&dateRange=custom&startDate=${dr.startDate}&endDate=${dr.endDate}`;
            } else {
                url += `&dateRange=${dr.dateRange}`;
            }
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            // Atualiza Cards Desktop
            $('#totalUsers').text("R$ " + data.statsAll.totalVendasConvertidas.toFixed(2));
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');
            const avgPayDelayMs = data.statsAll.averagePaymentDelayMs || 0;
            $('#avgPaymentTimeText').text(formatDuration(avgPayDelayMs));

            // Atualiza Cards Mobile
            $('#totalUsersMobile').text("R$ " + data.statsAll.totalVendasConvertidas.toFixed(2));
            $('#totalPurchasesMobile').text(data.statsAll.totalPurchases);
            $('#conversionRateMobile').text(data.statsAll.conversionRate.toFixed(2) + '%');
            $('#avgPaymentTimeTextMobile').text(formatDuration(avgPayDelayMs));

            // Gráfico dos últimos 7 dias
            const lineLabels = (data.stats7Days || []).map(item => {
                const parts = item.date.split('-');
                return `${parts[2]}/${parts[1]}`;
            });
            const convertedValues = (data.stats7Days || []).map(item => item.totalVendasConvertidas);
            const generatedValues = (data.stats7Days || []).map(item => item.totalVendasGeradas);
            const conversionRates = (data.stats7Days || []).map(item => {
                return item.totalVendasGeradas > 0
                    ? (item.totalVendasConvertidas / item.totalVendasGeradas) * 100
                    : 0;
            });
            const lineData = {
                labels: lineLabels,
                datasets: [
                    {
                        label: 'Valor Convertido (R$)',
                        data: convertedValues,
                        fill: false,
                        borderColor: '#ff5c5c',
                        pointBackgroundColor: '#ff5c5c',
                        pointHoverRadius: 6,
                        tension: 0.4,
                        cubicInterpolationMode: 'monotone',
                        yAxisID: 'y-axis-left'
                    },
                    {
                        label: 'Valor Gerado (R$)',
                        data: generatedValues,
                        fill: false,
                        borderColor: '#36A2EB',
                        pointBackgroundColor: '#36A2EB',
                        pointHoverRadius: 6,
                        tension: 0.4,
                        cubicInterpolationMode: 'monotone',
                        yAxisID: 'y-axis-left'
                    },
                    {
                        label: 'Taxa de Conversão (%)',
                        data: conversionRates,
                        fill: false,
                        borderColor: 'green',
                        pointBackgroundColor: 'green',
                        pointHoverRadius: 6,
                        tension: 0.4,
                        cubicInterpolationMode: 'monotone',
                        yAxisID: 'y-axis-left'
                    }
                ]
            };
            const lineCtx = document.getElementById('lineComparisonChart')?.getContext('2d');
            if (lineCtx) {
                if (!lineComparisonChart) {
                    lineComparisonChart = new Chart(lineCtx, {
                        type: 'line',
                        data: lineData,
                        options: {
                            responsive: true,
                            scales: {
                                'y-axis-left': {
                                    type: 'linear',
                                    position: 'left',
                                    beginAtZero: true,
                                    offset: true,
                                    ticks: { display: true }
                                },
                                x: {}
                            },
                            plugins: {
                                chartBackground: {},
                                tooltip: {
                                    callbacks: {
                                        label: function (ctx) {
                                            const value = ctx.parsed.y || 0;
                                            if (ctx.dataset.label === 'Taxa de Conversão (%)') {
                                                return `Taxa: ${value.toFixed(2)}%`;
                                            } else {
                                                return `R$ ${value.toFixed(2)}`;
                                            }
                                        }
                                    }
                                },
                                title: { display: false }
                            }
                        }
                    });
                } else {
                    lineComparisonChart.data = lineData;
                }
                applyChartOptions(lineComparisonChart);
                lineComparisonChart.update();
            }

            // Atualiza a barra de progresso: meta 10K ou 50K conforme faturamento
            const revenue = data.statsTotal.totalVendasConvertidas;
            currentRevenueValue = revenue;
            let target;
            if (revenue < 10000) {
                target = 10000;
                $('.revenue-text strong').text('R$ 0 a 10K');
            } else {
                target = 50000;
                $('.revenue-text strong').text('R$ 0 a 50K');
            }
            const percentage = Math.min((revenue / target) * 100, 100);
            $('.revenue-progress .progress-bar').css('width', percentage + '%');

            // (1) Ajusta a altura do container de "Últimas Transações" para ser igual à altura da box do gráfico
            var chartBoxHeight = $('.chart-box').height();
            $('#lastTransactionsContainer').css('height', chartBoxHeight + 'px');

            // Últimas Transações – reinserindo o título "ÚLTIMAS TRANSAÇÕES" dentro da box
            $('#lastTransactionsContainer').show();
            const container = $('#lastTransactionsContainer');
            container.empty();
            const headerDiv = $(`
                <div class="last-transactions-header">
                    <div class="last-transactions-title">ÚLTIMAS TRANSAÇÕES</div>
                    <div class="last-transactions-filter"></div>
                </div>
            `);
            headerDiv.find('.last-transactions-filter').append(mobileStatusFilter);
            container.append(headerDiv);
            mobileStatusFilter.on('change', function () {
                currentPage = 1;
                refreshDashboard();
            });
            // (2) Exibe apenas 6 transações
            const lastMovs = data.lastMovements || [];
            const displayCount = Math.min(lastMovs.length, 6);
            for (let i = 0; i < displayCount; i++) {
                const mov = lastMovs[i];
                let arrowIcon = '';
                if (mov.status === 'paid') {
                    arrowIcon = '<div class="status-icon paid"><i class="fas fa-arrow-up"></i></div>';
                } else if (mov.status === 'pending') {
                    arrowIcon = '<div class="status-icon pending"><i class="fas fa-arrow-right"></i></div>';
                } else if (mov.status === 'cancelado') {
                    arrowIcon = '<div class="status-icon cancelado" style="background-color:#8B0000;"><i class="fas fa-arrow-down"></i></div>';
                } else {
                    arrowIcon = '<div class="status-icon"><i class="fas fa-question"></i></div>';
                }
                const leadId = mov.User ? mov.User.telegramId : 'N/A';
                const dateGenObj = mov.pixGeneratedAt ? new Date(mov.pixGeneratedAt) : null;
                let dtGen = '';
                if (dateGenObj) {
                    const day = dateGenObj.getDate().toString().padStart(2, '0');
                    const monthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
                    const month = monthNames[dateGenObj.getMonth()];
                    const hour = dateGenObj.getHours().toString().padStart(2, '0');
                    const minute = dateGenObj.getMinutes().toString().padStart(2, '0');
                    dtGen = `${day} ${month} ${hour}:${minute}`;
                }
                const value = mov.planValue.toFixed(2);
                let statusHtml = '';
                if (mov.status === 'paid') {
                    statusHtml = '<div class="sale-status paid-status">PAGO</div>';
                } else if (mov.status === 'pending') {
                    statusHtml = '<div class="sale-status pending-status" style="background-color:#fff9c4;color:#f57f17;">Pendente</div>';
                } else if (mov.status === 'cancelado') {
                    statusHtml = '<div class="sale-status cancelado-status" style="background-color:#cc0000;color:#fff;font-weight:bold;">Cancelado</div>';
                } else {
                    statusHtml = `<div class="sale-status">${mov.status}</div>`;
                }
                let payDelayHtml = '—';
                if (mov.status === 'paid' && mov.purchasedAt && mov.pixGeneratedAt) {
                    const diffMs = new Date(mov.purchasedAt) - new Date(mov.pixGeneratedAt);
                    if (diffMs >= 0) {
                        payDelayHtml = formatDuration(diffMs);
                    }
                }
                const saleCard = `
                    <div class="sale-card">
                        <div class="sale-card-left">
                            ${arrowIcon}
                        </div>
                        <div class="sale-card-center">
                            <div class="sale-lead-id"><strong>${leadId}</strong></div>
                            <div class="sale-date">${dtGen}</div>
                        </div>
                        <div class="sale-card-right">
                            <div class="sale-value">R$ ${value}</div>
                            ${statusHtml}
                        </div>
                    </div>
                `;
                container.append(saleCard);
            }
            // (3) Se houver mais de 6 transações, adiciona a "sale-card" com o botão "Ver Todos"
            if (lastMovs.length > 6) {
                const verTodosCard = `
                    <div class="sale-card ver-todos-card" style="cursor:pointer; background: transparent; border: none;">
                        <div class="sale-card-center" style="width:100%; text-align:center;">Ver Todos</div>
                    </div>
                `;
                container.append(verTodosCard);
                container.find('.ver-todos-card').on('click', function () {
                    $('[data-section="allTransactionsSection"]').click();
                });
            }
        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    //------------------------------------------------------------
    // ATUALIZAR A LISTA "TODAS AS TRANSAÇÕES"
    //------------------------------------------------------------
    async function updateAllTransactions(page, perPage) {
        try {
            const dr = getDateRangeParams();
            const movStatusAll = $('#movStatusFilterAll').val() || '';
            let botFilterParam = '';
            if (selectedBots.length > 0) {
                botFilterParam = selectedBots.join(',');
            }
            const purchaseFilter = $('#purchaseFilter').val() || "all";
            let url = `/api/bots-stats?page=${page}&perPage=${perPage}`;
            if (movStatusAll) url += `&movStatus=${movStatusAll}`;
            if (botFilterParam) url += `&botFilter=${botFilterParam}`;
            url += `&purchaseFilter=${purchaseFilter}`;
            if (dr.dateRange === 'custom') {
                url += `&dateRange=custom&startDate=${dr.startDate}&endDate=${dr.endDate}`;
            } else {
                url += `&dateRange=${dr.dateRange}`;
            }
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();
            const movementsTbody = $('#allTransactionsBody');
            movementsTbody.empty();
            if (data.lastMovements && data.lastMovements.length > 0) {
                data.lastMovements.forEach(mov => {
                    const leadId = mov.User ? mov.User.telegramId : 'N/A';
                    let planCol = 'N/A';
                    if (mov.originCondition === 'not_purchased') {
                        planCol = 'remarketing';
                    } else if (mov.originCondition === 'purchased') {
                        planCol = 'upsell';
                    } else {
                        if (mov.planName && mov.planName.trim() !== '') {
                            planCol = mov.planName;
                        }
                    }
                    let displayDate = '';
                    if (mov.status === 'paid' && mov.purchasedAt) {
                        displayDate = new Date(mov.purchasedAt).toLocaleString('pt-BR');
                    } else if (mov.pixGeneratedAt) {
                        displayDate = new Date(mov.pixGeneratedAt).toLocaleString('pt-BR');
                    }
                    let statusHtml = '';
                    if (mov.status === 'paid') {
                        statusHtml = `<span style="color:green;font-weight:bold;">Paid</span>`;
                    } else if (mov.status === 'pending') {
                        statusHtml = `<span style="color:#ff9900;font-weight:bold;">Pending</span>`;
                    } else if (mov.status === 'cancelado') {
                        statusHtml = `<span style="color:red;font-weight:bold;">Cancelado</span>`;
                    } else {
                        statusHtml = `<span style="font-weight:bold;">${mov.status}</span>`;
                    }
                    let payDelayHtml = '—';
                    if (mov.status === 'paid' && mov.purchasedAt && mov.pixGeneratedAt) {
                        const diffMs = new Date(mov.purchasedAt) - new Date(mov.pixGeneratedAt);
                        if (diffMs >= 0) {
                            payDelayHtml = formatDuration(diffMs);
                        }
                    }
                    movementsTbody.append(`
                        <tr>
                            <td class="remove-mobile">${leadId}</td>
                            <td>${mov.botName || 'N/A'}</td>
                            <td>R$ ${mov.planValue.toFixed(2)}</td>
                            <td class="remove-mobile">${planCol}</td>
                            <td>${displayDate}</td>
                            <td>${statusHtml}</td>
                            <td class="remove-mobile">${payDelayHtml}</td>
                        </tr>
                    `);
                });
            } else {
                movementsTbody.append(`
                    <tr>
                        <td colspan="7">Nenhuma movimentação encontrada</td>
                    </tr>
                `);
            }
            allTotalMovementsCount = data.totalMovements || 0;
            renderPaginationAll(allTotalMovementsCount, page, allCurrentPerPage);
        } catch (err) {
            console.error('Erro no updateAllTransactions:', err);
        }
    }

    //------------------------------------------------------------
    // REFRESH “ESTATÍSTICAS DO DIA”
    //------------------------------------------------------------
    function refreshDashboard() {
        updateDashboard(currentPage, currentPerPage);
    }

    //------------------------------------------------------------
    // Event Listener para o filtro de Tipo de Compra
    //------------------------------------------------------------
    $('#purchaseFilter').on("change", function () {
        currentPage = 1;
        allCurrentPage = 1;
        if ($('#allTransactionsSection').is(':visible')) {
            updateAllTransactions(allCurrentPage, allCurrentPerPage);
        } else {
            refreshDashboard();
        }
    });

    //------------------------------------------------------------
    // Tooltip na barra de progresso (mini card do faturamento)
    //------------------------------------------------------------
    $(document).on('mouseenter', '.revenue-progress', function () {
        $('#progressTooltip')
            .text("Faturamento Total: R$ " + currentRevenueValue.toFixed(2))
            .css({
                top: $(this).offset().top - 40,
                left: $(this).offset().left + ($(this).width() / 2) - 50
            })
            .stop(true, true)
            .fadeIn(200);
    });
    $(document).on('mouseleave', '.revenue-progress', function () {
        $('#progressTooltip').stop(true, true).fadeOut(200);
    });

    //------------------------------------------------------------
    // Carousel para Cards Mobile (Estatísticas do Dia)
    //------------------------------------------------------------
    function initCarouselDots() {
        var $carousel = $('.card-scroll');
        if ($carousel.length === 0) return;
        var numCards = $carousel.find('.card').length;
        var $dotsContainer = $('.carousel-dots');
        $dotsContainer.empty();
        for (var i = 0; i < numCards; i++) {
            $dotsContainer.append('<span class="line-indicator"></span>');
        }
        updateCarouselDots();
        $carousel.on('scroll', function () {
            updateCarouselDots();
        });
    }
    function updateCarouselDots() {
        var $carousel = $('.card-scroll');
        var scrollLeft = $carousel.scrollLeft();
        var cardWidth = $carousel.find('.card').outerWidth(true);
        var index = Math.round(scrollLeft / cardWidth);
        $('.carousel-dots .line-indicator').removeClass('active');
        $('.carousel-dots .line-indicator').eq(index).addClass('active');
    }

    //------------------------------------------------------------
    // EVENT LISTENERS GERAIS
    //------------------------------------------------------------
    $('#movPerPage').on("change", function () {
        currentPerPage = parseInt($(this).val(), 10);
        currentPage = 1;
        refreshDashboard();
    });

    $('#allMovPerPage').on("change", function () {
        allCurrentPerPage = parseInt($(this).val(), 10);
        allCurrentPage = 1;
        updateAllTransactions(allCurrentPage, allCurrentPerPage);
    });

    $('#movStatusFilterAll').on("change", function () {
        allCurrentPage = 1;
        updateAllTransactions(allCurrentPage, allCurrentPerPage);
    });

    $('#dateRangeSelector').on("change", function () {
        if ($(this).val() === "custom") {
            $('#customDateModal').modal("show");
        } else {
            if ($('#allTransactionsSection').is(':visible')) {
                allCurrentPage = 1;
                updateAllTransactions(allCurrentPage, allCurrentPerPage);
            } else {
                currentPage = 1;
                refreshDashboard();
            }
        }
    });
    $('#applyCustomDateBtn').on("click", function () {
        $('#customDateModal').modal("hide");
        if ($('#allTransactionsSection').is(':visible')) {
            allCurrentPage = 1;
            updateAllTransactions(allCurrentPage, allCurrentPerPage);
        } else {
            currentPage = 1;
            refreshDashboard();
        }
    });

    $('#toggleSidebarBtn').on("click", function () {
        $("#sidebar").toggleClass("collapsed");
        $("main[role='main']").toggleClass("expanded");
    });

    $(document).on("click", "#togglePushinToken", function () {
        const field = $('#pushinToken');
        const currentType = field.attr('type');
        field.attr('type', currentType === 'password' ? 'text' : 'password');
    });

    // Removemos o bloco extra de "Ver Todos" que estava fora da box,
    // pois agora o botão é exibido dentro da área de Últimas Transações.

    // Funções de Gerenciar Bots permanecem inalteradas
    function loadExistingBots() {
        fetch('/admin/bots/list')
            .then(response => response.json())
            .then(bots => {
                const tbody = $('#existingBotsBody');
                tbody.empty();
                if (bots.length === 0) {
                    tbody.append('<tr><td colspan="2">Nenhum bot encontrado</td></tr>');
                } else {
                    bots.forEach(bot => {
                        tbody.append(`
                            <tr>
                                <td>${bot.name}</td>
                                <td>
                                    <button class="btn btn-sm btn-info" data-edit-bot="${bot.id}">Editar</button>
                                    <button class="btn btn-sm btn-danger ml-2" data-delete-bot="${bot.id}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        `);
                    });
                }
            })
            .catch(error => {
                console.error("Erro ao carregar bots existentes: ", error);
                $('#existingBotsBody').html('<tr><td colspan="2">Erro ao carregar bots</td></tr>');
            });
    }

    $(document).on("click", "[data-edit-bot]", function () {
        const botId = $(this).attr("data-edit-bot");
        editBot(botId);
    });

    function editBot(botId) {
        $("#editBotForm")[0].reset();
        $("#editBotResponse").empty();
        $("#editBotId").val(botId);
        fetch(`/admin/bots/${botId}`)
            .then(res => {
                if (!res.ok) throw new Error("Bot não encontrado");
                return res.json();
            })
            .then(bot => {
                $("#editBotName").val(bot.name);
                $("#editBotToken").val(bot.token);
                $("#editBotDescription").val(bot.description || "");
                let bjson = [];
                try {
                    bjson = JSON.parse(bot.buttonsJson || "[]");
                } catch (e) { }
                if (bjson[0]) {
                    $("#editButtonName1").val(bjson[0].name);
                    $("#editButtonValue1").val(bjson[0].value);
                    $("#editButtonVipLink1").val(bjson[0].vipLink);
                } else {
                    $("#editButtonName1").val("");
                    $("#editButtonValue1").val("");
                    $("#editButtonVipLink1").val("");
                }
                if (bjson[1]) {
                    $("#editButtonName2").val(bjson[1].name);
                    $("#editButtonValue2").val(bjson[1].value);
                    $("#editButtonVipLink2").val(bjson[1].vipLink);
                } else {
                    $("#editButtonName2").val("");
                    $("#editButtonValue2").val("");
                    $("#editButtonVipLink2").val("");
                }
                if (bjson[2]) {
                    $("#editButtonName3").val(bjson[2].name);
                    $("#editButtonValue3").val(bjson[2].value);
                    $("#editButtonVipLink3").val(bjson[2].vipLink);
                } else {
                    $("#editButtonName3").val("");
                    $("#editButtonValue3").val("");
                    $("#editButtonVipLink3").val("");
                }
                if (bot.remarketingJson) {
                    try {
                        const remarketing = JSON.parse(bot.remarketingJson);
                        if (remarketing.not_purchased) {
                            $("#remarketing_not_purchased_description").val(remarketing.not_purchased.description || "");
                            const npDelay = remarketing.not_purchased.delay || 0;
                            const npMin = Math.floor(npDelay / 60);
                            const npSec = npDelay % 60;
                            $("#edit_remarketing_not_purchased_delay_minutes").val(npMin);
                            $("#edit_remarketing_not_purchased_delay_seconds").val(npSec);
                            const npButtons = remarketing.not_purchased.buttons || [];
                            if (npButtons[0]) {
                                $("#remarketing_not_purchased_buttonName1").val(npButtons[0].name);
                                $("#remarketing_not_purchased_buttonValue1").val(npButtons[0].value);
                                $("#remarketing_not_purchased_buttonLink1").val(npButtons[0].link);
                            }
                            if (npButtons[1]) {
                                $("#remarketing_not_purchased_buttonName2").val(npButtons[1].name);
                                $("#remarketing_not_purchased_buttonValue2").val(npButtons[1].value);
                                $("#remarketing_not_purchased_buttonLink2").val(npButtons[1].link);
                            }
                            if (npButtons[2]) {
                                $("#remarketing_not_purchased_buttonName3").val(npButtons[2].name);
                                $("#remarketing_not_purchased_buttonValue3").val(npButtons[2].value);
                                $("#remarketing_not_purchased_buttonLink3").val(npButtons[2].link);
                            }
                        }
                        if (remarketing.purchased) {
                            $("#remarketing_purchased_description").val(remarketing.purchased.description || "");
                            const pDelay = remarketing.purchased.delay || 0;
                            const pMin = Math.floor(pDelay / 60);
                            const pSec = pDelay % 60;
                            $("#edit_remarketing_purchased_delay_minutes").val(pMin);
                            $("#edit_remarketing_purchased_delay_seconds").val(pSec);
                            const pButtons = remarketing.purchased.buttons || [];
                            if (pButtons[0]) {
                                $("#remarketing_purchased_buttonName1").val(pButtons[0].name);
                                $("#remarketing_purchased_buttonValue1").val(pButtons[0].value);
                                $("#remarketing_purchased_buttonLink1").val(pButtons[0].link);
                            }
                            if (pButtons[1]) {
                                $("#remarketing_purchased_buttonName2").val(pButtons[1].name);
                                $("#remarketing_purchased_buttonValue2").val(pButtons[1].value);
                                $("#remarketing_purchased_buttonLink2").val(pButtons[1].link);
                            }
                            if (pButtons[2]) {
                                $("#remarketing_purchased_buttonName3").val(pButtons[2].name);
                                $("#remarketing_purchased_buttonValue3").val(pButtons[2].value);
                                $("#remarketing_purchased_buttonLink3").val(pButtons[2].link);
                            }
                        }
                    } catch (e) {
                        console.error("Erro ao parse remarketingJson", e);
                    }
                }
                $('#editBotArea').removeClass("d-none");
            })
            .catch(err => {
                $('#editBotResponse').html(`<div class="alert alert-danger">${err.message}</div>`);
            });
    }

    $('#cancelEditBotBtn').on("click", function () {
        $('#editBotArea').addClass("d-none");
    });

    $('#editBotForm').on("submit", function (e) {
        e.preventDefault();
        const botId = $('#editBotId').val();
        if (!botId) {
            $('#editBotResponse').html(`<div class="alert alert-danger">ID não encontrado</div>`);
            return;
        }
        const formData = new FormData(this);
        fetch(`/admin/bots/edit/${botId}`, {
            method: "POST",
            body: formData
        })
            .then(async (res) => {
                if (!res.ok) {
                    const textErr = await res.text();
                    throw new Error(textErr);
                }
                return res.text();
            })
            .then((htmlResp) => {
                $('#editBotResponse').html(htmlResp);
                loadExistingBots();
                loadBotList();
            })
            .catch((err) => {
                $('#editBotResponse').html(`<div class="alert alert-danger">${err.message}</div>`);
            });
    });

    $(document).on("click", "[data-delete-bot]", function () {
        const botId = $(this).attr("data-delete-bot");
        const confirmation = confirm(`Você tem certeza que deseja excluir o bot ID ${botId}?`);
        if (!confirmation) return;
        fetch(`/admin/bots/${botId}`, {
            method: "DELETE"
        })
            .then(async (res) => {
                if (!res.ok) {
                    const msg = await res.text();
                    throw new Error(msg);
                }
                return res.text();
            })
            .then(resp => {
                alert(resp);
                loadExistingBots();
            })
            .catch(err => {
                alert(err.message);
            });
    });

    // Cadastrar Novo Bot
    $('#addBotForm').on("submit", function (e) {
        e.preventDefault();
        $('#botTokenInput').removeClass('is-invalid');
        $('#addBotResponse').empty();
        const formData = new FormData(this);
        fetch("/admin/bots", {
            method: "POST",
            body: formData
        })
            .then(async res => {
                if (!res.ok) {
                    const textErr = await res.text();
                    if (textErr.includes('Este token já está sendo usado')) {
                        $('#botTokenInput').addClass('is-invalid');
                    }
                    throw new Error(textErr);
                }
                return res.text();
            })
            .then(respHtml => {
                $('#addBotResponse').html(respHtml);
                $('#addBotForm')[0].reset();
                loadExistingBots();
                loadBotList();
            })
            .catch(err => {
                $('#addBotResponse').html(`<div class="alert alert-danger">${err.message}</div>`);
            });
    });

    //------------------------------------------------------------
    // Aba lateral: clique
    //------------------------------------------------------------
    $('#sidebarNav .nav-link').on("click", function (e) {
        e.preventDefault();
        $('#sidebarNav .nav-link').removeClass('active clicked');
        $(this).addClass('active clicked');
        $('#statsSection, #rankingSimplesSection, #rankingDetalhadoSection, #statsDetailedSection, #manageBotsSection, #paymentSection, #allTransactionsSection')
            .addClass('d-none');
        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
        if (targetSection === 'manageBotsSection') {
            loadExistingBots();
        } else if (targetSection === 'paymentSection') {
            loadPaymentSetting();
        } else if (targetSection === 'allTransactionsSection') {
            updateAllTransactions(allCurrentPage, allCurrentPerPage);
        } else {
            refreshDashboard();
        }
        if (targetSection === 'manageBotsSection' || targetSection === 'paymentSection') {
            $('#dateFilterContainer').hide();
        } else {
            $('#dateFilterContainer').show();
        }
        // Se a seção for "Planos Detalhados", esconda o filtro de planos
        if (targetSection === 'statsDetailedSection') {
            $('#purchaseFilter').hide();
        } else {
            $('#purchaseFilter').show();
        }
        if (targetSection === 'statsSection'
            || targetSection === 'statsDetailedSection'
            || targetSection === 'allTransactionsSection'
            || targetSection === 'rankingSimplesSection'
            || targetSection === 'rankingDetalhadoSection') {
            if ($(window).width() < 768) {
                $('#botFilterContainer').hide();
                $('#botFilterContainerMobile').show();
            } else {
                $('#botFilterContainer').show();
                $('#botFilterContainerMobile').hide();
            }
        } else {
            $('#botFilterContainer').hide();
            $('#botFilterContainerMobile').hide();
        }
    });

    //------------------------------------------------------------
    // PaymentSetting
    //------------------------------------------------------------
    function loadPaymentSetting() {
        fetch("/admin/payment-setting")
            .then((res) => res.json())
            .then((data) => {
                $('#pushinToken').val(data.pushinToken || "");
            })
            .catch((err) => {
                console.error("Erro ao carregar PaymentSetting:", err);
            });
    }

    $('#paymentSettingForm').on("submit", function (e) {
        e.preventDefault();
        const pushinToken = $('#pushinToken').val().trim();
        if (!pushinToken) {
            $('#paymentSettingResponse').html(`<div class="alert alert-danger">Campo token é obrigatório.</div>`);
            return;
        }
        fetch("/admin/payment-setting", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pushinToken })
        })
            .then(async (res) => {
                if (!res.ok) {
                    const t = await res.json();
                    throw new Error(t.error || "Erro ao salvar token");
                }
                return res.json();
            })
            .then((resp) => {
                if (resp.success) {
                    $('#paymentSettingResponse').html(`<div class="alert alert-success">Token salvo com sucesso!</div>`);
                }
            })
            .catch((err) => {
                $('#paymentSettingResponse').html(`<div class="alert alert-danger">${err.message}</div>`);
            });
    });

    //------------------------------------------------------------
    // Carousel para Cards Mobile (Estatísticas do Dia)
    //------------------------------------------------------------
    function initCarouselDots() {
        var $carousel = $('.card-scroll');
        if ($carousel.length === 0) return;
        var numCards = $carousel.find('.card').length;
        var $dotsContainer = $('.carousel-dots');
        $dotsContainer.empty();
        for (var i = 0; i < numCards; i++) {
            $dotsContainer.append('<span class="line-indicator"></span>');
        }
        updateCarouselDots();
        $carousel.on('scroll', function () {
            updateCarouselDots();
        });
    }
    function updateCarouselDots() {
        var $carousel = $('.card-scroll');
        var scrollLeft = $carousel.scrollLeft();
        var cardWidth = $carousel.find('.card').outerWidth(true);
        var index = Math.round(scrollLeft / cardWidth);
        $('.carousel-dots .line-indicator').removeClass('active');
        $('.carousel-dots .line-indicator').eq(index).addClass('active');
    }

    //------------------------------------------------------------
    // Inicialização
    //------------------------------------------------------------
    loadBotList();
    refreshDashboard();
    if ($(window).width() < 768) {
        $('#botFilterContainer').hide();
        $('#botFilterContainerMobile').show();
        initCarouselDots();
    } else {
        $('#botFilterContainer').show();
        $('#botFilterContainerMobile').hide();
    }
});