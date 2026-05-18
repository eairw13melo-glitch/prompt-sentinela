async function buscar() {
  const link = document.getElementById("link").value.trim();

  if (!link) {
    alert("❌ Cole um link primeiro!");
    return;
  }

  // ==================== LOADING ====================
  const btnBuscar = document.querySelector('button[onclick="buscar()"]');
  const textoOriginal = btnBuscar.textContent;
  btnBuscar.disabled = true;
  btnBuscar.innerHTML = `🔄 Buscando... <span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span>`;

  try {
    const res = await fetch(`/api/extrair?url=${encodeURIComponent(link)}`);

    // Lê a resposta como texto (para ver exatamente o que veio)
    const text = await res.text();

    console.log("📡 Resposta bruta da API:", text);
    console.log("📡 Status da resposta:", res.status, res.statusText);

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      // ==================== DEPURAÇÃO VISÍVEL ====================
      const resultadoEl = document.getElementById("resultado");
      resultadoEl.innerHTML = `
<strong style="color:red;">❌ ERRO: A API não retornou JSON válido</strong><br><br>
<strong>Status:</strong> ${res.status} ${res.statusText}<br>
<strong>Resposta recebida:</strong><br>
<pre style="background:#ffe6e6; padding:10px; font-size:12px; white-space:pre-wrap;">${text}</pre>
<br>
<strong>O que fazer agora?</strong><br>
1. Abra o DevTools (F12) → aba Console e veja os logs<br>
2. Verifique se o arquivo extrair.js está na pasta correta (/api/extrair.js)<br>
3. Reinicie o servidor (vercel dev ou npm run dev)
      `;
      return;
    }

    if (data.erro) {
      alert("❌ " + data.erro);
      if (data.detalhe) console.log("Detalhe do erro:", data.detalhe);
      return;
    }

    // ✅ Monta o prompt
    const prompt = `
✅ PROMPT DEFINITIVO — ESTUDO DA SENTINELA PRO

🏷️ Título: ${data.titulo}
📖 Texto base: ${data.textoBase}
📄 Número de parágrafos: ${data.paragrafos}

❓ Perguntas do estudo:
${data.perguntas}
    `.trim();

    document.getElementById("resultado").textContent = prompt;

  } catch (error) {
    alert("❌ Erro de conexão com a API.");
    console.error(error);
  } finally {
    // Restaura botão
    btnBuscar.disabled = false;
    btnBuscar.textContent = textoOriginal;
  }
}

function copiar() {
  const texto = document.getElementById("resultado").textContent;

  if (!texto || texto.includes("ERRO:")) {
    alert("❌ Nada para copiar ou ainda há erro na tela!");
    return;
  }

  navigator.clipboard.writeText(texto)
    .then(() => alert("✅ Prompt copiado com sucesso!"))
    .catch(() => alert("Erro ao copiar"));
}
