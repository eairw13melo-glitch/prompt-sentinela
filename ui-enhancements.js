(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const helpDialog = $('#helpDialog');
  let lastFocusedElement = null;

  function openHelp() {
    if (!helpDialog) return;
    lastFocusedElement = document.activeElement;
    helpDialog.classList.add('is-open');
    helpDialog.setAttribute('aria-hidden', 'false');
    document.body.classList.add('help-dialog-open');
    $('.help-dialog-close', helpDialog)?.focus();
  }

  function closeHelp() {
    if (!helpDialog) return;
    helpDialog.classList.remove('is-open');
    helpDialog.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('help-dialog-open');
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  }

  $('#headerHelpButton')?.addEventListener('click', openHelp);
  $$('[data-help-close="true"]').forEach((button) => button.addEventListener('click', closeHelp));

  helpDialog?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeHelp();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = $$('button, [href], input, textarea, select, summary, [tabindex]:not([tabindex="-1"])', helpDialog)
      .filter((element) => !element.disabled && !element.hidden);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function activateMainTab(targetId) {
    const targetButton = $(`.main-tabs [data-view="${targetId}"]`);
    if (!targetButton) return;
    targetButton.click();
    $$('.main-tabs .tab').forEach((button) => {
      const selected = button === targetButton;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    updateWorkflow(targetId);
  }

  function updateWorkflow(targetId) {
    const targetMap = {
      overviewGroup: 1,
      preparationGroup: 2,
      library: 2,
      exportGroup: 3
    };
    const activeIndex = targetMap[targetId] ?? 0;
    $$('.workflow-step').forEach((step, index) => {
      step.classList.toggle('active', index === activeIndex);
      step.classList.toggle('complete', index < activeIndex);
      if (index === activeIndex) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  }

  $$('[data-main-tab-target]').forEach((button) => {
    button.addEventListener('click', () => activateMainTab(button.dataset.mainTabTarget));
  });

  $$('[data-focus-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.focusSection);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#source')?.focus({ preventScroll: true });
      $$('.workflow-step').forEach((step, index) => {
        step.classList.toggle('active', index === 0);
        if (index === 0) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      });
    });
  });

  $$('.main-tabs .tab').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.main-tabs .tab').forEach((tab) => {
        const selected = tab === button;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      updateWorkflow(button.dataset.view);
    });
  });

  $$('.subtabs').forEach((tabList) => {
    const tabs = $$('.subtab', tabList);
    tabs.forEach((button) => {
      button.addEventListener('click', () => {
        tabs.forEach((tab) => {
          const selected = tab === button;
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
        });
      });
    });
  });

  function openSearch() {
    const trigger = $('#openSearchPanel');
    trigger?.click();
    window.setTimeout(() => {
      const panel = $('#searchPanel');
      const input = panel?.querySelector('input, textarea, [contenteditable="true"]');
      input?.focus();
    }, 30);
  }

  $('#headerSearchButton')?.addEventListener('click', openSearch);
  $('#printSummary')?.addEventListener('click', () => window.print());

  document.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;

    if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      $('#saveProject')?.click();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      $('#extract')?.click();
    }
  });

  // Mantém os painéis utilitários acessíveis mesmo se a lógica original apenas alternar `hidden`.
  const utilityPanels = $$('.utility-panel');
  utilityPanels.forEach((panel) => {
    new MutationObserver(() => {
      panel.setAttribute('aria-hidden', String(panel.hidden));
      if (!panel.hidden) panel.querySelector('button, input, textarea, [tabindex]')?.focus();
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  });

  // Fecha o menu Projeto após selecionar uma ação.
  $('.project-menu')?.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-action')) return;
    window.setTimeout(() => {
      const menu = $('.project-menu');
      if (menu) menu.open = false;
    }, 0);
  });

  // Melhora a contagem visual mesmo quando o script principal não estiver disponível.
  const source = $('#source');
  const charCount = $('#charCount');
  if (source && charCount) {
    const updateCount = () => {
      const length = source.value.length;
      charCount.textContent = `${length.toLocaleString('pt-BR')} ${length === 1 ? 'caractere' : 'caracteres'}`;
    };
    source.addEventListener('input', updateCount, { passive: true });
    updateCount();
  }
})();
