document.addEventListener("DOMContentLoaded", () => {
    // BANCO DE DADOS DA TNM (EDIÇÃO DE ESTUDO)
    const BIBLE_DATABASE = {
        "sal. 31:5": "Tu me resgataste, ó Jeová, Deus da verdade.",
        "salmos 31:5": "Tu me resgataste, ó Jeová, Deus da verdade.",
        "salmo 31:5": "Tu me resgataste, ó Jeová, Deus da verdade.",
        "tit. 1:2": "Baseados numa esperança de vida eterna que o Deus, que não pode mentir, prometeu há muito tempo.",
        "tito 1:2": "Baseados numa esperança de vida eterna que o Deus, que não pode mentir, prometeu há muito tempo.",
        "heb. 6:18": "Para que... por meio de duas coisas imutáveis, nas quais é impossível que Deus minta, nós... tivéssemos forte encorajamento."
    };

    const defaultData = {
        activeWeekId: "semana_8_junho",
        weeks: {
            "semana_8_junho": {
                id: "semana_8_junho",
                title: "8-14 DE JUNHO DE 2026 | O \"Deus da verdade\" sempre cumpre o que promete",
                textoBiblicoSemana: "\"O teu parecer é o que me guia... Prepara o teu coração para assimilar as joias espirituais da lição desta semana.\"",
                imageUrlCapa: "https://cms-imgp.jw-cdn.org/img/p/1011202/univ/art/1011202_univ_lsr_lg.jpg",
                totalParagraphs: 16,
                recap: {
                    q1: "Por que podemos confiar no \"Deus da verdade\"?", a1: "",
                    q2: "Como Jeová vai acabar com o mundo mau de Satanás e o que Ele está fazendo agora para cumprir seu propósito?", a2: "",
                    q3: "Por que temos certeza que nada pode impedir Jeová de agir?", a3: ""
                },
                paragraphs: {
                    "1": { 
                        imageUrl: "", 
                        imageComment: "", 
                        revistaTexto: "1. Imagine que um amigo muito achegado prometa fazer algo para ajudar você...", 
                        bibleTexts: [
                            { ref: "Sal. 31:5", transcription: "" },
                            { ref: "Tit. 1:2", transcription: "" }
                        ],
                        textual: "Análise baseada em Salmo 31:5 e Tito 1:2. O princípio central é a imutabilidade da palavra de *Jeová*, o 'Deus da verdade'.", 
                        resposta: "Podemos confiar plenamente em Jeová porque Ele é o Deus da verdade.", 
                        pastoral: "Na vida pessoal, essa verdade protege nosso coração contra as incertezas." 
                    }
                }
            }
        },
        customBibleVerses: {}
    };

    // SISTEMA DE SEGURANÇA DUPLA (Anti-perda de dados)
    let appState;
    try {
        const localData = localStorage.getItem("sentinela_v8_data");
        const sessionData = sessionStorage.getItem("sentinela_v8_backup");
        if (localData) {
            appState = JSON.parse(localData);
        } else if (sessionData) {
            appState = JSON.parse(sessionData);
            localStorage.setItem("sentinela_v8_data", sessionData);
            alert("⚠️ Seus dados haviam sido resetados, mas a Cópia Oculta restaurou seu progresso com sucesso!");
        } else {
            appState = defaultData;
        }
    } catch(e) {
        appState = defaultData;
    }

    let activeParagraph = "1";
    let isCoverActive = true;

    // Mapeamento do DOM
    const selectWeek = document.getElementById("select-week");
    const btnAddWeek = document.getElementById("btn-add-week");
    const btnDelWeek = document.getElementById("btn-del-week");
    const labelTotalP = document.getElementById("label-total-p");
    const btnAddP = document.getElementById("btn-add-p");
    const btnRemoveP = document.getElementById("btn-remove-p");
    const paragraphList = document.getElementById("paragraph-list");
    const inputSearch = document.getElementById("input-search");
    const linkRecap = document.getElementById("link-recap");
    
    const viewMode = document.getElementById("view-mode");
    const editMode = document.getElementById("edit-mode");
    const viewTitle = document.getElementById("view-title");
    const viewHtmlContent = document.getElementById("view-html-content");
    const viewImageContainer = document.getElementById("view-image-container");
    const viewParagraphImg = document.getElementById("view-paragraph-img");
    const viewImageComment = document.getElementById("view-image-comment");
    
    const viewBibleContainer = document.getElementById("view-bible-container");
    const viewBibleBadges = document.getElementById("view-bible-badges");
    const fieldsParagraphOnly = document.getElementById("fields-paragraph-only");
    const fieldsRecapOnly = document.getElementById("fields-recap-only");
    const editParagraphNum = document.getElementById("edit-paragraph-num");
    
    const dynamicBibleFieldsContainer = document.getElementById("dynamic-bible-fields-container");
    const btnAddBibleField = document.getElementById("btn-add-bible-field");
    const inputParagraphKey = document.getElementById("input-paragraph-key");
    const inputImageUrl = document.getElementById("input-image-url");
    const inputImageComment = document.getElementById("input-image-comment");
    const inputTextual = document.getElementById("input-textual");
    const inputResposta = document.getElementById("input-resposta");
    const inputPastoral = document.getElementById("input-pastoral");
    const charCounter = document.getElementById("char-counter");

    // Injeção da área de texto original da revista no formulário
    const inputRevistaTexto = document.createElement("textarea");
    inputRevistaTexto.id = "input-revista-texto";
    inputRevistaTexto.style.cssText = "width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid #ccc; font-size: 0.95rem; resize: vertical;";
    inputRevistaTexto.rows = 4;
    inputRevistaTexto.placeholder = "Cole aqui o parágrafo original da revista...";

    const antigoInputLinked = document.getElementById("input-linked-p");
    if (antigoInputLinked) {
        const labelAntiga = antigoInputLinked.parentElement.querySelector('label[for="input-linked-p"]');
        if(labelAntiga) labelAntiga.remove();
        antigoInputLinked.remove();
    }

    const parentResposta = inputResposta.parentElement;
    if (parentResposta) {
        const containerFlex = document.createElement("div");
        containerFlex.style.cssText = "display: flex; gap: 20px; width: 100%; margin-bottom: 15px;";

        const colunaEsquerda = document.createElement("div");
        colunaEsquerda.style.flex = "1";
        const colunaDireita = document.createElement("div");
        colunaDireita.style.flex = "1";

        parentResposta.insertBefore(containerFlex, inputResposta);
        
        const labelResp = parentResposta.querySelector('label[for="input-resposta"]');
        if(labelResp) colunaEsquerda.appendChild(labelResp);
        colunaEsquerda.appendChild(inputResposta);
        colunaEsquerda.appendChild(charCounter);
        
        const labelRevista = document.createElement("label");
        labelRevista.innerText = "Texto Original da Revista (Parágrafo):";
        labelRevista.style.cssText = "font-weight: bold; display: block; margin-bottom: 5px;";
        
        // === BOTÃO DE DESTAQUE PARA TEXTO DA REVISTA ===
        const btnHighlightRevista = document.createElement("button");
        btnHighlightRevista.type = "button";
        btnHighlightRevista.innerText = "✨ Marcar Resposta Correta";
        btnHighlightRevista.style.cssText = "background: #ffff00; color: #0000ff; border: 2px solid #0000ff; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: bold; margin-bottom: 8px; display: block; transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.3);";
        btnHighlightRevista.addEventListener("mouseover", () => btnHighlightRevista.style.background = "#e6e600");
        btnHighlightRevista.addEventListener("mouseout", () => btnHighlightRevista.style.background = "#ffff00");
        
        btnHighlightRevista.addEventListener("click", () => {
            const start = inputRevistaTexto.selectionStart;
            const end = inputRevistaTexto.selectionEnd;
            const selectedText = inputRevistaTexto.value.substring(start, end);
            
            if (selectedText) {
                const replacement = `#${selectedText}#`;
                inputRevistaTexto.value = inputRevistaTexto.value.substring(0, start) + replacement + inputRevistaTexto.value.substring(end);
                inputRevistaTexto.focus();
                inputRevistaTexto.setSelectionRange(start + 1, start + 1 + selectedText.length);
                ajustarAlturaTextArea(inputRevistaTexto);
            } else {
                alert("⚠️ Selecione o texto dentro da caixa 'Texto Original da Revista' primeiro!");
            }
        });
        
        colunaDireita.appendChild(labelRevista);
        colunaDireita.appendChild(btnHighlightRevista);
        colunaDireita.appendChild(inputRevistaTexto);

        containerFlex.appendChild(colunaEsquerda);
        containerFlex.appendChild(colunaDireita);
    }

    // Função auxiliar para expandir Textareas
    function ajustarAlturaTextArea(textareaElement) {
        if (!textareaElement) return;
        textareaElement.style.height = "auto";
        textareaElement.style.height = (textareaElement.scrollHeight) + "px";
    }

    // Monitorizar digitação para expandir as caixas de edição
    [inputResposta, inputTextual, inputPastoral, inputRevistaTexto].forEach(txtElement => {
        txtElement.addEventListener("input", () => ajustarAlturaTextArea(txtElement));
    });

    // SIDEBAR CONTAINER (declarado antes de ser usado)
    const sidebarContainer = document.querySelector(".sidebar") || document.querySelector("aside");

    // BOTÃO MENU HAMBURGUER PARA MOBILE
    const menuToggle = document.createElement("button");
    menuToggle.className = "menu-toggle";
    menuToggle.innerHTML = "☰";
    menuToggle.setAttribute("aria-label", "Abrir menu");
    menuToggle.addEventListener("click", () => {
        if (sidebarContainer) {
            sidebarContainer.classList.add("mobile-open");
            let overlay = document.querySelector(".sidebar-overlay");
            if (!overlay) {
                overlay = document.createElement("div");
                overlay.className = "sidebar-overlay";
                overlay.addEventListener("click", () => {
                    sidebarContainer.classList.remove("mobile-open");
                    overlay.classList.remove("active");
                });
                document.body.appendChild(overlay);
            }
            setTimeout(() => overlay.classList.add("active"), 10);
        }
    });
    document.body.insertBefore(menuToggle, document.body.firstChild);

    // BOTÃO VOLTAR NA SIDEBAR (com suporte a mobile)
    if (sidebarContainer && !document.getElementById("btn-sidebar-back")) {
        const btnBackSidebar = document.createElement("button");
        btnBackSidebar.id = "btn-sidebar-back";
        btnBackSidebar.innerHTML = "⬅️ Voltar para os Estudos";
        btnBackSidebar.style.cssText = "width: 90%; margin: 10px auto; padding: 10px; background: #2c2c3e; color: #ff5b5b; border: 1px solid #444; border-radius: 6px; cursor: pointer; font-weight: bold; display: block;";
        btnBackSidebar.addEventListener("click", () => {
            isCoverActive = true;
            if (window.innerWidth <= 768 && sidebarContainer) {
                sidebarContainer.classList.remove("mobile-open");
                const overlay = document.querySelector(".sidebar-overlay");
                if (overlay) overlay.classList.remove("active");
            }
            showParagraph();
        });
        sidebarContainer.insertBefore(btnBackSidebar, sidebarContainer.firstChild);
    }

    // Fechar sidebar ao clicar em um parágrafo (mobile)
    document.addEventListener("click", (e) => {
        if (e.target.closest(".nav-link") && window.innerWidth <= 768) {
            setTimeout(() => {
                const sb = document.querySelector(".sidebar");
                if (sb) sb.classList.remove("mobile-open");
                const ov = document.querySelector(".sidebar-overlay");
                if (ov) ov.classList.remove("active");
            }, 300);
        }
    });

    const btnEditMode = document.getElementById("btn-edit-mode");
    const btnSave = document.getElementById("btn-save");
    const btnCancel = document.getElementById("btn-cancel");
    const btnExport = document.getElementById("btn-export");
    const btnImport = document.getElementById("btn-import");
    const importFile = document.getElementById("import-file");

    function getActiveWeek() { return appState.weeks[appState.activeWeekId]; }
    
    function saveState() { 
        const stateStr = JSON.stringify(appState);
        localStorage.setItem("sentinela_v8_data", stateStr); 
        sessionStorage.setItem("sentinela_v8_backup", stateStr);
    }

    // MINI PARSER MARKDOWN (COM SUPORTE A .com1)
    function parseMarkdown(text) {
        if (!text) return "";
        // Converte #texto# em <span class="com1">texto</span>
        text = text.replace(/#(.*?)#/g, '<span class="com1">$1</span>');
        // Converte *texto* em <strong>texto</strong>
        return text.replace(/\*(.*?)\*/g, "<strong>$1</strong>");
    }

    // CAPTURA AUTOMÁTICA DE VERSÍCULOS BÍBLICOS
    function extrairEAutoPreencherVersiculos(text, paragraphData) {
        if (!text) return;
        const regexBiblica = /(?:[123]\s*)?[A-ZÀ-Ú][a-zà-ú]{1,3}\.?\s*\d+:\d+(?:,\d+)*/g;
        const correspondencias = text.match(regexBiblica);
        
        if (correspondencias) {
            if (!paragraphData.bibleTexts) paragraphData.bibleTexts = [];
            correspondencias.forEach(ref => {
                const jaExiste = paragraphData.bibleTexts.some(b => b.ref.toLowerCase().trim() === ref.toLowerCase().trim());
                if (!jaExiste) {
                    paragraphData.bibleTexts.push({ ref: ref.trim(), transcription: "" });
                }
            });
        }
    }

    function fetchBibleText(reference, customTranscription) {
        const key = reference.toLowerCase().trim();
        if (BIBLE_DATABASE[key]) return BIBLE_DATABASE[key];
        if (customTranscription && customTranscription.trim() !== "") return customTranscription;
        if (appState.customBibleVerses && appState.customBibleVerses[key]) return appState.customBibleVerses[key];
        return null;
    }

    function updateWeeksDropdown() {
        if(!selectWeek) return;
        selectWeek.innerHTML = "";
        Object.keys(appState.weeks).forEach(key => {
            const opt = document.createElement("option");
            opt.value = key; opt.innerText = appState.weeks[key].title;
            if (key === appState.activeWeekId) opt.selected = true;
            selectWeek.appendChild(opt);
        });
    }

    function checkRecapStructure(week) {
        if (!week.recap) {
            week.recap = { q1: "Por que podemos confiar no \"Deus da verdade\"?", a1: "", q2: "Como Jeová vai acabar com o mundo...", a2: "", q3: "Por que temos certeza...", a3: "" };
        }
        if (week.textoBiblicoSemana === undefined) {
            week.textoBiblicoSemana = "\"O teu parecer é o que me guia... Prepara o teu coração para assimilar as joias espirituais da lição desta semana.\"";
        }
        if (!week.imageUrlCapa) {
            week.imageUrlCapa = "https://cms-imgp.jw-cdn.org/img/p/1011202/univ/art/1011202_univ_lsr_lg.jpg";
        }
    }

    function sortParagraphKeys(keys) {
        return keys.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)) || 0;
            const numB = parseInt(b.match(/\d+/)) || 0;
            return numA - numB;
        });
    }

    function calcularProgressoSemana(weekData) {
        if (!weekData.paragraphs) return 0;
        const total = Object.keys(weekData.paragraphs).length;
        if (total === 0) return 0;
        let respondidos = 0;
        Object.values(weekData.paragraphs).forEach(p => {
            if (p.resposta && p.resposta.trim() !== "") respondidos++;
        });
        return Math.round((respondidos / total) * 100);
    }

    function createBibleFieldRow(refValue = "", transcriptionValue = "") {
        const row = document.createElement("div");
        row.className = "bible-field-row";
        row.style.cssText = "display: flex; gap: 10px; margin-bottom: 10px; align-items: flex-start;";
        row.innerHTML = `
            <div style="flex: 1;">
                <input type="text" class="input-dynamic-ref" placeholder="Ex: Salmo 31:2" value="${refValue}" style="font-size: 0.9rem; padding: 8px; width: 100%; box-sizing: border-box;">
            </div>
            <div style="flex: 2;">
                <textarea class="input-dynamic-transcription" rows="1" placeholder="Transcrição opcional do versículo..." style="font-size: 0.9rem; padding: 8px; min-height: 38px; resize: vertical; width: 100%; box-sizing: border-box;">${transcriptionValue}</textarea>
            </div>
            <button type="button" class="btn-remove-bible-field" style="background: #c62828; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; height: 38px;">✕</button>
        `;
        row.querySelector(".btn-remove-bible-field").addEventListener("click", () => { row.remove(); });
        dynamicBibleFieldsContainer.appendChild(row);
    }

    if(btnAddBibleField) {
        btnAddBibleField.addEventListener("click", () => { createBibleFieldRow("", ""); });
    }

    function buildParagraphsMenu(filterTerm = "") {
        const week = getActiveWeek();
        if(!paragraphList) return;
        paragraphList.innerHTML = "";
        if (!week.paragraphs) week.paragraphs = {};
        if(labelTotalP) labelTotalP.innerText = Object.keys(week.paragraphs).length;
        if(linkRecap) linkRecap.classList.remove("active");

        const sortedKeys = sortParagraphKeys(Object.keys(week.paragraphs));
        sortedKeys.forEach(key => {
            const pData = week.paragraphs[key];
            if (filterTerm !== "") {
                const bibleRefsPool = pData.bibleTexts ? pData.bibleTexts.map(b => b.ref).join(" ") : "";
                const pool = `${pData.textual || ''} ${pData.resposta || ''} ${pData.pastoral || ''} ${pData.revistaTexto || ''} ${bibleRefsPool}`.toLowerCase();
                if (!pool.includes(filterTerm.toLowerCase())) return; 
            }
            const li = document.createElement("li");
            const respondidoStyle = (pData.resposta && pData.resposta.trim() !== "") ? "border-left: 3px solid #00e676;" : "";
            li.innerHTML = `<a href="#" class="nav-link ${(!isCoverActive && activeParagraph === key) ? 'active' : ''}" data-paragraph="${key}" style="${respondidoStyle}">Parágrafo ${key}</a>`;
            paragraphList.appendChild(li);
        });
        
        if (!isCoverActive && activeParagraph === "recap" && linkRecap) linkRecap.classList.add("active");
        
        document.querySelectorAll(".sidebar-menu .nav-link:not(.special-link)").forEach(link => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                isCoverActive = false;
                activeParagraph = link.getAttribute("data-paragraph");
                document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
                link.classList.add("active");
                showParagraph();
            });
        });
    }

    function showParagraph() {
        const week = getActiveWeek();
        checkRecapStructure(week);
        const sidebar = document.querySelector(".sidebar") || document.querySelector("aside");

        // PAINEL INICIAL: MURAL DE BANNERS
        if (isCoverActive) {
            viewMode.classList.remove("hidden");
            editMode.classList.add("hidden");
            
            if (sidebar) sidebar.style.display = "none";
            viewTitle.innerText = ""; 
            viewImageContainer.classList.add("hidden");
            viewBibleContainer.classList.add("hidden");
            if(btnEditMode) btnEditMode.style.display = "none";
            
            let htmlCardGrid = `
                <div style="margin-bottom: 25px; border-bottom: 1px solid #3a3a55; padding-bottom: 10px;">
                    <h2 style="color: #fff; font-size: 1.4rem; display: flex; align-items: center; gap: 10px; margin: 0;">
                        ✨ PROGRAMA DE ESTUDO PESSOAL
                    </h2>
                </div>
                <div id="cards-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; padding: 10px 0;">
            `;
            Object.keys(appState.weeks).forEach(weekKey => {
                const currentWeekData = appState.weeks[weekKey];
                checkRecapStructure(currentWeekData);
                const capaImg = currentWeekData.imageUrlCapa || "https://cms-imgp.jw-cdn.org/img/p/1011202/univ/art/1011202_univ_lsr_lg.jpg";
                const progressoPorcentagem = calcularProgressoSemana(currentWeekData);

                htmlCardGrid += `
                    <div class="banner-card-item" style="background: linear-gradient(rgba(20, 20, 35, 0.82), rgba(20, 20, 35, 0.88)), url('${capaImg}') no-repeat center center; background-size: cover; border-radius: 8px; padding: 15px 12px; border: 1px solid #3a3a55; box-shadow: 0 4px 12px rgba(0,0,0,0.4); text-align: center; display: flex; flex-direction: column; justify-content: space-between; min-height: 310px; position: relative; transition: all 0.25s ease-in-out; transform: translateY(0);" onmouseenter="this.style.transform='translateY(-5px)'; this.style.borderColor='#1a73e8'; this.style.boxShadow='0 8px 20px rgba(0,0,0,0.6)';" onmouseleave="this.style.transform='translateY(0)'; this.style.borderColor='#3a3a55'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.4)';">
                        <div>
                            <div class="editable-banner-image-trigger" data-week-id="${weekKey}" title="Duplo clique para mudar a IMAGEM DE CAPA" style="font-size: 1.8rem; margin-bottom: 8px; filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.5)); cursor:pointer; display:inline-block; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">📖</div>
                            
                            <h3 class="editable-banner-title" data-week-id="${weekKey}" title="Duplo clique para editar o TÍTULO/DATA" style="color: #ffffff; font-size: 0.9rem; margin: 0 0 10px 0; font-weight: bold; line-height: 1.3; padding: 3px; border: 1px dashed transparent; cursor: pointer; text-shadow: 0 2px 4px rgba(0,0,0,0.9);">
                                ${currentWeekData.title}
                            </h3>
                        </div>
                        <div>
                            <div style="width:100%; background: rgba(255,255,255,0.1); border-radius: 10px; height: 6px; margin-bottom: 4px; overflow:hidden;">
                                <div style="width: ${progressoPorcentagem}%; background: ${progressoPorcentagem === 100 ? '#00e676' : '#1a73e8'}; height: 100%; border-radius: 10px; transition: width 0.4s ease;"></div>
                            </div>
                            <span style="font-size:0.65rem; color:#aaa; display:block; margin-bottom:8px; font-weight:500;">Progresso: ${progressoPorcentagem}%</span>

                            <button class="btn-card-start-study" data-week-id="${weekKey}" style="background: #1a73e8; color: white; border: none; padding: 8px 12px; font-size: 0.8rem; font-weight: bold; border-radius: 15px; cursor: pointer; width: 100%; box-shadow: 0 2px 6px rgba(0,0,0,0.4); transition: background 0.2s;">
                                Estudar Lição ➡️
                            </button>
                        </div>
                    </div>
                `;
            });

            htmlCardGrid += `</div>`;
            viewHtmlContent.innerHTML = htmlCardGrid;

            // Handlers da capa
            document.querySelectorAll(".editable-banner-image-trigger").forEach(icon => {
                icon.addEventListener("dblclick", () => {
                    const wId = icon.getAttribute("data-week-id");
                    const imgAtual = appState.weeks[wId].imageUrlCapa || "";
                    const novaImg = prompt("Insira a URL da imagem da capa da revista:", imgAtual);
                    if (novaImg !== null) {
                        appState.weeks[wId].imageUrlCapa = novaImg.trim() || "https://cms-imgp.jw-cdn.org/img/p/1011202/univ/art/1011202_univ_lsr_lg.jpg";
                        saveState(); showParagraph();
                    }
                });
            });

            document.querySelectorAll(".editable-banner-title").forEach(titleBlock => {
                titleBlock.addEventListener("dblclick", () => {
                    const wId = titleBlock.getAttribute("data-week-id");
                    const currentTitle = appState.weeks[wId].title || "";
                    const novoTitulo = prompt("Corrija o Título ou Data do Estudo:", currentTitle);
                    if (novoTitulo !== null && novoTitulo.trim() !== "") {
                        appState.weeks[wId].title = novoTitulo.trim();
                        saveState(); updateWeeksDropdown(); showParagraph();
                    }
                });
            });

            document.querySelectorAll(".btn-card-start-study").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    const selectedWeekId = btn.getAttribute("data-week-id");
                    appState.activeWeekId = selectedWeekId;
                    if(selectWeek) selectWeek.value = selectedWeekId;
                    isCoverActive = false;
                    if (sidebar) sidebar.style.display = "flex"; 

                    const targetWeek = appState.weeks[selectedWeekId];
                    const keys = sortParagraphKeys(Object.keys(targetWeek.paragraphs));
                    activeParagraph = keys[0] || "1";
                    
                    saveState(); buildParagraphsMenu(); showParagraph();
                });
            });
            return;
        }

        // TELA INTERNA DE LEITURA
        if (sidebar) sidebar.style.display = "flex";
        viewMode.classList.remove("hidden");
        editMode.classList.add("hidden");
        if(btnEditMode) btnEditMode.style.display = "inline-flex";

        // Esconder botão de editar no mobile
        if (window.innerWidth <= 768 && btnEditMode) {
            btnEditMode.style.display = "none";
        }

        let btnVoltarTopo = document.getElementById("btn-leitura-voltar");
        if (!btnVoltarTopo) {
            btnVoltarTopo = document.createElement("button");
            btnVoltarTopo.id = "btn-leitura-voltar";
            btnVoltarTopo.innerHTML = "⬅️ Voltar para Painel de Banners";
            btnVoltarTopo.style.cssText = "background: #2c2c3e; color: #00e676; border: 1px solid #444; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 15px; font-size: 0.9rem;";
            btnVoltarTopo.addEventListener("click", () => {
                isCoverActive = true;
                // Fechar sidebar no mobile
                if (window.innerWidth <= 768 && sidebar) {
                    sidebar.classList.remove("mobile-open");
                    const overlay = document.querySelector(".sidebar-overlay");
                    if (overlay) overlay.classList.remove("active");
                }
                showParagraph();
            });
        }

        if (activeParagraph === "recap") {
            viewTitle.innerText = "📋 QUAL É A SUA RESPOSTA? (Recapitulação)";
            viewImageContainer.classList.add("hidden");
            viewBibleContainer.classList.add("hidden");
            viewHtmlContent.innerHTML = "";
            viewHtmlContent.appendChild(btnVoltarTopo);

            const containerRecapText = document.createElement("div");
            containerRecapText.innerHTML = `
                <div class="view-section recap-group" style="margin-bottom: 20px;">
                    <h3 style="color: #1a73e8; margin-bottom: 8px;">➡️ 1. ${week.recap.q1 || 'Pergunta 1'}</h3>
                    <div style="background-color: #f1f3f4; border-left: 4px solid #1a73e8; padding: 12px; border-radius: 4px; font-style: italic; color: #202124; font-weight: 500;">
                        ${week.recap.a1 ? parseMarkdown(week.recap.a1).replace(/\n/g, '<br>') : 'Aguardando anotação de recapitulação no formulário...'}
                    </div>
                </div>
                <div class="view-section recap-group" style="margin-bottom: 20px;">
                    <h3 style="color: #1a73e8; margin-bottom: 8px;">➡️ 2. ${week.recap.q2 || 'Pergunta 2'}</h3>
                    <div style="background-color: #f1f3f4; border-left: 4px solid #1a73e8; padding: 12px; border-radius: 4px; font-style: italic; color: #202124; font-weight: 500;">
                        ${week.recap.a2 ? parseMarkdown(week.recap.a2).replace(/\n/g, '<br>') : 'Aguardando anotação de recapitulação no formulário...'}
                    </div>
                </div>
                <div class="view-section recap-group" style="margin-bottom: 20px;">
                    <h3 style="color: #1a73e8; margin-bottom: 8px;">➡️ 3. ${week.recap.q3 || 'Pergunta 3'}</h3>
                    <div style="background-color: #f1f3f4; border-left: 4px solid #1a73e8; padding: 12px; border-radius: 4px; font-style: italic; color: #202124; font-weight: 500;">
                        ${week.recap.a3 ? parseMarkdown(week.recap.a3).replace(/\n/g, '<br>') : 'Aguardando anotação de recapitulação no formulário...'}
                    </div>
                </div>
            `;
            viewHtmlContent.appendChild(containerRecapText);
            return;
        }

        if (!week.paragraphs[activeParagraph]) {
            const keys = sortParagraphKeys(Object.keys(week.paragraphs));
            activeParagraph = keys[0] || "1";
        }

        viewTitle.innerText = `Parágrafo ${activeParagraph}`;
        const pData = week.paragraphs[activeParagraph];

        viewBibleBadges.innerHTML = "";
        if (pData.bibleTexts && pData.bibleTexts.length > 0) {
            viewBibleContainer.classList.remove("hidden");
            pData.bibleTexts.forEach(item => {
                const trimmedRef = item.ref.trim();
                if (!trimmedRef) return;
                const block = document.createElement("div");
                block.className = "bible-text-display";
                const txtBilia = fetchBibleText(trimmedRef, item.transcription);
                block.innerHTML = txtBilia ? `<strong>${trimmedRef}:</strong> "${txtBilia}"` : `<strong>${trimmedRef}:</strong> <span style="color:#7f8c8d; font-style:italic;">Nenhuma transcrição salva...</span>`;
                viewBibleBadges.appendChild(block);
            });
        } else { viewBibleContainer.classList.add("hidden"); }

        viewHtmlContent.innerHTML = "";
        viewHtmlContent.appendChild(btnVoltarTopo);

        const labelTemaEstudoTopo = document.createElement("div");
        labelTemaEstudoTopo.style.cssText = "background: rgba(26, 115, 232, 0.1); border-left: 4px solid #1a73e8; padding: 10px 15px; margin-bottom: 20px; color: #fff; font-weight: bold; font-size: 1.05rem;";
        labelTemaEstudoTopo.innerText = week.title;
        viewHtmlContent.appendChild(labelTemaEstudoTopo);

        const principalContent = document.createElement("div");
        principalContent.innerHTML = `
            <div class="view-section" style="margin-bottom: 20px;">
                <h3>1️⃣ ANÁLISE TEXTUAL E EXEGÉTICA</h3>
                <p>${pData.textual ? parseMarkdown(pData.textual).replace(/\n/g, '<br>') : 'Aguardando inserção de dados analíticos pelo painel...'}</p>
            </div>
        `;
        viewHtmlContent.appendChild(principalContent);

        if (pData.imageUrl && pData.imageUrl.trim() !== "") {
            viewParagraphImg.src = pData.imageUrl.trim();
            viewImageContainer.classList.remove("hidden");
            if (pData.imageComment && pData.imageComment.trim() !== "") {
                viewImageComment.innerText = pData.imageComment;
                viewImageComment.classList.remove("hidden");
            } else { viewImageComment.classList.add("hidden"); }
            viewHtmlContent.appendChild(viewImageContainer);
        } else { viewImageContainer.classList.add("hidden"); }

        const restOfContent = document.createElement("div");
        let blocoRevistaHtml = pData.revistaTexto && pData.revistaTexto.trim() !== "" ? `
        <div style="background-color: #2d2d2d; border-left: 5px solid #ffd54f; padding: 14px; border-radius: 6px; margin-bottom: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
            <span style="font-weight: bold; font-size: 0.8rem; text-transform: uppercase; color: #ffd54f; display:block; margin-bottom: 6px; letter-spacing: 0.5px;">Trecho Original da Revista:</span>
            <p style="margin:0; font-weight: 400; color: #e0e0e0 !important; line-height: 1.6; font-size: 1rem;">${parseMarkdown(pData.revistaTexto).replace(/\n/g, '<br>')}</p>
        </div>
        ` : "";
        restOfContent.innerHTML = `
            <div class="view-section" style="margin-top: 20px;">
                <h3>2️⃣ RESPOSTA DIRETA E EXEMPLO COMENTADO</h3>
                ${blocoRevistaHtml}
                <div style="background-color: #e8f0fe; border-left: 5px solid #1a73e8; padding: 15px; border-radius: 4px; margin-top: 10px;">
                    <span style="color: #1a73e8; font-weight: bold; font-size: 0.85rem; display: block; margin-bottom: 5px; text-transform: uppercase;">Resposta Objetiva</span>
                    <p style="margin: 0; font-size: 1.05rem; font-style: italic; color: #202124; line-height: 1.5;">"${pData.resposta ? parseMarkdown(pData.resposta) : 'Aguardando registro de resposta pelo formulário...'}"</p>
                </div>
            </div>
            <div class="view-section" style="margin-top: 25px;">
                <h3>3️⃣ APLICAÇÃO PASTORAL PROFUNDA</h3>
                <p>${pData.pastoral ? parseMarkdown(pData.pastoral).replace(/\n/g, '<br>') : 'Aguardando aplicação prática pelo painel...'}</p>
            </div>
        `;
        viewHtmlContent.appendChild(restOfContent);
    }

    // FORMULÁRIO COMPLETO DE EDIÇÃO LATERAL
    if (btnEditMode) {
        btnEditMode.addEventListener("click", () => {
            const week = getActiveWeek();
            checkRecapStructure(week);
            
            viewMode.classList.add("hidden");
            editMode.classList.remove("hidden");

            if (activeParagraph === "recap") {
                editParagraphNum.innerText = "Recapitulação Final";
                if(fieldsParagraphOnly) fieldsParagraphOnly.classList.add("hidden");
                if(fieldsRecapOnly) fieldsRecapOnly.classList.remove("hidden");

                let recapContainer = document.getElementById("recap-dynamic-editor-container");
                if (!recapContainer) {
                    recapContainer = document.createElement("div");
                    recapContainer.id = "recap-dynamic-editor-container";
                    editMode.insertBefore(recapContainer, editMode.querySelector(".edit-actions"));
                }

                recapContainer.innerHTML = `
                    <div style="margin-bottom: 15px;">
                        <label style="font-weight:bold; display:block; margin-bottom:5px;">Pergunta 1:</label>
                        <input type="text" id="dynamic-recap-q1" value="${week.recap.q1 || ''}" style="width:100%; padding:8px; box-sizing:border-box; margin-bottom:8px; font-weight:bold;">
                        <textarea id="dynamic-recap-a1" rows="3" style="width:100%; padding:8px; box-sizing:border-box; resize:vertical;">${week.recap.a1 || ''}</textarea>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="font-weight:bold; display:block; margin-bottom:5px;">Pergunta 2:</label>
                        <input type="text" id="dynamic-recap-q2" value="${week.recap.q2 || ''}" style="width:100%; padding:8px; box-sizing:border-box; margin-bottom:8px; font-weight:bold;">
                        <textarea id="dynamic-recap-a2" rows="3" style="width:100%; padding:8px; box-sizing:border-box; resize:vertical;">${week.recap.a2 || ''}</textarea>
                    </div>
                    <div style="margin-bottom: 25px;">
                        <label style="font-weight:bold; display:block; margin-bottom:5px;">Pergunta 3:</label>
                        <input type="text" id="dynamic-recap-q3" value="${week.recap.q3 || ''}" style="width:100%; padding:8px; box-sizing:border-box; margin-bottom:8px; font-weight:bold;">
                        <textarea id="dynamic-recap-a3" rows="3" style="width:100%; padding:8px; box-sizing:border-box; resize:vertical;">${week.recap.a3 || ''}</textarea>
                    </div>
                `;
            } else {
                editParagraphNum.innerText = `Parágrafo ${activeParagraph}`;
                if(fieldsParagraphOnly) fieldsParagraphOnly.classList.remove("hidden");
                if(fieldsRecapOnly) fieldsRecapOnly.classList.add("hidden");

                const recapContainer = document.getElementById("recap-dynamic-editor-container");
                if (recapContainer) recapContainer.remove();
                
                const pData = week.paragraphs[activeParagraph];
                inputParagraphKey.value = activeParagraph;
                inputImageUrl.value = pData.imageUrl || "";
                inputImageComment.value = pData.imageComment || "";
                inputTextual.value = pData.textual || "";
                inputResposta.value = pData.resposta || "";
                inputPastoral.value = pData.pastoral || "";
                inputRevistaTexto.value = pData.revistaTexto || "";
                charCounter.innerText = `${inputResposta.value.length} / 400 caracteres`;
                
                dynamicBibleFieldsContainer.innerHTML = "";
                if (pData.bibleTexts && pData.bibleTexts.length > 0) {
                    pData.bibleTexts.forEach(b => { createBibleFieldRow(b.ref, b.transcription); });
                } else { createBibleFieldRow("", ""); }
                
                setTimeout(() => {
                    [inputResposta, inputTextual, inputPastoral, inputRevistaTexto].forEach(ajustarAlturaTextArea);
                }, 20);
            }
        });
    }

    if (btnSave) {
    btnSave.addEventListener("click", () => {
        const week = getActiveWeek();
        if (activeParagraph === "recap") {
            week.recap = {
                q1: document.getElementById("dynamic-recap-q1")?.value || "",
                a1: document.getElementById("dynamic-recap-a1")?.value || "",
                q2: document.getElementById("dynamic-recap-q2")?.value || "",
                a2: document.getElementById("dynamic-recap-a2")?.value || "",
                q3: document.getElementById("dynamic-recap-q3")?.value || "",
                a3: document.getElementById("dynamic-recap-a3")?.value || ""
            };
            const recapContainer = document.getElementById("recap-dynamic-editor-container");
            if (recapContainer) recapContainer.remove();
        } else {
            const newKey = inputParagraphKey.value.trim();
            if (!newKey) return alert("Identificação vazia.");

            const collectedBibleTexts = [];
            const rows = dynamicBibleFieldsContainer.querySelectorAll(".bible-field-row");
            rows.forEach(row => {
                const ref = row.querySelector(".input-dynamic-ref").value.trim();
                const transcription = row.querySelector(".input-dynamic-transcription").value.trim();
                if (ref !== "") {
                    collectedBibleTexts.push({ ref: ref, transcription: transcription });
                    if (transcription !== "") {
                        if (!appState.customBibleVerses) appState.customBibleVerses = {};
                        appState.customBibleVerses[ref.toLowerCase()] = transcription;
                    }
                }
            });
            const pContent = {
                imageUrl: inputImageUrl.value, 
                revistaTexto: inputRevistaTexto.value, 
                bibleTexts: collectedBibleTexts, 
                imageComment: inputImageComment.value, 
                textual: inputTextual.value, 
                resposta: inputResposta.value, 
                pastoral: inputPastoral.value
            };
            
            // ✅ APENAS COLETA O QUE VOCÊ ADICIONOU MANUALMENTE
            // (sem extração automática)

            if (newKey !== activeParagraph) delete week.paragraphs[activeParagraph];
            week.paragraphs[newKey] = pContent;
            activeParagraph = newKey;
        }
        saveState(); buildParagraphsMenu(); showParagraph();
    });
}
    if (btnAddP) {
        btnAddP.addEventListener("click", () => {
            const week = getActiveWeek();
            const labelParagrafos = prompt("Digite o número do parágrafo:");
            if (!labelParagrafos || !labelParagrafos.trim()) return;
            const cleanLabel = labelParagrafos.trim();
            if (week.paragraphs[cleanLabel]) return alert("Já existe.");

            week.paragraphs[cleanLabel] = { imageUrl: "", imageComment: "", revistaTexto: "", bibleTexts: [], textual: "", resposta: "", pastoral: "" };
            activeParagraph = cleanLabel; 
            isCoverActive = false;
            saveState(); buildParagraphsMenu(); showParagraph();
        });
    }

    if (btnRemoveP) {
        btnRemoveP.addEventListener("click", () => {
            const week = getActiveWeek();
            if (Object.keys(week.paragraphs).length <= 1 || activeParagraph === "recap") return alert("Ação inválida.");
            if (confirm(`Remover Parágrafo "${activeParagraph}"?`)) {
                delete week.paragraphs[activeParagraph];
                activeParagraph = sortParagraphKeys(Object.keys(week.paragraphs))[0] || "1";
                saveState(); buildParagraphsMenu(); showParagraph();
            }
        });
    }

    if (linkRecap) {
        linkRecap.addEventListener("click", (e) => { e.preventDefault(); isCoverActive = false; activeParagraph = "recap"; buildParagraphsMenu(); showParagraph(); });
    }
    if (inputResposta) {
        inputResposta.addEventListener("input", () => { charCounter.innerText = `${inputResposta.value.length} / 400 caracteres`; });
    }
    if (inputSearch) {
        inputSearch.addEventListener("input", () => { buildParagraphsMenu(inputSearch.value); });
    }
    if (btnCancel) {
        btnCancel.addEventListener("click", () => { document.getElementById("recap-dynamic-editor-container")?.remove(); showParagraph(); });
    }

    if (selectWeek) {
        selectWeek.addEventListener("change", (e) => { appState.activeWeekId = e.target.value; isCoverActive = true; saveState(); buildParagraphsMenu(); showParagraph(); });
    }

    if (btnAddWeek) {
        btnAddWeek.addEventListener("click", () => {
            const title = prompt("Digite a Data e Tema da Nova Semana:");
            if (!title || !title.trim()) return;
            const id = "semana_" + Date.now();
            const initialParagraphs = {};
            for(let i = 1; i <= 16; i++) initialParagraphs[String(i)] = { imageUrl: "", imageComment: "", revistaTexto: "", bibleTexts: [], textual: "", resposta: "", pastoral: "" };

            appState.weeks[id] = { id: id, title: title.trim(), textoBiblicoSemana: 'Insira o texto bíblico base aqui...', imageUrlCapa: "https://cms-imgp.jw-cdn.org/img/p/1011202/univ/art/1011202_univ_lsr_lg.jpg", totalParagraphs: 16, recap: { q1:"Q1?", a1:"", q2:"Q2?", a2:"", q3:"Q3?", a3:"" }, paragraphs: initialParagraphs };
            appState.activeWeekId = id; isCoverActive = true;
            saveState(); updateWeeksDropdown(); buildParagraphsMenu(); showParagraph();
        });
    }

    if (btnDelWeek) {
        btnDelWeek.addEventListener("click", () => {
            const keys = Object.keys(appState.weeks);
            if (keys.length <= 1) return alert("Mantenha ao menos uma semana.");
            if (confirm("Excluir esta semana de estudo?")) {
                const toDelete = appState.activeWeekId; appState.activeWeekId = keys.find(k => k !== toDelete);
                delete appState.weeks[toDelete]; isCoverActive = true;
                saveState(); updateWeeksDropdown(); buildParagraphsMenu(); showParagraph();
            }
        });
    }

    if (btnExport) {
        btnExport.addEventListener("click", () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appState, null, 2));
            const anchor = document.createElement("a"); anchor.setAttribute("href", dataStr); anchor.setAttribute("download", "estudos_sentinela.json");
            document.body.appendChild(anchor); anchor.click(); anchor.remove();
        });
    }

    if (btnImport) {
        btnImport.addEventListener("click", () => { importFile.click(); });
    }
    if (importFile) {
        importFile.addEventListener("change", (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = function(event) {
                try {
                    const data = JSON.parse(event.target.result);
                    if (data.weeks) { appState = data; isCoverActive = true; saveState(); updateWeeksDropdown(); buildParagraphsMenu(); showParagraph(); alert("Backup completo carregado!"); }
                } catch (err) { alert("Erro no arquivo."); }
            };
            reader.readAsText(file);
        });
    }

    // Reavaliar ao redimensionar
    window.addEventListener('resize', () => {
        if (window.innerWidth <= 768 && btnEditMode) {
            btnEditMode.style.display = "none";
        } else if (btnEditMode && !isCoverActive) {
            btnEditMode.style.display = "inline-flex";
        }
    });

    updateWeeksDropdown(); buildParagraphsMenu(); showParagraph();
});
