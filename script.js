(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const STORAGE_KEY = 'sentinela-epub-studio-project-v2';
  const STUDIES_KEY = 'sentinela-epub-studio-studies-v2';
  const VERSIONS_KEY = 'sentinela-epub-studio-versions-v2';
  const MAX_VERSIONS = 15;
  const IMAGE_DB_NAME = 'sentinela-epub-image-cache-v1';
  const IMAGE_DB_STORE = 'images';
  const IMAGE_CACHE_VERSION = 1;
  const IMAGE_BASE_URL = 'https://wol.jw.org';
  const LOCAL_IMAGE_PROXY_PATH = '/__image_proxy';
  const LOCAL_HEALTH_PATH = '/__health';
  const IMAGE_FETCH_TIMEOUT_MS = 45000;
  const IMAGE_DOWNLOAD_CONCURRENCY = 2;
  const DEFAULT_MAX_IMAGE_DIMENSION = 1800;
  const REGRESSION_FIXTURE_PATH = 'testes/article-padrao.html';
  const ARTICLE_PROXY_PATH = '/__article_proxy';
  const EPUBCHECK_PATH = '/__epubcheck';
  const EPUBCHECK_STATUS_PATH = '/__health';
  const EXPORT_PROFILES = Object.freeze({
    balanced: { label: 'Equilibrado', quality: 0.85, maxDimension: 1800, compression: 6, mode: 'epub', description: 'Boa qualidade, tamanho moderado e EPUB completo.' },
    light: { label: 'EPUB leve', quality: 0.72, maxDimension: 1400, compression: 9, mode: 'epub', description: 'Arquivo menor, ideal para celulares e compartilhamento.' },
    high: { label: 'Alta qualidade', quality: 0.92, maxDimension: 2400, compression: 6, mode: 'epub', description: 'Imagens maiores e mais detalhadas, com arquivo final mais pesado.' },
    xhtml: { label: 'Somente XHTML', quality: null, maxDimension: null, compression: null, mode: 'xhtml', description: 'Organiza e baixa apenas o XHTML, sem criar o pacote EPUB.' },
    custom: { label: 'Personalizado', quality: null, maxDimension: null, compression: 6, mode: 'epub', description: 'Usa os valores definidos manualmente nas configurações avançadas.' }
  });

  const elements = {
    source: $('#source'),
    bibleTextInput: $('#bibleTextInput'),
    status: $('#status'),
    charCount: $('#charCount'),
    summaryCount: $('#summaryCount'),
    empty: $('#empty'),
    autosaveStatus: $('#autosaveStatus'),
    readyIndicator: $('#readyIndicator')
  };

  let result = null;
  let libraryItems = [];
  let versions = [];
  let undoStack = [];
  let redoStack = [];
  let autosaveTimer = null;
  let restoring = false;
  let savedParagraphSelection = null;
  let imageDbPromise = null;
  let imageManagerBusy = false;
  let lastGeneratedEpubBytes = null;
  let lastGeneratedEpubName = '';
  const imagePreviewUrls = new Map();
  const imageMemoryCache = new Map();

  const HIGHLIGHT_TYPES = Object.freeze({
    yellow: { className: 'marca-amarela', label: 'Resposta direta', shortLabel: 'Amarela' },
    blue: { className: 'marca-azul', label: 'Comentário adicional', shortLabel: 'Azul' },
    orange: { className: 'marca-laranja', label: 'Lembrar', shortLabel: 'Laranja' }
  });


  function setInlineStatus(selector, message, type = '') {
    const node = typeof selector === 'string' ? $(selector) : selector;
    if (!node) return;
    node.textContent = message;
    node.className = `inline-status${type ? ` ${type}` : ''}`;
  }

  function selectedExportProfile() {
    const key = $('#exportProfile')?.value || 'balanced';
    return EXPORT_PROFILES[key] || EXPORT_PROFILES.balanced;
  }

  function markReadyImagesForReprocessing(reason = 'Perfil de exportação alterado. Processe a imagem novamente.') {
    if (!result?.images) return;
    result.images.forEach((image, index) => {
      const model = normalizeImageModel(image, index);
      if (model.include && model.status === 'ready') {
        model.status = 'pending';
        model.error = reason;
      }
    });
  }

  function applyExportProfile(profileKey, { announce = true, force = false } = {}) {
    const select = $('#exportProfile');
    const profile = EXPORT_PROFILES[profileKey] || EXPORT_PROFILES.balanced;
    if (select && select.value !== profileKey) select.value = profileKey;
    const description = $('#exportProfileDescription');
    if (description) description.textContent = profile.description;
    const oldQuality = $('#imageQuality')?.value;
    const oldDimension = $('#imageMaxDimension')?.value;
    if (profile.quality != null && $('#imageQuality')) $('#imageQuality').value = String(profile.quality);
    if (profile.maxDimension != null && $('#imageMaxDimension')) $('#imageMaxDimension').value = String(profile.maxDimension);
    if (force || oldQuality !== $('#imageQuality')?.value || oldDimension !== $('#imageMaxDimension')?.value) {
      markReadyImagesForReprocessing();
      if (result) {
        result.xhtml = buildXhtml(result);
        $('#xhtmlCode').textContent = result.xhtml;
        renderImages();
      }
    }
    updateExportAvailability();
    if (announce) showStatus(`Perfil “${profile.label}” aplicado. ${profile.description}`);
    queueSave('Perfil de exportação alterado');
  }

  function currentArticleFromPageHtml(pageHtml) {
    const doc = new DOMParser().parseFromString(String(pageHtml || ''), 'text/html');
    const article = doc.querySelector('article#article') || doc.querySelector('article') || selectBestArticle(doc);
    if (!article || !clean(article.textContent)) throw new Error('A página foi baixada, mas nenhum elemento <article> legível foi encontrado.');
    return article.outerHTML;
  }

  async function importArticleFromUrl() {
    const input = $('#articleUrl');
    const button = $('#importArticleUrl');
    const raw = clean(input?.value);
    if (!raw) return setInlineStatus('#urlImportStatus', 'Cole o endereço completo da matéria.', 'error');
    let url;
    try { url = new URL(raw); } catch { return setInlineStatus('#urlImportStatus', 'O endereço informado não é uma URL válida.', 'error'); }
    const allowed = url.protocol === 'https:' && (url.hostname === 'jw.org' || url.hostname.endsWith('.jw.org'));
    if (!allowed) return setInlineStatus('#urlImportStatus', 'Use um endereço HTTPS de jw.org ou wol.jw.org.', 'error');
    if (button) { button.disabled = true; button.textContent = 'Importando…'; }
    setInlineStatus('#urlImportStatus', 'Baixando a matéria pelo servidor local…', 'working');
    try {
      const response = await fetch(`${ARTICLE_PROXY_PATH}?url=${encodeURIComponent(url.href)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || `Servidor respondeu HTTP ${response.status}.`);
      const articleHtml = currentArticleFromPageHtml(payload.html);
      elements.source.value = articleHtml;
      updateCharacterCount();
      const processed = await processCurrentSource({ sourceUrl: payload.url || url.href });
      if (!processed) throw new Error('A matéria foi baixada, mas não pôde ser processada.');
      setInlineStatus('#urlImportStatus', `Matéria importada com sucesso: ${result?.title || 'artigo'}.`, 'success');
    } catch (error) {
      setInlineStatus('#urlImportStatus', `${error?.message || 'Não foi possível importar a matéria.'} Abra a plataforma pelo INICIAR-SISTEMA.cmd.`, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Importar URL'; }
    }
  }

  function prettyHtmlForComparison(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const article = doc.querySelector('article#article') || doc.querySelector('article') || doc.body.firstElementChild;
    if (!article) return String(html || '');
    const source = article.outerHTML.replace(/>\s*</g, '><');
    const tokens = source.replace(/></g, '>\n<').split('\n');
    const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    let depth = 0;
    return tokens.map(token => {
      const trimmed = token.trim();
      const close = /^<\//.test(trimmed);
      const self = /\/>$/.test(trimmed) || /^<([a-z0-9:-]+)/i.test(trimmed) && voidTags.has((trimmed.match(/^<([a-z0-9:-]+)/i)?.[1] || '').toLowerCase());
      if (close) depth = Math.max(0, depth - 1);
      const line = `${'  '.repeat(depth)}${trimmed}`;
      if (!close && !self && /^<[^!?/][^>]*>/.test(trimmed) && !/<\/[^>]+>$/.test(trimmed)) depth += 1;
      return line;
    }).join('\n');
  }

  function alignDiffLines(leftText, rightText) {
    const left = String(leftText || '').split('\n');
    const right = String(rightText || '').split('\n');
    const n = left.length, m = right.length;
    if (n * m > 400000) {
      const max = Math.max(n, m);
      return Array.from({ length: max }, (_, i) => ({ left: left[i] ?? '', right: right[i] ?? '', type: left[i] === right[i] ? 'same' : 'changed' }));
    }
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const rows = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && left[i] === right[j]) { rows.push({ left: left[i++], right: right[j++], type: 'same' }); continue; }
      if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) rows.push({ left: left[i++], right: '', type: 'removed' });
      else rows.push({ left: '', right: right[j++], type: 'added' });
    }
    return rows;
  }

  function renderComparison() {
    const container = $('#comparison');
    if (!container || !result) return;
    let output = result.xhtml || buildXhtml(result);
    try { output = formatXhtmlForCopy(output); } catch { /* mostra a versão bruta */ }
    const original = prettyHtmlForComparison(elements.source?.value || result.articleHtml || '');
    const rows = alignDiffLines(original, output);
    const unchanged = rows.filter(row => row.type === 'same').length;
    const removed = rows.filter(row => row.type === 'removed').length;
    const added = rows.filter(row => row.type === 'added').length;
    const leftLines = rows.map(row => `<span class="diff-line ${row.left ? row.type : 'empty'}">${esc(row.left || ' ')}</span>`).join('');
    const rightLines = rows.map(row => `<span class="diff-line ${row.right ? row.type : 'empty'}">${esc(row.right || ' ')}</span>`).join('');
    container.innerHTML = `<div class="comparison-shell"><div class="comparison-toolbar"><div><span class="utility-kicker">COMPARAÇÃO ESTRUTURAL</span><h3>HTML original × XHTML final</h3><p class="comparison-note">Linhas vermelhas foram removidas na limpeza; linhas verdes foram acrescentadas na preparação do EPUB.</p></div><div class="comparison-metrics"><span class="comparison-metric">${unchanged} iguais</span><span class="comparison-metric">${removed} removidas</span><span class="comparison-metric">${added} adicionadas</span></div></div><div class="comparison-grid"><section class="comparison-pane"><header>Origem — &lt;article&gt;</header><pre class="comparison-code" id="comparisonOriginal">${leftLines}</pre></section><section class="comparison-pane"><header>Saída — XHTML</header><pre class="comparison-code" id="comparisonOutput">${rightLines}</pre></section></div></div>`;
    const leftPane = $('#comparisonOriginal', container);
    const rightPane = $('#comparisonOutput', container);
    let syncing = false;
    const sync = (from, to) => { if (syncing) return; syncing = true; to.scrollTop = from.scrollTop; to.scrollLeft = from.scrollLeft; requestAnimationFrame(() => { syncing = false; }); };
    leftPane?.addEventListener('scroll', () => sync(leftPane, rightPane));
    rightPane?.addEventListener('scroll', () => sync(rightPane, leftPane));
  }

  function epubCheckCounts(payload) {
    const messages = payload?.report?.messages || [];
    const severity = message => String(message?.severity || message?.level || '').toLowerCase();
    const count = key => messages.filter(message => severity(message).includes(key)).length;
    const checker = payload?.report?.checker || {};
    return {
      fatal: Number(checker.fatalErrorCount ?? checker.fatalCount ?? count('fatal')) || 0,
      errors: Number(checker.errorCount ?? count('error')) || 0,
      warnings: Number(checker.warningCount ?? count('warn')) || 0,
      messages
    };
  }

  function renderEpubCheckReport(payload) {
    const container = $('#epubCheckReport');
    if (!container) return;
    const counts = epubCheckCounts(payload);
    const messages = counts.messages.slice(0, 200);
    container.hidden = false;
    container.innerHTML = `<div class="epubcheck-summary"><div><span>Versão</span><strong>${esc(payload.version || payload.report?.checker?.version || '5.3.0')}</strong></div><div><span>Fatais</span><strong>${counts.fatal}</strong></div><div><span>Erros</span><strong>${counts.errors}</strong></div><div><span>Avisos</span><strong>${counts.warnings}</strong></div></div>${messages.length ? `<div class="epubcheck-messages">${messages.map(message => { const level = String(message.severity || message.level || 'info').toLowerCase(); const location = [message.path || message.location?.path, message.line || message.location?.line, message.column || message.location?.column].filter(value => value != null && value !== '').join(':'); return `<article class="epubcheck-message ${esc(level)}"><strong>${esc(String(message.ID || message.id || message.code || level).toUpperCase())}</strong> ${esc(message.message || message.text || '')}${location ? `<br><code>${esc(location)}</code>` : ''}</article>`; }).join('')}</div>` : '<p>Nenhuma mensagem foi registrada.</p>'}`;
    const ok = payload.ok && counts.fatal === 0 && counts.errors === 0;
    setInlineStatus('#epubCheckStatus', ok ? `Aprovado pelo EPUBCheck ${payload.version || '5.3.0'}${counts.warnings ? ` com ${counts.warnings} aviso(s)` : ''}.` : `EPUBCheck encontrou ${counts.fatal} erro(s) fatal(is), ${counts.errors} erro(s) e ${counts.warnings} aviso(s).`, ok ? 'success' : 'error');
  }

  async function runOfficialEpubCheck() {
    const button = $('#runEpubCheck');
    if (!result) return setInlineStatus('#epubCheckStatus', 'Processe uma matéria antes de validar.', 'error');
    if (selectedExportProfile().mode === 'xhtml') return setInlineStatus('#epubCheckStatus', 'O perfil “Somente XHTML” não cria um EPUB para validar.', 'error');
    if (button) { button.disabled = true; button.textContent = 'Gerando e validando…'; }
    setInlineStatus('#epubCheckStatus', 'Gerando uma cópia temporária e iniciando o EPUBCheck oficial…', 'working');
    try {
      const generated = await generateEpub({ download: false, silentSuccess: true, throwOnError: true });
      if (!generated?.bytes) throw new Error('O pacote EPUB não foi gerado.');
      const response = await fetch(EPUBCHECK_PATH, { method: 'POST', headers: { 'Content-Type': 'application/epub+zip' }, body: generated.bytes });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.setup?.Message || `Servidor respondeu HTTP ${response.status}.`);
      renderEpubCheckReport(payload);
    } catch (error) {
      setInlineStatus('#epubCheckStatus', `${error?.message || 'Não foi possível executar o EPUBCheck.'} Confirme que Java 11+ está instalado e que o sistema foi aberto pelo iniciador.`, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Validar com EPUBCheck'; }
    }
  }

  async function checkLocalServices() {
    try {
      const response = await fetch(EPUBCHECK_STATUS_PATH, { cache: 'no-store' });
      const payload = await response.json();
      const message = payload.epubcheck ? 'Servidor local ativo e EPUBCheck instalado.' : payload.java ? 'Servidor local ativo. O EPUBCheck será instalado no primeiro uso.' : 'Servidor local ativo. Instale Java 11+ para usar o EPUBCheck.';
      setInlineStatus('#epubCheckStatus', message, payload.epubcheck ? 'success' : '');
    } catch {
      setInlineStatus('#epubCheckStatus', 'Servidor local não detectado. Abra pelo INICIAR-SISTEMA.cmd.', 'error');
    }
  }

  function storageGet(key, fallback = null) {
    try { return window.localStorage.getItem(key) ?? fallback; }
    catch { return fallback; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch { return false; }
  }

  function storageRemove(key) {
    try { window.localStorage.removeItem(key); }
    catch { /* armazenamento indisponível */ }
  }

  function clean(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function slug(value, fallback = 'artigo') {
    const normalized = clean(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  function showStatus(message, error = false) {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.className = `status${error ? ' error' : ' success'}`;
    elements.status.style.display = 'block';
  }

  function setProcessing(active) {
    const button = $('#extract');
    if (!button) return;
    button.disabled = active;
    button.setAttribute('aria-busy', String(active));
    button.innerHTML = active
      ? '<span class="button-spinner" aria-hidden="true"></span> Processando…'
      : 'Processar artigo <span aria-hidden="true">→</span>';
  }

  function normalizeReference(value) {
    return clean(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/[.;]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  const BIBLE_BOOKS = [
    ['Gênesis', ['Gênesis', 'Gên.', 'Gên', 'Gen.', 'Gen']],
    ['Êxodo', ['Êxodo', 'Êxo.', 'Êxo', 'Exodo', 'Exo.', 'Exo']],
    ['Levítico', ['Levítico', 'Lev.', 'Lev', 'Levitico']],
    ['Números', ['Números', 'Núm.', 'Núm', 'Numeros', 'Num.', 'Num']],
    ['Deuteronômio', ['Deuteronômio', 'Deut.', 'Deut', 'Deuteronomio']],
    ['Josué', ['Josué', 'Jos.', 'Jos', 'Josue']],
    ['Juízes', ['Juízes', 'Juí.', 'Juí', 'Juizes', 'Jui.', 'Jui']],
    ['Rute', ['Rute', 'Rut.']],
    ['1 Samuel', ['1 Samuel', '1 Sam.', '1 Sam', 'I Samuel']],
    ['2 Samuel', ['2 Samuel', '2 Sam.', '2 Sam', 'II Samuel']],
    ['1 Reis', ['1 Reis', '1 Re.', '1 Re', 'I Reis']],
    ['2 Reis', ['2 Reis', '2 Re.', '2 Re', 'II Reis']],
    ['1 Crônicas', ['1 Crônicas', '1 Crô.', '1 Crô', '1 Cronicas', '1 Cro.', '1 Cro', 'I Crônicas', 'I Cronicas']],
    ['2 Crônicas', ['2 Crônicas', '2 Crô.', '2 Crô', '2 Cronicas', '2 Cro.', '2 Cro', 'II Crônicas', 'II Cronicas']],
    ['Esdras', ['Esdras', 'Esd.', 'Esd']],
    ['Neemias', ['Neemias', 'Nee.', 'Nee']],
    ['Ester', ['Ester', 'Est.', 'Est']],
    ['Jó', ['Jó']],
    ['Salmos', ['Salmos', 'Salmo', 'Sal.', 'Sal', 'Sl.', 'Sl']],
    ['Provérbios', ['Provérbios', 'Pro.', 'Pro', 'Prov.', 'Prov', 'Proverbios']],
    ['Eclesiastes', ['Eclesiastes', 'Ecl.', 'Ecl']],
    ['Cântico de Salomão', ['Cântico de Salomão', 'Cântico', 'Cân.', 'Cân', 'Cantico de Salomao', 'Cantico', 'Can.', 'Can']],
    ['Isaías', ['Isaías', 'Isa.', 'Isa', 'Isaias']],
    ['Jeremias', ['Jeremias', 'Jer.', 'Jer']],
    ['Lamentações', ['Lamentações', 'Lam.', 'Lam', 'Lamentacoes']],
    ['Ezequiel', ['Ezequiel', 'Eze.', 'Eze']],
    ['Daniel', ['Daniel', 'Dan.', 'Dan']],
    ['Oseias', ['Oseias', 'Ose.', 'Ose']],
    ['Joel', ['Joel']],
    ['Amós', ['Amós', 'Amos']],
    ['Obadias', ['Obadias', 'Oba.', 'Oba']],
    ['Jonas', ['Jonas', 'Jon.', 'Jon']],
    ['Miqueias', ['Miqueias', 'Miq.', 'Miq']],
    ['Naum', ['Naum']],
    ['Habacuque', ['Habacuque', 'Hab.', 'Hab']],
    ['Sofonias', ['Sofonias', 'Sof.', 'Sof']],
    ['Ageu', ['Ageu', 'Ag.', 'Ag']],
    ['Zacarias', ['Zacarias', 'Zac.', 'Zac']],
    ['Malaquias', ['Malaquias', 'Mal.', 'Mal']],
    ['Mateus', ['Mateus', 'Mat.', 'Mat', 'Mt.', 'Mt']],
    ['Marcos', ['Marcos', 'Mar.', 'Mar', 'Mc.', 'Mc']],
    ['Lucas', ['Lucas', 'Luc.', 'Luc', 'Lc.', 'Lc']],
    ['João', ['João', 'Jo.', 'Jo', 'Joao']],
    ['Atos', ['Atos', 'At.', 'At']],
    ['Romanos', ['Romanos', 'Rom.', 'Rom', 'Ro.', 'Ro']],
    ['1 Coríntios', ['1 Coríntios', '1 Cor.', '1 Cor', '1 Corintios', 'I Coríntios', 'I Corintios']],
    ['2 Coríntios', ['2 Coríntios', '2 Cor.', '2 Cor', '2 Corintios', 'II Coríntios', 'II Corintios']],
    ['Gálatas', ['Gálatas', 'Gál.', 'Gál', 'Galatas', 'Gal.', 'Gal']],
    ['Efésios', ['Efésios', 'Efé.', 'Efé', 'Efesios', 'Efe.', 'Efe']],
    ['Filipenses', ['Filipenses', 'Fil.', 'Fil']],
    ['Colossenses', ['Colossenses', 'Col.', 'Col']],
    ['1 Tessalonicenses', ['1 Tessalonicenses', '1 Tes.', '1 Tes', 'I Tessalonicenses']],
    ['2 Tessalonicenses', ['2 Tessalonicenses', '2 Tes.', '2 Tes', 'II Tessalonicenses']],
    ['1 Timóteo', ['1 Timóteo', '1 Tim.', '1 Tim', '1 Timoteo', 'I Timóteo', 'I Timoteo']],
    ['2 Timóteo', ['2 Timóteo', '2 Tim.', '2 Tim', '2 Timoteo', 'II Timóteo', 'II Timoteo']],
    ['Tito', ['Tito', 'Tit.', 'Tit']],
    ['Filêmon', ['Filêmon', 'Filêm.', 'Filêm', 'Filemon', 'Filem.', 'Filem']],
    ['Hebreus', ['Hebreus', 'Heb.', 'Heb']],
    ['Tiago', ['Tiago', 'Tia.', 'Tia']],
    ['1 Pedro', ['1 Pedro', '1 Ped.', '1 Ped', 'I Pedro']],
    ['2 Pedro', ['2 Pedro', '2 Ped.', '2 Ped', 'II Pedro']],
    ['1 João', ['1 João', '1 Jo.', '1 Jo', '1 Joao', 'I João', 'I Joao']],
    ['2 João', ['2 João', '2 Jo.', '2 Jo', '2 Joao', 'II João', 'II Joao']],
    ['3 João', ['3 João', '3 Jo.', '3 Jo', '3 Joao', 'III João', 'III Joao']],
    ['Judas', ['Judas', 'Jud.', 'Jud']],
    ['Apocalipse', ['Apocalipse', 'Apo.', 'Apo', 'Ap.', 'Ap']]
  ];

  function normalizeBookToken(value) {
    return clean(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[º°.]/g, '')
      .replace(/^iii\s+/, '3 ')
      .replace(/^ii\s+/, '2 ')
      .replace(/^i\s+/, '1 ')
      .replace(/\s+/g, ' ');
  }

  const BOOK_ALIAS_MAP = new Map();
  const BOOK_EXACT_MAP = new Map();
  const BOOK_ALIAS_SOURCE = new Set();
  BIBLE_BOOKS.forEach(([canonical, aliases]) => {
    [canonical, ...aliases].forEach(alias => {
      BOOK_EXACT_MAP.set(clean(alias).toLowerCase().replace(/[º°.]/g, '').replace(/\s+/g, ' '), canonical);
      BOOK_ALIAS_MAP.set(normalizeBookToken(alias), canonical);
      BOOK_ALIAS_SOURCE.add(alias);
      BOOK_ALIAS_SOURCE.add(alias.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    });
  });

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function aliasToPattern(alias) {
    return clean(alias).split(/\s+/).map(part => {
      const hasDot = part.endsWith('.');
      const bare = hasDot ? part.slice(0, -1) : part;
      return `${escapeRegex(bare)}${hasDot ? '\\.?' : ''}`;
    }).join('[\\s\\u00a0]+');
  }

  const BOOK_PATTERN = [...BOOK_ALIAS_SOURCE]
    .sort((a, b) => b.length - a.length)
    .map(aliasToPattern)
    .join('|');

  const VERSE_TOKEN_PATTERN = '\\d{1,3}[a-z]?';
  const VERSE_SPEC_PATTERN = `${VERSE_TOKEN_PATTERN}(?:\\s*(?:[-–—−]\\s*(?:\\d{1,3}\\s*:\\s*)?${VERSE_TOKEN_PATTERN}|,\\s*${VERSE_TOKEN_PATTERN}))*`;
  const REFERENCE_REGEX = new RegExp(
    `(^|[^\\p{L}\\d])(${BOOK_PATTERN})[\\s\\u00a0]+(\\d{1,3})\\s*:\\s*(${VERSE_SPEC_PATTERN})`,
    'giu'
  );
  const CONTINUATION_REGEX = new RegExp(
    `^\\s*;\\s*(\\d{1,3})\\s*:\\s*(${VERSE_SPEC_PATTERN})`,
    'iu'
  );

  function canonicalBook(value) {
    const exact = clean(value).toLowerCase().replace(/[º°.]/g, '').replace(/\s+/g, ' ');
    return BOOK_EXACT_MAP.get(exact) || BOOK_ALIAS_MAP.get(normalizeBookToken(value)) || '';
  }

  function normalizeVerseSpec(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/\s*([,:-])\s*/g, '$1')
      .replace(/[.;]+$/g, '');
  }

  function verseSignature(chapterRaw, versesRaw) {
    const chapter = Number.parseInt(chapterRaw, 10);
    const verses = normalizeVerseSpec(versesRaw);
    if (!chapter || !verses) return '';

    // Faixas que atravessam capítulos permanecem textuais.
    if (/\d:\d/.test(verses)) return `${chapter}:${verses}`;

    const expanded = [];
    let expandable = true;
    verses.split(',').forEach(part => {
      const range = part.match(/^(\d{1,3})([a-z]?)-(\d{1,3})([a-z]?)$/i);
      const single = part.match(/^(\d{1,3})([a-z]?)$/i);
      if (range && !range[2] && !range[4]) {
        const start = Number(range[1]);
        const end = Number(range[3]);
        if (end >= start && end - start <= 250) {
          for (let verse = start; verse <= end; verse += 1) expanded.push(String(verse));
        } else expandable = false;
      } else if (single) {
        expanded.push(`${Number(single[1])}${single[2].toLowerCase()}`);
      } else {
        expandable = false;
      }
    });

    if (!expandable || !expanded.length) return `${chapter}:${verses}`;
    return `${chapter}:${[...new Set(expanded)].join(',')}`;
  }

  function makeReference(bookRaw, chapterRaw, versesRaw, raw = '') {
    const book = canonicalBook(bookRaw) || (BIBLE_BOOKS.some(([canonical]) => canonical === bookRaw) ? bookRaw : '');
    const chapter = String(Number.parseInt(chapterRaw, 10));
    const verses = normalizeVerseSpec(versesRaw);
    if (!book || !chapter || !verses) return null;
    const reference = `${book} ${chapter}:${verses}`;
    const key = `${normalizeBookToken(book)}|${verseSignature(chapter, verses)}`;
    return { raw: raw || reference, reference, key, book, chapter, verses };
  }

  function extractReferencesFromText(value) {
    const text = String(value || '').replace(/\u00a0/g, ' ');
    const found = [];
    REFERENCE_REGEX.lastIndex = 0;
    let match;

    while ((match = REFERENCE_REGEX.exec(text))) {
      const prefix = match[1] || '';
      const start = match.index + prefix.length;
      const end = REFERENCE_REGEX.lastIndex;
      const parsed = makeReference(match[2], match[3], match[4], text.slice(start, end));
      if (parsed) found.push({ ...parsed, start, end });

      let cursor = end;
      while (cursor < text.length && parsed) {
        const continuation = CONTINUATION_REGEX.exec(text.slice(cursor));
        if (!continuation) break;
        const numericOffset = continuation[0].search(/\d/);
        const continuationStart = cursor + Math.max(0, numericOffset);
        const continuationEnd = cursor + continuation[0].length;
        const inherited = makeReference(parsed.book, continuation[1], continuation[2], text.slice(continuationStart, continuationEnd));
        if (inherited) found.push({ ...inherited, start: continuationStart, end: continuationEnd });
        cursor = continuationEnd;
      }
      if (cursor > REFERENCE_REGEX.lastIndex) REFERENCE_REGEX.lastIndex = cursor;
    }

    return found;
  }

  function parseReference(value) {
    const text = clean(value).replace(/^[([{“"']+|[)\]}”"'.;]+$/g, '');
    const references = extractReferencesFromText(text);
    if (references.length !== 1) return null;
    const match = references[0];
    if (clean(text.slice(0, match.start)) || clean(text.slice(match.end))) return null;
    return match;
  }

  function referenceKey(value) {
    return parseReference(value)?.key || normalizeReference(value);
  }

  function parseBibleBlock(text) {
    const entries = [];
    let current = null;

    const commit = () => {
      if (!current) return;
      current.text = clean(current.text);
      if (current.references.length && current.text) entries.push(current);
      current = null;
    };

    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(line => {
      const match = line.match(/^\s*(?:(?:[-•*]|\d+[.)-])\s*)?[\[(]([^\])]+)[\])]\s*(.*)$/u);
      if (match) {
        commit();
        const references = extractReferencesFromText(match[1]);
        current = {
          reference: references.map(item => item.reference).join('; ') || clean(match[1]),
          references: references.map(item => item.reference),
          keys: [...new Set(references.map(item => item.key))],
          key: references[0]?.key || referenceKey(match[1]),
          text: clean(match[2])
        };
      } else if (current && clean(line)) {
        current.text = clean(`${current.text} ${line}`);
      }
    });
    commit();

    return entries.filter(entry => entry.keys.length && entry.text);
  }

  function sanitizeArticle(element) {
    const clone = element.cloneNode(true);

    // Componentes de interface do site de origem que ficam dentro do <article>,
    // mas não pertencem ao conteúdo editorial.
    clone.querySelectorAll([
      'script','style','iframe','object','embed','form','input','button','select','option','link','meta','template',
      '.pswp','#questionContainer','#galleryModalContainer','.galleryModalContainer','.underlay.full',
      '[data-ui-only="true"]'
    ].join(',')).forEach(node => node.remove());

    const commentWalker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (commentWalker.nextNode()) comments.push(commentWalker.currentNode);
    comments.forEach(node => node.remove());

    const textWalker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    while (textWalker.nextNode()) {
      textWalker.currentNode.nodeValue = String(textWalker.currentNode.nodeValue || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    }

    clone.querySelectorAll('*').forEach(node => {
      [...node.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'contenteditable') node.removeAttribute(attribute.name);
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*(?:javascript|vbscript):/i.test(value)) node.removeAttribute(attribute.name);
        if (name === 'style' && /url\s*\(|expression\s*\(/i.test(value)) node.removeAttribute(attribute.name);
      });
    });
    return clone;
  }

  function extractParagraphNumber(paragraph, fallback = '') {
    if (!paragraph) return clean(fallback);
    const marker = paragraph.matches?.('.parNum[data-pnum]')
      ? paragraph
      : paragraph.querySelector?.('.parNum[data-pnum]');
    const raw = marker?.getAttribute?.('data-pnum') || marker?.textContent || fallback;
    return clean(raw).match(/^\d{1,3}(?:\s*[-–—]\s*\d{1,3})?/)?.[0] || '';
  }

  function paragraphText(paragraph) {
    const clone = paragraph.cloneNode(true);
    clone.querySelectorAll('.parNum,.pageNum,.footnote,[data-pnum].parNum').forEach(node => node.remove());
    return clean(clone.textContent);
  }


  function markerMeta(type) {
    return HIGHLIGHT_TYPES[type] || null;
  }

  function normalizeParagraphHighlights(paragraph) {
    const text = String(paragraph?.text || '');
    const length = text.length;
    const source = Array.isArray(paragraph?.highlights) ? paragraph.highlights : [];
    const normalized = source
      .map((item, index) => {
        const type = String(item?.type || '');
        const start = Math.max(0, Math.min(length, Number.parseInt(item?.start, 10) || 0));
        const end = Math.max(start, Math.min(length, Number.parseInt(item?.end, 10) || 0));
        if (!markerMeta(type) || end <= start) return null;
        return {
          id: clean(item?.id) || `mark-${paragraph?.number || 'p'}-${index}-${start}-${end}`,
          type,
          start,
          end,
          text: text.slice(start, end),
          createdAt: item?.createdAt || new Date().toISOString()
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const nonOverlapping = [];
    normalized.forEach(item => {
      const previous = nonOverlapping[nonOverlapping.length - 1];
      if (!previous) {
        nonOverlapping.push(item);
        return;
      }
      if (item.start < previous.end) item.start = previous.end;
      if (item.end <= item.start) return;
      item.text = text.slice(item.start, item.end);
      if (previous.type === item.type && previous.end === item.start) {
        previous.end = item.end;
        previous.text = text.slice(previous.start, previous.end);
      } else {
        nonOverlapping.push(item);
      }
    });

    if (paragraph) paragraph.highlights = nonOverlapping;
    return nonOverlapping;
  }

  function replaceHighlightRange(paragraph, start, end, type = '') {
    if (!paragraph) return;
    const text = String(paragraph.text || '');
    start = Math.max(0, Math.min(text.length, Number(start) || 0));
    end = Math.max(start, Math.min(text.length, Number(end) || 0));
    if (end <= start) return;

    const next = [];
    normalizeParagraphHighlights(paragraph).forEach(item => {
      if (item.end <= start || item.start >= end) {
        next.push(item);
        return;
      }
      if (item.start < start) {
        next.push({ ...item, id: `${item.id}-a`, end: start, text: text.slice(item.start, start) });
      }
      if (item.end > end) {
        next.push({ ...item, id: `${item.id}-b`, start: end, text: text.slice(end, item.end) });
      }
    });

    if (markerMeta(type)) {
      next.push({
        id: `mark-${paragraph.number}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        start,
        end,
        text: text.slice(start, end),
        createdAt: new Date().toISOString()
      });
    }

    paragraph.highlights = next;
    normalizeParagraphHighlights(paragraph);
  }

  function highlightedTextHtml(paragraph) {
    const text = String(paragraph?.text || '');
    const highlights = normalizeParagraphHighlights(paragraph);
    if (!highlights.length) return esc(text);
    let cursor = 0;
    const parts = [];
    highlights.forEach(item => {
      if (item.start > cursor) parts.push(esc(text.slice(cursor, item.start)));
      const meta = markerMeta(item.type);
      parts.push(`<mark class="${meta.className}" data-marker="${esc(item.type)}" title="${esc(meta.label)}">${esc(text.slice(item.start, item.end))}</mark>`);
      cursor = item.end;
    });
    if (cursor < text.length) parts.push(esc(text.slice(cursor)));
    return parts.join('');
  }

  function totalHighlightCount(data = result) {
    return (data?.paragraphs || []).reduce((total, paragraph) => total + normalizeParagraphHighlights(paragraph).length, 0);
  }

  function selectionOffsetsWithin(root) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

    const preRange = range.cloneRange();
    preRange.selectNodeContents(root);
    preRange.setEnd(range.startContainer, range.startOffset);
    let start = preRange.toString().length;
    let end = start + range.toString().length;
    const fullText = root.textContent || '';
    while (start < end && /\s/u.test(fullText[start] || '')) start += 1;
    while (end > start && /\s/u.test(fullText[end - 1] || '')) end -= 1;
    if (end <= start) return null;
    return { start, end, text: fullText.slice(start, end) };
  }

  function buildCanonicalTextMap(root) {
    const positions = [];
    let text = '';
    let pendingSpace = null;
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('.parNum,.pageNum,script,style,textarea')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let offset = 0; offset < node.nodeValue.length; offset += 1) {
        const raw = node.nodeValue[offset];
        const char = raw === '\u00a0' ? ' ' : raw;
        if (/\s/u.test(char)) {
          if (text && !text.endsWith(' ') && !pendingSpace) pendingSpace = { node, start: offset, end: offset + 1 };
          continue;
        }
        if (pendingSpace) {
          text += ' ';
          positions.push(pendingSpace);
          pendingSpace = null;
        }
        text += char;
        positions.push({ node, start: offset, end: offset + 1 });
      }
    }
    return { text, positions };
  }

  function resolveHighlightRange(mapText, highlight) {
    const expected = clean(highlight?.text || '');
    let start = Math.max(0, Math.min(mapText.length, Number(highlight?.start) || 0));
    let end = Math.max(start, Math.min(mapText.length, Number(highlight?.end) || 0));
    if (!expected || clean(mapText.slice(start, end)) === expected) return { start, end };

    const candidates = [];
    let cursor = mapText.indexOf(expected);
    while (cursor >= 0) {
      candidates.push(cursor);
      cursor = mapText.indexOf(expected, cursor + 1);
    }
    if (!candidates.length) return { start, end };
    start = candidates.sort((a, b) => Math.abs(a - start) - Math.abs(b - start))[0];
    end = start + expected.length;
    return { start, end };
  }

  function applyHighlightsToElement(element, highlights) {
    if (!element || !highlights?.length) return;
    const map = buildCanonicalTextMap(element);
    if (!map.positions.length) return;
    const tasksByNode = new Map();

    highlights.forEach(highlight => {
      const meta = markerMeta(highlight.type);
      if (!meta) return;
      const range = resolveHighlightRange(map.text, highlight);
      const entries = map.positions.slice(range.start, range.end);
      let current = null;
      entries.forEach(position => {
        if (current && current.node === position.node && current.end === position.start) {
          current.end = position.end;
          return;
        }
        current = { node: position.node, start: position.start, end: position.end, type: highlight.type, className: meta.className, label: meta.label };
        if (!tasksByNode.has(position.node)) tasksByNode.set(position.node, []);
        tasksByNode.get(position.node).push(current);
      });
    });

    tasksByNode.forEach((tasks, node) => {
      tasks.sort((a, b) => b.start - a.start || b.end - a.end).forEach(task => {
        if (!node.isConnected || task.end > node.nodeValue.length || task.end <= task.start) return;
        const range = node.ownerDocument.createRange();
        range.setStart(node, task.start);
        range.setEnd(node, task.end);
        const mark = node.ownerDocument.createElement('mark');
        mark.className = task.className;
        mark.setAttribute('data-marker', task.type);
        mark.setAttribute('title', task.label);
        range.surroundContents(mark);
      });
    });
  }

  function applyHighlightsToArticle(article, paragraphs) {
    const nodesByNumber = new Map();
    $$('p[data-rel-pid]', article).forEach(node => {
      const number = extractParagraphNumber(node);
      if (!number) return;
      if (!nodesByNumber.has(number)) nodesByNumber.set(number, []);
      nodesByNumber.get(number).push(node);
    });

    (paragraphs || []).forEach(paragraph => {
      const highlights = normalizeParagraphHighlights(paragraph);
      if (!highlights.length) return;
      const nodes = nodesByNumber.get(String(paragraph.number)) || [];
      let base = 0;
      nodes.forEach(node => {
        const map = buildCanonicalTextMap(node);
        const length = map.text.length;
        const local = highlights
          .filter(item => item.end > base && item.start < base + length)
          .map(item => ({
            ...item,
            start: Math.max(0, item.start - base),
            end: Math.min(length, item.end - base),
            text: String(paragraph.text || '').slice(Math.max(base, item.start), Math.min(base + length, item.end))
          }))
          .filter(item => item.end > item.start);
        applyHighlightsToElement(node, local);
        base += length + 1;
      });
    });
  }

  function normalizedContentKey(value) {
    return clean(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[“”‘’'"`´]/g, '')
      .replace(/\s+/g, ' ');
  }

  function isAnswerPlaceholder(node) {
    const text = normalizedContentKey(node?.textContent || '');
    return /^(?:sua|suas|sua própria|suas próprias)?\s*respostas?$/.test(text);
  }

  function questionHint(node) {
    const hint = `${node?.className || ''} ${node?.id || ''} ${node?.getAttribute?.('data-type') || ''} ${node?.getAttribute?.('role') || ''}`;
    return /(?:^|[\s_-])(qu|question|pergunta|studyquestion|reviewquestion)(?:$|[\s_-])/i.test(hint);
  }

  function startsWithStudyNumber(text) {
    return /^\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?\s*[.)]\s*/u.test(text);
  }

  function nextElementWithText(node) {
    let cursor = node?.nextElementSibling;
    while (cursor && !clean(cursor.textContent)) cursor = cursor.nextElementSibling;
    return cursor;
  }

  function isQuestionCandidate(node) {
    const text = clean(node?.textContent);
    if (!text || !text.includes('?') || text.length > 1200) return false;
    if (questionHint(node) || startsWithStudyNumber(text)) return true;
    if (node.matches?.('li') && text.length <= 500) return true;
    if (isAnswerPlaceholder(nextElementWithText(node))) return true;
    return false;
  }

  function questionParagraphLabel(node) {
    const own = clean(node?.getAttribute?.('data-pnum') || node?.closest?.('[data-pnum]')?.getAttribute('data-pnum'));
    if (own) return own;
    return clean(node?.textContent).match(/^\s*(\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)\s*[.)]/u)?.[1] || '';
  }

  function selectBestArticle(doc) {
    const candidates = $$('article', doc);
    if (!candidates.length) return doc.body;
    return candidates
      .map(node => {
        const textLength = clean(node.textContent).length;
        const numbered = $$('[data-pnum],.parNum', node).length;
        const questions = $$('p,li', node).filter(isQuestionCandidate).length;
        const images = $$('img,picture', node).length;
        return { node, score: textLength + numbered * 1800 + questions * 500 + images * 100 };
      })
      .sort((a, b) => b.score - a.score)[0]?.node || doc.body;
  }

  function meaningfulFlowNodes(article) {
    const selector = 'h1,h2,h3,h4,h5,h6,p,figure,figcaption,blockquote,ul,ol,hr,dt,dd';
    return $$(selector, article).filter(node => {
      if (!clean(node.textContent) && !node.matches('figure,hr')) return false;
      const parentBlock = node.parentElement?.closest(selector);
      if (!parentBlock) return true;
      // Parágrafos e itens internos são unidades úteis mesmo dentro de divs/listas.
      if (node.matches('p,figcaption,dt,dd')) return true;
      if (node.matches('ul,ol') && node.querySelector('p')) return false;
      return !parentBlock.matches('p,li,blockquote,figcaption,dt,dd');
    });
  }

  function hasGroupingBoundary(flow, indexMap, previous, current, questionNodes) {
    if (!previous || !current) return true;
    const start = indexMap.get(previous);
    const end = indexMap.get(current);
    if (start == null || end == null || end <= start) return true;
    for (let index = start + 1; index < end; index += 1) {
      const node = flow[index];
      if (questionNodes.has(node)) return true;
      if (node.matches('h1,h2,h3,h4,h5,h6,figure,hr,ul,ol,blockquote')) return true;
    }
    return false;
  }

  function nearestFollowingParagraphNumber(node, paragraphNodes) {
    for (const paragraph of paragraphNodes) {
      if (node.compareDocumentPosition(paragraph) & Node.DOCUMENT_POSITION_FOLLOWING) {
        const number = extractParagraphNumber(paragraph);
        if (number) return number;
      }
    }
    return '';
  }

  function uniqueValues(values) {
    return [...new Set((values || []).map(clean).filter(Boolean))];
  }

  function parseSrcset(value) {
    return String(value || '')
      .split(',')
      .map(entry => clean(entry).split(/\s+/)[0])
      .filter(Boolean);
  }

  function resolveImageUrl(source) {
    const raw = clean(source);
    if (!raw) return '';
    try {
      if (/^data:|^blob:/i.test(raw)) return raw;
      if (/^\/\//.test(raw)) return `https:${raw}`;
      if (/^https?:/i.test(raw)) return raw;
      return new URL(raw, IMAGE_BASE_URL).href;
    } catch {
      return raw;
    }
  }

  function collectImageCandidates(image) {
    if (!image) return [];
    const picture = image.closest('picture');
    const candidates = [
      image.getAttribute('src'),
      image.getAttribute('data-img-src'),
      image.getAttribute('data-img-small-src'),
      image.getAttribute('data-src'),
      image.getAttribute('data-original'),
      image.getAttribute('data-lazy-src'),
      ...parseSrcset(image.getAttribute('srcset')),
      ...Array.from(picture?.querySelectorAll('source[srcset]') || []).flatMap(source => parseSrcset(source.getAttribute('srcset')))
    ];
    return uniqueValues(candidates).filter(value => !/^data:image\/(?:gif|png);base64,R0lGODlhAQABA/i.test(value));
  }

  function detectImageSource(image) {
    return collectImageCandidates(image)[0] || '';
  }

  function simpleHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function imageCacheKey(source, index = 0) {
    return `image:${simpleHash(resolveImageUrl(source) || `manual-${index}`)}`;
  }

  function normalizeImageModel(image, index = 0) {
    const candidates = uniqueValues(image?.candidates?.length ? image.candidates : [image?.src]);
    const absoluteCandidates = uniqueValues(image?.absoluteCandidates?.length
      ? image.absoluteCandidates
      : candidates.map(resolveImageUrl));
    const model = image || {};
    model.order = Number(model.order) || index + 1;
    model.src = clean(model.src || candidates[0]);
    model.candidates = candidates;
    model.absoluteCandidates = absoluteCandidates;
    model.include = model.include !== false;
    model.status = ['pending', 'downloading', 'ready', 'error', 'excluded'].includes(model.status)
      ? model.status
      : (model.include ? 'pending' : 'excluded');
    model.cacheKey = clean(model.cacheKey || (absoluteCandidates[0] ? imageCacheKey(absoluteCandidates[0], index) : ''));
    model.localPath = clean(model.localPath);
    model.resolvedUrl = clean(model.resolvedUrl);
    model.mediaType = clean(model.mediaType);
    model.sizeBytes = Number(model.sizeBytes) || 0;
    model.originalSizeBytes = Number(model.originalSizeBytes) || 0;
    model.savedBytes = Number(model.savedBytes) || Math.max(0, model.originalSizeBytes - model.sizeBytes);
    model.originalWidth = Number(model.originalWidth) || 0;
    model.originalHeight = Number(model.originalHeight) || 0;
    model.width = Number(model.width) || 0;
    model.height = Number(model.height) || 0;
    model.wasResized = Boolean(model.wasResized);
    model.error = clean(model.error);
    model.sourceKind = clean(model.sourceKind || 'remote');
    return model;
  }

  function openImageDatabase() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (imageDbPromise) return imageDbPromise;
    imageDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_CACHE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(IMAGE_DB_STORE)) {
          database.createObjectStore(IMAGE_DB_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o cache de imagens.'));
    }).catch(() => null);
    return imageDbPromise;
  }

  async function imageCacheGet(key) {
    const normalizedKey = clean(key);
    if (!normalizedKey) return null;
    if (imageMemoryCache.has(normalizedKey)) return imageMemoryCache.get(normalizedKey);
    const database = await openImageDatabase();
    if (!database) return null;
    return new Promise(resolve => {
      const transaction = database.transaction(IMAGE_DB_STORE, 'readonly');
      const request = transaction.objectStore(IMAGE_DB_STORE).get(normalizedKey);
      request.onsuccess = () => {
        const record = request.result || null;
        if (record) imageMemoryCache.set(normalizedKey, record);
        resolve(record);
      };
      request.onerror = () => resolve(null);
    });
  }

  async function imageCachePut(record) {
    if (!record?.key || !(record.blob instanceof Blob)) return false;
    const storedRecord = { ...record, savedAt: new Date().toISOString() };
    imageMemoryCache.set(record.key, storedRecord);
    const database = await openImageDatabase();
    if (!database) return true;
    return new Promise(resolve => {
      const transaction = database.transaction(IMAGE_DB_STORE, 'readwrite');
      transaction.objectStore(IMAGE_DB_STORE).put(storedRecord);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    });
  }

  async function imageCacheDelete(key) {
    const normalizedKey = clean(key);
    if (!normalizedKey) return false;
    imageMemoryCache.delete(normalizedKey);
    const database = await openImageDatabase();
    if (!database) return true;
    return new Promise(resolve => {
      const transaction = database.transaction(IMAGE_DB_STORE, 'readwrite');
      transaction.objectStore(IMAGE_DB_STORE).delete(normalizedKey);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    });
  }

  function releaseImagePreview(index) {
    const current = imagePreviewUrls.get(index);
    if (current) URL.revokeObjectURL(current);
    imagePreviewUrls.delete(index);
  }

  function releaseAllImagePreviews() {
    [...imagePreviewUrls.keys()].forEach(releaseImagePreview);
  }

  function pidList(value) {
    return String(value || '').match(/\d+/g) || [];
  }

  function questionNumberLabel(node) {
    return clean(node?.textContent).match(/^\s*(\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)\s*[.)]/u)?.[1] || '';
  }

  function expandNumberLabel(label) {
    const match = clean(label).match(/^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/);
    if (!match) return [];
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (!start || end < start || end - start > 30) return [String(start)];
    return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
  }

  function cleanBibleAnchorText(anchor) {
    const clone = anchor.cloneNode(true);
    clone.querySelectorAll('.pageNum,[aria-hidden="true"].pageNum').forEach(node => node.remove());
    return clean(clone.textContent).replace(/[;,.]+$/g, match => match);
  }

  function verseOnlySpec(value) {
    const text = clean(value).replace(/[.;]+$/g, '');
    return /^\d{1,3}[a-z]?(?:\s*(?:,|[-–—])\s*\d{1,3}[a-z]?)*$/i.test(text) ? normalizeVerseSpec(text) : '';
  }

  function locationForNode(node) {
    const paragraph = node?.closest?.('p');
    if (!paragraph) return { type: 'article', label: 'Artigo', paragraph: '' };
    if (paragraph.matches('p[data-rel-pid]')) {
      const number = extractParagraphNumber(paragraph);
      return { type: 'paragraph', label: number ? `Parágrafo ${number}` : 'Parágrafo do estudo', paragraph: number };
    }
    if (paragraph.matches('p.qu')) {
      const number = questionNumberLabel(paragraph);
      return { type: 'question', label: number ? `Pergunta ${number}` : 'Pergunta do estudo', paragraph: '' };
    }
    if (paragraph.closest('.boxSupplement')) return { type: 'principle-box', label: 'Quadro de princípios', paragraph: '' };
    if (paragraph.closest('.blockTeach')) return { type: 'review', label: 'Revisão final', paragraph: '' };
    if (paragraph.closest('.groupFootnote')) return { type: 'footnote', label: 'Nota do artigo', paragraph: '' };
    if (paragraph.classList.contains('themeScrp')) return { type: 'theme', label: 'Texto-tema', paragraph: '' };
    if (paragraph.closest('figcaption')) return { type: 'caption', label: 'Legenda de imagem', paragraph: '' };
    return { type: 'support', label: 'Conteúdo complementar', paragraph: '' };
  }

  function extractScripturesFromBidAnchors(article) {
    const anchors = $$('a[data-bid]', article);
    const groups = new Map();
    anchors.forEach(anchor => {
      const bid = clean(anchor.getAttribute('data-bid'));
      const groupId = bid.split('-')[0] || bid;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(anchor);
    });

    const occurrences = [];
    for (const [groupId, groupAnchors] of groups) {
      let previous = null;
      groupAnchors.forEach(anchor => {
        const bid = clean(anchor.getAttribute('data-bid'));
        const visible = cleanBibleAnchorText(anchor);
        const parsed = extractReferencesFromText(visible);
        if (parsed.length) {
          parsed.forEach(reference => {
            const occurrence = {
              ...reference,
              raw: visible,
              groupId,
              anchorBids: [bid],
              location: locationForNode(anchor)
            };
            occurrences.push(occurrence);
            previous = occurrence;
          });
          return;
        }

        const continuation = verseOnlySpec(visible);
        if (continuation && previous && previous.groupId === groupId) {
          const merged = makeReference(previous.book, previous.chapter, `${previous.verses},${continuation}`, `${previous.raw} ${visible}`);
          if (merged) {
            Object.assign(previous, merged, {
              raw: clean(`${previous.raw} ${visible}`),
              groupId,
              anchorBids: [...previous.anchorBids, bid]
            });
            return;
          }
        }

        const metadata = clean(anchor.getAttribute('data-reference') || anchor.getAttribute('aria-label') || anchor.getAttribute('title'));
        extractReferencesFromText(metadata).forEach(reference => {
          const occurrence = {
            ...reference,
            raw: visible || metadata,
            groupId,
            anchorBids: [bid],
            location: locationForNode(anchor)
          };
          occurrences.push(occurrence);
          previous = occurrence;
        });
      });
    }

    return {
      anchors: anchors.length,
      groups: groups.size,
      occurrences
    };
  }

  function summarizeLocations(occurrences) {
    return [...new Set((occurrences || []).map(item => item.location?.label || (item.paragraph ? `Parágrafo ${item.paragraph}` : '')).filter(Boolean))];
  }

  function parseSource(sourceHtml) {
    if (!clean(sourceHtml)) throw new Error('Cole o HTML completo do artigo antes de processar.');

    const parser = new DOMParser();
    const doc = parser.parseFromString(sourceHtml, 'text/html');
    const articleSource = doc.querySelector('article#article') || doc.querySelector('article') || selectBestArticle(doc);
    if (!articleSource || !clean(articleSource.textContent)) {
      throw new Error('Não encontrei um elemento <article> com conteúdo legível.');
    }

    const article = sanitizeArticle(articleSource);
    const title = clean(article.querySelector('h1')?.textContent)
      || clean(doc.querySelector('title')?.textContent)
      || 'Artigo A Sentinela';

    const subtitles = $$('h2,h3,h4,h5,h6', article)
      .map((heading, index) => ({ order: index + 1, level: heading.tagName.toLowerCase(), text: clean(heading.textContent) }))
      .filter(item => item.text && !/^(?:opções de download|compartilhar|selecione seu idioma)$/i.test(item.text));

    const mainParagraphNodes = $$('p[data-rel-pid]', article)
      .filter(node => extractParagraphNumber(node));
    const paragraphByNumber = new Map();
    const paragraphNodeToNumber = new Map();
    const paragraphs = [];

    mainParagraphNodes.forEach(node => {
      const number = extractParagraphNumber(node);
      const text = paragraphText(node);
      if (!number || !text) return;
      paragraphNodeToNumber.set(node, number);
      let item = paragraphByNumber.get(number);
      if (!item) {
        item = {
          number,
          text: '',
          html: '',
          id: node.id || `paragraph-${number}`,
          fragments: [],
          highlights: [],
          questionPid: pidList(node.getAttribute('data-rel-pid'))[0] || ''
        };
        paragraphByNumber.set(number, item);
        paragraphs.push(item);
      }
      item.fragments.push({ text, html: node.outerHTML, id: node.id || '', explicit: true });
      item.text = clean(`${item.text} ${text}`);
      item.html += `${node.outerHTML}\n`;
    });

    const mainQuestionNodes = $$('p.qu', article).filter(node => !node.closest('.blockTeach,#questionContainer'));
    const questionByPid = new Map();
    const questions = mainQuestionNodes.map((node, index) => {
      const pid = clean(node.getAttribute('data-pid'));
      const label = questionNumberLabel(node);
      const related = mainParagraphNodes.filter(paragraph => pid && pidList(paragraph.getAttribute('data-rel-pid')).includes(pid));
      const paragraphNumbers = related.map(extractParagraphNumber).filter(Boolean);
      const expectedNumbers = expandNumberLabel(label);
      const responseField = node.nextElementSibling?.matches?.('.gen-field') ? node.nextElementSibling : null;
      const item = {
        order: index + 1,
        type: 'study',
        sourceId: node.id || '',
        pid,
        label,
        text: clean(node.textContent),
        paragraph: paragraphNumbers.join(', '),
        paragraphNumbers,
        paragraphIds: related.map(paragraph => paragraph.id || '').filter(Boolean),
        expectedNumbers,
        connected: expectedNumbers.length ? expectedNumbers.every(number => paragraphNumbers.includes(number)) : related.length > 0,
        responseFieldId: responseField?.id || ''
      };
      if (pid) questionByPid.set(pid, item);
      return item;
    });

    paragraphs.forEach(paragraph => {
      const question = questionByPid.get(paragraph.questionPid);
      paragraph.question = question ? { pid: question.pid, label: question.label, text: question.text } : null;
    });

    const reviewQuestions = $$('.blockTeach .boxContent > ul > li', article).map((li, index) => {
      const node = li.querySelector(':scope > p');
      if (!node || !clean(node.textContent)) return null;
      const responseField = li.querySelector(':scope > .gen-field');
      return {
        order: index + 1,
        type: 'review',
        sourceId: node.id || '',
        text: clean(node.textContent),
        responseFieldId: responseField?.id || ''
      };
    }).filter(Boolean);

    const principleQuestions = $$('.boxSupplement .boxContent > ul > li > p', article).map((node, index) => ({
      order: index + 1,
      type: 'principle',
      sourceId: node.id || '',
      text: clean(node.textContent)
    }));

    const bible = extractScripturesFromBidAnchors(article);
    const scriptureMap = new Map();
    bible.occurrences.forEach(occurrence => {
      if (!occurrence.key) return;
      let item = scriptureMap.get(occurrence.key);
      if (!item) {
        item = {
          order: scriptureMap.size + 1,
          reference: occurrence.reference,
          key: occurrence.key,
          text: '',
          comment: '',
          occurrences: []
        };
        scriptureMap.set(occurrence.key, item);
      }
      item.occurrences.push({
        paragraph: occurrence.location?.paragraph || '',
        raw: occurrence.raw,
        groupId: occurrence.groupId,
        anchorBids: occurrence.anchorBids || [],
        location: occurrence.location
      });
    });
    const scriptures = [...scriptureMap.values()];

    const images = $$('img', article).map((image, index) => {
      const candidates = collectImageCandidates(image);
      const absoluteCandidates = uniqueValues(candidates.map(resolveImageUrl));
      return normalizeImageModel({
        order: index + 1,
        sourceId: clean(image.id || image.closest('figure')?.id),
        src: candidates[0] || '',
        candidates,
        absoluteCandidates,
        alt: clean(image.getAttribute('alt')),
        caption: clean(image.closest('figure')?.querySelector('figcaption')?.textContent),
        include: true,
        status: 'pending',
        cacheKey: absoluteCandidates[0] ? imageCacheKey(absoluteCandidates[0], index) : '',
        resolvedUrl: '',
        localPath: '',
        mediaType: '',
        sizeBytes: 0,
        width: Number(image.getAttribute('width')) || 0,
        height: Number(image.getAttribute('height')) || 0,
        error: '',
        sourceKind: 'remote'
      }, index);
    });

    const answerFields = $$('.gen-field', article).length;
    const figures = $$('figure', article).length;
    const footnotes = $$('.groupFootnote .fn-ref', article).length;
    const disconnectedQuestions = questions.filter(item => !item.connected);
    const disconnectedParagraphs = paragraphs.filter(item => !item.question);

    const extractionAudit = {
      readableParagraphElements: $$('p', article).filter(node => clean(node.textContent)).length,
      bodyParagraphElements: mainParagraphNodes.length,
      questionParagraphElements: mainQuestionNodes.length,
      answerPlaceholderElements: answerFields,
      explicitParagraphElements: mainParagraphNodes.length,
      paragraphGroups: paragraphs.length,
      continuationElementsMerged: paragraphs.reduce((total, item) => total + Math.max(0, item.fragments.length - 1), 0),
      supplementalBlocks: 0,
      questionCandidates: mainQuestionNodes.length,
      questionsExtracted: questions.length,
      reviewQuestions: reviewQuestions.length,
      principleQuestions: principleQuestions.length,
      scriptureGroups: bible.groups,
      scriptureAnchors: bible.anchors,
      scriptureOccurrences: bible.occurrences.length,
      scriptureUnique: scriptures.length,
      images: images.length,
      figures,
      footnotes,
      disconnectedQuestions: disconnectedQuestions.length,
      disconnectedParagraphs: disconnectedParagraphs.length
    };

    const output = {
      title,
      processedAt: new Date().toISOString(),
      articleHtml: article.innerHTML,
      subtitles,
      paragraphs,
      paragraphFragmentCount: paragraphs.reduce((total, item) => total + item.fragments.length, 0),
      supplementalBlocks: [],
      questions,
      reviewQuestions,
      principleQuestions,
      scriptures,
      scriptureOccurrenceCount: bible.occurrences.length,
      scriptureGroupCount: bible.groups,
      scriptureAnchorCount: bible.anchors,
      bibleImportStats: null,
      images,
      extractionAudit,
      warnings: []
    };

    if (paragraphs.length !== mainParagraphNodes.length) output.warnings.push('Um ou mais parágrafos numerados foram agrupados por terem o mesmo número.');
    if (disconnectedQuestions.length) output.warnings.push(`${disconnectedQuestions.length} pergunta(s) principal(is) não encontrou(aram) todos os parágrafos indicados.`);
    if (disconnectedParagraphs.length) output.warnings.push(`${disconnectedParagraphs.length} parágrafo(s) numerado(s) não possui(em) pergunta ligada por data-rel-pid.`);
    if (!questions.length) output.warnings.push('Nenhuma pergunta principal com classe “qu” foi identificada.');
    if (!scriptures.length) output.warnings.push('Nenhuma referência bíblica com data-bid foi identificada.');
    if (bible.anchors !== bible.occurrences.length) output.warnings.push(`${bible.anchors} fragmentos de link bíblico formaram ${bible.occurrences.length} ocorrências lógicas; continuações como “Sal. 16:9, 11” foram reunidas.`);

    output.xhtml = buildXhtml(output);
    return output;
  }

  function applyBibleTexts(showMessage = true) {
    const entries = parseBibleBlock(elements.bibleTextInput?.value || '');
    if (!entries.length) {
      if (showMessage) showStatus('Use o formato “(Referência) texto” em cada entrada.', true);
      return;
    }
    if (!result) {
      $('#bibleImportCount').textContent = `${entries.length} entrada(s) reconhecida(s)`;
      if (showMessage) showStatus('Textos reconhecidos. Processe o artigo para fazer a associação.');
      return;
    }

    // Limpa associações automáticas anteriores; comentários editados manualmente são mantidos.
    result.scriptures.forEach(item => { item.text = ''; });
    const detectedByKey = new Map(result.scriptures.map(item => [item.key || referenceKey(item.reference), item]));
    const unmatchedEntries = [];
    const matchedKeys = new Set();
    const duplicateImportedKeys = new Set();
    const importedKeyOwner = new Map();

    entries.forEach(entry => {
      let matchedThisEntry = 0;
      entry.keys.forEach((key, keyIndex) => {
        if (importedKeyOwner.has(key)) duplicateImportedKeys.add(key);
        else importedKeyOwner.set(key, entry.reference);

        const scripture = detectedByKey.get(key);
        if (!scripture) return;
        const referenceLabel = entry.references?.[keyIndex] || scripture.reference;
        if (scripture.text && scripture.text !== entry.text) {
          scripture.text = clean(`${scripture.text}\n${referenceLabel}: ${entry.text}`);
        } else {
          scripture.text = entry.text;
        }
        matchedKeys.add(key);
        matchedThisEntry += 1;
      });
      if (!matchedThisEntry) unmatchedEntries.push(entry);
    });

    const unfilledReferences = result.scriptures
      .filter(item => !clean(item.text))
      .map(item => ({ reference: item.reference, key: item.key, occurrences: item.occurrences || [] }));
    const matchedOccurrences = result.scriptures
      .filter(item => clean(item.text))
      .reduce((total, item) => total + (item.occurrences?.length || 0), 0);
    const matchedGroups = new Set(
      result.scriptures.filter(item => clean(item.text)).flatMap(item => (item.occurrences || []).map(occurrence => occurrence.groupId).filter(Boolean))
    ).size;

    result.bibleImportStats = {
      imported: entries.length,
      importedReferences: entries.reduce((total, entry) => total + entry.keys.length, 0),
      matchedUnique: matchedKeys.size,
      matchedOccurrences,
      matchedGroups,
      unmatchedEntries,
      duplicateImportedKeys: [...duplicateImportedKeys],
      unfilledReferences,
      detectedUnique: result.scriptures.length,
      detectedOccurrences: result.scriptureOccurrenceCount || 0,
      detectedGroups: result.scriptureGroupCount || 0
    };

    result.xhtml = buildXhtml(result);
    const unmatchedLabel = unmatchedEntries.length ? ` • ${unmatchedEntries.length} não localizada(s)` : '';
    $('#bibleImportCount').textContent = `${matchedKeys.size} referência(s) associada(s)${unmatchedLabel}`;
    renderAll();
    queueSave('Textos bíblicos aplicados');
    if (showMessage) {
      const duplicateMessage = duplicateImportedKeys.size ? ` ${duplicateImportedKeys.size} referência(s) apareceu(ram) mais de uma vez no bloco importado.` : '';
      showStatus(
        `${matchedKeys.size} referência(s) única(s) associada(s), cobrindo ${matchedOccurrences} ocorrência(s) lógica(s) em ${matchedGroups}/${result.scriptureGroupCount || matchedGroups} grupo(s) de citação do artigo.${unmatchedEntries.length ? ` ${unmatchedEntries.length} entrada(s) não foram localizadas.` : ''}${duplicateMessage}`,
        unmatchedEntries.length > 0
      );
    }
  }

  const XHTML_NS = 'http://www.w3.org/1999/xhtml';
  const EPUB_NS = 'http://www.idpf.org/2007/ops';

  function assertWellFormedXml(xml, label = 'XML') {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    const parserError = parsed.querySelector('parsererror');
    if (parserError) {
      const detail = clean(parserError.textContent).slice(0, 260);
      throw new Error(`${label} inválido: ${detail}`);
    }
    return parsed;
  }

  function citationTextBlocks(article) {
    const selector = 'p,li,h1,h2,h3,h4,h5,h6,figcaption,blockquote,dt,dd';
    return $$(selector, article).filter(node => {
      if (!clean(node.textContent)) return false;
      return !node.querySelector(selector);
    });
  }

  function collectTextSegments(root) {
    const segments = [];
    let offset = 0;
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('aside,script,style,textarea,pre,code')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const start = offset;
      offset += node.nodeValue.length;
      segments.push({ node, start, end: offset });
    }
    return { segments, text: segments.map(item => item.node.nodeValue).join('') };
  }

  function positionForOffset(segments, offset, preferEnd = false) {
    if (!segments.length) return null;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (offset < segment.end || (preferEnd && offset === segment.end)) {
        return { node: segment.node, offset: Math.max(0, Math.min(segment.node.nodeValue.length, offset - segment.start)) };
      }
    }
    const last = segments[segments.length - 1];
    return { node: last.node, offset: last.node.nodeValue.length };
  }

  const XHTML_INLINE_ELEMENTS = new Set([
    'a','abbr','b','bdi','bdo','br','cite','code','em','i','img','kbd','mark','q','ruby','s','samp','small','span','strong','sub','sup','time','u','var','wbr','title','meta','link'
  ]);
  const XHTML_PRESERVE_ELEMENTS = new Set(['pre','code','textarea','script','style']);

  function escapeXmlText(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeXmlAttribute(value) {
    return escapeXmlText(value).replace(/"/g, '&quot;');
  }

  function serializeXmlAttributes(element) {
    return Array.from(element.attributes || [])
      .map(attribute => ` ${attribute.name}="${escapeXmlAttribute(attribute.value)}"`)
      .join('');
  }

  function meaningfulXmlChildren(node) {
    return Array.from(node.childNodes || []).filter(child => child.nodeType !== Node.TEXT_NODE || /\S/.test(child.nodeValue || ''));
  }

  function serializeXmlCompact(node) {
    if (node.nodeType === Node.TEXT_NODE) return escapeXmlText(node.nodeValue || '');
    if (node.nodeType === Node.CDATA_SECTION_NODE) return `<![CDATA[${node.nodeValue || ''}]]>`;
    if (node.nodeType === Node.COMMENT_NODE) return `<!--${node.nodeValue || ''}-->`;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tagName = node.tagName;
    const attributes = serializeXmlAttributes(node);
    const children = Array.from(node.childNodes || []);
    if (!children.length) return `<${tagName}${attributes}/>`;
    return `<${tagName}${attributes}>${children.map(serializeXmlCompact).join('')}</${tagName}>`;
  }

  function shouldKeepXmlCompact(element) {
    const tagName = element.localName?.toLowerCase() || element.tagName.toLowerCase();
    if (XHTML_PRESERVE_ELEMENTS.has(tagName) || XHTML_INLINE_ELEMENTS.has(tagName)) return true;
    const children = meaningfulXmlChildren(element);
    if (!children.length) return true;
    if (children.some(child => child.nodeType === Node.TEXT_NODE && /\S/.test(child.nodeValue || ''))) return true;
    const elementChildren = children.filter(child => child.nodeType === Node.ELEMENT_NODE);
    return elementChildren.length > 0 && elementChildren.every(child => XHTML_INLINE_ELEMENTS.has(child.localName?.toLowerCase() || child.tagName.toLowerCase()));
  }

  function formatXmlNode(node, depth = 0) {
    const indent = '  '.repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      return /\S/.test(node.nodeValue || '') ? `${indent}${escapeXmlText(node.nodeValue || '')}` : '';
    }
    if (node.nodeType === Node.COMMENT_NODE) return `${indent}<!--${node.nodeValue || ''}-->`;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (shouldKeepXmlCompact(node)) return `${indent}${serializeXmlCompact(node)}`;

    const tagName = node.tagName;
    const attributes = serializeXmlAttributes(node);
    const children = meaningfulXmlChildren(node);
    if (!children.length) return `${indent}<${tagName}${attributes}/>`;
    const formattedChildren = children.map(child => formatXmlNode(child, depth + 1)).filter(Boolean);
    return `${indent}<${tagName}${attributes}>\n${formattedChildren.join('\n')}\n${indent}</${tagName}>`;
  }

  function formatXhtmlForCopy(xhtml) {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(xhtml, 'application/xhtml+xml');
    const parseError = parsed.querySelector('parsererror');
    if (parseError) throw new Error(`Não foi possível embelezar o XHTML: ${clean(parseError.textContent)}`);
    const formatted = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n${formatXmlNode(parsed.documentElement)}\n`;
    assertWellFormedXml(formatted, 'XHTML formatado');
    return formatted;
  }

  async function copyTextSafely(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {}
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.inset = '0 auto auto -9999px';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);
    const copied = document.execCommand?.('copy');
    helper.remove();
    if (!copied) throw new Error('O navegador bloqueou o acesso à área de transferência.');
  }

  async function formatAndCopyCurrentXhtml(button = null) {
    if (!result) return showStatus('Processe um artigo primeiro.', true);
    const originalLabel = button?.textContent;
    try {
      if (button) {
        button.disabled = true;
        button.textContent = 'Arrumando código…';
      }
      if ((result.images || []).some(image => image.include !== false && image.status !== 'ready')) {
        if (button) button.textContent = 'Preparando imagens…';
        await resolveAllImages({ showMessage: false });
      }
      const freshXhtml = buildXhtml(result);
      const formattedXhtml = formatXhtmlForCopy(freshXhtml);
      result.xhtml = formattedXhtml;
      const codeElement = $('#xhtmlCode');
      if (codeElement) codeElement.textContent = formattedXhtml;
      const lineCount = formattedXhtml.trimEnd().split('\n').length;
      const meta = $('#xhtmlCopyMeta');
      const imageState = imageAudit();
      if (meta) meta.textContent = `${lineCount.toLocaleString('pt-BR')} linhas · XHTML validado · ${imageState.ready}/${imageState.included} imagem(ns) incorporada(s) · estilos incluídos`;
      await copyTextSafely(formattedXhtml);
      const imageWarning = imageState.errors ? ` ${imageState.errors} imagem(ns) permaneceu(ram) externa(s); use a aba Imagens para selecionar os arquivos manualmente.` : '';
      showStatus(`XHTML arrumado e copiado por completo (${lineCount.toLocaleString('pt-BR')} linhas).${imageWarning}`, imageState.errors > 0);
      if (button) button.textContent = 'Copiado ✓';
    } catch (error) {
      showStatus(error?.message || 'Não foi possível organizar e copiar o XHTML.', true);
      if (button) button.textContent = 'Tentar novamente';
    } finally {
      if (button) {
        window.setTimeout(() => {
          button.disabled = false;
          button.textContent = originalLabel || 'Arrumar e copiar XHTML';
        }, 1400);
      }
    }
  }

  function applyImageModelsToArticle(article, imageModels) {
    const nodes = Array.from(article.querySelectorAll('img'));
    nodes.forEach((image, index) => {
      const model = normalizeImageModel(imageModels[index] || {}, index);
      image.removeAttribute('srcset');
      image.removeAttribute('loading');
      image.removeAttribute('decoding');
      image.removeAttribute('crossorigin');
      image.removeAttribute('referrerpolicy');
      image.removeAttribute('data-src');
      image.removeAttribute('data-original');
      image.removeAttribute('data-lazy-src');
      image.removeAttribute('data-img-src');
      image.removeAttribute('data-img-small-src');
      if (!model.include) {
        image.remove();
        return;
      }
      const source = model.status === 'ready' && model.localPath
        ? model.localPath
        : (model.resolvedUrl || model.absoluteCandidates[0] || resolveImageUrl(model.src));
      if (source) image.setAttribute('src', source);
      if (!image.hasAttribute('alt')) image.setAttribute('alt', model.alt || '');
    });
  }

  function buildXhtml(data) {
    const filename = getFileName('xhtml');
    const citationStart = Math.max(1, Number.parseInt($('#citationStart')?.value || '1', 10));
    let citationIndex = citationStart;
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<article>${data.articleHtml}</article>`, 'text/html');
    const article = doc.querySelector('article');
    if (!article) throw new Error('Não foi possível montar o elemento principal do XHTML.');

    article.setAttribute('data-source-file', filename);
    article.querySelectorAll('.pswp,#questionContainer,#galleryModalContainer,.galleryModalContainer,.underlay.full').forEach(node => node.remove());
    article.querySelectorAll('.gen-field,.pageNum').forEach(node => node.remove());
    applyHighlightsToArticle(article, data.paragraphs || []);
    applyImageModelsToArticle(article, data.images || []);

    // Converte as notas editoriais do artigo em links internos válidos no EPUB.
    article.querySelectorAll('a.fn[data-fnid]').forEach(anchor => {
      const fnid = clean(anchor.getAttribute('data-fnid'));
      const target = article.querySelector(`#footnote${CSS.escape(fnid)}`) || article.querySelector(`.fn-ref[data-fnid="${CSS.escape(fnid)}"]`);
      if (target) {
        anchor.setAttribute('href', `#${target.id}`);
        anchor.setAttributeNS(EPUB_NS, 'epub:type', 'noteref');
      }
    });
    article.querySelectorAll('.fn-ref[data-fnid]').forEach(note => note.setAttributeNS(EPUB_NS, 'epub:type', 'footnote'));

    const usedIds = new Set($$('[id]', article).map(node => clean(node.id)).filter(Boolean));
    const notesSection = doc.createElement('section');
    notesSection.className = 'bible-notes';
    notesSection.setAttribute('aria-label', 'Textos bíblicos');

    const bidToItem = new Map();
    (data.scriptures || []).forEach(item => {
      (item.occurrences || []).forEach(occurrence => {
        (occurrence.anchorBids || []).forEach(bid => bidToItem.set(bid, item));
      });
    });

    const noteIdByKey = new Map();
    (data.scriptures || []).forEach(item => {
      if (!clean(item.text) && !clean(item.comment)) return;
      let id;
      do { id = `citation${citationIndex++}`; } while (usedIds.has(id));
      usedIds.add(id);
      noteIdByKey.set(item.key || referenceKey(item.reference), id);

      const aside = doc.createElement('aside');
      aside.id = id;
      aside.setAttributeNS(EPUB_NS, 'epub:type', 'footnote');
      aside.className = 'citation';
      const verseParagraph = doc.createElement('p');
      const strong = doc.createElement('strong');
      strong.textContent = item.reference;
      verseParagraph.append(strong, doc.createTextNode(` ${item.text || 'Texto bíblico não informado.'}`));
      aside.appendChild(verseParagraph);
      if (clean(item.comment)) {
        const comment = doc.createElement('p');
        comment.className = 'comentarioTextoBiblico';
        comment.textContent = item.comment;
        aside.appendChild(comment);
      }
      notesSection.appendChild(aside);
    });

    article.querySelectorAll('a[data-bid]').forEach(anchor => {
      const bid = clean(anchor.getAttribute('data-bid'));
      const item = bidToItem.get(bid);
      const noteId = item ? noteIdByKey.get(item.key || referenceKey(item.reference)) : '';
      if (noteId) {
        anchor.setAttribute('href', `#${noteId}`);
        anchor.setAttributeNS(EPUB_NS, 'epub:type', 'noteref');
        anchor.classList.add('citationsource');
      } else {
        anchor.removeAttribute('href');
        anchor.removeAttributeNS(EPUB_NS, 'type');
        anchor.removeAttribute('epub:type');
      }
    });

    if (notesSection.childElementCount) article.appendChild(notesSection);

    const serializedArticle = new XMLSerializer().serializeToString(article);
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML_NS}" xmlns:epub="${EPUB_NS}" lang="pt-BR" xml:lang="pt-BR">\n<head>\n  <meta charset="utf-8" />\n  <title>${esc(data.title)}</title>\n  <link href="css_rafael.css" type="text/css" rel="stylesheet" />\n  <link href="default.css" type="text/css" rel="stylesheet" />\n  <style type="text/css">mark.marca-amarela{background:#fff59d;color:inherit}mark.marca-azul{background:#b3e5fc;color:inherit}mark.marca-laranja{background:#ffcc80;color:inherit}mark.marca-amarela,mark.marca-azul,mark.marca-laranja{padding:0 .05em;border-radius:.12em;-webkit-box-decoration-break:clone;box-decoration-break:clone}</style>\n</head>\n<body>\n${serializedArticle}\n</body>\n</html>`;
    assertWellFormedXml(xhtml, 'XHTML do artigo');
    return xhtml;
  }

  function getFileName(extension) {
    let name = clean($('#fileName')?.value) || `artigo-a-sentinela.${extension}`;
    name = name.replace(/[\\/:*?"<>|]+/g, '-');
    if (!name.toLowerCase().endsWith(`.${extension}`)) {
      name = name.replace(/\.[a-z0-9]+$/i, '') + `.${extension}`;
    }
    return name;
  }

  function download(name, content, type = 'application/octet-stream') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }


  function safeEpubFileName(extension = 'xhtml') {
    const raw = getFileName(extension).replace(new RegExp(`\\.${extension}$`, 'i'), '');
    return `${slug(raw, 'artigo')}.${extension}`;
  }

  function createUuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  function normalizeEpubFolder(value) {
    const normalized = slug(String(value || '').replace(/[\\/]+/g, '-'), 'images');
    return normalized || 'images';
  }

  function mediaTypeFromBlob(blob, source = '') {
    const declared = clean(blob?.type).toLowerCase().split(';')[0];
    if (/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(declared)) return declared;
    const extension = String(source).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' })[extension] || '';
  }

  async function sniffImageMediaType(blob, source = '') {
    const known = mediaTypeFromBlob(blob, source);
    if (known) return known;
    const bytes = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    const starts = signature => signature.every((value, index) => bytes[index] === value);
    if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
    if (starts([0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trimStart().toLowerCase();
    if (text.startsWith('<svg') || text.startsWith('<?xml') && text.includes('<svg')) return 'image/svg+xml';
    return '';
  }

  function extensionForMediaType(mediaType) {
    return ({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg'
    })[mediaType] || 'bin';
  }

  function isLocalAppServer() {
    return /^https?:$/.test(location.protocol) && /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
  }

  function fetchWithTimeout(url, options = {}, timeoutMs = IMAGE_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  async function localImageProxyAvailable() {
    if (!isLocalAppServer()) return false;
    try {
      const response = await fetchWithTimeout(LOCAL_HEALTH_PATH, { cache: 'no-store' }, 3000);
      return response.ok;
    } catch {
      return false;
    }
  }

  async function fetchThroughLocalProxy(resolved) {
    if (!isLocalAppServer()) {
      throw new Error('O servidor local de imagens não está ativo. Feche esta página e abra o sistema pelo arquivo INICIAR-SISTEMA.cmd.');
    }
    const proxyUrl = `${LOCAL_IMAGE_PROXY_PATH}?url=${encodeURIComponent(resolved)}`;
    let response;
    try {
      response = await fetchWithTimeout(proxyUrl, {
        credentials: 'same-origin',
        redirect: 'follow',
        cache: 'no-store'
      });
    } catch (error) {
      const detail = error?.name === 'AbortError' ? 'tempo limite excedido' : (error?.message || 'falha de rede');
      throw new Error(`O servidor local não conseguiu buscar a imagem (${detail}).`);
    }
    if (!response.ok) {
      let detail = '';
      try { detail = clean(await response.text()); } catch { /* sem corpo */ }
      throw new Error(detail || `O servidor local respondeu HTTP ${response.status}.`);
    }
    const blob = await response.blob();
    const finalUrl = response.headers.get('X-Image-Final-Url') || resolved;
    const mediaType = await sniffImageMediaType(blob, finalUrl);
    if (!mediaType) throw new Error('O servidor local recebeu um arquivo que não foi reconhecido como imagem.');
    return {
      blob: blob.type ? blob : blob.slice(0, blob.size, mediaType),
      mediaType,
      resolvedUrl: finalUrl,
      transport: 'local-proxy'
    };
  }

  async function fetchImageResource(source) {
    const resolved = resolveImageUrl(source);
    if (!resolved) throw new Error('Endereço da imagem ausente.');

    if (/^data:|^blob:/i.test(resolved)) {
      const response = await fetchWithTimeout(resolved, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Não foi possível ler a imagem local (HTTP ${response.status}).`);
      const blob = await response.blob();
      const mediaType = await sniffImageMediaType(blob, resolved);
      if (!mediaType) throw new Error('O conteúdo local não é uma imagem reconhecida.');
      return { blob: blob.type ? blob : blob.slice(0, blob.size, mediaType), mediaType, resolvedUrl: resolved, transport: 'local' };
    }

    let directError = null;
    try {
      const response = await fetchWithTimeout(resolved, {
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
        cache: 'force-cache',
        referrerPolicy: 'no-referrer'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const mediaType = await sniffImageMediaType(blob, response.url || resolved);
      if (!mediaType) throw new Error('o endereço não retornou uma imagem reconhecida');
      return {
        blob: blob.type ? blob : blob.slice(0, blob.size, mediaType),
        mediaType,
        resolvedUrl: response.url || resolved,
        transport: 'direct'
      };
    } catch (error) {
      directError = error;
    }

    try {
      return await fetchThroughLocalProxy(resolved);
    } catch (proxyError) {
      const directDetail = directError?.name === 'AbortError'
        ? 'tempo limite no download direto'
        : (directError?.message || 'bloqueio CORS');
      throw new Error(`Download direto bloqueado (${directDetail}). ${proxyError?.message || 'O servidor local também falhou.'}`);
    }
  }

  async function fetchImageBlob(source) {
    return (await fetchImageResource(source)).blob;
  }

  function imageElementFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Não foi possível decodificar a imagem.'));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, mediaType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('O navegador não conseguiu converter a imagem.')), mediaType, quality);
    });
  }

  async function optimizeRasterImage(blob, quality, maxDimension) {
    const image = await imageElementFromBlob(blob);
    const originalWidth = image.naturalWidth || image.width || 0;
    const originalHeight = image.naturalHeight || image.height || 0;
    if (!originalWidth || !originalHeight) throw new Error('A imagem não possui dimensões válidas.');
    const largest = Math.max(originalWidth, originalHeight);
    const limit = Math.max(800, Math.min(4000, Number(maxDimension) || DEFAULT_MAX_IMAGE_DIMENSION));
    const scale = largest > limit ? limit / largest : 1;
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('O navegador não disponibilizou o conversor de imagens.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    const optimized = await canvasToBlob(canvas, 'image/webp', quality);
    return {
      blob: optimized,
      mediaType: 'image/webp',
      width,
      height,
      originalWidth,
      originalHeight,
      wasResized: scale < 1
    };
  }

  async function imageDimensionsFromBlob(blob) {
    try {
      const image = await imageElementFromBlob(blob);
      return { width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 };
    } catch {
      return { width: 0, height: 0 };
    }
  }

  async function prepareImageBlob(blob, source, quality) {
    const originalMediaType = await sniffImageMediaType(blob, source);
    if (!originalMediaType) throw new Error('O arquivo selecionado não é uma imagem compatível.');
    const originalSizeBytes = blob.size || 0;
    const maxDimension = Number.parseInt($('#imageMaxDimension')?.value || DEFAULT_MAX_IMAGE_DIMENSION, 10) || DEFAULT_MAX_IMAGE_DIMENSION;
    let finalBlob = blob.type ? blob : blob.slice(0, blob.size, originalMediaType);
    let mediaType = originalMediaType;
    let dimensions = await imageDimensionsFromBlob(finalBlob);
    let originalWidth = dimensions.width;
    let originalHeight = dimensions.height;
    let wasResized = false;

    if (originalMediaType !== 'image/gif') {
      try {
        const optimized = await optimizeRasterImage(finalBlob, quality, maxDimension);
        finalBlob = optimized.blob;
        mediaType = optimized.mediaType;
        dimensions = { width: optimized.width, height: optimized.height };
        originalWidth = optimized.originalWidth;
        originalHeight = optimized.originalHeight;
        wasResized = optimized.wasResized;
      } catch (error) {
        if (originalMediaType === 'image/svg+xml') throw new Error('O SVG não pôde ser rasterizado com segurança.');
        // Em navegadores limitados, preserva o arquivo original em vez de interromper o projeto.
      }
    }

    return {
      blob: finalBlob,
      mediaType,
      ...dimensions,
      originalWidth,
      originalHeight,
      originalSizeBytes,
      optimizedSizeBytes: finalBlob.size || 0,
      savedBytes: Math.max(0, originalSizeBytes - (finalBlob.size || 0)),
      wasResized
    };
  }

  function imageLocalPath(index, mediaType) {
    const folder = normalizeEpubFolder($('#imageFolder')?.value || 'images');
    return `${folder}/image-${String(index + 1).padStart(3, '0')}.${extensionForMediaType(mediaType)}`;
  }

  async function cachedAssetForModel(model, index) {
    const normalized = normalizeImageModel(model, index);
    const record = await imageCacheGet(normalized.cacheKey);
    if (!record?.blob) return null;
    normalized.status = 'ready';
    normalized.localPath = normalized.localPath || imageLocalPath(index, record.mediaType || normalized.mediaType || 'image/webp');
    normalized.mediaType = record.mediaType || normalized.mediaType;
    normalized.sizeBytes = record.blob.size;
    normalized.originalSizeBytes = record.originalSizeBytes || normalized.originalSizeBytes || record.blob.size;
    normalized.savedBytes = Math.max(0, normalized.originalSizeBytes - normalized.sizeBytes);
    normalized.originalWidth = record.originalWidth || normalized.originalWidth || record.width || 0;
    normalized.originalHeight = record.originalHeight || normalized.originalHeight || record.height || 0;
    normalized.width = record.width || normalized.width || 0;
    normalized.height = record.height || normalized.height || 0;
    normalized.wasResized = Boolean(record.wasResized || normalized.wasResized);
    normalized.resolvedUrl = record.resolvedUrl || normalized.resolvedUrl;
    normalized.error = '';
    return { ...record, model: normalized };
  }

  async function resolveImageAsset(model, index, options = {}) {
    const normalized = normalizeImageModel(model, index);
    if (!normalized.include) {
      normalized.status = 'excluded';
      return null;
    }
    if (!options.force) {
      const cached = await cachedAssetForModel(normalized, index);
      if (cached) return cached;
    }

    const candidates = uniqueValues(normalized.absoluteCandidates.length
      ? normalized.absoluteCandidates
      : normalized.candidates.map(resolveImageUrl));
    if (options.preferSmall && candidates.length > 1) candidates.unshift(candidates.splice(1, 1)[0]);
    if (!candidates.length) {
      normalized.status = 'error';
      normalized.error = 'Nenhum endereço de imagem foi encontrado.';
      throw new Error(normalized.error);
    }

    normalized.status = 'downloading';
    normalized.error = '';
    const quality = Math.min(1, Math.max(0.1, Number.parseFloat($('#imageQuality')?.value || '0.85') || 0.85));
    const failures = [];
    for (const candidate of candidates) {
      try {
        const remote = await fetchImageResource(candidate);
        const prepared = await prepareImageBlob(remote.blob, remote.resolvedUrl || candidate, quality);
        const key = imageCacheKey(remote.resolvedUrl || candidate, index);
        const localPath = imageLocalPath(index, prepared.mediaType);
        const record = {
          key,
          blob: prepared.blob,
          mediaType: prepared.mediaType,
          resolvedUrl: remote.resolvedUrl || candidate,
          originalUrl: candidate,
          localPath,
          width: prepared.width,
          height: prepared.height,
          originalWidth: prepared.originalWidth,
          originalHeight: prepared.originalHeight,
          originalSizeBytes: prepared.originalSizeBytes,
          savedBytes: prepared.savedBytes,
          wasResized: prepared.wasResized,
          sourceKind: remote.transport === 'local-proxy' ? 'proxy' : 'remote'
        };
        await imageCachePut(record);
        normalized.cacheKey = key;
        normalized.status = 'ready';
        normalized.resolvedUrl = record.resolvedUrl;
        normalized.localPath = localPath;
        normalized.mediaType = prepared.mediaType;
        normalized.sizeBytes = prepared.blob.size;
        normalized.originalSizeBytes = prepared.originalSizeBytes;
        normalized.savedBytes = prepared.savedBytes;
        normalized.originalWidth = prepared.originalWidth;
        normalized.originalHeight = prepared.originalHeight;
        normalized.width = prepared.width;
        normalized.height = prepared.height;
        normalized.wasResized = prepared.wasResized;
        normalized.sourceKind = remote.transport === 'local-proxy' ? 'proxy' : 'remote';
        normalized.error = '';
        return { ...record, model: normalized };
      } catch (error) {
        failures.push(`${candidate}: ${error?.message || 'falha'}`);
      }
    }
    normalized.status = 'error';
    normalized.error = failures.join(' | ').slice(0, 900) || 'Não foi possível baixar a imagem.';
    throw new Error(normalized.error);
  }

  async function attachManualImage(file, model, index) {
    if (!(file instanceof Blob)) throw new Error('Selecione um arquivo de imagem.');
    const normalized = normalizeImageModel(model, index);
    const quality = Math.min(1, Math.max(0.1, Number.parseFloat($('#imageQuality')?.value || '0.85') || 0.85));
    const prepared = await prepareImageBlob(file, file.name || `imagem-${index + 1}`, quality);
    const key = `manual:${Date.now().toString(36)}:${simpleHash(`${file.name || ''}:${file.size}:${index}`)}`;
    const localPath = imageLocalPath(index, prepared.mediaType);
    const record = {
      key,
      blob: prepared.blob,
      mediaType: prepared.mediaType,
      resolvedUrl: '',
      originalUrl: file.name || '',
      localPath,
      width: prepared.width,
      height: prepared.height,
      originalWidth: prepared.originalWidth,
      originalHeight: prepared.originalHeight,
      originalSizeBytes: prepared.originalSizeBytes,
      savedBytes: prepared.savedBytes,
      wasResized: prepared.wasResized,
      sourceKind: 'manual'
    };
    await imageCachePut(record);
    normalized.cacheKey = key;
    normalized.status = 'ready';
    normalized.localPath = localPath;
    normalized.mediaType = prepared.mediaType;
    normalized.sizeBytes = prepared.blob.size;
    normalized.originalSizeBytes = prepared.originalSizeBytes;
    normalized.savedBytes = prepared.savedBytes;
    normalized.originalWidth = prepared.originalWidth;
    normalized.originalHeight = prepared.originalHeight;
    normalized.width = prepared.width;
    normalized.height = prepared.height;
    normalized.wasResized = prepared.wasResized;
    normalized.sourceKind = 'manual';
    normalized.error = '';
    return { ...record, model: normalized };
  }

  function imageAudit() {
    const images = (result?.images || []).map(normalizeImageModel);
    const included = images.filter(image => image.include);
    const originalBytes = included.reduce((sum, image) => sum + (image.originalSizeBytes || image.sizeBytes || 0), 0);
    const optimizedBytes = included.reduce((sum, image) => sum + (image.sizeBytes || 0), 0);
    return {
      total: images.length,
      included: included.length,
      ready: included.filter(image => image.status === 'ready').length,
      pending: included.filter(image => image.status === 'pending' || image.status === 'downloading').length,
      errors: included.filter(image => image.status === 'error').length,
      excluded: images.filter(image => !image.include).length,
      originalBytes,
      optimizedBytes,
      savedBytes: Math.max(0, originalBytes - optimizedBytes)
    };
  }

  function refreshXhtmlAfterImages(label = 'Imagens atualizadas') {
    if (!result) return;
    result.xhtml = buildXhtml(result);
    const code = $('#xhtmlCode');
    if (code) code.textContent = result.xhtml;
    renderOverview();
    renderValidation();
    renderPreview();
    queueSave(label);
  }

  async function reconcileImageCacheState({ render = true } = {}) {
    if (!result?.images?.length) return;
    let changed = false;
    for (let index = 0; index < result.images.length; index += 1) {
      const model = normalizeImageModel(result.images[index], index);
      if (!model.include) continue;
      const previousStatus = model.status;
      const previousPath = model.localPath;
      const cached = await cachedAssetForModel(model, index);
      if (cached && (previousStatus !== 'ready' || previousPath !== model.localPath)) changed = true;
      if (!cached && previousStatus === 'ready') {
        model.status = 'pending';
        model.localPath = '';
        model.mediaType = '';
        model.sizeBytes = 0;
        changed = true;
      }
    }
    if (changed) refreshXhtmlAfterImages('Cache de imagens reconciliado');
    if (render) renderImages();
  }

  async function runConcurrentPool(items, worker, concurrency = IMAGE_DOWNLOAD_CONCURRENCY) {
    const queue = items.slice();
    const runners = Array.from({ length: Math.min(Math.max(1, concurrency), queue.length || 1) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item) await worker(item);
      }
    });
    await Promise.all(runners);
  }

  async function resolveAllImages({ showMessage = true, force = false } = {}) {
    if (!result?.images?.length) {
      if (showMessage) showStatus('Nenhuma imagem foi encontrada no artigo.', true);
      return imageAudit();
    }
    if (imageManagerBusy) return imageAudit();
    imageManagerBusy = true;
    let completed = 0;
    let failed = 0;
    const tasks = result.images
      .map((image, index) => ({ model: normalizeImageModel(image, index), index }))
      .filter(task => task.model.include);
    try {
      await runConcurrentPool(tasks, async ({ model, index }) => {
        try {
          await resolveImageAsset(model, index, { force });
          completed += 1;
        } catch {
          failed += 1;
        }
        renderImages();
        showStatus(`Processando imagens: ${completed + failed}/${tasks.length} — até ${IMAGE_DOWNLOAD_CONCURRENCY} simultâneas…`, failed > 0);
      }, IMAGE_DOWNLOAD_CONCURRENCY);
      refreshXhtmlAfterImages('Imagens resolvidas');
      const audit = imageAudit();
      if (showMessage) showStatus(`${audit.ready}/${audit.included} imagem(ns) incorporada(s). Economia: ${formatBytes(audit.savedBytes)}.${audit.errors ? ` ${audit.errors} precisa(m) de seleção manual.` : ''}`, audit.errors > 0);
      return audit;
    } finally {
      imageManagerBusy = false;
      renderImages();
    }
  }

  function replaceMissingImage(image, source) {
    const owner = image.ownerDocument;
    const note = owner.createElementNS(XHTML_NS, 'span');
    note.setAttribute('class', 'missing-image');
    const description = clean(image.getAttribute('alt')) || clean(source) || 'imagem externa';
    note.textContent = `[Imagem não incorporada: ${description}]`;
    image.replaceWith(note);
  }

  function normalizeXhtmlIds(xmlDoc) {
    const used = new Set();
    const firstIdMap = new Map();
    Array.from(xmlDoc.querySelectorAll('[id]')).forEach((node, index) => {
      const original = clean(node.getAttribute('id'));
      if (!original) {
        node.removeAttribute('id');
        return;
      }
      let base = original
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_.:-]+/g, '-')
        .replace(/^-+|-+$/g, '') || `id-${index + 1}`;
      if (!/^[A-Za-z_]/.test(base)) base = `id-${base}`;
      let unique = base;
      let suffix = 2;
      while (used.has(unique)) unique = `${base}-${suffix++}`;
      used.add(unique);
      if (!firstIdMap.has(original)) firstIdMap.set(original, unique);
      node.setAttribute('id', unique);
    });

    const finalIds = new Set(Array.from(xmlDoc.querySelectorAll('[id]')).map(node => node.getAttribute('id')));
    Array.from(xmlDoc.querySelectorAll('a[href^="#"]')).forEach(anchor => {
      const rawFragment = anchor.getAttribute('href').slice(1);
      let fragment = rawFragment;
      try { fragment = decodeURIComponent(rawFragment); } catch { /* mantém o valor original */ }
      const mapped = firstIdMap.get(fragment) || fragment;
      if (finalIds.has(mapped)) {
        anchor.setAttribute('href', `#${mapped}`);
      } else {
        anchor.removeAttribute('href');
        anchor.removeAttributeNS(EPUB_NS, 'type');
        anchor.removeAttribute('epub:type');
      }
    });
  }

  function unwrapElement(node) {
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    node.remove();
  }

  function sanitizeEpubDocument(xmlDoc) {
    const forbidden = 'script,style,iframe,object,embed,form,input,button,textarea,select,option,audio,video,canvas,template';
    xmlDoc.querySelectorAll(forbidden).forEach(node => node.remove());
    xmlDoc.querySelectorAll('noscript').forEach(unwrapElement);

    const htmlAllowed = new Set([
      'html','head','meta','title','link','body','article','section','nav','aside','header','footer','main','address',
      'h1','h2','h3','h4','h5','h6','p','div','span','br','hr','a','em','strong','b','i','u','s','small','sub','sup',
      'mark','q','cite','abbr','time','code','pre','kbd','samp','var','blockquote','ul','ol','li','dl','dt','dd',
      'figure','figcaption','img','picture','source','table','caption','thead','tbody','tfoot','tr','th','td','colgroup','col',
      'ruby','rt','rp','bdi','bdo','wbr','svg','math'
    ]);

    Array.from(xmlDoc.querySelectorAll('*')).forEach(node => {
      const name = node.localName?.toLowerCase() || '';
      const namespace = node.namespaceURI || XHTML_NS;
      if (namespace === XHTML_NS && !htmlAllowed.has(name)) {
        unwrapElement(node);
        return;
      }

      Array.from(node.attributes || []).forEach(attribute => {
        const attrName = attribute.name.toLowerCase();
        const value = attribute.value || '';
        if (attrName.startsWith('on') || ['style','contenteditable','draggable','spellcheck','tabindex','target','download','srcdoc'].includes(attrName)) {
          node.removeAttribute(attribute.name);
          return;
        }
        if (/^[\u0000-\u001f\u007f]/.test(value)) node.setAttribute(attribute.name, value.replace(/[\u0000-\u001f\u007f]/g, ''));
      });
    });

    xmlDoc.querySelectorAll('picture').forEach(picture => {
      const image = picture.querySelector('img');
      if (image) picture.replaceWith(image);
      else unwrapElement(picture);
    });

    xmlDoc.querySelectorAll('a').forEach(anchor => {
      const href = clean(anchor.getAttribute('href'));
      if (!href) {
        if (!anchor.hasAttributeNS(EPUB_NS, 'type') && !anchor.hasAttribute('epub:type')) unwrapElement(anchor);
        return;
      }
      if (href.startsWith('#') || /^(?:https?:|mailto:|tel:)/i.test(href)) return;
      // Links relativos copiados do site apontariam para arquivos inexistentes dentro do EPUB.
      anchor.removeAttribute('href');
      anchor.removeAttributeNS(EPUB_NS, 'type');
      anchor.removeAttribute('epub:type');
      unwrapElement(anchor);
    });

    xmlDoc.querySelectorAll('img').forEach(image => {
      if (!image.hasAttribute('alt')) image.setAttribute('alt', '');
    });

    xmlDoc.documentElement?.removeAttribute('data-source-file');
    xmlDoc.querySelectorAll('[data-source-file]').forEach(node => node.removeAttribute('data-source-file'));
  }

  function resolvePackagePath(basePath, reference) {
    const ref = clean(reference).split('#')[0].split('?')[0];
    if (!ref) return '';
    const baseParts = String(basePath).split('/');
    baseParts.pop();
    const parts = [...baseParts, ...ref.split('/')];
    const normalized = [];
    parts.forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') normalized.pop();
      else normalized.push(part);
    });
    return normalized.join('/');
  }


  async function prepareEpubContentAndImages(xhtml) {
    const xmlDoc = assertWellFormedXml(xhtml, 'XHTML antes da inclusão de imagens');
    sanitizeEpubDocument(xmlDoc);
    normalizeXhtmlIds(xmlDoc);
    const imageFolder = normalizeEpubFolder($('#imageFolder')?.value || 'images');
    const imageAssets = [];
    const omittedImages = [];
    const images = Array.from(xmlDoc.querySelectorAll('img'));

    xmlDoc.querySelectorAll('picture source').forEach(source => source.remove());

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const model = normalizeImageModel(result?.images?.[index] || { src: detectImageSource(image) }, index);
      image.removeAttribute('srcset');
      image.removeAttribute('loading');
      image.removeAttribute('decoding');
      image.removeAttribute('crossorigin');
      image.removeAttribute('referrerpolicy');
      image.removeAttribute('data-src');
      image.removeAttribute('data-original');
      image.removeAttribute('data-lazy-src');
      image.removeAttribute('data-img-src');
      image.removeAttribute('data-img-small-src');

      if (!model.include) {
        image.remove();
        continue;
      }

      try {
        let asset = await cachedAssetForModel(model, index);
        if (!asset) asset = await resolveImageAsset(model, index);
        if (!asset?.blob) throw new Error('Os dados da imagem não estão disponíveis no cache.');
        const path = model.localPath || `${imageFolder}/image-${String(index + 1).padStart(3, '0')}.${extensionForMediaType(asset.mediaType)}`;
        model.localPath = path;
        image.setAttribute('src', path);
        imageAssets.push({
          id: `image-${index + 1}`,
          href: path,
          mediaType: asset.mediaType,
          data: new Uint8Array(await asset.blob.arrayBuffer())
        });
      } catch (error) {
        const source = model.absoluteCandidates[0] || model.src || '(imagem sem endereço)';
        omittedImages.push(`${source} (${error?.message || 'não disponível'})`);
        model.status = 'error';
        model.error = error?.message || 'Não foi possível incorporar a imagem.';
        replaceMissingImage(image, source);
      }
    }

    xmlDoc.querySelectorAll('audio,video,source,track,object,embed,iframe').forEach(node => {
      const source = clean(node.getAttribute('src') || node.getAttribute('data'));
      if (source) omittedImages.push(`${source} (recurso multimídia não incorporado)`);
      node.remove();
    });

    const serialized = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n${new XMLSerializer().serializeToString(xmlDoc.documentElement)}`;
    assertWellFormedXml(serialized, 'XHTML final do EPUB');
    return { xhtml: serialized, imageAssets, omittedImages, imageFolder };
  }

  function detectContentProperties(xhtml) {
    const doc = assertWellFormedXml(xhtml, 'XHTML para manifesto');
    const properties = [];
    if (doc.querySelector('svg')) properties.push('svg');
    if (doc.querySelector('math')) properties.push('mathml');
    if (doc.querySelector('script')) properties.push('scripted');
    return properties;
  }

  function validateFirstZipEntry(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 38) throw new Error('O arquivo compactado ficou incompleto.');
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
      throw new Error('O contêiner não possui um cabeçalho ZIP válido.');
    }
    const method = bytes[8] | (bytes[9] << 8);
    const nameLength = bytes[26] | (bytes[27] << 8);
    const name = new TextDecoder('utf-8').decode(bytes.slice(30, 30 + nameLength));
    if (name !== 'mimetype') throw new Error('O arquivo “mimetype” não é a primeira entrada do EPUB.');
    if (method !== 0) throw new Error('O arquivo “mimetype” foi comprimido, o que invalida o EPUB.');
  }

  async function validateGeneratedEpub(bytes, expectedFiles) {
    validateFirstZipEntry(bytes);
    const checkZip = await JSZip.loadAsync(bytes);
    const filePaths = new Set(Object.keys(checkZip.files).filter(path => !checkZip.files[path].dir));

    for (const path of expectedFiles) {
      if (!filePaths.has(path)) throw new Error(`O arquivo obrigatório “${path}” não entrou no EPUB.`);
    }

    const mimetype = await checkZip.file('mimetype').async('string');
    if (mimetype !== 'application/epub+zip') throw new Error('O conteúdo do arquivo “mimetype” está incorreto.');

    const xmlCache = new Map();
    const readXml = async path => {
      if (xmlCache.has(path)) return xmlCache.get(path);
      const entry = checkZip.file(path);
      if (!entry) throw new Error(`O recurso XML “${path}” não existe no EPUB.`);
      const xml = await entry.async('string');
      const parsed = assertWellFormedXml(xml, path);
      xmlCache.set(path, { xml, parsed });
      return { xml, parsed };
    };

    for (const path of [...filePaths].filter(path => /\.(?:xml|opf|xhtml|ncx)$/i.test(path))) {
      await readXml(path);
    }

    const containerData = await readXml('META-INF/container.xml');
    const rootfilePath = clean(containerData.parsed.querySelector('rootfile')?.getAttribute('full-path'));
    if (!rootfilePath || !filePaths.has(rootfilePath)) {
      throw new Error('O container.xml não aponta para um pacote OPF existente.');
    }

    const opfData = await readXml(rootfilePath);
    const manifestItems = Array.from(opfData.parsed.querySelectorAll('manifest > item'));
    const manifestIds = new Set();
    const manifestPaths = new Map();
    manifestItems.forEach(item => {
      const id = clean(item.getAttribute('id'));
      const href = clean(item.getAttribute('href'));
      if (!id || manifestIds.has(id)) throw new Error(`O manifesto contém um ID ausente ou duplicado: “${id || '(vazio)'}”.`);
      manifestIds.add(id);
      if (!href) throw new Error(`O item “${id}” não possui href no manifesto.`);
      const packagePath = resolvePackagePath(rootfilePath, href);
      if (!packagePath || !filePaths.has(packagePath)) throw new Error(`O recurso “${href}”, declarado no manifesto, não existe no EPUB.`);
      if (manifestPaths.has(packagePath)) throw new Error(`O recurso “${href}” foi declarado mais de uma vez no manifesto.`);
      manifestPaths.set(packagePath, id);
    });

    const spineRefs = Array.from(opfData.parsed.querySelectorAll('spine > itemref')).map(item => clean(item.getAttribute('idref')));
    if (!spineRefs.length) throw new Error('O spine do EPUB está vazio.');
    spineRefs.forEach(idref => {
      if (!manifestIds.has(idref)) throw new Error(`O spine aponta para o item inexistente “${idref}”.`);
    });

    const xhtmlPaths = [...filePaths].filter(path => /\.xhtml$/i.test(path));
    for (const path of xhtmlPaths) {
      const { parsed } = await readXml(path);
      const ids = new Set();
      parsed.querySelectorAll('[id]').forEach(node => {
        const id = node.getAttribute('id');
        if (ids.has(id)) throw new Error(`${path}: o ID “${id}” está duplicado.`);
        ids.add(id);
      });

      const references = Array.from(parsed.querySelectorAll('[href],[src]'));
      for (const node of references) {
        const attribute = node.hasAttribute('href') ? 'href' : 'src';
        const value = clean(node.getAttribute(attribute));
        if (!value || /^(?:https?:|mailto:|tel:|data:)/i.test(value)) continue;
        const hashIndex = value.indexOf('#');
        const pathPart = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
        let fragment = hashIndex >= 0 ? value.slice(hashIndex + 1) : '';
        try { fragment = decodeURIComponent(fragment); } catch { /* usa o fragmento original */ }
        const targetPath = pathPart ? resolvePackagePath(path, pathPart) : path;
        if (!filePaths.has(targetPath)) throw new Error(`${path}: ${attribute} aponta para o recurso inexistente “${value}”.`);
        if (fragment && /\.xhtml$/i.test(targetPath)) {
          const target = await readXml(targetPath);
          const targetIds = new Set(Array.from(target.parsed.querySelectorAll('[id]')).map(item => item.getAttribute('id')));
          if (!targetIds.has(fragment)) throw new Error(`${path}: o link “${value}” aponta para um ID inexistente.`);
        }
      }
    }

    return {
      files: filePaths.size,
      manifestItems: manifestItems.length,
      spineItems: spineRefs.length,
      xhtmlFiles: xhtmlPaths.length
    };
  }

  function setEpubProcessing(active, label = '') {
    const button = $('#downloadEpub');
    if (!button) return;
    const profile = selectedExportProfile();
    button.disabled = active;
    button.setAttribute('aria-busy', String(active));
    button.textContent = active ? (label || (profile.mode === 'xhtml' ? 'Preparando XHTML…' : 'Gerando EPUB…')) : (profile.mode === 'xhtml' ? 'Baixar XHTML arrumado ↓' : 'Gerar EPUB completo ↓');
  }

  function renderOverview() {
    const container = $('#overview');
    if (!container || !result) return;
    const audit = result.extractionAudit || {};
    container.innerHTML = `
      <div class="metric-grid">
        <article class="metric-card"><span>Parágrafos numerados</span><strong>${result.paragraphs.length}</strong></article>
        <article class="metric-card"><span>Marca-textos</span><strong>${totalHighlightCount(result)}</strong></article>
        <article class="metric-card"><span>Perguntas principais</span><strong>${result.questions.length}</strong></article>
        <article class="metric-card"><span>Revisão final</span><strong>${result.reviewQuestions?.length || 0}</strong></article>
        <article class="metric-card"><span>Grupos bíblicos da fonte</span><strong>${result.scriptureGroupCount || 0}</strong></article>
        <article class="metric-card"><span>Referências únicas</span><strong>${result.scriptures.length}</strong></article>
        <article class="metric-card"><span>Ocorrências lógicas</span><strong>${result.scriptureOccurrenceCount || 0}</strong></article>
        <article class="metric-card"><span>Imagens</span><strong>${result.images.length}</strong></article>
        <article class="metric-card"><span>Notas editoriais</span><strong>${audit.footnotes || 0}</strong></article>
      </div>
      <article class="content-card">
        <span class="utility-kicker">ARTIGO PROCESSADO PELO PADRÃO &lt;ARTICLE&gt;</span>
        <h3>${esc(result.title)}</h3>
        <p><strong>${result.paragraphs.length}</strong> parágrafos numerados foram ligados a <strong>${result.questions.length}</strong> perguntas principais usando <code>data-rel-pid</code>. ${audit.disconnectedQuestions || audit.disconnectedParagraphs ? 'Há conexões pendentes na aba Validação.' : 'Todas as perguntas e respostas ficaram conectadas.'}</p>
      </article>`;
  }

  function renderStructure() {
    const container = $('#structure');
    if (!container || !result) return;
    const subtitleHtml = result.subtitles.length
      ? `<ol class="structured-list">${result.subtitles.map(item => `<li><span>${esc(item.level.toUpperCase())}</span>${esc(item.text)}</li>`).join('')}</ol>`
      : '<div class="empty-inline">Nenhum subtítulo identificado.</div>';
    const paragraphHtml = result.paragraphs.length
      ? `<ol class="structured-list paragraph-list">${result.paragraphs.map(item => `<li><span>§ ${esc(item.number)}</span><div>${esc(item.text.slice(0, 300))}${item.text.length > 300 ? '…' : ''}<small>${item.question ? `Pergunta ${esc(item.question.label)} • vínculo ${esc(item.question.pid)}` : 'Sem pergunta vinculada'}</small></div></li>`).join('')}</ol>`
      : '<div class="empty-inline">Nenhum parágrafo numerado identificado.</div>';
    const extras = `<section class="content-card"><h3>Elementos complementares preservados</h3><dl class="audit-grid"><div><dt>Perguntas finais</dt><dd>${result.reviewQuestions?.length || 0}</dd></div><div><dt>Itens do quadro</dt><dd>${result.principleQuestions?.length || 0}</dd></div><div><dt>Figuras</dt><dd>${result.extractionAudit?.figures || 0}</dd></div><div><dt>Notas</dt><dd>${result.extractionAudit?.footnotes || 0}</dd></div></dl></section>`;
    container.innerHTML = `<section class="content-card"><h3>Subtítulos e quadros</h3>${subtitleHtml}</section><section class="content-card"><h3>Parágrafos ligados às perguntas</h3>${paragraphHtml}</section>${extras}`;
  }

  function buildPreExportAudit() {
    if (!result) return { blocking: true, checks: [{ ok: false, label: 'Nenhum artigo processado' }] };
    const checks = [];
    let xmlDoc = null;
    try {
      result.xhtml = buildXhtml(result);
      xmlDoc = new DOMParser().parseFromString(result.xhtml, 'application/xhtml+xml');
      const parserError = xmlDoc.querySelector('parsererror');
      checks.push({ ok: !parserError, label: parserError ? 'XHTML contém erro XML' : 'XHTML bem formado' });
    } catch (error) {
      checks.push({ ok: false, label: `XHTML inválido: ${error?.message || 'erro desconhecido'}` });
    }
    const expectedParagraphs = result.paragraphs?.length || 0;
    const expectedQuestions = result.questions?.length || 0;
    const expectedReview = result.reviewQuestions?.length || 0;
    const expectedScriptureAnchors = result.extractionAudit?.scriptureAnchors || 0;
    const outputParagraphs = xmlDoc ? new Set(Array.from(xmlDoc.querySelectorAll('.parNum[data-pnum]')).map(node => node.getAttribute('data-pnum'))).size : 0;
    const outputQuestions = xmlDoc ? xmlDoc.querySelectorAll('p.qu[data-pid]').length : 0;
    const outputReview = xmlDoc ? xmlDoc.querySelectorAll('.blockTeach .boxContent > ul > li').length : 0;
    const outputScriptureAnchors = xmlDoc ? xmlDoc.querySelectorAll('a[data-bid]').length : 0;
    checks.push({ ok: outputParagraphs === expectedParagraphs, label: `Parágrafos: ${outputParagraphs}/${expectedParagraphs}` });
    checks.push({ ok: outputQuestions === expectedQuestions, label: `Perguntas principais: ${outputQuestions}/${expectedQuestions}` });
    checks.push({ ok: outputReview === expectedReview, label: `Perguntas finais: ${outputReview}/${expectedReview}` });
    checks.push({ ok: outputScriptureAnchors === expectedScriptureAnchors, label: `Fragmentos bíblicos: ${outputScriptureAnchors}/${expectedScriptureAnchors}` });
    const images = imageAudit();
    checks.push({ ok: images.pending === 0, label: `Imagens pendentes: ${images.pending}` });
    checks.push({ ok: images.errors === 0, label: `Imagens com erro: ${images.errors}` });
    return { blocking: checks.some(check => !check.ok), checks, images };
  }

  async function runBuiltInRegressionTest(button = null) {
    const originalText = button?.textContent || '';
    if (button) { button.disabled = true; button.textContent = 'Executando teste…'; }
    try {
      const response = await fetch(REGRESSION_FIXTURE_PATH, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Arquivo de teste indisponível (HTTP ${response.status}). Abra a plataforma pelo iniciador local.`);
      const fixture = await response.text();
      const parsed = parseSource(fixture);
      const xhtml = buildXhtml(parsed);
      const xml = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
      const checks = [
        ['Parágrafos', parsed.paragraphs.length, 18],
        ['Perguntas principais', parsed.questions.length, 16],
        ['Perguntas finais', parsed.reviewQuestions.length, 3],
        ['Itens do quadro', parsed.principleQuestions.length, 6],
        ['Figuras', parsed.extractionAudit.figures, 2],
        ['Notas', parsed.extractionAudit.footnotes, 2],
        ['Grupos bíblicos', parsed.extractionAudit.scriptureGroups, 40],
        ['Fragmentos bíblicos', parsed.extractionAudit.scriptureAnchors, 47],
        ['Ocorrências bíblicas', parsed.extractionAudit.scriptureOccurrences, 46],
        ['Referências únicas', parsed.extractionAudit.scriptureUnique, 33],
        ['Erros XML', xml.querySelectorAll('parsererror').length, 0]
      ];
      const failures = checks.filter(([,actual,expected]) => actual !== expected);
      const summary = checks.map(([label,actual,expected]) => `${label}: ${actual}/${expected}`).join(' | ');
      showStatus(failures.length ? `Teste de regressão falhou: ${failures.map(([label,a,e]) => `${label} ${a}/${e}`).join(', ')}` : `Teste de regressão aprovado. ${summary}`, failures.length > 0);
      return { ok: failures.length === 0, checks };
    } catch (error) {
      showStatus(`Não foi possível executar o teste automático: ${error?.message || 'erro desconhecido'}`, true);
      return { ok: false, error: error?.message };
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText || 'Executar teste automático'; }
    }
  }

  function updateExportAvailability() {
    const button = $('#downloadEpub');
    if (!button) return;
    const profile = selectedExportProfile();
    button.textContent = profile.mode === 'xhtml' ? 'Baixar XHTML arrumado ↓' : 'Gerar EPUB completo ↓';
    if (!result) {
      button.disabled = false;
      button.removeAttribute('title');
      return;
    }
    const audit = buildPreExportAudit();
    const xhtmlBlocking = audit.checks.some(check => !check.ok && !/^Imagens/.test(check.label));
    const blocking = profile.mode === 'xhtml' ? xhtmlBlocking : audit.blocking;
    button.disabled = blocking;
    button.setAttribute('aria-disabled', String(blocking));
    button.title = blocking ? 'Resolva as pendências na aba Validação/Imagens antes de exportar.' : profile.description;
    const gate = $('#exportGateStatus');
    if (gate) {
      gate.className = `export-gate-status ${blocking ? 'blocked' : 'ready'}`;
      gate.textContent = blocking ? 'Exportação bloqueada: existem pendências.' : `Pronto: ${profile.label}.`;
    }
  }

  function renderValidation() {
    const container = $('#validation');
    if (!container || !result) return;
    const audit = result.extractionAudit || {};
    const connectedQuestions = result.questions.filter(item => item.connected).length;
    const connectedParagraphs = result.paragraphs.filter(item => item.question).length;
    const checks = [
      { ok: Boolean(result.title), text: 'Título identificado' },
      { ok: result.paragraphs.length > 0, text: `${result.paragraphs.length} parágrafo(s) numerado(s) identificado(s)` },
      { ok: connectedParagraphs === result.paragraphs.length, text: `${connectedParagraphs}/${result.paragraphs.length} parágrafo(s) ligados à pergunta correta` },
      { ok: connectedQuestions === result.questions.length, text: `${connectedQuestions}/${result.questions.length} pergunta(s) ligadas aos parágrafos indicados` },
      { ok: result.reviewQuestions?.length > 0, text: `${result.reviewQuestions?.length || 0} pergunta(s) da revisão final preservada(s)` },
      { ok: true, text: `${totalHighlightCount(result)} marcação(ões) de texto preparada(s) para o EPUB` },
      { ok: result.xhtml.includes('<article'), text: 'XHTML final montado' },
      { ok: result.scriptures.every(item => item.text), text: result.scriptures.length ? `${result.scriptures.filter(item => item.text).length}/${result.scriptures.length} referências bíblicas preenchidas` : 'Nenhuma referência bíblica encontrada' },
      { ok: !(result.bibleImportStats?.unmatchedEntries?.length), text: result.bibleImportStats ? `${result.bibleImportStats.imported - result.bibleImportStats.unmatchedEntries.length}/${result.bibleImportStats.imported} entradas bíblicas localizadas` : 'Importação bíblica ainda não executada' },
      { ok: result.images.every(image => image.alt || image.caption), text: result.images.length ? 'Imagens possuem descrição ou legenda' : 'Nenhuma imagem encontrada' },
      { ok: !imageAudit().included || imageAudit().ready === imageAudit().included, text: result.images.length ? `${imageAudit().ready}/${imageAudit().included} imagem(ns) pronta(s) para incorporação` : 'Nenhuma imagem para incorporar' }
    ];
    const auditHtml = `<section class="content-card"><h3>Auditoria baseada nos atributos do artigo</h3><dl class="audit-grid">
      <div><dt>&lt;p&gt; legíveis</dt><dd>${audit.readableParagraphElements ?? 0}</dd></div>
      <div><dt>Parágrafos data-rel-pid</dt><dd>${audit.bodyParagraphElements ?? 0}</dd></div>
      <div><dt>Perguntas .qu</dt><dd>${audit.questionParagraphElements ?? 0}</dd></div>
      <div><dt>Campos .gen-field</dt><dd>${audit.answerPlaceholderElements ?? 0}</dd></div>
      <div><dt>Revisão final</dt><dd>${audit.reviewQuestions ?? 0}</dd></div>
      <div><dt>Itens do quadro</dt><dd>${audit.principleQuestions ?? 0}</dd></div>
      <div><dt>Grupos data-bid</dt><dd>${audit.scriptureGroups ?? 0}</dd></div>
      <div><dt>Fragmentos data-bid</dt><dd>${audit.scriptureAnchors ?? 0}</dd></div>
      <div><dt>Ocorrências lógicas</dt><dd>${audit.scriptureOccurrences ?? 0}</dd></div>
      <div><dt>Referências únicas</dt><dd>${audit.scriptureUnique ?? 0}</dd></div>
      <div><dt>Figuras</dt><dd>${audit.figures ?? 0}</dd></div>
      <div><dt>Notas</dt><dd>${audit.footnotes ?? 0}</dd></div>
    </dl></section>`;
    const exportAudit = buildPreExportAudit();
    const exportAuditHtml = `<section class="content-card export-audit-card"><div class="card-heading"><div><span class="utility-kicker">AUDITORIA PRÉ-EXPORTAÇÃO</span><h3>Comparação entre origem e saída</h3></div><span class="audit-result ${exportAudit.blocking ? 'blocked' : 'ready'}">${exportAudit.blocking ? 'Pendências' : 'Aprovado'}</span></div><div class="validation-list compact">${exportAudit.checks.map(check => `<div class="validation-item ${check.ok ? 'valid' : 'warning'}"><span aria-hidden="true">${check.ok ? '✓' : '!'}</span><strong>${esc(check.label)}</strong></div>`).join('')}</div><div class="audit-actions"><button type="button" class="button secondary light" id="runRegressionTest">Executar teste automático do sistema</button></div></section>`;
    container.innerHTML = `<div class="validation-list">${checks.map(check => `<div class="validation-item ${check.ok ? 'valid' : 'warning'}"><span aria-hidden="true">${check.ok ? '✓' : '!'}</span><strong>${esc(check.text)}</strong></div>`).join('')}</div>${exportAuditHtml}${auditHtml}${result.warnings.length ? `<section class="content-card"><h3>Avisos</h3><ul>${result.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul></section>` : ''}`;
    $('#runRegressionTest', container)?.addEventListener('click', event => runBuiltInRegressionTest(event.currentTarget));
    updateExportAvailability();
  }

  function renderHighlightParagraph(paragraph) {
    const count = normalizeParagraphHighlights(paragraph).length;
    return `<article class="highlight-paragraph" data-highlight-card="${esc(paragraph.number)}">
      <div class="highlight-paragraph-head">
        <div><strong>Parágrafo ${esc(paragraph.number)}</strong><small>${count ? `${count} marcação(ões)` : 'Sem marcações'}</small></div>
        <div class="highlight-toolbar" role="toolbar" aria-label="Marca-textos do parágrafo ${esc(paragraph.number)}">
          <button type="button" class="marker-button marker-yellow" data-highlight-action="apply" data-marker="yellow" data-paragraph-number="${esc(paragraph.number)}" title="Marcar a resposta direta">Amarela</button>
          <button type="button" class="marker-button marker-blue" data-highlight-action="apply" data-marker="blue" data-paragraph-number="${esc(paragraph.number)}" title="Marcar um comentário adicional">Azul</button>
          <button type="button" class="marker-button marker-orange" data-highlight-action="apply" data-marker="orange" data-paragraph-number="${esc(paragraph.number)}" title="Marcar algo para lembrar">Laranja</button>
          <button type="button" class="marker-button marker-remove" data-highlight-action="remove" data-paragraph-number="${esc(paragraph.number)}">Remover trecho</button>
          <button type="button" class="marker-button marker-clear" data-highlight-action="clear" data-paragraph-number="${esc(paragraph.number)}">Limpar parágrafo</button>
        </div>
      </div>
      <div class="highlight-content" data-highlight-content="${esc(paragraph.number)}" tabindex="0" aria-label="Texto do parágrafo ${esc(paragraph.number)}. Selecione um trecho e escolha uma cor.">${highlightedTextHtml(paragraph)}</div>
      <div class="highlight-message" data-highlight-message="${esc(paragraph.number)}">Selecione um trecho do parágrafo e escolha uma cor.</div>
    </article>`;
  }

  function updateHighlightMessage(paragraphNumber, message, error = false) {
    const node = document.querySelector(`[data-highlight-message="${CSS.escape(String(paragraphNumber))}"]`);
    if (!node) return;
    node.textContent = message;
    node.className = `highlight-message ${error ? 'error' : 'ok'}`;
  }

  function refreshHighlights(label = 'Marca-texto atualizado') {
    if (!result) return;
    const scrollY = window.scrollY;
    result.xhtml = buildXhtml(result);
    $('#xhtmlCode').textContent = result.xhtml;
    renderOverview();
    renderValidation();
    renderComparison();
    renderQuestions();
    renderPreview();
    queueSave(label);
    savedParagraphSelection = null;
    requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'auto' }));
  }

  function bindHighlightControls(container) {
    $$('[data-highlight-content]', container).forEach(content => {
      const capture = () => {
        const range = selectionOffsetsWithin(content);
        if (!range) return;
        const paragraphNumber = content.dataset.highlightContent;
        savedParagraphSelection = { paragraphNumber, ...range };
        updateHighlightMessage(paragraphNumber, `Trecho selecionado: “${range.text.slice(0, 90)}${range.text.length > 90 ? '…' : ''}”`);
      };
      content.addEventListener('mouseup', capture);
      content.addEventListener('keyup', capture);
      content.addEventListener('touchend', () => setTimeout(capture, 0));
    });

    $$('[data-highlight-action]', container).forEach(button => {
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        const paragraphNumber = button.dataset.paragraphNumber;
        const paragraph = result.paragraphs.find(item => String(item.number) === String(paragraphNumber));
        if (!paragraph) return;
        const action = button.dataset.highlightAction;

        if (action === 'clear') {
          if (!normalizeParagraphHighlights(paragraph).length) {
            updateHighlightMessage(paragraphNumber, 'Este parágrafo ainda não possui marcações.', true);
            return;
          }
          paragraph.highlights = [];
          refreshHighlights(`Marcações do parágrafo ${paragraphNumber} removidas`);
          showStatus(`Todas as marcações do parágrafo ${paragraphNumber} foram removidas.`);
          return;
        }

        const root = container.querySelector(`[data-highlight-content="${CSS.escape(String(paragraphNumber))}"]`);
        const liveRange = root ? selectionOffsetsWithin(root) : null;
        const selection = liveRange || (savedParagraphSelection?.paragraphNumber === String(paragraphNumber) ? savedParagraphSelection : null);
        if (!selection || selection.end <= selection.start) {
          updateHighlightMessage(paragraphNumber, 'Selecione primeiro o trecho que deseja marcar ou desmarcar.', true);
          return;
        }

        if (action === 'remove') {
          replaceHighlightRange(paragraph, selection.start, selection.end, '');
          refreshHighlights(`Marca-texto removido do parágrafo ${paragraphNumber}`);
          showStatus(`A marcação foi removida do trecho selecionado no parágrafo ${paragraphNumber}.`);
          return;
        }

        const type = button.dataset.marker;
        const meta = markerMeta(type);
        if (!meta) return;
        replaceHighlightRange(paragraph, selection.start, selection.end, type);
        refreshHighlights(`${meta.label} marcada no parágrafo ${paragraphNumber}`);
        showStatus(`${meta.label} marcada no parágrafo ${paragraphNumber}.`);
      });
    });

    $('#clearAllHighlights', container)?.addEventListener('click', () => {
      const count = totalHighlightCount(result);
      if (!count) return showStatus('O estudo ainda não possui marcações.', true);
      result.paragraphs.forEach(paragraph => { paragraph.highlights = []; });
      refreshHighlights('Todas as marcações removidas');
      showStatus(`${count} marcação(ões) foram removidas do estudo.`);
    });
  }

  function renderQuestions() {
    const container = $('#questions');
    if (!container || !result) return;
    const highlightCount = totalHighlightCount(result);
    const header = `<section class="content-card highlight-introduction">
      <div class="section-heading"><div><span class="utility-kicker">MARCA-TEXTO DOS PARÁGRAFOS</span><h3>Selecione os trechos importantes</h3></div><button type="button" class="button secondary light compact" id="clearAllHighlights">Limpar todas</button></div>
      <p class="highlight-help">Selecione qualquer trecho de um parágrafo e clique em uma cor. As marcações são salvas no projeto e aparecem no XHTML e no EPUB final.</p>
      <div class="highlight-legend" aria-label="Legenda das marcações">
        <span class="legend-item"><span class="legend-color legend-yellow"></span>Amarela — resposta direta</span>
        <span class="legend-item"><span class="legend-color legend-blue"></span>Azul — comentário adicional</span>
        <span class="legend-item"><span class="legend-color legend-orange"></span>Laranja — lembrar</span>
        <span class="count">${highlightCount} marcação(ões)</span>
      </div>
    </section>`;

    const main = result.questions.length
      ? `<div class="card-stack">${result.questions.map(question => {
          const related = question.paragraphNumbers.map(number => result.paragraphs.find(item => item.number === number)).filter(Boolean);
          return `<article class="question content-card connected-question ${question.connected ? 'is-connected' : 'is-disconnected'}">
            <div class="card-heading"><div><span class="utility-kicker">PERGUNTA ${esc(question.label || question.order)}</span><p>${esc(question.text)}</p></div><span class="connection-badge">${question.connected ? 'Conectada' : 'Revisar vínculo'}</span></div>
            <div class="connected-answer"><strong>Parágrafo(s) que respondem:</strong>${related.map(renderHighlightParagraph).join('') || '<p>Nenhum parágrafo relacionado foi encontrado.</p>'}</div>
          </article>`;
        }).join('')}</div>`
      : '<div class="empty-inline">Nenhuma pergunta principal foi identificada.</div>';
    const review = result.reviewQuestions?.length
      ? `<section class="content-card"><span class="utility-kicker">QUAL É A SUA RESPOSTA?</span><h3>Revisão final</h3><ol class="review-question-list">${result.reviewQuestions.map(item => `<li>${esc(item.text)}</li>`).join('')}</ol></section>`
      : '';
    container.innerHTML = `${header}${main}${review}`;
    bindHighlightControls(container);
  }

  function renderScriptures() {
    const container = $('#scriptures');
    if (!container || !result) return;

    const occurrenceCount = result.scriptureOccurrenceCount || 0;
    const groupCount = result.scriptureGroupCount || 0;
    const filledCount = result.scriptures.filter(item => clean(item.text)).length;
    const coveredOccurrences = result.scriptures.filter(item => clean(item.text)).reduce((total, item) => total + (item.occurrences?.length || 0), 0);
    const coveredGroups = new Set(result.scriptures.filter(item => clean(item.text)).flatMap(item => (item.occurrences || []).map(occurrence => occurrence.groupId).filter(Boolean))).size;
    const stats = result.bibleImportStats;

    const diagnostic = `
      <section class="content-card scripture-diagnostic">
        <div class="section-heading"><div><span class="utility-kicker">DIAGNÓSTICO PELO DATA-BID</span><h3>Textos bíblicos do artigo</h3></div></div>
        <div class="metric-grid scripture-metrics">
          <article class="metric-card"><span>Grupos da fonte</span><strong>${groupCount}</strong></article>
          <article class="metric-card"><span>Fragmentos de link</span><strong>${result.scriptureAnchorCount || 0}</strong></article>
          <article class="metric-card"><span>Ocorrências lógicas</span><strong>${occurrenceCount}</strong></article>
          <article class="metric-card"><span>Referências únicas</span><strong>${result.scriptures.length}</strong></article>
          <article class="metric-card"><span>Textos preenchidos</span><strong>${filledCount}/${result.scriptures.length}</strong></article>
          <article class="metric-card"><span>Grupos cobertos</span><strong>${coveredGroups}/${groupCount}</strong></article>
        </div>
        ${stats ? `<p class="diagnostic-note">Foram importadas <strong>${stats.imported}</strong> entradas. <strong>${stats.matchedUnique}</strong> referências únicas foram associadas, cobrindo <strong>${stats.matchedOccurrences}</strong> ocorrências em <strong>${stats.matchedGroups}</strong> grupos de citação.</p>` : '<p class="diagnostic-note">O artigo possui grupos de citação numerados por <code>data-bid</code>. Referências repetidas reutilizam o mesmo texto, sem perder nenhuma ocorrência.</p>'}
      </section>`;

    const unmatchedImported = stats?.unmatchedEntries?.length
      ? `<section class="content-card association-warning"><h3>Entradas importadas não localizadas</h3><ul>${stats.unmatchedEntries.map(item => `<li><strong>${esc(item.reference)}</strong></li>`).join('')}</ul></section>`
      : '';
    const pendingDetected = result.scriptures.filter(item => !clean(item.text));
    const pendingHtml = pendingDetected.length
      ? `<section class="content-card association-warning"><h3>Referências sem texto associado</h3><ul>${pendingDetected.map(item => `<li><strong>${esc(item.reference)}</strong> — ${(item.occurrences || []).length} ocorrência(s)</li>`).join('')}</ul></section>`
      : '';

    const cards = result.scriptures.length
      ? `<div class="card-stack">${result.scriptures.map((scripture, index) => {
          const locations = summarizeLocations(scripture.occurrences);
          return `<article class="scripture-card content-card ${scripture.text ? 'associated' : 'pending'}" data-scripture-index="${index}">
            <div class="card-heading"><div><span class="utility-kicker">REFERÊNCIA ${index + 1} • ${(scripture.occurrences || []).length} ocorrência(s)</span><h3>${esc(scripture.reference)}</h3><small>${locations.length ? esc(locations.join(' • ')) : 'Localização não identificada'}</small></div><button type="button" class="button secondary light compact add-library" data-index="${index}">Adicionar à biblioteca</button></div>
            <div class="field"><label>Texto bíblico</label><textarea class="scripture-text" data-index="${index}" placeholder="Cole o texto desta referência">${esc(scripture.text)}</textarea></div>
            <div class="field"><label>Comentário</label><textarea class="scripture-comment" data-index="${index}" placeholder="Comentário opcional">${esc(scripture.comment)}</textarea></div>
          </article>`;
        }).join('')}</div>`
      : '<div class="empty-inline">Nenhuma referência bíblica com data-bid foi identificada.</div>';

    container.innerHTML = `${diagnostic}${unmatchedImported}${pendingHtml}${cards}`;

    $$('.scripture-text', container).forEach(input => input.addEventListener('input', () => {
      const item = result.scriptures[Number(input.dataset.index)];
      if (!item) return;
      item.text = input.value;
      result.xhtml = buildXhtml(result);
      $('#xhtmlCode').textContent = result.xhtml;
      renderValidation();
      queueSave('Texto bíblico editado');
    }));
    $$('.scripture-comment', container).forEach(input => input.addEventListener('input', () => {
      const item = result.scriptures[Number(input.dataset.index)];
      if (!item) return;
      item.comment = input.value;
      result.xhtml = buildXhtml(result);
      $('#xhtmlCode').textContent = result.xhtml;
      queueSave('Comentário editado');
    }));
    $$('.add-library', container).forEach(button => button.addEventListener('click', () => {
      const item = result.scriptures[Number(button.dataset.index)];
      if (!item) return;
      libraryItems.push({ ...item, addedAt: new Date().toISOString(), sourceTitle: result.title });
      renderLibrary();
      queueSave('Item adicionado à biblioteca');
      showStatus(`${item.reference} foi adicionado à Mini Biblioteca.`);
    }));
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2).replace('.', ',')} MB`;
  }

  function imageStatusMeta(model) {
    if (!model.include) return { className: 'excluded', label: 'Excluída do EPUB', icon: '–' };
    return ({
      ready: { className: 'ready', label: 'Incorporada', icon: '✓' },
      downloading: { className: 'working', label: 'Baixando…', icon: '↻' },
      error: { className: 'error', label: 'Precisa de atenção', icon: '!' },
      pending: { className: 'pending', label: 'Aguardando download', icon: '•' }
    })[model.status] || { className: 'pending', label: 'Aguardando download', icon: '•' };
  }

  async function hydrateImagePreviews() {
    if (!result?.images?.length) return;
    for (let index = 0; index < result.images.length; index += 1) {
      const model = normalizeImageModel(result.images[index], index);
      const target = document.querySelector(`[data-image-preview="${index}"]`);
      if (!target) continue;
      let source = model.resolvedUrl || model.absoluteCandidates[0] || resolveImageUrl(model.src);
      if (model.status === 'ready') {
        const cached = await cachedAssetForModel(model, index);
        if (cached?.blob) {
          releaseImagePreview(index);
          source = URL.createObjectURL(cached.blob);
          imagePreviewUrls.set(index, source);
        }
      }
      if (source) {
        target.innerHTML = `<img src="${esc(source)}" alt="${esc(model.alt || '')}" loading="lazy" /><span class="image-preview-fallback">Prévia indisponível</span>`;
        const previewImage = target.querySelector('img');
        previewImage?.addEventListener('error', () => target.classList.add('preview-error'), { once: true });
      }
    }
  }

  async function handleImageAction(action, index, button) {
    const model = normalizeImageModel(result?.images?.[index], index);
    if (!model) return;
    const original = button?.textContent;
    try {
      if (button) { button.disabled = true; button.textContent = 'Processando…'; }
      if (action === 'resolve') await resolveImageAsset(model, index, { force: true });
      if (action === 'small') await resolveImageAsset(model, index, { force: true, preferSmall: true });
      if (action === 'clear') {
        await imageCacheDelete(model.cacheKey);
        releaseImagePreview(index);
        model.status = 'pending';
        model.cacheKey = model.absoluteCandidates[0] ? imageCacheKey(model.absoluteCandidates[0], index) : '';
        model.localPath = '';
        model.mediaType = '';
        model.sizeBytes = 0;
        model.originalSizeBytes = 0;
        model.savedBytes = 0;
        model.originalWidth = 0;
        model.originalHeight = 0;
        model.wasResized = false;
        model.error = '';
      }
      refreshXhtmlAfterImages(action === 'clear' ? 'Imagem removida do cache' : 'Imagem incorporada');
      renderImages();
      showStatus(action === 'clear' ? 'A imagem foi removida do cache local.' : `Imagem ${index + 1} pronta para o XHTML e o EPUB.`);
    } catch (error) {
      model.status = 'error';
      model.error = error?.message || 'Não foi possível processar a imagem.';
      renderImages();
      renderValidation();
      showStatus(`Imagem ${index + 1}: ${model.error}`, true);
    } finally {
      if (button && button.isConnected) { button.disabled = false; button.textContent = original || 'Tentar novamente'; }
    }
  }

  function renderImages() {
    const container = $('#images');
    if (!container || !result) return;
    releaseAllImagePreviews();
    result.images = (result.images || []).map(normalizeImageModel);
    if (!result.images.length) {
      container.innerHTML = '<div class="empty-inline">Nenhuma imagem encontrada.</div>';
      return;
    }
    const audit = imageAudit();
    const cards = result.images.map((image, index) => {
      const status = imageStatusMeta(image);
      const sources = image.absoluteCandidates.length || image.candidates.length;
      const openUrl = image.resolvedUrl || image.absoluteCandidates[0] || resolveImageUrl(image.src);
      return `<article class="image-manager-card content-card image-state-${status.className}" data-image-card="${index}">
        <div class="image-preview image-manager-preview" data-image-preview="${index}"><span>Carregando prévia…</span></div>
        <div class="image-manager-content">
          <div class="card-heading image-manager-heading">
            <div><span class="utility-kicker">IMAGEM ${index + 1}</span><h3>${esc(image.caption || image.alt || `Imagem ${index + 1}`)}</h3></div>
            <span class="image-status ${status.className}"><b aria-hidden="true">${status.icon}</b>${status.label}</span>
          </div>
          <dl class="image-meta-grid">
            <div><dt>Endereços encontrados</dt><dd>${sources}</dd></div>
            <div><dt>Arquivo no EPUB</dt><dd>${esc(image.localPath || 'Ainda não definido')}</dd></div>
            <div><dt>Formato</dt><dd>${esc(image.mediaType || '—')}</dd></div>
            <div><dt>Tamanho final</dt><dd>${formatBytes(image.sizeBytes)}</dd></div>
            <div><dt>Economia</dt><dd class="image-savings">${image.originalSizeBytes ? `${formatBytes(image.savedBytes)} (${Math.max(0, Math.round((image.savedBytes / image.originalSizeBytes) * 100))}%)` : '—'}</dd></div>
            <div><dt>Dimensões finais</dt><dd>${image.width && image.height ? `${image.width} × ${image.height}` : '—'}</dd></div>
            <div><dt>Dimensões originais</dt><dd>${image.originalWidth && image.originalHeight ? `${image.originalWidth} × ${image.originalHeight}` : '—'}${image.wasResized ? ' · redimensionada' : ''}</dd></div>
            <div><dt>Origem</dt><dd>${image.sourceKind === 'manual' ? 'Arquivo selecionado' : image.sourceKind === 'proxy' ? 'Servidor local' : 'HTML do artigo'}</dd></div>
          </dl>
          <div class="image-source-line" title="${esc(openUrl)}">${esc(openUrl || 'Endereço não identificado')}</div>
          ${image.error ? `<p class="image-error-message">${esc(image.error)}</p>` : ''}
          <div class="image-manager-actions">
            <button type="button" class="button primary compact image-action" data-image-action="resolve" data-index="${index}">Baixar e incorporar</button>
            ${image.absoluteCandidates.length > 1 ? `<button type="button" class="button secondary light compact image-action" data-image-action="small" data-index="${index}">Tentar imagem menor</button>` : ''}
            <label class="button secondary light compact image-file-button">Selecionar arquivo<input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml" data-manual-image="${index}" /></label>
            ${openUrl && /^https?:/i.test(openUrl) ? `<a class="button secondary light compact" href="${esc(openUrl)}" target="_blank" rel="noopener noreferrer">Abrir origem</a>` : ''}
            ${image.status === 'ready' ? `<button type="button" class="button danger-ghost compact image-action" data-image-action="clear" data-index="${index}">Remover cache</button>` : ''}
          </div>
          <label class="image-include-toggle"><input type="checkbox" data-image-include="${index}" ${image.include ? 'checked' : ''} /> Incluir esta imagem no XHTML e no EPUB</label>
        </div>
      </article>`;
    }).join('');

    container.innerHTML = `<section class="image-dashboard content-card">
      <div class="section-heading"><div><span class="utility-kicker">GERENCIADOR DE IMAGENS</span><h3>Baixar e incorporar imagens do artigo</h3><p>O sistema usa até <strong>${IMAGE_DOWNLOAD_CONCURRENCY} downloads simultâneos</strong>, redimensiona imagens grandes e, quando houver CORS, utiliza o iniciador <strong>INICIAR-SISTEMA.cmd</strong> sem exigir Python.</p></div><span class="image-audit-badge ${audit.errors ? 'warning' : audit.ready === audit.included ? 'ready' : ''}">${audit.ready}/${audit.included} prontas</span></div>
      <div class="image-proxy-status ${isLocalAppServer() ? 'checking' : 'inactive'}" id="imageProxyStatus"><strong>Servidor local:</strong> ${isLocalAppServer() ? 'verificando…' : 'inativo — abra pelo INICIAR-SISTEMA.cmd'}</div>
      <div class="image-dashboard-actions">
        <button type="button" class="button primary" id="resolveAllImages">Baixar e incorporar todas</button>
        <button type="button" class="button secondary light" id="testImageProxy">Testar servidor local</button>
        <button type="button" class="button secondary light" id="auditAllImages">Auditar imagens</button>
        <button type="button" class="button secondary light" id="downloadResolvedImages">Baixar imagens em ZIP</button>
      </div>
      <div class="image-audit-strip"><span>${audit.total} encontrada(s)</span><span>${audit.ready} incorporada(s)</span><span>${audit.pending} pendente(s)</span><span>${audit.errors} com erro</span><span>${audit.excluded} excluída(s)</span><span>${formatBytes(audit.savedBytes)} economizados</span></div>
    </section><div class="image-manager-list">${cards}</div>`;

    $('#resolveAllImages', container)?.addEventListener('click', () => resolveAllImages({ showMessage: true }));
    const updateProxyStatus = async (announce = false) => {
      const statusNode = $('#imageProxyStatus', container);
      const available = await localImageProxyAvailable();
      if (statusNode) {
        statusNode.className = `image-proxy-status ${available ? 'active' : 'inactive'}`;
        statusNode.innerHTML = `<strong>Servidor local:</strong> ${available ? 'ativo — fallback CORS disponível' : 'inativo — abra pelo INICIAR-SISTEMA.cmd'}`;
      }
      if (announce) showStatus(available ? 'Servidor local ativo. O download das imagens pode contornar o bloqueio CORS.' : 'Servidor local inativo. Execute INICIAR-SISTEMA.cmd e use a página aberta por ele.', !available);
      return available;
    };
    $('#testImageProxy', container)?.addEventListener('click', () => updateProxyStatus(true));
    updateProxyStatus(false);
    $('#auditAllImages', container)?.addEventListener('click', async () => {
      await reconcileImageCacheState({ render: false });
      const current = imageAudit();
      renderImages();
      showStatus(`Auditoria: ${current.ready}/${current.included} imagem(ns) pronta(s), ${current.errors} com erro e ${current.excluded} excluída(s).`, current.errors > 0);
    });
    $('#downloadResolvedImages', container)?.addEventListener('click', downloadImagesZip);
    $$('.image-action', container).forEach(button => button.addEventListener('click', () => handleImageAction(button.dataset.imageAction, Number(button.dataset.index), button)));
    $$('[data-manual-image]', container).forEach(input => input.addEventListener('change', async event => {
      const index = Number(input.dataset.manualImage);
      const file = event.target.files?.[0];
      if (!file) return;
      const model = normalizeImageModel(result.images[index], index);
      try {
        model.status = 'downloading';
        renderImages();
        await attachManualImage(file, model, index);
        refreshXhtmlAfterImages('Imagem manual incorporada');
        renderImages();
        showStatus(`O arquivo “${file.name}” foi incorporado como imagem ${index + 1}.`);
      } catch (error) {
        model.status = 'error';
        model.error = error?.message || 'Arquivo inválido.';
        renderImages();
        showStatus(`Imagem ${index + 1}: ${model.error}`, true);
      }
    }));
    $$('[data-image-include]', container).forEach(input => input.addEventListener('change', () => {
      const index = Number(input.dataset.imageInclude);
      const model = normalizeImageModel(result.images[index], index);
      model.include = input.checked;
      model.status = input.checked ? (model.localPath ? 'ready' : 'pending') : 'excluded';
      refreshXhtmlAfterImages(input.checked ? 'Imagem incluída' : 'Imagem excluída');
      renderImages();
    }));
    hydrateImagePreviews();
    updateExportAvailability();
  }

  async function downloadImagesZip() {
    if (!result?.images?.length) return showStatus('Nenhuma imagem foi encontrada.', true);
    if (typeof JSZip === 'undefined') return showStatus('O módulo de compactação não foi carregado.', true);
    await resolveAllImages({ showMessage: false });
    const zip = new JSZip();
    const manifest = [];
    for (let index = 0; index < result.images.length; index += 1) {
      const model = normalizeImageModel(result.images[index], index);
      if (!model.include || model.status !== 'ready') continue;
      const cached = await cachedAssetForModel(model, index);
      if (!cached?.blob) continue;
      zip.file(model.localPath || imageLocalPath(index, cached.mediaType), cached.blob);
      manifest.push({
        ordem: index + 1,
        arquivo: model.localPath,
        origem: model.resolvedUrl || model.src,
        formato: cached.mediaType,
        bytes: cached.blob.size,
        alt: model.alt,
        legenda: model.caption
      });
    }
    if (!manifest.length) return showStatus('Nenhuma imagem pôde ser preparada para o ZIP. Use “Selecionar arquivo” nas imagens com erro.', true);
    zip.file('manifesto-imagens.json', JSON.stringify(manifest, null, 2));
    zip.file('LEIA-ME.txt', 'As imagens desta pasta já usam os mesmos caminhos inseridos no XHTML. Mantenha a pasta de imagens ao lado do arquivo XHTML dentro do EPUB.');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    download(`${slug(result.title)}-imagens.zip`, blob, 'application/zip');
    showStatus(`${manifest.length} imagem(ns) pronta(s) foram baixadas em ZIP.`);
  }

  function renderPreview() {
    const container = $('#preview');
    if (!container || !result) return;
    container.innerHTML = `<iframe class="epub-preview-frame" title="Prévia do XHTML" sandbox srcdoc="${esc(result.xhtml)}"></iframe>`;
  }

  function renderLibrary() {
    const container = $('#library');
    if (!container) return;
    container.innerHTML = libraryItems.length
      ? `<div class="card-stack"><div class="section-heading"><div><span class="utility-kicker">ACERVO LOCAL</span><h3>Mini Biblioteca</h3></div><span class="count">${libraryItems.length} item(ns)</span></div>${libraryItems.map((item, index) => `<article class="content-card"><div class="card-heading"><div><h3>${esc(item.reference)}</h3><small>${esc(item.sourceTitle || '')}</small></div><button type="button" class="button danger-ghost compact remove-library" data-index="${index}">Remover</button></div><p>${esc(item.text || 'Texto não informado.')}</p>${item.comment ? `<p class="library-comment">${esc(item.comment)}</p>` : ''}</article>`).join('')}</div>`
      : '<div class="empty-inline">A Mini Biblioteca ainda está vazia.</div>';
    $$('.remove-library', container).forEach(button => button.addEventListener('click', () => {
      libraryItems.splice(Number(button.dataset.index), 1);
      renderLibrary();
      queueSave('Item removido da biblioteca');
    }));
  }

  function renderAll() {
    if (!result) return;
    elements.empty.style.display = 'none';
    elements.summaryCount.textContent = `${result.paragraphs.length} parágrafo(s)`;
    elements.readyIndicator.textContent = 'Estudo processado';
    elements.readyIndicator.className = 'ready-indicator ready';
    renderOverview();
    renderStructure();
    renderValidation();
    renderComparison();
    renderQuestions();
    renderScriptures();
    renderImages();
    renderPreview();
    renderLibrary();
    $('#xhtmlCode').textContent = result.xhtml;
  }

  function activateMainTab(viewId, defaultSubview = '') {
    $$('.main-tabs .tab').forEach(tab => {
      const active = tab.dataset.view === viewId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('.main-view').forEach(view => view.classList.toggle('active', view.id === viewId));
    if (defaultSubview) activateSubview(defaultSubview);
  }

  function activateSubview(subviewId) {
    if (subviewId === 'comparison' && result) renderComparison();
    const target = document.getElementById(subviewId);
    if (!target) return;
    const parent = target.closest('.main-view');
    if (!parent) return;
    $$('.subview', parent).forEach(view => view.classList.toggle('active', view.id === subviewId));
    $$('.subtab', parent).forEach(tab => {
      const active = tab.dataset.subview === subviewId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
  }

  function currentState() {
    return {
      source: elements.source?.value || '',
      bibleText: elements.bibleTextInput?.value || '',
      settings: {
        fileName: $('#fileName')?.value || '',
        citationStart: $('#citationStart')?.value || '1',
        imageFolder: $('#imageFolder')?.value || 'images',
        libraryFileName: $('#libraryFileName')?.value || 'mini-biblioteca.xhtml',
        imageQuality: $('#imageQuality')?.value || '0.85',
        imageMaxDimension: $('#imageMaxDimension')?.value || String(DEFAULT_MAX_IMAGE_DIMENSION),
        exportProfile: $('#exportProfile')?.value || 'balanced',
        articleUrl: $('#articleUrl')?.value || ''
      },
      result,
      libraryItems,
      savedAt: new Date().toISOString()
    };
  }

  function restoreState(state) {
    if (!state) return;
    restoring = true;
    elements.source.value = state.source || '';
    elements.bibleTextInput.value = state.bibleText || '';
    Object.entries(state.settings || {}).forEach(([key, value]) => {
      const id = { fileName: 'fileName', citationStart: 'citationStart', imageFolder: 'imageFolder', libraryFileName: 'libraryFileName', imageQuality: 'imageQuality', imageMaxDimension: 'imageMaxDimension', exportProfile: 'exportProfile', articleUrl: 'articleUrl' }[key];
      if (id && document.getElementById(id)) document.getElementById(id).value = value;
    });
    if (!Object.prototype.hasOwnProperty.call(state.settings || {}, 'exportProfile') && $('#exportProfile')) {
      $('#exportProfile').value = 'custom';
      const description = $('#exportProfileDescription');
      if (description) description.textContent = EXPORT_PROFILES.custom.description;
    } else {
      const profile = EXPORT_PROFILES[$('#exportProfile')?.value] || EXPORT_PROFILES.balanced;
      const description = $('#exportProfileDescription');
      if (description) description.textContent = profile.description;
    }
    result = state.result || null;
    if (result?.paragraphs) {
      result.paragraphs.forEach(paragraph => {
        paragraph.highlights = Array.isArray(paragraph.highlights) ? paragraph.highlights : [];
        normalizeParagraphHighlights(paragraph);
      });
    }
    if (result?.images) {
      result.images = result.images.map(normalizeImageModel);
    }
    if (result?.scriptures) {
      result.scriptures.forEach((item, index) => {
        item.order = item.order || index + 1;
        item.key = referenceKey(item.reference);
        item.occurrences = Array.isArray(item.occurrences) ? item.occurrences : [];
      });
      result.scriptureOccurrenceCount = result.scriptureOccurrenceCount || result.scriptures.reduce((total, item) => total + Math.max(1, item.occurrences.length || 0), 0);
    }
    libraryItems = Array.isArray(state.libraryItems) ? state.libraryItems : [];
    updateCharacterCount();
    if (result) {
      renderAll();
      setTimeout(() => reconcileImageCacheState({ render: true }), 0);
    } else renderLibrary();
    restoring = false;
  }

  function pushUndoSnapshot(label = 'Alteração') {
    if (restoring) return;
    const snapshot = currentState();
    snapshot.label = label;
    const signature = JSON.stringify(snapshot);
    if (undoStack.length && undoStack[undoStack.length - 1].signature === signature) return;
    undoStack.push({ state: snapshot, signature, label });
    if (undoStack.length > 30) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
  }

  function updateUndoButtons() {
    if ($('#undoAction')) $('#undoAction').disabled = undoStack.length < 2;
    if ($('#redoAction')) $('#redoAction').disabled = redoStack.length === 0;
  }

  function queueSave(label = 'Projeto atualizado') {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      saveLocal(label);
      pushUndoSnapshot(label);
    }, 450);
  }

  function saveLocal(label = 'Projeto salvo') {
    try {
      const state = currentState();
      storageSet(STORAGE_KEY, JSON.stringify(state));
      elements.autosaveStatus.textContent = `Salvo às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      if (result) {
        versions.unshift({ label, date: new Date().toISOString(), state });
        versions = versions.slice(0, MAX_VERSIONS);
        storageSet(VERSIONS_KEY, JSON.stringify(versions));
        renderVersions();
      }
    } catch {
      elements.autosaveStatus.textContent = 'Salvamento local indisponível';
    }
  }

  function renderSearch() {
    const container = $('#search');
    if (!container) return;
    container.innerHTML = `<div class="field"><label for="projectSearchInput">Pesquisar termo</label><input id="projectSearchInput" type="search" placeholder="Título, parágrafo, pergunta ou referência"></div><div id="projectSearchResults" class="search-results"></div>`;
    const input = $('#projectSearchInput');
    input?.addEventListener('input', () => {
      const term = normalizeReference(input.value);
      const results = [];
      if (term && result) {
        result.paragraphs.filter(item => normalizeReference(item.text).includes(term)).slice(0, 20).forEach(item => results.push({ type: `Parágrafo ${item.number}`, text: item.text }));
        result.questions.filter(item => normalizeReference(item.text).includes(term)).slice(0, 20).forEach(item => results.push({ type: 'Pergunta', text: item.text }));
        result.scriptures.filter(item => normalizeReference(`${item.reference} ${item.text}`).includes(term)).slice(0, 20).forEach(item => results.push({ type: 'Texto bíblico', text: `${item.reference} — ${item.text}` }));
      }
      $('#projectSearchResults').innerHTML = term
        ? (results.length ? results.map(item => `<article class="search-result"><span>${esc(item.type)}</span><p>${esc(item.text)}</p></article>`).join('') : '<div class="empty-inline">Nenhum resultado.</div>')
        : '<div class="empty-inline">Digite para pesquisar no projeto.</div>';
    });
  }

  function renderStudies() {
    const container = $('#studies');
    if (!container) return;
    let studies = [];
    try { studies = JSON.parse(storageGet(STUDIES_KEY) || '[]'); } catch {}
    container.innerHTML = studies.length
      ? studies.map((study, index) => `<article class="content-card"><div class="card-heading"><div><h3>${esc(study.title || 'Estudo sem título')}</h3><small>${new Date(study.savedAt).toLocaleString('pt-BR')}</small></div><button type="button" class="button secondary light compact open-study" data-index="${index}">Abrir</button></div></article>`).join('')
      : '<div class="empty-inline">Nenhum estudo salvo no arquivo pessoal.</div>';
    $$('.open-study', container).forEach(button => button.addEventListener('click', () => {
      restoreState(studies[Number(button.dataset.index)]?.state);
      closeUtilityPanels();
      showStatus('Estudo restaurado.');
    }));
  }

  function renderVersions() {
    const container = $('#versions');
    if (!container) return;
    container.innerHTML = versions.length
      ? versions.map((version, index) => `<article class="version-row"><div><strong>${esc(version.label || 'Versão automática')}</strong><small>${new Date(version.date).toLocaleString('pt-BR')}</small></div><button type="button" class="button secondary light compact restore-version" data-index="${index}">Restaurar</button></article>`).join('')
      : '<div class="empty-inline">Nenhuma versão criada.</div>';
    $$('.restore-version', container).forEach(button => button.addEventListener('click', () => {
      restoreState(versions[Number(button.dataset.index)]?.state);
      closeUtilityPanels();
      showStatus('Versão restaurada.');
    }));
  }

  function openUtilityPanel(panelId) {
    $$('.utility-panel').forEach(panel => { panel.hidden = panel.id !== panelId; });
    if (panelId === 'searchPanel') renderSearch();
    if (panelId === 'studiesPanel') renderStudies();
    if (panelId === 'versionsPanel') renderVersions();
  }

  function closeUtilityPanels() {
    $$('.utility-panel').forEach(panel => { panel.hidden = true; });
  }

  async function generateEpub(options = {}) {
    const profile = selectedExportProfile();
    if (profile.mode === 'xhtml' && options.download !== false) {
      await downloadCurrentXhtml();
      return { mode: 'xhtml' };
    }
    if (!result) return showStatus('Processe um artigo antes de gerar o EPUB.', true);
    if (typeof JSZip === 'undefined') return showStatus('O módulo de compactação não foi carregado.', true);
    const initialAudit = buildPreExportAudit();
    if (initialAudit.blocking) {
      activateMainTab('overviewGroup', 'validation');
      return showStatus(`Exportação bloqueada: ${initialAudit.checks.filter(check => !check.ok).map(check => check.label).join('; ')}.`, true);
    }

    setEpubProcessing(true, 'Validando conteúdo…');
    try {
      setEpubProcessing(true, 'Auditando conteúdo e imagens…');
      const finalAudit = buildPreExportAudit();
      if (finalAudit.blocking) throw new Error(finalAudit.checks.filter(check => !check.ok).map(check => check.label).join('; '));
      // Reconstrói o XHTML para incluir as últimas alterações e caminhos locais antes da exportação.
      result.xhtml = buildXhtml(result);
      const prepared = await prepareEpubContentAndImages(result.xhtml);
      const studyName = safeEpubFileName('xhtml');
      const identifier = `urn:uuid:${createUuid()}`;
      const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const contentProperties = detectContentProperties(prepared.xhtml);
      const studyProperties = contentProperties.length ? ` properties="${contentProperties.join(' ')}"` : '';

      const navXhtml = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML_NS}" xmlns:epub="${EPUB_NS}" lang="pt-BR" xml:lang="pt-BR">\n<head><meta charset="utf-8" /><title>Sumário</title><link href="css_rafael.css" type="text/css" rel="stylesheet" /><link href="default.css" type="text/css" rel="stylesheet" /></head>\n<body><nav epub:type="toc" id="toc"><h1>Sumário</h1><ol><li><a href="${esc(studyName)}">${esc(result.title)}</a></li></ol></nav></body>\n</html>`;

      const tocNcx = `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="pt-BR">\n<head><meta name="dtb:uid" content="${esc(identifier)}" /><meta name="dtb:depth" content="1" /><meta name="dtb:totalPageCount" content="0" /><meta name="dtb:maxPageNumber" content="0" /></head>\n<docTitle><text>${esc(result.title)}</text></docTitle>\n<navMap><navPoint id="navPoint-1" playOrder="1"><navLabel><text>${esc(result.title)}</text></navLabel><content src="${esc(studyName)}" /></navPoint></navMap>\n</ncx>`;

      const imageManifest = prepared.imageAssets.map(asset => `<item id="${esc(asset.id)}" href="${esc(asset.href)}" media-type="${esc(asset.mediaType)}" />`).join('');
      const contentOpf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="pt-BR" dir="ltr">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="book-id">${esc(identifier)}</dc:identifier>\n<dc:title>${esc(result.title)}</dc:title>\n<dc:language>pt-BR</dc:language>\n<dc:creator>Extrator A Sentinela</dc:creator>\n<meta property="dcterms:modified">${modified}</meta>\n<meta property="rendition:layout">reflowable</meta>\n</metadata>\n<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />\n<item id="study" href="${esc(studyName)}" media-type="application/xhtml+xml"${studyProperties} />\n<item id="css-rafael" href="css_rafael.css" media-type="text/css" />\n<item id="css-default" href="default.css" media-type="text/css" />\n<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />\n${imageManifest}\n</manifest>\n<spine toc="ncx"><itemref idref="study" /><itemref idref="nav" linear="no" /></spine>\n</package>`;

      const containerXml = `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>\n</container>`;

      assertWellFormedXml(prepared.xhtml, studyName);
      assertWellFormedXml(navXhtml, 'nav.xhtml');
      assertWellFormedXml(tocNcx, 'toc.ncx');
      assertWellFormedXml(contentOpf, 'content.opf');
      assertWellFormedXml(containerXml, 'container.xml');

      const defaultCss = `body{font-family:serif;line-height:1.55;margin:5%;color:#161616}article{max-width:42em;margin:0 auto}img{display:block;max-width:100%;height:auto;margin:1em auto}figure{margin:1.4em 0}figcaption{font-size:.9em;text-align:center}.missing-image{display:block;border:1px solid #999;padding:.75em;margin:1em 0;font-style:italic}`;
      const rafaelCss = `.citation{border-left:.25em solid #315c55;padding:.6em .8em;margin:1em 0}.citationsource{text-decoration:none}.comentarioTextoBiblico{color:#8f1d1d;background:#fff1f1;padding:.5em}mark.marca-amarela{background:#fff59d;color:inherit}mark.marca-azul{background:#b3e5fc;color:inherit}mark.marca-laranja{background:#ffcc80;color:inherit}mark.marca-amarela,mark.marca-azul,mark.marca-laranja{padding:0 .05em;border-radius:.12em;-webkit-box-decoration-break:clone;box-decoration-break:clone}`;

      setEpubProcessing(true, 'Compactando EPUB…');
      const zip = new JSZip();
      // Deve ser a primeira entrada e não pode ser comprimida.
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml', containerXml);
      zip.file(`OEBPS/${studyName}`, prepared.xhtml);
      zip.file('OEBPS/css_rafael.css', rafaelCss);
      zip.file('OEBPS/default.css', defaultCss);
      zip.file('OEBPS/nav.xhtml', navXhtml);
      zip.file('OEBPS/toc.ncx', tocNcx);
      zip.file('OEBPS/content.opf', contentOpf);
      prepared.imageAssets.forEach(asset => zip.file(`OEBPS/${asset.href}`, asset.data));

      const bytes = await zip.generateAsync(
        { type: 'uint8array', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: profile.compression || 6 } },
        metadata => {
          if (metadata.percent > 1) setEpubProcessing(true, `Compactando ${Math.round(metadata.percent)}%…`);
        }
      );

      setEpubProcessing(true, 'Verificando EPUB…');
      const expectedFiles = [
        'mimetype',
        'META-INF/container.xml',
        'OEBPS/content.opf',
        'OEBPS/nav.xhtml',
        'OEBPS/toc.ncx',
        'OEBPS/css_rafael.css',
        'OEBPS/default.css',
        `OEBPS/${studyName}`,
        ...prepared.imageAssets.map(asset => `OEBPS/${asset.href}`)
      ];
      await validateGeneratedEpub(bytes, expectedFiles);

      lastGeneratedEpubBytes = bytes;
      lastGeneratedEpubName = `${slug(result.title)}.epub`;
      if (options.download !== false) {
        const blob = new Blob([bytes], { type: 'application/epub+zip' });
        download(lastGeneratedEpubName, blob, 'application/epub+zip');
      }
      const imageMessage = prepared.imageAssets.length ? ` ${prepared.imageAssets.length} imagem(ns) incorporada(s).` : '';
      const omittedMessage = prepared.omittedImages.length ? ` ${prepared.omittedImages.length} recurso(s) externo(s) não pôde(ram) ser incorporado(s) e foi(ram) substituído(s) por aviso textual.` : '';
      if (!options.silentSuccess) showStatus(`${options.download === false ? 'EPUB temporário gerado' : 'EPUB validado e gerado com sucesso'}.${imageMessage}${omittedMessage}`, prepared.omittedImages.length > 0);
      return { bytes, fileName: lastGeneratedEpubName, imageAssets: prepared.imageAssets, omittedImages: prepared.omittedImages };
    } catch (error) {
      console.error(error);
      if (options.throwOnError) throw error;
      showStatus(`Falha na criação do EPUB: ${error?.message || 'erro desconhecido'}`, true);
      return null;
    } finally {
      setEpubProcessing(false);
    }
  }

  async function downloadCurrentXhtml() {
    if (!result) return showStatus('Processe um artigo primeiro.', true);
    const auditBeforeDownload = buildPreExportAudit();
    if (auditBeforeDownload.images && (auditBeforeDownload.images.pending || auditBeforeDownload.images.errors)) {
      activateMainTab('preparationGroup', 'images');
      return showStatus('XHTML não exportado: prepare ou exclua todas as imagens marcadas para inclusão.', true);
    }
    result.xhtml = buildXhtml(result);
    download(getFileName('xhtml'), result.xhtml, 'application/xhtml+xml;charset=utf-8');
    const audit = imageAudit();
    showStatus(`XHTML baixado com ${audit.ready}/${audit.included} imagem(ns) preparada(s).${audit.errors ? ' As imagens com erro continuam externas até serem selecionadas manualmente.' : ''}`, audit.errors > 0);
  }

  function exportCsv() {
    if (!result) return '';
    const rows = [['Tipo', 'Número/ordem', 'Conteúdo']];
    result.subtitles.forEach(item => rows.push(['Subtítulo', item.order, item.text]));
    result.paragraphs.forEach(item => {
      rows.push(['Parágrafo', item.number, item.text]);
      normalizeParagraphHighlights(item).forEach(mark => rows.push(['Marca-texto', item.number, `${markerMeta(mark.type)?.label || mark.type}: ${item.text.slice(mark.start, mark.end)}`]));
    });
    result.questions.forEach(item => rows.push(['Pergunta', item.order, item.text]));
    result.scriptures.forEach(item => rows.push(['Texto bíblico', item.order, `${item.reference} | ocorrências: ${Math.max(1, item.occurrences?.length || 0)} | parágrafos: ${(item.occurrences || []).map(occurrence => occurrence.paragraph).filter(Boolean).join(', ')} | ${item.text}`]));
    return '\ufeff' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  }

  async function clearImageDatabase() {
    releaseAllImagePreviews();
    imageMemoryCache.clear();
    if (imageDbPromise) {
      try { (await imageDbPromise)?.close(); } catch { /* ignore */ }
      imageDbPromise = null;
    }
    if (!('indexedDB' in window)) return;
    await new Promise(resolve => {
      const request = indexedDB.deleteDatabase(IMAGE_DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }

  function clearWorkspaceView() {
    result = null;
    elements.empty.style.display = '';
    elements.summaryCount.textContent = 'Nenhum artigo';
    elements.readyIndicator.textContent = 'Aguardando estudo';
    elements.readyIndicator.className = 'ready-indicator neutral';
    ['overview','structure','validation','comparison','questions','scriptures','images','preview'].forEach(id => { const node = document.getElementById(id); if (node) node.innerHTML = ''; });
    const codeNode = $('#xhtmlCode');
    if (codeNode) codeNode.textContent = '';
    closeUtilityPanels();
    updateExportAvailability();
  }

  async function resetSystemData(mode = 'current') {
    clearTimeout(autosaveTimer);
    elements.source.value = '';
    elements.bibleTextInput.value = '';
    if ($('#articleUrl')) $('#articleUrl').value = '';
    const checkReport = $('#epubCheckReport'); if (checkReport) { checkReport.hidden = true; checkReport.innerHTML = ''; }
    clearWorkspaceView();
    undoStack = [];
    redoStack = [];
    storageRemove(STORAGE_KEY);
    if (mode === 'all') {
      storageRemove(STUDIES_KEY);
      storageRemove(VERSIONS_KEY);
      versions = [];
      libraryItems = [];
      await clearImageDatabase();
      $('#fileName').value = 'artigo-a-sentinela.xhtml';
      $('#citationStart').value = '1';
      $('#imageFolder').value = 'images';
      $('#libraryFileName').value = 'mini-biblioteca.xhtml';
      $('#imageQuality').value = '0.85';
      $('#imageMaxDimension').value = String(DEFAULT_MAX_IMAGE_DIMENSION);
      if ($('#exportProfile')) $('#exportProfile').value = 'balanced';
      if ($('#articleUrl')) $('#articleUrl').value = '';
      const profileDescription = $('#exportProfileDescription');
      if (profileDescription) profileDescription.textContent = EXPORT_PROFILES.balanced.description;
      renderLibrary();
      renderVersions();
    }
    updateCharacterCount();
    pushUndoSnapshot(mode === 'all' ? 'Sistema resetado' : 'Estudo resetado');
    updateUndoButtons();
    closeResetDialog();
    showStatus(mode === 'all' ? 'Todos os dados locais foram removidos.' : 'O estudo atual foi resetado. Estudos salvos e biblioteca foram preservados.');
  }

  function openResetDialog() {
    const dialog = $('#resetDialog');
    if (!dialog) return;
    dialog.hidden = false;
    dialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dialog-open');
    $('#resetCurrentProject')?.focus();
  }

  function closeResetDialog() {
    const dialog = $('#resetDialog');
    if (!dialog) return;
    dialog.hidden = true;
    dialog.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('dialog-open');
    $('#resetSystem')?.focus();
  }


  async function processCurrentSource({ sourceUrl = '' } = {}) {
    setProcessing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      result = parseSource(elements.source.value);
      if (sourceUrl) result.sourceUrl = sourceUrl;
      applyBibleTexts(false);
      result.xhtml = buildXhtml(result);
      renderAll();
      setTimeout(() => reconcileImageCacheState({ render: true }), 0);
      activateMainTab('overviewGroup', 'overview');
      queueSave('Artigo processado');
      showStatus('Artigo processado com sucesso. Revise os dados extraídos na área de trabalho.');
      return true;
    } catch (error) {
      console.error(error);
      showStatus(error?.message || 'Não foi possível processar o artigo.', true);
      return false;
    } finally {
      setProcessing(false);
    }
  }

  function bindEvents() {
    $('#extract')?.addEventListener('click', () => processCurrentSource());
    $('#importArticleUrl')?.addEventListener('click', importArticleFromUrl);
    $('#articleUrl')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); importArticleFromUrl(); } });

    $('#paste')?.addEventListener('click', async () => {
      try {
        elements.source.value = await navigator.clipboard.readText();
        updateCharacterCount();
        showStatus('Conteúdo colado. Agora selecione “Processar artigo”.');
      } catch {
        showStatus('O navegador bloqueou a colagem automática. Use Ctrl+V no campo de HTML.', true);
      }
    });

    $('#resetSystem')?.addEventListener('click', openResetDialog);
    $$('[data-reset-close]').forEach(button => button.addEventListener('click', closeResetDialog));
    $('#resetCurrentProject')?.addEventListener('click', () => resetSystemData('current'));
    $('#resetAllData')?.addEventListener('click', () => resetSystemData('all'));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('#resetDialog')?.hidden) closeResetDialog();
    });

    $('#clear')?.addEventListener('click', () => {
      elements.source.value = '';
      elements.bibleTextInput.value = '';
      releaseAllImagePreviews();
      result = null;
      elements.empty.style.display = '';
      elements.summaryCount.textContent = 'Nenhum artigo';
      elements.readyIndicator.textContent = 'Aguardando estudo';
      elements.readyIndicator.className = 'ready-indicator neutral';
      ['overview','structure','validation','comparison','questions','scriptures','images','preview'].forEach(id => { const node = document.getElementById(id); if (node) node.innerHTML = ''; });
      $('#xhtmlCode').textContent = '';
      if ($('#articleUrl')) $('#articleUrl').value = '';
      const checkReport = $('#epubCheckReport'); if (checkReport) { checkReport.hidden = true; checkReport.innerHTML = ''; }
      updateCharacterCount();
      storageRemove(STORAGE_KEY);
      updateExportAvailability();
      showStatus('Campos limpos.');
    });

    elements.source?.addEventListener('input', () => { updateCharacterCount(); queueSave('Código-fonte atualizado'); });
    elements.bibleTextInput?.addEventListener('input', () => queueSave('Bloco bíblico atualizado'));
    $('#applyBibleTexts')?.addEventListener('click', () => applyBibleTexts(true));

    $$('.main-tabs .tab').forEach(tab => tab.addEventListener('click', () => activateMainTab(tab.dataset.view, tab.dataset.defaultView || '')));
    $$('.subtab').forEach(tab => tab.addEventListener('click', () => activateSubview(tab.dataset.subview)));

    $('#openSearchPanel')?.addEventListener('click', () => openUtilityPanel('searchPanel'));
    $('#openStudiesPanel')?.addEventListener('click', () => openUtilityPanel('studiesPanel'));
    $('#openVersionsPanel')?.addEventListener('click', () => openUtilityPanel('versionsPanel'));
    $$('[data-close-utility]').forEach(button => button.addEventListener('click', closeUtilityPanels));

    $('#saveProject')?.addEventListener('click', () => {
      const state = currentState();
      saveLocal('Projeto salvo manualmente');
      const studies = (() => { try { return JSON.parse(storageGet(STUDIES_KEY) || '[]'); } catch { return []; } })();
      studies.unshift({ title: result?.title || 'Projeto sem título', savedAt: new Date().toISOString(), state });
      storageSet(STUDIES_KEY, JSON.stringify(studies.slice(0, 30)));
      download(`${slug(result?.title || 'projeto')}.json`, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
      showStatus('Projeto salvo no navegador e baixado como JSON.');
    });

    $('#openProject')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        restoreState(JSON.parse(await file.text()));
        pushUndoSnapshot('Projeto aberto');
        showStatus('Projeto aberto com sucesso.');
      } catch {
        showStatus('O arquivo selecionado não é um projeto válido.', true);
      }
      event.target.value = '';
    });

    $('#undoAction')?.addEventListener('click', () => {
      if (undoStack.length < 2) return showStatus('Não há alterações anteriores para desfazer.', true);
      const current = undoStack.pop();
      redoStack.push(current);
      restoreState(undoStack[undoStack.length - 1].state);
      updateUndoButtons();
      showStatus('Alteração desfeita.');
    });
    $('#redoAction')?.addEventListener('click', () => {
      const next = redoStack.pop();
      if (!next) return showStatus('Não há alterações para refazer.', true);
      undoStack.push(next);
      restoreState(next.state);
      updateUndoButtons();
      showStatus('Alteração refeita.');
    });

    $('#downloadXhtml')?.addEventListener('click', downloadCurrentXhtml);
    $('#copyXhtml')?.addEventListener('click', event => formatAndCopyCurrentXhtml(event.currentTarget));
    $('#formatCopyXhtml')?.addEventListener('click', event => formatAndCopyCurrentXhtml(event.currentTarget));
    $('#downloadJson')?.addEventListener('click', () => result ? download(`${slug(result.title)}.json`, JSON.stringify(result, null, 2), 'application/json;charset=utf-8') : showStatus('Processe um artigo primeiro.', true));
    $('#downloadCsv')?.addEventListener('click', () => result ? download(`${slug(result.title)}.csv`, exportCsv(), 'text/csv;charset=utf-8') : showStatus('Processe um artigo primeiro.', true));
    $('#downloadEpub')?.addEventListener('click', () => generateEpub());
    $('#runEpubCheck')?.addEventListener('click', runOfficialEpubCheck);
    $('#exportProfile')?.addEventListener('change', event => applyExportProfile(event.target.value));
    $('#downloadLibraryJson')?.addEventListener('click', () => download('mini-biblioteca.json', JSON.stringify(libraryItems, null, 2), 'application/json;charset=utf-8'));
    $('#downloadLibraryXhtml')?.addEventListener('click', () => {
      const body = libraryItems.map(item => `<section><h2>${esc(item.reference)}</h2><p>${esc(item.text || '')}</p>${item.comment ? `<p>${esc(item.comment)}</p>` : ''}</section>`).join('\n');
      download(clean($('#libraryFileName')?.value) || 'mini-biblioteca.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR"><head><title>Mini Biblioteca</title></head><body>${body}</body></html>`, 'application/xhtml+xml;charset=utf-8');
    });
    $('#importLibraryJson')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        if (!Array.isArray(imported)) throw new Error();
        libraryItems = imported;
        renderLibrary();
        queueSave('Biblioteca importada');
        showStatus('Mini Biblioteca importada.');
      } catch { showStatus('O arquivo da biblioteca é inválido.', true); }
      event.target.value = '';
    });
    $('#downloadImagesZip')?.addEventListener('click', downloadImagesZip);

    ['fileName','citationStart','imageFolder','libraryFileName','imageQuality','imageMaxDimension'].forEach(id => document.getElementById(id)?.addEventListener('change', () => {
      if ((id === 'imageQuality' || id === 'imageMaxDimension') && $('#exportProfile')?.value !== 'custom') { $('#exportProfile').value = 'custom'; const description = $('#exportProfileDescription'); if (description) description.textContent = EXPORT_PROFILES.custom.description; }
      if (result) {
        if (id === 'imageFolder') {
          result.images.forEach((image, index) => {
            const model = normalizeImageModel(image, index);
            if (model.status === 'ready' && model.mediaType) model.localPath = imageLocalPath(index, model.mediaType);
          });
        }
        if (id === 'imageQuality' || id === 'imageMaxDimension') {
          result.images.forEach((image, index) => {
            const model = normalizeImageModel(image, index);
            if (model.include && model.status === 'ready') {
              model.status = 'pending';
              model.error = 'Configuração de otimização alterada. Processe a imagem novamente.';
            }
          });
        }
        result.xhtml = buildXhtml(result);
        $('#xhtmlCode').textContent = result.xhtml;
        renderImages();
      }
      updateExportAvailability();
      queueSave('Configuração alterada');
    }));
  }

  function updateCharacterCount() {
    const length = elements.source?.value.length || 0;
    elements.charCount.textContent = `${length.toLocaleString('pt-BR')} ${length === 1 ? 'caractere' : 'caracteres'}`;
  }

  window.SentinelaTestApi = Object.freeze({
    parseSource,
    buildXhtml,
    buildPreExportAudit,
    runBuiltInRegressionTest,
    imageAudit,
    renderComparison,
    alignDiffLines,
    selectedExportProfile,
    generateEpub,
    applyExportProfile
  });

  function initialize() {
    try { versions = JSON.parse(storageGet(VERSIONS_KEY) || '[]'); } catch { versions = []; }
    bindEvents();
    updateCharacterCount();
    renderLibrary();
    renderVersions();
    const saved = storageGet(STORAGE_KEY);
    if (saved) {
      try {
        restoreState(JSON.parse(saved));
        elements.autosaveStatus.textContent = 'Projeto restaurado';
      } catch {
        storageRemove(STORAGE_KEY);
      }
    }
    pushUndoSnapshot('Estado inicial');
    updateUndoButtons();
    const savedProfile = $('#exportProfile')?.value || 'balanced';
    applyExportProfile(savedProfile, { announce: false });
    checkLocalServices();
    updateExportAvailability();
    document.documentElement.dataset.engineReady = 'true';
    window.dispatchEvent(new CustomEvent('sentinela:engine-ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
