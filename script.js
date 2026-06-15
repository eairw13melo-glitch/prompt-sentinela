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
                title: "8-14 DE JUNHO DE 2026 | O “Deus da verdade” sempre cumpre o que promete",
                totalParagraphs: 16,
                recap: {
                    q1: "Por que podemos confiar no “Deus da verdade”?", a1: "",
                    q2: "Como Jeová vai acabar com o mundo mau de Satanás e o que Ele está fazendo agora para cumprir seu propósito?", a2: "",
                    q3: "Por que temos certeza que nada pode impedir Jeová de agir?", a3: ""
                },
                paragraphs: {
                    "1": { 
                        imageUrl: "", 
                        imageComment: "", 
                        linkedParagraphs: "", 
                        bibleRefs: "Sal. 31:5, Tit. 1:2", 
                        bibleTranscription: "",
                        textual: "Análise baseada em Salmo 31:5 e Tito 1:2. O princípio central é a imutabilidade da palavra de Jeová, o 'Deus da verdade'. Nota de estudo destaca que Ele é a própria fonte da confiabilidade.", 
                        resposta: "Podemos confiar plenamente em Jeová porque Ele é o Deus da verdade e é impossível que Ele minta. A frase da Sentinela destaca que suas promessas são garantias absolutas.", 
                        pastoral: "Na vida pessoal, essa verdade protege nosso coração contra as incertezas e mentiras deste sistema, dando estabilidade emotional e espiritual à família." 
                    }
                }
            }
        },
        customBibleVerses: {}
    };

    let appState = JSON.parse(localStorage.getItem("sentinela_v8_data")) || defaultData;
    let activeParagraph = "1";

    // Mapeamento de Elementos do DOM
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
    
    const viewLinkedBox = document.getElementById("view-linked-box");
    const viewLinkedBadges = document.getElementById("view-linked-badges");
    const viewBibleContainer = document.getElementById("view-bible-container");
    const viewBibleBadges = document.getElementById("view-bible-badges");
    
    const fieldsParagraphOnly = document.getElementById("fields-paragraph-only");
    const fieldsRecapOnly = document.getElementById("fields-recap-only");
    const editParagraphNum = document.getElementById("edit-paragraph-num");
    
    const inputImageUrl = document.getElementById("input-image-url");
    const inputLinkedP = document.getElementById("input-linked-p");
    const inputBibleRefs = document.getElementById("input-bible-refs");
    const inputBibleTranscription = document.getElementById("input-bible-transcription");
    const inputImageComment = document.getElementById("input-image-comment");
    const inputTextual = document.getElementById("input-textual");
    const inputResposta = document.getElementById("input-resposta");
    const inputPastoral = document.getElementById("input-pastoral");
    const charCounter = document.getElementById("char-counter");

    const recapQ1 = document.getElementById("recap-q1"); const recapA1 = document.getElementById("recap-a1");
    const recapQ2 = document.getElementById("recap-q2"); const recapA2 = document.getElementById("recap-a2");
    const recapQ3 = document.getElementById("recap-q3"); const recapA3 = document.getElementById("recap-a3");

    const btnEditMode = document.getElementById("btn-edit-mode");
    const btnSave = document.getElementById("btn-save");
    const btnCancel = document.getElementById("btn-cancel");
    const btnExport = document.getElementById("btn-export");
    const btnImport = document.getElementById("btn-import");
    const importFile = document.getElementById("import-file");

    function getActiveWeek() { return appState.weeks[appState.activeWeekId]; }
    function saveState() { localStorage.setItem("sentinela_v8_data", JSON.stringify(appState)); }

    function fetchBibleText(reference, paragraphTranscription) {
        const key = reference.toLowerCase().trim();
        // 1. Procura no banco estático
        if (BIBLE_DATABASE[key]) return BIBLE_DATABASE[key];
        // 2. Procura na transcrição exclusiva salva neste parágrafo
        if (paragraphTranscription && paragraphTranscription.trim() !== "") return paragraphTranscription;
        // 3. Procura no banco customizado geral
        if (appState.customBibleVerses && appState.customBibleVerses[key]) return appState.customBibleVerses[key];
        return null;
    }

    function updateWeeksDropdown() {
        selectWeek.innerHTML = "";
        Object.keys(appState.weeks).forEach(key => {
            const opt = document.createElement("option");
            opt.value = key; opt.innerText = appState.weeks[key].title;
            if (key === appState.activeWeekId) opt.selected = true;
            selectWeek.appendChild(opt);
        });
    }

    function buildParagraphsMenu(filterTerm = "") {
        const week = getActiveWeek();
        paragraphList.innerHTML = "";
        labelTotalP.innerText = week.totalParagraphs;
        linkRecap.classList.remove("active");

        for (let i = 1; i <= week.totalParagraphs; i++) {
            const pData = week.paragraphs[i] || { textual: "", resposta: "", pastoral: "", imageComment: "", bibleRefs: "" };
            if (filterTerm !== "") {
                const pool = `${pData.textual} ${pData.resposta} ${pData.pastoral} ${pData.imageComment} ${pData.bibleRefs}`.toLowerCase();
                if (!pool.includes(filterTerm.toLowerCase())) continue; 
            }
            const li = document.createElement("li");
            li.innerHTML = `<a href="#" class="nav-link ${activeParagraph == i ? 'active' : ''}" data-paragraph="${i}">Parágrafo ${i}</a>`;
            paragraphList.appendChild(li);
        }
        if (activeParagraph === "recap") linkRecap.classList.add("active");

        document.querySelectorAll(".sidebar-menu .nav-link:not(.special-link)").forEach(link => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                activeParagraph = link.getAttribute("data-paragraph");
                document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
                link.classList.add("active");
                showParagraph();
            });
        });
    }

// Geração Exclusiva de Textos Bíblicos - Correção de separação por vírgulas
        viewBibleBadges.innerHTML = "";
        if (pData.bibleRefs && pData.bibleRefs.trim() !== "") {
            viewBibleContainer.classList.remove("hidden");

            // Expressão regular inteligente para separar apenas referências bíblicas reais,
            // evitando quebrar o texto do versículo caso o usuário cole o texto direto ali.
            const refsArray = pData.bibleRefs.includes(":") 
                ? pData.bibleRefs.split(/,(?=\s*[A-ZÁÉÍÓÚa-záéíóú0-9]+\s*\d+:)/) 
                : pData.bibleRefs.split(",");

            refsArray.forEach(ref => {
                const trimmedRef = ref.trim();
                if (!trimmedRef) return;
                
                const block = document.createElement("div");
                block.className = "bible-text-display";
                
                // Se a referência já contiver o texto completo (separado por hífen ou aspas)
                if (trimmedRef.includes(" - ") || trimmedRef.includes(' "') || trimmedRef.includes(' “')) {
                    block.innerHTML = `<strong>📖 Escritura citada:</strong> ${trimmedRef}`;
                } else {
                    // Caso contrário, busca no banco de dados ou na caixa de transcrição
                    const txtBilia = fetchBibleText(trimmedRef, pData.bibleTranscription);
                    if (txtBilia) {
                        block.innerHTML = `<strong>${trimmedRef}:</strong> "${txtBilia}"`;
                    } else {
                        block.innerHTML = `<strong>${trimmedRef}:</strong> <span style="color:#7f8c8d; font-style:italic;">Nenhuma transcrição salva para este texto...</span>`;
                    }
                }
                viewBibleBadges.appendChild(block);
            });
        } else { 
            viewBibleContainer.classList.add("hidden"); 
        }

    btnEditMode.addEventListener("click", () => {
        const week = getActiveWeek();
        viewMode.classList.add("hidden");

        if (activeParagraph === "recap") {
            editParagraphNum.innerText = "Recapitulação";
            fieldsParagraphOnly.classList.add("hidden"); fieldsRecapOnly.classList.remove("hidden");
            recapQ1.value = week.recap?.q1 || ""; recapA1.value = week.recap?.a1 || "";
            recapQ2.value = week.recap?.q2 || ""; recapA2.value = week.recap?.a2 || "";
            recapQ3.value = week.recap?.q3 || ""; recapA3.value = week.recap?.a3 || "";
        } else {
            editParagraphNum.innerText = `Parágrafo ${activeParagraph}`;
            fieldsParagraphOnly.classList.remove("hidden"); fieldsRecapOnly.classList.add("hidden");
            
            const pData = week.paragraphs[activeParagraph] || { imageUrl: "", linkedParagraphs: "", bibleRefs: "", bibleTranscription: "", textual: "", resposta: "", pastoral: "" };
            
            // Alimenta os campos sem interromper com pop-ups ou alertas
            inputImageUrl.value = pData.imageUrl || "";
            inputLinkedP.value = pData.linkedParagraphs || "";
            inputBibleRefs.value = pData.bibleRefs || "";
            inputBibleTranscription.value = pData.bibleTranscription || "";
            inputImageComment.value = pData.imageComment || "";
            inputTextual.value = pData.textual || "";
            inputResposta.value = pData.resposta || "";
            inputPastoral.value = pData.pastoral || "";
            charCounter.innerText = `${inputResposta.value.length} / 400 caracteres`;
        }
        editMode.classList.remove("hidden");
    });

    btnSave.addEventListener("click", () => {
        const week = getActiveWeek();
        if (activeParagraph === "recap") {
            week.recap = { q1: recapQ1.value, a1: recapA1.value, q2: recapQ2.value, a2: recapA2.value, q3: recapQ3.value, a3: recapA3.value };
        } else {
            week.paragraphs[activeParagraph] = {
                imageUrl: inputImageUrl.value, 
                linkedParagraphs: inputLinkedP.value, 
                bibleRefs: inputBibleRefs.value,
                bibleTranscription: inputBibleTranscription.value, // Salva o texto bíblico digitado na caixa
                imageComment: inputImageComment.value, 
                textual: inputTextual.value, 
                resposta: inputResposta.value, 
                pastoral: inputPastoral.value
            };

            // Guarda também no banco global do app para autocompletar em outros parágrafos se repetir o texto
            if (inputBibleRefs.value && inputBibleTranscription.value.trim() !== "") {
                inputBibleRefs.value.split(",").forEach(ref => {
                    const cleanRef = ref.trim().toLowerCase();
                    if (cleanRef) {
                        if (!appState.customBibleVerses) appState.customBibleVerses = {};
                        appState.customBibleVerses[cleanRef] = inputBibleTranscription.value.trim();
                    }
                });
            }
        }
        saveState(); showParagraph();
    });

    linkRecap.addEventListener("click", (e) => { e.preventDefault(); activeParagraph = "recap"; buildParagraphsMenu(); showParagraph(); });
    inputResposta.addEventListener("input", () => { charCounter.innerText = `${inputResposta.value.length} / 400 caracteres`; });
    inputSearch.addEventListener("input", () => { buildParagraphsMenu(inputSearch.value); });
    btnCancel.addEventListener("click", () => { showParagraph(); });

    selectWeek.addEventListener("change", (e) => { appState.activeWeekId = e.target.value; activeParagraph = "1"; saveState(); buildParagraphsMenu(); showParagraph(); });

    btnAddWeek.addEventListener("click", () => {
        const title = prompt("Digite a Data e Tema da Nova Semana:");
        if (!title || !title.trim()) return;
        const id = "semana_" + Date.now();
        appState.weeks[id] = { id: id, title: title.trim(), totalParagraphs: 16, recap: { q1:"Pergunta 1?", a1:"", q2:"Pergunta 2?", a2:"", q3:"Pergunta 3?", a3:"" }, paragraphs: {} };
        appState.activeWeekId = id; activeParagraph = "1";
        saveState(); updateWeeksDropdown(); buildParagraphsMenu(); showParagraph();
    });

    btnDelWeek.addEventListener("click", () => {
        const keys = Object.keys(appState.weeks);
        if (keys.length <= 1) return alert("Mantenha ao menos uma semana.");
        if (confirm("Excluir esta semana de estudo?")) {
            const toDelete = appState.activeWeekId; appState.activeWeekId = keys.find(k => k !== toDelete);
            delete appState.weeks[toDelete]; activeParagraph = "1";
            saveState(); updateWeeksDropdown(); buildParagraphsMenu(); showParagraph();
        }
    });

    btnAddP.addEventListener("click", () => { getActiveWeek().totalParagraphs += 1; saveState(); buildParagraphsMenu(); });
    btnRemoveP.addEventListener("click", () => {
        const week = getActiveWeek(); if (week.totalParagraphs <= 1) return;
        if (confirm(`Remover parágrafo ${week.totalParagraphs}?`)) {
            delete week.paragraphs[week.totalParagraphs]; week.totalParagraphs -= 1;
            saveState(); buildParagraphsMenu(); showParagraph();
        }
    });

    btnExport.addEventListener("click", () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appState, null, 2));
        const anchor = document.createElement("a"); anchor.setAttribute("href", dataStr); anchor.setAttribute("download", "estudos_sentinela_backup.json");
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
    });

    btnImport.addEventListener("click", () => { importFile.click(); });
    importFile.addEventListener("change", (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);
                if (data.weeks) { appState = data; saveState(); activeParagraph = "1"; updateWeeksDropdown(); buildParagraphsMenu(); showParagraph(); alert("Backup carregado!"); }
            } catch (err) { alert("Erro no arquivo."); }
        };
        reader.readAsText(file);
    });

    updateWeeksDropdown(); buildParagraphsMenu(); showParagraph();
});
